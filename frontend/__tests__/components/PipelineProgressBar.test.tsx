/**
 * Component tests for PipelineProgressBar.
 * BUG-002: zero coverage — these tests cover:
 *   - hidden when pipelineState is null
 *   - renders stage indicators for a running pipeline
 *   - Abort button calls abortPipeline
 *   - Abort button hidden when status is 'completed'
 *   - elapsed time display
 *   - aria-label with stage count
 *
 * T-3 additions:
 *   - paused banner shown when status === 'paused'
 *   - Continue button calls resumePipeline
 *   - paused banner shows the stage name
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PipelineProgressBar } from '../../src/components/agent-launcher/PipelineProgressBar';
import { useAppStore } from '../../src/stores/useAppStore';
import type { PipelineState, PipelineStage } from '../../src/types';

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

const STAGES: PipelineStage[] = [
  'senior-architect',
  'ux-api-designer',
  'developer-agent',
  'qa-engineer-e2e',
];

function makePipelineState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    spaceId:           'space-1',
    taskId:            'task-1',
    stages:            STAGES,
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

function resetStore(overrides: Record<string, unknown> = {}) {
  useAppStore.setState({
    pipelineState: null,
    abortPipeline: vi.fn(),
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
// Tests
// ---------------------------------------------------------------------------

describe('PipelineProgressBar — hidden state', () => {
  it('renders nothing when pipelineState is null', () => {
    resetStore({ pipelineState: null });
    const { container } = render(<PipelineProgressBar />);
    expect(container.firstChild).toBeNull();
  });
});

describe('PipelineProgressBar — stage rendering', () => {
  it('renders the status region when pipelineState is set', () => {
    resetStore({ pipelineState: makePipelineState() });
    render(<PipelineProgressBar />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('aria-label contains current stage and total stages', () => {
    resetStore({ pipelineState: makePipelineState({ currentStageIndex: 0 }) });
    render(<PipelineProgressBar />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('stage 1 of 4')
    );
  });

  it('aria-label reflects the current stage index', () => {
    resetStore({ pipelineState: makePipelineState({ currentStageIndex: 2 }) });
    render(<PipelineProgressBar />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('stage 3 of 4')
    );
  });

  it('renders stage labels as aria-labels on each node', () => {
    resetStore({ pipelineState: makePipelineState() });
    render(<PipelineProgressBar />);
    // Each stage node has an aria-label
    expect(screen.getByLabelText(/architect.*running/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ux.*pending/i)).toBeInTheDocument();
  });

  it('marks past stages as done in aria-label', () => {
    resetStore({ pipelineState: makePipelineState({ currentStageIndex: 1 }) });
    render(<PipelineProgressBar />);
    expect(screen.getByLabelText(/architect.*done/i)).toBeInTheDocument();
  });

  it('marks completed status — all stages done', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'completed', currentStageIndex: 3 }) });
    render(<PipelineProgressBar />);
    // All nodes should be "done" aria-label
    const doneNodes = screen.getAllByLabelText(/.*done/i);
    expect(doneNodes.length).toBeGreaterThanOrEqual(4);
  });
});

describe('PipelineProgressBar — elapsed timer', () => {
  it('shows 0:00 initially', () => {
    resetStore({ pipelineState: makePipelineState() });
    render(<PipelineProgressBar />);
    expect(screen.getByText('0:00')).toBeInTheDocument();
  });

  it('increments elapsed time every second', () => {
    resetStore({ pipelineState: makePipelineState() });
    render(<PipelineProgressBar />);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByText('0:10')).toBeInTheDocument();
  });

  it('shows pipeline elapsed when startedAt is in the past', () => {
    const startedAt = new Date(Date.now() - 90_000).toISOString();
    resetStore({ pipelineState: makePipelineState({ startedAt }) });
    render(<PipelineProgressBar />);
    expect(screen.getByText('1:30')).toBeInTheDocument();
  });

  it('clears timer on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    resetStore({ pipelineState: makePipelineState() });
    const { unmount } = render(<PipelineProgressBar />);
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});

describe('PipelineProgressBar — Abort button', () => {
  it('shows Abort button when status is running', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'running' }) });
    render(<PipelineProgressBar />);
    expect(screen.getByRole('button', { name: /abort pipeline/i })).toBeInTheDocument();
  });

  it('hides Abort button when status is completed', () => {
    resetStore({ pipelineState: makePipelineState({ status: 'completed' }) });
    render(<PipelineProgressBar />);
    expect(screen.queryByRole('button', { name: /abort pipeline/i })).toBeNull();
  });

  it('clicking Abort calls abortPipeline from store', () => {
    const abortFn = vi.fn();
    resetStore({ pipelineState: makePipelineState(), abortPipeline: abortFn });
    render(<PipelineProgressBar />);
    fireEvent.click(screen.getByRole('button', { name: /abort pipeline/i }));
    expect(abortFn).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// T-3: Paused banner
// ---------------------------------------------------------------------------

describe('PipelineProgressBar — paused banner (T-3)', () => {
  it('renders paused banner when status is paused', () => {
    resetStore({
      pipelineState: makePipelineState({
        status: 'paused',
        currentStageIndex: 1,
        pausedBeforeStage: 1,
        checkpoints: [1],
      }),
      resumePipeline: vi.fn(),
    });
    render(<PipelineProgressBar />);
    expect(screen.getByTestId('pipeline-paused-banner')).toBeInTheDocument();
  });

  it('paused banner shows the stage display name', () => {
    resetStore({
      pipelineState: makePipelineState({
        status: 'paused',
        currentStageIndex: 1,
        pausedBeforeStage: 1,
        checkpoints: [1],
      }),
      resumePipeline: vi.fn(),
    });
    render(<PipelineProgressBar />);
    expect(screen.getByText(/ux \/ api designer/i)).toBeInTheDocument();
  });

  it('paused banner shows a Continue button', () => {
    resetStore({
      pipelineState: makePipelineState({
        status: 'paused',
        pausedBeforeStage: 0,
        checkpoints: [0],
      }),
      resumePipeline: vi.fn(),
    });
    render(<PipelineProgressBar />);
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
    render(<PipelineProgressBar />);
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
      resumePipeline: vi.fn(),
    });
    render(<PipelineProgressBar />);
    expect(screen.getByRole('button', { name: /abort pipeline/i })).toBeInTheDocument();
  });

  it('paused banner aria-label mentions the stage', () => {
    resetStore({
      pipelineState: makePipelineState({
        status: 'paused',
        currentStageIndex: 2,
        pausedBeforeStage: 2,
        checkpoints: [2],
      }),
      resumePipeline: vi.fn(),
    });
    render(<PipelineProgressBar />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Developer Agent')
    );
  });

  it('does NOT show the running stage-step indicator when paused', () => {
    resetStore({
      pipelineState: makePipelineState({
        status: 'paused',
        pausedBeforeStage: 1,
        currentStageIndex: 1,
        checkpoints: [1],
      }),
      resumePipeline: vi.fn(),
    });
    render(<PipelineProgressBar />);
    // Running bar aria-label contains "stage N of M"; paused banner has different label.
    expect(screen.queryByRole('status', { name: /pipeline: stage/i })).toBeNull();
  });
});
