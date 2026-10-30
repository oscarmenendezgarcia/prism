import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChildIssues } from '../../src/components/board/ChildIssues';
import { useAppStore } from '../../src/stores/useAppStore';
import * as api from '../../src/api/client';
import type { Task } from '../../src/types';

vi.mock('../../src/api/client', () => ({ createTask: vi.fn(), getTasks: vi.fn() }));

const task = (id: string, over: Partial<Task> = {}): Task => (
  { id, key: id.toUpperCase(), title: `Title ${id}`, type: 'feature', createdAt: '', updatedAt: '', ...over }
);

const EPIC = task('epic', { type: 'epic' });
const ISSUE = task('issue', { parentId: 'epic', number: 2, statusId: 'doing', category: 'in-progress' });
const FIRST = task('first', { parentId: 'epic', number: 1, statusId: 'done', category: 'done' });
const SUB_DONE = task('sd', { parentId: 'issue', number: 3, statusId: 'done', category: 'done' });
const SUB_OPEN = task('so', { parentId: 'issue', number: 4, statusId: 'todo', category: 'todo' });
const BOARD = { todo: [EPIC, SUB_OPEN], doing: [ISSUE], done: [FIRST, SUB_DONE] };

const STATUSES = [
  { id: 'todo', name: 'Todo', category: 'todo' as const },
  { id: 'doing', name: 'Doing', category: 'in-progress' as const },
  { id: 'done', name: 'Done', category: 'done' as const },
];

let openDetailPanel: ReturnType<typeof vi.fn>;
let showToast: ReturnType<typeof vi.fn>;
let loadBoard: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  openDetailPanel = vi.fn();
  showToast = vi.fn();
  loadBoard = vi.fn().mockResolvedValue(undefined);
  vi.mocked(api.createTask).mockResolvedValue(task('new'));
  useAppStore.setState({
    tasks: BOARD,
    spaces: [{ id: 's1', name: 'S', statuses: STATUSES, createdAt: '', updatedAt: '' }],
    openDetailPanel, showToast, loadBoard,
  } as never);
});

function addChild(title: string) {
  fireEvent.click(screen.getByTestId('add-child-issue'));
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: title } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('ChildIssues — listing', () => {
  it('lists the issues of an epic, in the order of their number, not its grandchildren', () => {
    render(<ChildIssues task={EPIC} spaceId="s1" />);
    expect(screen.getAllByTestId('child-issue').map((c) => c.textContent)).toEqual(['FIRSTTitle first', 'ISSUETitle issue']);
  });

  it('heads an epic with what is done, with a progress bar', () => {
    render(<ChildIssues task={EPIC} spaceId="s1" />);
    expect(screen.getByText('Issues in this epic · 1 of 2 done')).toBeInTheDocument();
    const progress = screen.getByRole('progressbar', { name: 'Issues done' });
    expect(progress).toHaveAttribute('max', '2');
    expect(progress).toHaveAttribute('value', '1');
  });

  it('lists the sub-tasks of an issue, without a progress bar', () => {
    render(<ChildIssues task={ISSUE} spaceId="s1" />);
    expect(screen.getAllByTestId('child-issue').map((c) => c.textContent)).toEqual(['SDTitle sd', 'SOTitle so']);
    expect(screen.getByText('Sub-tasks · 1 of 2')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('heads an issue with no sub-tasks without a count', () => {
    const lone = task('lone');
    render(<ChildIssues task={lone} spaceId="s1" />);
    expect(screen.getByText('Sub-tasks')).toBeInTheDocument();
    expect(screen.queryAllByTestId('child-issue')).toHaveLength(0);
  });

  it('shows the status of each child, and strikes out the done ones', () => {
    render(<ChildIssues task={ISSUE} spaceId="s1" />);
    expect(screen.getByLabelText('Done')).toBeInTheDocument();
    expect(screen.getByLabelText('Todo')).toBeInTheDocument();
    expect(screen.getByText('Title sd')).toHaveClass('line-through');
    expect(screen.getByText('Title so')).not.toHaveClass('line-through');
  });

  it('opens a child when clicked', () => {
    render(<ChildIssues task={ISSUE} spaceId="s1" />);
    fireEvent.click(screen.getByText('Title so'));
    expect(openDetailPanel).toHaveBeenCalledWith(SUB_OPEN);
  });

  it('renders nothing for a sub-task, which cannot have sub-tasks', () => {
    const { container } = render(<ChildIssues task={SUB_OPEN} spaceId="s1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('does render for an issue directly in an epic', () => {
    render(<ChildIssues task={ISSUE} spaceId="s1" />);
    expect(screen.getByTestId('child-issues')).toBeInTheDocument();
  });
});

describe('ChildIssues — adding', () => {
  it('adds a feature under an epic', async () => {
    render(<ChildIssues task={EPIC} spaceId="s1" />);
    addChild('  New issue  ');
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith('s1', { title: 'New issue', type: 'feature', parentId: 'epic' }));
    await waitFor(() => expect(loadBoard).toHaveBeenCalled());
  });

  it('adds a chore as a sub-task of an issue', async () => {
    render(<ChildIssues task={ISSUE} spaceId="s1" />);
    addChild('New sub-task');
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith('s1', { title: 'New sub-task', type: 'chore', parentId: 'issue' }));
  });

  it('words the button for what it adds', () => {
    const { unmount } = render(<ChildIssues task={EPIC} spaceId="s1" />);
    expect(screen.getByTestId('add-child-issue')).toHaveTextContent('Add issue');
    unmount();
    render(<ChildIssues task={ISSUE} spaceId="s1" />);
    expect(screen.getByTestId('add-child-issue')).toHaveTextContent('Add sub-task');
  });

  it('empties the field after adding, ready for the next', async () => {
    render(<ChildIssues task={ISSUE} spaceId="s1" />);
    addChild('One');
    await waitFor(() => expect(loadBoard).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
    expect(screen.getByRole('textbox')).toBeEnabled();
  });

  it('adds nothing with a blank title', () => {
    render(<ChildIssues task={ISSUE} spaceId="s1" />);
    addChild('   ');
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('closes the field on Escape without adding', () => {
    render(<ChildIssues task={ISSUE} spaceId="s1" />);
    fireEvent.click(screen.getByTestId('add-child-issue'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Never mind' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('add-child-issue')).toBeInTheDocument();
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('closes an empty field on blur, and keeps one with text', () => {
    render(<ChildIssues task={ISSUE} spaceId="s1" />);
    fireEvent.click(screen.getByTestId('add-child-issue'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep me' } });
    fireEvent.blur(screen.getByRole('textbox'));
    expect(screen.getByRole('textbox')).toHaveValue('Keep me');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    fireEvent.blur(screen.getByRole('textbox'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows why it failed and keeps what was typed', async () => {
    vi.mocked(api.createTask).mockRejectedValue(new Error('Refused'));
    render(<ChildIssues task={ISSUE} spaceId="s1" />);
    addChild('Keep me');
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Refused', 'error'));
    expect(screen.getByRole('textbox')).toHaveValue('Keep me');
    expect(loadBoard).not.toHaveBeenCalled();
  });
});
