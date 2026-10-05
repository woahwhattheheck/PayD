import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContractError } from '../useContractError';
import { useTransactionSimulation } from '../useTransactionSimulation';
import { useWalletSigning } from '../useWalletSigning';

const mocks = vi.hoisted(() => ({ parse: vi.fn(), simulate: vi.fn(), batch: vi.fn(), summarize: vi.fn(), sign: vi.fn(), notifyError: vi.fn(), wallet: { address: 'GTEST' as string | null, isConnecting: false } }));
vi.mock('../../utils/contractErrorParser', () => ({ parseContractError: mocks.parse }));
vi.mock('../../services/transactionSimulation', () => ({ simulateTransaction: mocks.simulate, simulateBatchTransactions: mocks.batch, summarizeBatchSimulation: mocks.summarize }));
vi.mock('../useWallet', () => ({ useWallet: () => ({ ...mocks.wallet, signTransaction: mocks.sign, requireWallet: async <T,>(callback: () => Promise<T>) => callback() }) }));
vi.mock('../useNotification', () => ({ useNotification: () => ({ notifyError: mocks.notifyError }) }));
beforeEach(() => {
  mocks.wallet.address = 'GTEST'; mocks.wallet.isConnecting = false;
  mocks.sign.mockReset().mockResolvedValue('signed-xdr');
  mocks.simulate.mockReset().mockResolvedValue({ success: true });
  mocks.batch.mockReset().mockResolvedValue([{ success: true }]);
  mocks.summarize.mockReset().mockReturnValue({ allPassed: true, total: 1 });
  mocks.parse.mockReset().mockReturnValue({ code: 'TEST_ERROR', message: 'Rejected', action: 'Retry' });
});

describe('useContractError', () => {
  it('stores parsed errors, returns details, and clears them', () => {
    const { result } = renderHook(useContractError);
    let details;
    act(() => { details = result.current.handleContractError('result-xdr'); });
    expect(mocks.parse).toHaveBeenCalledWith('result-xdr');
    expect(result.current.contractError).toEqual(details);
    act(() => result.current.clearContractError());
    expect(result.current.contractError).toBeNull();
  });
  it('uses the fallback without trying to parse missing XDR', () => {
    const { result } = renderHook(useContractError);
    act(() => { result.current.handleContractError(undefined, 'Request failed'); });
    expect(result.current.contractError).toMatchObject({ code: 'GENERIC_ERROR', message: 'Request failed' });
    expect(mocks.parse).not.toHaveBeenCalled();
  });
});

describe('useTransactionSimulation', () => {
  it('transitions from a single result to a batch result and resets', async () => {
    const { result } = renderHook(useTransactionSimulation);
    await act(async () => { await result.current.simulate({ envelopeXdr: 'unsigned-xdr' }); });
    expect(mocks.simulate).toHaveBeenCalledWith({ envelopeXdr: 'unsigned-xdr' });
    expect(result.current.isSuccess).toBe(true);
    await act(async () => { await result.current.simulateBatch(['one'], 'https://horizon.example.test'); });
    expect(mocks.batch).toHaveBeenCalledWith(['one'], 'https://horizon.example.test');
    expect(mocks.summarize).toHaveBeenCalledWith([{ success: true }]);
    expect(result.current.result).toBeNull();
    expect(result.current.batchResult).toEqual({ allPassed: true, total: 1 });
    act(() => result.current.resetSimulation());
    expect(result.current.batchResult).toBeNull();
    expect(result.current.isSuccess).toBe(false);
  });
  it('clears loading and exposes a rejected simulation', async () => {
    mocks.simulate.mockRejectedValueOnce(new Error('Simulation unavailable'));
    const { result } = renderHook(useTransactionSimulation);
    let value;
    await act(async () => { value = await result.current.simulate({ envelopeXdr: 'unsigned-xdr' }); });
    expect(value).toBeNull();
    expect(result.current).toMatchObject({ error: 'Simulation unavailable', isSimulating: false, isSuccess: false });
    act(() => result.current.resetSimulation());
    expect(result.current.error).toBeNull();
  });
});

describe('useWalletSigning', () => {
  it('tracks a pending signature and returns the signed value', async () => {
    let resolve!: (value: string) => void;
    mocks.sign.mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
    const { result, rerender } = renderHook(useWalletSigning);
    expect(result.current.isReady).toBe(true);
    let pending!: Promise<string>;
    act(() => { pending = result.current.sign('unsigned-xdr'); });
    expect(result.current.isSigning).toBe(true);
    await act(async () => { resolve('signed-xdr'); await pending; });
    expect(await pending).toBe('signed-xdr');
    expect(mocks.sign).toHaveBeenCalledWith('unsigned-xdr');
    expect(result.current.isSigning).toBe(false);
    mocks.wallet.isConnecting = true;
    rerender();
    expect(result.current.isReady).toBe(false);
  });
  it('rethrows signing errors, records them, and notifies the user', async () => {
    mocks.sign.mockRejectedValueOnce(new Error('Signature declined'));
    const { result } = renderHook(useWalletSigning);
    await act(async () => { await expect(result.current.sign('unsigned-xdr')).rejects.toThrow('Signature declined'); });
    expect(result.current).toMatchObject({ error: 'Signature declined', isSigning: false });
    expect(mocks.notifyError).toHaveBeenCalledWith('Signing failed', 'Signature declined');
  });
});
