/**
 * QA tests — poll-loop restart after resumeInterruptedRun / resumePipeline
 * Covers the fix in commit 5138f29:
 *   - startPollLoop extracted helper
 *   - resumeInterruptedRun calls startPollLoop
 *   - resumePipeline (mid-pipeline) calls startPollLoop
 *   - visibilitychange listener re-attaches poll on tab focus
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks (must come before store import) ───────────────────────────────────

vi.mock('../../src/stores/useTerminalSessionStore', () => {
  const store = {
    getState: () => ({
      activeSendInput: vi.fn(() => null),
      sessions: [],
      activeId: null,
      panelOpen: false,
      openPanel: vi.fn(),
      closePanel: vi.fn(),
      togglePanel: vi.fn(),
      addSession: vi.fn(),
      removeSession: vi.fn(),
      setActiveId: vi.fn(),
      renameSession: vi.fn(),
      updateStatus: vi.fn(),
      registerSender: vi.fn(),
    }),
  };
  return {
    useTerminalSessionStore: Object.assign(vi.fn((selector: (s: unknown) => unknown) => {
      return selector ? selector(store.getState()) : store.getState();
    }), store),
    MAX_SESSIONS: 4,
  };
});

vi.mock('../../src/api/client', () => ({
  getSpaces:            vi.fn().mockResolvedValue([]),
  createSpace:          vi.fn(),
  renameSpace:          vi.fn(),
  deleteSpace:          vi.fn(),
  getTasks:             vi.fn().mockResolvedValue({ todo: [], 'in-progress': [], done: [] }),
  createTask:           vi.fn(),
  moveTask:             vi.fn(),
  deleteTask:           vi.fn(),
  getAttachmentContent: vi.fn(),
  getAgents:            vi.fn(),
  generatePrompt:       vi.fn(),
  getSettings:          vi.fn(),
  saveSettings:         vi.fn(),
  createAgentRun:       vi.fn().mockResolvedValue({ id: 'run_mock' }),
  updateAgentRun:       vi.fn().mockResolvedValue({ id: 'run_mock', status: 'completed' }),
  getAgentRuns:         vi.fn().mockResolvedValue({ runs: [], total: 0 }),
  startRun:             vi.fn().mockResolvedValue({
    runId: 'run-orch-1', status: 'pending', stages: ['orchestrator'],
    spaceId: 'space-1', taskId: 'task-1', createdAt: new Date().toISOString(),
  }),
  getBackendRun:        vi.fn().mockResolvedValue({
    runId: 'run-orch-1', status: 'running', currentStage: 0,
    stages: ['orchestrator'], spaceId: 'space-1', taskId: 'task-1',
    createdAt: new Date().toISOString(),
  }),
  deleteRun:            vi.fn().mockResolvedValue(undefined),
  resumeRun:            vi.fn().mockResolvedValue({
    runId: 'run-orch-1', status: 'running', stages: ['orchestrator'],
    spaceId: 'space-1', taskId: 'task-1', createdAt: new Date().toISOString(),
  }),
}));

import { useAppStore, PENDING_RUN_KEY } from '../../src/stores/useAppStore';
import * as api from '../../src/api/client';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeInterruptedPipelineState(overrides: Record<string, unknown> = {}) {
  return {
    spaceId: 'space-1',
    taskId: 'task-1',
    subTaskIds: [],
    stages: ['developer-agent', 'qa-engineer-e2e'] as unknown as string[],
    currentStageIndex: 0,
    startedAt: new Date().toISOString(),
    status: 'interrupted' as const,
    checkpoints: [],
    runId: 'run-abc',
    ...overrides,
  };
}

function makePausedPipelineState(overrides: Record<string, unknown> = {}) {
  return {
    spaceId: 'space-1',
    taskId: 'task-1',
    subTaskIds: [],
    stages: ['developer-agent', 'qa-engineer-e2e'] as unknown as string[],
    currentStageIndex: 1,
    startedAt: new Date().toISOString(),
    status: 'paused' as const,
    checkpoints: [1],
    pausedBeforeStage: 1,
    runId: 'run-paused',
    ...overrides,
  };
}

/** Build the plural-form setState payload (T-005). */
function withPs(ps: ReturnType<typeof makeInterruptedPipelineState> | ReturnType<typeof makePausedPipelineState>) {
  const key = ps.runId ?? PENDING_RUN_KEY;
  return { pipelineStates: { [key]: ps }, activePipelineRunId: key, pipelineState: ps };
}

function resetStore() {
  useAppStore.setState({
    spaces: [],
    activeSpaceId: 'default',
    tasks: { todo: [], 'in-progress': [], done: [] },
    isMutating: false,
    createModalOpen: false,
    attachmentModal: null,
    spaceModal: null,
    deleteSpaceDialog: null,
    toast: null,
    pipelineStates:      {},
    activePipelineRunId: null,
    pipelineState:       null,
    _agentRunPollId: null,
  } as Parameters<typeof useAppStore.setState>[0]);
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-001  resumeInterruptedRun starts poll when status='interrupted'
// ─────────────────────────────────────────────────────────────────────────────
describe('TC-001: resumeInterruptedRun starts poll (status=interrupted)', () => {
  it('sets _agentRunPollId to a non-null value after resume', async () => {
    useAppStore.setState(withPs(makeInterruptedPipelineState()) as any);

    await useAppStore.getState().resumeInterruptedRun();

    expect(useAppStore.getState()._agentRunPollId).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-002  resumeInterruptedRun starts poll when status='paused'
// ─────────────────────────────────────────────────────────────────────────────
describe('TC-002: resumeInterruptedRun starts poll (status=paused)', () => {
  it('sets _agentRunPollId when resuming from paused state', async () => {
    useAppStore.setState({
      pipelineState: makeInterruptedPipelineState({ status: 'paused' }) as any,
    });

    await useAppStore.getState().resumeInterruptedRun();

    expect(useAppStore.getState()._agentRunPollId).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-003  resumeInterruptedRun does NOT start poll on API failure
// ─────────────────────────────────────────────────────────────────────────────
describe('TC-003: resumeInterruptedRun does not start poll on failure', () => {
  it('leaves _agentRunPollId null when resumeRun rejects', async () => {
    vi.mocked(api.resumeRun).mockRejectedValueOnce(new Error('network error'));
    useAppStore.setState(withPs(makeInterruptedPipelineState()) as any);

    await useAppStore.getState().resumeInterruptedRun();

    expect(useAppStore.getState()._agentRunPollId).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-004  resumePipeline (mid-pipeline, runId present) starts poll
// ─────────────────────────────────────────────────────────────────────────────
describe('TC-004: resumePipeline starts poll when runId exists', () => {
  it('sets _agentRunPollId to non-null after resuming mid-pipeline checkpoint', async () => {
    useAppStore.setState(withPs(makePausedPipelineState()) as any);

    await useAppStore.getState().resumePipeline();

    expect(useAppStore.getState()._agentRunPollId).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-005  startPollLoop clears existing interval before creating new one
// ─────────────────────────────────────────────────────────────────────────────
describe('TC-005: startPollLoop clears existing interval (no duplicate polls)', () => {
  it('calls clearInterval with the previous pollId before setting a new one', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    // Simulate a stale poll already running
    const stalePollId = setInterval(() => {}, 5000);
    useAppStore.setState({
      ...withPs(makeInterruptedPipelineState()),
      _agentRunPollId: stalePollId,
    } as any);

    await useAppStore.getState().resumeInterruptedRun();

    expect(clearIntervalSpy).toHaveBeenCalledWith(stalePollId);
    // New poll id should differ from the stale one
    const newPollId = useAppStore.getState()._agentRunPollId;
    expect(newPollId).not.toBeNull();
    expect(newPollId).not.toBe(stalePollId);

    clearIntervalSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-006  Poll loop updates currentStageIndex from backend response
// ─────────────────────────────────────────────────────────────────────────────
describe('TC-006: poll loop updates currentStageIndex', () => {
  it('advances currentStageIndex when backend reports a higher stage', async () => {
    vi.mocked(api.getBackendRun).mockResolvedValue({
      runId: 'run-abc', status: 'running', currentStage: 2,
      stages: ['developer-agent', 'qa-engineer-e2e'],
      spaceId: 'space-1', taskId: 'task-1',
      createdAt: new Date().toISOString(),
    } as any);

    useAppStore.setState(withPs(makeInterruptedPipelineState()) as any);
    await useAppStore.getState().resumeInterruptedRun();

    // Advance fake timer by one poll cycle
    await vi.advanceTimersByTimeAsync(5000);

    expect(useAppStore.getState().pipelineState?.currentStageIndex).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-007  Poll loop clears on 'completed' status
// ─────────────────────────────────────────────────────────────────────────────
describe('TC-007: poll loop clears on completed status', () => {
  it('sets _agentRunPollId to null and status to completed when backend completes', async () => {
    vi.mocked(api.getBackendRun).mockResolvedValue({
      runId: 'run-abc', status: 'completed', currentStage: 2,
      stages: ['developer-agent', 'qa-engineer-e2e'],
      spaceId: 'space-1', taskId: 'task-1',
      createdAt: new Date().toISOString(),
    } as any);

    useAppStore.setState(withPs(makeInterruptedPipelineState()) as any);
    await useAppStore.getState().resumeInterruptedRun();

    await vi.advanceTimersByTimeAsync(5000);

    expect(useAppStore.getState()._agentRunPollId).toBeNull();
    // pipelineState may be null (after the 3-second clear timeout) or status=completed
    const ps = useAppStore.getState().pipelineState;
    if (ps !== null) {
      expect(ps.status).toBe('completed');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-008  Poll loop clears on 'failed' status → aborted
// ─────────────────────────────────────────────────────────────────────────────
describe('TC-008: poll loop clears on failed status', () => {
  it('sets _agentRunPollId to null and status to aborted when backend fails', async () => {
    vi.mocked(api.getBackendRun).mockResolvedValue({
      runId: 'run-abc', status: 'failed', currentStage: 1,
      stages: ['developer-agent', 'qa-engineer-e2e'],
      spaceId: 'space-1', taskId: 'task-1',
      createdAt: new Date().toISOString(),
    } as any);

    useAppStore.setState(withPs(makeInterruptedPipelineState()) as any);
    await useAppStore.getState().resumeInterruptedRun();

    await vi.advanceTimersByTimeAsync(5000);

    expect(useAppStore.getState()._agentRunPollId).toBeNull();
    const ps = useAppStore.getState().pipelineState;
    if (ps !== null) {
      expect(ps.status).toBe('aborted');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-009  Poll loop transitions to 'interrupted' and clears interval
// ─────────────────────────────────────────────────────────────────────────────
describe('TC-009: poll loop handles interrupted status from backend', () => {
  it('sets pipelineState.status to interrupted and clears _agentRunPollId', async () => {
    vi.mocked(api.getBackendRun).mockResolvedValue({
      runId: 'run-abc', status: 'interrupted', currentStage: 1,
      stages: ['developer-agent', 'qa-engineer-e2e'],
      spaceId: 'space-1', taskId: 'task-1',
      createdAt: new Date().toISOString(),
    } as any);

    useAppStore.setState(withPs(makeInterruptedPipelineState()) as any);
    await useAppStore.getState().resumeInterruptedRun();

    await vi.advanceTimersByTimeAsync(5000);

    expect(useAppStore.getState()._agentRunPollId).toBeNull();
    expect(useAppStore.getState().pipelineState?.status).toBe('interrupted');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-010  Poll loop transitions to 'paused' WITHOUT clearing the interval
// ─────────────────────────────────────────────────────────────────────────────
describe('TC-010: poll loop handles paused status (keeps polling)', () => {
  it('updates pipelineState to paused but keeps _agentRunPollId active', async () => {
    vi.mocked(api.getBackendRun).mockResolvedValue({
      runId: 'run-abc', status: 'paused', currentStage: 1, pausedBeforeStage: 1,
      stages: ['developer-agent', 'qa-engineer-e2e'],
      spaceId: 'space-1', taskId: 'task-1',
      createdAt: new Date().toISOString(),
    } as any);

    useAppStore.setState(withPs(makeInterruptedPipelineState()) as any);
    await useAppStore.getState().resumeInterruptedRun();

    await vi.advanceTimersByTimeAsync(5000);

    // Poll should still be running (not cleared)
    expect(useAppStore.getState()._agentRunPollId).not.toBeNull();
    expect(useAppStore.getState().pipelineState?.status).toBe('paused');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-011  Poll loop clears on API error
// ─────────────────────────────────────────────────────────────────────────────
describe('TC-011: poll loop clears on getBackendRun error', () => {
  it('sets _agentRunPollId to null and clears pipelineState on network error', async () => {
    // First call succeeds (to let the interval run); second throws
    vi.mocked(api.getBackendRun)
      .mockResolvedValueOnce({
        runId: 'run-abc', status: 'running', currentStage: 0,
        stages: ['developer-agent'], spaceId: 'space-1', taskId: 'task-1',
        createdAt: new Date().toISOString(),
      } as any)
      .mockRejectedValueOnce(new Error('network timeout'));

    useAppStore.setState(withPs(makeInterruptedPipelineState()) as any);
    await useAppStore.getState().resumeInterruptedRun();

    // First tick — succeeds
    await vi.advanceTimersByTimeAsync(5000);
    expect(useAppStore.getState()._agentRunPollId).not.toBeNull();

    // Second tick — throws
    await vi.advanceTimersByTimeAsync(5000);
    expect(useAppStore.getState()._agentRunPollId).toBeNull();
    expect(useAppStore.getState().pipelineState).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-012  visibilitychange restarts poll when conditions are met
// ─────────────────────────────────────────────────────────────────────────────
describe('TC-012: visibilitychange restarts poll when tab becomes visible', () => {
  it('starts a new poll loop when tab becomes visible with running pipeline and no poll', async () => {
    // Set up a running pipeline with no active poll (simulating the dropped-poll scenario)
    useAppStore.setState({
      ...withPs({ ...makeInterruptedPipelineState(), status: 'running' as const }),
      _agentRunPollId: null,
    } as any);

    // Simulate tab becoming visible
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(useAppStore.getState()._agentRunPollId).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-013  visibilitychange does NOT create duplicate poll when one is running
// ─────────────────────────────────────────────────────────────────────────────
describe('TC-013: visibilitychange skips restart when poll already running', () => {
  it('does not call setInterval again when _agentRunPollId is already set', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const existingPoll = setInterval(() => {}, 5000);
    useAppStore.setState({
      ...withPs({ ...makeInterruptedPipelineState(), status: 'running' as const }),
      _agentRunPollId: existingPoll,
    } as any);

    const callsBefore = setIntervalSpy.mock.calls.length;

    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(setIntervalSpy.mock.calls.length).toBe(callsBefore);
    setIntervalSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-014  visibilitychange does NOT restart when pipelineState is null
// ─────────────────────────────────────────────────────────────────────────────
describe('TC-014: visibilitychange skips when no active pipeline', () => {
  it('leaves _agentRunPollId null when pipelineState is null', () => {
    useAppStore.setState({ pipelineStates: {}, activePipelineRunId: null, pipelineState: null, _agentRunPollId: null } as any);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(useAppStore.getState()._agentRunPollId).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-015  visibilitychange does NOT restart when status='interrupted'
// ─────────────────────────────────────────────────────────────────────────────
describe('TC-015: visibilitychange skips when pipeline is interrupted (not running)', () => {
  it('leaves _agentRunPollId null for interrupted pipeline on tab focus', () => {
    useAppStore.setState({
      pipelineState: makeInterruptedPipelineState() as any,
      _agentRunPollId: null,
    } as any);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(useAppStore.getState()._agentRunPollId).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-016  visibilitychange fires only on 'visible' state (not 'hidden')
// ─────────────────────────────────────────────────────────────────────────────
describe('TC-016: visibilitychange only triggers on visible state', () => {
  it('does not restart poll when tab is going hidden', () => {
    useAppStore.setState({
      pipelineState: {
        ...makeInterruptedPipelineState(),
        status: 'running',
      } as any,
      _agentRunPollId: null,
    } as any);

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    // Poll should NOT have started
    expect(useAppStore.getState()._agentRunPollId).toBeNull();
  });
});
