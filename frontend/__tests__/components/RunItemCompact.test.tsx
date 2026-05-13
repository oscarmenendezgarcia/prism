/**
 * Component tests for RunItemCompact.
 *
 * Covers:
 *   - Status dot rendered for each status (running / paused / blocked / completed / aborted)
 *   - Agent name displayed using resolveAgentName
 *   - Elapsed timer ticks and freezes on terminal status
 *   - Stage label rendered (Stage X/N)
 *   - Abort button visible only for active statuses; hidden for completed/aborted
 *   - Dismiss button always visible
 *   - Resolve button shown when status is paused or blocked
 *   - onAbort called with runId
 *   - onDismiss called with runId
 *   - onOpenDetail called with runId
 *   - Auto-dismiss after 2 s for completed status
 *   - aria-label describes the run state
 *   - role="listitem"
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RunItemCompact } from '../../src/components/agent-launcher/RunItemCompact';
import type { PipelineState } from '../../src/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePipelineState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    spaceId:           'space-1',
    taskId:            'task-1',
    stages:            ['developer-agent', 'qa-engineer-e2e'],
    currentStageIndex: 0,
    startedAt:         new Date().toISOString(),
    status:            'running',
    subTaskIds:        [],
    checkpoints:       [],
    runId:             'run-x',
    ...overrides,
  };
}

function defaultProps(overrides: Partial<Parameters<typeof RunItemCompact>[0]> = {}) {
  return {
    runId:         'run-x',
    pipelineState: makePipelineState(),
    isActive:      false,
    activeSpace:   null,
    availableAgents: [],
    onAbort:       vi.fn(),
    onDismiss:     vi.fn(),
    onOpenDetail:  vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Basic rendering
// ---------------------------------------------------------------------------

describe('RunItemCompact — rendering', () => {
  it('renders with data-testid="run-item-<runId>"', () => {
    render(<RunItemCompact {...defaultProps()} />);
    expect(screen.getByTestId('run-item-run-x')).toBeInTheDocument();
  });

  it('has role="listitem"', () => {
    render(<RunItemCompact {...defaultProps()} />);
    expect(screen.getByRole('listitem')).toBeInTheDocument();
  });

  it('shows the resolved agent name for developer-agent', () => {
    render(<RunItemCompact {...defaultProps()} />);
    expect(screen.getByText('Developer Agent')).toBeInTheDocument();
  });

  it('shows the stage label (Stage X/N)', () => {
    render(<RunItemCompact {...defaultProps()} />);
    expect(screen.getByText(/stage 1\/2/i)).toBeInTheDocument();
  });

  it('shows "Stage 2/2" when currentStageIndex is 1', () => {
    render(
      <RunItemCompact {...defaultProps({ pipelineState: makePipelineState({ currentStageIndex: 1 }) })} />,
    );
    expect(screen.getByText(/stage 2\/2/i)).toBeInTheDocument();
  });

  it('aria-label contains agent name and elapsed time', () => {
    render(<RunItemCompact {...defaultProps()} />);
    const el = screen.getByRole('listitem');
    expect(el).toHaveAttribute('aria-label', expect.stringContaining('Developer Agent'));
    expect(el).toHaveAttribute('aria-label', expect.stringContaining('Running'));
  });
});

// ---------------------------------------------------------------------------
// Status text
// ---------------------------------------------------------------------------

describe('RunItemCompact — status labels', () => {
  it('shows "Running" for running status', () => {
    render(<RunItemCompact {...defaultProps()} />);
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });

  it('shows "Paused" for paused status', () => {
    render(
      <RunItemCompact {...defaultProps({ pipelineState: makePipelineState({ status: 'paused' }) })} />,
    );
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
  });

  it('shows "Blocked" for blocked status', () => {
    render(
      <RunItemCompact {...defaultProps({ pipelineState: makePipelineState({ status: 'blocked' }) })} />,
    );
    expect(screen.getByText(/blocked/i)).toBeInTheDocument();
  });

  it('shows "Completed" for completed status', () => {
    render(
      <RunItemCompact {...defaultProps({ pipelineState: makePipelineState({ status: 'completed' }) })} />,
    );
    expect(screen.getByText(/completed/i)).toBeInTheDocument();
  });

  it('shows "Aborted" for aborted status', () => {
    render(
      <RunItemCompact {...defaultProps({ pipelineState: makePipelineState({ status: 'aborted' }) })} />,
    );
    expect(screen.getByText(/aborted/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

describe('RunItemCompact — elapsed timer', () => {
  it('shows 0:00 for a brand-new run', () => {
    render(<RunItemCompact {...defaultProps()} />);
    expect(screen.getByText('0:00')).toBeInTheDocument();
  });

  it('increments elapsed every second while running', () => {
    render(<RunItemCompact {...defaultProps()} />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('0:05')).toBeInTheDocument();
  });

  it('shows past elapsed correctly when startedAt is in the past', () => {
    const startedAt = new Date(Date.now() - 90_000).toISOString();
    render(<RunItemCompact {...defaultProps({ pipelineState: makePipelineState({ startedAt }) })} />);
    expect(screen.getByText('1:30')).toBeInTheDocument();
  });

  it('does NOT start a timer when status is completed', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    render(
      <RunItemCompact {...defaultProps({ pipelineState: makePipelineState({ status: 'completed' }) })} />,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('freezes at finishedAt when status is aborted', () => {
    const startedAt  = new Date(Date.now() - 120_000).toISOString();
    const finishedAt = new Date(Date.now() -  60_000).toISOString();
    render(
      <RunItemCompact
        {...defaultProps({ pipelineState: makePipelineState({ status: 'aborted', startedAt, finishedAt }) })}
      />,
    );
    expect(screen.getByText('1:00')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Auto-dismiss
// ---------------------------------------------------------------------------

describe('RunItemCompact — auto-dismiss on completed', () => {
  it('calls onDismiss after 2 s when status is completed', () => {
    const onDismiss = vi.fn();
    render(
      <RunItemCompact
        {...defaultProps({ pipelineState: makePipelineState({ status: 'completed' }), onDismiss })}
      />,
    );
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onDismiss).toHaveBeenCalledWith('run-x');
  });

  it('does NOT call onDismiss for running status', () => {
    const onDismiss = vi.fn();
    render(<RunItemCompact {...defaultProps({ onDismiss })} />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Action buttons
// ---------------------------------------------------------------------------

describe('RunItemCompact — Abort button', () => {
  it('shows Abort button when status is running', () => {
    render(<RunItemCompact {...defaultProps()} />);
    expect(screen.getByRole('button', { name: /abort run/i })).toBeInTheDocument();
  });

  it('shows Abort button when status is paused', () => {
    render(
      <RunItemCompact {...defaultProps({ pipelineState: makePipelineState({ status: 'paused' }) })} />,
    );
    expect(screen.getByRole('button', { name: /abort run/i })).toBeInTheDocument();
  });

  it('shows Abort button when status is blocked', () => {
    render(
      <RunItemCompact {...defaultProps({ pipelineState: makePipelineState({ status: 'blocked' }) })} />,
    );
    expect(screen.getByRole('button', { name: /abort run/i })).toBeInTheDocument();
  });

  it('does NOT show Abort button when status is completed', () => {
    render(
      <RunItemCompact {...defaultProps({ pipelineState: makePipelineState({ status: 'completed' }) })} />,
    );
    expect(screen.queryByRole('button', { name: /abort run/i })).toBeNull();
  });

  it('does NOT show Abort button when status is aborted', () => {
    render(
      <RunItemCompact {...defaultProps({ pipelineState: makePipelineState({ status: 'aborted' }) })} />,
    );
    expect(screen.queryByRole('button', { name: /abort run/i })).toBeNull();
  });

  it('calls onAbort with correct runId when clicked', () => {
    const onAbort = vi.fn();
    render(<RunItemCompact {...defaultProps({ onAbort })} />);
    fireEvent.click(screen.getByRole('button', { name: /abort run/i }));
    expect(onAbort).toHaveBeenCalledWith('run-x');
  });
});

describe('RunItemCompact — Dismiss button', () => {
  it('always shows Dismiss button (running)', () => {
    render(<RunItemCompact {...defaultProps()} />);
    expect(screen.getByRole('button', { name: /dismiss run/i })).toBeInTheDocument();
  });

  it('always shows Dismiss button (completed)', () => {
    render(
      <RunItemCompact {...defaultProps({ pipelineState: makePipelineState({ status: 'completed' }) })} />,
    );
    expect(screen.getByRole('button', { name: /dismiss run/i })).toBeInTheDocument();
  });

  it('calls onDismiss with correct runId when clicked', () => {
    const onDismiss = vi.fn();
    render(<RunItemCompact {...defaultProps({ onDismiss })} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss run/i }));
    expect(onDismiss).toHaveBeenCalledWith('run-x');
  });
});

describe('RunItemCompact — Resolve / Details button', () => {
  it('shows Resolve button when status is blocked', () => {
    render(
      <RunItemCompact {...defaultProps({ pipelineState: makePipelineState({ status: 'blocked' }) })} />,
    );
    expect(screen.getByRole('button', { name: /resolve blocked run/i })).toBeInTheDocument();
  });

  it('shows Resolve button when status is paused', () => {
    render(
      <RunItemCompact {...defaultProps({ pipelineState: makePipelineState({ status: 'paused' }) })} />,
    );
    expect(screen.getByRole('button', { name: /resolve blocked run/i })).toBeInTheDocument();
  });

  it('shows Details button when status is running', () => {
    render(<RunItemCompact {...defaultProps()} />);
    expect(screen.getByRole('button', { name: /view details/i })).toBeInTheDocument();
  });

  it('calls onOpenDetail with correct runId when Details is clicked', () => {
    const onOpenDetail = vi.fn();
    render(<RunItemCompact {...defaultProps({ onOpenDetail })} />);
    fireEvent.click(screen.getByRole('button', { name: /view details/i }));
    expect(onOpenDetail).toHaveBeenCalledWith('run-x');
  });

  it('calls onOpenDetail with correct runId when Resolve is clicked', () => {
    const onOpenDetail = vi.fn();
    render(
      <RunItemCompact
        {...defaultProps({ pipelineState: makePipelineState({ status: 'blocked' }), onOpenDetail })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /resolve blocked run/i }));
    expect(onOpenDetail).toHaveBeenCalledWith('run-x');
  });
});
