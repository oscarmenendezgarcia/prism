/**
 * Unit tests for ArcBar — arc filter/group bar above the board.
 * Tests: hidden when no arcs, shows arc chips, "All" chip, active filter state,
 * grouping toggle, aria-pressed states.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArcBar } from '../../src/components/board/ArcBar';
import { useAppStore } from '../../src/stores/useAppStore';

// Mock useAppStore and useTasks
vi.mock('../../src/stores/useAppStore', () => {
  const mockStore = {
    arcFilter:          null as string | null,
    arcGrouping:        false,
    setArcFilter:       vi.fn(),
    toggleArcGrouping:  vi.fn(),
    tasks: {
      todo:          [] as { arc?: string }[],
      'in-progress': [] as { arc?: string }[],
      done:          [] as { arc?: string }[],
    },
  };

  return {
    useAppStore: vi.fn((selector) => selector(mockStore)),
    useTasks:    vi.fn(() => mockStore.tasks),
    __mockStore: mockStore,
  };
});

import { useTasks, __mockStore as mockStore } from '../../src/stores/useAppStore';

function setTasks(tasks: { todo: object[]; 'in-progress': object[]; done: object[] }) {
  (mockStore as any).tasks = tasks;
  vi.mocked(useTasks).mockReturnValue(tasks as any);
}

function setArcFilter(value: string | null) {
  (mockStore as any).arcFilter = value;
  vi.mocked(useAppStore).mockImplementation((selector) => (selector as any)(mockStore));
}

function setArcGrouping(value: boolean) {
  (mockStore as any).arcGrouping = value;
  vi.mocked(useAppStore).mockImplementation((selector) => (selector as any)(mockStore));
}

describe('ArcBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockStore as any).arcFilter   = null;
    (mockStore as any).arcGrouping = false;
    (mockStore as any).tasks       = { todo: [], 'in-progress': [], done: [] };
    vi.mocked(useTasks).mockReturnValue((mockStore as any).tasks);
    vi.mocked(useAppStore).mockImplementation((selector) => (selector as any)(mockStore));
  });

  // ─── TC-FE-016: ArcBar is hidden when no tasks have an arc ──────────────────
  it('hidden_when_no_tasks_have_arc', () => {
    setTasks({ todo: [{ id: 't1', title: 'No arc' }], 'in-progress': [], done: [] });
    const { container } = render(<ArcBar />);
    expect(container.firstChild).toBeNull();
  });

  // ─── TC-FE-017: ArcBar renders when at least one task has an arc ────────────
  it('renders_when_tasks_have_arc', () => {
    setTasks({ todo: [{ arc: 'QOL' }], 'in-progress': [], done: [] });
    render(<ArcBar />);
    expect(screen.getByTestId('arc-bar')).toBeInTheDocument();
  });

  // ─── TC-FE-018: Shows "All" chip and arc chip ────────────────────────────────
  it('shows_All_chip_and_arc_chips', () => {
    setTasks({ todo: [{ arc: 'QOL' }, { arc: 'AUTH' }], 'in-progress': [], done: [] });
    render(<ArcBar />);
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByTestId('arc-filter-chip-QOL')).toBeInTheDocument();
    expect(screen.getByTestId('arc-filter-chip-AUTH')).toBeInTheDocument();
  });

  // ─── TC-FE-019: Arc chips are sorted alphabetically ─────────────────────────
  it('arc_chips_sorted_alphabetically', () => {
    setTasks({ todo: [{ arc: 'LOOP' }, { arc: 'AUTH' }, { arc: 'QOL' }], 'in-progress': [], done: [] });
    render(<ArcBar />);
    const chips = screen.getAllByTestId(/arc-filter-chip-/);
    const labels = chips.map((c) => c.textContent);
    expect(labels).toEqual(['AUTH', 'LOOP', 'QOL']);
  });

  // ─── TC-FE-020: "All" chip has aria-pressed=true when no filter active ───────
  it('All_chip_aria_pressed_true_when_no_filter', () => {
    setTasks({ todo: [{ arc: 'QOL' }], 'in-progress': [], done: [] });
    render(<ArcBar />);
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  // ─── TC-FE-021: arc chip has aria-pressed=true when that arc is active filter
  it('arc_chip_aria_pressed_true_when_matching_filter', () => {
    setTasks({ todo: [{ arc: 'QOL' }], 'in-progress': [], done: [] });
    setArcFilter('QOL');
    render(<ArcBar />);
    const chip = screen.getByTestId('arc-filter-chip-QOL');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });

  // ─── TC-FE-022: Clicking arc chip calls setArcFilter ────────────────────────
  it('clicking_arc_chip_calls_setArcFilter', () => {
    setTasks({ todo: [{ arc: 'QOL' }], 'in-progress': [], done: [] });
    render(<ArcBar />);
    fireEvent.click(screen.getByTestId('arc-filter-chip-QOL'));
    expect((mockStore as any).setArcFilter).toHaveBeenCalled();
  });

  // ─── TC-FE-023: Clicking "All" clears filter ────────────────────────────────
  it('clicking_All_chip_calls_setArcFilter_with_null', () => {
    setTasks({ todo: [{ arc: 'QOL' }], 'in-progress': [], done: [] });
    setArcFilter('QOL');
    render(<ArcBar />);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect((mockStore as any).setArcFilter).toHaveBeenCalledWith(null);
  });

  // ─── TC-FE-024: Clicking same active arc chip toggles filter to null ─────────
  it('clicking_active_arc_chip_toggles_filter_off', () => {
    setTasks({ todo: [{ arc: 'QOL' }], 'in-progress': [], done: [] });
    setArcFilter('QOL');
    render(<ArcBar />);
    fireEvent.click(screen.getByTestId('arc-filter-chip-QOL'));
    // When arcFilter === arc, clicking calls setArcFilter(null)
    expect((mockStore as any).setArcFilter).toHaveBeenCalledWith(null);
  });

  // ─── TC-FE-025: Group toggle button exists and has aria-pressed ──────────────
  it('group_toggle_button_exists_with_aria_pressed', () => {
    setTasks({ todo: [{ arc: 'QOL' }], 'in-progress': [], done: [] });
    render(<ArcBar />);
    const toggleBtn = screen.getByTitle(/group cards by arc|disable arc grouping/i);
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
  });

  // ─── TC-FE-026: Group toggle aria-pressed=true when grouping is on ───────────
  it('group_toggle_aria_pressed_true_when_grouping_active', () => {
    setTasks({ todo: [{ arc: 'QOL' }], 'in-progress': [], done: [] });
    setArcGrouping(true);
    render(<ArcBar />);
    const toggleBtn = screen.getByTitle(/disable arc grouping/i);
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'true');
  });

  // ─── TC-FE-027: Clicking group toggle calls toggleArcGrouping ────────────────
  it('clicking_group_toggle_calls_toggleArcGrouping', () => {
    setTasks({ todo: [{ arc: 'QOL' }], 'in-progress': [], done: [] });
    render(<ArcBar />);
    const toggleBtn = screen.getByTitle(/group cards by arc/i);
    fireEvent.click(toggleBtn);
    expect((mockStore as any).toggleArcGrouping).toHaveBeenCalled();
  });

  // ─── TC-FE-028: Deduplicates arcs across all columns ────────────────────────
  it('deduplicates_arcs_across_todo_in_progress_done', () => {
    setTasks({
      todo:          [{ arc: 'QOL' }],
      'in-progress': [{ arc: 'QOL' }, { arc: 'AUTH' }],
      done:          [{ arc: 'AUTH' }],
    });
    render(<ArcBar />);
    const chips = screen.getAllByTestId(/arc-filter-chip-/);
    expect(chips.length).toBe(2); // QOL and AUTH, not 4
  });
});
