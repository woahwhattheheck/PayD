-- Roll back 024_audit_integrity_and_quotas.sql
DROP TRIGGER IF EXISTS trg_deny_audit_update ON api_audit_logs;
DROP TRIGGER IF EXISTS trg_audit_chain_hash ON api_audit_logs;
DROP FUNCTION IF EXISTS deny_audit_log_mutation();
DROP FUNCTION IF EXISTS compute_audit_chain_hash();

DROP TABLE IF EXISTS tenant_usage_snapshots CASCADE;
DROP TABLE IF EXISTS platform_admin_access_logs CASCADE;

ALTER TABLE organization_settings
  DROP COLUMN IF EXISTS quota_alert_threshold,
  DROP COLUMN IF EXISTS max_storage_mb,
  DROP COLUMN IF EXISTS max_monthly_transactions,
  DROP COLUMN IF EXISTS max_employees;

DROP INDEX IF EXISTS idx_api_audit_logs_chain_hash;
ALTER TABLE api_audit_logs
  DROP COLUMN IF EXISTS chain_hash,
  DROP COLUMN IF EXISTS row_hash;

-- Retain pgcrypto because it may predate this migration, and preserve
-- tenant configuration values instead of deleting operator-customized data.
