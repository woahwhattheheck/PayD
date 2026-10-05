-- Roll back 027_create_idempotency_keys.sql
DROP TABLE IF EXISTS idempotency_keys CASCADE;
