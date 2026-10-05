CREATE TABLE IF NOT EXISTS execution_history (
  id SERIAL PRIMARY KEY,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,

  -- Execution details
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed', 'partial')),

  -- Blockchain transaction details
  transaction_hash VARCHAR(64),
  transaction_result JSONB,

  -- Error tracking
  error_message TEXT,
  error_details JSONB,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_execution_schedule_id ON execution_history(schedule_id);
CREATE INDEX idx_execution_status ON execution_history(status);
CREATE INDEX idx_execution_executed_at ON execution_history(executed_at);
