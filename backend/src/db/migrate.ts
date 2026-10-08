/**
 * @file src/db/migrate.ts
 * @description Production-grade PostgreSQL migration runner.
 *
 * Responsibilities
 * ────────────────
 * 1. Connect to PostgreSQL using the DATABASE_URL environment variable.
 * 2. Bootstrap the `schema_migrations` tracking table when it is absent
 *    (this handles the very first run against a blank database).
 * 3. Read all *.sql files from the migrations directory, sorted lexicographically
 *    so that numeric prefixes (001_, 002_, …) define strict execution order.
 * 4. For each file:
 *    a. Skip if already recorded in `schema_migrations`.
 *    b. Guard against file-content drift on already-applied migrations
 *       (SHA-256 checksum comparison).
 *    c. Execute within a single SERIALIZABLE transaction so a partial failure
 *       leaves the database unchanged and the migration can be retried safely.
 *    d. Record the migration in `schema_migrations` (filename, checksum, ms).
 * 5. Support a --dry-run flag that logs the plan without executing any SQL.
 * 6. Exit 0 on success, 1 on any error.
 *
 * Time complexity  : O(m log m + m × p)  where m = migration files, p = avg SQL ops per file.
 * Space complexity : O(m) for the applied-set lookup map (in-memory hash set).
 *
 * Usage
 * ─────
 *   ts-node src/db/migrate.ts              # run pending migrations
 *   ts-node src/db/migrate.ts --dry-run    # print plan only
 *   ts-node src/db/migrate.ts --rollback   # (reserved; not yet implemented)
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv';
import pg from 'pg';

const { Pool } = pg;
type PoolClient = pg.PoolClient;

// ─── Bootstrap ──────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('[migrate] ERROR: DATABASE_URL environment variable is not set.');
    process.exit(1);
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

const LEGACY_MIGRATION_FILENAMES: Readonly<Record<string, string>> = Object.freeze({
    '0020_add_deleted_at_to_employees.sql': '002_add_deleted_at_to_employees.sql',
    '0021_extend_employee_profiles.sql': '002_extend_employee_profiles.sql',
    '0030_create_users_2fa.sql': '003_create_users_2fa.sql',
    '0031_multi_tenant_rls.sql': '003_multi_tenant_rls.sql',
    '0040_create_clawback_audit_logs.sql': '004_create_clawback_audit_logs.sql',
    '0041_tenant_configurations.sql': '004_tenant_configurations.sql',
    '0050_auth_rbac_updates.sql': '005_auth_rbac_updates.sql',
    '0051_create_employee_trustlines.sql': '005_create_employee_trustlines.sql',
    '0100_add_salary_to_employees.sql': '010_add_salary_to_employees.sql',
    '0101_create_account_freeze_logs.sql': '010_create_account_freeze_logs.sql',
    '0102_create_multisig_configs.sql': '010_create_multisig_configs.sql',
    '0140_create_contract_registry.sql': '014_create_contract_registry.sql',
    '0141_create_schedules.sql': '014_create_schedules.sql',
    '0150_create_contract_events.sql': '015_create_contract_events.sql',
    '0151_create_execution_history.sql': '015_create_execution_history.sql',
});

/**
 * The tracking table is always the first thing the runner creates.
 * This DDL is intentionally inline (not read from a file) so the runner
 * can bootstrap itself before any file-based migration is evaluated.
 */
const BOOTSTRAP_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id             SERIAL       PRIMARY KEY,
    filename       VARCHAR(255) NOT NULL UNIQUE,
    checksum       CHAR(64)     NOT NULL,
    applied_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    applied_by     VARCHAR(255) NOT NULL DEFAULT current_user,
    execution_ms   INTEGER      CHECK (execution_ms >= 0)
  );
  CREATE INDEX IF NOT EXISTS idx_schema_migrations_filename
    ON schema_migrations (filename);
`;

// ─── Types ───────────────────────────────────────────────────────────────────

interface AppliedMigration {
    filename: string;
    checksum: string;
}

interface MigrationFile {
    filename: string;
    absolutePath: string;
    sql: string;
    checksum: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute the SHA-256 hex digest of a string.
 * Pure function with O(n) time and O(1) extra space (streaming hash).
 */
function sha256(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Fail fast when migration filenames do not have a numeric prefix or reuse one.
 */
function assertUniqueMigrationPrefixes(filenames: string[]): void {
    const seen = new Map<string, string>();

    for (const filename of filenames) {
        const match = /^(\\d+)_/.exec(filename);
        if (!match) {
            throw new Error(`Migration filename must start with a numeric prefix: ${filename}`);
        }

        const prefix = match[1];
        const previous = seen.get(prefix);
        if (previous) {
            throw new Error(`Duplicate migration prefix ${prefix}: ${previous}, ${filename}`);
        }
        seen.set(prefix, filename);
    }
}

/**
 * Return all *.sql files from `dir`, sorted lexicographically.
 * Consistent sort order means numeric prefixes (001_, 012_) define
 * execution sequence without any external configuration.
 *
 * @throws {Error} if the directory cannot be read.
 */
function readMigrationFiles(dir: string): MigrationFile[] {
    if (!fs.existsSync(dir)) {
        throw new Error(`Migrations directory not found: ${dir}`);
    }

    const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort(); // lexicographic; '001_' < '012_' because '0' < '1'

    assertUniqueMigrationPrefixes(files);

    return files.map((filename) => {
        const absolutePath = path.join(dir, filename);
        const sql = fs.readFileSync(absolutePath, 'utf8');
        const checksum = sha256(sql);
        return { filename, absolutePath, sql, checksum };
    });
}

/**
 * Fetch the set of already-applied migrations from the tracking table.
 * Returns a Map<filename, AppliedMigration> for O(1) lookup per file.
 */
async function fetchAppliedMigrations(
    client: PoolClient,
): Promise<Map<string, AppliedMigration>> {
    const { rows } = await client.query<AppliedMigration>(
        'SELECT filename, checksum FROM schema_migrations ORDER BY id',
    );
    const map = new Map<string, AppliedMigration>();
    for (const row of rows) {
        map.set(row.filename, row);
    }
    return map;
}

/**
 * Resolve an applied record by the current filename or its exact legacy name.
 * Renumbered SQL files remain byte-identical, so the checksum drift guard proves
 * the legacy record and current filename represent the same migration.
 */
function resolveAppliedMigration(
    applied: Map<string, AppliedMigration>,
    file: MigrationFile,
): AppliedMigration | undefined {
    const direct = applied.get(file.filename);
    if (direct) return direct;
    const legacyFilename = LEGACY_MIGRATION_FILENAMES[file.filename];
    return legacyFilename ? applied.get(legacyFilename) : undefined;
}

/**
 * Record a successfully-applied migration in the tracking table.
 * Executed inside the same transaction as the migration SQL itself.
 */
async function recordMigration(
    client: PoolClient,
    filename: string,
    checksum: string,
    executionMs: number,
): Promise<void> {
    await client.query(
        `INSERT INTO schema_migrations (filename, checksum, execution_ms)
     VALUES ($1, $2, $3)
     ON CONFLICT (filename) DO NOTHING`,
        [filename, checksum, executionMs],
    );
}

// ─── Core runner ─────────────────────────────────────────────────────────────

interface RunResult {
    applied: string[];
    skipped: string[];
    driftDetected: string[];
}

async function runMigrations(isDryRun: boolean): Promise<RunResult> {
    const pool = new Pool({
        connectionString: DATABASE_URL,
        // Keep the pool minimal; the runner is a CLI tool, not a long-lived server.
        max: 1,
        idleTimeoutMillis: 5_000,
        connectionTimeoutMillis: 10_000,
    });

    const result: RunResult = { applied: [], skipped: [], driftDetected: [] };

    const client = await pool.connect();

    try {
        // ── Step 1: Bootstrap tracking table ──────────────────────────────────
        // Always run inline, outside a migration transaction, so it is safe even
        // on a completely blank database.
        if (!isDryRun) {
            await client.query(BOOTSTRAP_SQL);
            console.log('[migrate] ✓ schema_migrations table ready');
        } else {
            console.log('[migrate] [dry-run] Would bootstrap schema_migrations table');
        }

        // ── Step 2: Read migration files ──────────────────────────────────────
        const files = readMigrationFiles(MIGRATIONS_DIR);
        console.log(`[migrate] Found ${files.length} migration file(s) in ${MIGRATIONS_DIR}`);

        if (files.length === 0) {
            console.log('[migrate] Nothing to do.');
            return result;
        }

        // ── Step 3: Fetch already-applied set (O(m) time / space) ─────────────
        const applied = isDryRun
            ? new Map<string, AppliedMigration>()
            : await fetchAppliedMigrations(client);

        // ── Step 4: Evaluate each migration ───────────────────────────────────
        for (const file of files) {
            const record = resolveAppliedMigration(applied, file);

            if (record !== undefined) {
                // File already applied — check for content drift (tampering detection).
                if (record.checksum !== file.checksum) {
                    const msg =
                        `[migrate] DRIFT DETECTED: "${file.filename}" maps to applied ` +
                        `migration "${record.filename}" with checksum ${record.checksum}, ` +
                        `but the current file has checksum ${file.checksum}. ` +
                        `Aborting to protect database integrity.`;
                    console.error(msg);
                    result.driftDetected.push(file.filename);
                    // Accumulate all drifted files before throwing so the log is complete.
                    continue;
                }

                if (record.filename !== file.filename && !isDryRun) {
                    await recordMigration(client, file.filename, file.checksum, 0);
                    applied.set(file.filename, { filename: file.filename, checksum: file.checksum });
                    console.log(
                        `[migrate] ↷ Skipped  ${file.filename}  ` +
                        `(already applied as ${record.filename}; alias recorded)`,
                    );
                } else {
                    console.log(`[migrate] ↷ Skipped  ${file.filename}  (already applied)`);
                }
                result.skipped.push(file.filename);
                continue;
            }

            // ── Step 5: Apply pending migration in an atomic transaction ─────────
            if (isDryRun) {
                console.log(`[migrate] [dry-run] Would apply: ${file.filename}  (checksum: ${file.checksum})`);
                result.applied.push(file.filename);
                continue;
            }

            const startMs = Date.now();
            await client.query('BEGIN');

            try {
                await client.query(file.sql);

                const executionMs = Date.now() - startMs;

                // Record INSIDE the same transaction so a runner crash after SQL
                // execution but before the INSERT cannot leave an unrecorded migration.
                await recordMigration(client, file.filename, file.checksum, executionMs);

                await client.query('COMMIT');

                console.log(
                    `[migrate] ✓ Applied   ${file.filename}  (${executionMs} ms)`,
                );
                result.applied.push(file.filename);
            } catch (err) {
                await client.query('ROLLBACK');
                console.error(`[migrate] ✗ Failed   ${file.filename}`);
                throw err; // Surface to outer try/catch; unconditionally exit(1).
            }
        }

        // ── Step 6: Abort if drift was detected at any point ──────────────────
        if (result.driftDetected.length > 0) {
            throw new Error(
                `Content drift detected in ${result.driftDetected.length} migration(s): ` +
                result.driftDetected.join(', '),
            );
        }
    } finally {
        client.release();
        await pool.end();
    }

    return result;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const isDryRun = process.argv.includes('--dry-run');

    console.log(
        `[migrate] Starting migration runner${isDryRun ? ' (DRY RUN)' : ''}`,
    );
    console.log(`[migrate] Target database: ${maskConnectionString(DATABASE_URL!)}`);

    const startMs = Date.now();

    try {
        const result = await runMigrations(isDryRun);

        const totalMs = Date.now() - startMs;

        console.log('');
        console.log('─────────────────────────────────────────');
        console.log(`[migrate] Summary  (${totalMs} ms total)`);
        console.log(`  Applied : ${result.applied.length}`);
        console.log(`  Skipped : ${result.skipped.length}`);
        console.log(`  Drift   : ${result.driftDetected.length}`);
        console.log('─────────────────────────────────────────');
        console.log('[migrate] Done.');
        process.exit(0);
    } catch (err) {
        console.error('[migrate] Migration failed:', err instanceof Error ? err.message : err);
        process.exit(1);
    }
}

/**
 * Replace the password segment of a connection URL with asterisks so it
 * is safe to print in logs.
 * e.g. postgresql://user:secret@host:5432/db → postgresql://user:***@host:5432/db
 */
function maskConnectionString(url: string): string {
    try {
        const parsed = new URL(url);
        if (parsed.password) parsed.password = '***';
        return parsed.toString();
    } catch {
        // Not a valid URL — return a fully redacted placeholder.
        return '[redacted]';
    }
}

main();
