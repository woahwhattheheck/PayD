import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, Heading, Text, Button, Input } from '@stellar/design-system';
import { useNotification } from '../hooks/useNotification';
import { useSocket } from '../hooks/useSocket';
import {
  getForecast,
  getLiquiditySettings,
  updateLiquiditySettings,
  type ForecastResponse,
  type LiquiditySettings,
} from '../services/forecastApi';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

type LiquidityAlertPayload = {
  severity?: string;
  shortfallAmount?: number | string;
  assetCode?: string;
};

function normalizeLiquidityAlertPayload(payload: unknown): LiquidityAlertPayload {
  if (!payload || typeof payload !== 'object') return {};
  const record = payload as Record<string, unknown>;
  return {
    severity: typeof record.severity === 'string' ? record.severity : undefined,
    shortfallAmount:
      typeof record.shortfallAmount === 'number' || typeof record.shortfallAmount === 'string'
        ? record.shortfallAmount
        : undefined,
    assetCode: typeof record.assetCode === 'string' ? record.assetCode : undefined,
  };
}

function statusClasses(status: 'green' | 'yellow' | 'red'): string {
  if (status === 'green') return 'bg-green-500/15 text-green-300 border-green-500/30';
  if (status === 'yellow') return 'bg-yellow-500/15 text-yellow-200 border-yellow-500/30';
  return 'bg-red-500/15 text-red-300 border-red-500/30';
}

export default function Forecasting() {
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [monthsForward, setMonthsForward] = useState(6);
  const [settings, setSettings] = useState<LiquiditySettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<LiquiditySettings>({
    distributionAccount: '',
    assetIssuer: '',
    assetCode: 'ORGUSD',
    benefitsRatePct: 0,
    yellowBufferPct: 10,
    alertEmails: [],
  });

  const { notifyError, notifySuccess } = useNotification();
  const { socket, connected, subscribeToOrganization, unsubscribeFromOrganization } = useSocket();

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const s = await getLiquiditySettings();
        setSettings(s);
        if (s) setSettingsDraft(s);

        const f = await getForecast(monthsForward);
        setForecast(f);

        if (connected && f?.organizationId) {
          subscribeToOrganization(f.organizationId);
        }
      } catch (e: unknown) {
        notifyError(getErrorMessage(e) || 'Failed to load forecast');
      } finally {
        setIsLoading(false);
      }
    };

    void load();

    return () => {
      if (forecast?.organizationId && connected) {
        unsubscribeFromOrganization(forecast.organizationId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthsForward, connected]);

  useEffect(() => {
    if (!socket) return;

    const handler = (payload: unknown) => {
      const normalized = normalizeLiquidityAlertPayload(payload);
      notifyError(
        `Liquidity ${String(normalized.severity || '').toUpperCase()}: shortfall ${normalized.shortfallAmount ?? ''} ${normalized.assetCode ?? ''}`
      );
    };

    socket.on('liquidity:alert', handler);
    return () => {
      socket.off('liquidity:alert', handler);
    };
  }, [socket, notifyError]);

  const chartData = useMemo(() => forecast?.monthly || [], [forecast]);

  const liquidity = forecast?.liquidity;

  const saveSettings = async () => {
    try {
      const updated = await updateLiquiditySettings(settingsDraft);
      setSettings(updated);
      notifySuccess('Liquidity settings updated');

      const f = await getForecast(monthsForward);
      setForecast(f);
    } catch (e: unknown) {
      notifyError(getErrorMessage(e) || 'Failed to update settings');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Heading as="h1" size="sm">
            Payroll Forecasting
          </Heading>
          <Text size="sm" as="p">
            Project payroll liabilities and monitor liquidity risk.
          </Text>
        </div>

        <div className="flex items-center gap-3">
          <Input
            id="monthsForward"
            value={String(monthsForward)}
            onChange={(e) =>
              setMonthsForward(Math.min(6, Math.max(3, Number(e.target.value) || 6)))
            }
            label="Months"
            type="number"
            fieldSize="sm"
          />
          <Button
            variant="secondary"
            size="sm"
            isLoading={isLoading}
            onClick={() =>
              void (async () => {
                try {
                  const f = await getForecast(monthsForward);
                  setForecast(f);
                } catch (e: unknown) {
                  notifyError(getErrorMessage(e) || 'Failed to refresh');
                }
              })()
            }
          >
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <Heading as="h2" size="xs">
              Liquidity Status
            </Heading>
            {liquidity ? (
              <Text size="sm" as="p">
                Available: {liquidity.availableBalance} {liquidity.assetCode} · Required (next 2
                runs): {liquidity.requiredNext2Runs} {liquidity.assetCode}
              </Text>
            ) : (
              <Text size="sm" as="p">
                Configure liquidity settings to calculate status.
              </Text>
            )}
          </div>

          {liquidity && (
            <div
              className={`px-3 py-1.5 rounded-lg border text-xs font-black uppercase tracking-widest ${statusClasses(
                liquidity.status
              )}`}
            >
              {liquidity.status}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <Heading as="h2" size="xs">
          Projected Monthly Payroll Cost
        </Heading>
        <div className="h-72 mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ left: 12, right: 12, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="projectedTotalLiability"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <Heading as="h2" size="xs">
          Liquidity Settings
        </Heading>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <Input
            id="distributionAccount"
            label="Distribution Account"
            value={settingsDraft.distributionAccount}
            onChange={(e) =>
              setSettingsDraft((s) => ({ ...s, distributionAccount: e.target.value }))
            }
            fieldSize="sm"
          />
          <Input
            id="assetIssuer"
            label="Asset Issuer"
            value={settingsDraft.assetIssuer}
            onChange={(e) => setSettingsDraft((s) => ({ ...s, assetIssuer: e.target.value }))}
            fieldSize="sm"
          />
          <Input
            id="assetCode"
            label="Asset Code"
            value={settingsDraft.assetCode || 'ORGUSD'}
            onChange={(e) => setSettingsDraft((s) => ({ ...s, assetCode: e.target.value }))}
            fieldSize="sm"
          />
          <Input
            id="benefitsRatePct"
            label="Benefits Rate %"
            type="number"
            value={String(settingsDraft.benefitsRatePct ?? 0)}
            onChange={(e) =>
              setSettingsDraft((s) => ({ ...s, benefitsRatePct: Number(e.target.value) || 0 }))
            }
            fieldSize="sm"
          />
          <Input
            id="yellowBufferPct"
            label="Yellow Buffer %"
            type="number"
            value={String(settingsDraft.yellowBufferPct ?? 10)}
            onChange={(e) =>
              setSettingsDraft((s) => ({ ...s, yellowBufferPct: Number(e.target.value) || 10 }))
            }
            fieldSize="sm"
          />
          <Input
            id="alertEmails"
            label="Alert Emails (comma separated)"
            value={(settingsDraft.alertEmails || []).join(',')}
            onChange={(e) =>
              setSettingsDraft((s) => ({
                ...s,
                alertEmails: e.target.value
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              }))
            }
            fieldSize="sm"
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" size="sm" onClick={() => void saveSettings()}>
            Save
          </Button>
          {settings && (
            <Text size="sm" as="p">
              Saved.
            </Text>
          )}
        </div>
      </Card>
    </div>
  );
}
