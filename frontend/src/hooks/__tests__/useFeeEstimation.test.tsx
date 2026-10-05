import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFeeEstimation } from '../useFeeEstimation';

const clients: QueryClient[] = [];
const fetchMock = vi.fn();
const stats = {
  last_ledger: '123', last_ledger_base_fee: '100', ledger_capacity_usage: '0.8',
  fee_charged: { p50: '100', p70: '200', p95: '400', p99: '600' },
};
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  return renderHook(useFeeEstimation, {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => stats });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('PUBLIC_STELLAR_HORIZON_URL', 'https://horizon.example.test/');
});
afterEach(() => { clients.splice(0).forEach(client => client.clear()); });

describe('useFeeEstimation with the real fee service', () => {
  it('fetches recommendations and calculates a batch budget with the congestion margin', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith('https://horizon.example.test/fee_stats');
    expect(result.current.feeRecommendation).toMatchObject({ recommendedFee: 400, congestionLevel: 'high', shouldBumpFee: true });
    let budget;
    await act(async () => { budget = await result.current.estimateBatch(3); });
    expect(budget).toMatchObject({ transactionCount: 3, feePerTransaction: 600, totalBudget: 1800, totalBudgetXLM: '0.0001800', safetyMargin: 1.5 });
  });

  it('reports request errors and recovers on refetch', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable' });
    const { result } = mount();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('503 Unavailable');
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isError).toBe(false));
    expect(result.current.feeRecommendation?.recommendedFee).toBe(400);
  });

  it('polls again after ten seconds and stops when unmounted', async () => {
    const { result, unmount } = mount();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    vi.useFakeTimers();
    // A refetch reinstalls the observer's interval using the controlled clock.
    await act(async () => { await result.current.refetch(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    unmount();
    const calls = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });
});
