-- Roll back 023_enhanced_auditing_and_monitoring.sql
DROP TRIGGER IF EXISTS update_organization_settings_updated_at ON organization_settings;
DROP TABLE IF EXISTS organization_settings CASCADE;
DROP TABLE IF EXISTS rate_limit_violations CASCADE;
DROP TABLE IF EXISTS rate_limit_bypass_tokens CASCADE;
DROP TABLE IF EXISTS tenant_access_logs CASCADE;
DROP TABLE IF EXISTS sensitive_operations_audit CASCADE;
DROP TABLE IF EXISTS api_audit_logs CASCADE;

ALTER TABLE organizations
  DROP COLUMN IF EXISTS subscription_status,
  DROP COLUMN IF EXISTS subscription_tier,
  DROP COLUMN IF EXISTS is_active;
