-- Roll back 026_backend_robustness_part45.sql
DROP VIEW IF EXISTS v_tenant_security_summary;
DROP VIEW IF EXISTS v_organization_rate_status;

DROP TRIGGER IF EXISTS check_behavior_on_violation ON rate_limit_violations;
DROP FUNCTION IF EXISTS check_and_restrict_organization();
DROP FUNCTION IF EXISTS calculate_behavior_score(INTEGER);

DROP TRIGGER IF EXISTS update_tenant_access_patterns_updated_at ON tenant_access_patterns;
DROP TRIGGER IF EXISTS update_smart_rate_limit_configs_updated_at ON smart_rate_limit_configs;

DROP TABLE IF EXISTS tenant_access_patterns CASCADE;
DROP TABLE IF EXISTS rate_limit_recovery_log CASCADE;
DROP TABLE IF EXISTS audit_log_aggregation_cache CASCADE;
DROP TABLE IF EXISTS tenant_security_events CASCADE;
DROP TABLE IF EXISTS smart_rate_limit_configs CASCADE;
DROP TABLE IF EXISTS audit_analytics CASCADE;
