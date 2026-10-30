/**
 * Tests for the usePolling hook.
 * Uses fake timers to verify polling and the mutation guard.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePolling } from '../../src/hooks/usePolling';
import { useAppStore } from '../../src/stores/useAppStore';

// Mock the api client used by the store
vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(),
  getTasks: vi.fn(),
  createSpace: vi.fn(),
  renameSpace: vi.fn(),
  deleteSpace: vi.fn(),
  createTask: vi.fn(),
  moveTask: vi.fn(),
  deleteTask: vi.fn(),
  getAttachmentContent: vi.fn(),
}));

import * as api from '../../src/api/client';

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useAppStore.setState({
    isMutating:  false,
    tasks:       { todo: [], 'in-progress': [], done: [] },
    activeSpaceId: 'default',
  });
  vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePolling', () => {
  it('calls loadBoard every 3000ms', async () => {
    const { unmount } = renderHook(() => usePolling());

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(api.getTasks).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(api.getTasks).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('skips loadBoard when isMutating is true', async () => {
    useAppStore.setState({ isMutating: true });
    const { unmount } = renderHook(() => usePolling());

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(api.getTasks).not.toHaveBeenCalled();
    unmount();
  });

  it('clears interval on unmount', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = renderHook(() => usePolling());

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('does not create multiple intervals on re-render', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { rerender, unmount } = renderHook(() => usePolling());

    rerender();
    rerender();

    // setInterval should only be called once (from the initial mount effect)
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('resumes polling when isMutating becomes false', async () => {
    useAppStore.setState({ isMutating: true });
    const { unmount } = renderHook(() => usePolling());

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(api.getTasks).not.toHaveBeenCalled();

    // Unset isMutating
    act(() => {
      useAppStore.setState({ isMutating: false });
    });

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(api.getTasks).toHaveBeenCalledTimes(1);
    unmount();
  });
});

