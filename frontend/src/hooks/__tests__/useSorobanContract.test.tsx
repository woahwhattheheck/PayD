import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSorobanContract } from '../useSorobanContract';

const mocks = vi.hoisted(() => ({
  account: vi.fn(), prepare: vi.fn(), send: vi.fn(), get: vi.fn(), simulate: vi.fn(), sign: vi.fn(), notifyError: vi.fn(), valid: vi.fn(), call: vi.fn(),
  wallet: { address: 'GTEST' as string | null },
}));
vi.mock('../useWallet', () => ({ useWallet: () => mocks.wallet }));
vi.mock('../useWalletSigning', () => ({ useWalletSigning: () => ({ sign: mocks.sign }) }));
vi.mock('../useNotification', () => ({ useNotification: () => ({ notifyError: mocks.notifyError }) }));
vi.mock('../../services/transactionSimulation', () => ({ simulateTransaction: mocks.simulate }));
vi.mock('@stellar/stellar-sdk', () => {
  class Builder {
    addOperation() { return this; }
    setTimeout() { return this; }
    build() { return { toXDR: () => 'unsigned-xdr' }; }
    static fromXDR(value: string) { return { signed: value }; }
  }
  class Server {
    getAccount = mocks.account; prepareTransaction = mocks.prepare;
    sendTransaction = mocks.send; getTransaction = mocks.get;
  }
  class Contract { call = mocks.call; }
  return {
    BASE_FEE: '100', Contract, TransactionBuilder: Builder,
    Networks: { PUBLIC: 'public', TESTNET: 'testnet' },
    StrKey: { isValidContract: mocks.valid },
    rpc: { Server, Api: { GetTransactionStatus: { SUCCESS: 'SUCCESS', NOT_FOUND: 'NOT_FOUND' } } },
    nativeToScVal: (value: unknown) => ({ value }), scValToNative: () => 42,
  };
});
beforeEach(() => {
  mocks.wallet.address = 'GTEST';
  mocks.valid.mockReset().mockReturnValue(true);
  mocks.account.mockReset().mockResolvedValue({ id: 'GTEST' });
  mocks.call.mockReset().mockReturnValue({ operation: 'invoke' });
  mocks.simulate.mockReset().mockResolvedValue({ success: true });
  mocks.prepare.mockReset().mockResolvedValue({ toXDR: () => 'prepared-xdr' });
  mocks.sign.mockReset().mockResolvedValue('signed-xdr');
  mocks.send.mockReset().mockResolvedValue({ status: 'PENDING', hash: 'hash-1' });
  mocks.get.mockReset().mockResolvedValue({ status: 'SUCCESS', returnValue: { value: 42 } });
});

describe('useSorobanContract orchestration (no live RPC)', () => {
  it('simulates before signing, submits, and stores a typed result', async () => {
    const { result } = renderHook(() => useSorobanContract<string>('CTEST'));
    let response;
    await act(async () => { response = await result.current.invoke({ method: 'balance', args: [7], parseResult: value => `value:${value}` }); });
    expect(mocks.call).toHaveBeenCalledWith('balance', { value: 7 });
    expect(mocks.simulate).toHaveBeenCalledWith(expect.objectContaining({ envelopeXdr: 'unsigned-xdr' }));
    expect(mocks.sign).toHaveBeenCalledWith('prepared-xdr');
    expect(mocks.send).toHaveBeenCalledWith({ signed: 'signed-xdr' });
    expect(mocks.get).toHaveBeenCalledWith('hash-1');
    expect(mocks.simulate.mock.invocationCallOrder[0]).toBeLessThan(mocks.sign.mock.invocationCallOrder[0]);
    expect(response).toEqual({ txHash: 'hash-1', value: 'value:42', raw: 42 });
    expect(result.current).toMatchObject({ result: response, loading: false, error: null });
  });

  it('rejects a missing wallet without contacting RPC', async () => {
    mocks.wallet.address = null;
    const { result } = renderHook(() => useSorobanContract('CTEST'));
    await act(async () => { await expect(result.current.invoke({ method: 'balance' })).rejects.toThrow('Connect your wallet'); });
    expect(mocks.account).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toContain('Connect your wallet');
  });

  it('does not sign or submit a failed preflight simulation', async () => {
    mocks.simulate.mockResolvedValueOnce({ success: false, description: 'Preflight rejected' });
    const { result } = renderHook(() => useSorobanContract('CTEST'));
    await act(async () => { await expect(result.current.invoke({ method: 'transfer' })).rejects.toThrow('Preflight rejected'); });
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ loading: false, result: null, error: 'Preflight rejected' });
    expect(mocks.notifyError).toHaveBeenCalledWith('Contract invocation failed: transfer', 'Preflight rejected');
  });
});
