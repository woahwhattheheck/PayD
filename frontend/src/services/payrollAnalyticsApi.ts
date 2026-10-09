import axios from 'axios';

const configuredApiBase =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  'http://localhost:3001';
const normalizedApiBase = configuredApiBase.replace(/\/$/, '');
const apiRoot = normalizedApiBase.endsWith('/api')
  ? normalizedApiBase
  : `${normalizedApiBase}/api`;

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

export async function getPayrollAnalytics(): Promise<PayrollAnalytics> {
  const token = localStorage.getItem('payd_auth_token') || localStorage.getItem('accessToken');
  const { data } = await axios.get<{ success: boolean; data: PayrollAnalytics }>(
    `${apiRoot}/payroll/analytics`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }
  );
  if (!data.success || !data.data) {
    throw new Error('Payroll analytics could not be loaded');
  }
  return data.data;
}
