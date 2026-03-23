import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskCard } from '../../src/components/board/TaskCard';
import { useAppStore } from '../../src/stores/useAppStore';
import { useRunHistoryStore } from '../../src/stores/useRunHistoryStore';
import type { Task } from '../../src/types';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(),
  getTasks: vi.fn(),
  createTask: vi.fn(),
  moveTask: vi.fn(),
  deleteTask: vi.fn(),
  createSpace: vi.fn(),
  renameSpace: vi.fn(),
  deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
  createAgentRun: vi.fn().mockResolvedValue({ id: 'run_mock' }),
  updateAgentRun: vi.fn().mockResolvedValue({}),
  getAgentRuns: vi.fn().mockResolvedValue({ runs: [], total: 0 }),
}));

const baseTask: Task = {
  id: 'task-1',
  title: 'Write unit tests',
  type: 'task',
  createdAt: '2026-03-09T10:00:00.000Z',
  updatedAt: '2026-03-09T10:00:00.000Z',
};

beforeEach(() => {
  useAppStore.setState({
    activeSpaceId: 'default',
    isMutating: false,
    tasks: { todo: [], 'in-progress': [], done: [] },
    activeRun: null,
  });
  useRunHistoryStore.setState({ taskIdFilter: null, historyPanelOpen: false });
  vi.clearAllMocks();
});

describe('TaskCard', () => {
  it('renders task title', () => {
    render(<TaskCard task={baseTask} column="todo" />);
    expect(screen.getByText('Write unit tests')).toBeInTheDocument();
  });

  it('renders task badge', () => {
    render(<TaskCard task={baseTask} column="todo" />);
    expect(screen.getByText('task')).toBeInTheDocument();
  });

  it('renders description when present', () => {
    const task = { ...baseTask, description: 'Some details' };
    render(<TaskCard task={task} column="todo" />);
    expect(screen.getByText('Some details')).toBeInTheDocument();
  });

  it('does not render description section when absent', () => {
    render(<TaskCard task={baseTask} column="todo" />);
    expect(screen.queryByText(/some details/i)).not.toBeInTheDocument();
  });

  it('renders assigned when present', () => {
    const task = { ...baseTask, assigned: 'developer-agent' };
    render(<TaskCard task={task} column="todo" />);
    expect(screen.getByText('developer-agent')).toBeInTheDocument();
  });

  it('hides move-left button on Todo column', () => {
    render(<TaskCard task={baseTask} column="todo" />);
    expect(screen.queryByLabelText(/move to todo/i)).not.toBeInTheDocument();
  });

  it('shows move-right button on Todo column', () => {
    render(<TaskCard task={baseTask} column="todo" />);
    expect(screen.getByLabelText(/move to in progress/i)).toBeInTheDocument();
  });

  it('hides move-right button on Done column', () => {
    render(<TaskCard task={baseTask} column="done" />);
    expect(screen.queryByLabelText(/move to done/i)).not.toBeInTheDocument();
  });

  it('shows move-left button on Done column', () => {
    render(<TaskCard task={baseTask} column="done" />);
    expect(screen.getByLabelText(/move to in progress/i)).toBeInTheDocument();
  });

  it('shows both arrows on In Progress column', () => {
    render(<TaskCard task={baseTask} column="in-progress" />);
    expect(screen.getByLabelText(/move to todo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/move to done/i)).toBeInTheDocument();
  });

  it('applies done opacity when column is done', () => {
    const { container } = render(<TaskCard task={baseTask} column="done" />);
    const article = container.querySelector('article');
    // ADR-003: done state updated from opacity-60 to opacity-50 for slightly more muted look
    expect(article?.className).toContain('opacity-50');
  });

  it('calls moveTask when arrow button clicked', async () => {
    const mockMoveTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ moveTask: mockMoveTask } as any);

    render(<TaskCard task={baseTask} column="todo" />);
    fireEvent.click(screen.getByLabelText(/move to in progress/i));
    expect(mockMoveTask).toHaveBeenCalledWith('task-1', 'right', 'todo');
  });

  it('calls deleteTask when delete button clicked', () => {
    const mockDeleteTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ deleteTask: mockDeleteTask } as any);

    render(<TaskCard task={baseTask} column="todo" />);
    fireEvent.click(screen.getByLabelText(/delete task/i));
    expect(mockDeleteTask).toHaveBeenCalledWith('task-1');
  });

  it('disables buttons when isMutating', () => {
    useAppStore.setState({ isMutating: true });
    render(<TaskCard task={baseTask} column="in-progress" />);
    const moveBtn = screen.getByLabelText(/move to todo/i);
    expect(moveBtn).toBeDisabled();
  });

  it('does not show active-run indicator when no agent is running', () => {
    render(<TaskCard task={baseTask} column="todo" />);
    expect(screen.queryByLabelText(/agent running/i)).not.toBeInTheDocument();
  });

  it('does not show active-run indicator when activeRun is for a different task', () => {
    useAppStore.setState({
      activeRun: {
        taskId: 'other-task', agentId: 'developer-agent', spaceId: 'default',
        startedAt: new Date().toISOString(), cliCommand: 'claude run', promptPath: '/tmp/p.md',
      },
    } as any);
    render(<TaskCard task={baseTask} column="todo" />);
    expect(screen.queryByLabelText(/agent running/i)).not.toBeInTheDocument();
  });

  it('shows active-run indicator when activeRun.taskId matches task.id', () => {
    useAppStore.setState({
      activeRun: {
        taskId: 'task-1', agentId: 'developer-agent', spaceId: 'default',
        startedAt: new Date().toISOString(), cliCommand: 'claude run', promptPath: '/tmp/p.md',
      },
    } as any);
    render(<TaskCard task={baseTask} column="todo" />);
    expect(screen.getByLabelText(/agent running — view run history for this task/i)).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('clicking the active-run indicator calls openPanelForTask with the task id', () => {
    const mockOpenPanel = vi.fn();
    useRunHistoryStore.setState({ openPanelForTask: mockOpenPanel } as any);
    useAppStore.setState({
      activeRun: {
        taskId: 'task-1', agentId: 'developer-agent', spaceId: 'default',
        startedAt: new Date().toISOString(), cliCommand: 'claude run', promptPath: '/tmp/p.md',
      },
    } as any);
    render(<TaskCard task={baseTask} column="todo" />);
    fireEvent.click(screen.getByLabelText(/agent running — view run history for this task/i));
    expect(mockOpenPanel).toHaveBeenCalledWith('task-1');
  });

  it('renders attachment button when task has attachments', () => {
    const task = {
      ...baseTask,
      attachments: [{ name: 'notes.txt', type: 'text' as const }],
    };
    render(<TaskCard task={task} column="todo" />);
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
  });

  it('opens attachment modal when attachment button clicked', () => {
    const mockOpen = vi.fn();
    useAppStore.setState({ openAttachmentModal: mockOpen } as any);

    const task = {
      ...baseTask,
      attachments: [{ name: 'notes.txt', type: 'text' as const }],
    };
    render(<TaskCard task={task} column="todo" />);
    fireEvent.click(screen.getByText('notes.txt'));
    expect(mockOpen).toHaveBeenCalledWith('default', 'task-1', 0, 'notes.txt');
  });
});
