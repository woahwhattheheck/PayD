import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Loader2,
  Building2,
  Smartphone,
} from 'lucide-react';
import { useWithdrawal } from '../hooks/useWithdrawal';
import { formatCurrency } from '../services/currencyConversion';

interface WithdrawalFlowProps {
  balance: number;
  exchangeRate: number;
  selectedCurrency: string;
  onClose: () => void;
  onSuccess: () => void;
}

const WithdrawalFlow: React.FC<WithdrawalFlowProps> = ({
  balance,
  exchangeRate,
  selectedCurrency,
  onClose,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const {
    state,
    setStep,
    selectAnchor,
    setAmount,
    initiateWithdrawal,
    openInteractiveUrl,
    cancelWithdrawal,
    reset,
    loadAnchors,
  } = useWithdrawal(balance, exchangeRate, selectedCurrency);

  const [destinationType, setDestinationType] = useState<'bank_account' | 'mobile_money'>(
    'bank_account'
  );
  const [destinationDetails, setDestinationDetails] = useState<Record<string, string>>({});

  useEffect(() => {
    void loadAnchors();
  }, [loadAnchors]);

  const handleAmountSubmit = () => {
    setStep('confirm');
  };

  const handleConfirmWithdrawal = async () => {
    await initiateWithdrawal(destinationType, destinationDetails);
    if (state.step !== 'failed') {
      onSuccess();
    }
  };

  const handleReset = () => {
    reset();
    setDestinationDetails({});
    void loadAnchors();
  };

  const renderStep = () => {
    switch (state.step) {
      case 'select_anchor':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">{t('withdrawalFlow.selectMethod')}</h3>
            <p className="text-sm text-[var(--muted)]">
              {t('withdrawalFlow.selectMethodDescription', { currency: selectedCurrency })}
            </p>

            {state.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--accent)]" />
                <span className="ml-2 text-[var(--muted)]">{t('withdrawalFlow.loadingAnchors')}</span>
              </div>
            ) : state.anchors.length === 0 ? (
              <div className="text-center py-8">
                <XCircle className="w-12 h-12 mx-auto text-[var(--muted)] mb-4" />
                <p className="text-[var(--muted)]">{t('withdrawalFlow.noAnchors')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {state.anchors.map((anchor) => (
                  <button
                    key={anchor.domain}
                    onClick={() => selectAnchor(anchor)}
                    className="w-full p-4 text-left rounded-xl border border-[var(--border)] hover:border-[var(--accent)] transition-colors bg-[var(--surface)]"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{anchor.name}</div>
                        <div className="text-sm text-[var(--muted)]">
                          {t('withdrawalFlow.fee')} {anchor.withdrawFee || t('withdrawalFlow.varies')} · {t('withdrawalFlow.minimum')}{' '}
                          {anchor.withdrawMinAmount || 0} {selectedCurrency}
                        </div>
                      </div>
                      <ArrowRight className="w-5 h-5 text-[var(--muted)]" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );

      case 'enter_amount':
        return (
          <div className="space-y-4">
            <button
              onClick={() => setStep('select_anchor')}
              className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--text)]"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('withdrawalFlow.back')}
            </button>

            <h3 className="text-lg font-semibold">{t('withdrawalFlow.withdrawVia', { anchor: state.selectedAnchor?.name })}</h3>

            <div>
              <label className="block text-sm text-[var(--muted)] mb-2">{t('withdrawalFlow.amountOrgusd')}</label>
              <input
                type="number"
                value={state.amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                max={balance}
                className="w-full p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
              />
              <div className="flex justify-between mt-2 text-sm">
                <span className="text-[var(--muted)]">
                  {t('withdrawalFlow.available', { amount: formatCurrency(balance, 'USD') })}
                </span>
                <span className="text-[var(--muted)]">
                  ≈ {formatCurrency(state.estimatedReceive, selectedCurrency)}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-sm text-[var(--muted)] mb-2">{t('withdrawalFlow.destinationType')}</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setDestinationType('bank_account')}
                  className={`flex-1 p-3 rounded-lg border ${
                    destinationType === 'bank_account'
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--border)]'
                  }`}
                >
                  <Building2 className="w-5 h-5 mx-auto mb-1" />
                  <span className="text-sm">{t('withdrawalFlow.bankAccount')}</span>
                </button>
                <button
                  onClick={() => setDestinationType('mobile_money')}
                  className={`flex-1 p-3 rounded-lg border ${
                    destinationType === 'mobile_money'
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--border)]'
                  }`}
                >
                  <Smartphone className="w-5 h-5 mx-auto mb-1" />
                  <span className="text-sm">{t('withdrawalFlow.mobileMoney')}</span>
                </button>
              </div>
            </div>

            {destinationType === 'bank_account' ? (
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder={t('withdrawalFlow.placeholders.accountNumber')}
                  value={destinationDetails.accountNumber || ''}
                  onChange={(e) =>
                    setDestinationDetails((prev) => ({ ...prev, accountNumber: e.target.value }))
                  }
                  className="w-full p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
                />
                <input
                  type="text"
                  placeholder={t('withdrawalFlow.placeholders.bankName')}
                  value={destinationDetails.bankName || ''}
                  onChange={(e) =>
                    setDestinationDetails((prev) => ({ ...prev, bankName: e.target.value }))
                  }
                  className="w-full p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder={t('withdrawalFlow.placeholders.phoneNumber')}
                  value={destinationDetails.phoneNumber || ''}
                  onChange={(e) =>
                    setDestinationDetails((prev) => ({ ...prev, phoneNumber: e.target.value }))
                  }
                  className="w-full p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
                />
                <input
                  type="text"
                  placeholder={t('withdrawalFlow.placeholders.provider')}
                  value={destinationDetails.provider || ''}
                  onChange={(e) =>
                    setDestinationDetails((prev) => ({ ...prev, provider: e.target.value }))
                  }
                  className="w-full p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
            )}

            <button
              onClick={handleAmountSubmit}
              disabled={
                !state.amount || parseFloat(state.amount) <= 0 || parseFloat(state.amount) > balance
              }
              className="w-full p-3 rounded-lg bg-[var(--accent)] text-[var(--bg)] font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('withdrawalFlow.continue')}
            </button>
          </div>
        );

      case 'confirm':
        return (
          <div className="space-y-4">
            <button
              onClick={() => setStep('enter_amount')}
              className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--text)]"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('withdrawalFlow.back')}
            </button>

            <h3 className="text-lg font-semibold">{t('withdrawalFlow.confirmWithdrawal')}</h3>

            <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)] space-y-3">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">{t('withdrawalFlow.amount')}</span>
                <span className="font-medium">
                  {formatCurrency(parseFloat(state.amount), 'USD')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">{t('withdrawalFlow.anchor')}</span>
                <span className="font-medium">{state.selectedAnchor?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">{t('withdrawalFlow.receive')}</span>
                <span className="font-medium text-[var(--accent)]">
                  ≈ {formatCurrency(state.estimatedReceive, selectedCurrency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">{t('withdrawalFlow.destination')}</span>
                <span className="font-medium capitalize">{destinationType === 'bank_account' ? t('withdrawalFlow.bankAccount') : t('withdrawalFlow.mobileMoney')}</span>
              </div>
            </div>

            <button
              onClick={() => void handleConfirmWithdrawal()}
              disabled={state.isLoading}
              className="w-full p-3 rounded-lg bg-[var(--accent)] text-[var(--bg)] font-medium hover:opacity-90 disabled:opacity-50"
            >
              {state.isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('withdrawalFlow.processing')}
                </span>
              ) : (
                t('withdrawalFlow.confirmWithdrawal')
              )}
            </button>
          </div>
        );

      case 'processing':
        return (
          <div className="space-y-4 text-center">
            <div className="flex justify-center">
              <RefreshCw className="w-12 h-12 text-[var(--accent)] animate-spin" />
            </div>

            <h3 className="text-lg font-semibold">{t('withdrawalFlow.processingTitle')}</h3>
            <p className="text-sm text-[var(--muted)]">
              {t('withdrawalFlow.processingBody')}
            </p>

            <button
              onClick={openInteractiveUrl}
              className="flex items-center justify-center gap-2 w-full p-3 rounded-lg border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10"
            >
              <ExternalLink className="w-4 h-4" />
              {t('withdrawalFlow.openAnchor')}
            </button>

            <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
              <div className="flex justify-between mb-2">
                <span className="text-[var(--muted)]">{t('withdrawalFlow.status')}</span>
                <span className="font-medium capitalize">
                  {state.transaction?.status.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">{t('withdrawalFlow.transactionId')}</span>
                <span className="font-mono text-xs">{state.transaction?.id}</span>
              </div>
            </div>

            <button
              onClick={() => void cancelWithdrawal()}
              disabled={state.isLoading}
              className="text-sm text-[var(--muted)] hover:text-[var(--text)]"
            >
              {t('withdrawalFlow.cancelWithdrawal')}
            </button>
          </div>
        );

      case 'complete':
        return (
          <div className="space-y-4 text-center">
            <div className="flex justify-center">
              <CheckCircle2 className="w-16 h-16 text-[var(--success)]" />
            </div>

            <h3 className="text-lg font-semibold">{t('withdrawalFlow.complete')}</h3>
            <p className="text-sm text-[var(--muted)]">
              {t('withdrawalFlow.successProcessed', { amount: formatCurrency(parseFloat(state.amount), 'USD') })}
            </p>

            <button
              onClick={onClose}
              className="w-full p-3 rounded-lg bg-[var(--accent)] text-[var(--bg)] font-medium hover:opacity-90"
            >
              {t('withdrawalFlow.done')}
            </button>
          </div>
        );

      case 'failed':
        return (
          <div className="space-y-4 text-center">
            <div className="flex justify-center">
              <XCircle className="w-16 h-16 text-[var(--danger)]" />
            </div>

            <h3 className="text-lg font-semibold">{t('withdrawalFlow.failed')}</h3>
            <p className="text-sm text-[var(--muted)]">
              {state.error || t('withdrawalFlow.failureFallback')}
            </p>

            <div className="flex gap-2">
              <button
                onClick={handleReset}
                className="flex-1 p-3 rounded-lg border border-[var(--border)] hover:border-[var(--accent)]"
              >
                {t('withdrawalFlow.tryAgain')}
              </button>
              <button
                onClick={onClose}
                className="flex-1 p-3 rounded-lg bg-[var(--accent)] text-[var(--bg)] font-medium hover:opacity-90"
              >
                {t('withdrawalFlow.close')}
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--bg)] rounded-2xl border border-[var(--border)] max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold">{t('withdrawalFlow.cashOut')}</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)]"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>

          {/* Error Banner */}
          {state.error && state.step !== 'failed' && (
            <div className="mb-4 p-3 rounded-lg bg-[rgba(255,123,114,0.1)] border border-[rgba(255,123,114,0.2)]">
              <div className="flex items-center gap-2 text-[var(--danger)] text-sm">
                <AlertCircle className="w-4 h-4" />
                {state.error}
              </div>
            </div>
          )}

          {/* Step Content */}
          {renderStep()}
        </div>
      </div>
    </div>
  );
};

export default WithdrawalFlow;
