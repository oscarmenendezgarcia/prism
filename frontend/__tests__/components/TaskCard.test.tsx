/**
 * Unit tests for the redesigned TaskCard component.
 * T-007: Verifies three-zone layout, conditional rendering, active run,
 *        more_vert button, hover overlay presence, and absence of old elements.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskCard } from '../../src/components/board/TaskCard';
import { useAppStore } from '../../src/stores/useAppStore';
import { useTaskRunStore } from '../../src/stores/useTaskRunStore';
import { useDragStore } from '../../src/stores/useDragStore';
import type { Task } from '../../src/types';

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

const STATUSES = [
  { id: 'todo', name: 'Todo', category: 'todo' as const },
  { id: 'in-progress', name: 'In Progress', category: 'in-progress' as const },
  { id: 'done', name: 'Done', category: 'done' as const },
];

const SPACE = { id: 'space-1', name: 'Test Space', statuses: STATUSES, createdAt: '', updatedAt: '' };

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

function setRunStatus(taskId: string, status: string) {
  useTaskRunStore.setState({
    views: { [taskId]: { runId: 'r1', taskId, status, cliTool: 'claude', model: null, iteration: 1, createdAt: '', updatedAt: '', closedAt: null, result: null, hook: null, failure: null } },
  } as never);
}

function resetStores(overrides: Record<string, unknown> = {}) {
  useAppStore.setState({
    activeSpaceId: 'space-1',
    spaces: [SPACE],
    isMutating: false,
    mutatingTaskIds: new Set<string>(),
    tasks: { todo: [], 'in-progress': [], done: [] },
    ...overrides,
  });
  useTaskRunStore.setState({ views: {} });
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
    expect(screen.getByTestId('type-badge')).toHaveTextContent('Feature');
  });

  it('renders a bug badge when type is bug', () => {
    render(
      <TaskCard task={{ ...BASE_TASK, type: 'bug' }} column="todo" {...DRAG_HANDLERS} />
    );
    expect(screen.getByTestId('type-badge')).toHaveTextContent('Bug');
  });

  it('renders a tech-debt badge when type is tech-debt', () => {
    render(
      <TaskCard task={{ ...BASE_TASK, type: 'tech-debt' }} column="todo" {...DRAG_HANDLERS} />
    );
    expect(screen.getByTestId('type-badge')).toHaveTextContent('Tech debt');
  });

  it('renders a chore badge when type is chore', () => {
    render(
      <TaskCard task={{ ...BASE_TASK, type: 'chore' }} column="todo" {...DRAG_HANDLERS} />
    );
    expect(screen.getByTestId('type-badge')).toHaveTextContent('Chore');
  });

  it('renders an epic badge when type is epic', () => {
    render(
      <TaskCard task={{ ...BASE_TASK, type: 'epic' }} column="todo" {...DRAG_HANDLERS} />
    );
    expect(screen.getByTestId('type-badge')).toHaveTextContent('Epic');
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
    expect(screen.queryByLabelText(/open (task|issue) detail/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Zone A — active run indicator
// ---------------------------------------------------------------------------

describe('TaskCard — active run', () => {
  it('applies animate-glow-pulse while the agent works on this task', () => {
    setRunStatus('task-1', 'working');
    const { container } = render(<TaskCard task={BASE_TASK} column="in-progress" {...DRAG_HANDLERS} />);
    expect(
      container.querySelector('[data-testid="task-card"]')?.className
    ).toContain('animate-glow-pulse');
  });

  it('applies border-primary/30 while its check runs', () => {
    setRunStatus('task-1', 'checking');
    const { container } = render(<TaskCard task={BASE_TASK} column="in-progress" {...DRAG_HANDLERS} />);
    expect(
      container.querySelector('[data-testid="task-card"]')?.className
    ).toContain('border-primary/30');
  });

  it('does not glow when a different task is running', () => {
    setRunStatus('other-task', 'working');
    const { container } = render(<TaskCard task={BASE_TASK} column="in-progress" {...DRAG_HANDLERS} />);
    expect(
      container.querySelector('[data-testid="task-card"]')?.className
    ).not.toContain('animate-glow-pulse');
  });

  it('does not glow once the run ended', () => {
    setRunStatus('task-1', 'done');
    const { container } = render(<TaskCard task={BASE_TASK} column="done" {...DRAG_HANDLERS} />);
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
    expect(screen.getByTestId('unassigned-label')).toHaveTextContent('Unassigned');
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
// Epic, parent, labels, progress and due date
// ---------------------------------------------------------------------------

describe('TaskCard — issue tags', () => {
  const issue = (over: Partial<Task>): Task => ({ ...BASE_TASK, ...over });
  const EPIC = issue({ id: 'epic-1', key: 'WEB-1', title: 'Checkout epic', type: 'epic' });

  it('shows the key and the priority', () => {
    render(<TaskCard task={issue({ key: 'WEB-142', priority: 'urgent' })} column="todo" />);
    expect(screen.getByTestId('issue-key')).toHaveTextContent('WEB-142');
    expect(screen.getByTestId('priority-icon')).toHaveAttribute('aria-label', 'Urgent priority');
    expect(screen.getByTestId('priority-icon')).toHaveTextContent('keyboard_double_arrow_up');
  });

  it('counts an issue without a priority as medium', () => {
    render(<TaskCard task={BASE_TASK} column="todo" />);
    expect(screen.getByTestId('priority-icon')).toHaveAttribute('aria-label', 'Medium priority');
  });

  it('has no tags at all when the issue has none of them', () => {
    render(<TaskCard task={BASE_TASK} column="todo" />);
    expect(screen.queryByTestId('issue-tags')).not.toBeInTheDocument();
  });

  it('shows the epic of an issue in one', () => {
    const task = issue({ parentId: 'epic-1', epic: { id: 'epic-1', title: 'Checkout epic' }, parentKey: null });
    render(<TaskCard task={task} column="todo" />);
    expect(screen.getByTestId('epic-tag')).toHaveTextContent('Checkout epic');
    expect(screen.queryByTestId('parent-tag')).not.toBeInTheDocument();
  });

  it('shows the same epic tag in any status', () => {
    const task = issue({ parentId: 'epic-1', category: 'done', epic: { id: 'epic-1', title: 'Checkout epic' } });
    render(<TaskCard task={task} column="done" />);
    expect(screen.getByTestId('epic-tag')).toHaveTextContent('Checkout epic');
  });

  it('shows the parent and the epic of a sub-task', () => {
    const task = issue({ parentId: 'parent-1', parentKey: 'WEB-2', epic: { id: 'epic-1', title: 'Checkout epic' } });
    render(<TaskCard task={task} column="todo" />);
    expect(screen.getByTestId('parent-tag')).toHaveTextContent('WEB-2');
    expect(screen.getByTestId('epic-tag')).toHaveTextContent('Checkout epic');
  });

  it('shows no epic tag on the epic itself', () => {
    render(<TaskCard task={{ ...EPIC, epic: null }} column="todo" />);
    expect(screen.queryByTestId('epic-tag')).not.toBeInTheDocument();
  });

  it('counts its open questions from what the server says, having no comments', () => {
    render(<TaskCard task={issue({ pendingQuestions: 3 })} column="todo" />);
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it('shows the labels', () => {
    render(<TaskCard task={issue({ labels: ['ui', 'urgent-fix'] })} column="todo" />);
    const tags = screen.getByTestId('issue-tags');
    expect(tags).toHaveTextContent('ui');
    expect(tags).toHaveTextContent('urgent-fix');
  });

  it('shows the progress of an epic, and no Run on it', () => {
    render(<TaskCard task={{ ...EPIC, category: 'todo', progress: { done: 1, total: 2 } }} column="todo" />);
    expect(screen.getByTestId('epic-progress')).toHaveTextContent('50% · 1 of 2 done');
    expect(screen.queryByTestId('subtask-count')).not.toBeInTheDocument();
    expect(screen.queryByTestId('run-footer')).not.toBeInTheDocument();
  });

  it('counts the sub-tasks of an issue', () => {
    render(<TaskCard task={{ ...BASE_TASK, progress: { done: 1, total: 2 } }} column="todo" />);
    expect(screen.getByTestId('subtask-count')).toHaveTextContent('1/2');
    expect(screen.queryByTestId('epic-progress')).not.toBeInTheDocument();
  });

  it('marks a due date in the past as overdue', () => {
    render(<TaskCard task={issue({ dueDate: '2020-03-04', category: 'todo' })} column="todo" />);
    const due = screen.getByTestId('due-date');
    expect(due).toHaveTextContent('Mar 4, 2020');
    expect(due).toHaveClass('text-error');
    expect(due).toHaveAttribute('title', 'Overdue');
  });

  it('does not mark a due date in the past as overdue once the issue is done', () => {
    render(<TaskCard task={issue({ dueDate: '2020-03-04', category: 'done' })} column="done" />);
    expect(screen.getByTestId('due-date')).not.toHaveClass('text-error');
  });

  it('has no due date when none is set', () => {
    render(<TaskCard task={BASE_TASK} column="todo" />);
    expect(screen.queryByTestId('due-date')).not.toBeInTheDocument();
  });

  it('offers Run according to the category of the status, not its id', () => {
    resetStores({ spaces: [{ ...SPACE, workingDirectory: '/repo', hooks: { checkCommand: null, autoPr: false, agents: { claude: { enabled: true } } } }] });
    const { unmount } = render(<TaskCard task={issue({ category: 'todo', assigned: 'claude' })} column="backlog" />);
    expect(screen.getByRole('button', { name: /^.*run$/i })).toBeInTheDocument();
    unmount();
    render(<TaskCard task={issue({ category: 'done', assigned: 'claude' })} column="todo" />);
    expect(screen.queryByRole('button', { name: /^.*run$/i })).not.toBeInTheDocument();
  });

  it('an issue assigned to a person cannot run, and an agent reads by its name', () => {
    resetStores({ spaces: [{ ...SPACE, workingDirectory: '/repo', hooks: { checkCommand: null, autoPr: false, agents: { claude: { enabled: true } } } }] });
    const { unmount } = render(<TaskCard task={issue({ category: 'todo', assigned: 'Ana López' })} column="todo" />);
    expect(screen.queryByRole('button', { name: /^.*run$/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('avatar')).toBeInTheDocument();
    unmount();
    render(<TaskCard task={issue({ category: 'todo', assigned: 'claude' })} column="todo" />);
    expect(screen.getByTestId('agent-avatar')).toBeInTheDocument();
    expect(screen.getByTestId('assigned-name')).toHaveTextContent('Claude Code');
  });

  it('shows the description as plain text, in two lines at most', () => {
    render(<TaskCard task={{ ...BASE_TASK, description: '## Goal\n\nThe **login** must work' }} column="todo" />);
    const preview = screen.getByTestId('desc-preview');
    expect(preview).toHaveTextContent('Goal · The login must work');
    expect(preview.className).toContain('line-clamp-2');
  });

  it('shows the description of an epic too', () => {
    render(<TaskCard task={issue({ type: 'epic', description: 'Everything about paying' })} column="todo" />);
    expect(screen.getByTestId('desc-preview')).toHaveTextContent('Everything about paying');
  });

  it.each([undefined, '', '   \n ', '---'])('shows no description row for %j', (description) => {
    render(<TaskCard task={{ ...BASE_TASK, description }} column="todo" />);
    expect(screen.queryByTestId('desc-preview')).not.toBeInTheDocument();
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
  it('move-left absent on the first status', () => {
    render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    expect(screen.getAllByRole('button', { name: /^move to /i, hidden: true }).map((b) => b.getAttribute('aria-label'))).toEqual(['Move to In Progress']);
  });

  it('move-right absent on the last status', () => {
    render(<TaskCard task={BASE_TASK} column="done" {...DRAG_HANDLERS} />);
    expect(screen.getAllByRole('button', { name: /^move to /i, hidden: true }).map((b) => b.getAttribute('aria-label'))).toEqual(['Move to In Progress']);
  });

  it('moves between the statuses next to it, whatever they are', () => {
    const moveTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      moveTask,
      spaces: [{ ...SPACE, statuses: [...STATUSES.slice(0, 2), { id: 'rev', name: 'In review', category: 'in-progress' as const }, STATUSES[2]] }],
    } as never);
    render(<TaskCard task={BASE_TASK} column="rev" {...DRAG_HANDLERS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move to In Progress', hidden: true }));
    expect(moveTask).toHaveBeenCalledWith('task-1', 'in-progress');
    fireEvent.click(screen.getByRole('button', { name: 'Move to Done', hidden: true }));
    expect(moveTask).toHaveBeenCalledWith('task-1', 'done');
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
    expect(mockMoveTask).toHaveBeenCalledWith('task-1', 'in-progress');
  });

  it('calls deleteTask when delete clicked', () => {
    const mockDeleteTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ deleteTask: mockDeleteTask } as never);
    render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    fireEvent.click(screen.getByRole('button', { name: /delete issue/i, hidden: true }));
    expect(mockDeleteTask).toHaveBeenCalledWith('task-1');
  });

  it('move buttons are disabled when this task is mutating', () => {
    // Per-task scoping: only the card whose id is in mutatingTaskIds is disabled.
    resetStores({ isMutating: true, mutatingTaskIds: new Set([BASE_TASK.id]) });
    render(<TaskCard task={BASE_TASK} column="in-progress" {...DRAG_HANDLERS} />);
    expect(screen.getByRole('button', { name: /move to todo/i, hidden: true })).toBeDisabled();
  });

  it('move buttons stay enabled when a DIFFERENT task is mutating', () => {
    // The old global-isMutating behavior would disable every card. Verify the
    // fix: mutation on 'other-task' must not disable BASE_TASK's move button.
    resetStores({ isMutating: true, mutatingTaskIds: new Set(['other-task']) });
    render(<TaskCard task={BASE_TASK} column="in-progress" {...DRAG_HANDLERS} />);
    expect(screen.getByRole('button', { name: /move to todo/i, hidden: true })).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Done state
// ---------------------------------------------------------------------------

describe('TaskCard — done state', () => {
  it('applies opacity-60 and grayscale-[25%] when its status is in the done category', () => {
    const { container } = render(
      <TaskCard task={{ ...BASE_TASK, category: 'done' }} column="shipped" {...DRAG_HANDLERS} />
    );
    const article = container.querySelector('[data-testid="task-card"]');
    expect(article?.className).toContain('opacity-60');
    expect(article?.className).toContain('grayscale-[25%]');
  });

  it('does not apply done styles when its status is in another category', () => {
    const { container } = render(
      <TaskCard task={{ ...BASE_TASK, category: 'in-progress' }} column="done" {...DRAG_HANDLERS} />
    );
    const article = container.querySelector('[data-testid="task-card"]');
    expect(article?.className).not.toContain('opacity-60');
    expect(article?.className).not.toContain('grayscale-[25%]');
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

  it('article uses p-3 padding', () => {
    const { container } = render(
      <TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />
    );
    expect(
      container.querySelector('[data-testid="task-card"]')?.className
    ).toContain('p-3');
  });

  it('article has rounded-xl class', () => {
    const { container } = render(
      <TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />
    );
    expect(
      container.querySelector('[data-testid="task-card"]')?.className
    ).toContain('rounded-xl');
  });

  it('drag-handle has no coarse-pointer visibility class (ADR-1 touch-reorder)', () => {
    // The [@media(pointer:coarse)]:opacity-30 class implied touch drag support
    // that does not exist and was removed by ADR-1. On coarse pointers the
    // handle stays fully hidden; users get the ↑ / ↓ buttons instead.
    const { container } = render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    const handle = container.querySelector('[data-testid="drag-handle"]');
    expect(handle).toBeInTheDocument();
    expect(handle?.className).not.toContain('[@media(pointer:coarse)]:opacity-30');
    expect(handle?.className).toContain('opacity-0');
    // Handle is aria-hidden and non-interactive (no button, no onclick handler).
    expect(handle).toHaveAttribute('aria-hidden', 'true');
    expect(handle?.tagName).not.toBe('BUTTON');
  });

  it('renders ↑ / ↓ buttons when onKeyboardReorder is wired', () => {
    render(
      <TaskCard
        task={BASE_TASK}
        column="todo"
        {...DRAG_HANDLERS}
        onKeyboardReorder={vi.fn()}
        isFirstInList={false}
        isLastInList={false}
      />
    );
    expect(screen.getByRole('button', { name: /^move up$/i, hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^move down$/i, hidden: true })).toBeInTheDocument();
  });

  it('does not render ↑ / ↓ when onKeyboardReorder is undefined', () => {
    render(<TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />);
    expect(screen.queryByRole('button', { name: /^move up$/i, hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^move down$/i, hidden: true })).not.toBeInTheDocument();
  });

  it('↑ button calls onKeyboardReorder with direction=up', () => {
    const onKeyboardReorder = vi.fn();
    render(
      <TaskCard
        task={BASE_TASK}
        column="in-progress"
        {...DRAG_HANDLERS}
        onKeyboardReorder={onKeyboardReorder}
        isFirstInList={false}
        isLastInList={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^move up$/i, hidden: true }));
    expect(onKeyboardReorder).toHaveBeenCalledWith('task-1', 'in-progress', 'up');
  });

  it('↓ button calls onKeyboardReorder with direction=down', () => {
    const onKeyboardReorder = vi.fn();
    render(
      <TaskCard
        task={BASE_TASK}
        column="in-progress"
        {...DRAG_HANDLERS}
        onKeyboardReorder={onKeyboardReorder}
        isFirstInList={false}
        isLastInList={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^move down$/i, hidden: true }));
    expect(onKeyboardReorder).toHaveBeenCalledWith('task-1', 'in-progress', 'down');
  });

  it('↑ is disabled when isFirstInList=true', () => {
    render(
      <TaskCard
        task={BASE_TASK}
        column="todo"
        {...DRAG_HANDLERS}
        onKeyboardReorder={vi.fn()}
        isFirstInList
        isLastInList={false}
      />
    );
    expect(screen.getByRole('button', { name: /^move up$/i, hidden: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^move down$/i, hidden: true })).not.toBeDisabled();
  });

  it('↓ is disabled when isLastInList=true', () => {
    render(
      <TaskCard
        task={BASE_TASK}
        column="todo"
        {...DRAG_HANDLERS}
        onKeyboardReorder={vi.fn()}
        isFirstInList={false}
        isLastInList
      />
    );
    expect(screen.getByRole('button', { name: /^move down$/i, hidden: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^move up$/i, hidden: true })).not.toBeDisabled();
  });

  it('drag-over highlight is column-level — card does not get ring-2 (Trend A)', () => {
    // Trend A redesign: drag highlighting moved to column level via dragOverColumn.
    // Individual cards no longer receive ring-2 on drag-over.
    useDragStore.setState({ dragOverColumn: 'todo' });
    const { container } = render(
      <TaskCard task={BASE_TASK} column="todo" {...DRAG_HANDLERS} />
    );
    // Exclude the always-present `focus-visible:ring-2` (keyboard focus
     // indicator added by ADR-1 keyboard-card-reorder) — the invariant is
     // that no *unconditional* ring-2 fires on drag-over.
     const cls = container.querySelector('[data-testid="task-card"]')?.className ?? '';
     const dragOverRing = cls
       .split(/\s+/)
       .some((c) => c === 'ring-2' || (c.endsWith(':ring-2') && !c.startsWith('focus-visible:')));
     expect(dragOverRing).toBe(false);
  });
});
