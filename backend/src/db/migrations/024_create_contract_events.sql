-- Create contract_events table for indexing Soroban contract events
CREATE TABLE IF NOT EXISTS contract_events (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Contract and event identification
  contract_id VARCHAR(56) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  
  -- Event data
  payload JSONB NOT NULL,
  
  -- Blockchain metadata
  ledger_sequence BIGINT NOT NULL,
  transaction_hash VARCHAR(64) NOT NULL,
  event_index INTEGER NOT NULL,
  
  -- Timestamps
  ledger_closed_at TIMESTAMP NOT NULL,
  indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Unique constraint to prevent duplicate events
  CONSTRAINT unique_event UNIQUE (contract_id, transaction_hash, event_index)
);

-- Indexes for efficient querying
CREATE INDEX idx_contract_events_contract_id ON contract_events(contract_id);
CREATE INDEX idx_contract_events_event_type ON contract_events(event_type);
CREATE INDEX idx_contract_events_ledger_sequence ON contract_events(ledger_sequence);
CREATE INDEX idx_contract_events_org_id ON contract_events(organization_id);
CREATE INDEX idx_contract_events_indexed_at ON contract_events(indexed_at DESC);
CREATE INDEX idx_contract_events_payload ON contract_events USING GIN (payload);

-- Create indexer state table to track last indexed ledger
CREATE TABLE IF NOT EXISTS indexer_state (
  id SERIAL PRIMARY KEY,
  indexer_name VARCHAR(100) UNIQUE NOT NULL,
  last_indexed_ledger BIGINT NOT NULL,
  last_indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
  error_message TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert initial state for contract event indexer
INSERT INTO indexer_state (indexer_name, last_indexed_ledger, status)
VALUES ('contract_event_indexer', 0, 'active')
ON CONFLICT (indexer_name) DO NOTHING;

CREATE INDEX idx_indexer_state_name ON indexer_state(indexer_name);
