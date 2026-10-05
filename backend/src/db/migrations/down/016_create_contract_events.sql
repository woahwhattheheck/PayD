-- Roll back 016_create_contract_events.sql
-- 015_create_contract_events.sql owns contract_events itself. Migration 016
-- layers legacy indexes and indexer_state on top of that earlier table.
DROP TABLE IF EXISTS indexer_state CASCADE;
DROP INDEX IF EXISTS idx_contract_events_payload;
DROP INDEX IF EXISTS idx_contract_events_indexed_at;
DROP INDEX IF EXISTS idx_contract_events_org_id;
DROP INDEX IF EXISTS idx_contract_events_ledger_sequence;
DROP INDEX IF EXISTS idx_contract_events_event_type;
DROP INDEX IF EXISTS idx_contract_events_contract_id;
