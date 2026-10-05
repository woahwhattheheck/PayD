-- Roll back 015_create_contract_events.sql
DROP TABLE IF EXISTS contract_event_index_state CASCADE;
DROP TABLE IF EXISTS contract_events CASCADE;
