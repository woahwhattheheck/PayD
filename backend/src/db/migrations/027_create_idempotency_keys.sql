-- Idempotency keys table for write-path deduplication.
-- Scoped to tenant (organization_id) so two orgs using the same key don't collide.
-- TTL is enforced at the application layer; the index supports efficient lookup.

CREATE TABLE IF NOT EXISTS idempotency_keys (
    id              SERIAL       PRIMARY KEY,
    organization_id INTEGER      NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(255) NOT NULL,
    status          VARCHAR(20)  NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress', 'completed', 'failed')),
    response_status INTEGER,
    response_body   JSONB,
    -- A random UUID identifies a specific claim generation. Expiration alone
    -- is NOT unique: a failed key can be reclaimed within the same millisecond.
    lease_token     UUID,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ  NOT NULL,
    UNIQUE (organization_id, idempotency_key)
);

-- Existing installations of this table may predate per-generation tokens.
-- Legacy completed results can still replay; every NEW claim sets its token.
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS lease_token UUID;

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_lookup
    ON idempotency_keys (organization_id, idempotency_key, expires_at);

-- Support efficient TTL cleanup scans; expiration is enforced by queries.
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires
    ON idempotency_keys (expires_at);
