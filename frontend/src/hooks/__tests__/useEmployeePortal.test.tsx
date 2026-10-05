import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmployeePortal } from '../useEmployeePortal';

const api = vi.hoisted(() => ({ rates: vi.fn(), draft: vi.fn() }));
vi.mock('../../services/currencyConversion', () => ({
  fetchExchangeRates: api.rates,
  getStellarExpertLink: (hash: string) => `https://example.test/tx/${hash}`,
}));
vi.mock('../../services/benefitsApi', () => ({ getMyDeductionsDraftPayslip: api.draft }));

beforeEach(() => {
  vi.useFakeTimers();
  api.rates.mockReset().mockResolvedValue({ NGN: 1500, USD: 1 });
  api.draft.mockReset().mockResolvedValue(null);
});
const finishLoad = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(800); }); };

describe('useEmployeePortal', () => {
  it('loads rates and paginates the existing demonstration transactions', async () => {
    const { result } = renderHook(useEmployeePortal);
    expect(result.current.isLoading).toBe(true);
    await finishLoad();
    expect(api.rates).toHaveBeenCalledOnce();
    expect(api.draft).toHaveBeenCalledOnce();
    expect(result.current.transactions).toHaveLength(8);
    expect(result.current.totalPages).toBe(2);
    expect(result.current.balance).toMatchObject({ orgUsd: 20150, localAmount: 30225000, exchangeRate: 1500 });
    const firstPageIds = result.current.transactions.map(t => t.id);
    act(() => result.current.setCurrentPage(2));
    expect(result.current.transactions).toHaveLength(4);
    expect(result.current.transactions.every(t => !firstPageIds.includes(t.id))).toBe(true);
  });

  it('filters status and type while returning to the first page', async () => {
    const { result } = renderHook(useEmployeePortal);
    await finishLoad();
    act(() => result.current.setCurrentPage(2));
    act(() => result.current.setFilterStatus('pending'));
    expect(result.current.currentPage).toBe(1);
    expect(result.current.transactions.map(t => t.id)).toEqual(['tx-11']);
    act(() => { result.current.setFilterStatus('all'); result.current.setFilterType('bonus'); });
    expect(result.current.transactions).toHaveLength(2);
    expect(result.current.transactions.every(t => t.type === 'bonus')).toBe(true);
  });

  it('resets pagination when searching from a later page', async () => {
    const { result } = renderHook(useEmployeePortal);
    await finishLoad();
    act(() => result.current.setCurrentPage(2));
    act(() => result.current.setSearchQuery('TRAVEL'));
    expect(result.current.currentPage).toBe(1);
    expect(result.current.transactions.map(t => t.memo)).toEqual(['Travel Reimbursement']);
  });

  it('reloads conversion data when the currency changes', async () => {
    const { result } = renderHook(useEmployeePortal);
    await finishLoad();
    act(() => { result.current.setCurrentPage(2); result.current.setSelectedCurrency('USD'); });
    await finishLoad();
    expect(result.current.currentPage).toBe(1);
    expect(result.current.balance).toMatchObject({ localCurrency: 'USD', localAmount: 20150, exchangeRate: 1 });
    expect(api.rates).toHaveBeenCalledTimes(2);
  });

  it('surfaces rate failures and recovers on refresh', async () => {
    api.rates.mockRejectedValueOnce(new Error('Rates unavailable'));
    const { result } = renderHook(useEmployeePortal);
    await finishLoad();
    expect(result.current.error).toBe('Rates unavailable');
    expect(result.current.isLoading).toBe(false);
    await act(async () => {
      const refresh = result.current.refreshData();
      await vi.advanceTimersByTimeAsync(800);
      await refresh;
    });
    expect(result.current.error).toBeNull();
    expect(result.current.balance).not.toBeNull();
  });

  it('keeps the portal usable when the optional deductions request fails', async () => {
    api.draft.mockRejectedValueOnce(new Error('No draft available'));
    const { result } = renderHook(useEmployeePortal);
    await finishLoad();
    expect(result.current.error).toBeNull();
    expect(result.current.deductionsDraft).toBeNull();
    expect(result.current.transactions).toHaveLength(8);
  });
});
