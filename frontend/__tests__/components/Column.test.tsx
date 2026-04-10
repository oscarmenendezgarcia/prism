import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Column } from '../../src/components/board/Column';
import type { Task } from '../../src/types';

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

describe('Column', () => {
  it('renders column title for todo', () => {
    render(<Column column="todo" tasks={[]} />);
    expect(screen.getByText('Todo')).toBeInTheDocument();
  });

  it('renders In Progress title', () => {
    render(<Column column="in-progress" tasks={[]} />);
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('renders Done title', () => {
    render(<Column column="done" tasks={[]} />);
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('shows task count in header', () => {
    render(<Column column="todo" tasks={tasks} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows 0 count for empty column', () => {
    render(<Column column="todo" tasks={[]} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders EmptyState when no tasks', () => {
    render(<Column column="todo" tasks={[]} />);
    expect(screen.getByText('No tasks yet')).toBeInTheDocument();
  });

  it('renders TaskCards when tasks present', () => {
    render(<Column column="todo" tasks={tasks} />);
    expect(screen.getByText('First task')).toBeInTheDocument();
    expect(screen.getByText('Second task')).toBeInTheDocument();
  });

  it('has correct aria-label', () => {
    const { container } = render(<Column column="todo" tasks={[]} />);
    expect(container.querySelector('[aria-label="Todo column"]')).toBeInTheDocument();
  });

  it('renders without drag handler props (all are optional)', () => {
    // Verifies the component does not throw when drag props are omitted
    expect(() => render(<Column column="todo" tasks={tasks} />)).not.toThrow();
  });

  it('forwards onDragEnd to TaskCard elements', () => {
    const onDragEnd = vi.fn();
    render(<Column column="todo" tasks={tasks} onDragEnd={onDragEnd} />);
    const cards = screen.getAllByTestId('task-card');
    fireEvent.dragEnd(cards[0]);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });
});
