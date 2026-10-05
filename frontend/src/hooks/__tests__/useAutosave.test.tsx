import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from '../useAutosave';

beforeEach(() => { vi.useFakeTimers(); });

describe('useAutosave', () => {
  it('debounces changes and saves only the latest value', () => {
    const { result, rerender } = renderHook(({ data }) => useAutosave('draft', data, 1000), { initialProps: { data: { name: 'A' } } });
    expect(result.current.saving).toBe(true);
    act(() => vi.advanceTimersByTime(600));
    rerender({ data: { name: 'B' } });
    act(() => vi.advanceTimersByTime(999));
    expect(localStorage.getItem('draft')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(JSON.parse(localStorage.getItem('draft')!)).toEqual({ name: 'B' });
    expect(result.current.saving).toBe(false);
    expect(result.current.lastSaved).toBeInstanceOf(Date);
    expect(result.current.loadSavedData()).toEqual({ name: 'B' });
    act(() => result.current.clearSavedData());
    expect(localStorage.getItem('draft')).toBeNull();
    expect(result.current.lastSaved).toBeNull();
  });

  it('cancels a pending save on unmount', () => {
    const { unmount } = renderHook(() => useAutosave('draft', 'unsaved'));
    unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(localStorage.getItem('draft')).toBeNull();
  });

  it('handles corrupt stored JSON', () => {
    localStorage.setItem('draft', '{bad');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useAutosave('draft', 'value'));
    expect(result.current.loadSavedData()).toBeNull();
    expect(console.error).toHaveBeenCalledOnce();
  });

  it('clears saving state when storage rejects a write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useAutosave('draft', 'value'));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.saving).toBe(false);
    expect(result.current.lastSaved).toBeNull();
    expect(console.error).toHaveBeenCalledOnce();
  });
});
