import assert from 'node:assert/strict';
import {
    assertMigrationOrder,
    findAppliedMigration,
    LEGACY_MIGRATION_FILENAMES,
} from '../migrationOrder.js';
import type { MigrationIdentity } from '../migrationOrder.js';

const identity = (filename: string, checksum = 'unchanged'): MigrationIdentity => ({ filename, checksum });
const history = (...records: MigrationIdentity[]) => new Map(records.map((record) => [record.filename, record]));

describe('migration order and legacy history', () => {
    it('rejects duplicate versions, gaps and malformed names', () => {
        for (const names of [
            ['001_first.sql', '001_second.sql'],
            ['001_first.sql', '003_third.sql'],
            ['first.sql'],
        ]) {
            assert.throws(() => assertMigrationOrder(names), /unique sequential prefix/);
        }
        assert.doesNotThrow(() => assertMigrationOrder(['001_first.sql', '002_second.sql']));
    });

    it('keeps all 38 historical migrations ordered with one-to-one aliases', () => {
        const names = ['001_create_tables.sql', '002_add_deleted_at_to_employees.sql', ...Object.keys(LEGACY_MIGRATION_FILENAMES)].sort();
        assert.equal(names.length, 38);
        assertMigrationOrder(names);
        assert.equal(new Set(Object.values(LEGACY_MIGRATION_FILENAMES)).size, 36);
        for (const [current, legacy] of Object.entries(LEGACY_MIGRATION_FILENAMES)) {
            const record = identity(legacy);
            assert.equal(findAppliedMigration(identity(current), history(record)), record);
        }
    });

    it('retains existing history and skips an already-applied renamed migration', () => {
        const old = identity('014_create_schedules.sql');
        const applied = history(old);
        assert.equal(findAppliedMigration(identity('021_create_schedules.sql'), applied), old);
        assert.equal(applied.size, 1);
        assert.equal(applied.get(old.filename), old);
    });

    it('leaves missing migrations pending for fresh and partially migrated databases', () => {
        const file = identity('021_create_schedules.sql');
        assert.equal(findAppliedMigration(file, history()), undefined);
        assert.equal(findAppliedMigration(file, history(identity('001_create_tables.sql'))), undefined);
    });

    it('rejects checksum drift under a historical filename', () => {
        assert.throws(
            () => findAppliedMigration(identity('021_create_schedules.sql', 'changed'), history(identity('014_create_schedules.sql'))),
            /DRIFT DETECTED.*014_create_schedules/,
        );
    });

    it('checks both current and legacy records rather than hiding conflicting history', () => {
        const file = identity('021_create_schedules.sql');
        assert.throws(
            () => findAppliedMigration(file, history(file, identity('014_create_schedules.sql', 'different'))),
            /DRIFT DETECTED/,
        );
        assert.equal(findAppliedMigration(file, history(file, identity('014_create_schedules.sql'))), file);
    });

    it('does not conflate the two distinct contract_events migrations', () => {
        const applied = history(identity('015_create_contract_events.sql', 'first'));
        assert.ok(findAppliedMigration(identity('022_create_contract_events.sql', 'first'), applied));
        assert.equal(findAppliedMigration(identity('024_create_contract_events.sql', 'second'), applied), undefined);
    });

    it('keeps new canonical history usable without a legacy record', () => {
        const file = identity('039_next_change.sql');
        assert.equal(findAppliedMigration(file, history(file)), file);
    });
});
