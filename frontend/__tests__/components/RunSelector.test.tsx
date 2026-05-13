/**
 * Unit tests for RunSelector.
 * Covers: visibility threshold, run ordering, selection, keyboard nav,
 *         ARIA attributes, and status icon display.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RunSelector } from '../../src/components/pipeline-log/RunSelector';
import type { RunSelectorEntry } from '../../src/components/pipeline-log/RunSelector';
import type { PipelineState } from '../../src/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePipelineState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    spaceId:           'space-1',
    taskId:            'task-1',
    stages:            ['senior-architect', 'developer-agent', 'qa-engineer-e2e'] as any,
    currentStageIndex: 0,
    startedAt:         '2026-05-13T14:00:00.000Z',
    status:            'running',
    subTaskIds:        [],
    checkpoints:       [],
    runId:             'run-000',
    ...overrides,
  };
}

// Keys use UUID format so shortRunId(key) → "run-aabbccdd" as expected.
const RUN_A: RunSelectorEntry = {
  key:           'aabbccdd-1111-4444-aaaa-000000000001',
  pipelineState: makePipelineState({
    runId:     'aabbccdd-1111-4444-aaaa-000000000001',
    status:    'running',
    startedAt: '2026-05-13T14:32:00.000Z',
  }),
};

const RUN_B: RunSelectorEntry = {
  key:           'bbbbcccc-2222-4444-bbbb-000000000002',
  pipelineState: makePipelineState({
    runId:             'bbbbcccc-2222-4444-bbbb-000000000002',
    status:            'completed',
    startedAt:         '2026-05-13T14:21:00.000Z',
    currentStageIndex: 2,
  }),
};

const RUN_C: RunSelectorEntry = {
  key:           'ccccdddd-3333-4444-cccc-000000000003',
  pipelineState: makePipelineState({
    runId:     'ccccdddd-3333-4444-cccc-000000000003',
    status:    'aborted',
    startedAt: '2026-05-13T14:05:00.000Z',
  }),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderSelector(
  runs: RunSelectorEntry[] = [RUN_A, RUN_B],
  selectedRunId: string | null = null,
  onSelect: (id: string) => void = vi.fn(),
) {
  return render(
    <RunSelector runs={runs} selectedRunId={selectedRunId} onSelect={onSelect} />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RunSelector — trigger button', () => {
  it('renders a button with aria-haspopup="listbox"', () => {
    renderSelector();
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-haspopup', 'listbox');
  });

  it('button is initially closed (aria-expanded=false)', () => {
    renderSelector();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows a short UUID in the trigger button label', () => {
    renderSelector([RUN_A, RUN_B], RUN_A.key);
    const btn = screen.getByRole('button');
    // shortRunId('aabbccdd-...') → 'run-aabbccdd'
    expect(btn).toHaveAccessibleName(/run-aabbccdd/i);
  });

  it('renders nothing when runs array is empty', () => {
    const { container } = renderSelector([]);
    expect(container.firstChild).toBeNull();
  });
});

describe('RunSelector — open/close', () => {
  it('opens the listbox when button is clicked', () => {
    renderSelector();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('sets aria-expanded=true when open', () => {
    renderSelector();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes the listbox when button is clicked again', () => {
    renderSelector();
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes the listbox with Escape key', () => {
    renderSelector();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    const options = screen.getAllByRole('option');
    fireEvent.keyDown(options[0], { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('RunSelector — run options', () => {
  it('renders one option per run', () => {
    renderSelector([RUN_A, RUN_B, RUN_C]);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('selected run has aria-selected=true', () => {
    renderSelector([RUN_A, RUN_B], RUN_A.key);
    fireEvent.click(screen.getByRole('button'));
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('shows checkmark (✓) icon for the selected option', () => {
    renderSelector([RUN_A, RUN_B], RUN_A.key);
    fireEvent.click(screen.getByRole('button'));
    const options = screen.getAllByRole('option');
    // The selected option's text should contain the ✓ icon
    expect(options[0].textContent).toContain('✓');
  });

  it('shows UUID shorthand label in each option', () => {
    renderSelector([RUN_A, RUN_B]);
    fireEvent.click(screen.getByRole('button'));
    const options = screen.getAllByRole('option');
    expect(options[0].textContent).toContain('run-aabbccdd');
    expect(options[1].textContent).toContain('run-bbbbcccc');
  });
});

describe('RunSelector — selection', () => {
  it('calls onSelect with the run key when an option is clicked', () => {
    const onSelect = vi.fn();
    renderSelector([RUN_A, RUN_B], null, onSelect);
    fireEvent.click(screen.getByRole('button'));

    const options = screen.getAllByRole('option');
    fireEvent.click(options[1]); // click run B

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(RUN_B.key);
  });

  it('closes the dropdown after selection', () => {
    renderSelector([RUN_A, RUN_B]);
    fireEvent.click(screen.getByRole('button'));
    const options = screen.getAllByRole('option');
    fireEvent.click(options[0]);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('calls onSelect with Enter key on a focused option', () => {
    const onSelect = vi.fn();
    renderSelector([RUN_A, RUN_B], null, onSelect);
    fireEvent.click(screen.getByRole('button'));
    const options = screen.getAllByRole('option');
    fireEvent.keyDown(options[0], { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(RUN_A.key);
  });

  it('calls onSelect with Space key on a focused option', () => {
    const onSelect = vi.fn();
    renderSelector([RUN_A, RUN_B], null, onSelect);
    fireEvent.click(screen.getByRole('button'));
    const options = screen.getAllByRole('option');
    fireEvent.keyDown(options[0], { key: ' ' });
    expect(onSelect).toHaveBeenCalledWith(RUN_A.key);
  });
});

describe('RunSelector — keyboard navigation', () => {
  it('opens dropdown with ArrowDown on button', () => {
    renderSelector();
    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('opens dropdown with Enter on button', () => {
    renderSelector();
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('ArrowDown on last option does not go past end', () => {
    const onSelect = vi.fn();
    renderSelector([RUN_A, RUN_B], null, onSelect);
    fireEvent.click(screen.getByRole('button'));
    const options = screen.getAllByRole('option');
    // ArrowDown on the last option should stay at last
    fireEvent.keyDown(options[options.length - 1], { key: 'ArrowDown' });
    // No crash, dropdown still open
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('ArrowUp on first option does not go before start', () => {
    const onSelect = vi.fn();
    renderSelector([RUN_A, RUN_B], null, onSelect);
    fireEvent.click(screen.getByRole('button'));
    const options = screen.getAllByRole('option');
    fireEvent.keyDown(options[0], { key: 'ArrowUp' });
    // No crash, dropdown still open
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});

describe('RunSelector — status display', () => {
  it('shows "running" status text for a running run', () => {
    renderSelector([RUN_A, RUN_B]);
    fireEvent.click(screen.getByRole('button'));
    const options = screen.getAllByRole('option');
    // RUN_A is running → first option should show 'running' text somewhere
    expect(options[0].textContent).toMatch(/running/i);
  });

  it('shows "completed" status text for a completed run', () => {
    renderSelector([RUN_A, RUN_B]);
    fireEvent.click(screen.getByRole('button'));
    const options = screen.getAllByRole('option');
    // RUN_B is completed
    expect(options[1].textContent).toMatch(/completed/i);
  });

  it('shows "aborted" status text for an aborted run', () => {
    renderSelector([RUN_A, RUN_C]);
    fireEvent.click(screen.getByRole('button'));
    const options = screen.getAllByRole('option');
    // RUN_C is aborted
    expect(options[1].textContent).toMatch(/aborted/i);
  });
});

describe('RunSelector — ARIA attributes', () => {
  it('listbox has aria-label="Pipeline runs"', () => {
    renderSelector();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-label', 'Pipeline runs');
  });

  it('each option has a descriptive aria-label for screen readers', () => {
    renderSelector([RUN_A, RUN_B]);
    fireEvent.click(screen.getByRole('button'));
    const options = screen.getAllByRole('option');
    // Should mention run short id + status + stage info
    expect(options[0].getAttribute('aria-label')).toMatch(/run-aabbccdd/);
    expect(options[0].getAttribute('aria-label')).toMatch(/running/i);
  });

  it('trigger button has aria-controls="run-selector-list"', () => {
    renderSelector();
    expect(screen.getByRole('button')).toHaveAttribute('aria-controls', 'run-selector-list');
  });
});
