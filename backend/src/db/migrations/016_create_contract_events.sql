-- Reconcile the two contract-event schemas that are installed in sequence.
--
-- Migration 015 already creates contract_events for ContractEventIndexerService
-- (event_id / tx_hash / contract_event_index_state). The newer
-- ContractEventIndexer and ContractEventController use the organization-scoped
-- columns below. CREATE TABLE IF NOT EXISTS cannot evolve the table created by
-- 015, so add the newer surface explicitly while retaining the older one.
--
-- Keep columns used by only one writer nullable: both indexers are still active
-- in the application and must be able to insert into this shared compatibility
-- table without fabricating fields owned by the other ingestion path.
ALTER TABLE contract_events
  ALTER COLUMN event_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS organization_id INTEGER
    REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS transaction_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS event_index INTEGER,
  ADD COLUMN IF NOT EXISTS ledger_closed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Uniqueness for the organization-scoped indexer. Rows written by the older
-- event_id-based indexer leave these newer identity columns NULL and remain
-- governed by uq_contract_events_event_id from migration 015.
CREATE UNIQUE INDEX IF NOT EXISTS unique_event
  ON contract_events (contract_id, transaction_hash, event_index);

-- Indexes for efficient querying by the organization-scoped API.
CREATE INDEX IF NOT EXISTS idx_contract_events_contract_id
  ON contract_events(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_events_event_type
  ON contract_events(event_type);
CREATE INDEX IF NOT EXISTS idx_contract_events_ledger_sequence
  ON contract_events(ledger_sequence);
CREATE INDEX IF NOT EXISTS idx_contract_events_org_id
  ON contract_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_contract_events_indexed_at
  ON contract_events(indexed_at DESC);
CREATE INDEX IF NOT EXISTS idx_contract_events_payload
  ON contract_events USING GIN (payload);

-- Create indexer state table to track last indexed ledger.
CREATE TABLE IF NOT EXISTS indexer_state (
  id SERIAL PRIMARY KEY,
  indexer_name VARCHAR(100) UNIQUE NOT NULL,
  last_indexed_ledger BIGINT NOT NULL,
  last_indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
  error_message TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert initial state for contract event indexer.
INSERT INTO indexer_state (indexer_name, last_indexed_ledger, status)
VALUES ('contract_event_indexer', 0, 'active')
ON CONFLICT (indexer_name) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_indexer_state_name
  ON indexer_state(indexer_name);
