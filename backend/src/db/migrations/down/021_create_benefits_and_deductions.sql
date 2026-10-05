-- Roll back 021_create_benefits_and_deductions.sql
DROP TABLE IF EXISTS deduction_rules CASCADE;
DROP TABLE IF EXISTS employee_benefit_enrollments CASCADE;
DROP TABLE IF EXISTS benefit_plans CASCADE;
