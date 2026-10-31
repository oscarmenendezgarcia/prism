import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChildIssues } from '../../src/components/board/ChildIssues';
import { useAppStore } from '../../src/stores/useAppStore';
import * as api from '../../src/api/client';
import type { Task } from '../../src/types';

vi.mock('../../src/api/client', () => ({ createTask: vi.fn(), getChildren: vi.fn() }));

const task = (id: string, over: Partial<Task> = {}): Task => (
  { id, key: id.toUpperCase(), title: `Title ${id}`, type: 'feature', createdAt: '', updatedAt: '', ...over }
);

const EPIC = task('epic', { type: 'epic' });
const ISSUE = task('issue', { parentId: 'epic', parent: { id: 'epic', title: 'Title epic', type: 'epic' }, number: 2, statusId: 'doing', category: 'in-progress' });
const FIRST = task('first', { parentId: 'epic', number: 1, statusId: 'done', category: 'done' });
const SUB_DONE = task('sd', { parentId: 'issue', number: 3, statusId: 'done', category: 'done' });
const SUB_OPEN = task('so', { parentId: 'issue', number: 4, statusId: 'todo', category: 'todo' });
const BOARD = { todo: [EPIC, SUB_OPEN], doing: [ISSUE], done: [FIRST, SUB_DONE] };

const STATUSES = [
  { id: 'todo', name: 'Todo', category: 'todo' as const },
  { id: 'doing', name: 'Doing', category: 'in-progress' as const },
  { id: 'done', name: 'Done', category: 'done' as const },
];

/** What GET tasks?parent= answers: those directly under it, in the order of their number. */
const childrenOf = (parentId: string, limit = 200) => {
  const all = Object.values(BOARD).flat().filter((t) => t.parentId === parentId).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  return { tasks: all.slice(0, limit), done: all.filter((t) => t.category === 'done').length, total: all.length };
};

let openDetailPanel: ReturnType<typeof vi.fn>;
let showToast: ReturnType<typeof vi.fn>;
let loadBoard: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  openDetailPanel = vi.fn();
  showToast = vi.fn();
  loadBoard = vi.fn().mockResolvedValue(undefined);
  vi.mocked(api.createTask).mockResolvedValue(task('new'));
  vi.mocked(api.getChildren).mockImplementation(async (_space, parentId, limit) => childrenOf(parentId, limit));
  useAppStore.setState({
    tasks: {},
    boardVersion: null,
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
  it('lists the issues of an epic, in the order of their number, not its grandchildren', async () => {
    render(<ChildIssues task={EPIC} spaceId="s1" />);
    expect((await screen.findAllByTestId('child-issue')).map((c) => c.textContent)).toEqual(['FIRSTTitle first', 'ISSUETitle issue']);
  });

  it('heads an epic with what is done, with a progress bar', async () => {
    render(<ChildIssues task={EPIC} spaceId="s1" />);
    expect(await screen.findByText('Issues in this epic · 1 of 2 done')).toBeInTheDocument();
    const progress = screen.getByRole('progressbar', { name: 'Issues done' });
    expect(progress).toHaveAttribute('max', '2');
    expect(progress).toHaveAttribute('value', '1');
  });

  it('lists the sub-tasks of an issue, without a progress bar', async () => {
    render(<ChildIssues task={ISSUE} spaceId="s1" />);
    expect((await screen.findAllByTestId('child-issue')).map((c) => c.textContent)).toEqual(['SDTitle sd', 'SOTitle so']);
    expect(screen.getByText('Sub-tasks · 1 of 2')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('heads an issue with no sub-tasks without a count', async () => {
    const lone = task('lone');
    render(<ChildIssues task={lone} spaceId="s1" />);
    expect(await screen.findByText('Sub-tasks')).toBeInTheDocument();
    expect(screen.queryAllByTestId('child-issue')).toHaveLength(0);
  });

  it('shows the status of each child, and strikes out the done ones', async () => {
    render(<ChildIssues task={ISSUE} spaceId="s1" />);
    expect(await screen.findByLabelText('Done')).toBeInTheDocument();
    expect(screen.getByLabelText('Todo')).toBeInTheDocument();
    expect(screen.getByText('Title sd')).toHaveClass('line-through');
    expect(screen.getByText('Title so')).not.toHaveClass('line-through');
  });

  it('opens a child when clicked', async () => {
    render(<ChildIssues task={ISSUE} spaceId="s1" />);
    fireEvent.click(await screen.findByText('Title so'));
    expect(openDetailPanel).toHaveBeenCalledWith(SUB_OPEN);
  });

  it('renders nothing for a sub-task, which cannot have sub-tasks', () => {
    const { container } = render(<ChildIssues task={{ ...SUB_OPEN, parent: { id: 'issue', title: 'Title issue', type: 'feature' } }} spaceId="s1" />);
    expect(container).toBeEmptyDOMElement();
    expect(api.getChildren).not.toHaveBeenCalled();
  });

  it('renders nothing for a card that says it is a sub-task, or until it is known what it is', () => {
    const { container, unmount } = render(<ChildIssues task={{ ...SUB_OPEN, parentKey: 'ISSUE' }} spaceId="s1" />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    expect(render(<ChildIssues task={SUB_OPEN} spaceId="s1" />).container).toBeEmptyDOMElement();
  });

  it('asks the server, since the children may not be on the board', async () => {
    useAppStore.setState({ tasks: {} } as never);
    render(<ChildIssues task={EPIC} spaceId="s1" />);
    await screen.findByText('Title first');
    expect(api.getChildren).toHaveBeenCalledWith('s1', 'epic', 200);
  });

  it('asks again when the board changes, which is when a child may have', async () => {
    render(<ChildIssues task={ISSUE} spaceId="s1" />);
    await screen.findAllByTestId('child-issue');
    vi.mocked(api.getChildren).mockResolvedValue({ tasks: [SUB_OPEN], done: 0, total: 1 });
    act(() => useAppStore.setState({ boardVersion: '"new"' } as never));
    await waitFor(() => expect(screen.getAllByTestId('child-issue')).toHaveLength(1));
  });

  it('shows the real counts of many children, a page of them, and brings more', async () => {
    vi.mocked(api.getChildren).mockImplementation(async (_s, _p, limit) => ({
      tasks: Array.from({ length: limit }, (_, i) => task(`c${i}`, { number: i })), done: 3, total: 450,
    }));
    render(<ChildIssues task={EPIC} spaceId="s1" />);
    expect(await screen.findByText('Issues in this epic · 3 of 450 done')).toBeInTheDocument();
    expect(screen.getAllByTestId('child-issue')).toHaveLength(200);
    fireEvent.click(screen.getByTestId('show-more-children'));
    await waitFor(() => expect(screen.getAllByTestId('child-issue')).toHaveLength(400));
  });

  it('shows no more of them once all are there', async () => {
    render(<ChildIssues task={EPIC} spaceId="s1" />);
    await screen.findAllByTestId('child-issue');
    expect(screen.queryByTestId('show-more-children')).not.toBeInTheDocument();
  });

  it('lists what was added without waiting for the board', async () => {
    render(<ChildIssues task={EPIC} spaceId="s1" />);
    await screen.findAllByTestId('child-issue');
    vi.mocked(api.getChildren).mockClear();
    addChild('New issue');
    await waitFor(() => expect(api.getChildren).toHaveBeenCalled());
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
