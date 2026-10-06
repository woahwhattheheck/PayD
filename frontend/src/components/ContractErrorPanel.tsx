import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Copy, AlertTriangle, Info } from 'lucide-react';
import { ContractErrorDetails } from '../utils/contractErrorParser';
import { useTranslation } from 'react-i18next';
import styles from './ContractErrorPanel.module.css';

interface Props {
  error: ContractErrorDetails | null;
  className?: string;
}

export const ContractErrorPanel: React.FC<Props> = ({ error, className = '' }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const { t } = useTranslation();

  if (!error) return null;

  const handleCopyRaw = () => {
    if (error.rawXdr) {
      void navigator.clipboard.writeText(error.rawXdr);
    }
  };

  const isUnknown = error.code === 'UNKNOWN_FORMAT' || error.code === 'UNPARSEABLE_XDR';
  const message = error.messageKey
    ? t(error.messageKey, { ...error.translationValues, defaultValue: error.message })
    : error.message;
  const action = error.actionKey
    ? t(error.actionKey, { ...error.translationValues, defaultValue: error.action })
    : error.action;

  return (
    <div className={`${styles.panel} ${className} ${isExpanded ? styles.expanded : ''}`}>
      <div className={styles.header} onClick={() => setIsExpanded(!isExpanded)}>
        <div className={styles.headerLeft}>
          <AlertTriangle className={styles.errorIcon} size={18} />
          <span className={styles.title}>{t('contractError.title')}</span>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.errorCode}>{error.code}</span>
          {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </div>

      {isExpanded && (
        <div className={styles.content}>
          <div className={styles.messageSection}>
            <p className={styles.message}>{message}</p>
          </div>

          <div className={styles.actionSection}>
            <div className={styles.actionHeader}>
              <Info size={14} className={styles.infoIcon} />
              <span className={styles.actionLabel}>{t('contractError.suggestedAction')}</span>
            </div>
            <p className={styles.actionText}>{action}</p>
          </div>

          {(isUnknown || error.rawXdr) && (
            <div className={styles.rawSection}>
              <div className={styles.rawHeader}>
                <span className={styles.rawLabel}>{t('contractError.rawTransactionResult')}</span>
                <button
                  type="button"
                  onClick={handleCopyRaw}
                  className={styles.copyButton}
                  title={t('contractError.copyXdr')}
                >
                  <Copy size={14} />
                  <span>{t('contractError.copy')}</span>
                </button>
              </div>
              <div className={styles.rawContent}>
                <code>{error.rawXdr || t('contractError.notAvailable')}</code>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ContractErrorPanel;
