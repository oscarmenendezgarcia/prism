/**
 * Component tests for RunIndicator.
 * ADR-1 (run-indicator): unified component replacing AgentRunIndicator + PipelineProgressBar.
 *
 * Covers:
 *   - null render when pipelineState is null
 *   - single-agent mode (stages.length === 1): pulsing dot + displayName + elapsed + Abort
 *   - multi-stage mode (stages.length > 1): step nodes + elapsed + Abort + Dismiss
 *   - paused mode: banner with Continue + Abort + Dismiss
 *   - timer tick every second, reset on startedAt change
 *   - accessibility: role="status", aria-live="polite", aria-label
 *   - STAGE_DISPLAY map includes code-reviewer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RunIndicator } from '../../src/components/agent-launcher/RunIndicator';
import { useAppStore } from '../../src/stores/useAppStore';
import type { PipelineState, PipelineStage, AgentInfo, BlockedReason, Task } from '../../src/types';

// ---------------------------------------------------------------------------
// Mock the API client — required because the store imports it at module load
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
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_AGENTS: AgentInfo[] = [
  {
    id:          'custom-agent',
    name:        'custom-agent.md',
    displayName: 'Custom Agent',
    path:        '/home/user/.claude/agents/custom-agent.md',
    sizeBytes:   1000,
  },
];

const PIPELINE_STAGES: PipelineStage[] = [
  'senior-architect',
  'ux-api-designer',
  'developer-agent',
  'qa-engineer-e2e',
];

function makePipelineState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    spaceId:           'space-1',
    taskId:            'task-1',
    stages:            PIPELINE_STAGES,
    currentStageIndex: 0,
    startedAt:         new Date().toISOString(),
    status:            'running',
    subTaskIds:        [],
    checkpoints:       [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

const EMPTY_TASKS = { todo: [] as Task[], 'in-progress': [] as Task[], done: [] as Task[] };

function resetStore(overrides: Record<string, unknown> = {}) {
  useAppStore.setState({
    pipelineState:          null,
    availableAgents:        [],
    tasks:                  EMPTY_TASKS,
    abortPipeline:          vi.fn(),
    clearPipeline:          vi.fn(),
    resumePipeline:         vi.fn(),
    resumeInterruptedRun:   vi.fn(),
    openDetailPanel:        vi.fn(),
    ...overrides,
  } as any);
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Null render
// ---------------------------------------------------------------------------

describe('RunIndicator — null render', () => {
  it('renders nothing when pipelineState is null', () => {
    const { container } = render(<RunIndicator />);
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Single-agent mode (stages.length === 1)
// ---------------------------------------------------------------------------

describe('RunIndicator — single-agent mode (stages.length === 1)', () => {
  it('renders the single-agent dot indicator', () => {
    resetStore({ pipelineState: makePipelineState({ stages: ['developer-agent'] }) });
    render(<RunIndicator />);
    expect(screen.getByTestId('run-indicator-single')).toBeInTheDocument();
  });

  it('shows the full STAGE_DISPLAY name for developer-agent', () => {
    resetStore({ pipelineState: makePipelineState({ stages: ['developer-agent'] }) });
    render(<RunIndicator />);
    expect(screen.getByText('Developer Agent')).toBeInTheDocument();
  });

  it('shows full name for senior-architect', () => {
    resetStore({ pipelineState: makePipelineState({ stages: ['senior-architect'] }) });
    render(<RunIndicator />);
    expect(screen.getByText('Senior Architect')).toBeInTheDocument();
  });

  it('shows full name for ux-api-designer', () => {
    resetStore({ pipelineState: makePipelineState({ stages: ['ux-api-designer'] }) });
    render(<RunIndicator />);
    expect(screen.getByText('UX / API Designer')).toBeInTheDocument();
  });

  it('shows full name for qa-engineer-e2e', () => {
    resetStore({ pipelineState: makePipelineState({ stages: ['qa-engineer-e2e'] }) });
    render(<RunIndicator />);
    expect(screen.getByText('QA Engineer E2E')).toBeInTheDocument();
  });

  it('shows full name for code-reviewer (ADR-1 §3.4)', () => {
    resetStore({ pipelineState: makePipelineState({ stages: ['code-reviewer'] }) });
    render(<RunIndicator />);
    expect(screen.getByText('Code Reviewer')).toBeInTheDocument();
  });

  it('falls back to availableAgents displayName for unknown agent', () => {
    resetStore({
      pipelineState:   makePipelineState({ stages: ['custom-agent'] }),
      availableAgents: SAMPLE_AGENTS,
    });
    render(<RunIndicator />);
    expect(screen.getByText('Custom Agent')).toBeInTheDocument();
  });

  it('falls back to agentId when agent not in STAGE_DISPLAY or availableAgents', () => {
    resetStore({ pipelineState: makePipelineState({ stages: ['totally-unknown'] }) });
    render(<RunIndicator />);
    expect(screen.getByText('totally-unknown')).toBeInTheDocument();
  });

  it('shows elapsed time in m:ss format', () => {
    const startedAt = new Date(Date.now() - 65_000).toISOString();
    resetStore({ pipelineState: makePipelineState({ stages: ['developer-agent'], startedAt }) });
    render(<RunIndicator />);
    expect(screen.getByText('1:05')).toBeInTheDocument();
  });

  it('has role="status" and aria-live="polite"', () => {
    resetStore({ pipelineState: makePipelineState({ stages: ['developer-agent'] }) });
    render(<RunIndicator />);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('aria-live', 'polite');
  });

  it('aria-label contains agent name and elapsed time', () => {
    const startedAt = new Date(Date.now() - 10_000).toISOString();
    resetStore({ pipelineState: makePipelineState({ stages: ['developer-agent'], startedAt }) });
    render(<RunIndicator />);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('aria-label', expect.stringContaining('Developer Agent'));
    expect(el).toHaveAttribute('aria-label', expect.stringContaining('0:10'));
  });

  it('renders an Abort button', () => {
    resetStore({ pipelineState: makePipelineState({ stages: ['developer-agent'] }) });
    render(<RunIndicator />);
    expect(screen.getByRole('button', { name: /abort pipeline/i })).toBeInTheDocument();
  });

  it('clicking Abort calls abortPipeline', () => {
    const abortFn = vi.fn();
    resetStore({
      pipelineState: makePipelineState({ stages: ['developer-agent'] }),
      abortPipeline: abortFn,
    });
    render(<RunIndicator />);
    fireEvent.click(screen.getByRole('button', { name: /abort pipeline/i }));
    expect(abortFn).toHaveBeenCalledOnce();
  });

  it('does NOT render step-nodes indicator in single-agent mode', () => {
    resetStore({ pipelineState: makePipelineState({ stages: ['developer-agent'] }) });
    render(<RunIndicator />);
    expect(screen.queryByTestId('run-indicator-steps')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Multi-stage mode (stages.length > 1)
// ---------------------------------------------------------------------------

describe('RunIndicator — multi-stage mode (stages.length > 1)', () => {
  it('renders the step-nodes indicator', () => {
    resetStore({ pipelineState: makePipelineState() });
    render(<RunIndicator />);
    expect(screen.getByTestId('run-indicator-steps')).toBeInTheDocument();
  });

  it('aria-label contains stage count', () => {
    resetStore({ pipelineState: makePipelineState({ currentStageIndex: 0 }) });
    render(<RunIndicator />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('stage 1 of 4'),
    );
  });

  it('aria-label reflects current stage index', () => {
    resetStore({ pipelineState: makePipelineState({ currentStageIndex: 2 }) });
    render(<RunIndicator />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('stage 3 of 4'),
    );
  });

  it('renders step node aria-labels for each stage', () => {
    resetStore({ pipelineState: makePipelineState() });
    render(<RunIndicator />);
    expect(screen.getByLabelText(/architect.*running/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ux.*pending/i)).toBeInTheDocument();
  });

  it('marks past stages as done', () => {
    resetStore({ pipelineState: makePipelineState({ currentStageIndex: 1 }) });
    render(<RunIndicator />);
    expect(screen.getByLabelText(/architect.*done/i)).toBeInTheDocument();
  });

  it('shows Abort button when status is running', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'running' }) });
    render(<RunIndicator />);
    expect(screen.getByRole('button', { name: /abort pipeline/i })).toBeInTheDocument();
  });

  it('hides Abort button when status is completed', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'completed' }) });
    render(<RunIndicator />);
    expect(screen.queryByRole('button', { name: /abort pipeline/i })).toBeNull();
  });

  it('clicking Abort calls abortPipeline', () => {
    const abortFn = vi.fn();
    resetStore({ pipelineState: makePipelineState(), abortPipeline: abortFn });
    render(<RunIndicator />);
    fireEvent.click(screen.getByRole('button', { name: /abort pipeline/i }));
    expect(abortFn).toHaveBeenCalledOnce();
  });

  it('always shows Dismiss button', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'completed' }) });
    render(<RunIndicator />);
    expect(screen.getByRole('button', { name: /dismiss pipeline indicator/i })).toBeInTheDocument();
  });

  it('clicking Dismiss calls clearPipeline', () => {
    const clearFn = vi.fn();
    resetStore({ pipelineState: makePipelineState(), clearPipeline: clearFn });
    render(<RunIndicator />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss pipeline indicator/i }));
    expect(clearFn).toHaveBeenCalledOnce();
  });

  it('has role="status" and aria-live="polite"', () => {
    resetStore({ pipelineState: makePipelineState() });
    render(<RunIndicator />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('does NOT render single-agent dot in multi-stage mode', () => {
    resetStore({ pipelineState: makePipelineState() });
    render(<RunIndicator />);
    expect(screen.queryByTestId('run-indicator-single')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Paused mode
// ---------------------------------------------------------------------------

describe('RunIndicator — paused mode', () => {
  it('renders the paused banner when status is paused', () => {
    resetStore({
      pipelineState: makePipelineState({
        status: 'paused',
        pausedBeforeStage: 1,
        checkpoints: [1],
      }),
    });
    render(<RunIndicator />);
    expect(screen.getByTestId('run-indicator-paused')).toBeInTheDocument();
  });

  it('paused banner shows the stage display name', () => {
    resetStore({
      pipelineState: makePipelineState({
        status: 'paused',
        pausedBeforeStage: 1,
        checkpoints: [1],
      }),
    });
    render(<RunIndicator />);
    expect(screen.getByText(/ux \/ api designer/i)).toBeInTheDocument();
  });

  it('paused banner shows a Continue button', () => {
    resetStore({
      pipelineState: makePipelineState({
        status: 'paused',
        pausedBeforeStage: 0,
        checkpoints: [0],
      }),
    });
    render(<RunIndicator />);
    expect(screen.getByRole('button', { name: /continue pipeline/i })).toBeInTheDocument();
  });

  it('clicking Continue calls resumePipeline', () => {
    const resumeFn = vi.fn();
    resetStore({
      pipelineState: makePipelineState({
        status: 'paused',
        pausedBeforeStage: 0,
        checkpoints: [0],
      }),
      resumePipeline: resumeFn,
    });
    render(<RunIndicator />);
    fireEvent.click(screen.getByRole('button', { name: /continue pipeline/i }));
    expect(resumeFn).toHaveBeenCalledOnce();
  });

  it('paused banner shows Abort button', () => {
    const abortFn = vi.fn();
    resetStore({
      pipelineState: makePipelineState({
        status: 'paused',
        pausedBeforeStage: 2,
        checkpoints: [2],
      }),
      abortPipeline: abortFn,
    });
    render(<RunIndicator />);
    expect(screen.getByRole('button', { name: /abort pipeline/i })).toBeInTheDocument();
  });

  it('clicking Abort in paused mode calls abortPipeline', () => {
    const abortFn = vi.fn();
    resetStore({
      pipelineState: makePipelineState({
        status: 'paused',
        pausedBeforeStage: 0,
        checkpoints: [0],
      }),
      abortPipeline: abortFn,
    });
    render(<RunIndicator />);
    fireEvent.click(screen.getByRole('button', { name: /abort pipeline/i }));
    expect(abortFn).toHaveBeenCalledOnce();
  });

  it('paused banner aria-label mentions the stage name', () => {
    resetStore({
      pipelineState: makePipelineState({
        status: 'paused',
        currentStageIndex: 2,
        pausedBeforeStage: 2,
        checkpoints: [2],
      }),
    });
    render(<RunIndicator />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Developer Agent'),
    );
  });

  it('does NOT render step-nodes indicator when paused', () => {
    resetStore({
      pipelineState: makePipelineState({
        status: 'paused',
        pausedBeforeStage: 1,
        checkpoints: [1],
      }),
    });
    render(<RunIndicator />);
    expect(screen.queryByTestId('run-indicator-steps')).toBeNull();
  });

  it('paused banner shows Dismiss button', () => {
    const clearFn = vi.fn();
    resetStore({
      pipelineState: makePipelineState({
        status: 'paused',
        pausedBeforeStage: 1,
        checkpoints: [1],
      }),
      clearPipeline: clearFn,
    });
    render(<RunIndicator />);
    expect(screen.getByRole('button', { name: /dismiss pipeline indicator/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Timer behaviour
// ---------------------------------------------------------------------------

describe('RunIndicator — elapsed timer', () => {
  it('shows 0:00 for a brand-new run', () => {
    resetStore({ pipelineState: makePipelineState({ stages: ['developer-agent'] }) });
    render(<RunIndicator />);
    expect(screen.getByText('0:00')).toBeInTheDocument();
  });

  it('increments elapsed time every second in single-agent mode', () => {
    resetStore({ pipelineState: makePipelineState({ stages: ['developer-agent'] }) });
    render(<RunIndicator />);

    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText('0:03')).toBeInTheDocument();
  });

  it('increments elapsed time every second in multi-stage mode', () => {
    resetStore({ pipelineState: makePipelineState() });
    render(<RunIndicator />);

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByText('0:10')).toBeInTheDocument();
  });

  it('shows correct elapsed when startedAt is in the past', () => {
    const startedAt = new Date(Date.now() - 90_000).toISOString();
    resetStore({ pipelineState: makePipelineState({ startedAt }) });
    render(<RunIndicator />);
    expect(screen.getByText('1:30')).toBeInTheDocument();
  });

  it('clears timer on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    resetStore({ pipelineState: makePipelineState({ stages: ['developer-agent'] }) });
    const { unmount } = render(<RunIndicator />);
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('resets elapsed when pipelineState startedAt changes', () => {
    const firstState = makePipelineState({
      stages: ['developer-agent'],
      startedAt: new Date(Date.now() - 30_000).toISOString(),
    });
    resetStore({ pipelineState: firstState });
    const { rerender } = render(<RunIndicator />);
    expect(screen.getByText('0:30')).toBeInTheDocument();

    // Switch to a new pipeline starting now
    const newState = makePipelineState({
      stages: ['developer-agent'],
      startedAt: new Date().toISOString(),
    });
    useAppStore.setState({ pipelineState: newState } as any);
    rerender(<RunIndicator />);
    expect(screen.getByText('0:00')).toBeInTheDocument();
  });

  it('freezes elapsed at finishedAt when status is interrupted', () => {
    const startedAt  = new Date(Date.now() - 120_000).toISOString();
    const finishedAt = new Date(Date.now() -  45_000).toISOString();
    resetStore({
      pipelineState: makePipelineState({
        status: 'interrupted',
        startedAt,
        finishedAt,
      }),
    });
    render(<RunIndicator />);
    // elapsed = 120s - 45s = 75s → "1:15"
    expect(screen.getByText('1:15')).toBeInTheDocument();
  });

  it('does not start a setInterval when status is interrupted (timer frozen)', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const startedAt  = new Date(Date.now() - 60_000).toISOString();
    const finishedAt = new Date(Date.now() - 10_000).toISOString();
    resetStore({
      pipelineState: makePipelineState({ status: 'interrupted', startedAt, finishedAt }),
    });
    render(<RunIndicator />);
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Interrupted mode
// ---------------------------------------------------------------------------

describe('RunIndicator — interrupted mode', () => {
  it('renders the interrupted banner when status is interrupted', () => {
    resetStore({
      pipelineState: makePipelineState({ status: 'interrupted' }),
    });
    render(<RunIndicator />);
    expect(screen.getByTestId('run-indicator-interrupted')).toBeInTheDocument();
  });

  it('interrupted banner has role="status" and aria-live="polite"', () => {
    resetStore({
      pipelineState: makePipelineState({ status: 'interrupted' }),
    });
    render(<RunIndicator />);
    const el = screen.getByTestId('run-indicator-interrupted');
    expect(el).toHaveAttribute('role', 'status');
    expect(el).toHaveAttribute('aria-live', 'polite');
  });

  it('interrupted banner shows "Pipeline interrupted" text', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'interrupted' }) });
    render(<RunIndicator />);
    expect(screen.getByText(/pipeline interrupted/i)).toBeInTheDocument();
  });

  it('interrupted banner shows a Resume button', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'interrupted' }) });
    render(<RunIndicator />);
    expect(screen.getByRole('button', { name: /resume pipeline/i })).toBeInTheDocument();
  });

  it('clicking Resume calls resumeInterruptedRun', () => {
    const resumeFn = vi.fn();
    resetStore({
      pipelineState:        makePipelineState({ status: 'interrupted' }),
      resumeInterruptedRun: resumeFn,
    });
    render(<RunIndicator />);
    fireEvent.click(screen.getByRole('button', { name: /resume pipeline/i }));
    expect(resumeFn).toHaveBeenCalledOnce();
  });

  it('interrupted banner shows a Cancel button', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'interrupted' }) });
    render(<RunIndicator />);
    expect(screen.getByRole('button', { name: /cancel pipeline/i })).toBeInTheDocument();
  });

  it('clicking Cancel calls abortPipeline', () => {
    const abortFn = vi.fn();
    resetStore({
      pipelineState: makePipelineState({ status: 'interrupted' }),
      abortPipeline: abortFn,
    });
    render(<RunIndicator />);
    fireEvent.click(screen.getByRole('button', { name: /cancel pipeline/i }));
    expect(abortFn).toHaveBeenCalledOnce();
  });

  it('interrupted banner shows a Dismiss button', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'interrupted' }) });
    render(<RunIndicator />);
    expect(screen.getByRole('button', { name: /dismiss pipeline indicator/i })).toBeInTheDocument();
  });

  it('clicking Dismiss calls clearPipeline', () => {
    const clearFn = vi.fn();
    resetStore({
      pipelineState: makePipelineState({ status: 'interrupted' }),
      clearPipeline: clearFn,
    });
    render(<RunIndicator />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss pipeline indicator/i }));
    expect(clearFn).toHaveBeenCalledOnce();
  });

  it('does NOT render step-nodes or single-agent dot in interrupted mode', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'interrupted' }) });
    render(<RunIndicator />);
    expect(screen.queryByTestId('run-indicator-steps')).toBeNull();
    expect(screen.queryByTestId('run-indicator-single')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Blocked mode
// ---------------------------------------------------------------------------

describe('RunIndicator — blocked mode', () => {
  const BLOCKED_REASON: BlockedReason = {
    commentId: 'comment-1',
    taskId:    'task-1',
    author:    'developer-agent',
    text:      'Which database should we use?',
    blockedAt: new Date().toISOString(),
  };

  it('renders the blocked banner when status is blocked', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'blocked', blockedReason: BLOCKED_REASON }) });
    render(<RunIndicator />);
    expect(screen.getByTestId('run-indicator-blocked')).toBeInTheDocument();
  });

  it('blocked banner has role="status" and aria-live="polite"', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'blocked', blockedReason: BLOCKED_REASON }) });
    render(<RunIndicator />);
    const el = screen.getByTestId('run-indicator-blocked');
    expect(el).toHaveAttribute('role', 'status');
    expect(el).toHaveAttribute('aria-live', 'polite');
  });

  it('blocked banner shows the question text', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'blocked', blockedReason: BLOCKED_REASON }) });
    render(<RunIndicator />);
    expect(screen.getByText(/which database should we use\?/i)).toBeInTheDocument();
  });

  it('truncates question text longer than 60 chars with ellipsis', () => {
    const longText = 'A'.repeat(61);
    resetStore({
      pipelineState: makePipelineState({
        status: 'blocked',
        blockedReason: { ...BLOCKED_REASON, text: longText },
      }),
    });
    render(<RunIndicator />);
    // Truncated to 57 chars + "…"
    expect(screen.getByText('A'.repeat(57) + '\u2026')).toBeInTheDocument();
  });

  it('does NOT truncate question text of exactly 60 chars', () => {
    const exactText = 'B'.repeat(60);
    resetStore({
      pipelineState: makePipelineState({
        status: 'blocked',
        blockedReason: { ...BLOCKED_REASON, text: exactText },
      }),
    });
    render(<RunIndicator />);
    expect(screen.getByText(exactText)).toBeInTheDocument();
  });

  it('aria-label contains the blocked question text', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'blocked', blockedReason: BLOCKED_REASON }) });
    render(<RunIndicator />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      expect.stringContaining(BLOCKED_REASON.text),
    );
  });

  it('shows a Resolve button', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'blocked', blockedReason: BLOCKED_REASON }) });
    render(<RunIndicator />);
    expect(screen.getByRole('button', { name: /resolve question/i })).toBeInTheDocument();
  });

  it('clicking Resolve calls openDetailPanel when task exists in todo column', () => {
    const openDetailPanelFn = vi.fn();
    const matchingTask: Task = {
      id:        'task-1',
      title:     'Test Task',
      type:      'feature',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    resetStore({
      pipelineState:   makePipelineState({ status: 'blocked', blockedReason: BLOCKED_REASON }),
      openDetailPanel: openDetailPanelFn,
      tasks:           { todo: [matchingTask], 'in-progress': [], done: [] },
    });
    render(<RunIndicator />);
    fireEvent.click(screen.getByRole('button', { name: /resolve question/i }));
    expect(openDetailPanelFn).toHaveBeenCalledWith(matchingTask);
  });

  it('clicking Resolve does NOT call openDetailPanel when task is not found', () => {
    const openDetailPanelFn = vi.fn();
    resetStore({
      pipelineState:   makePipelineState({ status: 'blocked', blockedReason: BLOCKED_REASON }),
      openDetailPanel: openDetailPanelFn,
      tasks:           EMPTY_TASKS,
    });
    render(<RunIndicator />);
    fireEvent.click(screen.getByRole('button', { name: /resolve question/i }));
    expect(openDetailPanelFn).not.toHaveBeenCalled();
  });

  it('shows an Abort button', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'blocked', blockedReason: BLOCKED_REASON }) });
    render(<RunIndicator />);
    expect(screen.getByRole('button', { name: /abort pipeline/i })).toBeInTheDocument();
  });

  it('clicking Abort calls abortPipeline', () => {
    const abortFn = vi.fn();
    resetStore({
      pipelineState: makePipelineState({ status: 'blocked', blockedReason: BLOCKED_REASON }),
      abortPipeline: abortFn,
    });
    render(<RunIndicator />);
    fireEvent.click(screen.getByRole('button', { name: /abort pipeline/i }));
    expect(abortFn).toHaveBeenCalledOnce();
  });

  it('shows a Dismiss button', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'blocked', blockedReason: BLOCKED_REASON }) });
    render(<RunIndicator />);
    expect(screen.getByRole('button', { name: /dismiss pipeline indicator/i })).toBeInTheDocument();
  });

  it('clicking Dismiss calls clearPipeline', () => {
    const clearFn = vi.fn();
    resetStore({
      pipelineState: makePipelineState({ status: 'blocked', blockedReason: BLOCKED_REASON }),
      clearPipeline: clearFn,
    });
    render(<RunIndicator />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss pipeline indicator/i }));
    expect(clearFn).toHaveBeenCalledOnce();
  });

  it('does NOT render step-nodes or single-agent dot when blocked', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'blocked', blockedReason: BLOCKED_REASON }) });
    render(<RunIndicator />);
    expect(screen.queryByTestId('run-indicator-steps')).toBeNull();
    expect(screen.queryByTestId('run-indicator-single')).toBeNull();
  });

  it('renders nothing when blockedReason is absent (guards against inconsistent state)', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'blocked', blockedReason: undefined }) });
    render(<RunIndicator />);
    expect(screen.queryByTestId('run-indicator-blocked')).toBeNull();
  });
});
