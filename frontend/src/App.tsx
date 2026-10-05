import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';

import EmployerLayout from './components/EmployerLayout';

import ErrorBoundary from './components/ErrorBoundary';
import ErrorFallback from './components/ErrorFallback';

import { useTranslation } from 'react-i18next';
import { contractService } from './services/contracts';

const Home = lazy(() => import('./pages/Home'));
const Debugger = lazy(() => import('./pages/Debugger'));
const PayrollScheduler = lazy(() => import('./pages/PayrollScheduler'));
const EmployeeEntry = lazy(() => import('./pages/EmployeeEntry'));
const HelpCenter = lazy(() => import('./pages/HelpCenter'));
const Settings = lazy(() => import('./pages/Settings'));
const WebhookSettings = lazy(() => import('./pages/WebhookSettings'));
const TwoFactorSettings = lazy(() => import('./pages/TwoFactorSettings'));
const CustomReportBuilder = lazy(() => import('./pages/CustomReportBuilder'));
const CrossAssetPayment = lazy(() => import('./pages/CrossAssetPayment'));
const TransactionHistory = lazy(() => import('./pages/TransactionHistory'));
const BulkPaymentTracker = lazy(() => import('./pages/BulkPaymentTracker'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));
const EmployeePortal = lazy(() => import('./pages/EmployeePortal'));
const Login = lazy(() => import('./pages/Login'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const TaxComplianceWizard = lazy(() => import('./pages/TaxComplianceWizard'));

function App() {
  const { t } = useTranslation();
  const routeFallback = <div role="status">Loading…</div>;

  // Initialize contract service on app startup
  useEffect(() => {
    contractService.initialize().catch((error) => {
      console.error('Failed to initialize contract service:', error);
    });
  }, []);

  return (
    <Routes>
      <Route
        element={
          <Suspense fallback={routeFallback}>
            <EmployerLayout />
          </Suspense>
        }
      >
        <Route
          path="/"
          element={
            <ErrorBoundary
              fallback={
                <ErrorFallback
                  title={t('errorFallback.homeTitle')}
                  description={t('errorFallback.homeDescription')}
                />
              }
            >
              <Home />
            </ErrorBoundary>
          }
        />
        <Route
          path="/payroll"
          element={
            <ErrorBoundary
              fallback={
                <ErrorFallback
                  title={t('errorFallback.payrollTitle')}
                  description={t('errorFallback.payrollDescription')}
                />
              }
            >
              <PayrollScheduler />
            </ErrorBoundary>
          }
        />
        <Route
          path="/employee"
          element={
            <ErrorBoundary
              fallback={
                <ErrorFallback
                  title={t('errorFallback.employeesTitle')}
                  description={t('errorFallback.employeesDescription')}
                />
              }
            >
              <EmployeeEntry />
            </ErrorBoundary>
          }
        />
        <Route
          path="/portal"
          element={
            <ErrorBoundary
              fallback={
                <ErrorFallback
                  title="Employee Portal Error"
                  description="Something went wrong loading your portal."
                />
              }
            >
              <EmployeePortal />
            </ErrorBoundary>
          }
        />
        <Route
          path="/reports"
          element={
            <ErrorBoundary fallback={<ErrorFallback />}>
              <CustomReportBuilder />
            </ErrorBoundary>
          }
        />
        <Route
          path="/debug"
          element={
            <ErrorBoundary
              fallback={
                <ErrorFallback
                  title={t('errorFallback.debuggerTitle')}
                  description={t('errorFallback.debuggerDescription')}
                />
              }
            >
              <Debugger />
            </ErrorBoundary>
          }
        />
        <Route
          path="/debug/:contractName"
          element={
            <ErrorBoundary
              fallback={
                <ErrorFallback
                  title={t('errorFallback.debuggerTitle')}
                  description={t('errorFallback.debuggerDescription')}
                />
              }
            >
              <Debugger />
            </ErrorBoundary>
          }
        />
        <Route
          path="/admin"
          element={
            <ErrorBoundary fallback={<ErrorFallback />}>
              <AdminPanel />
            </ErrorBoundary>
          }
        />
        <Route
          path="/settings"
          element={
            <ErrorBoundary fallback={<ErrorFallback onReset={() => {}} />}>
              <Settings />
            </ErrorBoundary>
          }
        />
        <Route
          path="/settings/webhooks"
          element={
            <ErrorBoundary fallback={<ErrorFallback onReset={() => {}} />}>
              <WebhookSettings />
            </ErrorBoundary>
          }
        />
        <Route
          path="/settings/two-factor"
          element={
            <ErrorBoundary fallback={<ErrorFallback onReset={() => {}} />}>
              <TwoFactorSettings />
            </ErrorBoundary>
          }
        />
        <Route
          path="/help"
          element={
            <ErrorBoundary fallback={<ErrorFallback onReset={() => {}} />}>
              <HelpCenter />
            </ErrorBoundary>
          }
        />
        <Route
          path="/cross-asset-payment"
          element={
            <ErrorBoundary fallback={<ErrorFallback onReset={() => {}} />}>
              <CrossAssetPayment />
            </ErrorBoundary>
          }
        />
        <Route
          path="/transactions"
          element={
            <ErrorBoundary fallback={<ErrorFallback onReset={() => {}} />}>
              <TransactionHistory />
            </ErrorBoundary>
          }
        />
        <Route
          path="/bulk-payments"
          element={
            <ErrorBoundary fallback={<ErrorFallback onReset={() => {}} />}>
              <BulkPaymentTracker />
            </ErrorBoundary>
          }
        />
        <Route
          path="/tax-compliance"
          element={
            <ErrorBoundary fallback={<ErrorFallback onReset={() => {}} />}>
              <TaxComplianceWizard />
            </ErrorBoundary>
          }
        />
      </Route>
      <Route
        path="/login"
        element={
          <Suspense fallback={routeFallback}>
            <Login />
          </Suspense>
        }
      />
      <Route
        path="/auth-callback"
        element={
          <Suspense fallback={routeFallback}>
            <AuthCallback />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
