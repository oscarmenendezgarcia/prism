/**
 * Unit tests for usePipelineLogPolling hook.
 * ADR-1 (log-viewer) T-010: polling cadence, LogNotAvailableError path, cleanup.
 * Uses fake timers to avoid real 2 s waits.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePipelineLogStore } from '../../src/stores/usePipelineLogStore';

// ---------------------------------------------------------------------------
// Mock api/client — must be before importing the hook
// ---------------------------------------------------------------------------

const mockGetStageLog = vi.fn();

vi.mock('../../src/api/client', () => ({
  getStageLog: (...args: unknown[]) => mockGetStageLog(...args),
  LogNotAvailableError: class LogNotAvailableError extends Error {
    constructor() {
      super('LOG_NOT_AVAILABLE');
      this.name = 'LogNotAvailableError';
    }
  },
}));

import { usePipelineLogPolling } from '../../src/hooks/usePipelineLogPolling';
import { LogNotAvailableError } from '../../src/api/client';

function resetStore() {
  usePipelineLogStore.setState({
    logPanelOpen:       true,
    selectedStageIndex: 0,
    stageLogs:          {},
    stageLoading:       {},
    stageErrors:        {},
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePipelineLogPolling — no runId', () => {
  it('does not fetch when runId is null', async () => {
    renderHook(() => usePipelineLogPolling({ runId: null, stageIndex: 0, isRunActive: true }));
    await act(async () => { await Promise.resolve(); });
    expect(mockGetStageLog).not.toHaveBeenCalled();
  });
});

describe('usePipelineLogPolling — isRunActive=false (static run)', () => {
  it('fetches once on mount', async () => {
    mockGetStageLog.mockResolvedValue('log content');
    renderHook(() => usePipelineLogPolling({ runId: 'run-1', stageIndex: 0, isRunActive: false }));

    await act(async () => { await Promise.resolve(); });

    expect(mockGetStageLog).toHaveBeenCalledTimes(1);
    expect(mockGetStageLog).toHaveBeenCalledWith('run-1', 0, 500);
  });

  it('does not repeat after the initial fetch', async () => {
    mockGetStageLog.mockResolvedValue('log content');
    renderHook(() => usePipelineLogPolling({ runId: 'run-1', stageIndex: 0, isRunActive: false }));

    await act(async () => { await Promise.resolve(); });
    vi.advanceTimersByTime(10_000);
    await act(async () => { await Promise.resolve(); });

    expect(mockGetStageLog).toHaveBeenCalledTimes(1);
  });

  it('stores fetched log content in store', async () => {
    mockGetStageLog.mockResolvedValue('static log');
    renderHook(() => usePipelineLogPolling({ runId: 'run-1', stageIndex: 0, isRunActive: false }));

    await act(async () => { await Promise.resolve(); });

    expect(usePipelineLogStore.getState().stageLogs[0]).toBe('static log');
  });
});

describe('usePipelineLogPolling — isRunActive=true (live polling)', () => {
  it('fetches immediately on mount', async () => {
    mockGetStageLog.mockResolvedValue('live log');
    renderHook(() => usePipelineLogPolling({ runId: 'run-1', stageIndex: 0, isRunActive: true }));

    await act(async () => { await Promise.resolve(); });

    expect(mockGetStageLog).toHaveBeenCalledTimes(1);
  });

  it('fetches again after 2000ms interval', async () => {
    mockGetStageLog.mockResolvedValue('live log');
    renderHook(() => usePipelineLogPolling({ runId: 'run-1', stageIndex: 0, isRunActive: true }));

    await act(async () => { await Promise.resolve(); });          // initial fetch
    await act(async () => { vi.advanceTimersByTime(2000); });
    await act(async () => { await Promise.resolve(); });          // interval fetch

    expect(mockGetStageLog).toHaveBeenCalledTimes(2);
  });

  it('fetches three times after two 2000ms ticks', async () => {
    mockGetStageLog.mockResolvedValue('live log');
    renderHook(() => usePipelineLogPolling({ runId: 'run-1', stageIndex: 0, isRunActive: true }));

    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(4000); });
    await act(async () => { await Promise.resolve(); });

    expect(mockGetStageLog).toHaveBeenCalledTimes(3);
  });

  it('clears interval on unmount (no leak)', async () => {
    mockGetStageLog.mockResolvedValue('live log');
    const { unmount } = renderHook(() =>
      usePipelineLogPolling({ runId: 'run-1', stageIndex: 0, isRunActive: true })
    );

    await act(async () => { await Promise.resolve(); });
    const callsAtUnmount = mockGetStageLog.mock.calls.length;

    unmount();

    vi.advanceTimersByTime(10_000);
    await act(async () => { await Promise.resolve(); });

    // No additional calls after unmount.
    expect(mockGetStageLog).toHaveBeenCalledTimes(callsAtUnmount);
  });
});

describe('usePipelineLogPolling — stageIndex changes', () => {
  it('re-fetches immediately when stageIndex changes', async () => {
    mockGetStageLog.mockResolvedValue('log');
    const { rerender } = renderHook(
      ({ stageIndex }: { stageIndex: number }) =>
        usePipelineLogPolling({ runId: 'run-1', stageIndex, isRunActive: false }),
      { initialProps: { stageIndex: 0 } },
    );

    await act(async () => { await Promise.resolve(); });
    expect(mockGetStageLog).toHaveBeenCalledTimes(1);

    rerender({ stageIndex: 1 });
    await act(async () => { await Promise.resolve(); });

    expect(mockGetStageLog).toHaveBeenCalledTimes(2);
    expect(mockGetStageLog).toHaveBeenLastCalledWith('run-1', 1, 500);
  });
});

describe('usePipelineLogPolling — LogNotAvailableError', () => {
  it('sets stageLog to empty string and leaves stageError null', async () => {
    mockGetStageLog.mockRejectedValue(new LogNotAvailableError());
    renderHook(() => usePipelineLogPolling({ runId: 'run-1', stageIndex: 0, isRunActive: false }));

    await act(async () => { await Promise.resolve(); });

    expect(usePipelineLogStore.getState().stageLogs[0]).toBe('');
    expect(usePipelineLogStore.getState().stageErrors[0]).toBeNull();
  });
});

describe('usePipelineLogPolling — generic HTTP error', () => {
  it('sets stageError message in store', async () => {
    mockGetStageLog.mockRejectedValue(new Error('HTTP 500'));
    renderHook(() => usePipelineLogPolling({ runId: 'run-1', stageIndex: 0, isRunActive: false }));

    await act(async () => { await Promise.resolve(); });

    expect(usePipelineLogStore.getState().stageErrors[0]).toBe('HTTP 500');
  });

  it('does not set stageLog when a real error occurs', async () => {
    mockGetStageLog.mockRejectedValue(new Error('server error'));
    renderHook(() => usePipelineLogPolling({ runId: 'run-1', stageIndex: 0, isRunActive: false }));

    await act(async () => { await Promise.resolve(); });

    expect(usePipelineLogStore.getState().stageLogs[0]).toBeUndefined();
  });
});

describe('usePipelineLogPolling — loading flag', () => {
  it('sets loading to true during fetch then false after', async () => {
    let resolveLog!: (v: string) => void;
    mockGetStageLog.mockReturnValue(
      new Promise<string>((res) => { resolveLog = res; })
    );

    renderHook(() => usePipelineLogPolling({ runId: 'run-1', stageIndex: 0, isRunActive: false }));

    // Loading should be true while promise is pending.
    expect(usePipelineLogStore.getState().stageLoading[0]).toBe(true);

    await act(async () => { resolveLog('content'); await Promise.resolve(); });

    expect(usePipelineLogStore.getState().stageLoading[0]).toBe(false);
  });
});
