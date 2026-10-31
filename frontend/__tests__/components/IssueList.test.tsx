import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from '@/api/client';
import { FilterBar } from '@/components/layout/FilterBar';
import { IssueList } from '@/components/list/IssueList';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useListStore } from '@/stores/useListStore';
import { DEFAULT_SORT } from '@/utils/issueFilters';
import type { Task } from '@/types';

vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof api>()),
  getIssues: vi.fn(),
  getIssueIds: vi.fn(),
  updateIssues: vi.fn(),
  getLabels: vi.fn(async () => ['web']),
  getBoard: vi.fn(async () => null),
  getAssignees: vi.fn(async () => []),
}));

const statuses = [{ id: 'todo', name: 'To do', category: 'todo' }, { id: 'done', name: 'Done', category: 'done' }] as const;
const issue = (n: number, fields: Partial<Task> = {}): Task => ({
  id: `t${n}`, key: `WEB-${n}`, title: `Issue ${n}`, type: 'bug', statusId: 'todo', priority: 'high', createdAt: '', updatedAt: '', ...fields,
});
const answer = (tasks: Task[], total = tasks.length) => vi.mocked(api.getIssues).mockResolvedValue({ data: { tasks, total }, etag: 'v' });

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    activeSpaceId: 's', filters: {}, listSort: DEFAULT_SORT, view: 'list', epics: [], columnTotals: {},
    spaces: [{ id: 's', name: 'S', statuses: [...statuses] }] as never, detailTask: null,
  });
  useListStore.setState({ rows: {}, total: null, failed: false, selected: new Set() });
  useAuthStore.setState({ status: { user: { role: 'member' } } } as never);
});

describe('IssueList', () => {
  it('shows what a row has', async () => {
    answer([issue(1, { assigned: 'Ana López', epic: { id: 'e', title: 'Checkout' }, estimate: 5, dueDate: '2020-02-03', category: 'todo' })]);
    render(<IssueList />);
    const row = await screen.findByTestId('issue-row');
    for (const text of ['WEB-1', 'Issue 1', 'To do', 'High', 'Ana López', 'Bug', 'Checkout', '5']) {
      expect(row.textContent).toContain(text);
    }
  });

  it('only puts in the page the rows that show', async () => {
    answer(Array.from({ length: 100 }, (_, i) => issue(i)), 10000);
    render(<IssueList />);
    await screen.findAllByTestId('issue-row');
    expect(screen.getAllByTestId('issue-row').length).toBeLessThan(60);
  });

  it('orders by a heading, and the other way the second time', async () => {
    answer([issue(1)]);
    render(<IssueList />);
    await screen.findByTestId('issue-row');
    fireEvent.click(screen.getByTestId('sort-priority'));
    expect(useAppStore.getState().listSort).toEqual({ field: 'priority', dir: 'asc' });
    await waitFor(() => expect(vi.mocked(api.getIssues).mock.lastCall![1].sort.field).toBe('priority'));
    fireEvent.click(screen.getByTestId('sort-priority'));
    expect(useAppStore.getState().listSort).toEqual({ field: 'priority', dir: 'desc' });
    expect(screen.getByRole('columnheader', { name: /priority/i })).toHaveAttribute('aria-sort', 'descending');
  });

  it('opens the issue from its row, and selecting does not', async () => {
    const open = vi.fn();
    useAppStore.setState({ openDetailPanel: open });
    answer([issue(1)]);
    render(<IssueList />);
    await screen.findByTestId('issue-row');
    fireEvent.click(screen.getByLabelText('Select WEB-1'));
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Issue 1'));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('whoever can only read cannot select', async () => {
    useAuthStore.setState({ status: { user: { role: 'viewer' } } } as never);
    answer([issue(1)]);
    render(<IssueList />);
    await screen.findByTestId('issue-row');
    expect(screen.queryByTestId('select-all')).toBeNull();
    expect(screen.queryByLabelText('Select WEB-1')).toBeNull();
  });

  it('says when no issue matches, and clears from there', async () => {
    useAppStore.setState({ filters: { q: 'nothing' } });
    answer([]);
    render(<IssueList />);
    await screen.findByTestId('list-empty');
    fireEvent.click(screen.getByText('Clear filters'));
    expect(useAppStore.getState().filters).toEqual({});
  });

  it('asks before changing what is selected, and goes on only if told', async () => {
    answer([issue(1), issue(2)]);
    vi.mocked(api.updateIssues).mockResolvedValue({ updated: 1 });
    render(<IssueList />);
    await screen.findAllByTestId('issue-row');
    fireEvent.click(screen.getByLabelText('Select WEB-2'));
    expect(screen.getByTestId('bulk-count').textContent).toBe('1 selected');
    fireEvent.change(screen.getByTestId('bulk-priority'), { target: { value: 'urgent' } });
    expect(api.updateIssues).not.toHaveBeenCalled();
    expect(screen.getByTestId('bulk-confirm').textContent).toContain('set priority to Urgent');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.updateIssues).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('bulk-priority'), { target: { value: 'urgent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change 1 issue' }));
    await waitFor(() => expect(api.updateIssues).toHaveBeenCalledWith('s', ['t2'], { priority: 'urgent' }));
    await waitFor(() => expect(screen.queryByTestId('bulk-bar')).toBeNull());
    expect(screen.getByTestId('select-all')).toHaveFocus();
  });

  it('an issue that shows in two pages for a moment leaves no row behind', async () => {
    answer([issue(1), issue(2)]);
    render(<IssueList />);
    await screen.findAllByTestId('issue-row');
    const a = issue(1); const b = issue(2);
    act(() => useListStore.setState({ rows: { 0: a, 1: b, 2: b }, total: 3 }));
    act(() => useListStore.setState({ rows: { 0: issue(9), 1: a, 2: b }, total: 3 }));
    expect(screen.getAllByTestId('issue-row').map((r) => r.textContent?.slice(0, 5))).toEqual(['WEB-9', 'WEB-1', 'WEB-2']);
  });

  it('says how long the list is to whoever cannot see it', async () => {
    answer([issue(1)], 10000);
    render(<IssueList />);
    await screen.findByTestId('issue-row');
    expect(screen.getByRole('table')).toHaveAttribute('aria-rowcount', '10001');
    expect(screen.getByTestId('issue-row')).toHaveAttribute('aria-rowindex', '2');
  });

  it('unassigning is a choice of its own', async () => {
    answer([issue(1)]);
    vi.mocked(api.updateIssues).mockResolvedValue({ updated: 1 });
    render(<IssueList />);
    await screen.findByTestId('issue-row');
    fireEvent.click(screen.getByLabelText('Select WEB-1'));
    fireEvent.change(screen.getByLabelText('Change assignee'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change 1 issue' }));
    await waitFor(() => expect(api.updateIssues).toHaveBeenCalledWith('s', ['t1'], { assigned: '' }));
  });
});

describe('FilterBar', () => {
  it('switches the view', () => {
    render(<FilterBar />);
    fireEvent.click(screen.getByTestId('view-board'));
    expect(useAppStore.getState().view).toBe('board');
    expect(screen.getByTestId('view-board')).toHaveAttribute('aria-pressed', 'true');
  });

  it('a choice in the panel filters at once, and shows as a token to remove', async () => {
    useAppStore.setState({ loadBoard: vi.fn(async () => {}) });
    render(<FilterBar />);
    fireEvent.click(screen.getByTestId('filter-button'));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Done' }));
    expect(useAppStore.getState().filters).toEqual({ status: ['done'] });
    expect(screen.getByTestId('filter-token-status').textContent).toContain('Done');
    expect(screen.getByTestId('filter-button').textContent).toContain('1');
    fireEvent.click(screen.getByLabelText('Remove filter Status'));
    expect(useAppStore.getState().filters).toEqual({});
  });

  it('none is a value like any other', async () => {
    useAppStore.setState({ loadBoard: vi.fn(async () => {}) });
    render(<FilterBar />);
    fireEvent.click(screen.getByTestId('filter-button'));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Unassigned' }));
    expect(useAppStore.getState().filters).toEqual({ assignee: [''] });
    expect(screen.getByTestId('filter-token-assignee').textContent).toContain('Unassigned');
  });

  it('text waits until you stop typing', async () => {
    const load = vi.fn(async () => {});
    useAppStore.setState({ loadBoard: load });
    render(<FilterBar />);
    fireEvent.click(screen.getByTestId('filter-button'));
    fireEvent.change(await screen.findByTestId('filter-text'), { target: { value: 'pay' } });
    expect(useAppStore.getState().filters).toEqual({});
    await waitFor(() => expect(useAppStore.getState().filters).toEqual({ q: 'pay' }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('Escape closes the panel and goes back to its button', async () => {
    render(<FilterBar />);
    fireEvent.click(screen.getByTestId('filter-button'));
    await screen.findByTestId('filter-panel');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('filter-panel')).toBeNull();
    expect(screen.getByTestId('filter-button')).toHaveFocus();
  });

  it('the caption of the text is not a way to clear everything', async () => {
    useAppStore.setState({ filters: { q: 'x' }, loadBoard: vi.fn(async () => {}) });
    render(<FilterBar />);
    fireEvent.click(screen.getByTestId('filter-button'));
    fireEvent.click(await screen.findByText('Text', { selector: 'span.block' }));
    expect(useAppStore.getState().filters).toEqual({ q: 'x' });
    expect(screen.getByLabelText('Text')).toBe(screen.getByTestId('filter-text'));
  });

  it('removing the text while the panel is open does not bring it back on closing', async () => {
    useAppStore.setState({ filters: { q: 'x' }, loadBoard: vi.fn(async () => {}) });
    render(<FilterBar />);
    fireEvent.click(screen.getByTestId('filter-button'));
    await screen.findByTestId('filter-panel');
    fireEvent.click(screen.getByLabelText('Remove filter Text'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useAppStore.getState().filters).toEqual({});
  });

  it('what was typed counts even if the panel closes at once', async () => {
    useAppStore.setState({ loadBoard: vi.fn(async () => {}) });
    render(<FilterBar />);
    fireEvent.click(screen.getByTestId('filter-button'));
    fireEvent.change(await screen.findByTestId('filter-text'), { target: { value: 'pay' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useAppStore.getState().filters).toEqual({ q: 'pay' });
  });

  it('Clear removes them all', () => {
    useAppStore.setState({ filters: { q: 'x', status: ['todo'] }, loadBoard: vi.fn(async () => {}) });
    render(<FilterBar />);
    fireEvent.click(screen.getByTestId('filter-clear'));
    expect(useAppStore.getState().filters).toEqual({});
  });

  it('says how many issues that leaves, by view', () => {
    useAppStore.setState({ view: 'board', columnTotals: { todo: 3, done: 1 } });
    useListStore.setState({ total: 9 });
    const { rerender } = render(<FilterBar />);
    expect(screen.getByTestId('filter-total').textContent).toBe('4 issues');
    act(() => useAppStore.setState({ view: 'list' }));
    rerender(<FilterBar />);
    expect(screen.getByTestId('filter-total').textContent).toBe('9 issues');
  });
});
