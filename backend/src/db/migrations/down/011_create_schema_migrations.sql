-- Roll back 011_create_schema_migrations.sql
-- schema_migrations is a migration-runner bootstrap invariant. Remove only
-- additions made by 011 beyond the bootstrap table itself.
DROP INDEX IF EXISTS idx_schema_migrations_applied_at;
COMMENT ON TABLE schema_migrations IS NULL;
COMMENT ON COLUMN schema_migrations.checksum IS NULL;
