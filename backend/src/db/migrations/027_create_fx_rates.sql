CREATE TABLE IF NOT EXISTS fx_rates (
  id SERIAL PRIMARY KEY,
  base_currency VARCHAR(12) NOT NULL,
  quote_currency VARCHAR(12) NOT NULL,
  rate DECIMAL(20, 10) NOT NULL,
  rate_date DATE NOT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (base_currency, quote_currency, rate_date)
);

CREATE INDEX IF NOT EXISTS idx_fx_rates_pair_date
  ON fx_rates (base_currency, quote_currency, rate_date);

CREATE TRIGGER update_fx_rates_updated_at BEFORE UPDATE ON fx_rates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
