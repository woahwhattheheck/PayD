CREATE TABLE IF NOT EXISTS schedules (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,

  -- Schedule configuration
  frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('once', 'weekly', 'biweekly', 'monthly')),
  time_of_day TIME NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,

  -- Payment configuration (stored as JSONB for flexibility)
  payment_config JSONB NOT NULL,

  -- Execution tracking
  next_run_timestamp TIMESTAMP NOT NULL,
  last_run_timestamp TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'failed')),

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_schedules_next_run ON schedules(next_run_timestamp, status);
CREATE INDEX idx_schedules_org_id ON schedules(organization_id);
CREATE INDEX idx_schedules_status ON schedules(status);

CREATE TRIGGER update_schedules_updated_at BEFORE UPDATE ON schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
