-- Persist webhook subscriptions so they survive restarts and are visible to every API replica.
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id UUID PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url TEXT NOT NULL CHECK (char_length(url) > 0),
  secret TEXT NOT NULL CHECK (char_length(secret) >= 16),
  events TEXT[] NOT NULL DEFAULT ARRAY['*']::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT webhook_subscriptions_events_not_empty CHECK (cardinality(events) > 0)
);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_organization_id
  ON webhook_subscriptions (organization_id);

-- Dispatch matches an exact event or wildcard subscription with array containment.
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_events
  ON webhook_subscriptions USING GIN (events);

DROP TRIGGER IF EXISTS update_webhook_subscriptions_updated_at ON webhook_subscriptions;
CREATE TRIGGER update_webhook_subscriptions_updated_at
  BEFORE UPDATE ON webhook_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
