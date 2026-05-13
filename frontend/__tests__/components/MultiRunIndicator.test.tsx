/**
 * Component tests for MultiRunIndicator.
 *
 * Covers:
 *   - Collapsed pill: text, aria-label, aria-expanded, chevron
 *   - Expanded dropdown: renders all run items, header count
 *   - Toggle expand/collapse on pill click
 *   - Close on Escape key
 *   - Close on click outside
 *   - Auto-expand for 3 s when runCount transitions from 1 to 2+
 *   - abortRun / clearRun called with correct runId
 *   - openDetailPanel called when "Details" is clicked
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MultiRunIndicator } from '../../src/components/agent-launcher/MultiRunIndicator';
import { useAppStore } from '../../src/stores/useAppStore';
import type { PipelineState, Task } from '../../src/types';

// ---------------------------------------------------------------------------
// Mock API client
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
// Fixtures
// ---------------------------------------------------------------------------

const EMPTY_TASKS = { todo: [] as Task[], 'in-progress': [] as Task[], done: [] as Task[] };

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
    runId:             'run-a',
    ...overrides,
  };
}

function makePipelineStates(): Record<string, PipelineState> {
  return {
    'run-a': makePipelineState({ runId: 'run-a', taskId: 'task-1', stages: ['developer-agent'] }),
    'run-b': makePipelineState({ runId: 'run-b', taskId: 'task-2', stages: ['qa-engineer-e2e'] }),
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
    clearRun:            vi.fn(),
    openDetailPanel:     vi.fn(),
    ...overrides,
  } as any);
}

// ---------------------------------------------------------------------------
// Default props factory
// ---------------------------------------------------------------------------

function defaultProps(overrides: Partial<Parameters<typeof MultiRunIndicator>[0]> = {}) {
  return {
    pipelineStates:      makePipelineStates(),
    activePipelineRunId: 'run-a',
    activeSpace:         null,
    availableAgents:     [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

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
// Collapsed pill
// ---------------------------------------------------------------------------

describe('MultiRunIndicator — collapsed pill', () => {
  it('renders the pill with correct run count', () => {
    render(<MultiRunIndicator {...defaultProps()} />);
    expect(screen.getByTestId('multi-run-pill')).toBeInTheDocument();
    expect(screen.getByText('2 runs')).toBeInTheDocument();
  });

  it('pill has correct aria-label when collapsed', () => {
    render(<MultiRunIndicator {...defaultProps()} />);
    const pill = screen.getByTestId('multi-run-pill');
    expect(pill).toHaveAttribute('aria-label', expect.stringContaining('2 runs active'));
    expect(pill).toHaveAttribute('aria-label', expect.stringContaining('expand'));
  });

  it('pill has aria-expanded="false" when collapsed', () => {
    render(<MultiRunIndicator {...defaultProps()} />);
    expect(screen.getByTestId('multi-run-pill')).toHaveAttribute('aria-expanded', 'false');
  });

  it('dropdown is not visible when collapsed', () => {
    render(<MultiRunIndicator {...defaultProps()} />);
    expect(screen.queryByTestId('multi-run-dropdown')).toBeNull();
  });

  it('updates count when 3 runs are provided', () => {
    const states = {
      ...makePipelineStates(),
      'run-c': makePipelineState({ runId: 'run-c', taskId: 'task-3' }),
    };
    render(<MultiRunIndicator {...defaultProps({ pipelineStates: states })} />);
    expect(screen.getByText('3 runs')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Expand / collapse toggle
// ---------------------------------------------------------------------------

describe('MultiRunIndicator — expand / collapse', () => {
  it('expands dropdown when pill is clicked', () => {
    render(<MultiRunIndicator {...defaultProps()} />);
    fireEvent.click(screen.getByTestId('multi-run-pill'));
    expect(screen.getByTestId('multi-run-dropdown')).toBeInTheDocument();
  });

  it('pill has aria-expanded="true" when open', () => {
    render(<MultiRunIndicator {...defaultProps()} />);
    fireEvent.click(screen.getByTestId('multi-run-pill'));
    expect(screen.getByTestId('multi-run-pill')).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses dropdown when pill is clicked again', () => {
    render(<MultiRunIndicator {...defaultProps()} />);
    fireEvent.click(screen.getByTestId('multi-run-pill'));
    fireEvent.click(screen.getByTestId('multi-run-pill'));
    expect(screen.queryByTestId('multi-run-dropdown')).toBeNull();
  });

  it('collapses on Escape key', () => {
    render(<MultiRunIndicator {...defaultProps()} />);
    fireEvent.click(screen.getByTestId('multi-run-pill'));
    expect(screen.getByTestId('multi-run-dropdown')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('multi-run-dropdown')).toBeNull();
  });

  it('collapses on click outside', () => {
    render(
      <div>
        <MultiRunIndicator {...defaultProps()} />
        <button data-testid="outside">Outside</button>
      </div>,
    );
    fireEvent.click(screen.getByTestId('multi-run-pill'));
    expect(screen.getByTestId('multi-run-dropdown')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByTestId('multi-run-dropdown')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Expanded dropdown content
// ---------------------------------------------------------------------------

describe('MultiRunIndicator — expanded dropdown', () => {
  it('shows "Active Runs (N)" header', () => {
    render(<MultiRunIndicator {...defaultProps()} />);
    fireEvent.click(screen.getByTestId('multi-run-pill'));
    expect(screen.getByText('Active Runs (2)')).toBeInTheDocument();
  });

  it('renders one RunItemCompact per run', () => {
    render(<MultiRunIndicator {...defaultProps()} />);
    fireEvent.click(screen.getByTestId('multi-run-pill'));
    expect(screen.getByTestId('run-item-run-a')).toBeInTheDocument();
    expect(screen.getByTestId('run-item-run-b')).toBeInTheDocument();
  });

  it('dropdown has role="listbox" and aria-label', () => {
    render(<MultiRunIndicator {...defaultProps()} />);
    fireEvent.click(screen.getByTestId('multi-run-pill'));
    const dropdown = screen.getByTestId('multi-run-dropdown');
    expect(dropdown).toHaveAttribute('role', 'listbox');
    expect(dropdown).toHaveAttribute('aria-label', 'Active pipeline runs');
  });
});

// ---------------------------------------------------------------------------
// Auto-expand
// ---------------------------------------------------------------------------

describe('MultiRunIndicator — auto-expand when second run launches', () => {
  it('auto-expands for 3 s when runCount transitions from 1 to 2', () => {
    const singleState = { 'run-a': makePipelineState({ runId: 'run-a' }) };
    const { rerender } = render(
      <MultiRunIndicator {...defaultProps({ pipelineStates: singleState })} />,
    );
    // No expansion yet
    expect(screen.queryByTestId('multi-run-dropdown')).toBeNull();

    // Transition to 2 runs
    rerender(<MultiRunIndicator {...defaultProps()} />);
    expect(screen.getByTestId('multi-run-dropdown')).toBeInTheDocument();
  });

  it('auto-collapses after 3 s if user did not click', () => {
    const singleState = { 'run-a': makePipelineState({ runId: 'run-a' }) };
    const { rerender } = render(
      <MultiRunIndicator {...defaultProps({ pipelineStates: singleState })} />,
    );
    rerender(<MultiRunIndicator {...defaultProps()} />);
    expect(screen.getByTestId('multi-run-dropdown')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(3001); });
    expect(screen.queryByTestId('multi-run-dropdown')).toBeNull();
  });

  it('does NOT auto-collapse if user clicked the pill during the 3 s window', () => {
    const singleState = { 'run-a': makePipelineState({ runId: 'run-a' }) };
    const { rerender } = render(
      <MultiRunIndicator {...defaultProps({ pipelineStates: singleState })} />,
    );
    rerender(<MultiRunIndicator {...defaultProps()} />);
    // User clicks during auto-expand window
    fireEvent.click(screen.getByTestId('multi-run-pill')); // close
    fireEvent.click(screen.getByTestId('multi-run-pill')); // re-open with user intent

    act(() => { vi.advanceTimersByTime(3001); });
    // Dropdown should remain open (user clicked = userClicked flag set)
    expect(screen.getByTestId('multi-run-dropdown')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Button interactions
// ---------------------------------------------------------------------------

describe('MultiRunIndicator — button interactions', () => {
  it('calls abortRun with correct runId when Abort is clicked', () => {
    const abortRunFn = vi.fn();
    resetStore({ abortRun: abortRunFn });
    render(<MultiRunIndicator {...defaultProps()} />);
    fireEvent.click(screen.getByTestId('multi-run-pill'));

    // Run item for run-a is running — has Abort button
    const abortButtons = screen.getAllByRole('button', { name: /abort run/i });
    expect(abortButtons.length).toBeGreaterThan(0);
    fireEvent.click(abortButtons[0]);
    expect(abortRunFn).toHaveBeenCalledWith(expect.stringMatching(/run-[ab]/));
  });

  it('calls clearRun with correct runId when Dismiss is clicked', () => {
    const clearRunFn = vi.fn();
    resetStore({ clearRun: clearRunFn });
    render(<MultiRunIndicator {...defaultProps()} />);
    fireEvent.click(screen.getByTestId('multi-run-pill'));

    const dismissButtons = screen.getAllByRole('button', { name: /dismiss run/i });
    fireEvent.click(dismissButtons[0]);
    expect(clearRunFn).toHaveBeenCalledWith(expect.stringMatching(/run-[ab]/));
  });

  it('calls openDetailPanel when Details button is clicked and task exists', () => {
    const openDetailPanelFn = vi.fn();
    const matchingTask: Task = {
      id:        'task-1',
      title:     'My Task',
      type:      'feature',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    useAppStore.setState({
      tasks:           { todo: [matchingTask], 'in-progress': [], done: [] },
      openDetailPanel: openDetailPanelFn,
    } as any);

    render(<MultiRunIndicator {...defaultProps()} />);
    fireEvent.click(screen.getByTestId('multi-run-pill'));

    const detailButtons = screen.getAllByRole('button', { name: /view details/i });
    fireEvent.click(detailButtons[0]);
    expect(openDetailPanelFn).toHaveBeenCalledWith(matchingTask);
  });
});
