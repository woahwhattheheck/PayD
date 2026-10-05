import { useState, useEffect } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { downloadCertificate, getTransactionInfo } from '../services/certificateApi.js';
import { useNotification } from '../hooks/useNotification.js';

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
      notifyError('Missing Information', 'Transaction hash is required');
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
        'Missing Information',
        'Unable to determine employee and organization. Please provide employeeId and organizationId.'
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
        'Certificate Downloaded',
        'Payment certificate has been downloaded successfully'
      );
    } catch (error) {
      notifyError(
        'Download Failed',
        error instanceof Error ? error.message : 'Failed to download certificate'
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
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-info/10 hover:bg-info/20 text-info text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      title="Download Proof of Payment Certificate"
    >
      {isDownloading || isLoadingInfo ? (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>{isDownloading ? 'Generating...' : 'Loading...'}</span>
        </>
      ) : (
        <>
          <FileText className="w-3.5 h-3.5" />
          <span>Certificate</span>
        </>
      )}
    </button>
  );
}
