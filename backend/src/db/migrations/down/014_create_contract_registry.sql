-- Roll back 014_create_contract_registry.sql
DROP TABLE IF EXISTS contract_upgrade_logs CASCADE;
DROP TABLE IF EXISTS contract_registry CASCADE;
