/**
 * Unit tests for the Board component.
 * Covers rendering, drag-and-drop perf fixes (stable callbacks, ref-based state),
 * the dragend safety reset, and the empty-state onboarding lifecycle.
 */

import { Profiler } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { Board } from '../../src/components/board/Board';
import { computeDropRank } from '../../src/components/board/Board';
import { boardAnswer } from '../helpers/board';
import { useAppStore } from '../../src/stores/useAppStore';
import { useDragStore } from '../../src/stores/useDragStore';
import * as api from '../../src/api/client';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(), getTasks: vi.fn(), getBoard: vi.fn(), getTaskForPanel: vi.fn().mockResolvedValue(null), createTask: vi.fn(), moveTask: vi.fn(),
  deleteTask: vi.fn(), createSpace: vi.fn(), renameSpace: vi.fn(), deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
}));

const STATUSES = [
  { id: 'todo', name: 'Todo', category: 'todo' as const },
  { id: 'in-progress', name: 'In Progress', category: 'in-progress' as const },
  { id: 'done', name: 'Done', category: 'done' as const },
];

const SPACE = { id: 'space-1', name: 'Space', statuses: STATUSES, createdAt: '', updatedAt: '' };

const TASKS_FIXTURE = {
  todo: [
    { id: 't1', title: 'Task One', type: 'chore' as const, statusId: 'todo', category: 'todo' as const, createdAt: '', updatedAt: '' },
    { id: 't2', title: 'Task Two', type: 'feature' as const, statusId: 'todo', category: 'todo' as const, createdAt: '', updatedAt: '' },
  ],
  'in-progress': [
    { id: 't3', title: 'Task Three', type: 'bug' as const, statusId: 'in-progress', category: 'in-progress' as const, createdAt: '', updatedAt: '' },
  ],
  done: [],
};

const EMPTY_TASKS = { todo: [], 'in-progress': [], done: [] };

beforeEach(() => {
  useAppStore.setState({
    tasks: EMPTY_TASKS,
    activeSpaceId: 'space-1',
    spaces: [SPACE],
    epicFilter: null,
    moveTask: vi.fn(),
    openCreateModal: vi.fn(),
  });
  useDragStore.getState().resetDrag();
});

// ─── Empty-state lifecycle ────────────────────────────────────────────────────

describe('Board — empty-state (BoardEmptyState)', () => {
  it('shows onboarding guide when all columns are empty', () => {
    render(<Board />);
    expect(screen.getByRole('region', { name: 'Your board is empty' })).toBeInTheDocument();
    expect(screen.getByText('Your board is empty')).toBeInTheDocument();
  });

  it('does not render column grid when board is empty', () => {
    render(<Board />);
    expect(screen.queryByText('Todo')).not.toBeInTheDocument();
    expect(screen.queryByText('In Progress')).not.toBeInTheDocument();
  });

  it('does not render ColumnTabBar when board is empty', () => {
    render(<Board />);
    // ColumnTabBar renders mobile column tabs (Todo / In Progress / Done tabs)
    // When empty, the tab bar div is not mounted at all.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('shows onboarding guide when only todo is empty but all empty', () => {
    useAppStore.setState({ tasks: EMPTY_TASKS });
    render(<Board />);
    expect(screen.getByText('Your board is empty')).toBeInTheDocument();
  });

  it('hides onboarding guide and renders columns once tasks exist', () => {
    useAppStore.setState({ tasks: TASKS_FIXTURE });
    render(<Board />);
    expect(screen.queryByText('Your board is empty')).not.toBeInTheDocument();
    expect(screen.getAllByText('Todo').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('In Progress').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Done').length).toBeGreaterThanOrEqual(1);
    // What the empty board leaves out is back.
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('calls openCreateModal when CTA in empty state is clicked', () => {
    const openCreateModal = vi.fn();
    useAppStore.setState({ tasks: EMPTY_TASKS, openCreateModal });
    render(<Board />);
    const btn = screen.getByRole('button', { name: /Add your first task to start using Prism/i });
    fireEvent.click(btn);
    expect(openCreateModal).toHaveBeenCalledOnce();
  });

  it('shows guide even when only one column has tasks — only triggers on all-empty', () => {
    // Only todo has tasks → board is NOT empty → columns render
    useAppStore.setState({
      tasks: {
        todo: [{ id: 't1', title: 'Task One', type: 'chore' as const, createdAt: '', updatedAt: '' }],
        'in-progress': [],
        done: [],
      },
    });
    render(<Board />);
    expect(screen.queryByText('Your board is empty')).not.toBeInTheDocument();
    expect(screen.getByText('Task One')).toBeInTheDocument();
  });
});

// ─── Column rendering ─────────────────────────────────────────────────────────

describe('Board — rendering', () => {
  it('renders all 3 columns when tasks exist', () => {
    useAppStore.setState({ tasks: TASKS_FIXTURE });
    render(<Board />);
    expect(screen.getAllByText('Todo').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('In Progress').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Done').length).toBeGreaterThanOrEqual(1);
  });

  it('has a column per status of the space, in its order and with its names', () => {
    useAppStore.setState({
      tasks: TASKS_FIXTURE,
      spaces: [{
        ...SPACE,
        statuses: [
          { id: 'done', name: 'Shipped', category: 'done' },
          { id: 'review', name: 'In review', category: 'in-progress' },
          { id: 'in-progress', name: 'Doing', category: 'in-progress' },
          { id: 'todo', name: 'Backlog', category: 'todo' },
        ],
      }],
    });
    render(<Board />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Shipped', 'In review', 'Doing', 'Backlog']);
    expect(screen.queryByRole('region', { name: 'Todo column' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Backlog column' })).toHaveTextContent('Task One');
  });

  it('mobile tabs show the statuses with their counts', () => {
    useAppStore.setState({ tasks: TASKS_FIXTURE });
    render(<Board />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Todo2', 'In Progress1', 'Done0']);
  });

  it('renders tasks from the store', () => {
    useAppStore.setState({ tasks: TASKS_FIXTURE });
    render(<Board />);
    expect(screen.getByText('Task One')).toBeInTheDocument();
    expect(screen.getByText('Task Two')).toBeInTheDocument();
    expect(screen.getByText('Task Three')).toBeInTheDocument();
  });
});

// ─── Drag and drop ───────────────────────────────────────────────────────────

describe('Board — drag and drop', () => {
  it('sets dragging state on dragstart and clears on dragend', () => {
    useAppStore.setState({ tasks: TASKS_FIXTURE });
    render(<Board />);

    const cards = screen.getAllByTestId('task-card');
    const firstCard = cards[0];

    // Drag start — card should get aria-grabbed=true
    fireEvent.dragStart(firstCard, {
      dataTransfer: { effectAllowed: '', setData: vi.fn(), getData: vi.fn().mockReturnValue('t1') },
    });
    expect(firstCard.getAttribute('aria-grabbed')).toBe('true');

    // Drag end (cancel) — state resets, aria-grabbed back to false
    fireEvent.dragEnd(firstCard);
    expect(firstCard.getAttribute('aria-grabbed')).toBe('false');
  });

  it('does not call moveTask when dropping onto the same column', () => {
    const moveTaskMock = vi.fn();
    useAppStore.setState({ tasks: TASKS_FIXTURE, moveTask: moveTaskMock });
    render(<Board />);

    const cards = screen.getAllByTestId('task-card');
    const firstCard = cards[0];

    fireEvent.dragStart(firstCard, {
      dataTransfer: {
        effectAllowed: '',
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue('t1'),
      },
    });

    // Drop on the todo column (same as source)
    const todoSection = screen.getByRole('region', { name: 'Todo column' });
    fireEvent.drop(todoSection, {
      dataTransfer: { getData: vi.fn().mockReturnValue('t1') },
    });

    expect(moveTaskMock).not.toHaveBeenCalled();
  });

  it('calls moveTask with the status of the column dropped on', () => {
    const moveTaskMock = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ tasks: TASKS_FIXTURE, moveTask: moveTaskMock });
    render(<Board />);

    const cards = screen.getAllByTestId('task-card');
    const firstCard = cards[0]; // t1 in todo

    fireEvent.dragStart(firstCard, {
      dataTransfer: {
        effectAllowed: '',
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue('t1'),
      },
    });

    const inProgressSection = screen.getByRole('region', { name: 'In Progress column' });
    fireEvent.drop(inProgressSection, {
      dataTransfer: { getData: vi.fn().mockReturnValue('t1') },
    });

    expect(moveTaskMock).toHaveBeenCalledWith('t1', 'in-progress');
  });

  it('BUG-003 regression: reordering into empty space below the last card appends at the end, not before the last card the cursor passed over', () => {
    // Full integration path through the real useDragStore (not mocked here),
    // reproducing the exact QA repro: drag t1 over t2 (dragOverTaskId=t2),
    // then move into the empty column area below t2 (column-level dragover
    // must clear dragOverTaskId to null), then drop. Without the BUG-003 fix,
    // dragOverTaskId would stay pinned to t2 and the drop would insert t1
    // immediately before/after t2 (triggering the rank-rebalance branch)
    // instead of appending t1 at the end of the column.
    const reorderTaskMock = vi.fn();
    useAppStore.setState({ tasks: TASKS_FIXTURE, reorderTask: reorderTaskMock });
    render(<Board />);

    const cards = screen.getAllByTestId('task-card');
    const firstCard = cards[0];  // t1, todo
    const secondCard = cards[1]; // t2, todo

    fireEvent.dragStart(firstCard, {
      dataTransfer: { effectAllowed: '', setData: vi.fn(), getData: vi.fn().mockReturnValue('t1') },
    });

    // Cursor passes over the second card first — sets dragOverTaskId to t2.
    fireEvent.dragOver(secondCard);
    expect(useDragStore.getState().dragOverTaskId).toBe('t2');

    // Cursor exits into the empty column space below the last card — the
    // column-level handler (not a per-card one) must fire and clear it.
    const todoSection = screen.getByRole('region', { name: 'Todo column' });
    fireEvent.dragOver(todoSection);
    expect(useDragStore.getState().dragOverTaskId).toBeNull();

    fireEvent.drop(todoSection, {
      dataTransfer: { getData: vi.fn().mockReturnValue('t1') },
    });

    // t2 has no explicit rank (defaults to 0 via `?? 0`), so appending at the
    // end after t2 yields rank 0 + 1000. A single reorderTask call (no
    // rebalance) confirms the drop landed at the end, not wedged against t2.
    expect(reorderTaskMock).toHaveBeenCalledTimes(1);
    expect(reorderTaskMock).toHaveBeenCalledWith('t1', 'todo', 1000);
  });
});

// ─── Epic filter ─────────────────────────────────────────────────────────────

describe('Board — epic filter', () => {
  const issue = (id: string, title: string, parentId?: string, type: 'feature' | 'epic' = 'feature') => (
    { id, title, type, parentId, statusId: 'todo', category: 'todo' as const, createdAt: '', updatedAt: '' }
  );
  const BOARD = {
    todo: [
      issue('e1', 'Epic One', undefined, 'epic'),
      issue('e2', 'Epic Two', undefined, 'epic'),
      issue('a', 'Direct issue', 'e1'),
      issue('b', 'Other epic issue', 'e2'),
      issue('c', 'Loose issue'),
    ],
    'in-progress': [
      { ...issue('s', 'Sub-task of a', 'a'), statusId: 'in-progress', category: 'in-progress' as const },
    ],
    done: [],
  };

  it('shows every issue with no filter', () => {
    useAppStore.setState({ tasks: BOARD });
    render(<Board />);
    expect(screen.getAllByTestId('task-card')).toHaveLength(6);
  });

  it('filters nothing itself: what the server sent is what shows', () => {
    useAppStore.setState({ tasks: { todo: [issue('c', 'Not in the epic')], 'in-progress': [], done: [] }, epicFilter: 'e1' });
    render(<Board />);
    expect(screen.getAllByTestId('task-card')).toHaveLength(1);
  });

  it('an epic with nothing to show is not an empty board', () => {
    useAppStore.setState({ tasks: { todo: [], 'in-progress': [], done: [] }, columnTotals: { todo: 0, 'in-progress': 0, done: 0 }, epicFilter: 'e1' });
    render(<Board />);
    expect(screen.queryByText('Your board is empty')).not.toBeInTheDocument();
    expect(screen.getAllByRole('tabpanel').length).toBeGreaterThan(0);
  });

  // Fails today: nothing clears epicFilter when its epic goes, and the bar hides its filter
  // with no epics left. The board stays empty until switching space.
  it('deleting the last epic while filtered to it leaves a way back to the issues', async () => {
    const after = { todo: [issue('c', 'Loose issue')], 'in-progress': [], done: [] };
    vi.mocked(api.deleteTask).mockResolvedValue({ deleted: true, id: 'e1' });
    vi.mocked(api.getBoard).mockResolvedValue(boardAnswer(after));
    useAppStore.setState({ tasks: { ...after, todo: [issue('e1', 'Epic One', undefined, 'epic'), ...after.todo] }, epicFilter: 'e1' });
    render(<Board />);
    await act(() => useAppStore.getState().deleteTask('e1'));
    expect(screen.queryAllByTestId('task-card').length).toBeGreaterThan(0);
  });
});

// ─── Polling ─────────────────────────────────────────────────────────────────

describe('Board — polling', () => {
  it('drops the filter when its epic stops being one', async () => {
    const was = { id: 'e', key: 'K-1', title: 'E', type: 'epic', createdAt: '', updatedAt: '' };
    useAppStore.setState({ tasks: { todo: [was], 'in-progress': [], done: [] } as never, epicFilter: 'e' });
    vi.mocked(api.getBoard).mockResolvedValue(boardAnswer({ todo: [], 'in-progress': [], done: [] }));
    await act(() => useAppStore.getState().loadBoard());
    expect(useAppStore.getState().epicFilter).toBeNull();
  });

  it('turns a card overdue when the day changes, though the issue did not', async () => {
    const yesterday = new Date(Date.now() - 864e5);
    const pad = (n: number) => String(n).padStart(2, '0');
    const dueDate = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
    const tasks = { todo: [{ id: 'a', key: 'K-1', title: 'A', type: 'feature', dueDate, createdAt: '', updatedAt: '' }], 'in-progress': [], done: [] } as never;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59));
    useAppStore.setState({ tasks, today: dueDate });
    vi.mocked(api.getBoard).mockResolvedValue(boardAnswer(JSON.parse(JSON.stringify(tasks))));
    render(<Board />);
    expect(screen.getByTestId('due-date')).not.toHaveClass('text-error');
    vi.setSystemTime(new Date(Date.now() + 864e5));
    await act(() => useAppStore.getState().loadBoard());
    expect(screen.getByTestId('due-date')).toHaveClass('text-error');
    vi.useRealTimers();
  });

  it('renders nothing again when a poll brings the same issues', async () => {
    const tasks = { todo: [{ id: 'a', key: 'K-1', title: 'A', type: 'feature', createdAt: '', updatedAt: '' }], 'in-progress': [], done: [] } as never;
    useAppStore.setState({ tasks, columnTotals: { todo: 1, 'in-progress': 0, done: 0 }, boardScope: `${useAppStore.getState().activeSpaceId}|` });
    vi.mocked(api.getBoard).mockResolvedValue(boardAnswer(JSON.parse(JSON.stringify(tasks))));
    const onRender = vi.fn();
    render(<Profiler id="board" onRender={onRender}><Board /></Profiler>);
    const before = onRender.mock.calls.length;
    await act(() => useAppStore.getState().loadBoard());
    expect(onRender.mock.calls.length).toBe(before);
    expect(useAppStore.getState().tasks).toBe(tasks);
  });
});

// ─── Only some of the cards are loaded ───────────────────────────────────────

describe('Board — a space with more cards than are loaded', () => {
  const card = (id: string, rank: number) => ({ id, title: id, type: 'feature' as const, rank, createdAt: '', updatedAt: '' });

  it('is not empty because no card happens to be loaded', () => {
    useAppStore.setState({ tasks: { todo: [], 'in-progress': [], done: [] }, columnTotals: { todo: 5, 'in-progress': 0, done: 0 } });
    render(<Board />);
    expect(screen.queryByText('Your board is empty')).not.toBeInTheDocument();
  });

  it('is empty when the totals say so', () => {
    useAppStore.setState({ tasks: { todo: [], 'in-progress': [], done: [] }, columnTotals: { todo: 0, 'in-progress': 0, done: 0 } });
    render(<Board />);
    expect(screen.getByText('Your board is empty')).toBeInTheDocument();
  });

  it('the mobile tabs count all there are, not what is loaded', () => {
    useAppStore.setState({ tasks: { todo: [card('a', 1000)], 'in-progress': [], done: [] }, columnTotals: { todo: 4210, 'in-progress': 0, done: 7 } });
    render(<Board />);
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['Todo4210', 'In Progress0', 'Done7']);
  });

  describe('computeDropRank', () => {
    // A Done column that shows its tail: 5000 is the rank of the last card it does not show.
    const tail = [card('x', 6000), card('y', 7000), card('z', 8000)];

    it('before the first card shown lands next to it, not among the cards above', () => {
      expect(computeDropRank(tail, 'z', 'x', true, { rankBefore: 5000 }).newRank).toBe(5500);
    });

    it('without anything hidden above, between 0 and the first as ever', () => {
      expect(computeDropRank(tail, 'z', 'x', true).newRank).toBe(3000);
    });

    // A column that shows its head: 4000 is the rank of the first card it does not show.
    const head = [card('a', 1000), card('b', 2000), card('c', 3000)];

    it('after the last card shown lands before the first one hidden', () => {
      expect(computeDropRank(head, 'a', 'c', false, { rankAfter: 4000 }).newRank).toBe(3500);
      expect(computeDropRank(head, 'a', null, true, { rankAfter: 4000 }).newRank).toBe(3500);
    });

    it('without anything hidden below, last as ever', () => {
      expect(computeDropRank(head, 'a', 'c', false).newRank).toBe(4000);
      expect(computeDropRank(head, 'a', null, true).newRank).toBe(4000);
    });

    it('among the cards shown, the bounds change nothing', () => {
      expect(computeDropRank(head, 'c', 'a', false, { rankAfter: 4000 }).newRank).toBe(1500);
    });

    const crowded = [card('a', 6000), card('b', 6000.0004), card('c', 6000.0008), card('d', 7000)];

    it('a rebalance stays where the cards are, in a column that shows its tail', () => {
      const { needsRebalance, rebalancedTasks } = computeDropRank(crowded, 'd', 'b', true, { rankBefore: 5000 });
      expect(needsRebalance).toBe(true);
      expect(rebalancedTasks!.map((t) => t.id)).toEqual(['a', 'd', 'b', 'c']);
      expect(rebalancedTasks!.map((t) => t.rank)).toEqual([6000, 7000, 8000, 9000]);
    });

    it('a rebalance stays above the cards below, in a column that shows its head', () => {
      const { rebalancedTasks } = computeDropRank(crowded, 'd', 'b', true, { rankBefore: 5000, rankAfter: 5400 });
      const ranks = rebalancedTasks!.map((t) => t.rank as number);
      expect(ranks[0]).toBeGreaterThan(5000);
      expect(ranks[3]).toBeLessThan(5400);
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    });

    it('a rebalance with nothing hidden counts in thousands, as ever', () => {
      const { rebalancedTasks } = computeDropRank(crowded, 'd', 'b', true);
      expect(rebalancedTasks!.map((t) => t.rank)).toEqual([1000, 2000, 3000, 4000]);
    });
  });
});
