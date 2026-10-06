import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  StellarWalletsKit,
  WalletNetwork,
  FreighterModule,
  xBullModule,
  LobstrModule,
} from '@creit.tech/stellar-wallets-kit';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../hooks/useNotification';
import { WalletContext } from '../hooks/useWallet';
import { requireConnectedWallet, waitForWalletSelection } from './walletConnection';

const LAST_WALLET_STORAGE_KEY = 'payd:last_wallet_name';

function hasAnyWalletExtension(): boolean {
  if (typeof window === 'undefined') return true;
  const extendedWindow = window as Window &
    typeof globalThis & {
      freighterApi?: unknown;
      xBullSDK?: unknown;
      lobstr?: unknown;
    };

  return Boolean(extendedWindow.freighterApi || extendedWindow.xBullSDK || extendedWindow.lobstr);
}

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [address, setAddress] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [walletExtensionAvailable, setWalletExtensionAvailable] = useState(true);

  const kitRef = useRef<StellarWalletsKit | null>(null);
  const addressRef = useRef<string | null>(null);
  const { t } = useTranslation();
  const { notify, notifySuccess, notifyError } = useNotification();

  // Keep a ref in sync with the latest address so async callbacks (e.g.
  // requireWallet) never read a stale value captured from an earlier render.
  useEffect(() => {
    addressRef.current = address;
  }, [address]);

  // `vite.config.ts` sets `envPrefix: 'PUBLIC_'`, so `VITE_`-prefixed vars are
  // not exposed; read `PUBLIC_STELLAR_NETWORK` like the rest of the app does.
  // Map the network name (e.g. "TESTNET") to the passphrase the kit expects,
  // falling back to TESTNET so an unset/unknown value never crashes the app.
  const networkName = (
    (import.meta.env.PUBLIC_STELLAR_NETWORK as string | undefined) ||
    (import.meta.env.VITE_STELLAR_NETWORK as string | undefined) ||
    'TESTNET'
  ).toUpperCase();
  const network = WalletNetwork[networkName as keyof typeof WalletNetwork] ?? WalletNetwork.TESTNET;

  useEffect(() => {
    setWalletExtensionAvailable(hasAnyWalletExtension());

    const newKit = new StellarWalletsKit({
      network: network,
      modules: [new FreighterModule(), new xBullModule(), new LobstrModule()],
    });
    kitRef.current = newKit;

    const attemptSilentReconnect = async () => {
      const lastWalletName = localStorage.getItem(LAST_WALLET_STORAGE_KEY);
      if (!lastWalletName) {
        setIsInitialized(true);
        return;
      }

      setWalletName(lastWalletName);
      setIsConnecting(true);

      try {
        newKit.setWallet(lastWalletName);
        const account = await newKit.getAddress();
        if (account?.address) {
          addressRef.current = account.address;
          setAddress(account.address);
          notifySuccess(
            'Wallet reconnected',
            `${account.address.slice(0, 6)}...${account.address.slice(-4)} via ${lastWalletName}`
          );
        }
      } catch (error) {
        console.warn('Silent reconnection failed:', error);
        localStorage.removeItem(LAST_WALLET_STORAGE_KEY);
      } finally {
        setIsConnecting(false);
        setIsInitialized(true);
      }
    };

    void attemptSilentReconnect();
  }, [notifySuccess, network]);

  const connect = useCallback(async () => {
    const kit = kitRef.current;
    if (!kit) return;

    setIsConnecting(true);
    try {
      const selection = await waitForWalletSelection(
        ({ onWalletSelected, onClosed }) =>
          kit.openModal({
            modalTitle: t('wallet.modalTitle'),
            onWalletSelected: (option) => onWalletSelected(option.id),
            onClosed,
          }),
        () => kit.getAddress()
      );

      if (!selection) return;

      const { address: selectedAddress, walletId } = selection;
      addressRef.current = selectedAddress;
      setAddress(selectedAddress);
      setWalletName(walletId);
      localStorage.setItem(LAST_WALLET_STORAGE_KEY, walletId);
      notifySuccess(
        'Wallet connected',
        `${selectedAddress.slice(0, 6)}...${selectedAddress.slice(-4)} via ${walletId}`
      );
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      notifyError(
        'Wallet connection failed',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setIsConnecting(false);
    }
  }, [t, notifySuccess, notifyError]);

  const disconnect = () => {
    addressRef.current = null;
    setAddress(null);
    setWalletName(null);
    localStorage.removeItem(LAST_WALLET_STORAGE_KEY);
    notify('Wallet disconnected');
  };

  const requireWallet = useCallback(
    <T,>(callback: () => Promise<T>): Promise<T> =>
      requireConnectedWallet(() => addressRef.current, connect, callback),
    [connect]
  );

  const signTransaction = async (xdr: string) => {
    const kit = kitRef.current;
    if (!kit) throw new Error('Wallet kit not initialized');
    const result = await kit.signTransaction(xdr);
    return result.signedTxXdr;
  };

  return (
    <>
      {!walletExtensionAvailable && (
        <div className="sticky top-0 z-50 w-full border-b border-amber-600/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
          Wallet extension not detected. Install Freighter, xBull, or Lobstr to sign transactions.
        </div>
      )}

      <WalletContext
        value={{
          address,
          walletName,
          isConnecting,
          isInitialized,
          walletExtensionAvailable,
          connect,
          requireWallet,
          disconnect,
          signTransaction,
        }}
      >
        {isInitialized ? (
          children
        ) : (
          <div className="w-full px-4 py-3 text-xs text-zinc-400">Restoring wallet session...</div>
        )}
      </WalletContext>
    </>
  );
};
