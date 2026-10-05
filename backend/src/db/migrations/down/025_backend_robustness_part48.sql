-- Roll back 025_backend_robustness_part48.sql
DROP FUNCTION IF EXISTS cleanup_old_audit_logs();

DROP TRIGGER IF EXISTS update_org_rate_limits_updated_at ON organization_rate_limits;
DROP TRIGGER IF EXISTS update_rate_limit_bypass_updated_at ON rate_limit_bypass_credentials;
DROP TRIGGER IF EXISTS update_rate_limit_tracking_updated_at ON rate_limit_tracking;

DROP TABLE IF EXISTS audit_retention_policies CASCADE;
DROP TABLE IF EXISTS organization_rate_limits CASCADE;
DROP TABLE IF EXISTS security_events CASCADE;
DROP TABLE IF EXISTS tenant_access_monitoring CASCADE;
DROP TABLE IF EXISTS rate_limit_bypass_credentials CASCADE;
DROP TABLE IF EXISTS rate_limit_tracking CASCADE;
DROP TABLE IF EXISTS critical_operations_audit CASCADE;
DROP TABLE IF EXISTS request_audit_logs CASCADE;
