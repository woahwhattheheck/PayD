-- Roll back 004_tenant_configurations.sql
DROP FUNCTION IF EXISTS set_tenant_config(VARCHAR, JSONB, TEXT);
DROP FUNCTION IF EXISTS get_tenant_config(VARCHAR);
DROP TABLE IF EXISTS tenant_configurations CASCADE;
