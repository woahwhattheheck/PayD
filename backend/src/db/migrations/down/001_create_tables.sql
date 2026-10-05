-- Roll back 001_create_tables.sql
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS employees CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column();
