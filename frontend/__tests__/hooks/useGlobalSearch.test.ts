/**
 * Tests for the useGlobalSearch hook.
 *
 * Verifies: debounce, AbortController cancellation, idle/loading/error status,
 * and empty-query reset behaviour.
 *
 * Pattern notes:
 *   - vi.useFakeTimers() is used to control the 250 ms debounce.
 *   - After advancing timers, `await act(() => vi.runAllTimersAsync())` flushes
 *     both remaining timers AND pending microtasks (Promise resolutions) so
 *     state updates are committed before we assert.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGlobalSearch } from '../../src/hooks/useGlobalSearch';

// ---------------------------------------------------------------------------
// Mock api/client so no real fetch is issued
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
  searchTasks: vi.fn(),
}));

import * as api from '../../src/api/client';
import type { SearchResponse } from '../../src/types';

const mockSearchTasks = vi.mocked(api.searchTasks as (
  q: string,
  limit?: number,
  signal?: AbortSignal
) => Promise<SearchResponse>);

function makeSearchResponse(titles: string[]): SearchResponse {
  return {
    query:   'test',
    count:   titles.length,
    results: titles.map((title, i) => ({
      task:      { id: `t-${i}`, title, type: 'feature' as const, createdAt: '', updatedAt: '' },
      spaceId:   'space-1',
      spaceName: 'Alpha',
      column:    'todo' as const,
    })),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// Flush debounce timers AND pending Promise microtasks in one shot.
async function flushAll() {
  await act(() => vi.runAllTimersAsync());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGlobalSearch — initial state', () => {
  it('starts with idle status and empty results', () => {
    const { result } = renderHook(() => useGlobalSearch());
    expect(result.current.query).toBe('');
    expect(result.current.results).toEqual([]);
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });
});

describe('useGlobalSearch — empty / whitespace query', () => {
  it('stays idle when query is empty string', async () => {
    const { result } = renderHook(() => useGlobalSearch());

    act(() => { result.current.setQuery(''); });
    await flushAll();

    expect(mockSearchTasks).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('resets results and stays idle when query is cleared', async () => {
    mockSearchTasks.mockResolvedValue(makeSearchResponse(['Deploy app']));

    const { result } = renderHook(() => useGlobalSearch());

    // Set a query and wait for it to resolve
    act(() => { result.current.setQuery('deploy'); });
    await flushAll();

    expect(result.current.results).toHaveLength(1);

    // Clear the query
    act(() => { result.current.setQuery(''); });
    await flushAll();

    expect(result.current.results).toEqual([]);
    expect(result.current.status).toBe('idle');
  });
});

describe('useGlobalSearch — debounce', () => {
  it('does not fire request before debounce window elapses', async () => {
    const { result } = renderHook(() => useGlobalSearch());

    act(() => { result.current.setQuery('de'); });
    // Advance only 100ms — debounce hasn't fired yet
    act(() => { vi.advanceTimersByTime(100); });

    expect(mockSearchTasks).not.toHaveBeenCalled();
  });

  it('fires a request after 250ms debounce', async () => {
    mockSearchTasks.mockResolvedValue(makeSearchResponse(['Deploy app']));

    const { result } = renderHook(() => useGlobalSearch());
    act(() => { result.current.setQuery('deploy'); });
    await flushAll();

    expect(mockSearchTasks).toHaveBeenCalledTimes(1);
    expect(mockSearchTasks).toHaveBeenCalledWith('deploy', 20, expect.any(AbortSignal));
  });
});

describe('useGlobalSearch — loading status', () => {
  it('sets status to loading while request is in flight', async () => {
    let resolvePromise!: (value: SearchResponse) => void;
    mockSearchTasks.mockReturnValue(
      new Promise<SearchResponse>((r) => { resolvePromise = r; })
    );

    const { result } = renderHook(() => useGlobalSearch());
    act(() => { result.current.setQuery('deploy'); });

    // Advance timers to fire the debounce but don't flush microtasks yet
    act(() => { vi.advanceTimersByTime(300); });

    // At this point the request was issued but not yet resolved
    expect(result.current.status).toBe('loading');

    // Resolve it
    await act(async () => {
      resolvePromise(makeSearchResponse([]));
      await vi.runAllTimersAsync();
    });

    expect(result.current.status).toBe('idle');
  });
});

describe('useGlobalSearch — error handling', () => {
  it('sets status to error when request fails', async () => {
    mockSearchTasks.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useGlobalSearch());
    act(() => { result.current.setQuery('deploy'); });
    await flushAll();

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Network error');
    expect(result.current.results).toEqual([]);
  });

  it('does not set error status for AbortError (stale request)', async () => {
    const abortErr = new Error('AbortError');
    abortErr.name = 'AbortError';
    mockSearchTasks.mockRejectedValue(abortErr);

    const { result } = renderHook(() => useGlobalSearch());
    act(() => { result.current.setQuery('d'); });
    await flushAll();

    expect(result.current.status).not.toBe('error');
    expect(result.current.error).toBeNull();
  });
});

describe('useGlobalSearch — AbortController cancellation', () => {
  it('passes an AbortSignal to searchTasks', async () => {
    mockSearchTasks.mockResolvedValue(makeSearchResponse([]));

    const { result } = renderHook(() => useGlobalSearch());
    act(() => { result.current.setQuery('deploy'); });
    await flushAll();

    expect(mockSearchTasks).toHaveBeenCalled();
    const [,, signal] = mockSearchTasks.mock.calls[0];
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('populates results on successful response', async () => {
    mockSearchTasks.mockResolvedValue(makeSearchResponse(['Deploy app', 'Deploy docs']));

    const { result } = renderHook(() => useGlobalSearch());
    act(() => { result.current.setQuery('deploy'); });
    await flushAll();

    expect(result.current.results).toHaveLength(2);
    expect(result.current.results[0].task.title).toBe('Deploy app');
    expect(result.current.status).toBe('idle');
  });
});
