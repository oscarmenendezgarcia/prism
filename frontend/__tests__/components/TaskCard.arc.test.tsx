/**
 * Arc chip tests for TaskCard — verifies arc chip rendering in Zone B.
 * Separate from the main TaskCard tests to keep arc-specific coverage isolated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskCard } from '../../src/components/board/TaskCard';
import type { Task } from '../../src/types';

// Minimal store mock for TaskCard
vi.mock('../../src/stores/useAppStore', () => ({
  useAppStore:           vi.fn((sel) => sel({
    moveTask:             vi.fn(),
    deleteTask:           vi.fn(),
    openAttachmentModal:  vi.fn(),
    activeSpaceId:        'space-1',
    isMutating:           false,
    openDetailPanel:      vi.fn(),
    activeRun:            null,
    availableAgents:      [],
    spaces:               [],
    loadAgents:           vi.fn(),
    showToast:            vi.fn(),
  })),
  useActiveRun:          vi.fn(() => null),
  useAvailableAgents:    vi.fn(() => []),
}));

vi.mock('../../src/stores/useRunHistoryStore', () => ({
  useRunHistoryStore: vi.fn((sel) => sel({
    openPanelForTask: vi.fn(),
  })),
}));

vi.mock('../../src/stores/useDragStore', () => ({
  useDragStore: vi.fn((sel) => sel({
    draggedTaskId:  null,
    dragOverColumn: null,
  })),
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id:        overrides.id        ?? 'task-1',
    title:     overrides.title     ?? 'Test Task',
    type:      overrides.type      ?? 'feature',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('TaskCard — arc chip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── TC-FE-029: arc chip renders when task has arc ───────────────────────────
  it('renders_arc_chip_when_task_has_arc', () => {
    const task = makeTask({ arc: 'QOL' });
    render(<TaskCard task={task} column="todo" />);
    const chip = screen.getByTestId('arc-chip');
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toBe('QOL');
  });

  // ─── TC-FE-030: arc chip absent when task has no arc ─────────────────────────
  it('arc_chip_absent_when_task_has_no_arc', () => {
    const task = makeTask();
    render(<TaskCard task={task} column="todo" />);
    expect(screen.queryByTestId('arc-chip')).not.toBeInTheDocument();
  });

  // ─── TC-FE-031: arc chip uses correct design tokens (readable text) ──────────
  it('arc_chip_has_expected_classes', () => {
    const task = makeTask({ arc: 'AUTH' });
    render(<TaskCard task={task} column="todo" />);
    const chip = screen.getByTestId('arc-chip');
    // Verify chip uses font-mono and border styling
    expect(chip.className).toContain('font-mono');
    expect(chip.className).toContain('border');
  });

  // ─── TC-FE-032: arc chip renders correctly in done column ───────────────────
  it('arc_chip_renders_in_done_column', () => {
    const task = makeTask({ arc: 'LOOP' });
    render(<TaskCard task={task} column="done" />);
    const chip = screen.getByTestId('arc-chip');
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toBe('LOOP');
  });
});
