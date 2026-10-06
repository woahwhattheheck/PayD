import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@stellar/design-system';
import { Copy, Key, Eye, BookOpen, ChevronDown, Coins } from 'lucide-react';
import { useNotification } from '../hooks/useNotification';
import { useTranslation } from 'react-i18next';

interface WalletQRCodeProps {
  walletAddress: string;
  secretKey?: string;
  employeeName?: string;
}

const TRUSTLINE_STEPS = [
  { step: 1, titleKey: 'walletQr.steps.fund.title', descriptionKey: 'walletQr.steps.fund.description' },
  { step: 2, titleKey: 'walletQr.steps.asset.title', descriptionKey: 'walletQr.steps.asset.description' },
  { step: 3, titleKey: 'walletQr.steps.create.title', descriptionKey: 'walletQr.steps.create.description' },
  { step: 4, titleKey: 'walletQr.steps.verify.title', descriptionKey: 'walletQr.steps.verify.description' },
];

const ASSET_INFO = [
  {
    code: 'USDC',
    issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    network: 'Stellar Mainnet',
  },
  {
    code: 'EURC',
    issuer: 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXCWDQWZ4FIT6JGNG',
    network: 'Stellar Mainnet',
  },
  {
    code: 'XLM',
    issuer: 'Native',
    network: 'Stellar Mainnet',
  },
];

export const WalletQRCode: React.FC<WalletQRCodeProps> = ({
  walletAddress,
  secretKey,
  employeeName,
}) => {
  const [showSecret, setShowSecret] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const { notifySuccess } = useNotification();
  const { t } = useTranslation();

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notifySuccess(t('walletQr.copied', { label }));
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      notifySuccess(t('walletQr.copied', { label }));
    }
  };

  const truncateAddress = (address: string) => {
    if (address.length <= 16) return address;
    return `${address.slice(0, 8)}...${address.slice(-8)}`;
  };

  return (
    <div className="space-y-6">
      <div className="bg-surface rounded-xl p-6 border border-hi">
        <h3 className="text-lg font-bold mb-4 text-text">{t('walletQr.title')}</h3>

        <div className="flex flex-col md:flex-row gap-6 items-center">
          <div className="bg-white p-4 rounded-lg">
            <QRCodeSVG value={walletAddress} size={160} level="H" includeMargin={false} />
          </div>

          <div className="flex-1 space-y-3">
            <div>
              <label className="text-sm text-muted font-mono uppercase tracking-wider">
                {t('walletQr.walletAddress')}
              </label>
              <div className="flex items-center gap-2 mt-1">
                <code className="text-text bg-bg-secondary px-3 py-2 rounded-lg text-sm font-mono break-all">
                  {walletAddress}
                </code>
              </div>
            </div>

            <Button
              variant="tertiary"
              size="md"
              onClick={() => void copyToClipboard(walletAddress, t('walletQr.walletAddress'))}
            >
              <Copy size={16} className="mr-2" />
              {t('walletQr.copyAddress')}
            </Button>

            {secretKey && (
              <div className="mt-4">
                <label className="text-sm text-yellow-500 font-mono uppercase tracking-wider flex items-center gap-2">
                  <Key size={16} className="mr-2" />
                  {t('walletQr.secretKeySecure')}
                </label>
                <div className="mt-1 p-3 bg-yellow-900/20 border border-yellow-600/30 rounded-lg">
                  {showSecret ? (
                    <div className="space-y-2">
                      <code className="text-yellow-300 text-xs font-mono break-all block">
                        {secretKey}
                      </code>
                      <Button
                        variant="tertiary"
                        size="sm"
                        onClick={() => void copyToClipboard(secretKey, t('walletQr.secretKey'))}
                      >
                        <Copy size={16} className="mr-2" />
                        {t('walletQr.copySecretKey')}
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowSecret(true)}
                      className="text-yellow-400 hover:text-yellow-300 text-sm flex items-center gap-2"
                    >
                      <Eye size={16} className="mr-2" />
                      {t('walletQr.revealSecretKey')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-surface rounded-xl p-6 border border-hi">
        <h3 className="text-lg font-bold mb-4 text-text flex items-center gap-2">
          <BookOpen size={20} className="mr-2" />
          {t('walletQr.trustlineGuide')}
        </h3>
        <p className="text-muted text-sm mb-4">
          {t('walletQr.trustlineIntro')}
        </p>

        <div className="space-y-3">
          {TRUSTLINE_STEPS.map((item) => (
            <div key={item.step} className="border border-hi rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedStep(expandedStep === item.step ? null : item.step)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-bg-secondary transition-colors"
              >
                <span className="w-8 h-8 rounded-full bg-accent/20 text-accent font-bold flex items-center justify-center text-sm">
                  {item.step}
                </span>
                <span className="font-semibold text-text">{t(item.titleKey)}</span>
                <ChevronDown
                  size={16}
                  className={`ml-auto transition-transform ${
                    expandedStep === item.step ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {expandedStep === item.step && (
                <div className="px-4 py-3 bg-bg-secondary text-muted text-sm">
                  {t(item.descriptionKey)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-surface rounded-xl p-6 border border-hi">
        <h3 className="text-lg font-bold mb-4 text-text flex items-center gap-2">
          <Coins size={20} className="mr-2" />
          {t('walletQr.supportedAssets')}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ASSET_INFO.map((asset) => (
            <div key={asset.code} className="p-4 bg-bg-secondary rounded-lg border border-hi">
              <div className="font-bold text-accent text-lg mb-2">{asset.code}</div>
              <div className="text-xs text-muted font-mono">
                <div className="mb-1">
                  <span className="text-text-secondary">{t('walletQr.issuer')}:</span>
                </div>
                <div className="break-all">
                  {asset.issuer === 'Native' ? (
                    t('walletQr.nativeAsset')
                  ) : (
                    <button
                      onClick={() => void copyToClipboard(asset.issuer, t('walletQr.assetIssuer', { asset: asset.code }))}
                      className="hover:text-accent transition-colors"
                    >
                      {truncateAddress(asset.issuer)}
                      <Copy size={12} className="inline ml-1" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {employeeName && (
        <div className="text-center text-sm text-muted">
          {t('walletQr.shareQr', { name: employeeName })}
        </div>
      )}
    </div>
  );
};
