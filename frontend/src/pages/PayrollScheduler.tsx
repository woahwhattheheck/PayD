import * as React from 'react';
import { useEffect, useState } from 'react';
import { AutosaveIndicator } from '../components/AutosaveIndicator';
import { useAutosave } from '../hooks/useAutosave';
import { useTransactionSimulation } from '../hooks/useTransactionSimulation';
import { TransactionSimulationPanel } from '../components/TransactionSimulationPanel';
import { ContractErrorPanel } from '../components/ContractErrorPanel';
import { useNotification } from '../hooks/useNotification';
import { useContractError } from '../hooks/useContractError';
import { useSocket } from '../hooks/useSocket';
import {
  createClaimableBalanceTransaction,
  generateWallet,
  checkTrustline,
} from '../services/stellar';
import { useTranslation } from 'react-i18next';
import { Card, Heading, Text, Button, Input, Select } from '@stellar/design-system';
import { SchedulingWizard } from '../components/SchedulingWizard';
import { CountdownTimer } from '../components/CountdownTimer';
import {
  getSchedules,
  createSchedule,
  deleteSchedule,
  ScheduleRecord,
} from '../services/scheduleApi';
import { BulkPaymentStatusTracker } from '../components/BulkPaymentStatusTracker';

interface EmployeePreference {
  id: string;
  name: string;
  amount: string;
  currency: string;
  wallet: string;
}

interface SchedulingConfig {
  frequency: 'weekly' | 'biweekly' | 'monthly';
  dayOfWeek?: number;
  dayOfMonth?: number;
  timeOfDay: string;
  preferences: EmployeePreference[];
}

interface PayrollFormState {
  employeeName: string;
  walletAddress: string;
  amount: string;
  frequency: 'weekly' | 'monthly';
  startDate: string;
  memo?: string;
}

const formatDate = (dateString: string) => {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

interface PendingClaim {
  id: string;
  employeeName: string;
  walletAddress: string;
  amount: string;
  dateScheduled: string;
  claimantPublicKey: string;
  status: string;
}

// Mock employer secret key for simulation purposes
const MOCK_EMPLOYER_SECRET = 'SD3X5K7G7XV4K5V3M2G5QXH434M3VX6O5P3QVQO3L2PQSQQQQQQQQQQQ';

const initialFormState: PayrollFormState = {
  employeeName: '',
  walletAddress: '',
  amount: '',
  frequency: 'monthly',
  startDate: '',
  memo: '',
};

export default function PayrollScheduler() {
  const { t } = useTranslation();
  const { notifySuccess, notifyError, notifyWarning } = useNotification();
  const { socket, subscribeToTransaction, unsubscribeFromTransaction } = useSocket();
  const [formData, setFormData] = useState<PayrollFormState>(initialFormState);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [activeSchedule, setActiveSchedule] = useState<{
    frequency: string;
    timeOfDay: string;
  } | null>(null);
  const [nextRunDate, setNextRunDate] = useState<Date | null>(null);
  const [trustlineMissing, setTrustlineMissing] = useState(false);
  const { contractError, handleContractError, clearContractError } = useContractError();

  const [dbSchedules, setDbSchedules] = useState<ScheduleRecord[]>([]);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(false);
  const [pendingClaims, setPendingClaims] = useState<PendingClaim[]>(() => {
    const saved = localStorage.getItem('pending-claims');
    if (saved) {
      try {
        return JSON.parse(saved) as PendingClaim[];
      } catch {
        return [];
      }
    }
    return [];
  });

  const { saving, lastSaved, loadSavedData } = useAutosave<PayrollFormState>(
    'payroll-scheduler-draft',
    formData
  );

  const {
    simulate,
    resetSimulation,
    isSimulating,
    result: simulationResult,
    error: simulationProcessError,
    isSuccess: simulationPassed,
  } = useTransactionSimulation();

  useEffect(() => {
    const saved = loadSavedData();
    if (saved) {
      setFormData(saved);
    }
    void fetchActiveSchedules();
  }, [loadSavedData]);

  const fetchActiveSchedules = async () => {
    setIsLoadingSchedules(true);
    try {
      const { schedules } = await getSchedules({ status: 'active' });
      setDbSchedules(schedules);
      if (schedules.length > 0) {
        // Set the most imminent one as active for the countdown
        const imminent = schedules[0];
        setActiveSchedule({ frequency: imminent.frequency, timeOfDay: imminent.timeOfDay });
        setNextRunDate(new Date(imminent.nextRunTimestamp));
      } else {
        setActiveSchedule(null);
        setNextRunDate(null);
      }
    } catch (err) {
      console.error('Failed to fetch schedules:', err);
    } finally {
      setIsLoadingSchedules(false);
    }
  };

  const handleScheduleComplete = async (config: SchedulingConfig) => {
    try {
      const input = {
        frequency: config.frequency,
        timeOfDay: config.timeOfDay,
        startDate: new Date().toISOString().split('T')[0], // Default to today
        paymentConfig: {
          recipients: config.preferences.map((p: EmployeePreference) => ({
            walletAddress: p.wallet,
            amount: p.amount,
            assetCode: p.currency,
          })),
        },
      };

      const result = await createSchedule(input);
      notifySuccess('Payroll schedule configured!', `Ref ID: ${result.id}`);
      setIsWizardOpen(false);
      void fetchActiveSchedules();
    } catch (err) {
      console.error('Failed to create schedule:', err);
      notifyError('Failed to create schedule', 'Please try again later.');
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev: PayrollFormState) => ({ ...prev, [name]: value }));
    if (simulationResult) resetSimulation();
    clearContractError();
    setTrustlineMissing(false);
  };

  useEffect(() => {
    if (!socket) return;

    const handleTransactionUpdate = (data: { transactionId: string; status: string }) => {
      console.log('Received transaction update:', data);
      setPendingClaims((prev: PendingClaim[]) =>
        (prev || []).map((claim: PendingClaim) =>
          claim.id === data.transactionId ? { ...claim, status: data.status } : claim
        )
      );

      if (data.status === 'confirmed') {
        notifySuccess('Payment confirmed!', `TX: ${data.transactionId}`);
      }
    };

    const activeSocket = socket;

    activeSocket.on('transaction:update', handleTransactionUpdate);

    return () => {
      activeSocket.off('transaction:update', handleTransactionUpdate);
    };
  }, [socket, notifySuccess]);

  const handleInitialize = async () => {
    if (!formData.employeeName || !formData.amount || !formData.walletAddress) {
      notifyError(
        'Missing required fields',
        'Please provide employee name, amount, and wallet address.'
      );
      return;
    }

    // Pre-flight check: Verify USDC trustline
    const hasTrustline = await checkTrustline(formData.walletAddress, 'USDC');
    if (!hasTrustline) {
      setTrustlineMissing(true);
      notifyWarning(
        'Trustline missing!',
        `${formData.employeeName} does not have a USDC trustline. You can proceed, but the payment will be held as a claimable balance.`
      );
    } else {
      setTrustlineMissing(false);
    }

    // Mock XDR for simulation demonstration
    const mockXdr =
      'AAAAAgAAAABmF8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    const simResult = await simulate({ envelopeXdr: mockXdr });

    // If simulation result contains a resultXdr error, parse it
    if (simResult && !simResult.success && simResult.resultXdr) {
      handleContractError(simResult.resultXdr);
    } else {
      clearContractError();
    }
  };

  const handleBroadcast = async () => {
    setIsBroadcasting(true);
    clearContractError();
    try {
      const recipientPublicKey = formData.walletAddress || generateWallet().publicKey;

      // Integrate claimable balance logic from Issue #44
      const result = createClaimableBalanceTransaction(
        MOCK_EMPLOYER_SECRET,
        recipientPublicKey,
        String(formData.amount),
        'USDC'
      );

      if (!result.success) {
        handleContractError(undefined, 'Failed to create claimable balance');
        throw new Error('Failed to create claimable balance');
      }

      // Simulate a brief delay for network broadcast
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Simulate a contract error for testing if amount is 403
      if (formData.amount === '403') {
        const mockErrorXdr = 'AAAABAAAAAEAAAABAAAABQ=='; // ScvError(ScError{type: SCE_CONTRACT, code: 5})
        handleContractError(mockErrorXdr);
        throw new Error('Contract invocation failed');
      }

      // Add to pending claims
      const newClaim: PendingClaim = {
        id: Math.random().toString(36).substr(2, 9),
        employeeName: formData.employeeName,
        walletAddress: formData.walletAddress,
        amount: formData.amount,
        dateScheduled: formData.startDate || new Date().toISOString().split('T')[0],
        claimantPublicKey: recipientPublicKey,
        status: 'Pending Claim',
      };

      const updatedClaims = [...pendingClaims, newClaim];
      setPendingClaims(updatedClaims);
      localStorage.setItem('pending-claims', JSON.stringify(updatedClaims));

      // Subscribe to updates for this new claim
      subscribeToTransaction(newClaim.id);

      notifySuccess(
        'Broadcast successful!',
        `Claimable balance created for ${formData.employeeName}`
      );

      // Trigger Webhook Event (Internal simulation)
      try {
        await fetch('http://localhost:3001/api/webhooks/test-trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'payment.completed',
            payload: {
              id: newClaim.id,
              employeeName: newClaim.employeeName,
              amount: newClaim.amount,
              status: 'created',
            },
          }),
        });
      } catch {
        console.warn('Webhook test-trigger skipped (Backend might not be running)');
      }

      resetSimulation();
      setFormData(initialFormState);
    } catch (err) {
      console.error(err);
      notifyError(
        'Broadcast failed',
        'A contract error occurred. Please review the details below.'
      );
    } finally {
      setIsBroadcasting(false);
    }
  };

  const handleCancelSchedule = async (id: number) => {
    try {
      await deleteSchedule(id);
      notifySuccess('Schedule cancelled', 'The automation has been halted.');
      void fetchActiveSchedules();
    } catch (err) {
      console.error('Failed to cancel schedule:', err);
      notifyError('Cancellation failed', 'Unable to reach the server.');
    }
  };

  const handleRemoveClaim = (id: string) => {
    unsubscribeFromTransaction(id);
    const updatedClaims = pendingClaims.filter((c) => c.id !== id);
    setPendingClaims(updatedClaims);
    localStorage.setItem('pending-claims', JSON.stringify(updatedClaims));
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-start p-4 sm:p-6 lg:p-12 max-w-6xl mx-auto w-full">
      <div className="w-full mb-6 sm:mb-8 lg:mb-12 flex flex-col sm:flex-row sm:items-end sm:justify-between border-b border-hi pb-4 sm:pb-6 lg:pb-8 gap-4">
        <div className="flex-1 min-w-0">
          <Heading
            as="h1"
            size="lg"
            weight="bold"
            addlClassName="mb-2 tracking-tight text-2xl sm:text-3xl lg:text-4xl"
          >
            {t('payroll.title', 'Workforce')}{' '}
            <span className="text-accent">{t('payroll.titleHighlight', 'Scheduler')}</span>
          </Heading>
          <Text
            as="p"
            size="sm"
            weight="regular"
            addlClassName="text-muted font-mono tracking-wider uppercase text-xs sm:text-sm"
          >
            {}
            {t('payroll.subtitle', 'Automated distribution engine')}
          </Text>
        </div>
        <div className="flex flex-row sm:flex-col items-center sm:items-end gap-3 sm:gap-2">
          <AutosaveIndicator saving={saving} lastSaved={lastSaved} />
          <button
            onClick={() => setIsWizardOpen(true)}
            className="p-2.5 rounded-lg hover:bg-(--surface-hi) transition-colors touch-manipulation"
            style={{ minHeight: '44px', minWidth: '44px' }}
            aria-label="Open scheduling wizard"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
        </div>
      </div>

      {activeSchedule && (
        <div className="w-full mb-6 sm:mb-8 lg:mb-12 bg-black/20 border border-success/30 rounded-xl sm:rounded-2xl p-4 sm:p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 sm:gap-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-success"></div>
          <div className="flex-1 min-w-0">
            <h3 className="text-success font-black text-base sm:text-lg mb-1 flex items-center gap-2">
              <svg
                width="16"
                height="16"
                className="sm:w-[18px] sm:h-[18px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Automation Active
            </h3>
            <p className="text-muted text-xs sm:text-sm break-words">
              Scheduled to run{' '}
              <span className="font-bold text-text capitalize">{activeSchedule.frequency}</span> at{' '}
              <span className="font-mono text-text">{activeSchedule.timeOfDay}</span>
            </p>
          </div>
          <div className="bg-bg border border-hi rounded-xl p-3 sm:p-4 shadow-inner w-full md:w-auto">
            <span className="block text-[10px] uppercase font-bold text-muted mb-2 tracking-widest text-center">
              Next Scheduled Run
            </span>
            <CountdownTimer targetDate={nextRunDate} />
          </div>
        </div>
      )}

      {isWizardOpen ? (
        <SchedulingWizard
          onComplete={(config) => {
            void handleScheduleComplete(config);
          }}
          onCancel={() => setIsWizardOpen(false)}
        />
      ) : (
        <div className="w-full grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6 lg:gap-8 mb-6 sm:mb-8 lg:mb-12">
          <div className="lg:col-span-3">
            <form
              onSubmit={(e: React.FormEvent) => {
                e.preventDefault();
                void handleInitialize();
              }}
              className="w-full grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 card glass noise p-4 sm:p-6"
            >
              <div className="md:col-span-2">
                <ContractErrorPanel error={contractError} />
                <Input
                  id="employeeName"
                  fieldSize="md"
                  label={t('payroll.employeeName', 'Employee Name')}
                  name="employeeName"
                  value={formData.employeeName}
                  onChange={handleChange}
                  placeholder="e.g. Satoshi Nakamoto"
                />
              </div>

              <div className="md:col-span-2">
                <Input
                  id="walletAddress"
                  fieldSize="md"
                  label={t('payroll.walletAddress', 'Wallet Address')}
                  name="walletAddress"
                  value={formData.walletAddress}
                  onChange={handleChange}
                  placeholder="G..."
                />
              </div>

              <div>
                <Input
                  id="amount"
                  fieldSize="md"
                  label={t('payroll.amountLabel', 'Amount (USD equivalent)')}
                  name="amount"
                  value={formData.amount}
                  onChange={handleChange}
                  placeholder="0.00"
                />
              </div>

              <div>
                <Select
                  id="frequency"
                  fieldSize="md"
                  label={t('payroll.distributionFrequency', 'Distribution Frequency')}
                  name="frequency"
                  value={formData.frequency}
                  onChange={handleChange}
                >
                  {}
                  <option value="weekly">{t('payroll.frequencyWeekly', 'Weekly')}</option>
                  {}
                  <option value="monthly">{t('payroll.frequencyMonthly', 'Monthly')}</option>
                </Select>
              </div>

              <div className="md:col-span-2">
                <Input
                  id="startDate"
                  fieldSize="md"
                  label={t('payroll.commencementDate', 'Commencement Date')}
                  name="startDate"
                  type="date"
                  value={formData.startDate}
                  onChange={handleChange}
                />
              </div>

              <div className="md:col-span-2 pt-4">
                {!simulationPassed ? (
                  <Button
                    type="submit"
                    disabled={isSimulating}
                    variant="primary"
                    size="md"
                    isFullWidth
                  >
                    {isSimulating
                      ? 'Simulating...'
                      : t('payroll.submit', 'Initialize and Validate')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={() => {
                      void handleBroadcast();
                    }}
                    disabled={isBroadcasting}
                    variant="primary"
                    size="md"
                    isFullWidth
                  >
                    {isBroadcasting ? 'Broadcasting...' : 'Confirm & Broadcast to Network'}
                  </Button>
                )}
              </div>
            </form>
          </div>

          <div className="lg:col-span-2 flex flex-col gap-6">
            <TransactionSimulationPanel
              result={simulationResult}
              isSimulating={isSimulating}
              processError={simulationProcessError}
              onReset={resetSimulation}
            />

            <div className="card glass noise h-fit">
              <Heading as="h3" size="xs" weight="bold" addlClassName="mb-4 flex items-center gap-2">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                Pre-flight Validation
              </Heading>

              {trustlineMissing && (
                <div className="mb-4 p-3 rounded-lg bg-orange-500/10 border border-orange-500/30 flex items-start gap-3">
                  <div className="mt-0.5">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#f97316"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  </div>
                  <div>
                    <Text as="p" size="xs" weight="bold" addlClassName="text-orange-500 mb-1">
                      Trustline Missing
                    </Text>
                    <Text
                      as="p"
                      size="xs"
                      weight="regular"
                      addlClassName="text-orange-200/70 leading-relaxed"
                    >
                      Employee does not have a USDC trustline. Payment will be held as a claimable
                      balance.
                    </Text>
                  </div>
                </div>
              )}

              <Text
                as="p"
                size="xs"
                weight="regular"
                addlClassName="text-muted leading-relaxed mb-4"
              >
                All transactions are simulated via Stellar Horizon before submission. This catches
                common errors like:
              </Text>
              <ul className="text-xs text-muted space-y-2 list-disc pl-4 font-medium">
                <li>Insufficient XLM balance for fees</li>
                <li>Invalid sequence numbers</li>
                <li className={trustlineMissing ? 'text-orange-400 font-bold' : ''}>
                  Missing trustlines for tokens
                </li>
                <li>Account eligibility status</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="w-full mb-6 sm:mb-8 lg:mb-12">
        <Heading as="h2" size="sm" weight="bold" addlClassName="mb-4 text-lg sm:text-xl">
          Scheduled Automations
        </Heading>
        {isLoadingSchedules ? (
          <div className="flex justify-center p-8">
            <span className="animate-spin text-accent">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M22 12a10 10 0 0 1-10 10" />
              </svg>
            </span>
          </div>
        ) : dbSchedules.length === 0 ? (
          <Card>
            <Text
              as="p"
              size="sm"
              weight="regular"
              addlClassName="text-muted p-4 text-xs sm:text-sm"
            >
              No active payroll schedules found in the database.
            </Text>
          </Card>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {dbSchedules.map((schedule) => (
              <li key={schedule.id} className="card glass noise relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-3">
                  <span className="px-2 py-0.5 rounded-full bg-success/20 text-success text-[10px] font-bold uppercase tracking-widest">
                    {schedule.status}
                  </span>
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center text-accent">
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </div>
                    <div>
                      <h4 className="font-bold text-base capitalize">
                        {schedule.frequency} Distribution
                      </h4>
                      <p className="text-xs text-muted font-mono">{schedule.timeOfDay} UTC</p>
                    </div>
                  </div>

                  <div className="space-y-2 mb-6">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted">Next Run</span>
                      <span className="font-mono text-text">
                        {new Date(schedule.nextRunTimestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted">Recipients</span>
                      <span className="font-bold text-text">
                        {schedule.paymentConfig.recipients.length} Employees
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      void handleCancelSchedule(schedule.id);
                    }}
                    className="w-full py-3 bg-danger/10 hover:bg-danger/20 text-danger text-xs font-bold rounded-lg transition-colors touch-manipulation min-h-[44px]"
                  >
                    Cancel Automation
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="w-full mb-6 sm:mb-8 lg:mb-12">
        <Heading as="h2" size="sm" weight="bold" addlClassName="mb-4 text-lg sm:text-xl">
          Recent Manual Claims
        </Heading>
        <Card>
          {pendingClaims.length === 0 ? (
            <Text
              as="p"
              size="sm"
              weight="regular"
              addlClassName="text-muted p-4 text-xs sm:text-sm"
            >
              No recent manual claimable balances.
            </Text>
          ) : (
            <ul className="flex flex-col gap-3 sm:gap-4 p-4 sm:p-6">
              {pendingClaims.map((claim: PendingClaim) => (
                <li key={claim.id} className="border border-hi p-3 sm:p-4 rounded-lg">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 sm:gap-0 mb-3">
                    <Heading as="h3" size="xs" weight="bold" addlClassName="text-sm sm:text-base">
                      {claim.employeeName}
                    </Heading>
                    <span className="bg-accent/20 text-accent px-2 py-1 rounded-full text-xs self-start sm:self-auto">
                      {claim.status}
                    </span>
                  </div>
                  <div className="text-xs sm:text-sm text-muted flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <Text as="p" size="xs" weight="regular">
                        Amount: {claim.amount} USDC
                      </Text>
                      <Text as="p" size="xs" weight="regular">
                        Scheduled: {formatDate(claim.dateScheduled)}
                      </Text>
                      <Text
                        as="p"
                        size="xs"
                        weight="regular"
                        addlClassName="font-mono truncate max-w-[200px]"
                        title={claim.walletAddress}
                      >
                        To: {claim.walletAddress}
                      </Text>
                    </div>
                    <button
                      onClick={() => handleRemoveClaim(claim.id)}
                      className="text-danger hover:text-danger/80 text-sm font-medium py-2 px-4 rounded-lg hover:bg-danger/10 transition-colors touch-manipulation min-h-[44px] self-start sm:self-auto"
                    >
                      Cancel
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="w-full mb-6 sm:mb-8 lg:mb-12">
        <BulkPaymentStatusTracker organizationId={1} />
      </div>
    </div>
  );
}
