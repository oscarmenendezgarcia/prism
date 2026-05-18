/**
 * QA regression tests for:
 *   fix(run-indicator): interrupted runs should not persist in the Active Runs panel
 *
 * These tests DOCUMENT the current bugs (BUG-001, BUG-002, BUG-003) by asserting
 * the DESIRED behaviour and marking the test as expected-to-fail until the fix lands.
 *
 * BUG-001: RunItemCompact — no auto-dismiss for interrupted/aborted runs
 * BUG-002: MultiRunIndicator.runCount counts ALL statuses (including interrupted)
 * BUG-003: RunIndicator switches to MultiRunIndicator mode based on total run count
 *           (including terminal runs), not active-only count
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { RunItemCompact } from '../../src/components/agent-launcher/RunItemCompact';
import { MultiRunIndicator } from '../../src/components/agent-launcher/MultiRunIndicator';
import { RunIndicator } from '../../src/components/agent-launcher/RunIndicator';
import { useAppStore } from '../../src/stores/useAppStore';
import type { PipelineState, Task } from '../../src/types';

// ---------------------------------------------------------------------------
// API mock (required for store initialization)
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
  deleteRun:            vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_TASKS = { todo: [] as Task[], 'in-progress': [] as Task[], done: [] as Task[] };

function makePS(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    spaceId:           'space-1',
    taskId:            'task-1',
    stages:            ['developer-agent'],
    currentStageIndex: 0,
    startedAt:         new Date().toISOString(),
    status:            'running',
    subTaskIds:        [],
    checkpoints:       [],
    runId:             'run-a',
    ...overrides,
  };
}

function resetStore(overrides: Record<string, unknown> = {}) {
  useAppStore.setState({
    pipelineStates:      {},
    activePipelineRunId: null,
    pipelineState:       null,
    availableAgents:     [],
    tasks:               EMPTY_TASKS,
    spaces:              [],
    abortRun:            vi.fn(),
    abortPipeline:       vi.fn(),
    clearRun:            vi.fn(),
    clearPipeline:       vi.fn(),
    resumePipeline:      vi.fn(),
    resumeInterruptedRun: vi.fn(),
    openDetailPanel:     vi.fn(),
    activeSpaceId:       null,
    activeRun:           null,
    ...overrides,
  } as any);
}

// ---------------------------------------------------------------------------
// BUG-001: RunItemCompact — no auto-dismiss for interrupted runs
// ---------------------------------------------------------------------------

describe('BUG-001 — RunItemCompact auto-dismiss on interrupted/aborted', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('[BUG-001] should auto-dismiss when status transitions to "interrupted"', () => {
    /**
     * EXPECTED (per task spec): interrupted runs should disappear automatically.
     * ACTUAL: the useEffect only guards `status !== 'completed'`, so interrupted
     * runs never call onDismiss — they stay in the panel indefinitely.
     *
     * Fix direction: extend the auto-dismiss useEffect to also fire for
     * 'interrupted' and 'aborted' statuses (same 2s delay or configurable).
     */
    const onDismiss = vi.fn();
    render(
      <RunItemCompact
        runId="run-x"
        pipelineState={makePS({ status: 'interrupted', runId: 'run-x' })}
        isActive={false}
        activeSpace={null}
        availableAgents={[]}
        onAbort={vi.fn()}
        onDismiss={onDismiss}
        onOpenDetail={vi.fn()}
      />,
    );

    // After 2 s an interrupted run should be auto-dismissed (matches completed behaviour).
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onDismiss).toHaveBeenCalledWith('run-x');
  });

  it('[BUG-001] should auto-dismiss when status transitions to "aborted"', () => {
    /**
     * Same issue as interrupted — aborted runs should also auto-dismiss
     * since they are terminal states that require no user action.
     */
    const onDismiss = vi.fn();
    render(
      <RunItemCompact
        runId="run-y"
        pipelineState={makePS({ status: 'aborted', runId: 'run-y' })}
        isActive={false}
        activeSpace={null}
        availableAgents={[]}
        onAbort={vi.fn()}
        onDismiss={onDismiss}
        onOpenDetail={vi.fn()}
      />,
    );

    act(() => { vi.advanceTimersByTime(2000); });
    expect(onDismiss).toHaveBeenCalledWith('run-y');
  });
});

// ---------------------------------------------------------------------------
// BUG-002: MultiRunIndicator counts ALL states (including terminal)
// ---------------------------------------------------------------------------

describe('BUG-002 — MultiRunIndicator active-only run count', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('[BUG-002] pill should only count running/pending runs, not interrupted ones', () => {
    /**
     * EXPECTED: pill shows "1 run" — only 1 actively running.
     * ACTUAL: pill shows "2 runs" — counts the interrupted run as active.
     *
     * Fix direction: derive activeRunCount from pipelineStates filtered to
     * status === 'running' | 'pending' | 'paused' | 'blocked'.
     * Use activeRunCount for pill label and for the MultiRunIndicator render decision.
     */
    const states: Record<string, PipelineState> = {
      'run-a': makePS({ runId: 'run-a', status: 'running' }),
      'run-b': makePS({ runId: 'run-b', status: 'interrupted' }),
    };

    render(
      <MultiRunIndicator
        pipelineStates={states}
        activePipelineRunId="run-a"
        activeSpace={null}
        availableAgents={[]}
      />,
    );

    // Should show "1 run" (only the running one), not "2 runs".
    expect(screen.getByText('1 run')).toBeInTheDocument();
  });

  it('[BUG-002] "Active Runs (N)" header should not count interrupted runs', () => {
    /**
     * EXPECTED: header reads "Active Runs (1)".
     * ACTUAL: header reads "Active Runs (2)".
     */
    const states: Record<string, PipelineState> = {
      'run-a': makePS({ runId: 'run-a', status: 'running' }),
      'run-b': makePS({ runId: 'run-b', status: 'interrupted' }),
    };

    const { container } = render(
      <MultiRunIndicator
        pipelineStates={states}
        activePipelineRunId="run-a"
        activeSpace={null}
        availableAgents={[]}
      />,
    );

    // Click pill to expand (use fireEvent so React synthetic handlers fire).
    const pill = container.querySelector('[data-testid="multi-run-pill"]')!;
    act(() => { fireEvent.click(pill); });

    // Header should reflect active-only count.
    expect(screen.getByText('Active Runs (1)')).toBeInTheDocument();
  });

  it('[BUG-002] pill aria-label should say "1 run active" not "2 runs active"', () => {
    const states: Record<string, PipelineState> = {
      'run-a': makePS({ runId: 'run-a', status: 'running' }),
      'run-b': makePS({ runId: 'run-b', status: 'interrupted' }),
    };

    render(
      <MultiRunIndicator
        pipelineStates={states}
        activePipelineRunId="run-a"
        activeSpace={null}
        availableAgents={[]}
      />,
    );

    const pill = screen.getByTestId('multi-run-pill');
    // aria-label should reflect only the active count.
    expect(pill).toHaveAttribute('aria-label', expect.stringContaining('1 run active'));
  });
});

// ---------------------------------------------------------------------------
// BUG-003: RunIndicator should not enter multi-run mode for terminal-only states
// ---------------------------------------------------------------------------

describe('BUG-003 — RunIndicator multi-run mode threshold based on active count', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('[BUG-003] should show single InterruptedBanner when only 1 run is running and 1 is interrupted', () => {
    /**
     * EXPECTED: With 1 interrupted run as primary + no additional running runs,
     * RunIndicator should render InterruptedBanner (single-run mode).
     *
     * ACTUAL: runCount = 2 (counting the interrupted one) → delegates to
     * MultiRunIndicator, hiding the InterruptedBanner entirely.
     *
     * Fix direction: compute activeCount = runs with status in
     * ['running','pending','paused','blocked','interrupted'] and use that
     * for the >= 2 threshold, OR filter pipelineStates before passing to
     * MultiRunIndicator.
     */
    const interrupts: Record<string, PipelineState> = {
      'run-a': makePS({ runId: 'run-a', status: 'interrupted' }),
      'run-b': makePS({ runId: 'run-b', status: 'interrupted' }),
    };

    useAppStore.setState({
      pipelineStates:      interrupts,
      activePipelineRunId: 'run-a',
      pipelineState:       interrupts['run-a'],
    } as any);

    render(<RunIndicator />);

    // Should show the InterruptedBanner, NOT the multi-run pill.
    expect(screen.queryByTestId('multi-run-pill')).toBeNull();
    expect(screen.getByTestId('run-indicator-interrupted')).toBeInTheDocument();
  });

  it('[BUG-003] shows MultiRunIndicator only when 2+ runs are truly active (running/paused/blocked)', () => {
    /**
     * Positive case: 2 genuinely running runs → MultiRunIndicator expected.
     */
    const running: Record<string, PipelineState> = {
      'run-a': makePS({ runId: 'run-a', status: 'running' }),
      'run-b': makePS({ runId: 'run-b', status: 'running' }),
    };

    useAppStore.setState({
      pipelineStates:      running,
      activePipelineRunId: 'run-a',
      pipelineState:       running['run-a'],
    } as any);

    render(<RunIndicator />);
    expect(screen.getByTestId('multi-run-pill')).toBeInTheDocument();
  });
});
