# Sequential migration filenames

The 38 SQL migrations now have one unique, contiguous sequence, `001` through
`038`. The two earliest names are unchanged; the other 36 files are pure renames.
Their SQL bytes and historical lexicographic execution order are preserved.
The two `create_contract_events` files are deliberately retained as separate
migrations: they contain different SQL and must not be treated as aliases of one
another.

## Existing databases

Upgrade the migration runner and the migration files together. The runner still
uses the existing `schema_migrations` table and records new successful migrations
in the same transaction as their SQL. Its `migrationOrder.ts` module contains the
permanent mapping from new filenames to historical filenames.

A history row under either name is authoritative only when its checksum matches
the file. Both names are checked when both are present. Existing rows, application
timestamps and execution metadata are not rewritten, and renamed migrations are
not replayed. Do not delete tracking rows or change their checksums to get past a
drift error. Resolve the underlying source/database discrepancy instead.

`--dry-run` reads existing history without creating the tracking table. On a fresh
database, it plans all migrations; on an existing database, it recognizes legacy
names and reports only pending work. All checksum drift is checked before any
pending migration SQL is executed.

This is forward compatibility, not an automatic downgrade of migration history.
Do not run the old filename-only runner against history written by the new runner.

## Adding a migration

Add `039_<description>.sql` next, then continue sequentially. Do not renumber an
existing migration or remove an entry from the legacy mapping. Duplicate, missing
or malformed prefixes are rejected before the runner opens a database connection.
The historical order is unchanged, including schedules before execution history
and contract registry before the contract-event migrations.

Older implementation notes may use the historical names. For example,
`014_create_schedules.sql` is now `021_create_schedules.sql`, and
`015_create_execution_history.sql` is now `023_create_execution_history.sql`.
Use the migration runner rather than replaying an old manual `psql -f` command;
manual SQL application does not populate the runner's tracking table.

## Focused validation

From `backend` with the normal development dependencies installed:

```sh
npm test -- --runInBand src/db/__tests__/migration-order.test.ts
```

The eight cases cover ordering, historical-name compatibility, pending work,
checksum drift, conflicting history and the two distinct contract-event files.
The existing migration-verification test retains its assertions with its two
filename references updated.

Validation during this change used Node 22.16.0 to execute the transpiled focused
test source with Node's test registration functions: 8 passed. The helper also
passed standalone strict TypeScript checking. A mocked PostgreSQL-client probe of
the actual runner reproduced one renamed-file replay before the fix and zero
after it; it also checked read-only dry-run history and drift before pending SQL.
This does not claim a live PostgreSQL migration run or a full application/Jest CI
run. SQL bodies are unchanged; validate against a database snapshot before a
production migration.
