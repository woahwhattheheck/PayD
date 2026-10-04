-- Keep the original audit-log migration checksum while selecting the core
-- inet_ops class, which supports the documented IP/subnet investigation queries.
-- A single DO statement also keeps replacement atomic outside the migration runner.
DO $$
BEGIN
  DROP INDEX IF EXISTS idx_audit_logs_actor_ip;
  CREATE INDEX idx_audit_logs_actor_ip
    ON audit_logs USING GIST (actor_ip pg_catalog.inet_ops)
    WHERE actor_ip IS NOT NULL;
END;
$$;
