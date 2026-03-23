/**
 * Tests for the usePolling hook.
 * Uses fake timers to verify adaptive-interval polling and mutation guard.
 *
 * Adaptive interval:
 *   - 1000 ms when activeRun !== null
 *   - 3000 ms when activeRun === null
 *   - Interval restarts when activeRun presence changes
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

// Minimal AgentRun fixture — only fields usePolling cares about (presence check)
const FAKE_ACTIVE_RUN = {
  taskId: 'task-1', agentId: 'developer-agent', spaceId: 'space-1',
  startedAt: new Date().toISOString(), cliCommand: 'claude', promptPath: '/tmp/p.md',
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useAppStore.setState({
    isMutating:  false,
    activeRun:   null,
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

describe('usePolling — adaptive interval', () => {
  it('polls at 1000ms when activeRun is set', async () => {
    useAppStore.setState({ activeRun: FAKE_ACTIVE_RUN } as any);
    const { unmount } = renderHook(() => usePolling());

    // Should fire at 1000ms, not 3000ms
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(api.getTasks).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('does NOT poll at 1000ms when activeRun is null (uses 3000ms idle cadence)', async () => {
    useAppStore.setState({ activeRun: null } as any);
    const { unmount } = renderHook(() => usePolling());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(api.getTasks).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(2000); // total 3000ms
    });

    expect(api.getTasks).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('switches to 1000ms interval when activeRun becomes non-null', async () => {
    const { unmount } = renderHook(() => usePolling());

    // Initially idle — advance 1500ms, should not fire yet
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(api.getTasks).not.toHaveBeenCalled();

    // Start an active run — interval restarts at 1000ms
    act(() => {
      useAppStore.setState({ activeRun: FAKE_ACTIVE_RUN } as any);
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(api.getTasks).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('switches back to 3000ms interval when activeRun becomes null', async () => {
    useAppStore.setState({ activeRun: FAKE_ACTIVE_RUN } as any);
    const { unmount } = renderHook(() => usePolling());

    // Fire once at 1000ms
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(api.getTasks).toHaveBeenCalledTimes(1);

    // Clear the active run — interval restarts at 3000ms
    act(() => {
      useAppStore.setState({ activeRun: null } as any);
    });

    // Should NOT fire again at 1000ms from now
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(api.getTasks).toHaveBeenCalledTimes(1);

    // But SHOULD fire at 3000ms from now (total 3000ms after activeRun cleared)
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(api.getTasks).toHaveBeenCalledTimes(2);
    unmount();
  });
});
