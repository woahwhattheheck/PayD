import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWithdrawal } from '../useWithdrawal';

const service = vi.hoisted(() => ({ getAvailableAnchors: vi.fn(), initiateWithdrawal: vi.fn(), getTransactionStatus: vi.fn(), cancelWithdrawal: vi.fn() }));
vi.mock('../../services/withdrawal', () => ({ default: service }));
const anchor = { domain: 'anchor.example.test', name: 'Test anchor', supportedCurrencies: ['NGN'] };
const transaction = { id: 'withdrawal-1', anchorDomain: anchor.domain, status: 'completed', amountIn: 20, assetCode: 'ORGUSD', startedAt: '2026-01-01T00:00:00Z' };
beforeEach(() => {
  vi.useFakeTimers();
  service.getAvailableAnchors.mockReset().mockResolvedValue([anchor]);
  service.initiateWithdrawal.mockReset().mockResolvedValue({ transactionId: 'withdrawal-1', interactiveUrl: 'https://anchor.example.test/withdraw' });
  service.getTransactionStatus.mockReset().mockResolvedValue(transaction);
  service.cancelWithdrawal.mockReset().mockResolvedValue(undefined);
});
function mount() { return renderHook(() => useWithdrawal(100, 1500, 'NGN')); }
async function start(result: ReturnType<typeof mount>['result']) {
  act(() => result.current.selectAnchor(anchor));
  act(() => result.current.setAmount('20'));
  await act(async () => { await result.current.initiateWithdrawal('bank_account', { account: 'test-account' }); });
}

describe('useWithdrawal', () => {
  it('loads anchors, estimates receipt, and validates before calling the service', async () => {
    const { result } = mount();
    await act(async () => { await result.current.loadAnchors(); });
    expect(result.current.state.anchors).toEqual([anchor]);
    await act(async () => { await result.current.initiateWithdrawal('bank_account', {}); });
    expect(result.current.state.error).toContain('select an anchor');
    act(() => result.current.selectAnchor(anchor));
    act(() => result.current.setAmount('101'));
    await act(async () => { await result.current.initiateWithdrawal('bank_account', {}); });
    expect(result.current.state.error).toBe('Insufficient balance');
    act(() => result.current.setAmount('-1'));
    await act(async () => { await result.current.initiateWithdrawal('bank_account', {}); });
    expect(result.current.state.error).toBe('Please enter a valid amount');
    expect(service.initiateWithdrawal).not.toHaveBeenCalled();
    act(() => result.current.setAmount('20'));
    expect(result.current.state.estimatedReceive).toBe(30000);
  });

  it('initiates the requested withdrawal and stops polling at completion', async () => {
    const { result } = mount();
    await start(result);
    expect(service.initiateWithdrawal).toHaveBeenCalledWith({ anchorDomain: anchor.domain, assetCode: 'ORGUSD', amount: 20, destinationType: 'bank_account', destinationDetails: { account: 'test-account' } });
    expect(result.current.state.step).toBe('processing');
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(service.getTransactionStatus).toHaveBeenCalledWith('withdrawal-1', anchor.domain);
    expect(result.current.state.step).toBe('complete');
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(service.getTransactionStatus).toHaveBeenCalledOnce();
  });

  it('reports initiation errors and permits another attempt', async () => {
    service.initiateWithdrawal.mockRejectedValueOnce(new Error('Anchor unavailable'));
    const { result } = mount();
    await start(result);
    expect(result.current.state).toMatchObject({ step: 'enter_amount', error: 'Anchor unavailable', isLoading: false });
    await act(async () => { await result.current.initiateWithdrawal('bank_account', {}); });
    expect(result.current.state).toMatchObject({ step: 'processing', error: null });
  });

  it('cancels, clears transaction state, and releases the polling timer', async () => {
    const { result } = mount();
    await start(result);
    await act(async () => { await result.current.cancelWithdrawal(); });
    expect(service.cancelWithdrawal).toHaveBeenCalledWith('withdrawal-1');
    expect(result.current.state).toMatchObject({ step: 'select_anchor', transaction: null, selectedAnchor: null, amount: '' });
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(service.getTransactionStatus).not.toHaveBeenCalled();
    act(() => result.current.reset());
    expect(result.current.state.estimatedReceive).toBe(0);
  });

  it('releases polling on unmount and opens the interactive page safely', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { result, unmount } = mount();
    await start(result);
    result.current.openInteractiveUrl();
    expect(open).toHaveBeenCalledWith('https://anchor.example.test/withdraw', '_blank', 'noopener,noreferrer');
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(service.getTransactionStatus).not.toHaveBeenCalled();
  });
});
