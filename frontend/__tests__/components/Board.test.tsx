/**
 * Unit tests for the Board component.
 * Covers rendering, drag-and-drop perf fixes (stable callbacks, ref-based state),
 * and the dragend safety reset.
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

beforeEach(() => {
  useAppStore.setState({
    tasks: { todo: [], 'in-progress': [], done: [] },
    moveTask: vi.fn(),
  });
  useDragStore.getState().resetDrag();
});

describe('Board — rendering', () => {
  it('renders all 3 columns', () => {
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
