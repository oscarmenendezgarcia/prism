import type React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    useAppStore.setState({ epicFilter: null, tasks: {}, spaces: [] });
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

  it('counts and shows only the issues of the chosen epic', () => {
    const epic: Task = { id: 'e1', title: 'Epic', type: 'epic', createdAt: '', updatedAt: '' };
    const inEpic: Task = { ...tasks[0], parentId: 'e1' };
    useAppStore.setState({ epicFilter: 'e1', tasks: { todo: [inEpic, tasks[1]], other: [epic] } });
    renderColumn(TODO, [inEpic, tasks[1]]);
    expect(screen.getByText('First task')).toBeInTheDocument();
    expect(screen.queryByText('Second task')).not.toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
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
