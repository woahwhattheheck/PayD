-- Roll back 012_create_wallets.sql
DROP VIEW IF EXISTS active_employee_wallets;
DROP FUNCTION IF EXISTS validate_wallet_employee_org();
DROP TABLE IF EXISTS wallets CASCADE;
