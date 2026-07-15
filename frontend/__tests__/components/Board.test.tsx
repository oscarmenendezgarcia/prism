/**
 * Unit tests for the Board component.
 * Covers rendering, drag-and-drop perf fixes (stable callbacks, ref-based state),
 * the dragend safety reset, and the empty-state onboarding lifecycle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Board } from '../../src/components/board/Board';
import { useAppStore } from '../../src/stores/useAppStore';
import { useDragStore } from '../../src/stores/useDragStore';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(), getTasks: vi.fn(), createTask: vi.fn(), moveTask: vi.fn(),
  deleteTask: vi.fn(), createSpace: vi.fn(), renameSpace: vi.fn(), deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
}));

const TASKS_FIXTURE = {
  todo: [
    { id: 't1', title: 'Task One', type: 'chore' as const, createdAt: '', updatedAt: '' },
    { id: 't2', title: 'Task Two', type: 'feature' as const, createdAt: '', updatedAt: '' },
  ],
  'in-progress': [
    { id: 't3', title: 'Task Three', type: 'bug' as const, createdAt: '', updatedAt: '' },
  ],
  done: [],
};

const EMPTY_TASKS = { todo: [], 'in-progress': [], done: [] };

beforeEach(() => {
  useAppStore.setState({
    tasks: EMPTY_TASKS,
    moveTask: vi.fn(),
    openCreateModal: vi.fn(),
  });
  useDragStore.getState().resetDrag();
});

// ─── Empty-state lifecycle ────────────────────────────────────────────────────

describe('Board — empty-state (BoardEmptyState)', () => {
  it('shows onboarding guide when all columns are empty', () => {
    render(<Board />);
    expect(screen.getByRole('region', { name: 'Your board is empty' })).toBeInTheDocument();
    expect(screen.getByText('Your board is empty')).toBeInTheDocument();
  });

  it('does not render column grid when board is empty', () => {
    render(<Board />);
    expect(screen.queryByText('Todo')).not.toBeInTheDocument();
    expect(screen.queryByText('In Progress')).not.toBeInTheDocument();
  });

  it('does not render mobile FAB when board is empty', () => {
    render(<Board />);
    expect(
      screen.queryByRole('button', { name: 'Create new task' }),
    ).not.toBeInTheDocument();
  });

  it('does not render ColumnTabBar when board is empty', () => {
    render(<Board />);
    // ColumnTabBar renders mobile column tabs (Todo / In Progress / Done tabs)
    // When empty, the tab bar div is not mounted at all.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('shows onboarding guide when only todo is empty but all empty', () => {
    useAppStore.setState({ tasks: EMPTY_TASKS });
    render(<Board />);
    expect(screen.getByText('Your board is empty')).toBeInTheDocument();
  });

  it('hides onboarding guide and renders columns once tasks exist', () => {
    useAppStore.setState({ tasks: TASKS_FIXTURE });
    render(<Board />);
    expect(screen.queryByText('Your board is empty')).not.toBeInTheDocument();
    expect(screen.getAllByText('Todo').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('In Progress').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Done').length).toBeGreaterThanOrEqual(1);
  });

  it('calls openCreateModal when CTA in empty state is clicked', () => {
    const openCreateModal = vi.fn();
    useAppStore.setState({ tasks: EMPTY_TASKS, openCreateModal });
    render(<Board />);
    const btn = screen.getByRole('button', { name: /Add your first task to start using Prism/i });
    fireEvent.click(btn);
    expect(openCreateModal).toHaveBeenCalledOnce();
  });

  it('shows guide even when only one column has tasks — only triggers on all-empty', () => {
    // Only todo has tasks → board is NOT empty → columns render
    useAppStore.setState({
      tasks: {
        todo: [{ id: 't1', title: 'Task One', type: 'chore' as const, createdAt: '', updatedAt: '' }],
        'in-progress': [],
        done: [],
      },
    });
    render(<Board />);
    expect(screen.queryByText('Your board is empty')).not.toBeInTheDocument();
    expect(screen.getByText('Task One')).toBeInTheDocument();
  });
});

// ─── Column rendering ─────────────────────────────────────────────────────────

describe('Board — rendering', () => {
  it('renders all 3 columns when tasks exist', () => {
    useAppStore.setState({ tasks: TASKS_FIXTURE });
    render(<Board />);
    expect(screen.getAllByText('Todo').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('In Progress').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Done').length).toBeGreaterThanOrEqual(1);
  });

  it('renders tasks from the store', () => {
    useAppStore.setState({ tasks: TASKS_FIXTURE });
    render(<Board />);
    expect(screen.getByText('Task One')).toBeInTheDocument();
    expect(screen.getByText('Task Two')).toBeInTheDocument();
    expect(screen.getByText('Task Three')).toBeInTheDocument();
  });
});

// ─── Drag and drop ───────────────────────────────────────────────────────────

describe('Board — drag and drop', () => {
  it('sets dragging state on dragstart and clears on dragend', () => {
    useAppStore.setState({ tasks: TASKS_FIXTURE });
    render(<Board />);

    const cards = screen.getAllByTestId('task-card');
    const firstCard = cards[0];

    // Drag start — card should get aria-grabbed=true
    fireEvent.dragStart(firstCard, {
      dataTransfer: { effectAllowed: '', setData: vi.fn(), getData: vi.fn().mockReturnValue('t1') },
    });
    expect(firstCard.getAttribute('aria-grabbed')).toBe('true');

    // Drag end (cancel) — state resets, aria-grabbed back to false
    fireEvent.dragEnd(firstCard);
    expect(firstCard.getAttribute('aria-grabbed')).toBe('false');
  });

  it('does not call moveTask when dropping onto the same column', () => {
    const moveTaskMock = vi.fn();
    useAppStore.setState({ tasks: TASKS_FIXTURE, moveTask: moveTaskMock });
    render(<Board />);

    const cards = screen.getAllByTestId('task-card');
    const firstCard = cards[0];

    fireEvent.dragStart(firstCard, {
      dataTransfer: {
        effectAllowed: '',
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue('t1'),
      },
    });

    // Drop on the todo column (same as source)
    const todoSection = screen.getByRole('region', { name: 'Todo column' });
    fireEvent.drop(todoSection, {
      dataTransfer: { getData: vi.fn().mockReturnValue('t1') },
    });

    expect(moveTaskMock).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────────────────
  // ADR-1 (touch-reorder) — handleReorderStep via the ↑ / ↓ toolbar buttons
  // ────────────────────────────────────────────────────────────────────────

  it('reorder step: ↓ on 1st card calls reorderTask with a rank between it and the 2nd card', () => {
    const reorderTaskMock = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      tasks: {
        todo: [
          { id: 't1', title: 'A', type: 'chore' as const, rank: 1000, createdAt: '', updatedAt: '' },
          { id: 't2', title: 'B', type: 'chore' as const, rank: 2000, createdAt: '', updatedAt: '' },
          { id: 't3', title: 'C', type: 'chore' as const, rank: 3000, createdAt: '', updatedAt: '' },
        ],
        'in-progress': [], done: [],
      },
      reorderTask: reorderTaskMock,
      isMutating: false,
    });
    render(<Board />);
    // Overlay is hidden by CSS opacity — query with hidden:true.
    const downButtons = screen.getAllByRole('button', { name: /^move down$/i, hidden: true });
    // First card (t1) → click its ↓ → move it past t2 (rank should be > 2000, < 3000)
    fireEvent.click(downButtons[0]);
    expect(reorderTaskMock).toHaveBeenCalledOnce();
    const [id, column, newRank] = reorderTaskMock.mock.calls[0];
    expect(id).toBe('t1');
    expect(column).toBe('todo');
    expect(newRank).toBeGreaterThan(2000);
    expect(newRank).toBeLessThan(3000);
  });

  it('reorder step: ↑ on 2nd card calls reorderTask with a rank less than the 1st card', () => {
    const reorderTaskMock = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      tasks: {
        todo: [
          { id: 't1', title: 'A', type: 'chore' as const, rank: 1000, createdAt: '', updatedAt: '' },
          { id: 't2', title: 'B', type: 'chore' as const, rank: 2000, createdAt: '', updatedAt: '' },
        ],
        'in-progress': [], done: [],
      },
      reorderTask: reorderTaskMock,
      isMutating: false,
    });
    render(<Board />);
    const upButtons = screen.getAllByRole('button', { name: /^move up$/i, hidden: true });
    // The 2nd card (t2)'s ↑ is the second visible ↑ button (t1's ↑ is disabled but still rendered).
    fireEvent.click(upButtons[1]);
    expect(reorderTaskMock).toHaveBeenCalledOnce();
    const [id, column, newRank] = reorderTaskMock.mock.calls[0];
    expect(id).toBe('t2');
    expect(column).toBe('todo');
    expect(newRank).toBeLessThan(1000);
  });

  it('reorder step: ↑ on the first card is disabled → no reorderTask call', () => {
    const reorderTaskMock = vi.fn();
    useAppStore.setState({
      tasks: {
        todo: [
          { id: 't1', title: 'A', type: 'chore' as const, rank: 1000, createdAt: '', updatedAt: '' },
          { id: 't2', title: 'B', type: 'chore' as const, rank: 2000, createdAt: '', updatedAt: '' },
        ],
        'in-progress': [], done: [],
      },
      reorderTask: reorderTaskMock,
    });
    render(<Board />);
    const upButtons = screen.getAllByRole('button', { name: /^move up$/i, hidden: true });
    expect(upButtons[0]).toBeDisabled();
    fireEvent.click(upButtons[0]);
    expect(reorderTaskMock).not.toHaveBeenCalled();
  });

  it('reorder step: ↓ on the last card is disabled → no reorderTask call', () => {
    const reorderTaskMock = vi.fn();
    useAppStore.setState({
      tasks: {
        todo: [
          { id: 't1', title: 'A', type: 'chore' as const, rank: 1000, createdAt: '', updatedAt: '' },
          { id: 't2', title: 'B', type: 'chore' as const, rank: 2000, createdAt: '', updatedAt: '' },
        ],
        'in-progress': [], done: [],
      },
      reorderTask: reorderTaskMock,
    });
    render(<Board />);
    const downButtons = screen.getAllByRole('button', { name: /^move down$/i, hidden: true });
    expect(downButtons[downButtons.length - 1]).toBeDisabled();
    fireEvent.click(downButtons[downButtons.length - 1]);
    expect(reorderTaskMock).not.toHaveBeenCalled();
  });

  it('reorder step: no-op while isMutating', () => {
    const reorderTaskMock = vi.fn();
    useAppStore.setState({
      tasks: {
        todo: [
          { id: 't1', title: 'A', type: 'chore' as const, rank: 1000, createdAt: '', updatedAt: '' },
          { id: 't2', title: 'B', type: 'chore' as const, rank: 2000, createdAt: '', updatedAt: '' },
          { id: 't3', title: 'C', type: 'chore' as const, rank: 3000, createdAt: '', updatedAt: '' },
        ],
        'in-progress': [], done: [],
      },
      reorderTask: reorderTaskMock,
      isMutating: true,
    });
    render(<Board />);
    // While mutating, all buttons are disabled (guard in CardActionMenu).
    // But even if a stale click sneaks through, handleReorderStep must no-op.
    // Simulate by calling directly via mousedown on t1's ↓.
    const downButtons = screen.getAllByRole('button', { name: /^move down$/i, hidden: true });
    fireEvent.click(downButtons[0]);
    expect(reorderTaskMock).not.toHaveBeenCalled();
  });

  it('reorder step: collapsed rank gap triggers the rebalance branch', () => {
    const reorderTaskMock = vi.fn().mockResolvedValue(undefined);
    // Adjacent ranks with a gap < 0.001 force rebalance.
    useAppStore.setState({
      tasks: {
        todo: [
          { id: 't1', title: 'A', type: 'chore' as const, rank: 1.0000, createdAt: '', updatedAt: '' },
          { id: 't2', title: 'B', type: 'chore' as const, rank: 1.0001, createdAt: '', updatedAt: '' },
          { id: 't3', title: 'C', type: 'chore' as const, rank: 1.0002, createdAt: '', updatedAt: '' },
        ],
        'in-progress': [], done: [],
      },
      reorderTask: reorderTaskMock,
      isMutating: false,
    });
    render(<Board />);
    const downButtons = screen.getAllByRole('button', { name: /^move down$/i, hidden: true });
    fireEvent.click(downButtons[0]); // t1 down → collapses → rebalance
    // Rebalance persists every task in the new order.
    expect(reorderTaskMock).toHaveBeenCalledTimes(3);
    const ids = reorderTaskMock.mock.calls.map((c) => c[0]).sort();
    expect(ids).toEqual(['t1', 't2', 't3']);
  });

  // ────────────────────────────────────────────────────────────────────────
  // ADR-1 (touch-reorder) — isFirst/isLast + neighbor selection must use
  // rank-order (the full column), not the arc-filtered/grouped visible list.
  // This is a documented assumption (blueprint.md §3.2, Column.tsx comment) —
  // regression-tested here since no prior test exercised arcFilter/arcGrouping
  // together with the reorder-step buttons.
  // ────────────────────────────────────────────────────────────────────────

  it('reorder step: ↓ targets the true rank-neighbor even when it is filtered out of view', () => {
    const reorderTaskMock = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      tasks: {
        todo: [
          { id: 't1', title: 'A', type: 'chore' as const, rank: 1000, arc: 'Alpha', createdAt: '', updatedAt: '' },
          // t2 has no arc — filtered out when arcFilter='Alpha', but is still
          // t1's immediate rank-neighbor and must be the reorder target.
          { id: 't2', title: 'B', type: 'chore' as const, rank: 2000, createdAt: '', updatedAt: '' },
          { id: 't3', title: 'C', type: 'chore' as const, rank: 3000, arc: 'Alpha', createdAt: '', updatedAt: '' },
        ],
        'in-progress': [], done: [],
      },
      reorderTask: reorderTaskMock,
      isMutating: false,
      arcFilter: 'Alpha',
      arcGrouping: false,
    });
    render(<Board />);
    // Only t1 and t3 (arc=Alpha) are visible; t1 is first-in-view but is
    // still first-in-rank too, so ↑ stays disabled. Its ↓ must target the
    // real neighbor t2 (rank 2000), not the next *visible* card t3.
    const downButtons = screen.getAllByRole('button', { name: /^move down$/i, hidden: true });
    fireEvent.click(downButtons[0]);
    expect(reorderTaskMock).toHaveBeenCalledOnce();
    const [id, column, newRank] = reorderTaskMock.mock.calls[0];
    expect(id).toBe('t1');
    expect(column).toBe('todo');
    expect(newRank).toBeGreaterThan(2000);
    expect(newRank).toBeLessThan(3000);

    // t3 is 2nd in the *filtered* view but 3rd (last) in true rank order —
    // its ↓ must stay disabled, proving isFirst/isLast is computed against
    // the unfiltered column, not `visibleTasks`. (Regression check: if
    // Column.tsx ever switches isFirst/isLast to rank-index-within-
    // visibleTasks, this button would incorrectly become enabled.)
    expect(downButtons[1]).toBeDisabled();
  });

  it('reorder step: ↓/↑ still edits by rank order when arcGrouping is on, crossing group boundaries', () => {
    const reorderTaskMock = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      tasks: {
        todo: [
          { id: 't1', title: 'A', type: 'chore' as const, rank: 1000, arc: 'Alpha', createdAt: '', updatedAt: '' },
          { id: 't2', title: 'B', type: 'chore' as const, rank: 2000, arc: 'Beta', createdAt: '', updatedAt: '' },
        ],
        'in-progress': [], done: [],
      },
      reorderTask: reorderTaskMock,
      isMutating: false,
      arcFilter: null,
      arcGrouping: true,
    });
    render(<Board />);
    // t1 (Alpha) and t2 (Beta) are rank-adjacent despite different arc groups.
    // Epic 3 (user-stories.md): rank stays the single source of truth, no
    // special-casing at a group boundary — this is intentional, not a bug.
    const downButtons = screen.getAllByRole('button', { name: /^move down$/i, hidden: true });
    fireEvent.click(downButtons[0]); // t1 ↓ → swaps past t2 across the Alpha/Beta boundary
    expect(reorderTaskMock).toHaveBeenCalledOnce();
    const [id, column, newRank] = reorderTaskMock.mock.calls[0];
    expect(id).toBe('t1');
    expect(column).toBe('todo');
    expect(newRank).toBeGreaterThan(2000);
  });

  it('calls moveTask with direction=right when dropping on a later column', () => {
    const moveTaskMock = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ tasks: TASKS_FIXTURE, moveTask: moveTaskMock });
    render(<Board />);

    const cards = screen.getAllByTestId('task-card');
    const firstCard = cards[0]; // t1 in todo

    fireEvent.dragStart(firstCard, {
      dataTransfer: {
        effectAllowed: '',
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue('t1'),
      },
    });

    const inProgressSection = screen.getByRole('region', { name: 'In Progress column' });
    fireEvent.drop(inProgressSection, {
      dataTransfer: { getData: vi.fn().mockReturnValue('t1') },
    });

    expect(moveTaskMock).toHaveBeenCalledWith('t1', 'right', 'todo');
  });
});
