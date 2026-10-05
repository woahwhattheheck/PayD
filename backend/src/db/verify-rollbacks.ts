/**
 * Integration verification for migration rollbacks.
 *
 * Applies every forward migration to a disposable PostgreSQL schema, then
 * executes every matching down migration in reverse order. The real database
 * schema is never modified. DATABASE_URL must point at a PostgreSQL database
 * on which the caller may CREATE/DROP SCHEMA.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv';
import pg from 'pg';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');
const ROLLBACKS_DIR = path.resolve(MIGRATIONS_DIR, 'down');

function sqlFiles(dir: string): string[] {
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
        .map((entry) => entry.name)
        .sort();
}

function quoteIdent(identifier: string): string {
    return '"' + identifier.replaceAll('"', '""') + '"';
}

async function main(): Promise<void> {
    if (!DATABASE_URL) {
        throw new Error('DATABASE_URL environment variable is not set.');
    }

    const forward = sqlFiles(MIGRATIONS_DIR);
    const down = sqlFiles(ROLLBACKS_DIR);

    if (JSON.stringify(forward) !== JSON.stringify(down)) {
        throw new Error('Forward/down migration catalogs do not match exactly.');
    }

    const schema = 'rollback_verify_' + process.pid + '_' + Date.now();
    const quotedSchema = quoteIdent(schema);
    const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
    const client = await pool.connect();

    try {
        await client.query('CREATE SCHEMA ' + quotedSchema);

        for (const filename of forward) {
            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
            await client.query('BEGIN');
            try {
                await client.query(
                    'SET LOCAL search_path TO ' + quotedSchema + ', public',
                );
                await client.query(sql);
                await client.query('COMMIT');
                console.log('[verify-rollbacks] ✓ forward ' + filename);
            } catch (error) {
                await client.query('ROLLBACK');
                throw new Error(
                    'Forward verification failed for ' +
                        filename +
                        ': ' +
                        (error instanceof Error ? error.message : String(error)),
                );
            }
        }

        for (const filename of [...forward].reverse()) {
            const sql = fs.readFileSync(path.join(ROLLBACKS_DIR, filename), 'utf8');
            await client.query('BEGIN');
            try {
                await client.query(
                    'SET LOCAL search_path TO ' + quotedSchema + ', public',
                );
                await client.query(sql);
                await client.query('COMMIT');
                console.log('[verify-rollbacks] ✓ rollback ' + filename);
            } catch (error) {
                await client.query('ROLLBACK');
                throw new Error(
                    'Rollback verification failed for ' +
                        filename +
                        ': ' +
                        (error instanceof Error ? error.message : String(error)),
                );
            }
        }

        const residue = await client.query<{ name: string }>(
            "SELECT c.relname AS name " +
                "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
                "WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm') " +
                "AND c.relname <> 'schema_migrations' ORDER BY c.relname",
            [schema],
        );

        if (residue.rows.length > 0) {
            throw new Error(
                'Rollback verification left schema objects behind: ' +
                    residue.rows.map((row) => row.name).join(', '),
            );
        }

        console.log(
            '[verify-rollbacks] PASS: ' +
                forward.length +
                ' forward/down pairs executed in a disposable schema',
        );
    } finally {
        await client.query('DROP SCHEMA IF EXISTS ' + quotedSchema + ' CASCADE');
        client.release();
        await pool.end();
    }
}

main().catch((error) => {
    console.error(
        '[verify-rollbacks] FAILED:',
        error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
});
