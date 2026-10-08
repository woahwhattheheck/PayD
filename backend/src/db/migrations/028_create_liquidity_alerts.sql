CREATE TABLE IF NOT EXISTS liquidity_alerts (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
  alert_type VARCHAR(30) NOT NULL CHECK (alert_type IN ('insufficient_liquidity')),
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('yellow', 'red')),
  required_amount DECIMAL(20, 7) NOT NULL,
  available_amount DECIMAL(20, 7) NOT NULL,
  shortfall_amount DECIMAL(20, 7) NOT NULL,
  next_run_timestamp TIMESTAMP NOT NULL,
  asset_code VARCHAR(12) NOT NULL,
  asset_issuer VARCHAR(56) NOT NULL DEFAULT '',
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_liquidity_alerts_org_next_run
  ON liquidity_alerts (organization_id, next_run_timestamp);

CREATE INDEX IF NOT EXISTS idx_liquidity_alerts_schedule
  ON liquidity_alerts (schedule_id);

CREATE TRIGGER update_liquidity_alerts_updated_at BEFORE UPDATE ON liquidity_alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
