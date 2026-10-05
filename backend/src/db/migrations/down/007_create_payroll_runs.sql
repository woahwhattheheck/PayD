-- Roll back 007_create_payroll_runs.sql
DROP TABLE IF EXISTS payroll_items CASCADE;
DROP TABLE IF EXISTS payroll_runs CASCADE;
