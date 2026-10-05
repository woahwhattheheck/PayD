import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@stellar/design-system';
import { Copy, Key, Eye, BookOpen, ChevronDown, Coins } from 'lucide-react';
import { useNotification } from '../hooks/useNotification';

interface WalletQRCodeProps {
  walletAddress: string;
  secretKey?: string;
  employeeName?: string;
}

const TRUSTLINE_STEPS = [
  {
    step: 1,
    title: 'Fund Your Wallet',
    description: 'Add XLM to your wallet. You need at least 1 XLM to create a trustline.',
  },
  {
    step: 2,
    title: 'Choose Your Asset',
    description:
      'Decide which asset you want to receive (USDC, EURC, or XLM). Each asset requires a separate trustline.',
  },
  {
    step: 3,
    title: 'Create Trustline',
    description:
      "Navigate to your wallet's asset settings and add a trustline for the chosen asset using its issuer address.",
  },
  {
    step: 4,
    title: 'Verify Trustline',
    description:
      "After creation, verify the trustline appears in your wallet's asset list. You can now receive payments in that asset.",
  },
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

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notifySuccess(`${label} copied to clipboard!`);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      notifySuccess(`${label} copied to clipboard!`);
    }
  };

  const truncateAddress = (address: string) => {
    if (address.length <= 16) return address;
    return `${address.slice(0, 8)}...${address.slice(-8)}`;
  };

  return (
    <div className="space-y-6">
      <div className="bg-surface rounded-xl p-6 border border-border-hi">
        <h3 className="text-lg font-bold mb-4 text-text">Your Stellar Wallet Address</h3>

        <div className="flex flex-col md:flex-row gap-6 items-center">
          <div className="bg-qr-bg p-4 rounded-lg">
            <QRCodeSVG
              value={walletAddress}
              size={160}
              level="H"
              includeMargin={false}
              bgColor="var(--qr-bg)"
              fgColor="var(--qr-fg)"
            />
          </div>

          <div className="flex-1 space-y-3">
            <div>
              <label className="text-sm text-muted font-mono uppercase tracking-wider">
                Wallet Address
              </label>
              <div className="flex items-center gap-2 mt-1">
                <code className="text-text bg-surface-hi px-3 py-2 rounded-lg text-sm font-mono break-all">
                  {walletAddress}
                </code>
              </div>
            </div>

            <Button
              variant="tertiary"
              size="md"
              onClick={() => void copyToClipboard(walletAddress, 'Wallet address')}
            >
              <Copy size={16} className="mr-2" />
              Copy Address
            </Button>

            {secretKey && (
              <div className="mt-4">
                <label className="text-sm text-warning font-mono uppercase tracking-wider flex items-center gap-2">
                  <Key size={16} className="mr-2" />
                  Secret Key (Save Securely!)
                </label>
                <div className="mt-1 p-3 bg-warning/10 border border-warning/30 rounded-lg">
                  {showSecret ? (
                    <div className="space-y-2">
                      <code className="text-warning text-xs font-mono break-all block">
                        {secretKey}
                      </code>
                      <Button
                        variant="tertiary"
                        size="sm"
                        onClick={() => void copyToClipboard(secretKey, 'Secret key')}
                      >
                        <Copy size={16} className="mr-2" />
                        Copy Secret Key
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowSecret(true)}
                      className="text-warning hover:text-text text-sm flex items-center gap-2"
                    >
                      <Eye size={16} className="mr-2" />
                      Click to reveal secret key
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-surface rounded-xl p-6 border border-border-hi">
        <h3 className="text-lg font-bold mb-4 text-text flex items-center gap-2">
          <BookOpen size={20} className="mr-2" />
          Trustline Setup Guide
        </h3>
        <p className="text-muted text-sm mb-4">
          To receive payments in different currencies, you need to set up trustlines. Follow these
          steps:
        </p>

        <div className="space-y-3">
          {TRUSTLINE_STEPS.map((item) => (
            <div key={item.step} className="border border-border-hi rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedStep(expandedStep === item.step ? null : item.step)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-surface-hi transition-colors"
              >
                <span className="w-8 h-8 rounded-full bg-accent/20 text-accent font-bold flex items-center justify-center text-sm">
                  {item.step}
                </span>
                <span className="font-semibold text-text">{item.title}</span>
                <ChevronDown
                  size={16}
                  className={`ml-auto transition-transform ${
                    expandedStep === item.step ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {expandedStep === item.step && (
                <div className="px-4 py-3 bg-surface-hi text-muted text-sm">
                  {item.description}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-surface rounded-xl p-6 border border-border-hi">
        <h3 className="text-lg font-bold mb-4 text-text flex items-center gap-2">
          <Coins size={20} className="mr-2" />
          Supported Assets
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ASSET_INFO.map((asset) => (
            <div key={asset.code} className="p-4 bg-surface-hi rounded-lg border border-border-hi">
              <div className="font-bold text-accent text-lg mb-2">{asset.code}</div>
              <div className="text-xs text-muted font-mono">
                <div className="mb-1">
                  <span className="text-muted">Issuer:</span>
                </div>
                <div className="break-all">
                  {asset.issuer === 'Native' ? (
                    'Native Asset'
                  ) : (
                    <button
                      onClick={() => void copyToClipboard(asset.issuer, `${asset.code} issuer`)}
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
          Share this QR code with {employeeName} so they can receive payments directly to their
          wallet.
        </div>
      )}
    </div>
  );
};
