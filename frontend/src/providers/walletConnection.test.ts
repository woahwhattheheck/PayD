import { describe, expect, it, vi } from 'vitest';
import {
  requireConnectedWallet,
  waitForWalletSelection,
  type WalletModalCallbacks,
} from './walletConnection';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

describe('wallet connection first action', () => {
  it('waits for a delayed address before invoking the protected action once', async () => {
    const addressResult = deferred<{ address: string }>();
    let modalCallbacks: WalletModalCallbacks | undefined;
    let currentAddress: string | null = null;

    const openModal = vi.fn(async (callbacks: WalletModalCallbacks) => {
      modalCallbacks = callbacks;
    });
    const getAddress = vi.fn(() => addressResult.promise);
    const protectedAction = vi.fn(async () => 'submitted');

    const connect = async () => {
      const selection = await waitForWalletSelection(openModal, getAddress);
      if (selection) currentAddress = selection.address;
    };

    const result = requireConnectedWallet(
      () => currentAddress,
      connect,
      protectedAction
    );

    if (!modalCallbacks) throw new Error('wallet modal did not open');
    modalCallbacks.onWalletSelected('freighter');
    modalCallbacks.onClosed();

    await Promise.resolve();
    expect(protectedAction).not.toHaveBeenCalled();

    addressResult.resolve({ address: 'GDELAYEDADDRESS' });

    await expect(result).resolves.toBe('submitted');
    expect(getAddress).toHaveBeenCalledTimes(1);
    expect(protectedAction).toHaveBeenCalledTimes(1);
  });
});
