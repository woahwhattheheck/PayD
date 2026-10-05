import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBulkPaymentTracker } from '../useBulkPaymentTracker';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), retry: vi.fn(), success: vi.fn(), error: vi.fn(), socket: { on: vi.fn(), off: vi.fn() } }));
vi.mock('../../services/bulkPaymentApi', () => ({ fetchBulkPaymentBatches: mocks.fetch, retryBatchPayment: mocks.retry }));
vi.mock('../useSocket', () => ({ useSocket: () => ({ socket: mocks.socket }) }));
vi.mock('../useNotification', () => ({ useNotification: () => ({ notifySuccess: mocks.success, notifyError: mocks.error }) }));
const batch = { id: 'batch-1', status: 'failed', confirmations: 1, txHash: 'old-hash', recipients: [{ id: 'recipient-1', status: 'failed', errorMessage: 'Retry needed' }, { id: 'recipient-2', status: 'confirmed' }] };
beforeEach(() => {
  mocks.fetch.mockReset().mockResolvedValue({ data: [structuredClone(batch)], total: 11, totalPages: 2 });
  mocks.retry.mockReset().mockResolvedValue({ success: true, txHash: 'new-hash' });
});

describe('useBulkPaymentTracker', () => {
  it('requests pages and filters and toggles expanded rows', async () => {
    const { result } = renderHook(useBulkPaymentTracker);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mocks.fetch).toHaveBeenCalledWith({ page: 1, limit: 10, status: 'all' });
    expect(result.current.totalPages).toBe(2);
    act(() => { result.current.setPage(2); result.current.setStatusFilter('failed'); });
    await waitFor(() => expect(mocks.fetch).toHaveBeenLastCalledWith({ page: 2, limit: 10, status: 'failed' }));
    act(() => result.current.toggleExpand('batch-1'));
    expect(result.current.expandedBatchId).toBe('batch-1');
    act(() => result.current.toggleExpand('batch-1'));
    expect(result.current.expandedBatchId).toBeNull();
  });

  it('applies socket updates and removes the exact listener on unmount', async () => {
    const { result, unmount } = renderHook(useBulkPaymentTracker);
    await waitFor(() => expect(result.current.batches).toHaveLength(1));
    const listener = mocks.socket.on.mock.calls.find(([event]) => event === 'bulk_payment:update')![1];
    act(() => listener({ batchId: 'batch-1', confirmations: 3, status: 'confirmed', recipientId: 'recipient-1', recipientStatus: 'confirmed' }));
    expect(result.current.batches[0]).toMatchObject({ status: 'confirmed', confirmations: 3 });
    expect(result.current.batches[0].recipients.every(recipient => recipient.status === 'confirmed')).toBe(true);
    expect(mocks.success).toHaveBeenCalledWith('Batch confirmed!', 'All payments in batch batch-1 are confirmed.');
    unmount();
    expect(mocks.socket.off).toHaveBeenCalledWith('bulk_payment:update', listener);
  });

  it('retries failed recipients without reverting successful recipients', async () => {
    const { result } = renderHook(useBulkPaymentTracker);
    await waitFor(() => expect(result.current.batches).toHaveLength(1));
    await act(async () => { await result.current.handleRetry('batch-1'); });
    expect(mocks.retry).toHaveBeenCalledWith('batch-1');
    expect(result.current.batches[0]).toMatchObject({ status: 'pending', confirmations: 0, txHash: 'new-hash' });
    expect(result.current.batches[0].recipients[0]).toMatchObject({ status: 'pending', errorMessage: undefined });
    expect(result.current.batches[0].recipients[1].status).toBe('confirmed');
    expect(result.current.retryingBatchId).toBeNull();
  });

  it('reports load failures without leaving the hook loading', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('API unavailable'));
    const { result } = renderHook(useBulkPaymentTracker);
    await waitFor(() => expect(result.current.error).toBe('API unavailable'));
    expect(result.current.isLoading).toBe(false);
    expect(mocks.error).toHaveBeenCalledWith('Load failed', 'API unavailable');
  });
});
