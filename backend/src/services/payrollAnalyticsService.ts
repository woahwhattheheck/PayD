import { pool } from '../config/database.js';

/**
 * Completed real payroll transactions, grouped in PostgreSQL (not synthetic
 * forecast points). Every query is restricted to the caller's verified tenant.
 *
 * Never add monetary amounts from different asset codes: the UI filters to one
 * selected currency before drawing an amount-based trend or department chart.
 * The currency breakdown reports transaction *counts*, not mixed-asset sums.
 */
export interface PayrollMonthlyRow {
  month: string;
  currency: string;
  total: string;
}
export interface PayrollCurrencyRow {
  currency: string;
  paymentCount: string;
}
export interface PayrollDepartmentRow {
  department: string;
  currency: string;
  total: string;
}
export interface PayrollAnalytics {
  monthly: PayrollMonthlyRow[];
  currencies: PayrollCurrencyRow[];
  departments: PayrollDepartmentRow[];
  windowMonths: 12;
}

export async function getPayrollAnalytics(organizationId: number): Promise<PayrollAnalytics> {
  if (!Number.isSafeInteger(organizationId) || organizationId < 1) {
    throw new TypeError('Authenticated organization ID must be a positive integer');
  }
  const periodStart =
    "date_trunc('month', CURRENT_TIMESTAMP) - INTERVAL '11 months'";

  // Include 12 calendar months including the current month. Only settled
  // outbound payroll payments and bonuses count; exclude failed/refunded items.
  const [monthly, currency, department] = await Promise.all([
    pool.query<PayrollMonthlyRow>(
      `SELECT to_char(date_trunc('month', t.created_at), 'YYYY-MM') AS month,
              t.asset_code AS currency,
              SUM(t.amount)::text AS total
         FROM transactions t
        WHERE t.organization_id = $1
          AND t.status = 'completed'
          AND t.transaction_type IN ('payment', 'bonus')
          AND t.created_at >= ${periodStart}
        GROUP BY date_trunc('month', t.created_at), t.asset_code
        ORDER BY date_trunc('month', t.created_at), t.asset_code`,
      [organizationId]
    ),
    pool.query<PayrollCurrencyRow>(
      `SELECT t.asset_code AS currency,
              COUNT(*)::text AS "paymentCount"
         FROM transactions t
        WHERE t.organization_id = $1
          AND t.status = 'completed'
          AND t.transaction_type IN ('payment', 'bonus')
          AND t.created_at >= ${periodStart}
        GROUP BY t.asset_code
        ORDER BY t.asset_code`,
      [organizationId]
    ),
    pool.query<PayrollDepartmentRow>(
      `SELECT COALESCE(NULLIF(BTRIM(e.department), ''), 'Unassigned') AS department,
              t.asset_code AS currency,
              SUM(t.amount)::text AS total
         FROM transactions t
         LEFT JOIN employees e
           ON e.id = t.employee_id AND e.organization_id = t.organization_id
        WHERE t.organization_id = $1
          AND t.status = 'completed'
          AND t.transaction_type IN ('payment', 'bonus')
          AND t.created_at >= ${periodStart}
        GROUP BY COALESCE(NULLIF(BTRIM(e.department), ''), 'Unassigned'), t.asset_code
        ORDER BY department, t.asset_code`,
      [organizationId]
    ),
  ]);

  return {
    monthly: monthly.rows,
    currencies: currency.rows,
    departments: department.rows,
    windowMonths: 12,
  };
}
