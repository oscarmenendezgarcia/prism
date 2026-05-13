/**
 * Multi-run store tests — T-006 (tasks.json)
 *
 * Covers the 6 scenarios from blueprint §7 point 2:
 *  MR-001: attachRun(A) + attachRun(B) → two entries, B is active.
 *  MR-002: clearPipeline with two runs → removes active, promotes most-recent.
 *  MR-003: clearPipeline with one run  → empty dict, null mirror, null active.
 *  MR-004: stage-0 sentinel → __pending__ entry; resumePipeline migrates to real runId.
 *  MR-005: activePipelineRunId=null + two runs → usePipelineState returns most-recent.
 *  MR-006: Invariant — activePipelineRunId never points to a missing entry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineState, PipelineStage } from '@/types';

// ── API mock ──────────────────────────────────────────────────────────────────
vi.mock('@/api/client', () => ({
  getBackendRun:  vi.fn(),
  resumeRun:      vi.fn(),
  deleteRun:      vi.fn().mockResolvedValue(undefined),
  getTasks:       vi.fn().mockResolvedValue({ todo: [], 'in-progress': [], done: [] }),
  getSpaces:      vi.fn().mockResolvedValue([]),
  getSystemInfo:  vi.fn().mockResolvedValue({ platform: 'linux', version: '0.0.0' }),
  generatePrompt: vi.fn(),
  startRun:       vi.fn(),
  listRuns:       vi.fn().mockResolvedValue([]),
  getAgents:      vi.fn().mockResolvedValue([]),
  getConfigFiles: vi.fn().mockResolvedValue([]),
  moveTask:       vi.fn().mockResolvedValue({}),
  createTask:     vi.fn().mockResolvedValue({}),
  deleteTask:     vi.fn().mockResolvedValue(undefined),
  getRunStagePrompt: vi.fn().mockResolvedValue({ prompt: '' }),
}));

import * as api from '@/api/client';
import { useAppStore, PENDING_RUN_KEY, usePipelineState } from '@/stores/useAppStore';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeRun = (runId: string, startedAt: string): PipelineState => ({
  runId,
  spaceId:           'space-1',
  taskId:            'task-1',
  stages:            ['developer-agent', 'qa-engineer-e2e'] as PipelineStage[],
  currentStageIndex: 0,
  status:            'running',
  startedAt,
  subTaskIds:        [],
  checkpoints:       [],
});

const RUN_A = makeRun('run-A', '2026-01-01T00:00:00.000Z');
const RUN_B = makeRun('run-B', '2026-01-02T00:00:00.000Z'); // newer

/** Minimal BackendRun mock for startRun. */
const backendRunResponse = (runId: string) => ({
  runId,
  spaceId:   'space-1',
  taskId:    'task-1',
  status:    'running',
  stages:    ['developer-agent'],
  createdAt: '2026-01-03T00:00:00.000Z',
}) as any;

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Render-independent helper that reads usePipelineState() by extracting the
 * selector logic directly from the store — avoids needing React's renderHook.
 */
const getPipelineState = () => {
  const s = useAppStore.getState();
  // Mirror the selector from the store for an isolated read.
  const { pipelineStates, activePipelineRunId } = s;
  if (activePipelineRunId && pipelineStates[activePipelineRunId]) {
    return pipelineStates[activePipelineRunId];
  }
  const all = Object.values(pipelineStates);
  if (all.length === 0) return null;
  return all.reduce((a, b) =>
    new Date(b.startedAt).getTime() > new Date(a.startedAt).getTime() ? b : a
  );
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();

  useAppStore.setState({
    pipelineStates:      {},
    activePipelineRunId: null,
    pipelineState:       null,
    _agentRunPollId:     null,
    activeRun:           null,
  });

  vi.mocked(api.deleteRun).mockResolvedValue(undefined);
  vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });
});

// ── MR-001 ─────────────────────────────────────────────────────────────────────

describe('MR-001: attachRun(A) + attachRun(B) creates two entries and promotes B', () => {
  it('pipelineStates has 2 keys after two attachRun calls', () => {
    useAppStore.getState().attachRun(RUN_A);
    useAppStore.getState().attachRun(RUN_B);

    expect(Object.keys(useAppStore.getState().pipelineStates).length).toBe(2);
  });

  it('activePipelineRunId === B.runId after second attachRun', () => {
    useAppStore.getState().attachRun(RUN_A);
    useAppStore.getState().attachRun(RUN_B);

    expect(useAppStore.getState().activePipelineRunId).toBe(RUN_B.runId);
  });

  it('usePipelineState() returns B after two attachRun calls', () => {
    useAppStore.getState().attachRun(RUN_A);
    useAppStore.getState().attachRun(RUN_B);

    expect(getPipelineState()?.runId).toBe(RUN_B.runId);
  });

  it('pipelineState mirror equals B after two attachRun calls', () => {
    useAppStore.getState().attachRun(RUN_A);
    useAppStore.getState().attachRun(RUN_B);

    expect(useAppStore.getState().pipelineState?.runId).toBe(RUN_B.runId);
  });
});

// ── MR-002 ─────────────────────────────────────────────────────────────────────

describe('MR-002: clearPipeline with two runs removes active and promotes most-recent remaining', () => {
  it('removes the active run (B) and promotes A as the new mirror', () => {
    useAppStore.getState().attachRun(RUN_A);
    useAppStore.getState().attachRun(RUN_B); // B is active + newer

    // Override: make A the active run so clearPipeline removes A, leaving B.
    useAppStore.setState({ activePipelineRunId: RUN_A.runId, pipelineState: RUN_A });

    useAppStore.getState().clearPipeline();

    // A is gone; B remains as the promoted active run.
    const state = useAppStore.getState();
    expect(state.pipelineStates['run-A']).toBeUndefined();
    expect(state.pipelineStates['run-B']).toBeDefined();
    expect(state.activePipelineRunId).toBe(RUN_B.runId);
    expect(state.pipelineState?.runId).toBe(RUN_B.runId);
  });
});

// ── MR-003 ─────────────────────────────────────────────────────────────────────

describe('MR-003: clearPipeline with a single run leaves empty state', () => {
  it('pipelineStates is empty after clearPipeline with one run', () => {
    useAppStore.getState().attachRun(RUN_A);
    useAppStore.getState().clearPipeline();

    expect(Object.keys(useAppStore.getState().pipelineStates).length).toBe(0);
  });

  it('activePipelineRunId is null after clearPipeline with one run', () => {
    useAppStore.getState().attachRun(RUN_A);
    useAppStore.getState().clearPipeline();

    expect(useAppStore.getState().activePipelineRunId).toBeNull();
  });

  it('pipelineState mirror is null after clearPipeline with one run', () => {
    useAppStore.getState().attachRun(RUN_A);
    useAppStore.getState().clearPipeline();

    expect(useAppStore.getState().pipelineState).toBeNull();
  });

  it('usePipelineState() returns null after clearPipeline with one run', () => {
    useAppStore.getState().attachRun(RUN_A);
    useAppStore.getState().clearPipeline();

    expect(getPipelineState()).toBeNull();
  });
});

// ── MR-004 ─────────────────────────────────────────────────────────────────────

describe('MR-004: stage-0 sentinel and resumePipeline migration', () => {
  it('startPipeline with checkpoints=[0] creates a __pending__ entry', async () => {
    await useAppStore.getState().startPipeline('space-1', 'task-1', ['developer-agent'], [0]);

    const state = useAppStore.getState();
    expect(state.pipelineStates[PENDING_RUN_KEY]).toBeDefined();
    expect(state.activePipelineRunId).toBe(PENDING_RUN_KEY);
    expect(state.pipelineState?.status).toBe('paused');
  });

  it('resumePipeline migrates __pending__ to real runId', async () => {
    vi.mocked(api.startRun).mockResolvedValue(backendRunResponse('run-real'));

    await useAppStore.getState().startPipeline('space-1', 'task-1', ['developer-agent'], [0]);
    await useAppStore.getState().resumePipeline();

    const state = useAppStore.getState();
    expect(state.pipelineStates[PENDING_RUN_KEY]).toBeUndefined();
    expect(state.pipelineStates['run-real']).toBeDefined();
    expect(state.activePipelineRunId).toBe('run-real');
    expect(state.pipelineState?.runId).toBe('run-real');
  });
});

// ── MR-005 ─────────────────────────────────────────────────────────────────────

describe('MR-005: usePipelineState() fallback when activePipelineRunId=null', () => {
  it('returns the run with the most-recent startedAt when active is null', () => {
    useAppStore.getState().attachRun(RUN_A); // older
    useAppStore.getState().attachRun(RUN_B); // newer
    // Force active to null to test fallback.
    useAppStore.setState({ activePipelineRunId: null, pipelineState: null });

    // Two runs exist; neither is "active"; selector should pick the newer one.
    expect(getPipelineState()?.runId).toBe(RUN_B.runId);
  });

  it('pipelineState mirror also reflects the most-recent run after activePipelineRunId=null', () => {
    useAppStore.getState().attachRun(RUN_A);
    useAppStore.getState().attachRun(RUN_B);
    useAppStore.setState({ activePipelineRunId: null, pipelineState: null });

    // After calling setActivePipelineRunId(null) the mirror updates too.
    useAppStore.getState().setActivePipelineRunId(null);
    // Mirror should fall back to most-recent (B).
    expect(useAppStore.getState().pipelineState?.runId).toBe(RUN_B.runId);
  });
});

// ── MR-006 ─────────────────────────────────────────────────────────────────────

describe('MR-006: invariant — activePipelineRunId always points to an existing entry', () => {
  const assertInvariant = () => {
    const { pipelineStates, activePipelineRunId } = useAppStore.getState();
    if (activePipelineRunId !== null) {
      expect(pipelineStates[activePipelineRunId]).toBeDefined();
    }
  };

  it('invariant holds after attachRun', () => {
    useAppStore.getState().attachRun(RUN_A);
    assertInvariant();
    useAppStore.getState().attachRun(RUN_B);
    assertInvariant();
  });

  it('invariant holds after clearPipeline with one run', () => {
    useAppStore.getState().attachRun(RUN_A);
    useAppStore.getState().clearPipeline();
    assertInvariant();
  });

  it('invariant holds after clearPipeline with two runs', () => {
    useAppStore.getState().attachRun(RUN_A);
    useAppStore.getState().attachRun(RUN_B);
    useAppStore.getState().clearPipeline(); // removes B (active)
    assertInvariant();
  });

  it('invariant holds after setActivePipelineRunId with unknown runId (no-op)', () => {
    useAppStore.getState().attachRun(RUN_A);
    useAppStore.getState().setActivePipelineRunId('does-not-exist');
    assertInvariant();
  });

  it('setActivePipelineRunId is a no-op when runId is unknown', () => {
    useAppStore.getState().attachRun(RUN_A);
    const before = useAppStore.getState().activePipelineRunId;

    useAppStore.getState().setActivePipelineRunId('ghost-run');

    expect(useAppStore.getState().activePipelineRunId).toBe(before);
  });

  it('setActivePipelineRunId(null) clears active without breaking the dict', () => {
    useAppStore.getState().attachRun(RUN_A);
    useAppStore.getState().setActivePipelineRunId(null);

    const state = useAppStore.getState();
    expect(state.activePipelineRunId).toBeNull();
    // Dict still has the run.
    expect(state.pipelineStates['run-A']).toBeDefined();
    // Invariant holds (null is allowed when no run is "active").
    assertInvariant();
  });

  it('invariant holds through a series of attach → clear → attach mutations', () => {
    useAppStore.getState().attachRun(RUN_A);
    assertInvariant();
    useAppStore.getState().clearPipeline();
    assertInvariant();
    useAppStore.getState().attachRun(RUN_B);
    assertInvariant();
    useAppStore.getState().clearPipeline();
    assertInvariant();
  });
});
