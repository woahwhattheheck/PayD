/**
 * Stable aliases for the one-time renumbering of the original SQL migrations.
 * SQL bodies and the historical execution order are unchanged. Keep these aliases
 * so existing schema_migrations rows remain authoritative after an upgrade.
 */
export const LEGACY_MIGRATION_FILENAMES: Readonly<Record<string, string>> = Object.freeze({
    '003_extend_employee_profiles.sql': '002_extend_employee_profiles.sql',
    '004_create_users_2fa.sql': '003_create_users_2fa.sql',
    '005_multi_tenant_rls.sql': '003_multi_tenant_rls.sql',
    '006_create_clawback_audit_logs.sql': '004_create_clawback_audit_logs.sql',
    '007_tenant_configurations.sql': '004_tenant_configurations.sql',
    '008_auth_rbac_updates.sql': '005_auth_rbac_updates.sql',
    '009_create_employee_trustlines.sql': '005_create_employee_trustlines.sql',
    '010_create_transaction_audit_logs.sql': '006_create_transaction_audit_logs.sql',
    '011_create_payroll_runs.sql': '007_create_payroll_runs.sql',
    '012_create_payroll_audit_logs.sql': '008_create_payroll_audit_logs.sql',
    '013_create_tax_tables.sql': '009_create_tax_tables.sql',
    '014_add_salary_to_employees.sql': '010_add_salary_to_employees.sql',
    '015_create_account_freeze_logs.sql': '010_create_account_freeze_logs.sql',
    '016_create_multisig_configs.sql': '010_create_multisig_configs.sql',
    '017_create_schema_migrations.sql': '011_create_schema_migrations.sql',
    '018_create_wallets.sql': '012_create_wallets.sql',
    '019_create_audit_logs.sql': '013_create_audit_logs.sql',
    '020_create_contract_registry.sql': '014_create_contract_registry.sql',
    '021_create_schedules.sql': '014_create_schedules.sql',
    '022_create_contract_events.sql': '015_create_contract_events.sql',
    '023_create_execution_history.sql': '015_create_execution_history.sql',
    '024_create_contract_events.sql': '016_create_contract_events.sql',
    '025_add_timezone_to_schedules.sql': '017_add_timezone_to_schedules.sql',
    '026_add_schedules_user_fk.sql': '018_add_schedules_user_fk.sql',
    '027_create_fx_rates.sql': '019_create_fx_rates.sql',
    '028_create_liquidity_alerts.sql': '020_create_liquidity_alerts.sql',
    '029_create_benefits_and_deductions.sql': '021_create_benefits_and_deductions.sql',
    '030_auth_oauth_support.sql': '022_auth_oauth_support.sql',
    '031_enhanced_auditing_and_monitoring.sql': '023_enhanced_auditing_and_monitoring.sql',
    '032_audit_integrity_and_quotas.sql': '024_audit_integrity_and_quotas.sql',
    '033_backend_robustness_part48.sql': '025_backend_robustness_part48.sql',
    '034_backend_robustness_part45.sql': '026_backend_robustness_part45.sql',
    '035_create_idempotency_keys.sql': '027_create_idempotency_keys.sql',
    '036_schedule_row_locking.sql': '028_schedule_row_locking.sql',
    '037_admin_two_factor_auth.sql': '029_admin_two_factor_auth.sql',
    '038_create_invitations.sql': '031_create_invitations.sql',
});

export interface MigrationIdentity {
    filename: string;
    checksum: string;
}

/** Reject ambiguous, missing or out-of-order versions before executing SQL. */
export function assertMigrationOrder(filenames: readonly string[]): void {
    filenames.forEach((filename, index) => {
        const expected = String(index + 1).padStart(3, '0');
        const match = /^(\d{3})_[a-z0-9_]+\.sql$/.exec(filename);
        if (!match || match[1] !== expected) {
            throw new Error(
                `Invalid migration order at "${filename}": expected unique sequential prefix ${expected}_.`,
            );
        }
    });
}

/**
 * Resolve both current and legacy records, checking every matching checksum.
 * Never infer that similarly named migrations are interchangeable: the two
 * historical contract_events migrations are distinct entries with distinct SQL.
 */
export function findAppliedMigration(
    file: MigrationIdentity,
    applied: ReadonlyMap<string, MigrationIdentity>,
): MigrationIdentity | undefined {
    const legacyFilename = LEGACY_MIGRATION_FILENAMES[file.filename];
    const current = applied.get(file.filename);
    const legacy = legacyFilename ? applied.get(legacyFilename) : undefined;
    for (const record of [current, legacy]) {
        if (record && record.checksum !== file.checksum) {
            throw new Error(
                `DRIFT DETECTED: "${file.filename}" was recorded as "${record.filename}" ` +
                `with checksum ${record.checksum}, but its SQL now has checksum ${file.checksum}.`,
            );
        }
    }
    return current ?? legacy;
}
