/**
 * Hook tests for useAgentCompletion.
 * BUG-002: zero coverage — these tests cover:
 *   - does nothing when activeRun is null
 *   - calls clearActiveRun + showToast when task moves to done
 *   - calls advancePipeline when autoAdvance=true and confirmBetweenStages=false
 *   - shows confirmation toast instead when confirmBetweenStages=true
 *   - does NOT call advancePipeline when autoAdvance=false
 *   - does NOT call advancePipeline when pipelineState is null
 *   - does NOT trigger when doneIds are unchanged
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppStore } from '../../src/stores/useAppStore';
import { useAgentCompletion } from '../../src/hooks/useAgentCompletion';
import type { AgentRun, PipelineState, PipelineStage, AgentSettings } from '../../src/types';

// ---------------------------------------------------------------------------
// Mock the API client
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
  getSpaces:            vi.fn(),
  getTasks:             vi.fn(),
  createTask:           vi.fn(),
  moveTask:             vi.fn(),
  deleteTask:           vi.fn(),
  createSpace:          vi.fn(),
  renameSpace:          vi.fn(),
  deleteSpace:          vi.fn(),
  getAttachmentContent: vi.fn(),
  getAgents:            vi.fn(),
  generatePrompt:       vi.fn(),
  getSettings:          vi.fn(),
  saveSettings:         vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ACTIVE_TASK_ID = 'task-active-001';

function makeActiveRun(taskId = ACTIVE_TASK_ID): AgentRun {
  return {
    taskId,
    agentId:    'developer-agent',
    spaceId:    'space-1',
    startedAt:  new Date().toISOString(),
    cliCommand: 'claude -p "$(cat /tmp/prompt.md)"',
    promptPath: '/tmp/prompt.md',
  };
}

function makePipelineState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    spaceId:           'space-1',
    stages:            ['senior-architect', 'developer-agent'] as PipelineStage[],
    currentStageIndex: 0,
    startedAt:         new Date().toISOString(),
    status:            'running',
    ...overrides,
  };
}

function makeSettings(overrides: Partial<AgentSettings['pipeline']> = {}): AgentSettings {
  return {
    cli: {
      tool: 'claude', binary: 'claude', flags: ['-p'],
      promptFlag: '-p', fileInputMethod: 'cat-subshell',
    },
    pipeline: {
      autoAdvance: true,
      confirmBetweenStages: false,
      stages: ['senior-architect', 'developer-agent'] as PipelineStage[],
      ...overrides,
    },
    prompts: { includeKanbanBlock: true, includeGitBlock: true, workingDirectory: '' },
  };
}

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

function resetStore(overrides: Record<string, unknown> = {}) {
  useAppStore.setState({
    activeRun:       null,
    availableAgents: [],
    pipelineState:   null,
    agentSettings:   null,
    tasks:           { todo: [], 'in-progress': [], done: [] },
    clearActiveRun:  vi.fn(() => useAppStore.setState({ activeRun: null } as any)),
    showToast:       vi.fn(),
    advancePipeline: vi.fn(),
    ...overrides,
  } as any);
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: render the hook and wait for one subscribe tick
// ---------------------------------------------------------------------------

function renderCompletionHook() {
  return renderHook(() => useAgentCompletion());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAgentCompletion — no activeRun', () => {
  it('does not call clearActiveRun when activeRun is null', () => {
    const clearFn = vi.fn();
    resetStore({ activeRun: null, clearActiveRun: clearFn });
    renderCompletionHook();

    // Trigger a board update — task moves to done but no activeRun
    act(() => {
      useAppStore.setState({
        tasks: {
          todo: [],
          'in-progress': [],
          done: [{ id: ACTIVE_TASK_ID, title: 'T', type: 'task', createdAt: '', updatedAt: '' }],
        },
      } as any);
    });

    expect(clearFn).not.toHaveBeenCalled();
  });
});

describe('useAgentCompletion — task completes', () => {
  it('calls clearActiveRun when activeRun.taskId appears in done column', () => {
    const clearFn = vi.fn(() => useAppStore.setState({ activeRun: null } as any));
    const toastFn = vi.fn();
    resetStore({
      activeRun:      makeActiveRun(),
      clearActiveRun: clearFn,
      showToast:      toastFn,
    });
    renderCompletionHook();

    act(() => {
      useAppStore.setState({
        tasks: {
          todo: [],
          'in-progress': [],
          done: [{ id: ACTIVE_TASK_ID, title: 'T', type: 'task', createdAt: '', updatedAt: '' }],
        },
      } as any);
    });

    expect(clearFn).toHaveBeenCalledOnce();
  });

  it('shows a completion toast when task moves to done', () => {
    const toastFn = vi.fn();
    resetStore({
      activeRun: makeActiveRun(),
      showToast: toastFn,
    });
    renderCompletionHook();

    act(() => {
      useAppStore.setState({
        tasks: {
          todo: [],
          'in-progress': [],
          done: [{ id: ACTIVE_TASK_ID, title: 'T', type: 'task', createdAt: '', updatedAt: '' }],
        },
      } as any);
    });

    expect(toastFn).toHaveBeenCalledWith(expect.stringContaining('completed'));
  });

  it('uses agent displayName in completion toast when agent is in availableAgents', () => {
    const toastFn = vi.fn();
    resetStore({
      activeRun:       makeActiveRun(),
      availableAgents: [{ id: 'developer-agent', displayName: 'Developer', name: 'developer-agent.md', path: '/a', sizeBytes: 100 }],
      showToast:       toastFn,
    });
    renderCompletionHook();

    act(() => {
      useAppStore.setState({
        tasks: {
          todo: [],
          'in-progress': [],
          done: [{ id: ACTIVE_TASK_ID, title: 'T', type: 'task', createdAt: '', updatedAt: '' }],
        },
      } as any);
    });

    expect(toastFn).toHaveBeenCalledWith(expect.stringContaining('Developer'));
  });

  it('does NOT call clearActiveRun when task is NOT in done column', () => {
    const clearFn = vi.fn();
    resetStore({ activeRun: makeActiveRun(), clearActiveRun: clearFn });
    renderCompletionHook();

    act(() => {
      useAppStore.setState({
        tasks: {
          todo: [],
          'in-progress': [{ id: ACTIVE_TASK_ID, title: 'T', type: 'task', createdAt: '', updatedAt: '' }],
          done: [],
        },
      } as any);
    });

    expect(clearFn).not.toHaveBeenCalled();
  });

  it('does NOT fire again if doneIds have not changed', () => {
    const clearFn = vi.fn(() => useAppStore.setState({ activeRun: null } as any));
    resetStore({
      activeRun: makeActiveRun(),
      clearActiveRun: clearFn,
    });
    renderCompletionHook();

    const doneTask = { id: ACTIVE_TASK_ID, title: 'T', type: 'task', createdAt: '', updatedAt: '' };

    act(() => {
      useAppStore.setState({
        tasks: { todo: [], 'in-progress': [], done: [doneTask] },
      } as any);
    });

    const callsAfterFirst = clearFn.mock.calls.length;

    // Same state update — doneIds unchanged, should not fire again
    act(() => {
      useAppStore.setState({
        tasks: { todo: [], 'in-progress': [], done: [doneTask] },
      } as any);
    });

    expect(clearFn.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe('useAgentCompletion — pipeline auto-advance', () => {
  it('calls advancePipeline when autoAdvance=true and confirmBetweenStages=false', () => {
    const advanceFn = vi.fn();
    resetStore({
      activeRun:       makeActiveRun(),
      pipelineState:   makePipelineState(),
      agentSettings:   makeSettings({ autoAdvance: true, confirmBetweenStages: false }),
      advancePipeline: advanceFn,
    });
    renderCompletionHook();

    act(() => {
      useAppStore.setState({
        tasks: {
          todo: [],
          'in-progress': [],
          done: [{ id: ACTIVE_TASK_ID, title: 'T', type: 'task', createdAt: '', updatedAt: '' }],
        },
      } as any);
    });

    expect(advanceFn).toHaveBeenCalledOnce();
  });

  it('does NOT call advancePipeline when autoAdvance=false', () => {
    const advanceFn = vi.fn();
    resetStore({
      activeRun:       makeActiveRun(),
      pipelineState:   makePipelineState(),
      agentSettings:   makeSettings({ autoAdvance: false }),
      advancePipeline: advanceFn,
    });
    renderCompletionHook();

    act(() => {
      useAppStore.setState({
        tasks: {
          todo: [],
          'in-progress': [],
          done: [{ id: ACTIVE_TASK_ID, title: 'T', type: 'task', createdAt: '', updatedAt: '' }],
        },
      } as any);
    });

    expect(advanceFn).not.toHaveBeenCalled();
  });

  it('shows confirmation toast when confirmBetweenStages=true and autoAdvance=true', () => {
    const advanceFn = vi.fn();
    const toastFn   = vi.fn();
    resetStore({
      activeRun:       makeActiveRun(),
      pipelineState:   makePipelineState({ currentStageIndex: 0 }),
      agentSettings:   makeSettings({ autoAdvance: true, confirmBetweenStages: true }),
      advancePipeline: advanceFn,
      showToast:       toastFn,
    });
    renderCompletionHook();

    act(() => {
      useAppStore.setState({
        tasks: {
          todo: [],
          'in-progress': [],
          done: [{ id: ACTIVE_TASK_ID, title: 'T', type: 'task', createdAt: '', updatedAt: '' }],
        },
      } as any);
    });

    expect(advanceFn).not.toHaveBeenCalled();
    // Toast should mention stage progression
    expect(toastFn).toHaveBeenCalledWith(expect.stringContaining('Advance'));
  });

  it('does NOT call advancePipeline when pipelineState is null', () => {
    const advanceFn = vi.fn();
    resetStore({
      activeRun:       makeActiveRun(),
      pipelineState:   null,
      agentSettings:   makeSettings({ autoAdvance: true, confirmBetweenStages: false }),
      advancePipeline: advanceFn,
    });
    renderCompletionHook();

    act(() => {
      useAppStore.setState({
        tasks: {
          todo: [],
          'in-progress': [],
          done: [{ id: ACTIVE_TASK_ID, title: 'T', type: 'task', createdAt: '', updatedAt: '' }],
        },
      } as any);
    });

    expect(advanceFn).not.toHaveBeenCalled();
  });

  it('does NOT call advancePipeline when pipelineState.status is not running', () => {
    const advanceFn = vi.fn();
    resetStore({
      activeRun:       makeActiveRun(),
      pipelineState:   makePipelineState({ status: 'completed' }),
      agentSettings:   makeSettings({ autoAdvance: true, confirmBetweenStages: false }),
      advancePipeline: advanceFn,
    });
    renderCompletionHook();

    act(() => {
      useAppStore.setState({
        tasks: {
          todo: [],
          'in-progress': [],
          done: [{ id: ACTIVE_TASK_ID, title: 'T', type: 'task', createdAt: '', updatedAt: '' }],
        },
      } as any);
    });

    expect(advanceFn).not.toHaveBeenCalled();
  });
});
