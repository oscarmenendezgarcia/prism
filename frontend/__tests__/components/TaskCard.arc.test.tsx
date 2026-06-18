/**
 * Arc tests for TaskCard — verifies the full-width arc "strip" banner at the top
 * of the card (mono uppercase, tinted per-arc) that titles the card with its arc
 * and is hidden while grouping is on (the column group header carries it then).
 * Separate from the main TaskCard tests to keep arc-specific coverage isolated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAppStore } from '../../src/stores/useAppStore';
import { TaskCard } from '../../src/components/board/TaskCard';
import type { Task } from '../../src/types';

// Minimal store mock for TaskCard. arcGrouping defaults to false (flat board),
// so the arc eyebrow is shown; setGrouping(true) flips it for the grouped case.
function storeState(overrides: Record<string, unknown> = {}) {
  return {
    moveTask:             vi.fn(),
    deleteTask:           vi.fn(),
    openAttachmentModal:  vi.fn(),
    activeSpaceId:        'space-1',
    isMutating:           false,
    openDetailPanel:      vi.fn(),
    arcGrouping:          false,
    activeRun:            null,
    availableAgents:      [],
    spaces:               [],
    loadAgents:           vi.fn(),
    showToast:            vi.fn(),
    ...overrides,
  };
}

vi.mock('../../src/stores/useAppStore', () => ({
  useAppStore:        vi.fn(),
  useActiveRun:       vi.fn(() => null),
  useAvailableAgents: vi.fn(() => []),
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

function setGrouping(on: boolean) {
  (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (sel: (s: ReturnType<typeof storeState>) => unknown) => sel(storeState({ arcGrouping: on })),
  );
}

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

describe('TaskCard — arc strip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setGrouping(false);
  });

  // ─── TC-FE-029: arc strip renders when task has arc ──────────────────────────
  it('renders_arc_strip_when_task_has_arc', () => {
    const task = makeTask({ arc: 'QOL' });
    render(<TaskCard task={task} column="todo" />);
    const strip = screen.getByTestId('arc-strip');
    expect(strip).toBeInTheDocument();
    expect(strip.textContent).toContain('QOL');
  });

  // ─── TC-FE-030: arc strip absent when task has no arc ────────────────────────
  it('arc_strip_absent_when_task_has_no_arc', () => {
    const task = makeTask();
    render(<TaskCard task={task} column="todo" />);
    expect(screen.queryByTestId('arc-strip')).not.toBeInTheDocument();
  });

  // ─── TC-FE-031: arc strip uses mono uppercase tokens (storyline banner) ──────
  it('arc_strip_has_expected_classes', () => {
    const task = makeTask({ arc: 'AUTH' });
    render(<TaskCard task={task} column="todo" />);
    const strip = screen.getByTestId('arc-strip');
    expect(strip.className).toContain('font-mono');
    expect(strip.className).toContain('uppercase');
  });

  // ─── TC-FE-031b: same arc always gets the same tint (deterministic colour) ───
  it('same_arc_gets_consistent_color_classes', () => {
    const { unmount } = render(<TaskCard task={makeTask({ id: 'a', arc: 'AUTH' })} column="todo" />);
    const first = screen.getByTestId('arc-strip').className;
    unmount();
    render(<TaskCard task={makeTask({ id: 'b', arc: 'AUTH' })} column="done" />);
    expect(screen.getByTestId('arc-strip').className).toBe(first);
  });

  // ─── TC-FE-032: arc strip renders correctly in done column ──────────────────
  it('arc_strip_renders_in_done_column', () => {
    const task = makeTask({ arc: 'LOOP' });
    render(<TaskCard task={task} column="done" />);
    const strip = screen.getByTestId('arc-strip');
    expect(strip).toBeInTheDocument();
    expect(strip.textContent).toContain('LOOP');
  });

  // ─── TC-FE-033: arc strip hidden while grouping (group header carries it) ────
  it('arc_strip_hidden_when_grouping_is_on', () => {
    setGrouping(true);
    const task = makeTask({ arc: 'QOL' });
    render(<TaskCard task={task} column="todo" />);
    expect(screen.queryByTestId('arc-strip')).not.toBeInTheDocument();
  });
});
