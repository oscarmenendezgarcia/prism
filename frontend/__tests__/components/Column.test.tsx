import type React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Column } from '../../src/components/board/Column';
import { useAppStore } from '../../src/stores/useAppStore';
import type { Status, Task } from '../../src/types';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(), getTasks: vi.fn(), createTask: vi.fn(), moveTask: vi.fn(),
  deleteTask: vi.fn(), createSpace: vi.fn(), renameSpace: vi.fn(), deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
  getAgents: vi.fn(), getAgent: vi.fn(), generatePrompt: vi.fn(),
  getSettings: vi.fn(), saveSettings: vi.fn(),
  createAgentRun: vi.fn().mockResolvedValue({ id: 'run_mock' }),
  updateAgentRun: vi.fn().mockResolvedValue({}),
  getAgentRuns: vi.fn().mockResolvedValue({ runs: [], total: 0 }),
  listRuns: vi.fn(), getRun: vi.fn(),
}));

const tasks: Task[] = [
  { id: 't1', title: 'First task', type: 'feature', createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z' },
  { id: 't2', title: 'Second task', type: 'bug', createdAt: '2026-03-02T00:00:00Z', updatedAt: '2026-03-02T00:00:00Z' },
];

const TODO: Status = { id: 'todo', name: 'Todo', category: 'todo' };
const IN_PROGRESS: Status = { id: 'in-progress', name: 'In Progress', category: 'in-progress' };
const IN_REVIEW: Status = { id: 'review', name: 'In review', category: 'in-progress' };
const DONE: Status = { id: 'done', name: 'Done', category: 'done' };
const STATUSES = [TODO, IN_PROGRESS, IN_REVIEW, DONE];

function renderColumn(status: Status, columnTasks: Task[] = [], props: Partial<React.ComponentProps<typeof Column>> = {}) {
  return render(<Column column={status.id} status={status} statuses={STATUSES} tasks={columnTasks} {...props} />);
}

describe('Column', () => {
  beforeEach(() => {
    useAppStore.setState({ filters: {}, tasks: {}, spaces: [], columnTotals: {}, columnLimits: {} });
  });

  it('renders column title for todo', () => {
    renderColumn(TODO);
    expect(screen.getByText('Todo')).toBeInTheDocument();
  });

  it('renders In Progress title', () => {
    renderColumn(IN_PROGRESS);
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('renders Done title', () => {
    renderColumn(DONE);
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('renders whatever the status is called', () => {
    renderColumn(IN_REVIEW);
    expect(screen.getByText('In review')).toBeInTheDocument();
  });

  it('falls back to the id when the status is not known', () => {
    render(<Column column="mystery" tasks={[]} />);
    expect(screen.getByText('mystery')).toBeInTheDocument();
  });

  it('shows a dot that says how far along the status is', () => {
    const dot = (container: HTMLElement) => container.querySelector('h2 > span');
    const first = renderColumn(IN_PROGRESS);
    expect(dot(first.container)).toHaveClass('bg-primary');
    first.unmount();
    const second = renderColumn(IN_REVIEW);
    expect(dot(second.container)).toHaveClass('bg-warning');
  });

  it('shows task count in header', () => {
    renderColumn(TODO, tasks);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows 0 count for empty column', () => {
    renderColumn(TODO);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders EmptyState when no tasks', () => {
    renderColumn(TODO);
    expect(screen.getByText('No issues here')).toBeInTheDocument();
  });

  it('picks the EmptyState by the category of the status', () => {
    renderColumn(IN_REVIEW);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('shows what it was given whatever the epic filter: the server already applied it', () => {
    useAppStore.setState({ filters: { epic: ['e1'] }, columnTotals: { todo: 2 } });
    renderColumn(TODO, tasks);
    expect(screen.getByText('First task')).toBeInTheDocument();
    expect(screen.getByText('Second task')).toBeInTheDocument();
  });

  describe('a status named like something every object inherits', () => {
    const CONSTRUCTOR: Status = { id: 'constructor', name: 'constructor', category: 'in-progress' };

    it('counts what it was given while no total is known', () => {
      render(<Column column="constructor" status={CONSTRUCTOR} tasks={tasks} />);
      expect(screen.getByText(String(tasks.length))).toBeInTheDocument();
    });

    it('still offers to show more, with no limit raised yet', () => {
      useAppStore.setState({ columnTotals: JSON.parse('{"constructor":500}') });
      render(<Column column="constructor" status={CONSTRUCTOR} tasks={tasks} />);
      expect(screen.getByText('500')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
    });
  });

  describe('a column with more cards than are loaded', () => {
    it('counts all of them in the header', () => {
      useAppStore.setState({ columnTotals: { todo: 4210 } });
      renderColumn(TODO, tasks);
      expect(screen.getByText('4210')).toBeInTheDocument();
    });

    it('offers to show more, which asks the store for it', async () => {
      const showMoreCards = vi.fn().mockResolvedValue(undefined);
      useAppStore.setState({ columnTotals: { todo: 3 }, showMoreCards } as never);
      renderColumn(TODO, tasks);
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
      expect(showMoreCards).toHaveBeenCalledWith('todo');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Show more' })).toBeEnabled());
    });

    const DONE: Status = { id: 'done', name: 'Done', category: 'done' };
    const doneCard = (id: string): Task => ({ ...tasks[0], id, title: id, category: 'done', statusId: 'done' });

    it('in a done column it goes above the cards, since what it reveals goes there', () => {
      useAppStore.setState({ columnTotals: { done: 300 } });
      render(<Column column="done" status={DONE} tasks={[doneCard('a')]} />);
      const button = screen.getByRole('button', { name: 'Show more' });
      expect(button.compareDocumentPosition(screen.getByTestId('task-card')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('in any other column it goes below them', () => {
      useAppStore.setState({ columnTotals: { todo: 300 } });
      renderColumn(TODO, tasks);
      const button = screen.getByRole('button', { name: 'Show more' });
      expect(button.compareDocumentPosition(screen.getAllByTestId('task-card')[0]) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    });

    function scrollable(height: { value: number }) {
      const list = screen.getByRole('list');
      Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => height.value });
      return list;
    }

    it('in a done column, what was on screen stays there when earlier cards arrive above it', async () => {
      let loaded: () => void = () => {};
      const showMoreCards = vi.fn(() => new Promise<void>((resolve) => { loaded = resolve; }));
      useAppStore.setState({ columnTotals: { done: 300 }, showMoreCards } as never);
      const { rerender } = render(<Column column="done" status={DONE} tasks={[doneCard('b')]} />);
      const height = { value: 500 };
      const list = scrollable(height);
      list.scrollTop = 30;
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
      height.value = 900;
      rerender(<Column column="done" status={DONE} tasks={[doneCard('a'), doneCard('b')]} />);
      expect(list.scrollTop).toBe(430);
      await act(async () => { loaded(); });
      expect(list.scrollTop).toBe(430);
    });

    it('does not move the column for a change after it, if nothing arrived', async () => {
      const showMoreCards = vi.fn().mockResolvedValue(undefined);
      useAppStore.setState({ columnTotals: { done: 300 }, showMoreCards } as never);
      const { rerender } = render(<Column column="done" status={DONE} tasks={[doneCard('b')]} />);
      const height = { value: 500 };
      const list = scrollable(height);
      list.scrollTop = 30;
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show more' })); });
      height.value = 900;
      rerender(<Column column="done" status={DONE} tasks={[doneCard('a'), doneCard('b')]} />);
      expect(list.scrollTop).toBe(30);
    });

    it('offers nothing when all are loaded', () => {
      useAppStore.setState({ columnTotals: { todo: tasks.length } });
      renderColumn(TODO, tasks);
      expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    });

    it('offers nothing once the limit reaches what the server allows', () => {
      useAppStore.setState({ columnTotals: { todo: 9000 }, columnLimits: { todo: 2000 } });
      renderColumn(TODO, tasks);
      expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    });
  });

  it('renders TaskCards when tasks present', () => {
    renderColumn(TODO, tasks);
    expect(screen.getByText('First task')).toBeInTheDocument();
    expect(screen.getByText('Second task')).toBeInTheDocument();
  });

  it('has correct aria-label', () => {
    const { container } = renderColumn(TODO);
    expect(container.querySelector('[aria-label="Todo column"]')).toBeInTheDocument();
  });

  it('renders without drag handler props (all are optional)', () => {
    // Verifies the component does not throw when drag props are omitted
    expect(() => renderColumn(TODO, tasks)).not.toThrow();
  });

  it('forwards onDragEnd to TaskCard elements', () => {
    const onDragEnd = vi.fn();
    renderColumn(TODO, tasks, { onDragEnd });
    const cards = screen.getAllByTestId('task-card');
    fireEvent.dragEnd(cards[0]);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('BUG-003: clears dragOverTaskId when cursor is in empty column space', () => {
    // Regression: when the cursor exits the last card into empty column space,
    // no per-card handler fires (cards stopPropagation), so dragOverTaskId
    // used to stay pointing at the last card. Column-level dragover must now
    // clear it by calling onDragOverTask(null, ...).
    const onDragOverTask = vi.fn();
    const { container } = renderColumn(TODO, tasks, { onDragOverTask });
    const section = container.querySelector('[aria-label="Todo column"]')!;
    fireEvent.dragOver(section);
    expect(onDragOverTask).toHaveBeenCalledWith(null, true);
  });
});
