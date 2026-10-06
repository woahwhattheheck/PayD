import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  DollarSign,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import {
  getForecast,
  getHistoricalData,
  getAlerts,
  type CashFlowForecast as ForecastType,
  type BudgetAlert,
  type HistoricalPayrollData,
} from '../services/cashFlowForecastApi';
import { useNotification } from '../hooks/useNotification';

interface ForecastParams {
  distributionAccount: string;
  assetIssuer: string;
  forecastDays: number;
}

export default function CashFlowForecast() {
  const { t } = useTranslation();
  const { notifyError, notifySuccess } = useNotification();
  const [forecast, setForecast] = useState<ForecastType | null>(null);
  const [historical, setHistorical] = useState<HistoricalPayrollData[]>([]);
  const [alerts, setAlerts] = useState<BudgetAlert[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [params, setParams] = useState<ForecastParams>({
    distributionAccount: '',
    assetIssuer: '',
    forecastDays: 90,
  });

  const loadForecast = useCallback(async () => {
    if (!params.distributionAccount || !params.assetIssuer) {
      notifyError(t('cashFlowForecast.errors.missingInputs'));
      return;
    }

    setIsLoading(true);
    try {
      const [forecastData, historicalData, alertsData] = await Promise.all([
        getForecast(params),
        getHistoricalData(6),
        getAlerts(params),
      ]);

      setForecast(forecastData);
      setHistorical(historicalData.historical);
      setAlerts(alertsData.alerts);
      notifySuccess(t('cashFlowForecast.updated'));
    } catch (error) {
      notifyError(error instanceof Error ? error.message : t('cashFlowForecast.errors.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [params, notifyError, notifySuccess, t]);

  useEffect(() => {
    void loadForecast();
  }, [loadForecast]);

  const chartData = useMemo(() => {
    if (!forecast) return [];

    const projectionMap = new Map<string, number>();
    forecast.projections.forEach((proj) => {
      const dateKey = new Date(proj.date).toISOString().split('T')[0];
      projectionMap.set(dateKey, (projectionMap.get(dateKey) || 0) + proj.projectedAmount);
    });

    const historicalMap = new Map<string, number>();
    historical.forEach((h) => {
      historicalMap.set(h.period, h.totalAmount);
    });

    const allDates = new Set([
      ...Array.from(projectionMap.keys()),
      ...Array.from(historicalMap.keys()),
    ]);

    return Array.from(allDates)
      .sort()
      .map((date) => ({
        date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        projected: projectionMap.get(date) || 0,
        historical: historicalMap.get(date) || 0,
      }));
  }, [forecast, historical]);

  const balanceProjectionData = useMemo(() => {
    if (!forecast) return [];

    let runningBalance = parseFloat(forecast.currentBalance);
    const data: Array<{ date: string; balance: number }> = [
      { date: 'Today', balance: runningBalance },
    ];

    forecast.projections
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .forEach((proj) => {
        runningBalance -= proj.projectedAmount;
        data.push({
          date: new Date(proj.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          balance: Math.max(0, runningBalance),
        });
      });

    return data;
  }, [forecast]);

  const getTrendIcon = () => {
    if (!forecast) return null;
    const { direction } = forecast.trendAnalysis;
    if (direction === 'increasing') return <TrendingUp className="w-5 h-5 text-emerald-400" />;
    if (direction === 'decreasing') return <TrendingDown className="w-5 h-5 text-red-400" />;
    return <Minus className="w-5 h-5 text-(--muted)" />;
  };

  const getAlertIcon = (severity: BudgetAlert['severity']) => {
    if (severity === 'critical') return <AlertCircle className="w-5 h-5 text-red-400" />;
    if (severity === 'warning') return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
    return <AlertCircle className="w-5 h-5 text-blue-400" />;
  };

  return (
    <div className="p-4 sm:p-6 lg:p-12 space-y-6">
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-(--text) mb-2">{t('cashFlowForecast.title')}</h1>
          <p className="text-sm text-(--muted)">
            {t('cashFlowForecast.subtitle')}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          <input
            type="text"
            placeholder={t('cashFlowForecast.distributionAccount')}
            value={params.distributionAccount}
            onChange={(e) => setParams({ ...params, distributionAccount: e.target.value })}
            className="px-4 py-2 bg-(--surface) border border-(--border) rounded-lg text-(--text) text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
          />
          <input
            type="text"
            placeholder={t('cashFlowForecast.assetIssuer')}
            value={params.assetIssuer}
            onChange={(e) => setParams({ ...params, assetIssuer: e.target.value })}
            className="px-4 py-2 bg-(--surface) border border-(--border) rounded-lg text-(--text) text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
          />
          <input
            type="number"
            placeholder={t('cashFlowForecast.daysPlaceholder')}
            value={params.forecastDays}
            onChange={(e) =>
              setParams({ ...params, forecastDays: parseInt(e.target.value, 10) || 90 })
            }
            className="px-4 py-2 bg-(--surface) border border-(--border) rounded-lg text-(--text) text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-24 min-h-[44px]"
          />
          <button
            onClick={() => {
              void loadForecast();
            }}
            disabled={isLoading}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-(--text) rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 min-h-[44px] touch-manipulation"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            {isLoading ? t('cashFlowForecast.loading') : t('cashFlowForecast.refresh')}
          </button>
        </div>
      </header>

      {isLoading && !forecast ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse bg-(--surface) border border-(--border) rounded-xl p-6 h-64"
            />
          ))}
        </div>
      ) : forecast ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-(--surface) border border-(--border) shadow-(--shadow-sm) rounded-xl p-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-(--muted)">{t('cashFlowForecast.currentBalance')}</span>
                <DollarSign className="w-5 h-5 text-(--muted)" />
              </div>
              <p className="text-2xl font-bold text-(--text)">
                {parseFloat(forecast.currentBalance).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="text-xs text-(--muted) mt-1">ORGUSD</p>
            </div>

            <div className="bg-(--surface) border border-(--border) shadow-(--shadow-sm) rounded-xl p-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-(--muted)">{t('cashFlowForecast.projectedOutflow')}</span>
                <Calendar className="w-5 h-5 text-(--muted)" />
              </div>
              <p className="text-2xl font-bold text-(--text)">
                {forecast.totalProjectedOutflow.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="text-xs text-(--muted) mt-1">
                {t('cashFlowForecast.scheduledPayments', { count: forecast.projections.length })}
              </p>
            </div>

            <div className="bg-(--surface) border border-(--border) shadow-(--shadow-sm) rounded-xl p-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-(--muted)">{t('cashFlowForecast.projectedBalance')}</span>
                <TrendingDown className="w-5 h-5 text-(--muted)" />
              </div>
              <p
                className={`text-2xl font-bold ${
                  forecast.projectedBalance < 0 ? 'text-red-400' : 'text-(--text)'
                }`}
              >
                {forecast.projectedBalance.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="text-xs text-(--muted) mt-1">{t('cashFlowForecast.afterProjections')}</p>
            </div>

            <div className="bg-(--surface) border border-(--border) shadow-(--shadow-sm) rounded-xl p-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-(--muted)">{t('cashFlowForecast.trend')}</span>
                {getTrendIcon()}
              </div>
              <p className="text-2xl font-bold text-(--text) capitalize">
                {forecast.trendAnalysis.direction}
              </p>
              <p className="text-xs text-(--muted) mt-1">
                {forecast.trendAnalysis.changePercent > 0 ? '+' : ''}
                {t('cashFlowForecast.vsHistorical', { percent: forecast.trendAnalysis.changePercent.toFixed(1) })}
              </p>
            </div>
          </div>

          {/* Budget Alerts */}
          {alerts.length > 0 && (
            <div className="bg-(--surface) border border-(--border) shadow-(--shadow-sm) rounded-xl p-6">
              <h2 className="text-xl font-bold text-(--text) mb-4 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-400" />
                {t('cashFlowForecast.budgetAlerts', { count: alerts.length })}
              </h2>
              <div className="space-y-3">
                {alerts.map((alert) => (
                  <div
                    key={`${alert.type}-${alert.projectedDate}-${alert.severity}`}
                    className={`p-4 rounded-lg border ${
                      alert.severity === 'critical'
                        ? 'bg-red-500/10 border-red-500/20'
                        : alert.severity === 'warning'
                          ? 'bg-yellow-500/10 border-yellow-500/20'
                          : 'bg-blue-500/10 border-blue-500/20'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {getAlertIcon(alert.severity)}
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${
                              alert.severity === 'critical'
                                ? 'bg-red-500/20 text-red-400'
                                : alert.severity === 'warning'
                                  ? 'bg-yellow-500/20 text-yellow-400'
                                  : 'bg-blue-500/20 text-blue-400'
                            }`}
                          >
                            {alert.severity}
                          </span>
                          <span className="text-xs text-(--muted)">
                            {new Date(alert.projectedDate).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-sm text-(--text) mb-1">{alert.message}</p>
                        {alert.shortfall && (
                          <p className="text-xs text-red-400 font-mono">
                            {t('cashFlowForecast.shortfall', { amount: alert.shortfall.toFixed(2), asset: 'ORGUSD' })}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Cash Flow Projection Chart */}
            <div className="bg-(--surface) border border-(--border) shadow-(--shadow-sm) rounded-xl p-6">
              <h3 className="text-lg font-bold text-(--text) mb-4">{t('cashFlowForecast.cashFlowProjection')}</h3>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={balanceProjectionData}>
                  <defs>
                    <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                  <YAxis stroke="#9ca3af" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#18181b',
                      border: '1px solid #27272a',
                      borderRadius: '8px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="balance"
                    name={t('cashFlowForecast.projectedBalance')}
                    stroke="#3b82f6"
                    fillOpacity={1}
                    fill="url(#balanceGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Historical vs Projected Chart */}
            <div className="bg-(--surface) border border-(--border) shadow-(--shadow-sm) rounded-xl p-6">
              <h3 className="text-lg font-bold text-(--text) mb-4">{t('cashFlowForecast.historicalVsProjected')}</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                  <YAxis stroke="#9ca3af" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#18181b',
                      border: '1px solid #27272a',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend />
                  <Bar dataKey="historical" fill="#10b981" name={t('cashFlowForecast.historical')} />
                  <Bar dataKey="projected" fill="#3b82f6" name={t('cashFlowForecast.projected')} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Historical Averages */}
          <div className="bg-(--surface) border border-(--border) shadow-(--shadow-sm) rounded-xl p-6">
            <h3 className="text-lg font-bold text-(--text) mb-4">{t('cashFlowForecast.historicalAverages')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-(--surface) rounded-lg border border-(--border)">
                <p className="text-sm text-(--muted) mb-1">{t('cashFlowForecast.weeklyAverage')}</p>
                <p className="text-2xl font-bold text-(--text)">
                  {forecast.historicalAverage.weekly.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
              <div className="p-4 bg-(--surface) rounded-lg border border-(--border)">
                <p className="text-sm text-(--muted) mb-1">{t('cashFlowForecast.biweeklyAverage')}</p>
                <p className="text-2xl font-bold text-(--text)">
                  {forecast.historicalAverage.biweekly.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
              <div className="p-4 bg-(--surface) rounded-lg border border-(--border)">
                <p className="text-sm text-(--muted) mb-1">{t('cashFlowForecast.monthlyAverage')}</p>
                <p className="text-2xl font-bold text-(--text)">
                  {forecast.historicalAverage.monthly.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-(--surface) border border-(--border) shadow-(--shadow-sm) rounded-xl p-12 text-center">
          <p className="text-(--muted)">
            {t('cashFlowForecast.emptyPrompt')}
          </p>
        </div>
      )}
    </div>
  );
}
