-- Roll back 009_create_tax_tables.sql
DROP TABLE IF EXISTS tax_reports CASCADE;
DROP TABLE IF EXISTS tax_rules CASCADE;
