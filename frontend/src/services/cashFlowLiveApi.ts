import api from '../utils/api';
import type {
  AlertsResponse,
  BudgetAlert,
  CashFlowForecast,
  ForecastParams,
  ForecastResponse,
  HistoricalDataResponse,
  HistoricalPayrollData,
  ProjectionsResponse,
  UpcomingPayrollProjection,
} from './cashFlowForecastApi';

export type {
  BudgetAlert,
  CashFlowForecast,
  ForecastParams,
  HistoricalPayrollData,
  UpcomingPayrollProjection,
} from './cashFlowForecastApi';

export async function getForecast(params: ForecastParams): Promise<CashFlowForecast> {
  const { data } = await api.get<ForecastResponse>('/cash-flow/forecast', {
    params: {
      forecastDays: params.forecastDays || 90,
      distributionAccount: params.distributionAccount,
      assetIssuer: params.assetIssuer,
    },
  });

  if (!data.success) throw new Error('Failed to fetch forecast');
  return data.data;
}

export async function getHistoricalData(
  monthsBack: number = 6
): Promise<{
  historical: HistoricalPayrollData[];
  averages: { weekly: number; biweekly: number; monthly: number };
}> {
  const { data } = await api.get<HistoricalDataResponse>('/cash-flow/historical', {
    params: { monthsBack },
  });

  if (!data.success) throw new Error('Failed to fetch historical data');
  return data.data;
}

export async function getProjections(
  forecastDays: number = 90
): Promise<UpcomingPayrollProjection[]> {
  const { data } = await api.get<ProjectionsResponse>('/cash-flow/projections', {
    params: { forecastDays },
  });

  if (!data.success) throw new Error('Failed to fetch projections');
  return data.data;
}

export async function getAlerts(
  params: ForecastParams
): Promise<{
  alerts: BudgetAlert[];
  summary: { totalAlerts: number; criticalAlerts: number; warningAlerts: number };
}> {
  const { data } = await api.get<AlertsResponse>('/cash-flow/alerts', {
    params: {
      forecastDays: params.forecastDays || 90,
      distributionAccount: params.distributionAccount,
      assetIssuer: params.assetIssuer,
    },
  });

  if (!data.success) throw new Error('Failed to fetch alerts');
  return data.data;
}
