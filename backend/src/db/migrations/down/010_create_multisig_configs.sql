-- Roll back 010_create_multisig_configs.sql
DROP TABLE IF EXISTS multisig_signers CASCADE;
DROP TABLE IF EXISTS multisig_configs CASCADE;
