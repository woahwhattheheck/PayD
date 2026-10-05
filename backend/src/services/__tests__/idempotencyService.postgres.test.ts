import { claimKey, completeKey, IdempotencyConflictError } from '../idempotencyService.js';
import { pool, query } from '../../config/database.js';

describe('idempotencyService PostgreSQL concurrency', () => {
  beforeAll(async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id INTEGER PRIMARY KEY
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        idempotency_key VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'in_progress'
          CHECK (status IN ('in_progress', 'completed', 'failed')),
        response_status INTEGER,
        response_body JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        UNIQUE (organization_id, idempotency_key)
      )
    `);

    await query('INSERT INTO organizations (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('allows exactly one of 100 concurrent database claims to process', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, () => claimKey(1, 'real-race-key'))
    );

    const winners = results.filter(
      (result): result is PromiseFulfilledResult<null> => result.status === 'fulfilled'
    );
    const losers = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );

    expect(winners).toHaveLength(1);
    expect(winners[0].value).toBeNull();
    expect(losers).toHaveLength(99);
    for (const result of losers) {
      expect(result.reason).toBeInstanceOf(IdempotencyConflictError);
    }

    const stored = await query(
      `SELECT status, COUNT(*)::int AS count
       FROM idempotency_keys
       WHERE organization_id = $1 AND idempotency_key = $2
       GROUP BY status`,
      [1, 'real-race-key']
    );

    expect(stored.rows).toEqual([{ status: 'in_progress', count: 1 }]);
  });

  it('returns the cached response after the winning request completes', async () => {
    expect(await claimKey(1, 'cached-key')).toBeNull();
    await completeKey(1, 'cached-key', 201, { paymentId: 'pay-123' });

    const replay = await claimKey(1, 'cached-key');

    expect(replay).not.toBeNull();
    expect(replay!.status).toBe('completed');
    expect(replay!.responseStatus).toBe(201);
    expect(replay!.responseBody).toEqual({ paymentId: 'pay-123' });
  });


  it('does not store a terminal response after the claim expires', async () => {
    expect(await claimKey(1, 'expired-terminal-key', 25)).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 100));
    await completeKey(1, 'expired-terminal-key', 201, { stale: true });

    const expired = await query(
      `SELECT status, response_status, response_body
       FROM idempotency_keys
       WHERE organization_id = $1 AND idempotency_key = $2`,
      [1, 'expired-terminal-key']
    );

    expect(expired.rows[0]).toEqual({
      status: 'in_progress',
      response_status: null,
      response_body: null,
    });

    expect(await claimKey(1, 'expired-terminal-key')).toBeNull();
  });

  it('uses a 24-hour default TTL and atomically recycles an expired cached row', async () => {
    expect(await claimKey(1, 'ttl-key')).toBeNull();

    const ttlCheck = await query(
      `SELECT
         expires_at >= NOW() + INTERVAL '23 hours 59 minutes' AS lower_ok,
         expires_at <= NOW() + INTERVAL '24 hours 1 minute' AS upper_ok
       FROM idempotency_keys
       WHERE organization_id = $1 AND idempotency_key = $2`,
      [1, 'ttl-key']
    );

    expect(ttlCheck.rows[0]).toEqual({ lower_ok: true, upper_ok: true });

    await query(
      `UPDATE idempotency_keys
       SET status = 'completed',
           response_status = 200,
           response_body = '{"stale":true}'::jsonb,
           expires_at = NOW() - INTERVAL '1 second'
       WHERE organization_id = $1 AND idempotency_key = $2`,
      [1, 'ttl-key']
    );

    expect(await claimKey(1, 'ttl-key')).toBeNull();

    const recycled = await query(
      `SELECT status, response_status, response_body
       FROM idempotency_keys
       WHERE organization_id = $1 AND idempotency_key = $2`,
      [1, 'ttl-key']
    );

    expect(recycled.rows[0]).toEqual({
      status: 'in_progress',
      response_status: null,
      response_body: null,
    });
  });
});
