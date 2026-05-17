/**
 * Store tests for 409 MAX_CONCURRENT_REACHED handling (T-004)
 *
 * ADR-1 (multi-run-launcher §3.4):
 *   When POST /api/v1/runs responds 409 with code MAX_CONCURRENT_REACHED:
 *   - showToast(body.message, 'error') is called
 *   - pipelineStates['__pending__'] is cleared
 *   - activePipelineRunId does not point to '__pending__'
 *   - Pre-existing pipelineStates entries are unaffected
 *
 * Cases:
 *  MC-001: startPipeline 409 → toast with backend message
 *  MC-002: startPipeline 409 → __pending__ cleared
 *  MC-003: startPipeline 409 → pre-existing runs untouched
 *  MC-004: executeOrchestratorRun 409 (no terminal) → toast with backend message
 *  MC-005: executeOrchestratorRun 409 (no terminal) → __pending__ cleared
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PipelineStage, PipelineState } from '@/types';

// ── API mock ──────────────────────────────────────────────────────────────────

vi.mock('@/api/client', () => ({
  startRun:        vi.fn(),
  getBackendRun:   vi.fn(),
  resumeRun:       vi.fn(),
  deleteRun:       vi.fn().mockResolvedValue(undefined),
  getTasks:        vi.fn().mockResolvedValue({ todo: [], 'in-progress': [], done: [] }),
  getSpaces:       vi.fn().mockResolvedValue([]),
  getSystemInfo:   vi.fn().mockResolvedValue({ platform: 'linux', version: '0.0.0' }),
  generatePrompt:  vi.fn(),
  listRuns:        vi.fn().mockResolvedValue([]),
  getAgents:       vi.fn().mockResolvedValue([]),
  getConfigFiles:  vi.fn().mockResolvedValue([]),
  moveTask:        vi.fn().mockResolvedValue({}),
  createTask:      vi.fn().mockResolvedValue({}),
  deleteTask:      vi.fn().mockResolvedValue(undefined),
  getRunStagePrompt: vi.fn().mockResolvedValue({ prompt: '' }),
  // ApiError exported from the module — must be the real class so instanceof works.
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public code?: string) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

import * as api from '@/api/client';
import { ApiError } from '@/api/client';
import { useAppStore, PENDING_RUN_KEY } from '@/stores/useAppStore';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MAX_CONCURRENT_ERROR = new ApiError(
  'Maximum concurrent runs (5) reached.',
  409,
  'MAX_CONCURRENT_REACHED',
);

const makeRun = (runId: string): PipelineState => ({
  runId,
  spaceId:           'space-1',
  taskId:            'task-1',
  stages:            ['developer-agent'] as PipelineStage[],
  currentStageIndex: 0,
  status:            'running',
  startedAt:         '2026-01-01T00:00:00.000Z',
  subTaskIds:        [],
  checkpoints:       [],
});

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();

  useAppStore.setState({
    pipelineStates:      {},
    activePipelineRunId: null,
    pipelineState:       null,
    _agentRunPollId:     null,
    activeRun:           null,
    spaces:              [{ id: 'space-1', name: 'Test Space', createdAt: '', updatedAt: '' } as never],
    agentSettings:       null,
    availableAgents:     [],
  });

  vi.mocked(api.startRun).mockRejectedValue(MAX_CONCURRENT_ERROR);
});

// ── Helper to capture showToast calls ─────────────────────────────────────────

/**
 * Returns a spy on useAppStore's showToast action by temporarily
 * replacing the function in state.
 */
function captureToasts(): { messages: Array<{ msg: string; type?: string }> } {
  const captured: Array<{ msg: string; type?: string }> = [];
  const original = useAppStore.getState().showToast;
  useAppStore.setState({
    showToast: (msg: string, type?: 'success' | 'error' | 'info') => {
      captured.push({ msg, type });
      original(msg, type);
    },
  });
  return { messages: captured };
}

// ── MC-001 ────────────────────────────────────────────────────────────────────

describe('MC-001: startPipeline 409 → toast with exact backend message', () => {
  it('shows error toast with the message from the 409 response', async () => {
    const toasts = captureToasts();

    await useAppStore.getState().startPipeline('space-1', 'task-1', ['developer-agent']);

    expect(toasts.messages).toContainEqual({
      msg:  'Maximum concurrent runs (5) reached.',
      type: 'error',
    });
  });

  it('does NOT show the generic "Failed to start pipeline" message on 409', async () => {
    const toasts = captureToasts();

    await useAppStore.getState().startPipeline('space-1', 'task-1', ['developer-agent']);

    const genericMsg = toasts.messages.find((t) => t.msg.startsWith('Failed to start pipeline'));
    expect(genericMsg).toBeUndefined();
  });
});

// ── MC-002 ────────────────────────────────────────────────────────────────────

describe('MC-002: startPipeline 409 → __pending__ cleared', () => {
  it('removes __pending__ from pipelineStates after a 409', async () => {
    // Seed a __pending__ entry (simulates a prior checkpoint-0 pause flow).
    useAppStore.getState().attachRun({
      ...makeRun(PENDING_RUN_KEY),
      runId:  PENDING_RUN_KEY,
      status: 'paused',
    });

    await useAppStore.getState().startPipeline('space-1', 'task-1', ['developer-agent']);

    expect(useAppStore.getState().pipelineStates[PENDING_RUN_KEY]).toBeUndefined();
  });

  it('activePipelineRunId does not point to __pending__ after 409', async () => {
    useAppStore.getState().attachRun({
      ...makeRun(PENDING_RUN_KEY),
      runId:  PENDING_RUN_KEY,
      status: 'paused',
    });

    await useAppStore.getState().startPipeline('space-1', 'task-1', ['developer-agent']);

    expect(useAppStore.getState().activePipelineRunId).not.toBe(PENDING_RUN_KEY);
  });

  it('no-op when __pending__ is absent — store unchanged', async () => {
    const before = { ...useAppStore.getState().pipelineStates };

    await useAppStore.getState().startPipeline('space-1', 'task-1', ['developer-agent']);

    // Dict should still be empty (no phantom entry created).
    expect(Object.keys(useAppStore.getState().pipelineStates).length).toBe(
      Object.keys(before).length,
    );
  });
});

// ── MC-003 ────────────────────────────────────────────────────────────────────

describe('MC-003: startPipeline 409 → pre-existing pipeline runs are untouched', () => {
  it('a running run-A is unaffected after startPipeline returns 409', async () => {
    useAppStore.getState().attachRun(makeRun('run-A'));

    await useAppStore.getState().startPipeline('space-1', 'task-2', ['developer-agent']);

    // run-A still present and unchanged.
    expect(useAppStore.getState().pipelineStates['run-A']).toBeDefined();
    expect(useAppStore.getState().pipelineStates['run-A']?.status).toBe('running');
  });

  it('pipelineStates dict still has exactly 1 entry (run-A) after 409', async () => {
    useAppStore.getState().attachRun(makeRun('run-A'));

    await useAppStore.getState().startPipeline('space-1', 'task-2', ['developer-agent']);

    expect(Object.keys(useAppStore.getState().pipelineStates).length).toBe(1);
  });
});

// ── MC-004 ────────────────────────────────────────────────────────────────────

describe('MC-004: executeOrchestratorRun 409 (no terminal) → toast with exact message', () => {
  it('shows error toast with the backend message', async () => {
    const toasts = captureToasts();

    // No terminal sender (useTerminalSessionStore.activeSendInput returns null).
    await useAppStore.getState().executeOrchestratorRun('space-1', 'task-1', ['developer-agent']);

    expect(toasts.messages).toContainEqual({
      msg:  'Maximum concurrent runs (5) reached.',
      type: 'error',
    });
  });

  it('does NOT show the generic orchestrator error message on 409', async () => {
    const toasts = captureToasts();

    await useAppStore.getState().executeOrchestratorRun('space-1', 'task-1', ['developer-agent']);

    const genericMsg = toasts.messages.find((t) =>
      t.msg.startsWith('Failed to start orchestrator run'),
    );
    expect(genericMsg).toBeUndefined();
  });
});

// ── MC-005 ────────────────────────────────────────────────────────────────────

describe('MC-005: executeOrchestratorRun 409 (no terminal) → __pending__ cleared', () => {
  it('removes __pending__ from pipelineStates', async () => {
    useAppStore.getState().attachRun({
      ...makeRun(PENDING_RUN_KEY),
      runId:  PENDING_RUN_KEY,
      status: 'paused',
    });

    await useAppStore.getState().executeOrchestratorRun('space-1', 'task-1', ['developer-agent']);

    expect(useAppStore.getState().pipelineStates[PENDING_RUN_KEY]).toBeUndefined();
  });

  it('pre-existing run-A unaffected after executeOrchestratorRun 409', async () => {
    useAppStore.getState().attachRun(makeRun('run-A'));

    await useAppStore.getState().executeOrchestratorRun('space-1', 'task-1', ['developer-agent']);

    expect(useAppStore.getState().pipelineStates['run-A']).toBeDefined();
  });
});
