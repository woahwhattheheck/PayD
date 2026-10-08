-- Persist webhook subscriptions so all backend replicas share the same tenant-scoped registry.
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id UUID PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT ARRAY['*']::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_org_id
  ON webhook_subscriptions (organization_id);

COMMENT ON TABLE webhook_subscriptions IS
  'Tenant-scoped outbound webhook subscriptions shared by all backend replicas.';
