/**
 * Production PostgreSQL migration runner with transactional single-step rollback.
 *
 * Usage:
 *   ts-node src/db/migrate.ts
 *   ts-node src/db/migrate.ts --dry-run
 *   ts-node src/db/migrate.ts --rollback
 *   ts-node src/db/migrate.ts --rollback --dry-run
 *
 * Unsupported arguments are rejected before a database connection is opened.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv';
import pg from 'pg';

const { Pool } = pg;
type PoolClient = pg.PoolClient;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');
const ROLLBACKS_DIR = path.resolve(MIGRATIONS_DIR, 'down');

const BOOTSTRAP_SQL = [
    'CREATE TABLE IF NOT EXISTS schema_migrations (',
    '  id SERIAL PRIMARY KEY,',
    '  filename VARCHAR(255) NOT NULL UNIQUE,',
    '  checksum CHAR(64) NOT NULL,',
    '  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
    '  applied_by VARCHAR(255) NOT NULL DEFAULT current_user,',
    '  execution_ms INTEGER CHECK (execution_ms >= 0)',
    ');',
    'CREATE INDEX IF NOT EXISTS idx_schema_migrations_filename',
    '  ON schema_migrations (filename);',
].join('\n');

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

interface RunResult {
    applied: string[];
    skipped: string[];
    driftDetected: string[];
}

interface RollbackResult {
    rolledBack: string | null;
}

function requireDatabaseUrl(): string {
    if (!DATABASE_URL) {
        throw new Error('DATABASE_URL environment variable is not set.');
    }
    return DATABASE_URL;
}

function sha256(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function readMigrationFiles(dir: string): MigrationFile[] {
    if (!fs.existsSync(dir)) {
        throw new Error('Migrations directory not found: ' + dir);
    }

    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
        .map((entry) => entry.name)
        .sort()
        .map((filename) => {
            const absolutePath = path.join(dir, filename);
            const sql = fs.readFileSync(absolutePath, 'utf8');
            return { filename, absolutePath, sql, checksum: sha256(sql) };
        });
}

function validateRollbackCatalog(): void {
    const forward = readMigrationFiles(MIGRATIONS_DIR).map((file) => file.filename);

    if (!fs.existsSync(ROLLBACKS_DIR)) {
        throw new Error('Rollback directory not found: ' + ROLLBACKS_DIR);
    }

    const down = fs
        .readdirSync(ROLLBACKS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
        .map((entry) => entry.name)
        .sort();

    const missing = forward.filter((filename) => !down.includes(filename));
    const orphaned = down.filter((filename) => !forward.includes(filename));

    if (missing.length > 0 || orphaned.length > 0) {
        const details = [
            missing.length > 0 ? 'missing down migrations: ' + missing.join(', ') : '',
            orphaned.length > 0 ? 'orphaned down migrations: ' + orphaned.join(', ') : '',
        ]
            .filter(Boolean)
            .join('; ');
        throw new Error('Migration rollback catalog is inconsistent: ' + details);
    }
}

function readRollbackSql(filename: string): string {
    if (path.basename(filename) !== filename) {
        throw new Error('Invalid migration filename in schema_migrations: ' + filename);
    }

    const absolutePath = path.join(ROLLBACKS_DIR, filename);
    if (!fs.existsSync(absolutePath)) {
        throw new Error('Missing rollback migration for ' + filename);
    }

    const sql = fs.readFileSync(absolutePath, 'utf8').trim();
    if (!sql) {
        throw new Error('Rollback migration is empty: ' + filename);
    }
    return sql;
}

async function fetchAppliedMigrations(
    client: PoolClient,
): Promise<Map<string, AppliedMigration>> {
    const { rows } = await client.query<AppliedMigration>(
        'SELECT filename, checksum FROM schema_migrations ORDER BY id',
    );
    return new Map(rows.map((row) => [row.filename, row]));
}

async function fetchLatestAppliedMigration(
    client: PoolClient,
    lockForUpdate = false,
): Promise<AppliedMigration | null> {
    const lockClause = lockForUpdate ? ' FOR UPDATE' : '';
    const { rows } = await client.query<AppliedMigration>(
        'SELECT filename, checksum FROM schema_migrations ORDER BY id DESC LIMIT 1' +
            lockClause,
    );
    return rows[0] ?? null;
}

async function trackingTableExists(client: PoolClient): Promise<boolean> {
    const { rows } = await client.query<{ relation: string | null }>(
        "SELECT to_regclass('schema_migrations')::text AS relation",
    );
    return rows[0]?.relation !== null && rows[0]?.relation !== undefined;
}

async function recordMigration(
    client: PoolClient,
    filename: string,
    checksum: string,
    executionMs: number,
): Promise<void> {
    await client.query(
        'INSERT INTO schema_migrations (filename, checksum, execution_ms) VALUES ($1, $2, $3)',
        [filename, checksum, executionMs],
    );
}

function createPool(): pg.Pool {
    return new Pool({
        connectionString: requireDatabaseUrl(),
        max: 1,
        idleTimeoutMillis: 5_000,
        connectionTimeoutMillis: 10_000,
    });
}

async function runMigrations(isDryRun: boolean): Promise<RunResult> {
    validateRollbackCatalog();

    const pool = createPool();
    const client = await pool.connect();
    const result: RunResult = { applied: [], skipped: [], driftDetected: [] };

    try {
        if (!isDryRun) {
            await client.query(BOOTSTRAP_SQL);
            console.log('[migrate] ✓ schema_migrations table ready');
        } else {
            console.log('[migrate] [dry-run] Would bootstrap schema_migrations table');
        }

        const files = readMigrationFiles(MIGRATIONS_DIR);
        console.log(
            '[migrate] Found ' +
                files.length +
                ' forward migration file(s) and matching rollback files',
        );

        if (files.length === 0) {
            return result;
        }

        const applied = isDryRun
            ? new Map<string, AppliedMigration>()
            : await fetchAppliedMigrations(client);

        for (const file of files) {
            const record = applied.get(file.filename);

            if (record) {
                if (record.checksum !== file.checksum) {
                    result.driftDetected.push(file.filename);
                    console.error(
                        '[migrate] DRIFT DETECTED: ' +
                            file.filename +
                            ' expected ' +
                            record.checksum +
                            ' but current file is ' +
                            file.checksum,
                    );
                    continue;
                }

                result.skipped.push(file.filename);
                console.log('[migrate] ↷ Skipped  ' + file.filename + '  (already applied)');
                continue;
            }

            if (isDryRun) {
                result.applied.push(file.filename);
                console.log(
                    '[migrate] [dry-run] Would apply: ' +
                        file.filename +
                        '  (checksum: ' +
                        file.checksum +
                        ')',
                );
                continue;
            }

            const startedAt = Date.now();
            await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
            try {
                await client.query(file.sql);
                const executionMs = Date.now() - startedAt;
                await recordMigration(client, file.filename, file.checksum, executionMs);
                await client.query('COMMIT');
                result.applied.push(file.filename);
                console.log(
                    '[migrate] ✓ Applied   ' +
                        file.filename +
                        '  (' +
                        executionMs +
                        ' ms)',
                );
            } catch (error) {
                await client.query('ROLLBACK');
                console.error('[migrate] ✗ Failed   ' + file.filename);
                throw error;
            }
        }

        if (result.driftDetected.length > 0) {
            throw new Error(
                'Content drift detected in ' +
                    result.driftDetected.length +
                    ' migration(s): ' +
                    result.driftDetected.join(', '),
            );
        }

        return result;
    } finally {
        client.release();
        await pool.end();
    }
}

async function runRollback(isDryRun: boolean): Promise<RollbackResult> {
    validateRollbackCatalog();

    const pool = createPool();
    const client = await pool.connect();

    try {
        if (isDryRun) {
            if (!(await trackingTableExists(client))) {
                console.log('[migrate] [dry-run] No schema_migrations table; nothing to roll back.');
                return { rolledBack: null };
            }

            const latest = await fetchLatestAppliedMigration(client);
            if (!latest) {
                console.log('[migrate] No applied migrations to roll back.');
                return { rolledBack: null };
            }

            const forwardPath = path.join(MIGRATIONS_DIR, latest.filename);
            if (!fs.existsSync(forwardPath)) {
                throw new Error(
                    'Applied migration file is missing from the repository: ' + latest.filename,
                );
            }

            const currentChecksum = sha256(fs.readFileSync(forwardPath, 'utf8'));
            if (currentChecksum !== latest.checksum) {
                throw new Error(
                    'Refusing rollback because forward migration drifted: ' +
                        latest.filename +
                        ' expected ' +
                        latest.checksum +
                        ' but current file is ' +
                        currentChecksum,
                );
            }

            readRollbackSql(latest.filename);
            console.log('[migrate] [dry-run] Would roll back: ' + latest.filename);
            return { rolledBack: latest.filename };
        }

        await client.query(BOOTSTRAP_SQL);
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

        try {
            // Lock the exact tracking row before choosing the rollback target so
            // two rollback runners cannot both act on the same migration.
            const latest = await fetchLatestAppliedMigration(client, true);
            if (!latest) {
                await client.query('COMMIT');
                console.log('[migrate] No applied migrations to roll back.');
                return { rolledBack: null };
            }

            const forwardPath = path.join(MIGRATIONS_DIR, latest.filename);
            if (!fs.existsSync(forwardPath)) {
                throw new Error(
                    'Applied migration file is missing from the repository: ' + latest.filename,
                );
            }

            const currentChecksum = sha256(fs.readFileSync(forwardPath, 'utf8'));
            if (currentChecksum !== latest.checksum) {
                throw new Error(
                    'Refusing rollback because forward migration drifted: ' +
                        latest.filename +
                        ' expected ' +
                        latest.checksum +
                        ' but current file is ' +
                        currentChecksum,
                );
            }

            const rollbackSql = readRollbackSql(latest.filename);
            await client.query(rollbackSql);

            const deleted = await client.query(
                'DELETE FROM schema_migrations WHERE filename = $1 AND checksum = $2',
                [latest.filename, latest.checksum],
            );

            if (deleted.rowCount !== 1) {
                throw new Error(
                    'Rollback tracking row changed concurrently for ' + latest.filename,
                );
            }

            await client.query('COMMIT');
            console.log('[migrate] ✓ Rolled back ' + latest.filename);
            return { rolledBack: latest.filename };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('[migrate] ✗ Rollback failed');
            throw error;
        }
    } finally {
        client.release();
        await pool.end();
    }
}

function maskConnectionString(url: string): string {
    try {
        const parsed = new URL(url);
        if (parsed.password) {
            parsed.password = '***';
        }
        return parsed.toString();
    } catch {
        return '[redacted]';
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== '--dry-run' && arg !== '--rollback')) {
        throw new Error(
            'Unsupported argument. Use no arguments, --dry-run, --rollback, or --rollback --dry-run.',
        );
    }

    const databaseUrl = requireDatabaseUrl();
    const isDryRun = args.includes('--dry-run');
    const isRollback = args.includes('--rollback');

    console.log(
        '[migrate] Starting migration runner' +
            (isRollback ? ' (ROLLBACK)' : '') +
            (isDryRun ? ' (DRY RUN)' : ''),
    );
    console.log('[migrate] Target database: ' + maskConnectionString(databaseUrl));

    const startedAt = Date.now();

    if (isRollback) {
        const result = await runRollback(isDryRun);
        console.log(
            '[migrate] Summary (' +
                (Date.now() - startedAt) +
                ' ms): rolled back ' +
                (result.rolledBack ?? 'nothing'),
        );
        return;
    }

    const result = await runMigrations(isDryRun);
    console.log('');
    console.log('─────────────────────────────────────────');
    console.log('[migrate] Summary  (' + (Date.now() - startedAt) + ' ms total)');
    console.log('  Applied : ' + result.applied.length);
    console.log('  Skipped : ' + result.skipped.length);
    console.log('  Drift   : ' + result.driftDetected.length);
    console.log('─────────────────────────────────────────');
}

main().catch((error) => {
    console.error(
        '[migrate] Migration failed:',
        error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
});
