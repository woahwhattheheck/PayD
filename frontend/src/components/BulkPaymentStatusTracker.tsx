import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../hooks/useNotification';
import { useSocket } from '../hooks/useSocket';
import { useWallet } from '../hooks/useWallet';
import { useWalletSigning } from '../hooks/useWalletSigning';
import { contractService } from '../services/contracts';
import {
  fetchPayrollRuns,
  fetchPayrollRunSummary,
  getTxExplorerUrl,
  retryFailedBatch,
  type PayrollRecipientStatus,
  type PayrollRunRecord,
  type PayrollRunSummary,
} from '../services/bulkPaymentStatus';

interface BulkPaymentStatusTrackerProps {
  organizationId: number;
}

type ConfirmationMap = Record<string, number>;

function toRecipientStatus(
  status: PayrollRecipientStatus['status']
): 'pending' | 'confirmed' | 'failed' {
  if (status === 'completed') return 'confirmed';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function getEmployeeName(recipient: PayrollRecipientStatus, fallback: string): string {
  const fullName =
    `${recipient.employee_first_name ?? ''} ${recipient.employee_last_name ?? ''}`.trim();
  return fullName || recipient.employee_email || fallback;
}

function findRunTxHash(summary?: PayrollRunSummary): string | null {
  if (!summary) return null;
  const txHash = summary.items.find((item) => Boolean(item.tx_hash))?.tx_hash;
  return txHash || null;
}

function normalizeConfirmationPayload(payload: unknown): {
  batchId: string | null;
  confirmations: number | null;
} {
  if (!payload || typeof payload !== 'object') {
    return { batchId: null, confirmations: null };
  }

  const record = payload as Record<string, unknown>;
  const batchId =
    (record.batchId as string | undefined) ||
    (record.batch_id as string | undefined) ||
    (record.runId as string | undefined) ||
    null;

  const countRaw =
    record.confirmations ?? record.confirmationCount ?? record.confirmed ?? record.count ?? null;

  const count =
    typeof countRaw === 'number'
      ? countRaw
      : typeof countRaw === 'string'
        ? Number.parseInt(countRaw, 10)
        : null;

  return {
    batchId,
    confirmations: Number.isFinite(count) ? count : null,
  };
}

export function BulkPaymentStatusTracker({ organizationId }: BulkPaymentStatusTrackerProps) {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<PayrollRunRecord[]>([]);
  const [summaries, setSummaries] = useState<Record<number, PayrollRunSummary>>({});
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const [confirmations, setConfirmations] = useState<ConfirmationMap>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isRetryingBatchId, setIsRetryingBatchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { notifyError, notifySuccess } = useNotification();
  const { socket } = useSocket();
  const { address } = useWallet();
  const { sign } = useWalletSigning();

  const loadRuns = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const payload = await fetchPayrollRuns(organizationId, 1, 20);
      setRuns(payload.data);
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : t('bulkPaymentStatusTracker.errors.loadRuns');
      setError(message);
      notifyError(t('bulkPaymentStatusTracker.errors.loadTitle'), message);
    } finally {
      setIsLoading(false);
    }
  }, [notifyError, organizationId, t]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const loadSummary = useCallback(
    async (runId: number) => {
      if (summaries[runId]) return;
      try {
        const summary = await fetchPayrollRunSummary(runId);
        setSummaries((prev) => ({ ...prev, [runId]: summary }));
      } catch (summaryError) {
        const message =
          summaryError instanceof Error
            ? summaryError.message
            : t('bulkPaymentStatusTracker.errors.loadRecipientStatus');
        notifyError(t('bulkPaymentStatusTracker.errors.loadDetailsTitle'), message);
      }
    },
    [notifyError, summaries, t]
  );

  useEffect(() => {
    if (!socket) return;

    const onBulkConfirmation = (payload: unknown) => {
      const normalized = normalizeConfirmationPayload(payload);
      if (!normalized.batchId || normalized.confirmations === null) return;
      setConfirmations((prev) => ({
        ...prev,
        [normalized.batchId as string]: normalized.confirmations as number,
      }));
    };

    socket.on('bulk:confirmation', onBulkConfirmation);
    socket.on('bulk_payment:confirmation', onBulkConfirmation);

    runs.forEach((run) => {
      socket.emit('subscribe:bulk', { batchId: run.batch_id });
    });

    return () => {
      socket.off('bulk:confirmation', onBulkConfirmation);
      socket.off('bulk_payment:confirmation', onBulkConfirmation);
      runs.forEach((run) => {
        socket.emit('unsubscribe:bulk', { batchId: run.batch_id });
      });
    };
  }, [runs, socket]);

  const handleToggleExpand = async (runId: number) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(runId);
    await loadSummary(runId);
  };

  const handleRetry = async (run: PayrollRunRecord) => {
    if (!address) {
      notifyError(
        t('bulkPaymentStatusTracker.errors.walletRequiredTitle'),
        t('bulkPaymentStatusTracker.errors.walletRequiredBody')
      );
      return;
    }

    const summary = summaries[run.id];
    const hasFailedRecipients = summary?.items.some((item) => item.status === 'failed');
    if (!hasFailedRecipients) return;

    setIsRetryingBatchId(run.batch_id);
    try {
      await contractService.initialize();
      const contractId =
        contractService.getContractId('bulk_payment', 'testnet') ||
        (import.meta.env.VITE_BULK_PAYMENT_CONTRACT_ID as string | undefined);

      if (!contractId) {
        throw new Error(t('bulkPaymentStatusTracker.errors.contractUnavailable'));
      }

      const { txHash } = await retryFailedBatch({
        contractId,
        batchId: run.batch_id,
        sourceAddress: address,
        signTransaction: sign,
      });

      notifySuccess(
        t('bulkPaymentStatusTracker.notifications.retrySubmittedTitle'),
        t('bulkPaymentStatusTracker.notifications.retrySubmittedBody', {
          batchId: run.batch_id,
          txHash,
        })
      );
      await loadSummary(run.id);
    } catch (retryError) {
      const message =
        retryError instanceof Error
          ? retryError.message
          : t('bulkPaymentStatusTracker.errors.retryFailed');
      notifyError(t('bulkPaymentStatusTracker.errors.retryFailed'), message);
    } finally {
      setIsRetryingBatchId(null);
    }
  };

  const rows = useMemo(() => {
    return runs.map((run) => {
      const summary = summaries[run.id];
      const employeeCount = summary?.summary.total_employees ?? 0;
      const txHash = findRunTxHash(summary);
      const confirmationCount = confirmations[run.batch_id] ?? 0;
      const hasFailedRecipients = summary?.items.some((item) => item.status === 'failed') ?? false;

      return {
        run,
        summary,
        employeeCount,
        txHash,
        confirmationCount,
        hasFailedRecipients,
      };
    });
  }, [confirmations, runs, summaries]);

  return (
    <div className="card glass noise mt-4 sm:mt-8 p-4 sm:p-6">
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h3 className="text-base sm:text-lg font-bold">{t('bulkPaymentStatusTracker.title')}</h3>
        <button
          type="button"
          onClick={() => {
            void loadRuns();
          }}
          className="text-xs sm:text-sm font-semibold text-accent hover:text-accent/80 px-4 py-2 rounded-lg hover:bg-accent/10 transition-colors touch-manipulation min-h-[44px] self-start sm:self-auto"
        >
          {t('bulkPaymentStatusTracker.refresh')}
        </button>
      </div>

      {isLoading ? (
        <p className="text-xs sm:text-sm text-muted">{t('bulkPaymentStatusTracker.loadingRuns')}</p>
      ) : null}
      {error ? <p className="text-xs sm:text-sm text-danger">{error}</p> : null}

      {!isLoading && rows.length === 0 ? (
        <p className="text-xs sm:text-sm text-muted">{t('bulkPaymentStatusTracker.emptyRuns')}</p>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted border-b border-hi">
                <tr>
                  <th className="py-2 pr-4">{t('bulkPaymentStatusTracker.headers.batch')}</th>
                  <th className="py-2 pr-4">{t('bulkPaymentStatusTracker.headers.status')}</th>
                  <th className="py-2 pr-4">{t('bulkPaymentStatusTracker.headers.employees')}</th>
                  <th className="py-2 pr-4">{t('bulkPaymentStatusTracker.headers.total')}</th>
                  <th className="py-2 pr-4">{t('bulkPaymentStatusTracker.headers.confirmations')}</th>
                  <th className="py-2 pr-4">{t('bulkPaymentStatusTracker.headers.txHash')}</th>
                  <th className="py-2 pr-4">{t('bulkPaymentStatusTracker.headers.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(
                  ({
                    run,
                    summary,
                    employeeCount,
                    txHash,
                    confirmationCount,
                    hasFailedRecipients,
                  }) => (
                    <FragmentRow
                      key={run.id}
                      run={run}
                      summary={summary}
                      employeeCount={employeeCount}
                      txHash={txHash}
                      confirmationCount={confirmationCount}
                      expanded={expandedRunId === run.id}
                      retrying={isRetryingBatchId === run.batch_id}
                      hasFailedRecipients={hasFailedRecipients}
                      onToggleExpand={() => {
                        void handleToggleExpand(run.id);
                      }}
                      onRetry={() => {
                        void handleRetry(run);
                      }}
                    />
                  )
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {rows.map(
              ({ run, summary, employeeCount, txHash, confirmationCount, hasFailedRecipients }) => (
                <div
                  key={run.id}
                  className="border border-hi/50 rounded-lg p-4 bg-black/5 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-mono text-muted mb-1">
                        {t('bulkPaymentStatusTracker.labels.batch', { batchId: run.batch_id })}
                      </div>
                      <div className="text-sm font-bold capitalize">
                        {t(`bulkPaymentStatusTracker.status.${run.status}`)}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-1 rounded text-[10px] uppercase font-bold ${
                        run.status === 'completed'
                          ? 'bg-emerald-500/20 text-emerald-500'
                          : run.status === 'pending'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-red-500/20 text-red-500'
                      }`}
                    >
                      {t(`bulkPaymentStatusTracker.status.${run.status}`)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted">{t('bulkPaymentStatusTracker.labels.employees')}</span>
                      <span className="ml-1 font-bold">{employeeCount}</span>
                    </div>
                    <div>
                      <span className="text-muted">{t('bulkPaymentStatusTracker.labels.total')}</span>
                      <span className="ml-1 font-bold">
                        {run.total_amount} {run.asset_code}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted">{t('bulkPaymentStatusTracker.labels.confirmations')}</span>
                      <span className="ml-1 font-bold">{confirmationCount}</span>
                    </div>
                    {txHash && (
                      <div className="col-span-2">
                        <span className="text-muted">{t('bulkPaymentStatusTracker.labels.txHash')}</span>
                        <a
                          href={getTxExplorerUrl(txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-1 text-accent break-all"
                        >
                          {txHash.slice(0, 16)}...
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 pt-2 border-t border-hi/30">
                    <button
                      type="button"
                      onClick={() => {
                        void handleToggleExpand(run.id);
                      }}
                      className="flex-1 py-2 px-3 text-xs font-semibold text-accent hover:text-accent/80 hover:bg-accent/10 rounded-lg transition-colors touch-manipulation min-h-[44px]"
                    >
                      {expandedRunId === run.id
                        ? t('bulkPaymentStatusTracker.actions.hideDetails')
                        : t('bulkPaymentStatusTracker.actions.showDetails')}
                    </button>
                    {hasFailedRecipients && (
                      <button
                        type="button"
                        onClick={() => {
                          void handleRetry(run);
                        }}
                        disabled={isRetryingBatchId === run.batch_id}
                        className="flex-1 py-2 px-3 text-xs font-semibold text-danger hover:text-danger/80 hover:bg-danger/10 rounded-lg transition-colors disabled:opacity-60 touch-manipulation min-h-[44px]"
                      >
                        {isRetryingBatchId === run.batch_id
                          ? t('bulkPaymentStatusTracker.actions.retrying')
                          : t('bulkPaymentStatusTracker.actions.retryFailed')}
                      </button>
                    )}
                  </div>
                  {expandedRunId === run.id && summary && (
                    <div className="pt-3 border-t border-hi/30 text-xs space-y-2">
                      <div>
                        <span className="text-muted">{t('bulkPaymentStatusTracker.labels.successful')}</span>
                        <span className="ml-1 text-emerald-400 font-bold">
                          {summary.items.filter((item) => item.status === 'completed').length}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted">{t('bulkPaymentStatusTracker.labels.failed')}</span>
                        <span className="ml-1 text-red-400 font-bold">
                          {summary.items.filter((item) => item.status === 'failed').length}
                        </span>
                      </div>
                      {summary.items.filter((item) => item.status === 'failed').length > 0 && (
                        <div className="mt-2">
                          <div className="text-muted mb-1">{t('bulkPaymentStatusTracker.labels.failedRecipients')}</div>
                          <div className="space-y-1">
                            {summary.items
                              .filter((item) => item.status === 'failed')
                              .map((item) => (
                                <div key={item.id} className="font-mono text-[10px] break-all">
                                  {getEmployeeName(
                                    item,
                                    t('bulkPaymentStatusTracker.employeeFallback', {
                                      id: item.employee_id,
                                    })
                                  )}
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface FragmentRowProps {
  run: PayrollRunRecord;
  summary?: PayrollRunSummary;
  employeeCount: number;
  txHash: string | null;
  confirmationCount: number;
  expanded: boolean;
  retrying: boolean;
  hasFailedRecipients: boolean;
  onToggleExpand: () => void;
  onRetry: () => void;
}

function FragmentRow({
  run,
  summary,
  employeeCount,
  txHash,
  confirmationCount,
  expanded,
  retrying,
  hasFailedRecipients,
  onToggleExpand,
  onRetry,
}: FragmentRowProps) {
  const { t } = useTranslation();

  return (
    <>
      <tr className="border-b border-hi/40">
        <td className="py-3 pr-4 font-mono">{run.batch_id}</td>
        <td className="py-3 pr-4 capitalize">
          {t(`bulkPaymentStatusTracker.status.${run.status}`)}
        </td>
        <td className="py-3 pr-4">{employeeCount}</td>
        <td className="py-3 pr-4">
          {run.total_amount} {run.asset_code}
        </td>
        <td className="py-3 pr-4">{confirmationCount}</td>
        <td className="py-3 pr-4">
          {txHash ? (
            <a
              href={getTxExplorerUrl(txHash)}
              target="_blank"
              rel="noreferrer"
              className="text-accent"
            >
              {txHash.slice(0, 10)}...
            </a>
          ) : (
            <span className="text-muted">{t('bulkPaymentStatusTracker.notAvailable')}</span>
          )}
        </td>
        <td className="py-3 pr-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onToggleExpand}
              className="text-accent hover:text-accent/80"
            >
              {expanded
                ? t('bulkPaymentStatusTracker.actions.hide')
                : t('bulkPaymentStatusTracker.actions.details')}
            </button>
            {hasFailedRecipients ? (
              <button
                type="button"
                onClick={onRetry}
                disabled={retrying}
                className="text-danger hover:text-danger/80 disabled:opacity-60"
              >
                {retrying
                  ? t('bulkPaymentStatusTracker.actions.retrying')
                  : t('bulkPaymentStatusTracker.actions.retryFailed')}
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-hi/40 bg-black/10">
          <td colSpan={7} className="py-3">
            {!summary ? (
              <p className="text-sm text-muted">
                {t('bulkPaymentStatusTracker.loadingRecipientStatuses')}
              </p>
            ) : (
              <div className="space-y-2">
                {summary.items.map((recipient) => (
                  <div
                    key={recipient.id}
                    className="flex items-center justify-between rounded-md border border-hi/30 px-3 py-2 text-xs"
                  >
                    <span>
                      {getEmployeeName(
                        recipient,
                        t('bulkPaymentStatusTracker.employeeFallback', {
                          id: recipient.employee_id,
                        })
                      )}
                    </span>
                    <span>
                      {recipient.amount} {run.asset_code}
                    </span>
                    <span className="capitalize">
                      {t(
                        `bulkPaymentStatusTracker.status.${toRecipientStatus(recipient.status)}`
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
