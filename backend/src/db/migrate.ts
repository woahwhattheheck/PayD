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
 *   Only --dry-run is supported; --rollback and unknown arguments are rejected.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv';
import pg from 'pg';
import { assertMigrationOrder, findAppliedMigration } from './migrationOrder.js';

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
        .sort(); // Numeric prefixes are fixed-width and checked below.
    assertMigrationOrder(files);

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
    // Refuse duplicate/gapped prefixes before opening a database connection.
    const files = readMigrationFiles(MIGRATIONS_DIR);
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

        // ── Step 2: Report the validated migration files ──────────────────────
        console.log(`[migrate] Found ${files.length} migration file(s) in ${MIGRATIONS_DIR}`);

        if (files.length === 0) {
            console.log('[migrate] Nothing to do.');
            return result;
        }

        // ── Step 3: Fetch already-applied set (O(m) time / space) ─────────────
        const applied = await fetchAppliedMigrations(client).catch((err: unknown) => {
            // A dry run against a fresh database must not create the tracking table.
            if (isDryRun && (err as { code?: string } | null)?.code === '42P01') {
                return new Map<string, AppliedMigration>();
            }
            throw err;
        });

        // Preflight all current AND legacy records before running any pending SQL.
        // A renumbered filename must never cause already-applied SQL to run again.
        const recorded = new Map<string, AppliedMigration>();
        for (const file of files) {
            try {
                const record = findAppliedMigration(file, applied);
                if (record) recorded.set(file.filename, record);
            } catch (err) {
                console.error('[migrate]', err instanceof Error ? err.message : err);
                result.driftDetected.push(file.filename);
            }
        }
        if (result.driftDetected.length > 0) {
            throw new Error(
                `Content drift detected in ${result.driftDetected.length} migration(s): ` +
                result.driftDetected.join(', '),
            );
        }

        // ── Step 4: Evaluate each migration ───────────────────────────────────
        for (const file of files) {
            const record = recorded.get(file.filename);
            if (record) {
                console.log(`[migrate] ↷ Skipped  ${file.filename}  (recorded as ${record.filename})`);
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

    } finally {
        client.release();
        await pool.end();
    }

    return result;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== '--dry-run')) {
        console.error(
            '[migrate] Unsupported argument. Use no arguments to apply migrations or --dry-run to plan; rollback is not implemented.',
        );
        process.exit(1);
    }
    const isDryRun = args.includes('--dry-run');

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
