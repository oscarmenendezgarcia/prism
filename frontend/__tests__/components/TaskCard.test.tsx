/**
 * Unit tests for the redesigned TaskCard component.
 * T-007: Verifies three-zone layout, conditional rendering, active-run dot,
 *        more_vert button, hover overlay presence, and absence of old elements.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskCard } from '../../src/components/board/TaskCard';
import { useAppStore } from '../../src/stores/useAppStore';
import { useRunHistoryStore } from '../../src/stores/useRunHistoryStore';
import { useDragStore } from '../../src/stores/useDragStore';
import type { Task, AgentRun } from '../../src/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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
  getAgents: vi.fn(),
  getAgent: vi.fn(),
  generatePrompt: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  createAgentRun: vi.fn().mockResolvedValue({ id: 'run_mock' }),
  updateAgentRun: vi.fn().mockResolvedValue({}),
  getAgentRuns: vi.fn().mockResolvedValue({ runs: [], total: 0 }),
  listRuns: vi.fn(),
  getRun: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_TASK: Task = {
  id: 'task-1',
  title: 'Implement user auth flow',
  type: 'feature',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const TASK_WITH_ALL: Task = {
  ...BASE_TASK,
  assigned: 'dev-agent',
  description: 'This covers OAuth2 implementation with refresh token rotation',
  attachments: [
    { name: 'spec.md', type: 'text' },
    { name: 'diagram.png', type: 'file' },
    { name: 'notes.txt', type: 'text' },
  ],
};

const ACTIVE_RUN: AgentRun = {
  taskId: 'task-1',
  agentId: 'developer-agent',
  spaceId: 'space-1',
  startedAt: '2026-03-26T00:00:00.000Z',
  cliCommand: 'claude --agent developer-agent',
  promptPath: '/tmp/prompt.md',
};

// isDragging and isDragOver are no longer props — they come from useDragStore.
// Tests that need drag state set useDragStore.setState() directly.
const DRAG_HANDLERS = {
  onDragStart: vi.fn(),
  onDragOver: vi.fn(),
  onDragLeave: vi.fn(),
  onDrop: vi.fn(),
};

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

function resetStores(overrides: Record<string, unknown> = {}) {
  useAppStore.setState({
    activeSpaceId: 'space-1',
    spaces: [{ id: 'space-1', name: 'Test Space', createdAt: '', updatedAt: '' }],
    availableAgents: [],
    activeRun: null,
    isMutating: false,
    tasks: { todo: [], 'in-progress': [], done: [] },
    ...overrides,
  });
  useRunHistoryStore.setState({
    runs: [],
    historyPanelOpen: false,
    selectedRunId: null,
    filterTaskId: null,
    taskIdFilter: null,
  });
}

beforeEach(() => {
  resetStores();
  useDragStore.getState().resetDrag();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Zone A — Identity
// ---------------------------------------------------------------------------

describe('TaskCard — Zone A (identity)', () => {
  it('renders the badge with the correct type (feature)', () => {
    render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    expect(screen.getByText('feature')).toBeInTheDocument();
  });

  it('renders a bug badge when type is bug', () => {
    render(
      <TaskCard task={{ ...BASE_TASK, type: 'bug' }} column="todo" {...DRAG_HANDLERS} />
    );
    expect(screen.getByText('bug')).toBeInTheDocument();
  });

  it('renders a tech-debt badge when type is tech-debt', () => {
    render(
      <TaskCard task={{ ...BASE_TASK, type: 'tech-debt' }} column="todo" {...DRAG_HANDLERS} />
    );
    expect(screen.getByText('tech-debt')).toBeInTheDocument();
  });

  it('renders a chore badge when type is chore', () => {
    render(
      <TaskCard task={{ ...BASE_TASK, type: 'chore' }} column="todo" {...DRAG_HANDLERS} />
    );
    expect(screen.getByText('chore')).toBeInTheDocument();
  });

  it('renders the title text', () => {
    render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    expect(screen.getByText('Implement user auth flow')).toBeInTheDocument();
  });

  it('clicking the card article calls openDetailPanel', () => {
    const openDetailPanel = vi.fn();
    useAppStore.setState({ openDetailPanel } as never);
    const { container } = render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    fireEvent.click(container.querySelector('[data-testid="task-card"]')!);
    expect(openDetailPanel).toHaveBeenCalledWith(BASE_TASK);
  });

  it('does NOT render an open_in_full expand button', () => {
    render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    expect(screen.queryByLabelText(/open task detail/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Zone A — active run indicator
// ---------------------------------------------------------------------------

describe('TaskCard — active run dot', () => {
  it('dot is absent when no agent is running', () => {
    render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    expect(
      screen.queryByRole('button', { name: /agent running/i })
    ).not.toBeInTheDocument();
  });

  it('dot is absent when a different task is the active task', () => {
    resetStores({ activeRun: { ...ACTIVE_RUN, taskId: 'other-task' } });
    render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    expect(
      screen.queryByRole('button', { name: /agent running/i })
    ).not.toBeInTheDocument();
  });

  it('applies animate-glow-pulse when this task is the active task (Trend A)', () => {
    resetStores({ activeRun: ACTIVE_RUN });
    const { container } = render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    expect(
      container.querySelector('[data-testid="task-card"]')?.className
    ).toContain('animate-glow-pulse');
  });

  it('applies border-primary/30 when this task is the active task (Trend A)', () => {
    resetStores({ activeRun: ACTIVE_RUN });
    const { container } = render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    expect(
      container.querySelector('[data-testid="task-card"]')?.className
    ).toContain('border-primary/30');
  });

  it('does not apply glow-pulse when a different task is active', () => {
    resetStores({ activeRun: { ...ACTIVE_RUN, taskId: 'other-task' } });
    const { container } = render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    expect(
      container.querySelector('[data-testid="task-card"]')?.className
    ).not.toContain('animate-glow-pulse');
  });
});

// ---------------------------------------------------------------------------
// Zone B — assigned
// ---------------------------------------------------------------------------

describe('TaskCard — Zone B (assigned)', () => {
  it('Zone B is always present (separator + bottom row)', () => {
    const { container } = render(
      <TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />
    );
    // zone-b always rendered in new design
    expect(container.querySelector('[data-testid="zone-b"]')).toBeInTheDocument();
  });

  it('renders assigned name when task.assigned is set', () => {
    render(<TaskCard task={TASK_WITH_ALL} column="todo" {...DRAG_HANDLERS} />);
    expect(screen.getByTestId('assigned-name')).toHaveTextContent('dev-agent');
  });

  it('renders initials avatar when task.assigned is set', () => {
    render(<TaskCard task={TASK_WITH_ALL} column="todo" {...DRAG_HANDLERS} />);
    expect(screen.getByTestId('avatar')).toHaveTextContent('DA');
  });

  it('does not render assigned row when task.assigned is undefined', () => {
    render(
      <TaskCard task={{ ...BASE_TASK, description: 'Some desc' }} column="todo" {...DRAG_HANDLERS} />
    );
    expect(screen.queryByTestId('assigned-name')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Zone B — attachment count
// ---------------------------------------------------------------------------

describe('TaskCard — Zone B (attachment count)', () => {
  it('attachment pill is absent when task has no attachments', () => {
    render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    expect(screen.queryByTestId('attachment-pill')).not.toBeInTheDocument();
  });

  it('attachment pill is absent when attachments is an empty array', () => {
    render(
      <TaskCard task={{ ...BASE_TASK, attachments: [] }} column="todo" {...DRAG_HANDLERS} />
    );
    expect(screen.queryByTestId('attachment-pill')).not.toBeInTheDocument();
  });

  it('attachment pill shows the correct count', () => {
    render(<TaskCard task={TASK_WITH_ALL} column="todo" {...DRAG_HANDLERS} />);
    expect(screen.getByTestId('attachment-pill')).toHaveTextContent('3');
  });

  it('attachment pill has the correct aria-label', () => {
    render(<TaskCard task={TASK_WITH_ALL} column="todo" {...DRAG_HANDLERS} />);
    expect(screen.getByTestId('attachment-pill')).toHaveAttribute('aria-label', '3 attachments');
  });

  it('clicking the pill calls openAttachmentModal with the first attachment and full list', () => {
    const openAttachmentModal = vi.fn();
    useAppStore.setState({ openAttachmentModal, activeSpaceId: 'space-1' } as never);
    render(<TaskCard task={TASK_WITH_ALL} column="todo" {...DRAG_HANDLERS} />);
    fireEvent.click(screen.getByTestId('attachment-pill'));
    expect(openAttachmentModal).toHaveBeenCalledWith(
      'space-1',
      'task-1',
      0,
      'spec.md',
      TASK_WITH_ALL.attachments,
    );
  });

  it('does NOT show individual attachment chip filenames', () => {
    render(<TaskCard task={TASK_WITH_ALL} column="todo" {...DRAG_HANDLERS} />);
    // The redesigned card only shows the count, not individual file names
    expect(screen.queryByText('spec.md')).not.toBeInTheDocument();
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Zone B — description preview
// ---------------------------------------------------------------------------

describe('TaskCard — Zone B (description preview)', () => {
  it('description preview is absent when task.description is undefined', () => {
    render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    expect(screen.queryByTestId('desc-preview')).not.toBeInTheDocument();
  });

  it('description preview is present when task.description is set', () => {
    render(
      <TaskCard task={{ ...BASE_TASK, description: 'My description' }} column="todo" {...DRAG_HANDLERS} />
    );
    expect(screen.getByTestId('desc-preview')).toHaveTextContent('My description');
  });

  it('description preview has line-clamp-2 class', () => {
    render(
      <TaskCard task={{ ...BASE_TASK, description: 'My description' }} column="todo" {...DRAG_HANDLERS} />
    );
    expect(screen.getByTestId('desc-preview')).toHaveClass('line-clamp-2');
  });
});

// ---------------------------------------------------------------------------
// Removed elements — timestamps and old attachment list
// ---------------------------------------------------------------------------

describe('TaskCard — removed elements (timestamps, old footer)', () => {
  it('does not render any "Created:" text', () => {
    render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    expect(screen.queryByText(/created:/i)).not.toBeInTheDocument();
  });

  it('does not render any "Updated:" text', () => {
    render(
      <TaskCard
        task={{ ...BASE_TASK, updatedAt: '2026-01-02T00:00:00.000Z' }}
        column="todo"
        {...DRAG_HANDLERS}
      />
    );
    expect(screen.queryByText(/updated:/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Hover overlay
// ---------------------------------------------------------------------------

describe('TaskCard — hover overlay', () => {
  it('overlay div has opacity-0 class at rest', () => {
    const { container } = render(
      <TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />
    );
    const overlay = container.querySelector('[data-testid="hover-overlay"]');
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveClass('opacity-0');
  });

  it('overlay div has group-hover:opacity-100 class', () => {
    const { container } = render(
      <TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />
    );
    const overlay = container.querySelector('[data-testid="hover-overlay"]');
    expect(overlay?.className).toContain('group-hover:opacity-100');
  });

  it('article has the "group" class to enable CSS group-hover', () => {
    const { container } = render(
      <TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />
    );
    const article = container.querySelector('[data-testid="task-card"]');
    expect(article?.className).toContain('group');
  });
});

// ---------------------------------------------------------------------------
// Move actions (inside hover overlay CardActionMenu)
// ---------------------------------------------------------------------------

describe('TaskCard — move actions (in overlay)', () => {
  it('move-left absent on todo column', () => {
    render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    expect(screen.queryByRole('button', { name: /move to todo/i })).not.toBeInTheDocument();
  });

  it('move-right absent on done column', () => {
    render(<TaskCard task={BASE_TASK} column="done" {...DRAG_HANDLERS} />);
    expect(screen.queryByRole('button', { name: /move to done/i })).not.toBeInTheDocument();
  });

  it('both arrows present on in-progress column', () => {
    // The overlay is aria-hidden — query with hidden:true to include overlay buttons
    render(<TaskCard task={BASE_TASK} column="in-progress" {...DRAG_HANDLERS} />);
    expect(screen.getByRole('button', { name: /move to todo/i, hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /move to done/i, hidden: true })).toBeInTheDocument();
  });

  it('calls moveTask when move-right clicked', () => {
    const mockMoveTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ moveTask: mockMoveTask } as never);
    render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    fireEvent.click(screen.getByRole('button', { name: /move to in progress/i, hidden: true }));
    expect(mockMoveTask).toHaveBeenCalledWith('task-1', 'right', 'todo');
  });

  it('calls deleteTask when delete clicked', () => {
    const mockDeleteTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ deleteTask: mockDeleteTask } as never);
    render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    fireEvent.click(screen.getByRole('button', { name: /delete task/i, hidden: true }));
    expect(mockDeleteTask).toHaveBeenCalledWith('task-1');
  });

  it('move buttons are disabled when isMutating', () => {
    resetStores({ isMutating: true });
    render(<TaskCard task={BASE_TASK} column="in-progress" {...DRAG_HANDLERS} />);
    expect(screen.getByRole('button', { name: /move to todo/i, hidden: true })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Done state
// ---------------------------------------------------------------------------

describe('TaskCard — done state', () => {
  it('applies opacity-50 and grayscale-[25%] when column is done', () => {
    const { container } = render(
      <TaskCard task={BASE_TASK} column="done" {...DRAG_HANDLERS} />
    );
    const article = container.querySelector('[data-testid="task-card"]');
    expect(article?.className).toContain('opacity-50');
    expect(article?.className).toContain('grayscale-[25%]');
  });

  it('does not apply done styles when column is todo', () => {
    const { container } = render(
      <TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />
    );
    const article = container.querySelector('[data-testid="task-card"]');
    expect(article?.className).not.toContain('opacity-50');
  });
});

// ---------------------------------------------------------------------------
// Card wrapper styles (T-005 acceptance criteria)
// ---------------------------------------------------------------------------

describe('TaskCard — card wrapper styles', () => {
  it('article has relative class for overlay positioning', () => {
    const { container } = render(
      <TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />
    );
    expect(
      container.querySelector('[data-testid="task-card"]')?.className
    ).toContain('relative');
  });

  it('article uses p-4 padding', () => {
    const { container } = render(
      <TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />
    );
    expect(
      container.querySelector('[data-testid="task-card"]')?.className
    ).toContain('p-4');
  });

  it('article has rounded-xl class', () => {
    const { container } = render(
      <TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />
    );
    expect(
      container.querySelector('[data-testid="task-card"]')?.className
    ).toContain('rounded-xl');
  });

  it('drag-over highlight is column-level — card does not get ring-2 (Trend A)', () => {
    // Trend A redesign: drag highlighting moved to column level via dragOverColumn.
    // Individual cards no longer receive ring-2 on drag-over.
    useDragStore.setState({ dragOverColumn: 'todo' });
    const { container } = render(
      <TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />
    );
    expect(
      container.querySelector('[data-testid="task-card"]')?.className
    ).not.toContain('ring-2');
  });
});
