import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  getPayrollAnalytics,
  type PayrollAnalytics,
} from '../services/payrollAnalyticsApi';

const chartPalette = [
  'var(--accent)',
  'var(--accent2)',
  'var(--link)',
  'var(--success)',
  'var(--muted)',
];

function chartNumber(value: string): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function lastTwelveMonths(): Array<{ key: string; label: string }> {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1));
    return {
      key: date.toISOString().slice(0, 7),
      label: date.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
    };
  });
}

export default function PayrollAnalyticsCharts() {
  const [analytics, setAnalytics] = useState<PayrollAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState('');
  const [requestCount, setRequestCount] = useState(0);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);
    void getPayrollAnalytics()
      .then((result) => {
        if (!active) return;
        setAnalytics(result);
        setCurrency((previous) =>
          result.currencies.some((row) => row.currency === previous)
            ? previous
            : result.currencies[0]?.currency || ''
        );
      })
      .catch((reason: unknown) => {
        if (active) {
          setAnalytics(null);
          setError(reason instanceof Error ? reason.message : 'Unable to load payroll analytics');
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [requestCount]);

  const currencyMix = useMemo(
    () =>
      (analytics?.currencies || [])
        .map((row) => ({
          currency: row.currency,
          count: chartNumber(row.paymentCount),
        }))
        .filter((row): row is { currency: string; count: number } =>
          row.count !== null && row.count > 0
        ),
    [analytics]
  );

  const selectedTrend = useMemo(() => {
    const rows = new Map(
      (analytics?.monthly || [])
        .filter((row) => row.currency === currency)
        .map((row) => [row.month, chartNumber(row.total)])
    );
    return lastTwelveMonths().map(({ key, label }) => ({
      month: key,
      label,
      total: rows.get(key) ?? 0,
    }));
  }, [analytics, currency]);

  const departmentCosts = useMemo(
    () =>
      (analytics?.departments || [])
        .filter((row) => row.currency === currency)
        .map((row) => ({ department: row.department, total: chartNumber(row.total) }))
        .filter((row): row is { department: string; total: number } => row.total !== null)
        .sort((a, b) => b.total - a.total),
    [analytics, currency]
  );

  const hasSettledPayments = currencyMix.length > 0;
  const currencyDescription = currency || 'selected asset';
  const lineCaption = `Settled payroll cost in ${currencyDescription} by month; last 12 calendar months`;
  const pieCaption = 'Number of completed payroll payments by currency; amounts are not combined across assets';
  const barCaption = `Completed payroll cost by department in ${currencyDescription}`;

  return (
    <section aria-labelledby="payroll-analytics-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="payroll-analytics-title" className="font-bold text-lg text-(--text)">
            Historical payroll analytics
          </h2>
          <p className="text-sm text-(--muted)">
            Live, completed payroll transactions from your organization over 12 months.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="analytics-currency" className="text-sm text-(--muted)">
            Amount currency
          </label>
          <select
            id="analytics-currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            disabled={isLoading || !hasSettledPayments}
            className="min-h-[44px] rounded-lg border border-(--border-hi) bg-(--surface) px-3 text-(--text)"
          >
            {currencyMix.map(({ currency: option }) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setRequestCount((count) => count + 1)}
            disabled={isLoading}
            className="min-h-[44px] rounded-lg border border-(--border-hi) px-4 text-(--text)"
          >
            Refresh analytics
          </button>
        </div>
      </div>

      {isLoading ? (
        <p role="status" className="text-sm text-(--muted)">Loading settled payroll records…</p>
      ) : error ? (
        <p role="alert" className="text-sm text-(--danger)">Payroll analytics error: {error}</p>
      ) : !hasSettledPayments ? (
        <p className="text-sm text-(--muted)">
          No completed payroll transactions are available for this organization in the last 12 months.
        </p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <figure className="rounded-2xl border border-(--border) bg-(--surface) p-4 xl:col-span-2">
            <figcaption className="font-semibold text-(--text) mb-4">
              12-month payroll trend ({currencyDescription})
            </figcaption>
            <div role="img" aria-label={lineCaption} className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={selectedTrend} margin={{ top: 10, right: 14, bottom: 14, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip formatter={(value) => [Number(value).toLocaleString(), currencyDescription]} />
                  <Line
                    type="monotone"
                    dataKey="total"
                    name="Settled cost"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <table className="sr-only">
              <caption>{lineCaption}</caption>
              <thead><tr><th>Month</th><th>Cost ({currencyDescription})</th></tr></thead>
              <tbody>{selectedTrend.map((point) => (
                <tr key={point.month}><td>{point.label}</td><td>{point.total}</td></tr>
              ))}</tbody>
            </table>
          </figure>

          <figure className="rounded-2xl border border-(--border) bg-(--surface) p-4">
            <figcaption className="font-semibold text-(--text) mb-4">
              Payment distribution by currency (transaction count)
            </figcaption>
            <div role="img" aria-label={pieCaption} className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={currencyMix}
                    dataKey="count"
                    nameKey="currency"
                    cx="50%"
                    cy="50%"
                    outerRadius="76%"
                    isAnimationActive={false}
                  >
                    {currencyMix.map((entry, index) => (
                      <Cell key={entry.currency} fill={chartPalette[index % chartPalette.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => [Number(value).toLocaleString(), 'Payments']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <table className="sr-only">
              <caption>{pieCaption}</caption>
              <thead><tr><th>Currency</th><th>Payments</th></tr></thead>
              <tbody>{currencyMix.map((row) => (
                <tr key={row.currency}><td>{row.currency}</td><td>{row.count}</td></tr>
              ))}</tbody>
            </table>
          </figure>

          <figure className="rounded-2xl border border-(--border) bg-(--surface) p-4">
            <figcaption className="font-semibold text-(--text) mb-4">
              Cost by department ({currencyDescription})
            </figcaption>
            {departmentCosts.length ? (
              <>
                <div role="img" aria-label={barCaption} className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={departmentCosts} margin={{ top: 10, right: 12, bottom: 46, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="department" interval={0} angle={-25} textAnchor="end" height={72} />
                      <YAxis />
                      <Tooltip formatter={(value) => [Number(value).toLocaleString(), currencyDescription]} />
                      <Bar
                        dataKey="total"
                        name="Settled cost"
                        fill="var(--accent2)"
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <table className="sr-only">
                  <caption>{barCaption}</caption>
                  <thead><tr><th>Department</th><th>Cost ({currencyDescription})</th></tr></thead>
                  <tbody>{departmentCosts.map((row) => (
                    <tr key={row.department}><td>{row.department}</td><td>{row.total}</td></tr>
                  ))}</tbody>
                </table>
              </>
            ) : (
              <p className="text-sm text-(--muted)">No department costs in the selected currency.</p>
            )}
          </figure>
        </div>
      )}
    </section>
  );
}
