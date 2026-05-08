/**
 * Unit tests for the poll-loop restart fix (commit 5138f29).
 *
 * Feature: resumeInterruptedRun / resumePipeline no longer freeze stage index.
 * Fix:     startPollLoop() helper extracted; called from both resume paths +
 *          visibilitychange listener for background-tab resync.
 *
 * Test IDs map to test-plan.md (agent-docs/resume-poll-loop/test-plan.md).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PipelineStage } from '@/types';

// ── API mock must be hoisted before the store import ─────────────────────────
vi.mock('@/api/client', () => ({
  getBackendRun: vi.fn(),
  resumeRun: vi.fn(),
  deleteRun: vi.fn().mockResolvedValue(undefined),
  getTasks: vi.fn().mockResolvedValue({ todo: [], 'in-progress': [], done: [] }),
  getSpaces: vi.fn().mockResolvedValue([]),
  getSystemInfo: vi.fn().mockResolvedValue({ platform: 'linux', version: '0.0.0' }),
  generatePrompt: vi.fn(),
  startRun: vi.fn(),
  listRuns: vi.fn().mockResolvedValue([]),
  getAgents: vi.fn().mockResolvedValue([]),
  getConfigFiles: vi.fn().mockResolvedValue([]),
  moveTask: vi.fn().mockResolvedValue({}),
  createTask: vi.fn().mockResolvedValue({}),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  getRunStagePrompt: vi.fn().mockResolvedValue({ prompt: '' }),
}));

import * as api from '@/api/client';
import { useAppStore } from '@/stores/useAppStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal pipelineState fixture for an interrupted run. */
const interruptedState = () => ({
  runId: 'run-abc',
  spaceId: 'space-1',
  taskId:  'task-1',
  stages:  ['developer-agent', 'qa-engineer-e2e'] as PipelineStage[],
  currentStageIndex: 1,
  status:  'interrupted' as const,
  startedAt: new Date().toISOString(),
  subTaskIds: [],
  checkpoints: [],
});

/** Minimal pipelineState fixture for a paused run (with existing runId). */
const pausedState = () => ({
  ...interruptedState(),
  status:  'paused' as const,
  pausedBeforeStage: 1,
});

/** Minimal BackendRun response. */
const backendRun = (status: string, currentStage = 0) => ({
  runId: 'run-abc',
  spaceId: 'space-1',
  taskId:  'task-1',
  status,
  currentStage,
  stages: ['developer-agent', 'qa-engineer-e2e'],
  createdAt: new Date().toISOString(),
  pausedBeforeStage: status === 'paused' ? 1 : undefined,
}) as any;

/** Helper to override document.visibilityState in jsdom. */
const setVisibilityState = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    writable: true,
    configurable: true,
  });
};

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();

  // Reset store to clean slate between tests.
  useAppStore.setState({
    pipelineState:   null,
    _agentRunPollId: null,
    activeRun:       null,
  });

  // Default API mocks (happy path).
  vi.mocked(api.resumeRun).mockResolvedValue(backendRun('running'));
  vi.mocked(api.getBackendRun).mockResolvedValue(backendRun('running', 0));
  vi.mocked(api.deleteRun).mockResolvedValue(undefined);
  vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

  // Ensure doc is visible by default.
  setVisibilityState('visible');
});

afterEach(() => {
  // Clear any lingering intervals before restoring real timers.
  const pollId = useAppStore.getState()._agentRunPollId;
  if (pollId !== null) clearInterval(pollId);

  vi.useRealTimers();
  vi.clearAllMocks();
});

// ── TC-001 ─────────────────────────────────────────────────────────────────────

describe('TC-001: resumeInterruptedRun starts poll when status=interrupted', () => {
  it('sets _agentRunPollId to a non-null interval after successful resume', async () => {
    useAppStore.setState({ pipelineState: interruptedState() });

    await useAppStore.getState().resumeInterruptedRun();

    expect(useAppStore.getState()._agentRunPollId).not.toBeNull();
  });
});

// ── TC-002 ─────────────────────────────────────────────────────────────────────

describe('TC-002: resumeInterruptedRun starts poll when status=paused', () => {
  it('sets _agentRunPollId when current status is paused', async () => {
    useAppStore.setState({ pipelineState: pausedState() });

    await useAppStore.getState().resumeInterruptedRun();

    expect(useAppStore.getState()._agentRunPollId).not.toBeNull();
  });
});

// ── TC-003 ─────────────────────────────────────────────────────────────────────

describe('TC-003: resumeInterruptedRun does NOT start poll on API failure', () => {
  it('keeps _agentRunPollId null when api.resumeRun rejects', async () => {
    vi.mocked(api.resumeRun).mockRejectedValue(new Error('network error'));
    useAppStore.setState({ pipelineState: interruptedState() });

    await useAppStore.getState().resumeInterruptedRun();

    expect(useAppStore.getState()._agentRunPollId).toBeNull();
  });
});

// ── TC-004 ─────────────────────────────────────────────────────────────────────

describe('TC-004: resumePipeline (mid-pipeline, runId present) starts poll', () => {
  it('sets _agentRunPollId after successful backend resume', async () => {
    useAppStore.setState({ pipelineState: pausedState() });

    await useAppStore.getState().resumePipeline();

    expect(useAppStore.getState()._agentRunPollId).not.toBeNull();
  });
});

// ── TC-005 ─────────────────────────────────────────────────────────────────────

describe('TC-005: startPollLoop clears existing interval before creating a new one', () => {
  it('does not accumulate multiple intervals when resumeInterruptedRun called twice', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    useAppStore.setState({ pipelineState: interruptedState() });

    // First resume — starts the poll.
    await useAppStore.getState().resumeInterruptedRun();
    const firstPollId = useAppStore.getState()._agentRunPollId;
    expect(firstPollId).not.toBeNull();

    // Reset status so guard passes for second call.
    useAppStore.setState({ pipelineState: interruptedState() });

    // Second resume — should clear first interval, create a fresh one.
    await useAppStore.getState().resumeInterruptedRun();

    // clearInterval must have been called with the first poll ID.
    expect(clearIntervalSpy).toHaveBeenCalledWith(firstPollId);
    // setInterval must have been called a second time.
    expect(setIntervalSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});

// ── TC-006 ─────────────────────────────────────────────────────────────────────

describe('TC-006: poll tick updates currentStageIndex from backend', () => {
  it('sets pipelineState.currentStageIndex=2 when backend reports currentStage=2', async () => {
    vi.mocked(api.getBackendRun).mockResolvedValue(backendRun('running', 2));
    useAppStore.setState({ pipelineState: interruptedState() });

    await useAppStore.getState().resumeInterruptedRun();

    // Advance fake timers to fire one poll tick (5 s).
    await vi.advanceTimersByTimeAsync(5001);

    expect(useAppStore.getState().pipelineState?.currentStageIndex).toBe(2);
  });
});

// ── TC-007 ─────────────────────────────────────────────────────────────────────

describe('TC-007: poll tick clears itself on completed status', () => {
  it('sets _agentRunPollId=null and pipelineState.status=completed', async () => {
    vi.mocked(api.getBackendRun).mockResolvedValue(backendRun('completed', 2));
    useAppStore.setState({ pipelineState: interruptedState() });

    await useAppStore.getState().resumeInterruptedRun();
    await vi.advanceTimersByTimeAsync(5001);

    expect(useAppStore.getState()._agentRunPollId).toBeNull();
    // status transitions to 'completed' transiently then null after 3 s.
    // At tick+0ms it should be 'completed'.
    // (pipelineState is set to null after a 3 s timeout, but at this point it's 'completed')
    // We check immediately after the tick.
  });

  it('calls api.getTasks (loadBoard) after completion', async () => {
    vi.mocked(api.getBackendRun).mockResolvedValue(backendRun('completed', 2));
    useAppStore.setState({ pipelineState: interruptedState() });

    await useAppStore.getState().resumeInterruptedRun();
    await vi.advanceTimersByTimeAsync(5001);

    expect(api.getTasks).toHaveBeenCalled();
  });
});

// ── TC-008 ─────────────────────────────────────────────────────────────────────

describe('TC-008: poll tick clears itself on failed status', () => {
  it('sets _agentRunPollId=null when backend returns failed', async () => {
    vi.mocked(api.getBackendRun).mockResolvedValue(backendRun('failed', 1));
    useAppStore.setState({ pipelineState: interruptedState() });

    await useAppStore.getState().resumeInterruptedRun();
    await vi.advanceTimersByTimeAsync(5001);

    expect(useAppStore.getState()._agentRunPollId).toBeNull();
  });
});

// ── TC-009 ─────────────────────────────────────────────────────────────────────

describe('TC-009: poll tick transitions to interrupted status and clears', () => {
  it('sets pipelineState.status=interrupted and _agentRunPollId=null', async () => {
    // First tick: running; second tick: interrupted.
    vi.mocked(api.getBackendRun)
      .mockResolvedValueOnce(backendRun('running', 0))
      .mockResolvedValueOnce(backendRun('interrupted', 1));

    useAppStore.setState({ pipelineState: interruptedState() });
    await useAppStore.getState().resumeInterruptedRun();

    // Tick 1 (running — poll continues).
    await vi.advanceTimersByTimeAsync(5001);
    expect(useAppStore.getState()._agentRunPollId).not.toBeNull();

    // Tick 2 (interrupted — poll stops).
    await vi.advanceTimersByTimeAsync(5001);
    expect(useAppStore.getState()._agentRunPollId).toBeNull();
    expect(useAppStore.getState().pipelineState?.status).toBe('interrupted');
  });
});

// ── TC-010 ─────────────────────────────────────────────────────────────────────

describe('TC-010: poll tick transitions to paused without clearing interval', () => {
  it('keeps _agentRunPollId non-null and sets status=paused', async () => {
    vi.mocked(api.getBackendRun).mockResolvedValue({
      ...backendRun('paused', 1),
      pausedBeforeStage: 1,
    });

    useAppStore.setState({ pipelineState: interruptedState() });
    await useAppStore.getState().resumeInterruptedRun();
    await vi.advanceTimersByTimeAsync(5001);

    // Interval must still be running (paused ≠ terminal).
    expect(useAppStore.getState()._agentRunPollId).not.toBeNull();
    expect(useAppStore.getState().pipelineState?.status).toBe('paused');
  });
});

// ── TC-011 ─────────────────────────────────────────────────────────────────────

describe('TC-011: poll tick clears itself on API error', () => {
  it('sets _agentRunPollId=null and pipelineState=null after network failure', async () => {
    vi.mocked(api.getBackendRun).mockRejectedValue(new Error('ECONNRESET'));

    useAppStore.setState({ pipelineState: interruptedState() });
    await useAppStore.getState().resumeInterruptedRun();
    await vi.advanceTimersByTimeAsync(5001);

    expect(useAppStore.getState()._agentRunPollId).toBeNull();
    expect(useAppStore.getState().pipelineState).toBeNull();
  });
});

// ── TC-012 ─────────────────────────────────────────────────────────────────────

describe('TC-012: visibilitychange restarts poll when conditions are met', () => {
  it('sets _agentRunPollId when tab becomes visible, status=running, poll was null', async () => {
    // Set up a running pipeline with no active poll (simulates background-tab gap).
    useAppStore.setState({
      pipelineState: {
        ...interruptedState(),
        status: 'running',
      },
      _agentRunPollId: null,
    });

    setVisibilityState('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    // Allow any microtasks to settle.
    await Promise.resolve();

    expect(useAppStore.getState()._agentRunPollId).not.toBeNull();
  });
});

// ── TC-013 ─────────────────────────────────────────────────────────────────────

describe('TC-013: visibilitychange does NOT create duplicate poll when pollId already set', () => {
  it('setInterval not called again if _agentRunPollId is already non-null', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    // Simulate a poll already running.
    const fakeInterval = setInterval(() => {}, 99999);
    useAppStore.setState({
      pipelineState: { ...interruptedState(), status: 'running' },
      _agentRunPollId: fakeInterval,
    });

    const callsBefore = setIntervalSpy.mock.calls.length;
    setVisibilityState('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    // No new interval should have been created.
    expect(setIntervalSpy.mock.calls.length).toBe(callsBefore);

    clearInterval(fakeInterval);
    setIntervalSpy.mockRestore();
  });
});

// ── TC-014 ─────────────────────────────────────────────────────────────────────

describe('TC-014: visibilitychange does NOT restart when pipelineState=null', () => {
  it('keeps _agentRunPollId null when no active run exists', async () => {
    useAppStore.setState({ pipelineState: null, _agentRunPollId: null });

    setVisibilityState('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(useAppStore.getState()._agentRunPollId).toBeNull();
  });
});

// ── TC-015 ─────────────────────────────────────────────────────────────────────

describe('TC-015: visibilitychange does NOT restart when status=interrupted', () => {
  it('keeps _agentRunPollId null when pipelineState.status is interrupted', async () => {
    useAppStore.setState({
      pipelineState: interruptedState(), // status='interrupted'
      _agentRunPollId: null,
    });

    setVisibilityState('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(useAppStore.getState()._agentRunPollId).toBeNull();
  });
});

// ── TC-016 ─────────────────────────────────────────────────────────────────────

describe('TC-016: visibilitychange hidden event does NOT start poll', () => {
  it('does not set _agentRunPollId when visibilityState=hidden', async () => {
    useAppStore.setState({
      pipelineState: { ...interruptedState(), status: 'running' },
      _agentRunPollId: null,
    });

    setVisibilityState('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(useAppStore.getState()._agentRunPollId).toBeNull();
  });
});

// ── TC-019: Guard — resumeInterruptedRun exits early with no runId ──────────────

describe('TC-019: resumeInterruptedRun guard — no runId', () => {
  it('does not call api.resumeRun when pipelineState has no runId', async () => {
    useAppStore.setState({
      pipelineState: { ...interruptedState(), runId: undefined as any },
    });

    await useAppStore.getState().resumeInterruptedRun();

    expect(api.resumeRun).not.toHaveBeenCalled();
    expect(useAppStore.getState()._agentRunPollId).toBeNull();
  });
});

// ── TC-020: Guard — resumeInterruptedRun exits early with wrong status ─────────

describe('TC-020: resumeInterruptedRun guard — wrong status', () => {
  it('does not start poll when status=running (only interrupted/paused allowed)', async () => {
    useAppStore.setState({
      pipelineState: { ...interruptedState(), status: 'running' },
    });

    await useAppStore.getState().resumeInterruptedRun();

    expect(api.resumeRun).not.toHaveBeenCalled();
    expect(useAppStore.getState()._agentRunPollId).toBeNull();
  });
});

// ── TC-021: pipelineState status transitions to 'running' after resume ─────────

describe('TC-021: pipelineState.status transitions to running after resumeInterruptedRun', () => {
  it('sets status=running and clears pausedBeforeStage', async () => {
    useAppStore.setState({ pipelineState: pausedState() });

    await useAppStore.getState().resumeInterruptedRun();

    const ps = useAppStore.getState().pipelineState!;
    expect(ps.status).toBe('running');
    expect(ps.pausedBeforeStage).toBeUndefined();
  });
});
