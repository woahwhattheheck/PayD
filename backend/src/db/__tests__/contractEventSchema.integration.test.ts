import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// Run from backend with MIGRATION_TEST_DATABASE_URL pointing to a test database.
// One connection owns every temporary schema; ROLLBACK removes it after each case.
const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('Contract event schema reconciliation (PostgreSQL)', () => {
  let client: pg.Client;
  let baseSql: string;
  let legacySql: string;
  let reconcileSql: string;
  let canonicalSql: string;

  beforeAll(async () => {
    const migrations = path.resolve(process.cwd(), 'src/db/migrations');
    const readMigration = (filename: string) =>
      readFileSync(path.join(migrations, filename), 'utf8');
    baseSql = readMigration('001_create_tables.sql');
    legacySql = readMigration('015_create_contract_events.sql');
    reconcileSql = readMigration('015_reconcile_contract_events.sql');
    canonicalSql = readMigration('016_create_contract_events.sql');

    client = new pg.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 10_000,
    });
    await client.connect();
  }, 15_000);

  beforeEach(async () => {
    const schema = `contract_events_test_${randomUUID().replace(/-/g, '')}`;
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query(baseSql);
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
  });

  afterAll(async () => {
    await client?.end();
  });

  const canonicalInsert = `
    INSERT INTO contract_events (
      organization_id, contract_id, event_type, payload, ledger_sequence,
      transaction_hash, event_index, ledger_closed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (contract_id, transaction_hash, event_index) DO NOTHING
    RETURNING id
  `;

  async function canonicalValues(): Promise<unknown[]> {
    const organization = await client.query<{ id: number }>(
      "INSERT INTO organizations (name) VALUES ('Migration test organization') RETURNING id",
    );
    return [
      organization.rows[0]!.id,
      'C'.repeat(56),
      'payment_sent',
      JSON.stringify({ amount: '10000000', recipient: 'test-recipient' }),
      '1235',
      'a'.repeat(64),
      7,
      '2026-10-04T00:00:00.123456Z',
    ];
  }

  it('reproduces the missing organization column without reconciliation', async () => {
    await client.query(legacySql);

    await expect(client.query(canonicalSql)).rejects.toMatchObject({
      code: '42703',
      message: expect.stringContaining('organization_id'),
    });
  });

  it('retains legacy rows and cursor while allowing canonical idempotent inserts', async () => {
    await client.query(legacySql);
    await client.query(`
      INSERT INTO contract_events (
        event_id, contract_id, event_type, payload, ledger_sequence, tx_hash, created_at
      ) VALUES (
        '0000001234-0000000007', 'legacy-contract', 'legacy-payment',
        '{"amount":"9007199254740993","note":"retained history","nested":{"ok":true}}'::jsonb,
        1234, NULL, '2026-10-03T12:34:56.123456Z'
      )
    `);
    await client.query(`
      INSERT INTO contract_event_index_state (state_key, last_ledger_sequence, updated_at)
      VALUES ('contract_event_indexer', 1234, '2026-10-03T12:35:00.654321Z')
    `);

    const legacyRows = await client.query(
      'SELECT to_jsonb(e)::text AS snapshot FROM contract_events e ORDER BY id',
    );
    const legacyCursor = await client.query(
      'SELECT to_jsonb(s)::text AS snapshot FROM contract_event_index_state s ORDER BY id',
    );
    const legacyIndexes = await client.query(`
      SELECT indexrelid::text AS oid, indexrelid::regclass::text AS name
      FROM pg_index WHERE indrelid = 'contract_events'::regclass ORDER BY indexrelid
    `);
    const legacySequence = await client.query(
      "SELECT pg_get_serial_sequence('contract_events', 'id') AS name",
    );

    await client.query(reconcileSql);
    await client.query(canonicalSql);

    const archivedRows = await client.query(
      'SELECT to_jsonb(e)::text AS snapshot FROM contract_events_legacy_015 e ORDER BY id',
    );
    expect(archivedRows.rows).toEqual(legacyRows.rows);
    expect((await client.query(
      'SELECT to_jsonb(s)::text AS snapshot FROM contract_event_index_state s ORDER BY id',
    )).rows).toEqual(legacyCursor.rows);
    expect((await client.query(`
      SELECT indexrelid::text AS oid, indexrelid::regclass::text AS name
      FROM pg_index WHERE indrelid = 'contract_events_legacy_015'::regclass ORDER BY indexrelid
    `)).rows).toEqual(legacyIndexes.rows);
    expect((await client.query(
      "SELECT pg_get_serial_sequence('contract_events_legacy_015', 'id') AS name",
    )).rows).toEqual(legacySequence.rows);
    expect((await client.query('SELECT COUNT(*)::int AS count FROM contract_events')).rows)
      .toEqual([{ count: 0 }]);
    expect((await client.query(`
      SELECT last_indexed_ledger::text AS ledger FROM indexer_state
      WHERE indexer_name = 'contract_event_indexer'
    `)).rows).toEqual([{ ledger: '0' }]);

    const values = await canonicalValues();
    expect((await client.query(canonicalInsert, values)).rowCount).toBe(1);
    expect((await client.query(canonicalInsert, values)).rowCount).toBe(0);
    expect((await client.query('SELECT COUNT(*)::int AS count FROM contract_events')).rows)
      .toEqual([{ count: 1 }]);
  });

  it('leaves an already canonical table and its rows unchanged', async () => {
    await client.query(canonicalSql);
    await client.query(canonicalInsert, await canonicalValues());
    const before = await client.query(`
      SELECT tableoid::text AS table_oid, to_jsonb(e)::text AS snapshot
      FROM contract_events e ORDER BY id
    `);

    await client.query(reconcileSql);

    expect((await client.query(`
      SELECT tableoid::text AS table_oid, to_jsonb(e)::text AS snapshot
      FROM contract_events e ORDER BY id
    `)).rows).toEqual(before.rows);
    expect((await client.query(
      "SELECT to_regclass('contract_events_legacy_015')::text AS archive",
    )).rows).toEqual([{ archive: null }]);
  });
});
