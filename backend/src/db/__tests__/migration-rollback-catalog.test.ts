import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../migrations');
const rollbacksDir = path.resolve(migrationsDir, 'down');

function sqlFiles(dir: string): string[] {
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
        .map((entry) => entry.name)
        .sort();
}

describe('migration rollback catalog', () => {
    it('has exactly one non-empty down migration for every forward migration', () => {
        const forward = sqlFiles(migrationsDir);
        const down = sqlFiles(rollbacksDir);

        expect(down).toEqual(forward);
        expect(forward.length).toBeGreaterThan(0);

        for (const filename of down) {
            const sql = fs.readFileSync(path.join(rollbacksDir, filename), 'utf8').trim();
            expect(sql).not.toBe('');
            expect(sql).toMatch(/\b(DROP|ALTER|DO|DELETE|UPDATE|CREATE|COMMENT)\b/i);
        }
    });
});
