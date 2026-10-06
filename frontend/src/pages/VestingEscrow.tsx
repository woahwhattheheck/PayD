import { useState, useEffect } from 'react';
import { Heading, Text } from '@stellar/design-system';
import { useNotification } from '../hooks/useNotification';
import { useTransactionSimulation } from '../hooks/useTransactionSimulation';
import { TransactionSimulationPanel } from '../components/TransactionSimulationPanel';
import { VestingGrantList } from '../components/vesting/VestingGrantList';
import { VestingGrantForm } from '../components/vesting/VestingGrantForm';
import { useTranslation } from 'react-i18next';

interface VestingGrantFormData {
  employeeAddress: string;
  totalAmount: string;
  startDate: string;
  cliffDate: string;
  durationYears: string;
}

interface VestingGrant {
  id: string;
  employeeName: string;
  totalAmount: number;
  vestedAmount: number;
  cliffDate: string;
  startDate: string;
  duration: string;
}

export default function VestingEscrow() {
  const { t } = useTranslation();
  const { notifySuccess, notifyError } = useNotification();
  const {
    simulate,
    resetSimulation,
    isSimulating,
    result: simulationResult,
    error: simulationError,
    isSuccess: simulationPassed,
  } = useTransactionSimulation();

  const [grants, setGrants] = useState<VestingGrant[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Mock initial load
  useEffect(() => {
    // In a real implementation, we would fetch this from the contract/backend
    setGrants([
      {
        id: '1',
        employeeName: 'Alice Johnson',
        totalAmount: 50000,
        vestedAmount: 12500,
        cliffDate: '2025-01-01',
        startDate: '2024-01-01',
        duration: '4 Years',
      },
      {
        id: '2',
        employeeName: 'Bob Smith',
        totalAmount: 100000,
        vestedAmount: 0,
        cliffDate: '2026-03-01',
        startDate: '2025-03-01',
        duration: '4 Years',
      },
    ]);
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleCreateGrant = async (_data: VestingGrantFormData): Promise<void> => {
    setIsSubmitting(true);
    try {
      // Mock XDR for simulation
      const mockXdr =
        'AAAAAgAAAABmF8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      await simulate({ envelopeXdr: mockXdr });
      notifySuccess(t('vesting.notifications.simReadyTitle'), t('vesting.notifications.simReadyBody'));
    } catch {
      notifyError(t('vesting.notifications.simFailedTitle'), t('vesting.notifications.simFailedBody'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClaim = () => {
    notifySuccess(t('vesting.notifications.claimTitle'), t('vesting.notifications.claimBody'));
    // Real logic would invoke the claim entry point
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-start p-12 max-w-6xl mx-auto w-full">
      <div className="w-full mb-12 border-b border-hi pb-8">
        <Heading as="h1" size="lg" weight="bold" addlClassName="mb-2 tracking-tight">
          {t('vesting.page.titlePrefix')} <span className="text-accent">{t('vesting.page.titleHighlight')}</span>
        </Heading>
        <Text
          as="p"
          size="sm"
          weight="regular"
          addlClassName="text-muted font-mono tracking-wider uppercase"
        >
          {t('vesting.page.subtitle')}
        </Text>
      </div>

      <div className="w-full grid grid-cols-1 lg:grid-cols-5 gap-8">
        <div className="lg:col-span-3 space-y-8">
          <VestingGrantList grants={grants} onClaim={handleClaim} />

          <TransactionSimulationPanel
            result={simulationResult}
            isSimulating={isSimulating}
            processError={simulationError}
            onReset={resetSimulation}
          />

          {simulationPassed && (
            <div className="flex justify-end mt-4">
              <button
                className="btn btn-primary w-full py-4 text-lg font-bold"
                onClick={() =>
                  notifySuccess(
                    t('vesting.notifications.createdTitle'),
                    t('vesting.notifications.createdBody')
                  )
                }
              >
                {t('vesting.page.confirmCreate')}
              </button>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          <VestingGrantForm
            onSubmit={(data) => {
              void handleCreateGrant(data);
            }}
            isSubmitting={isSubmitting}
          />
        </div>
      </div>
    </div>
  );
}
