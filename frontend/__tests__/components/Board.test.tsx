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
