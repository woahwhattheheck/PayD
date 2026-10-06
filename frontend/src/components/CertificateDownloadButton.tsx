import { useState, useEffect } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { downloadCertificate, getTransactionInfo } from '../services/certificateApi.js';
import { useNotification } from '../hooks/useNotification.js';
import { useTranslation } from 'react-i18next';

interface CertificateDownloadButtonProps {
  transactionHash: string;
  employeeId?: number;
  organizationId?: number;
  disabled?: boolean;
}

export function CertificateDownloadButton({
  transactionHash,
  employeeId: propEmployeeId,
  organizationId: propOrganizationId,
  disabled = false,
}: CertificateDownloadButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [employeeId, setEmployeeId] = useState<number | undefined>(propEmployeeId);
  const [organizationId, setOrganizationId] = useState<number | undefined>(propOrganizationId);
  const { notifySuccess, notifyError } = useNotification();
  const { t } = useTranslation();

  // Auto-fetch employee and organization info if not provided
  useEffect(() => {
    if (transactionHash && !employeeId && !organizationId && !isLoadingInfo) {
      setIsLoadingInfo(true);
      getTransactionInfo(transactionHash)
        .then((info) => {
          if (info) {
            setEmployeeId(info.employeeId);
            setOrganizationId(info.organizationId);
          }
        })
        .catch(() => {
          // Silently fail - user can still try to download
        })
        .finally(() => {
          setIsLoadingInfo(false);
        });
    }
  }, [transactionHash, employeeId, organizationId, isLoadingInfo]);

  const handleDownload = async () => {
    if (!transactionHash) {
      notifyError(t('certificate.missingInformation'), t('certificate.transactionHashRequired'));
      return;
    }

    // If we still don't have employeeId/orgId, try fetching one more time
    let finalEmployeeId = employeeId;
    let finalOrganizationId = organizationId;

    if (!finalEmployeeId || !finalOrganizationId) {
      setIsLoadingInfo(true);
      try {
        const info = await getTransactionInfo(transactionHash);
        if (info) {
          finalEmployeeId = info.employeeId;
          finalOrganizationId = info.organizationId;
          setEmployeeId(info.employeeId);
          setOrganizationId(info.organizationId);
        }
      } catch {
        // Continue to show error below
      } finally {
        setIsLoadingInfo(false);
      }
    }

    if (!finalEmployeeId || !finalOrganizationId) {
      notifyError(
        t('certificate.missingInformation'),
        t('certificate.identityUnavailable')
      );
      return;
    }

    setIsDownloading(true);
    try {
      await downloadCertificate({
        employeeId: finalEmployeeId,
        transactionHash,
        organizationId: finalOrganizationId,
      });
      notifySuccess(
        t('certificate.downloadedTitle'),
        t('certificate.downloadedBody')
      );
    } catch (error) {
      notifyError(
        t('certificate.downloadFailed'),
        error instanceof Error ? error.message : t('certificate.downloadFailedBody')
      );
    } finally {
      setIsDownloading(false);
    }
  };

  if (!transactionHash) {
    return null;
  }

  const isDisabled = disabled || isDownloading || isLoadingInfo;

  return (
    <button
      onClick={() => {
        void handleDownload();
      }}
      disabled={isDisabled}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      title={t('certificate.downloadTitle')}
    >
      {isDownloading || isLoadingInfo ? (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>{isDownloading ? t('certificate.generating') : t('certificate.loading')}</span>
        </>
      ) : (
        <>
          <FileText className="w-3.5 h-3.5" />
          <span>{t('certificate.label')}</span>
        </>
      )}
    </button>
  );
}
