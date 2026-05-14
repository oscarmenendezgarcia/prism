/**
 * Unit tests for the `attachExternalRunIfAny` helper inside usePolling.ts.
 *
 * After the "auto-attach all active runs" change, the function:
 *  - No longer bails out when pipelineStates is non-empty.
 *  - Filters runs by status: running only (interrupted/failed are NOT auto-attached
 *    to avoid flooding the multi-run indicator with historical stale runs).
 *  - Iterates ALL candidates instead of taking only [0].
 *  - Skips runs already present in pipelineStates.
 *
 * Test IDs:
 *  AA-001  Multiple running runs → all attached
 *  AA-002  interrupted / failed runs are NOT auto-attached
 *  AA-003  Already-attached runs are skipped (idempotent)
 *  AA-004  Runs with terminal statuses (completed / cancelled) are ignored
 *  AA-005  Mix: some attached, some not → only new ones attached
 *  AA-006  Individual getBackendRun failure skips that run, continues others
 *  AA-007  listRuns network failure → graceful no-op
 *  AA-008  TOCTOU: race resolved — run attached between listRuns and getBackendRun is skipped
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PipelineStage, PipelineState } from '@/types';

// ── API mock — must be hoisted ────────────────────────────────────────────────
vi.mock('@/api/client', () => ({
  listRuns:       vi.fn().mockResolvedValue([]),
  getBackendRun:  vi.fn(),
  deleteRun:      vi.fn().mockResolvedValue(undefined),
  getTasks:       vi.fn().mockResolvedValue({ todo: [], 'in-progress': [], done: [] }),
  getSpaces:      vi.fn().mockResolvedValue([]),
  getSystemInfo:  vi.fn().mockResolvedValue({ platform: 'linux', version: '0.0.0' }),
  generatePrompt: vi.fn(),
  startRun:       vi.fn(),
  resumeRun:      vi.fn(),
  getAgents:      vi.fn().mockResolvedValue([]),
  getConfigFiles: vi.fn().mockResolvedValue([]),
  moveTask:       vi.fn().mockResolvedValue({}),
  createTask:     vi.fn().mockResolvedValue({}),
  deleteTask:     vi.fn().mockResolvedValue(undefined),
  getRunStagePrompt: vi.fn().mockResolvedValue({ prompt: '' }),
}));

import * as api from '@/api/client';
import { useAppStore } from '@/stores/useAppStore';
import { attachExternalRunIfAny } from '@/hooks/usePolling';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal list-level run (returned by listRuns). */
const listEntry = (
  runId: string,
  status: string,
  createdAt = '2026-01-01T00:00:00.000Z',
) => ({ runId, status, createdAt, updatedAt: createdAt, spaceId: 'sp', taskId: 'tk' });

/** Full BackendRun (returned by getBackendRun). */
const fullRun = (runId: string, status: string) => ({
  runId,
  status,
  spaceId:      'sp',
  taskId:       'tk',
  stages:       ['developer-agent'] as PipelineStage[],
  currentStage: 0,
  createdAt:    '2026-01-01T00:00:00.000Z',
  checkpoints:  [],
});

/** Minimal PipelineState fixture already registered in the store. */
const attachedState = (runId: string): PipelineState => ({
  runId,
  spaceId:           'sp',
  taskId:            'tk',
  stages:            ['developer-agent'] as PipelineStage[],
  currentStageIndex: 0,
  status:            'running',
  startedAt:         '2026-01-01T00:00:00.000Z',
  subTaskIds:        [],
  checkpoints:       [],
});

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  useAppStore.setState({
    pipelineStates:      {},
    activePipelineRunId: null,
    pipelineState:       null,
    activeRun:           null,
    _agentRunPollId:     null,
  });
  vi.clearAllMocks();
  vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── AA-001 ────────────────────────────────────────────────────────────────────

describe('AA-001: multiple running runs — all get attached', () => {
  it('attaches both run-A and run-B when both are running', async () => {
    vi.mocked(api.listRuns).mockResolvedValue([
      listEntry('run-A', 'running'),
      listEntry('run-B', 'running'),
    ] as any);
    vi.mocked(api.getBackendRun)
      .mockImplementation(async (id: string) => fullRun(id, 'running') as any);

    await attachExternalRunIfAny();

    const states = useAppStore.getState().pipelineStates;
    expect(states['run-A']).toBeDefined();
    expect(states['run-B']).toBeDefined();
    expect(Object.keys(states)).toHaveLength(2);
  });

  it('calls getBackendRun for each candidate, not just the first', async () => {
    vi.mocked(api.listRuns).mockResolvedValue([
      listEntry('run-A', 'running'),
      listEntry('run-B', 'running'),
    ] as any);
    vi.mocked(api.getBackendRun)
      .mockImplementation(async (id: string) => fullRun(id, 'running') as any);

    await attachExternalRunIfAny();

    expect(api.getBackendRun).toHaveBeenCalledTimes(2);
    expect(api.getBackendRun).toHaveBeenCalledWith('run-A');
    expect(api.getBackendRun).toHaveBeenCalledWith('run-B');
  });
});

// ── AA-002 ────────────────────────────────────────────────────────────────────

describe('AA-002: interrupted and failed runs are NOT auto-attached', () => {
  it('does not attach a run with status=interrupted', async () => {
    vi.mocked(api.listRuns).mockResolvedValue([
      listEntry('run-interrupted', 'interrupted'),
    ] as any);

    await attachExternalRunIfAny();

    expect(api.getBackendRun).not.toHaveBeenCalled();
    expect(useAppStore.getState().pipelineStates['run-interrupted']).toBeUndefined();
  });

  it('does not attach a run with status=failed', async () => {
    vi.mocked(api.listRuns).mockResolvedValue([
      listEntry('run-failed', 'failed'),
    ] as any);

    await attachExternalRunIfAny();

    expect(api.getBackendRun).not.toHaveBeenCalled();
    expect(useAppStore.getState().pipelineStates['run-failed']).toBeUndefined();
  });

  it('attaches running runs but ignores interrupted ones in the same batch', async () => {
    vi.mocked(api.listRuns).mockResolvedValue([
      listEntry('run-x', 'running'),
      listEntry('run-y', 'interrupted'),
    ] as any);
    vi.mocked(api.getBackendRun).mockResolvedValue(
      fullRun('run-x', 'running') as any,
    );

    await attachExternalRunIfAny();

    expect(useAppStore.getState().pipelineStates['run-x'].status).toBe('running');
    expect(useAppStore.getState().pipelineStates['run-y']).toBeUndefined();
    expect(api.getBackendRun).toHaveBeenCalledTimes(1);
    expect(api.getBackendRun).toHaveBeenCalledWith('run-x');
  });
});

// ── AA-003 ────────────────────────────────────────────────────────────────────

describe('AA-003: already-attached runs are skipped (idempotent)', () => {
  it('does not call getBackendRun for a run already in pipelineStates', async () => {
    // Pre-attach run-A.
    useAppStore.getState().attachRun(attachedState('run-A'));

    vi.mocked(api.listRuns).mockResolvedValue([
      listEntry('run-A', 'running'),
    ] as any);

    await attachExternalRunIfAny();

    expect(api.getBackendRun).not.toHaveBeenCalled();
  });

  it('does not overwrite the existing pipelineState for an already-attached run', async () => {
    useAppStore.getState().attachRun({
      ...attachedState('run-A'),
      currentStageIndex: 3, // custom stage to detect overwrite
    });

    vi.mocked(api.listRuns).mockResolvedValue([
      listEntry('run-A', 'running'),
    ] as any);
    vi.mocked(api.getBackendRun).mockResolvedValue(
      fullRun('run-A', 'running') as any,
    );

    await attachExternalRunIfAny();

    // currentStageIndex should remain 3 (not reset to 0 from fullRun).
    expect(useAppStore.getState().pipelineStates['run-A'].currentStageIndex).toBe(3);
  });

  it('only attaches the new run when one is already tracked and a second appears', async () => {
    useAppStore.getState().attachRun(attachedState('run-A'));

    vi.mocked(api.listRuns).mockResolvedValue([
      listEntry('run-A', 'running'),
      listEntry('run-B', 'running'),
    ] as any);
    vi.mocked(api.getBackendRun).mockResolvedValue(
      fullRun('run-B', 'running') as any,
    );

    await attachExternalRunIfAny();

    // Only one getBackendRun call — for run-B, not run-A.
    expect(api.getBackendRun).toHaveBeenCalledTimes(1);
    expect(api.getBackendRun).toHaveBeenCalledWith('run-B');
    expect(useAppStore.getState().pipelineStates['run-B']).toBeDefined();
  });
});

// ── AA-004 ────────────────────────────────────────────────────────────────────

describe('AA-004: terminal-status runs are ignored', () => {
  it.each(['completed', 'cancelled'] as const)(
    'does not attach a run with status=%s',
    async (status) => {
      vi.mocked(api.listRuns).mockResolvedValue([
        listEntry('run-terminal', status),
      ] as any);

      await attachExternalRunIfAny();

      expect(api.getBackendRun).not.toHaveBeenCalled();
      expect(useAppStore.getState().pipelineStates['run-terminal']).toBeUndefined();
    },
  );

  it('attaches running but ignores completed in the same batch', async () => {
    vi.mocked(api.listRuns).mockResolvedValue([
      listEntry('run-live', 'running'),
      listEntry('run-done', 'completed'),
    ] as any);
    vi.mocked(api.getBackendRun).mockResolvedValue(
      fullRun('run-live', 'running') as any,
    );

    await attachExternalRunIfAny();

    expect(useAppStore.getState().pipelineStates['run-live']).toBeDefined();
    expect(useAppStore.getState().pipelineStates['run-done']).toBeUndefined();
    expect(api.getBackendRun).toHaveBeenCalledTimes(1);
  });
});

// ── AA-005 ────────────────────────────────────────────────────────────────────

describe('AA-005: mix of attached and unattached — only unattached ones are fetched', () => {
  it('skips A (attached), attaches B (new running), ignores C (interrupted)', async () => {
    useAppStore.getState().attachRun(attachedState('run-A'));

    vi.mocked(api.listRuns).mockResolvedValue([
      listEntry('run-A', 'running'),
      listEntry('run-B', 'running'),
      listEntry('run-C', 'interrupted'),
    ] as any);
    vi.mocked(api.getBackendRun).mockResolvedValue(
      fullRun('run-B', 'running') as any,
    );

    await attachExternalRunIfAny();

    expect(api.getBackendRun).toHaveBeenCalledTimes(1);
    expect(api.getBackendRun).toHaveBeenCalledWith('run-B');
    expect(useAppStore.getState().pipelineStates['run-B']).toBeDefined();
    expect(useAppStore.getState().pipelineStates['run-C']).toBeUndefined();
    // A unchanged.
    expect(useAppStore.getState().pipelineStates['run-A']).toBeDefined();
  });
});

// ── AA-006 ────────────────────────────────────────────────────────────────────

describe('AA-006: per-run getBackendRun failure is non-fatal', () => {
  it('continues to attach run-B even when getBackendRun fails for run-A', async () => {
    vi.mocked(api.listRuns).mockResolvedValue([
      listEntry('run-A', 'running'),
      listEntry('run-B', 'running'),
    ] as any);
    vi.mocked(api.getBackendRun)
      .mockRejectedValueOnce(new Error('network error'))     // run-A fails
      .mockResolvedValueOnce(fullRun('run-B', 'running') as any); // run-B succeeds

    await attachExternalRunIfAny();

    expect(useAppStore.getState().pipelineStates['run-A']).toBeUndefined();
    expect(useAppStore.getState().pipelineStates['run-B']).toBeDefined();
  });
});

// ── AA-007 ────────────────────────────────────────────────────────────────────

describe('AA-007: listRuns network failure → silent no-op', () => {
  it('does not throw and does not modify pipelineStates on listRuns failure', async () => {
    vi.mocked(api.listRuns).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(attachExternalRunIfAny()).resolves.toBeUndefined();
    expect(Object.keys(useAppStore.getState().pipelineStates)).toHaveLength(0);
  });
});

// ── AA-008 ────────────────────────────────────────────────────────────────────

describe('AA-008: TOCTOU — run attached between listRuns and getBackendRun is skipped', () => {
  it('does not double-attach a run that was attached while awaiting getBackendRun', async () => {
    vi.mocked(api.listRuns).mockResolvedValue([
      listEntry('run-race', 'running'),
    ] as any);

    // Simulate another concurrent call attaching the run while this one waits.
    vi.mocked(api.getBackendRun).mockImplementation(async (id: string) => {
      // During the await, another caller sneaks in and attaches run-race.
      useAppStore.getState().attachRun(attachedState('run-race'));
      return fullRun(id, 'running') as any;
    });

    await attachExternalRunIfAny();

    // Only one entry should exist (not duplicated).
    expect(Object.keys(useAppStore.getState().pipelineStates)).toHaveLength(1);
    // getBackendRun was still called (the TOCTOU guard fires AFTER the fetch).
    expect(api.getBackendRun).toHaveBeenCalledTimes(1);
  });
});
