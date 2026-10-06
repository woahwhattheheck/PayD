import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  ArrowRightLeft,
  ShieldCheck,
  Info,
  CheckCircle2,
  Radio,
  Wallet,
} from 'lucide-react';
import { useNotification } from '../hooks/useNotification';
import { useSocket } from '../hooks/useSocket';
import { useWallet } from '../hooks/useWallet';
import { useContractError } from '../hooks/useContractError';
import { ContractErrorPanel } from '../components/ContractErrorPanel';
import { contractService } from '../services/contracts';
import {
  fetchConversionPaths,
  submitCrossAssetPayment,
  type ConversionPath,
} from '../services/crossAssetPayment';

export default function CrossAssetPayment() {
  const { t } = useTranslation();
  const { notifySuccess, notifyError } = useNotification();
  const { address, signTransaction, connect } = useWallet();
  const { socket } = useSocket();
  const { contractError, handleContractError, clearContractError } = useContractError();
  const [assetIn, setAssetIn] = useState('USDC');
  const [assetOut, setAssetOut] = useState('XLM');
  const [amount, setAmount] = useState('');
  const [receiver, setReceiver] = useState('');

  const [paths, setPaths] = useState<ConversionPath[]>([]);
  const [selectedPathId, setSelectedPathId] = useState<string>('');
  const [isLoadingPaths, setIsLoadingPaths] = useState(false);
  const [submissionTxHash, setSubmissionTxHash] = useState<string | null>(null);
  const [liveStatusMessage, setLiveStatusMessage] = useState<string>(t('crossAssetPayment.waitingForSubmission'));
  const [status, setStatus] = useState<string>('idle');

  const selectedPath = useMemo<ConversionPath | null>(
    () => paths.find((path) => path.id === selectedPathId) || null,
    [paths, selectedPathId]
  );

  useEffect(() => {
    const parsedAmount = Number.parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setPaths([]);
      setSelectedPathId('');
      return;
    }

    setIsLoadingPaths(true);
    const timeout = setTimeout(() => {
      void (async () => {
        try {
          const nextPaths: ConversionPath[] = await fetchConversionPaths({
            fromAsset: assetIn,
            toAsset: assetOut,
            amount: parsedAmount,
          });
          setPaths(nextPaths);
          setSelectedPathId((current) => current || nextPaths[0]?.id || '');
        } catch (error) {
          notifyError(
            t('crossAssetPayment.pathfindingFailed'),
            error instanceof Error ? error.message : t('crossAssetPayment.pathfindingFailedBody')
          );
        } finally {
          setIsLoadingPaths(false);
        }
      })();
    }, 450);

    return () => {
      clearTimeout(timeout);
      setIsLoadingPaths(false);
    };
  }, [amount, assetIn, assetOut, notifyError, t]);

  useEffect(() => {
    if (!socket || !submissionTxHash) return;

    const handler = (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const record = payload as Record<string, unknown>;
      const txHash = (record.txHash as string | undefined) || (record.hash as string | undefined);
      if (!txHash || txHash !== submissionTxHash) return;

      const newStatus = (record.status as string | undefined) || 'unknown';
      setLiveStatusMessage(t('crossAssetPayment.updateStatus', { status: newStatus }));
      if (newStatus === 'confirmed' || newStatus === 'success') {
        notifySuccess(t('crossAssetPayment.paymentConfirmed'), t('crossAssetPayment.paymentConfirmedBody'));
        setStatus('success');
      }
    };

    const activeSocket = socket;
    activeSocket.on('cross-asset:update', handler);
    activeSocket.on('transaction:update', handler);
    activeSocket.emit('subscribe:transaction', submissionTxHash);

    return () => {
      activeSocket.off('cross-asset:update', handler);
      activeSocket.off('transaction:update', handler);
      activeSocket.emit('unsubscribe:transaction', submissionTxHash);
    };
  }, [notifySuccess, socket, submissionTxHash, t]);

  const handleInitiate = async () => {
    clearContractError();
    if (!address) {
      notifyError(t('crossAssetPayment.walletRequired'), t('crossAssetPayment.walletRequiredBody'));
      return;
    }
    if (!selectedPath) {
      notifyError(t('crossAssetPayment.noPath'), t('crossAssetPayment.noPathBody'));
      return;
    }

    const parsedAmount = Number.parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      notifyError(t('crossAssetPayment.invalidAmount'), t('crossAssetPayment.invalidAmountBody'));
      return;
    }

    setStatus('submitting');
    try {
      await contractService.initialize();
      const contractId =
        contractService.getContractId('cross_asset_payment', 'testnet') ||
        (import.meta.env.VITE_CROSS_ASSET_PAYMENT_CONTRACT_ID as string | undefined);
      if (!contractId) {
        throw new Error(t('crossAssetPayment.contractUnavailable'));
      }

      const result: { txHash: string } = await submitCrossAssetPayment({
        contractId,
        sourceAddress: address,
        signTransaction,
        amount: parsedAmount,
        fromAsset: assetIn,
        toAsset: assetOut,
        receiver,
        selectedPathId: selectedPath.id,
      });

      setSubmissionTxHash(result.txHash);
      setStatus('pending');
      setLiveStatusMessage(t('crossAssetPayment.waitingForSettlement'));
      notifySuccess(t('crossAssetPayment.paymentSubmitted'), t('crossAssetPayment.paymentSubmittedBody', { hash: result.txHash }));
    } catch (error) {
      console.error(error);
      setStatus('error');

      // Try to parse contract error if we have XDR (in a real scenario we'd get this from RPC)
      // For now, we simulate it if amount is 666
      if (amount === '666') {
        const mockErrorXdr = 'AAAABAAAAAEAAAABAAAABQ=='; // ScvError(ScError{type: SCE_CONTRACT, code: 5})
        handleContractError(mockErrorXdr);
      } else if (!contractError) {
        handleContractError(
          undefined,
          error instanceof Error
            ? error.message
            : t('crossAssetPayment.invocationFallback')
        );
      }

      notifyError(t('crossAssetPayment.paymentFailed'), t('crossAssetPayment.paymentFailedBody'));
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-(--text) p-8 font-sans">
      <div className="max-w-4xl mx-auto">
        <header className="mb-12 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
              {t('crossAssetPayment.title')}
            </h1>
            <p className="text-(--muted) mt-2">
              {t('crossAssetPayment.subtitle')}
            </p>
          </div>
          {!address ? (
            <button
              type="button"
              onClick={() => {
                void connect();
              }}
              className="px-4 py-2 rounded-full bg-accent text-on-accent font-semibold"
            >
              {t('crossAssetPayment.connectWallet')}
            </button>
          ) : (
            <span className="text-xs text-(--muted) font-mono">
              {address.slice(0, 6)}...{address.slice(-4)}
            </span>
          )}
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-[#16161a] border border-(--border) rounded-2xl p-8 shadow-2xl backdrop-blur-xl">
            <div className="space-y-6">
              <ContractErrorPanel error={contractError} />
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-(--muted) uppercase tracking-wider mb-2">
                    {t('crossAssetPayment.sendAsset')}
                  </label>
                  <select
                    value={assetIn}
                    onChange={(e) => setAssetIn(e.target.value)}
                    className="w-full bg-[#0a0a0c] border border-(--border) rounded-xl px-4 py-3 outline-none"
                  >
                    <option>USDC</option>
                    <option>XLM</option>
                  </select>
                </div>
                <div className="mt-6">
                  <ArrowRightLeft className="text-(--muted) h-6 w-6" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-(--muted) uppercase tracking-wider mb-2">
                    {t('crossAssetPayment.receiveAsset')}
                  </label>
                  <select
                    value={assetOut}
                    onChange={(e) => setAssetOut(e.target.value)}
                    className="w-full bg-[#0a0a0c] border border-(--border) rounded-xl px-4 py-3 outline-none"
                  >
                    <option>XLM</option>
                    <option>USDC</option>
                    <option>NGN</option>
                    <option>BRL</option>
                    <option>ARS</option>
                    <option>KES</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-(--muted) uppercase tracking-wider mb-2">
                  {t('crossAssetPayment.amountToSend')}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-[#0a0a0c] border border-(--border) rounded-xl px-4 py-3 text-2xl font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-(--muted) font-bold">
                    {assetIn}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-(--muted) uppercase tracking-wider mb-2">
                  {t('crossAssetPayment.receiverAddress')}
                </label>
                <input
                  type="text"
                  value={receiver}
                  onChange={(e) => setReceiver(e.target.value)}
                  placeholder={t('crossAssetPayment.receiverPlaceholder')}
                  className="w-full bg-[#0a0a0c] border border-(--border) rounded-xl px-4 py-3 outline-none"
                />
              </div>

              <button
                onClick={() => {
                  void handleInitiate();
                }}
                disabled={status === 'submitting' || status === 'pending' || !selectedPath}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 py-4 rounded-xl font-bold text-lg hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {status === 'submitting' ? (
                  <Loader2 className="animate-spin" />
                ) : !address ? (
                  <>
                    <Wallet className="w-5 h-5" /> {t('crossAssetPayment.connectWalletToSwap')}
                  </>
                ) : (
                  t('crossAssetPayment.simulateSubmit')
                )}
              </button>
            </div>
          </div>

          <div className="space-y-8">
            {/* Quote Panel */}
            {(isLoadingPaths || paths.length > 0) && (
              <div className="bg-(--surface) border border-(--border) shadow-(--shadow-sm) rounded-2xl p-8 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h3 className="text-lg font-bold flex items-center gap-2 mb-6">
                  <ShieldCheck className="text-emerald-400" />
                  {t('crossAssetPayment.availablePaths')}
                </h3>
                {isLoadingPaths ? (
                  <div className="flex items-center gap-2 text-sm text-(--muted)">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('crossAssetPayment.fetchingPaths')}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {paths.map((path) => (
                      <button
                        key={path.id}
                        type="button"
                        onClick={() => setSelectedPathId(path.id)}
                        className={`w-full text-left rounded-xl border px-4 py-3 transition ${selectedPathId === path.id ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-(--border) hover:border-(--border-hi)'}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold flex items-center gap-2">
                            <Radio className="h-4 w-4" />
                            {path.hops.join(' -> ')}
                          </span>
                          <span className="text-xs text-(--muted)">
                            {path.rate.toFixed(4)} {t('crossAssetPayment.rateLabel')}
                          </span>
                        </div>
                        <div className="mt-2 text-xs text-(--muted)">
                          {t('crossAssetPayment.pathFeeSlippage', { fee: path.fee.toFixed(4), asset: assetOut, slippage: path.slippage.toFixed(2) })}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedPath && (
              <div className="bg-[#16161a] border border-(--border) rounded-2xl p-6">
                <h4 className="font-bold mb-3">{t('crossAssetPayment.settlementPreview')}</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-(--muted)">
                    <span>{t('crossAssetPayment.expectedDelivery')}</span>
                    <span className="text-(--text) font-mono">
                      {selectedPath.estimatedDestinationAmount.toLocaleString()} {assetOut}
                    </span>
                  </div>
                  <div className="flex justify-between text-(--muted)">
                    <span>{t('crossAssetPayment.fee')}</span>
                    <span className="text-(--text)">
                      {selectedPath.fee.toFixed(4)} {assetOut}
                    </span>
                  </div>
                  <div className="flex justify-between text-(--muted)">
                    <span>{t('crossAssetPayment.slippage')}</span>
                    <span className="text-(--text)">{selectedPath.slippage.toFixed(2)}%</span>
                  </div>
                </div>
              </div>
            )}

            {status !== 'idle' && (
              <div className="bg-[#16161a] border border-blue-900/30 rounded-2xl p-8 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4">
                  <div
                    className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest ${status === 'completed' || status === 'confirmed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'}`}
                  >
                    {status}
                  </div>
                </div>
                <h3 className="text-lg font-bold mb-6">{t('crossAssetPayment.contractStatus')}</h3>

                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center ${status !== 'error' ? 'bg-emerald-500' : 'bg-(--muted)/40'}`}
                    >
                      <CheckCircle2 className="h-5 w-5 text-(--text)" />
                    </div>
                    <div>
                      <p className="font-bold">{t('crossAssetPayment.authentication')}</p>
                      <p className="text-xs text-(--muted)">{t('crossAssetPayment.signerReady')}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center ${status === 'pending' || status === 'completed' || status === 'confirmed' ? 'bg-emerald-500' : 'bg-(--muted)/40'}`}
                    >
                      {status === 'pending' ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-5 w-5 text-(--text)" />
                      )}
                    </div>
                    <div>
                      <p className="font-bold">{t('crossAssetPayment.initiation')}</p>
                      <p className="text-xs text-(--muted)">
                        {t('crossAssetPayment.simulatedSubmitted')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 opacity-50">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center ${status === 'completed' || status === 'confirmed' ? 'bg-emerald-500' : 'bg-(--muted)/40'}`}
                    >
                      <CheckCircle2 className="h-5 w-5 text-(--text)" />
                    </div>
                    <div>
                      <p className="font-bold">{t('crossAssetPayment.settlement')}</p>
                      <p className="text-xs text-(--muted)">{liveStatusMessage}</p>
                    </div>
                  </div>
                </div>

                {submissionTxHash && (
                  <div className="mt-8 pt-6 border-t border-(--border)">
                    <p className="text-xs text-(--muted) uppercase font-bold mb-2">
                      {t('crossAssetPayment.transactionHash')}
                    </p>
                    <p className="text-xs font-mono break-all text-blue-400">{submissionTxHash}</p>
                  </div>
                )}
              </div>
            )}

            {!selectedPath && !isLoadingPaths && (
              <div className="bg-blue-900/10 border border-blue-900/30 rounded-2xl p-6 flex gap-4">
                <Info className="text-blue-400 shrink-0" />
                <p className="text-sm text-blue-300">
                  {t('crossAssetPayment.changePrompt')}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
