/**
 * Unit tests for `syncAllRunStatuses` in usePolling.ts.
 *
 * The function iterates all non-primary 'running' entries in pipelineStates,
 * calls getBackendRun for each, and updates their status when the backend
 * reports a terminal state (completed / failed / cancelled / interrupted).
 * Once status changes to 'completed', the auto-dismiss timer in RunItemCompact
 * fires and removes the run from the MultiRunIndicator after 2 s.
 *
 * Test IDs:
 *  SR-001  Non-primary run completes → status updated to 'completed'
 *  SR-002  Non-primary run fails → status updated to 'interrupted'
 *  SR-003  Non-primary run still running → no update
 *  SR-004  Primary run (pipelineState mirror) is excluded from sync
 *  SR-005  Run already in terminal status is excluded
 *  SR-006  Multiple non-primary running runs → all synced concurrently
 *  SR-007  Per-run getBackendRun failure → continues syncing other runs
 *  SR-008  Run without runId (PENDING_RUN_KEY) is excluded
 *  SR-009  TOCTOU — run already transitioned before setState → no-op
 *  SR-010  cancelled backend status → 'interrupted' frontend status
 *  SR-011  finishedAt populated from run.updatedAt when available
 *  SR-012  Mirror (pipelineState) updated when the active run completes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PipelineStage, PipelineState } from '@/types';

// ── API mock — must be hoisted ────────────────────────────────────────────────
vi.mock('@/api/client', () => ({
  listRuns:          vi.fn().mockResolvedValue([]),
  getBackendRun:     vi.fn(),
  deleteRun:         vi.fn().mockResolvedValue(undefined),
  getTasks:          vi.fn().mockResolvedValue({ todo: [], 'in-progress': [], done: [] }),
  getSpaces:         vi.fn().mockResolvedValue([]),
  getSystemInfo:     vi.fn().mockResolvedValue({ platform: 'linux', version: '0.0.0' }),
  generatePrompt:    vi.fn(),
  startRun:          vi.fn(),
  resumeRun:         vi.fn(),
  getAgents:         vi.fn().mockResolvedValue([]),
  getConfigFiles:    vi.fn().mockResolvedValue([]),
  moveTask:          vi.fn().mockResolvedValue({}),
  createTask:        vi.fn().mockResolvedValue({}),
  deleteTask:        vi.fn().mockResolvedValue(undefined),
  getRunStagePrompt: vi.fn().mockResolvedValue({ prompt: '' }),
}));

import * as api from '@/api/client';
import { useAppStore } from '@/stores/useAppStore';
import { syncAllRunStatuses } from '@/hooks/usePolling';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const STARTED_AT = '2026-01-01T00:00:00.000Z';
const FINISHED_AT = '2026-01-01T00:01:00.000Z';

function makePipelineState(runId: string, status: PipelineState['status'] = 'running'): PipelineState {
  return {
    runId,
    spaceId:           'sp',
    taskId:            'tk',
    stages:            ['developer-agent'] as PipelineStage[],
    currentStageIndex: 0,
    status,
    startedAt:         STARTED_AT,
    subTaskIds:        [],
    checkpoints:       [],
  };
}

function makeBackendRun(runId: string, status: string, updatedAt?: string) {
  return {
    runId,
    status,
    spaceId:      'sp',
    taskId:       'tk',
    stages:       ['developer-agent'],
    currentStage: 0,
    createdAt:    STARTED_AT,
    updatedAt:    updatedAt ?? undefined,
  };
}

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
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── SR-001 ────────────────────────────────────────────────────────────────────

describe('SR-001: non-primary completed run → status set to completed', () => {
  it('updates pipelineStates[runId].status to completed', async () => {
    useAppStore.setState({
      pipelineStates: { 'run-B': makePipelineState('run-B') },
    });
    vi.mocked(api.getBackendRun).mockResolvedValue(
      makeBackendRun('run-B', 'completed') as any,
    );

    await syncAllRunStatuses();

    expect(useAppStore.getState().pipelineStates['run-B'].status).toBe('completed');
  });
});

// ── SR-002 ────────────────────────────────────────────────────────────────────

describe('SR-002: non-primary failed run → status set to interrupted', () => {
  it('maps backend failed → frontend interrupted', async () => {
    useAppStore.setState({
      pipelineStates: { 'run-B': makePipelineState('run-B') },
    });
    vi.mocked(api.getBackendRun).mockResolvedValue(
      makeBackendRun('run-B', 'failed') as any,
    );

    await syncAllRunStatuses();

    expect(useAppStore.getState().pipelineStates['run-B'].status).toBe('interrupted');
  });
});

// ── SR-003 ────────────────────────────────────────────────────────────────────

describe('SR-003: non-primary still-running run → no state update', () => {
  it('leaves status as running when backend still reports running', async () => {
    useAppStore.setState({
      pipelineStates: { 'run-B': makePipelineState('run-B') },
    });
    vi.mocked(api.getBackendRun).mockResolvedValue(
      makeBackendRun('run-B', 'running') as any,
    );

    await syncAllRunStatuses();

    expect(useAppStore.getState().pipelineStates['run-B'].status).toBe('running');
  });

  it('does not call setState when run is still running', async () => {
    useAppStore.setState({
      pipelineStates: { 'run-B': makePipelineState('run-B') },
    });
    vi.mocked(api.getBackendRun).mockResolvedValue(
      makeBackendRun('run-B', 'running') as any,
    );
    const setSpy = vi.spyOn(useAppStore, 'setState');

    await syncAllRunStatuses();

    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });
});

// ── SR-004 ────────────────────────────────────────────────────────────────────

describe('SR-004: primary run excluded from syncAllRunStatuses', () => {
  it('does not call getBackendRun for the primary run', async () => {
    const primary = makePipelineState('run-primary');
    useAppStore.setState({
      pipelineStates:      { 'run-primary': primary },
      activePipelineRunId: 'run-primary',
      pipelineState:       primary,
    });
    vi.mocked(api.getBackendRun).mockResolvedValue(
      makeBackendRun('run-primary', 'completed') as any,
    );

    await syncAllRunStatuses();

    expect(api.getBackendRun).not.toHaveBeenCalled();
    // Primary run status unchanged (syncPipelineState handles it).
    expect(useAppStore.getState().pipelineStates['run-primary'].status).toBe('running');
  });
});

// ── SR-005 ────────────────────────────────────────────────────────────────────

describe('SR-005: already-terminal runs excluded', () => {
  it.each(['completed', 'interrupted', 'aborted'] as const)(
    'does not call getBackendRun for status=%s',
    async (status) => {
      useAppStore.setState({
        pipelineStates: { 'run-done': makePipelineState('run-done', status) },
      });

      await syncAllRunStatuses();

      expect(api.getBackendRun).not.toHaveBeenCalled();
    },
  );
});

// ── SR-006 ────────────────────────────────────────────────────────────────────

describe('SR-006: multiple non-primary running runs → all synced', () => {
  it('updates both run-B and run-C to completed', async () => {
    useAppStore.setState({
      pipelineStates: {
        'run-B': makePipelineState('run-B'),
        'run-C': makePipelineState('run-C'),
      },
    });
    vi.mocked(api.getBackendRun).mockImplementation(async (id: string) =>
      makeBackendRun(id, 'completed') as any,
    );

    await syncAllRunStatuses();

    expect(useAppStore.getState().pipelineStates['run-B'].status).toBe('completed');
    expect(useAppStore.getState().pipelineStates['run-C'].status).toBe('completed');
  });

  it('calls getBackendRun for each non-primary run', async () => {
    useAppStore.setState({
      pipelineStates: {
        'run-B': makePipelineState('run-B'),
        'run-C': makePipelineState('run-C'),
      },
    });
    vi.mocked(api.getBackendRun).mockImplementation(async (id: string) =>
      makeBackendRun(id, 'completed') as any,
    );

    await syncAllRunStatuses();

    expect(api.getBackendRun).toHaveBeenCalledTimes(2);
    expect(api.getBackendRun).toHaveBeenCalledWith('run-B');
    expect(api.getBackendRun).toHaveBeenCalledWith('run-C');
  });
});

// ── SR-007 ────────────────────────────────────────────────────────────────────

describe('SR-007: per-run fetch failure is non-fatal', () => {
  it('still updates run-C even when getBackendRun throws for run-B', async () => {
    useAppStore.setState({
      pipelineStates: {
        'run-B': makePipelineState('run-B'),
        'run-C': makePipelineState('run-C'),
      },
    });
    vi.mocked(api.getBackendRun)
      .mockRejectedValueOnce(new Error('network error')) // run-B throws
      .mockResolvedValueOnce(makeBackendRun('run-C', 'completed') as any);

    await syncAllRunStatuses();

    expect(useAppStore.getState().pipelineStates['run-B'].status).toBe('running'); // unchanged
    expect(useAppStore.getState().pipelineStates['run-C'].status).toBe('completed');
  });
});

// ── SR-008 ────────────────────────────────────────────────────────────────────

describe('SR-008: run without runId (PENDING_RUN_KEY) is excluded', () => {
  it('does not call getBackendRun for a state entry with no runId', async () => {
    // Simulate a pending/stage-0 pause entry (no backend run created yet).
    const pendingEntry: PipelineState = {
      ...makePipelineState('run-A'),
      runId: undefined,
    };
    useAppStore.setState({
      pipelineStates: { '__pending__': pendingEntry },
    });

    await syncAllRunStatuses();

    expect(api.getBackendRun).not.toHaveBeenCalled();
  });
});

// ── SR-009 ────────────────────────────────────────────────────────────────────

describe('SR-009: TOCTOU — run transitioned before setState fires → no-op', () => {
  it('does not overwrite status when entry already transitioned', async () => {
    useAppStore.setState({
      pipelineStates: { 'run-B': makePipelineState('run-B') },
    });

    // Simulate another code path updating the run while this one awaits.
    vi.mocked(api.getBackendRun).mockImplementation(async (id: string) => {
      // Mutate state between fetch and setState.
      useAppStore.setState({
        pipelineStates: {
          'run-B': { ...makePipelineState('run-B'), status: 'interrupted' },
        },
      });
      return makeBackendRun(id, 'completed') as any;
    });

    await syncAllRunStatuses();

    // Guard fires: status was already 'interrupted', not 'running' → no overwrite.
    expect(useAppStore.getState().pipelineStates['run-B'].status).toBe('interrupted');
  });
});

// ── SR-010 ────────────────────────────────────────────────────────────────────

describe('SR-010: cancelled backend status → interrupted frontend status', () => {
  it('maps backend cancelled → frontend interrupted', async () => {
    useAppStore.setState({
      pipelineStates: { 'run-B': makePipelineState('run-B') },
    });
    vi.mocked(api.getBackendRun).mockResolvedValue(
      makeBackendRun('run-B', 'cancelled') as any,
    );

    await syncAllRunStatuses();

    expect(useAppStore.getState().pipelineStates['run-B'].status).toBe('interrupted');
  });
});

// ── SR-011 ────────────────────────────────────────────────────────────────────

describe('SR-011: finishedAt populated from run.updatedAt', () => {
  it('sets finishedAt when backend provides updatedAt', async () => {
    useAppStore.setState({
      pipelineStates: { 'run-B': makePipelineState('run-B') },
    });
    vi.mocked(api.getBackendRun).mockResolvedValue(
      makeBackendRun('run-B', 'completed', FINISHED_AT) as any,
    );

    await syncAllRunStatuses();

    expect(useAppStore.getState().pipelineStates['run-B'].finishedAt).toBe(FINISHED_AT);
  });

  it('does not set finishedAt when backend provides no updatedAt', async () => {
    useAppStore.setState({
      pipelineStates: { 'run-B': makePipelineState('run-B') },
    });
    vi.mocked(api.getBackendRun).mockResolvedValue(
      makeBackendRun('run-B', 'completed', undefined) as any,
    );

    await syncAllRunStatuses();

    expect(useAppStore.getState().pipelineStates['run-B'].finishedAt).toBeUndefined();
  });
});

// ── SR-012 ────────────────────────────────────────────────────────────────────

describe('SR-012: pipelineState mirror synced when active run is updated', () => {
  it('updates pipelineState (mirror) when activePipelineRunId run completes', async () => {
    // The active run is run-B (not run-A which is primary via pipelineState).
    // This tests the edge case where activePipelineRunId !== pipelineState?.runId.
    const psB = makePipelineState('run-B');
    const psA = makePipelineState('run-A'); // primary mirror run
    useAppStore.setState({
      pipelineStates:      { 'run-A': psA, 'run-B': psB },
      activePipelineRunId: 'run-B',
      pipelineState:       psA, // mirror points to A (different from activePipelineRunId)
    });
    vi.mocked(api.getBackendRun).mockImplementation(async (id: string) => {
      // Only return terminal for run-B; primary (run-A) is excluded
      if (id === 'run-B') return makeBackendRun('run-B', 'completed') as any;
      return makeBackendRun(id, 'running') as any;
    });

    await syncAllRunStatuses();

    // run-B updated to completed.
    expect(useAppStore.getState().pipelineStates['run-B'].status).toBe('completed');
    // pipelineState mirror updated because activePipelineRunId === 'run-B'.
    expect(useAppStore.getState().pipelineState?.status).toBe('completed');
  });

  it('does not update pipelineState mirror when a non-active run completes', async () => {
    const psA = makePipelineState('run-A'); // primary (active)
    const psB = makePipelineState('run-B'); // non-active
    useAppStore.setState({
      pipelineStates:      { 'run-A': psA, 'run-B': psB },
      activePipelineRunId: 'run-A',
      pipelineState:       psA,
    });
    vi.mocked(api.getBackendRun).mockResolvedValue(
      makeBackendRun('run-B', 'completed') as any,
    );

    await syncAllRunStatuses();

    // run-B updated but mirror still points to run-A's state.
    expect(useAppStore.getState().pipelineStates['run-B'].status).toBe('completed');
    expect(useAppStore.getState().pipelineState?.runId).toBe('run-A');
    expect(useAppStore.getState().pipelineState?.status).toBe('running');
  });
});
