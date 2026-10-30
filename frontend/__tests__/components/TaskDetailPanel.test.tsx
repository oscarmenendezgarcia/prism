/**
 * Unit tests for TaskDetailPanel component.
 * T-006: covers open/close lifecycle, all four field save paths,
 * disabled state during isMutating,
 * keyboard accessibility (Escape), and focus management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TaskDetailPanel } from '../../src/components/board/TaskDetailPanel';
import { useAppStore } from '../../src/stores/useAppStore';
import * as api from '../../src/api/client';
import type { Task } from '../../src/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
  getSpaces:         vi.fn(),
  getTasks:          vi.fn(),
  createTask:        vi.fn(),
  moveTask:          vi.fn(),
  deleteTask:        vi.fn(),
  createSpace:       vi.fn(),
  renameSpace:       vi.fn(),
  deleteSpace:       vi.fn(),
  getAttachmentContent: vi.fn(),
  updateTask:        vi.fn(),
  getTaskHistory:    vi.fn().mockResolvedValue({ history: [] }),
  getAgents:         vi.fn(),
  generatePrompt:    vi.fn(),
  getSettings:       vi.fn().mockResolvedValue({}),
  saveSettings:      vi.fn(),
  createAgentRun:    vi.fn().mockResolvedValue({ id: 'run_mock' }),
  updateAgentRun:    vi.fn().mockResolvedValue({ id: 'run_mock', status: 'completed' }),
  getAgentRuns:      vi.fn().mockResolvedValue({ runs: [], total: 0 }),
  startRun:          vi.fn(),
  getBackendRun:     vi.fn(),
  deleteRun:         vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STATUSES = [
  { id: 'todo', name: 'Todo', category: 'todo' as const },
  { id: 'doing', name: 'In Progress', category: 'in-progress' as const },
  { id: 'done', name: 'Done', category: 'done' as const },
];

const TASK: Task = {
  id: 'task-abc-1234567',
  key: 'WEB-7',
  statusId: 'todo',
  category: 'todo',
  title: 'Build auth flow',
  type: 'feature',
  description: 'Implement JWT-based authentication',
  assigned: 'developer-agent',
  createdAt: '2026-03-09T14:32:00.000Z',
  updatedAt: '2026-03-24T12:00:00.000Z',
};

const TASK_WITH_ATTACHMENTS: Task = {
  ...TASK,
  id: 'task-attach-789',
  attachments: [
    { name: 'ADR-1.md',    type: 'text' },
    { name: 'diagram.png', type: 'file' },
    { name: 'notes.txt',   type: 'text' },
  ],
};


function resetStore(overrides: Partial<ReturnType<typeof useAppStore.getState>> = {}) {
  useAppStore.setState({
    detailTask: null,
    isMutating: false,
    mutatingTaskIds: new Set<string>(),
    tasks: { todo: [TASK, TASK_WITH_ATTACHMENTS], doing: [], done: [] },
    activeSpaceId: 'space-1',
    spaces: [{ id: 'space-1', name: 'Space', statuses: STATUSES, createdAt: '', updatedAt: '' }],
    ...overrides,
  } as any);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState());
  resetStore();
  vi.clearAllMocks();
});

describe('TaskDetailPanel — render state', () => {
  it('renders null when detailTask is null', () => {
    const { container } = render(<TaskDetailPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders panel when detailTask is set', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('pre-populates title input with task title', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByLabelText(/title/i)).toHaveValue(TASK.title);
  });

  it('pre-populates assigned input with task assigned', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByLabelText(/assignee/i)).toHaveValue(TASK.assigned);
  });

  it('pre-populates description textarea with task description', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByLabelText(/description/i)).toHaveValue(TASK.description);
  });

  it('shows the issue key in the header', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByTestId('detail-key')).toHaveTextContent('WEB-7');
  });

  it('shows no key buttons on an issue without a key', () => {
    useAppStore.setState({ detailTask: { ...TASK, key: undefined }, tasks: {} } as any);
    render(<TaskDetailPanel />);
    expect(screen.queryByTestId('detail-key')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();
  });

  it('shows what is on the board over the copy it opened with', () => {
    useAppStore.setState({
      detailTask: TASK,
      tasks: { doing: [{ ...TASK, statusId: 'doing', category: 'in-progress', priority: 'high' }] },
    } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByLabelText(/^status$/i)).toHaveValue('doing');
    expect(screen.getByLabelText(/^priority$/i)).toHaveValue('high');
  });

  it('shows a relative timestamp in the header with created/updated in the tooltip', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    // Timestamp is rendered as a <time> element in the header.
    const timeEl = document.querySelector('time');
    expect(timeEl).not.toBeNull();
    // Tooltip contains the absolute created date.
    expect(timeEl!.getAttribute('title')).toMatch(/created/i);
  });
});

describe('TaskDetailPanel — close actions', () => {
  it('calls closeDetailPanel when close button is clicked', () => {
    const closeDetailPanel = vi.fn();
    useAppStore.setState({ detailTask: TASK, closeDetailPanel } as any);
    render(<TaskDetailPanel />);

    fireEvent.click(screen.getByRole('button', { name: /close issue detail/i }));
    expect(closeDetailPanel).toHaveBeenCalled();
  });

  it('calls closeDetailPanel when backdrop is clicked', () => {
    const closeDetailPanel = vi.fn();
    useAppStore.setState({ detailTask: TASK, closeDetailPanel } as any);
    render(<TaskDetailPanel />);

    // The backdrop is the first child of the portal — aria-hidden div
    const backdrop = document.body.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(closeDetailPanel).toHaveBeenCalled();
  });

  it('calls closeDetailPanel when Escape key is pressed', () => {
    const closeDetailPanel = vi.fn();
    useAppStore.setState({ detailTask: TASK, closeDetailPanel } as any);
    render(<TaskDetailPanel />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeDetailPanel).toHaveBeenCalled();
  });
});

describe('TaskDetailPanel — auto-save on blur: title', () => {
  it('calls store.updateTask with { title } when title input is blurred with a changed value', () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK, updateTask } as any);
    render(<TaskDetailPanel />);

    const titleInput = screen.getByLabelText(/title/i);
    fireEvent.change(titleInput, { target: { value: 'New Title' } });
    fireEvent.blur(titleInput);

    expect(updateTask).toHaveBeenCalledWith(TASK.id, { title: 'New Title' });
  });

  it('does NOT call updateTask when title blur has no change', () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK, updateTask } as any);
    render(<TaskDetailPanel />);

    const titleInput = screen.getByLabelText(/title/i);
    fireEvent.focus(titleInput);
    fireEvent.blur(titleInput);

    expect(updateTask).not.toHaveBeenCalled();
  });

  it('reverts title input to saved value when user clears it and blurs', () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK, updateTask } as any);
    render(<TaskDetailPanel />);

    const titleInput = screen.getByLabelText(/title/i);
    fireEvent.change(titleInput, { target: { value: '' } });
    fireEvent.blur(titleInput);

    expect(updateTask).not.toHaveBeenCalled();
    expect(titleInput).toHaveValue(TASK.title);
  });
});

describe('TaskDetailPanel — auto-save on blur: assigned', () => {
  it('calls store.updateTask with { assigned } when assigned input is blurred with a changed value', () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK, updateTask } as any);
    render(<TaskDetailPanel />);

    const assignedInput = screen.getByLabelText(/assignee/i);
    fireEvent.change(assignedInput, { target: { value: 'senior-architect' } });
    fireEvent.blur(assignedInput);

    expect(updateTask).toHaveBeenCalledWith(TASK.id, { assigned: 'senior-architect' });
  });

  it('sends empty string for assigned when user clears the field', () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK, updateTask } as any);
    render(<TaskDetailPanel />);

    const assignedInput = screen.getByLabelText(/assignee/i);
    fireEvent.change(assignedInput, { target: { value: '' } });
    fireEvent.blur(assignedInput);

    expect(updateTask).toHaveBeenCalledWith(TASK.id, { assigned: '' });
  });
});

describe('TaskDetailPanel — auto-save on change: type', () => {
  it('calls store.updateTask with { type } immediately when another type is chosen', () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK, updateTask } as any);
    render(<TaskDetailPanel />);

    // Task starts as 'feature', choose 'bug' to change it
    fireEvent.change(screen.getByLabelText(/^type$/i), { target: { value: 'bug' } });

    expect(updateTask).toHaveBeenCalledWith(TASK.id, { type: 'bug' });
  });
});

describe('TaskDetailPanel — status', () => {
  it('offers the statuses of the space and shows the current one', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    const select = screen.getByLabelText(/^status$/i);
    expect(select).toHaveValue('todo');
    expect(Array.from(select.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['Todo', 'In Progress', 'Done']);
  });

  it('moves the issue when another is chosen', () => {
    const moveTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK, moveTask } as any);
    render(<TaskDetailPanel />);
    fireEvent.change(screen.getByLabelText(/^status$/i), { target: { value: 'doing' } });
    expect(moveTask).toHaveBeenCalledWith(TASK.id, 'doing');
  });
});

describe('TaskDetailPanel — issue fields', () => {
  function open(detail: Task = TASK, tasks: Record<string, Task[]> = { todo: [detail] }) {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    const openDetailPanel = vi.fn();
    useAppStore.setState({ detailTask: detail, tasks, updateTask, openDetailPanel } as any);
    render(<TaskDetailPanel />);
    return { updateTask, openDetailPanel };
  }

  const EPIC: Task = { ...TASK, id: 'epic-1', key: 'WEB-1', title: 'Checkout', type: 'epic' };

  it('saves the priority, showing medium when it has none', () => {
    const { updateTask } = open();
    const select = screen.getByLabelText(/^priority$/i);
    expect(select).toHaveValue('medium');
    fireEvent.change(select, { target: { value: 'urgent' } });
    expect(updateTask).toHaveBeenCalledWith(TASK.id, { priority: 'urgent' });
  });

  it('puts the issue in an epic and takes it out', () => {
    const inEpic = { ...TASK, parentId: 'epic-1' };
    const { updateTask } = open(inEpic, { todo: [inEpic, EPIC] });
    const select = screen.getByLabelText(/^epic$/i);
    expect(select).toHaveValue('epic-1');
    fireEvent.change(select, { target: { value: '' } });
    expect(updateTask).toHaveBeenCalledWith(TASK.id, { parentId: null });
  });

  it('offers the epics of the board, none other', () => {
    const { updateTask } = open(TASK, { todo: [TASK, EPIC, { ...TASK, id: 'other', title: 'Not an epic' }] });
    const select = screen.getByLabelText(/^epic$/i);
    expect(Array.from(select.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['None', 'Checkout']);
    fireEvent.change(select, { target: { value: 'epic-1' } });
    expect(updateTask).toHaveBeenCalledWith(TASK.id, { parentId: 'epic-1' });
  });

  it('shows the parent of a sub-task instead of an epic, which opens it, and lets it go', () => {
    const parent: Task = { ...TASK, id: 'p1', key: 'WEB-2', title: 'Parent issue' };
    const sub: Task = { ...TASK, id: 's1', key: 'WEB-3', parentId: 'p1' };
    const { updateTask, openDetailPanel } = open(sub, { todo: [parent, sub] });
    expect(screen.queryByLabelText(/^epic$/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('parent-link'));
    expect(openDetailPanel).toHaveBeenCalledWith(parent);
    fireEvent.click(screen.getByRole('button', { name: 'Make it an issue of its own' }));
    expect(updateTask).toHaveBeenCalledWith('s1', { parentId: null });
  });

  it('has neither epic, estimate nor agent on an epic, and does have its issues', () => {
    open(EPIC, { todo: [EPIC] });
    expect(screen.queryByLabelText(/^epic$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/estimate/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('child-issues')).toHaveTextContent('Issues in this epic');
  });

  it('saves labels', () => {
    const { updateTask } = open({ ...TASK, labels: ['ui'] }, { todo: [{ ...TASK, labels: ['ui'] }] });
    const input = screen.getByRole('textbox', { name: 'Add a label' });
    fireEvent.change(input, { target: { value: 'api' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateTask).toHaveBeenCalledWith(TASK.id, { labels: ['ui', 'api'] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove label ui' }));
    expect(updateTask).toHaveBeenCalledWith(TASK.id, { labels: [] });
  });

  it('saves the due date and clears it with null', () => {
    const dated = { ...TASK, dueDate: '2030-01-02' };
    const { updateTask } = open(dated, { todo: [dated] });
    const input = screen.getByLabelText(/due date/i);
    expect(input).toHaveValue('2030-01-02');
    // Typing can make a valid date at each digit, such as year 0002: nothing saves until leaving.
    fireEvent.change(input, { target: { value: '0002-03-11' } });
    fireEvent.change(input, { target: { value: '2030-02-03' } });
    expect(updateTask).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(updateTask).toHaveBeenCalledWith(TASK.id, { dueDate: '2030-02-03' });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(updateTask).toHaveBeenCalledWith(TASK.id, { dueDate: null });
  });

  it('closes, saying so, when the issue is deleted elsewhere', () => {
    open(TASK, { todo: [TASK] });
    act(() => { useAppStore.setState({ tasks: { todo: [] } } as any); });
    expect(useAppStore.getState().detailTask).toBeNull();
    expect(useAppStore.getState().toast?.message).toContain('deleted');
  });

  it('Escape saves the field being edited as it closes', () => {
    const { updateTask } = open(TASK, { todo: [TASK] });
    const input = screen.getByLabelText(/assignee/i) as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'Someone new' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(updateTask).toHaveBeenCalledWith(TASK.id, { assigned: 'Someone new' });
  });

  it('Escape leaves the panel alone when another dialog is on top', () => {
    open(TASK, { todo: [TASK] });
    const other = document.createElement('div');
    other.setAttribute('aria-modal', 'true');
    document.body.appendChild(other);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    other.remove();
    expect(useAppStore.getState().detailTask).not.toBeNull();
  });

  it('measures the description again each time it is opened', () => {
    const long = { ...TASK, description: 'line\n'.repeat(20) };
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, value: 400 });
    open(long, { todo: [long] });
    expect(document.getElementById('detail-description')).toHaveStyle({ height: '400px' });
    act(() => useAppStore.setState({ detailTask: null }));
    act(() => useAppStore.setState({ detailTask: long }));
    expect(document.getElementById('detail-description')).toHaveStyle({ height: '400px' });
    delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>).scrollHeight;
  });

  it('says when it is overdue', () => {
    const late = { ...TASK, dueDate: '2020-01-02' };
    open(late, { todo: [late] });
    expect(screen.getByLabelText(/Due date \(overdue\)/)).toHaveClass('text-error');
    expect(screen.getByLabelText(/Due date \(overdue\)/)).not.toHaveClass('text-text-primary');
  });

  it('does not say overdue when it is done', () => {
    const late = { ...TASK, dueDate: '2020-01-02', category: 'done' as const };
    open(late, { done: [late] });
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
  });

  it('saves the estimate as a number on blur', () => {
    const { updateTask } = open();
    const input = screen.getByLabelText(/estimate/i);
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.blur(input);
    expect(updateTask).toHaveBeenCalledWith(TASK.id, { estimate: 5 });
  });

  it('saves a cleared estimate as null', () => {
    const sized = { ...TASK, estimate: 3 };
    const { updateTask } = open(sized, { todo: [sized] });
    const input = screen.getByLabelText(/estimate/i);
    expect(input).toHaveValue(3);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(updateTask).toHaveBeenCalledWith(TASK.id, { estimate: null });
  });

  it('does not save an estimate that did not change', () => {
    const sized = { ...TASK, estimate: 3 };
    const { updateTask } = open(sized, { todo: [sized] });
    fireEvent.blur(screen.getByLabelText(/estimate/i));
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('reverts a negative estimate', () => {
    const sized = { ...TASK, estimate: 3 };
    const { updateTask } = open(sized, { todo: [sized] });
    const input = screen.getByLabelText(/estimate/i);
    fireEvent.change(input, { target: { value: '-1' } });
    fireEvent.blur(input);
    expect(updateTask).not.toHaveBeenCalled();
    expect(input).toHaveValue(3);
  });
});

describe('TaskDetailPanel — comments and history', () => {
  it('shows the comments first, and the history of the issue on its tab', async () => {
    vi.mocked(api.getTaskHistory).mockResolvedValue({
      history: [{ id: 1, actor: 'user', field: 'created', oldValue: null, newValue: null, createdAt: '2026-01-01T00:00:00.000Z' }],
    });
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByTestId('comments-panel')).toBeInTheDocument();
    expect(api.getTaskHistory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('activity-tab-history'));

    expect(await screen.findByTestId('history-entry')).toHaveTextContent('You created it');
    expect(api.getTaskHistory).toHaveBeenCalledWith('space-1', TASK.id);
    expect(screen.queryByTestId('comments-panel')).not.toBeInTheDocument();
  });

  it('reloads the history when the issue changes on the board', async () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    fireEvent.click(screen.getByTestId('activity-tab-history'));
    await waitFor(() => expect(api.getTaskHistory).toHaveBeenCalledTimes(1));
    act(() => {
      useAppStore.setState({ tasks: { doing: [{ ...TASK, statusId: 'doing', updatedAt: '2026-04-01T00:00:00.000Z' }] } } as any);
    });
    await waitFor(() => expect(api.getTaskHistory).toHaveBeenCalledTimes(2));
  });

  // Fails today: the panel's Escape listener on document (capture) runs first, stops the
  // event and closes the panel, so the field never sees it.
  it('cancels adding a sub-task on Escape without closing the panel', () => {
    const closeDetailPanel = vi.fn();
    useAppStore.setState({ detailTask: TASK, closeDetailPanel } as any);
    render(<TaskDetailPanel />);
    fireEvent.click(screen.getByTestId('add-child-issue'));
    const input = screen.getByRole('textbox', { name: 'New sub-task title' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'New sub-task title' })).not.toBeInTheDocument();
    expect(closeDetailPanel).not.toHaveBeenCalled();
  });
});

describe('TaskDetailPanel — save on blur: description', () => {
  it('does not save a description nobody changed, which could undo an agent\'s edit', () => {
    const updateTask = vi.fn();
    useAppStore.setState({ detailTask: TASK, updateTask } as any);
    render(<TaskDetailPanel />);
    fireEvent.blur(screen.getByLabelText(/description/i));
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('calls store.updateTask with { description } when the description is blurred with a changed value', async () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ detailTask: TASK, updateTask } as any);
    render(<TaskDetailPanel />);

    const textarea = screen.getByLabelText(/description/i);
    // Use fireEvent directly to avoid cross-test focus contamination with userEvent.
    fireEvent.change(textarea, { target: { value: 'Updated description text' } });
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledWith(TASK.id, { description: 'Updated description text' });
    });
  });
});

describe('TaskDetailPanel — disabled state during isMutating', () => {
  it('keeps every field enabled while its own save is in flight, so focus stays where it is', () => {
    useAppStore.setState({ detailTask: TASK, isMutating: true, mutatingTaskIds: new Set([TASK.id]) } as any);
    render(<TaskDetailPanel />);
    for (const label of [/title/i, /assignee/i, /description/i, /^status$/i, /^priority$/i, /^type$/i, /due date/i, /estimate/i, /^epic$/i]) {
      expect(screen.getByLabelText(label)).toBeEnabled();
    }
    expect(screen.getByRole('textbox', { name: 'Add a label' })).toBeEnabled();
  });

  it('leaves the panel editable while ANOTHER task is mutating', () => {
    useAppStore.setState({ detailTask: TASK, isMutating: true, mutatingTaskIds: new Set(['other']) } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByLabelText(/^status$/i)).toBeEnabled();
    expect(screen.getByLabelText(/assignee/i)).toBeEnabled();
  });
});

describe('TaskDetailPanel — key copy', () => {
  it('renders a copy button with aria-label "Copy key WEB-7"', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByRole('button', { name: 'Copy key WEB-7' })).toBeInTheDocument();
  });

  it('calls navigator.clipboard.writeText with the key on copy button click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const showToast = vi.fn();
    useAppStore.setState({ detailTask: TASK, showToast } as any);
    render(<TaskDetailPanel />);

    fireEvent.click(screen.getByRole('button', { name: /copy key/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('WEB-7');
      expect(showToast).toHaveBeenCalledWith('WEB-7 copied to clipboard', 'success');
    });
  });

  it('copies a link that opens the issue by its key', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const showToast = vi.fn();
    useAppStore.setState({ detailTask: TASK, showToast } as any);
    render(<TaskDetailPanel />);

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${window.location.pathname}?issue=WEB-7`);
      expect(showToast).toHaveBeenCalledWith('Link copied to clipboard', 'success');
    });
  });

  it('calls showToast with error when clipboard.writeText throws', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });

    const showToast = vi.fn();
    useAppStore.setState({ detailTask: TASK, showToast } as any);
    render(<TaskDetailPanel />);

    fireEvent.click(screen.getByRole('button', { name: /copy key/i }));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('Failed to copy', 'error');
    });
  });
});

describe('TaskDetailPanel — ARIA accessibility', () => {
  it('has role="dialog" and aria-modal="true"', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('has aria-label="Issue detail"', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Issue detail');
  });

  it('close button has aria-label="Close issue detail"', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByRole('button', { name: /close issue detail/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// BUG FIX: Attachments section — all attachments must render in the panel
// ---------------------------------------------------------------------------

describe('TaskDetailPanel — attachments section', () => {
  it('does not render the attachments section when task has no attachments', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    const { container } = render(<TaskDetailPanel />);
    expect(container.querySelector('[data-testid="attachments-section"]')).not.toBeInTheDocument();
  });

  it('does not render the attachments section when attachments is an empty array', () => {
    useAppStore.setState({ detailTask: { ...TASK, attachments: [] } } as any);
    const { container } = render(<TaskDetailPanel />);
    expect(container.querySelector('[data-testid="attachments-section"]')).not.toBeInTheDocument();
  });

  it('renders the attachments section when task has attachments', () => {
    useAppStore.setState({ detailTask: TASK_WITH_ATTACHMENTS } as any);
    const { container } = render(<TaskDetailPanel />);
    expect(container.querySelector('[data-testid="attachments-section"]')).toBeInTheDocument();
  });

  it('renders one row per attachment — all 3 attachments are visible', () => {
    useAppStore.setState({ detailTask: TASK_WITH_ATTACHMENTS } as any);
    const { container } = render(<TaskDetailPanel />);
    const rows = container.querySelectorAll('[data-testid="attachment-row"]');
    expect(rows).toHaveLength(3);
  });

  it('each attachment row shows the correct filename', () => {
    useAppStore.setState({ detailTask: TASK_WITH_ATTACHMENTS } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByText('ADR-1.md')).toBeInTheDocument();
    expect(screen.getByText('diagram.png')).toBeInTheDocument();
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
  });

  it('clicking a .md attachment (ADR-1.md) opens MarkdownModal directly — skips AttachmentModal', async () => {
    // .md attachments bypass AttachmentModal and open the reader directly.
    const openMarkdownModal = vi.fn();
    const openAttachmentModal = vi.fn();
    vi.mocked(api.getAttachmentContent).mockResolvedValue({
      name: 'ADR-1.md',
      type: 'text',
      content: '# ADR-1\n\nContent here.',
    });
    useAppStore.setState({
      detailTask: TASK_WITH_ATTACHMENTS,
      activeSpaceId: 'space-1',
      openMarkdownModal,
      openAttachmentModal,
    } as any);
    const { container } = render(<TaskDetailPanel />);

    const rows = container.querySelectorAll('[data-testid="attachment-row"]');
    fireEvent.click(rows[0]);

    // openMarkdownModal is called after fetch resolves
    await waitFor(() => {
      expect(openMarkdownModal).toHaveBeenCalledWith(
        'ADR-1.md', '# ADR-1\n\nContent here.', undefined,
      );
    });
    // openAttachmentModal should NOT have been called for .md
    expect(openAttachmentModal).not.toHaveBeenCalled();
  });

  it('clicking the second attachment row calls openAttachmentModal with index 1 and full list', () => {
    const openAttachmentModal = vi.fn();
    useAppStore.setState({
      detailTask: TASK_WITH_ATTACHMENTS,
      activeSpaceId: 'space-1',
      openAttachmentModal,
    } as any);
    const { container } = render(<TaskDetailPanel />);

    const rows = container.querySelectorAll('[data-testid="attachment-row"]');
    fireEvent.click(rows[1]);

    expect(openAttachmentModal).toHaveBeenCalledWith(
      'space-1', TASK_WITH_ATTACHMENTS.id, 1, 'diagram.png', TASK_WITH_ATTACHMENTS.attachments,
    );
  });

  it('clicking the third attachment row calls openAttachmentModal with index 2 and full list', () => {
    const openAttachmentModal = vi.fn();
    useAppStore.setState({
      detailTask: TASK_WITH_ATTACHMENTS,
      activeSpaceId: 'space-1',
      openAttachmentModal,
    } as any);
    const { container } = render(<TaskDetailPanel />);

    const rows = container.querySelectorAll('[data-testid="attachment-row"]');
    fireEvent.click(rows[2]);

    expect(openAttachmentModal).toHaveBeenCalledWith(
      'space-1', TASK_WITH_ATTACHMENTS.id, 2, 'notes.txt', TASK_WITH_ATTACHMENTS.attachments,
    );
  });

  it('each attachment row has an accessible aria-label with the filename', () => {
    useAppStore.setState({ detailTask: TASK_WITH_ATTACHMENTS } as any);
    render(<TaskDetailPanel />);

    expect(screen.getByRole('button', { name: 'Open attachment ADR-1.md' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open attachment diagram.png' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open attachment notes.txt' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Layout: centered modal (all viewports)
// ---------------------------------------------------------------------------

describe('TaskDetailPanel — centered modal layout', () => {
  it('renders a centered modal with animate-modal-dialog-in entrance', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    const { container } = render(<TaskDetailPanel />);

    // animate-modal-dialog-in is on the outer bezel wrapper (parent of the dialog)
    const bezel = container.querySelector('.animate-modal-dialog-in');
    expect(bezel).toBeInTheDocument();
    // Slide-over animation is NOT used anywhere
    expect(container.querySelector('.animate-slide-in-right')).toBeNull();
  });

  it('renders the comments panel in the modal layout', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    const { container } = render(<TaskDetailPanel />);

    expect(container.querySelector('[data-testid="comments-panel"]')).toBeInTheDocument();
  });

  it('dialog has correct ARIA attributes', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Issue detail');
  });

  it('renders all editable fields inside the modal', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);

    expect(screen.getByLabelText(/title/i)).toHaveValue(TASK.title);
    expect(screen.getByLabelText(/assignee/i)).toHaveValue(TASK.assigned);
    expect(screen.getByLabelText(/description/i)).toHaveValue(TASK.description);
  });

  it('renders the comments panel (two-column layout)', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    const { container } = render(<TaskDetailPanel />);

    expect(container.querySelector('[data-testid="comments-panel"]')).toBeInTheDocument();
    // Slide-over specific aria-labels are not present
    expect(document.body.querySelector('[aria-label="Task fields"]')).toBeNull();
  });

  it('close button calls closeDetailPanel', () => {
    const closeDetailPanel = vi.fn();
    useAppStore.setState({ detailTask: TASK, closeDetailPanel } as any);
    render(<TaskDetailPanel />);

    fireEvent.click(screen.getByRole('button', { name: /close issue detail/i }));
    expect(closeDetailPanel).toHaveBeenCalled();
  });

  it('backdrop click calls closeDetailPanel', () => {
    const closeDetailPanel = vi.fn();
    useAppStore.setState({ detailTask: TASK, closeDetailPanel } as any);
    render(<TaskDetailPanel />);

    const backdrop = document.body.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(closeDetailPanel).toHaveBeenCalled();
  });

  it('Escape key closes the modal', () => {
    const closeDetailPanel = vi.fn();
    useAppStore.setState({ detailTask: TASK, closeDetailPanel } as any);
    render(<TaskDetailPanel />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeDetailPanel).toHaveBeenCalled();
  });

  it('BUG-003: Escape key does NOT close panel when MarkdownModal is open', () => {
    // Simulate an open MarkdownModal by injecting its title element into the DOM.
    // TaskDetailPanel's Escape guard queries [id="markdown-modal-title"].
    const titleEl = document.createElement('h2');
    titleEl.id = 'markdown-modal-title';
    document.body.appendChild(titleEl);

    const closeDetailPanel = vi.fn();
    useAppStore.setState({ detailTask: TASK, closeDetailPanel } as any);
    render(<TaskDetailPanel />);

    fireEvent.keyDown(document, { key: 'Escape' });
    // Panel must NOT close — the modal's Escape handler should run instead.
    expect(closeDetailPanel).not.toHaveBeenCalled();

    // Cleanup injected element
    document.body.removeChild(titleEl);
  });

  it('BUG-003: Escape key does NOT close panel when AttachmentModal is open', () => {
    const titleEl = document.createElement('h2');
    titleEl.id = 'attachment-modal-title';
    document.body.appendChild(titleEl);

    const closeDetailPanel = vi.fn();
    useAppStore.setState({ detailTask: TASK, closeDetailPanel } as any);
    render(<TaskDetailPanel />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeDetailPanel).not.toHaveBeenCalled();

    document.body.removeChild(titleEl);
  });

  it('renders null when detailTask is null', () => {
    useAppStore.setState({ detailTask: null } as any);
    const { container } = render(<TaskDetailPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the issue key in the modal header', () => {
    useAppStore.setState({ detailTask: TASK } as any);
    render(<TaskDetailPanel />);
    expect(screen.getByRole('dialog')).toHaveTextContent('WEB-7');
  });

});
