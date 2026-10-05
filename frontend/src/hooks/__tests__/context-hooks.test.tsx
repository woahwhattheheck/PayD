import { act, renderHook } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { WalletContext, useWallet, type WalletContextType } from '../useWallet';
import { NotificationContext, useNotification } from '../useNotification';
import { SocketContext, useSocket } from '../useSocket';
import { ThemeContext, useTheme } from '../useTheme';

type Children = { children: ReactNode };

export const walletValue = (): WalletContextType => ({
  address: null, walletName: null, isConnecting: false, isInitialized: true,
  walletExtensionAvailable: true, connect: vi.fn(), disconnect: vi.fn(),
  signTransaction: vi.fn(), requireWallet: async (callback) => callback(),
});

describe('context hooks', () => {
  it.each([
    ['wallet', useWallet, 'useWallet must be used within WalletProvider'],
    ['notification', useNotification, 'useNotification must be used within NotificationProvider'],
    ['socket', useSocket, 'useSocket must be used within a SocketProvider'],
    ['theme', useTheme, 'useTheme must be used within ThemeProvider'],
  ] as const)('%s rejects a missing provider', (_name, hook, message) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => hook())).toThrow(message);
  });

  it('wallet consumers receive connect/disconnect state changes', async () => {
    function Host({ children }: Children) {
      const [address, setAddress] = useState<string | null>(null);
      return <WalletContext.Provider value={{ ...walletValue(), address,
        connect: async () => { setAddress('GTEST'); },
        disconnect: () => setAddress(null),
      }}>{children}</WalletContext.Provider>;
    }
    const { result } = renderHook(useWallet, { wrapper: Host });
    expect(result.current.address).toBeNull();
    await act(async () => { await result.current.connect(); });
    expect(result.current.address).toBe('GTEST');
    act(() => result.current.disconnect());
    expect(result.current.address).toBeNull();
  });

  it('does not swallow wallet connection errors', async () => {
    const wallet = walletValue();
    wallet.connect = vi.fn().mockRejectedValue(new Error('Connection declined'));
    const { result } = renderHook(useWallet, {
      wrapper: ({ children }: Children) => <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>,
    });
    await expect(result.current.connect()).rejects.toThrow('Connection declined');
    expect(result.current.address).toBeNull();
  });

  it('exposes notification actions without altering their arguments', () => {
    const value = { notify: vi.fn(), notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn() };
    const { result } = renderHook(useNotification, {
      wrapper: ({ children }: Children) => <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>,
    });
    result.current.notifyError('Failed', 'Try again');
    expect(value.notifyError).toHaveBeenCalledWith('Failed', 'Try again');
    expect(result.current).toBe(value);
  });

  it('exposes socket connection updates and subscription methods', () => {
    let value = { socket: null, connected: false, subscribeToTransaction: vi.fn(), unsubscribeFromTransaction: vi.fn(), subscribeToOrganization: vi.fn(), unsubscribeFromOrganization: vi.fn() };
    const { result, rerender } = renderHook(useSocket, {
      wrapper: ({ children }: Children) => <SocketContext.Provider value={value}>{children}</SocketContext.Provider>,
    });
    result.current.subscribeToTransaction('tx-1');
    expect(value.subscribeToTransaction).toHaveBeenCalledWith('tx-1');
    value = { ...value, connected: true };
    rerender();
    expect(result.current.connected).toBe(true);
  });

  it('updates a theme consumer when the provider toggles', () => {
    function Host({ children }: Children) {
      const [theme, setTheme] = useState<'light' | 'dark'>('light');
      return <ThemeContext.Provider value={{ theme, toggleTheme: () => setTheme(t => t === 'light' ? 'dark' : 'light') }}>{children}</ThemeContext.Provider>;
    }
    const { result } = renderHook(useTheme, { wrapper: Host });
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe('dark');
  });
});
