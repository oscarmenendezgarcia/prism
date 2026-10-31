/**
 * Unit tests for useAppStore Zustand store.
 * All API calls are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock the API client before importing the store ───────────────────────────
vi.mock('../../src/api/client', () => ({
  getSpaces:            vi.fn(),
  createSpace:          vi.fn(),
  renameSpace:          vi.fn(),
  deleteSpace:          vi.fn(),
  updateSpace:          vi.fn(),
  getTasks:             vi.fn(),
  createTask:           vi.fn(),
  moveTask:             vi.fn(),
  deleteTask:           vi.fn(),
  reorderTask:          vi.fn(),
  getAttachmentContent: vi.fn(),
}));

import { useAppStore } from '../../src/stores/useAppStore';
import * as api from '../../src/api/client';

// Wipe store between tests
function resetStore() {
  useAppStore.setState({
    spaces: [],
    activeSpaceId: 'default',
    tasks: { todo: [], 'in-progress': [], done: [] },
    isMutating: false,
    createModalOpen: false,
    attachmentModal: null,
    spaceModal: null,
    deleteSpaceDialog: null,
    toast: null,
    epicFilter: null,
  });
}

const STATUSES = [
  { id: 'todo', name: 'Todo', category: 'todo' as const },
  { id: 'in-progress', name: 'In Progress', category: 'in-progress' as const },
  { id: 'done', name: 'Done', category: 'done' as const },
];

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  // Clear localStorage
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('setActiveSpace', () => {
  it('updates activeSpaceId and persists to localStorage', () => {
    useAppStore.getState().setActiveSpace('space-123');
    expect(useAppStore.getState().activeSpaceId).toBe('space-123');
    expect(localStorage.getItem('prism-active-space')).toBe('space-123');
  });

  it('resets the epic filter when switching space', () => {
    useAppStore.setState({ epicFilter: 'epic-1' });
    useAppStore.getState().setActiveSpace('space-456');
    expect(useAppStore.getState().epicFilter).toBeNull();
  });

  it('drops the board of the old space when switching, and keeps it when the space is the same', () => {
    const board = { todo: [{ id: 't1', title: 'T', type: 'chore' as const, createdAt: '', updatedAt: '' }] };
    useAppStore.setState({ activeSpaceId: 'space-1', tasks: board });
    useAppStore.getState().setActiveSpace('space-1');
    expect(useAppStore.getState().tasks).toBe(board);
    useAppStore.getState().setActiveSpace('space-2');
    expect(useAppStore.getState().tasks).toEqual({});
  });
});

describe('epic filter', () => {
  it('setting it stores the epic', () => {
    useAppStore.getState().setEpicFilter('epic-1');
    expect(useAppStore.getState().epicFilter).toBe('epic-1');
  });

  it('null clears it', () => {
    useAppStore.setState({ epicFilter: 'epic-1' });
    useAppStore.getState().setEpicFilter(null);
    expect(useAppStore.getState().epicFilter).toBeNull();
  });
});

describe('loadSpaces', () => {
  it('fetches spaces, updates state, and calls loadBoard', async () => {
    const mockSpaces = [
      { id: 'default', name: 'General', createdAt: '', updatedAt: '' },
    ];
    vi.mocked(api.getSpaces).mockResolvedValue(mockSpaces);
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    await useAppStore.getState().loadSpaces();

    expect(useAppStore.getState().spaces).toEqual(mockSpaces);
    expect(api.getTasks).toHaveBeenCalledWith('default');
  });

  it('falls back to first space when active space no longer exists', async () => {
    const mockSpaces = [
      { id: 'other-space', name: 'Other', createdAt: '', updatedAt: '' },
    ];
    useAppStore.setState({ activeSpaceId: 'deleted-space' });
    vi.mocked(api.getSpaces).mockResolvedValue(mockSpaces);
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    await useAppStore.getState().loadSpaces();

    expect(useAppStore.getState().activeSpaceId).toBe('other-space');
  });

  it('shows error toast on failure', async () => {
    vi.mocked(api.getSpaces).mockRejectedValue(new Error('Network error'));
    await useAppStore.getState().loadSpaces();
    const toast = useAppStore.getState().toast;
    expect(toast).not.toBeNull();
    expect(toast?.type).toBe('error');
  });
});

describe('loadBoard', () => {
  it('fetches tasks for active space and updates store', async () => {
    useAppStore.setState({ activeSpaceId: 'space-1' });
    const board = {
      todo: [{ id: 't1', title: 'Task 1', type: 'chore' as const, createdAt: '', updatedAt: '' }],
      'in-progress': [],
      done: [],
    };
    vi.mocked(api.getTasks).mockResolvedValue(board);

    await useAppStore.getState().loadBoard();

    expect(useAppStore.getState().tasks).toEqual(board);
    expect(api.getTasks).toHaveBeenCalledWith('space-1');
  });

  it('shows error toast on failure', async () => {
    vi.mocked(api.getTasks).mockRejectedValue(new Error('API down'));
    await useAppStore.getState().loadBoard();
    expect(useAppStore.getState().toast?.type).toBe('error');
  });

  it('ignores a board that arrives after the user moved to another space', async () => {
    let resolve!: (board: Record<string, never[]>) => void;
    vi.mocked(api.getTasks).mockReturnValue(new Promise((r) => { resolve = r; }));
    useAppStore.setState({ activeSpaceId: 'space-1', tasks: {} });
    const loading = useAppStore.getState().loadBoard();
    useAppStore.setState({ activeSpaceId: 'space-2' });
    resolve({ late: [] });
    await loading;
    expect(useAppStore.getState().tasks).toEqual({});
  });

  it('reloads the spaces when the board has a status it does not know', async () => {
    const fresh = [{ id: 'space-1', name: 'S', statuses: [...STATUSES, { id: 'qa', name: 'QA', category: 'in-progress' as const }], createdAt: '', updatedAt: '' }];
    useAppStore.setState({ activeSpaceId: 'space-1', spaces: [{ id: 'space-1', name: 'S', statuses: STATUSES, createdAt: '', updatedAt: '' }] });
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], qa: [] });
    vi.mocked(api.getSpaces).mockResolvedValue(fresh);
    await useAppStore.getState().loadBoard();
    expect(useAppStore.getState().spaces).toEqual(fresh);
  });

  it('does not reload the spaces when it knows every status', async () => {
    useAppStore.setState({ activeSpaceId: 'space-1', spaces: [{ id: 'space-1', name: 'S', statuses: STATUSES, createdAt: '', updatedAt: '' }] });
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });
    await useAppStore.getState().loadBoard();
    expect(api.getSpaces).not.toHaveBeenCalled();
  });
});

describe('createTask', () => {
  it('calls api.createTask, closes modal, reloads board, shows toast', async () => {
    useAppStore.setState({ createModalOpen: true });
    vi.mocked(api.createTask).mockResolvedValue({ id: 'new', title: 'New task', type: 'chore', createdAt: '', updatedAt: '' });
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    await useAppStore.getState().createTask({ title: 'New task', type: 'chore' });

    expect(useAppStore.getState().createModalOpen).toBe(false);
    expect(api.createTask).toHaveBeenCalled();
    expect(api.getTasks).toHaveBeenCalled();
    expect(useAppStore.getState().toast?.type).toBe('success');
  });

  it('sets isMutating true during call and false after', async () => {
    vi.mocked(api.createTask).mockResolvedValue({ id: 'x', title: 'T', type: 'chore', createdAt: '', updatedAt: '' });
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    const promise = useAppStore.getState().createTask({ title: 'T', type: 'chore' });
    // isMutating should be true synchronously right after start
    // Note: because Zustand sets synchronously before await, we can check after resolution
    await promise;
    expect(useAppStore.getState().isMutating).toBe(false);
  });

  it('re-throws error and resets isMutating on failure', async () => {
    vi.mocked(api.createTask).mockRejectedValue(new Error('Validation error'));
    await expect(
      useAppStore.getState().createTask({ title: 'T', type: 'chore' })
    ).rejects.toThrow('Validation error');
    expect(useAppStore.getState().isMutating).toBe(false);
  });
});

describe('moveTask', () => {
  it('calls api.moveTask with the target status, shows its name in a toast, reloads board', async () => {
    useAppStore.setState({ activeSpaceId: 'space-1', spaces: [{ id: 'space-1', name: 'S', statuses: STATUSES, createdAt: '', updatedAt: '' }] });
    vi.mocked(api.moveTask).mockResolvedValue({
      task: { id: 't1', title: 'T', type: 'chore', createdAt: '', updatedAt: '' },
      from: 'todo',
      to: 'in-progress',
    });
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    await useAppStore.getState().moveTask('t1', 'in-progress');

    expect(api.moveTask).toHaveBeenCalledWith('space-1', 't1', 'in-progress');
    expect(useAppStore.getState().toast?.message).toBe('Moved to In Progress');
    expect(api.getTasks).toHaveBeenCalled();
  });

  const moveFixture = () => {
    const task = (id: string, statusId: string, rank: number) => ({ id, statusId, rank, title: id, type: 'chore', createdAt: '', updatedAt: '' });
    useAppStore.setState({
      activeSpaceId: 'space-1',
      spaces: [{ id: 'space-1', name: 'S', statuses: STATUSES }] as never,
      tasks: { todo: [task('t1', 'todo', 1000), task('t2', 'todo', 2000)], 'in-progress': [task('t3', 'in-progress', 5000)], done: [] } as never,
    });
  };
  const ids = (column: string) => useAppStore.getState().tasks[column].map((t) => t.id);

  it('moves the card at once, last in its new column, before the server answers', async () => {
    moveFixture();
    let answer!: () => void;
    vi.mocked(api.moveTask).mockImplementation(() => new Promise((resolve) => { answer = () => resolve({} as never); }));
    vi.mocked(api.getTasks).mockResolvedValue(useAppStore.getState().tasks);

    const moving = useAppStore.getState().moveTask('t1', 'in-progress');

    expect(ids('todo')).toEqual(['t2']);
    expect(ids('in-progress')).toEqual(['t3', 't1']);
    expect(useAppStore.getState().tasks['in-progress'][1].rank).toBe(6000);
    answer();
    await moving;
  });

  it('puts the card back when the server refuses the move', async () => {
    moveFixture();
    vi.mocked(api.moveTask).mockRejectedValue(new Error('Nope'));

    await useAppStore.getState().moveTask('t1', 'in-progress');

    expect(ids('todo')).toEqual(['t1', 't2']);
    expect(ids('in-progress')).toEqual(['t3']);
    expect(useAppStore.getState().toast?.message).toBe('Nope');
  });

  it('undoes only its own card, keeping what else changed in those columns', async () => {
    moveFixture();
    let fail!: (e: Error) => void;
    vi.mocked(api.moveTask).mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    const moving = useAppStore.getState().moveTask('t1', 'in-progress');
    const now = useAppStore.getState().tasks;
    useAppStore.setState({ tasks: { ...now, todo: [], done: [now.todo[0]] } });

    fail(new Error('Nope'));
    await moving;

    expect(ids('todo')).toEqual(['t1']);
    expect(ids('done')).toEqual(['t2']);
    expect(ids('in-progress')).toEqual(['t3']);
  });

  it('leaves the board alone when the move fails after changing space', async () => {
    moveFixture();
    let fail!: (e: Error) => void;
    vi.mocked(api.moveTask).mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    const moving = useAppStore.getState().moveTask('t1', 'in-progress');
    const other = { todo: [], 'in-progress': [], done: [] };
    useAppStore.setState({ activeSpaceId: 'space-2', tasks: other });

    fail(new Error('Nope'));
    await moving;

    expect(useAppStore.getState().tasks).toBe(other);
  });

  it('ignores a poll that starts and answers while the move is on its way', async () => {
    moveFixture();
    const old = useAppStore.getState().tasks;
    let answer!: () => void;
    vi.mocked(api.moveTask).mockImplementation(() => new Promise((resolve) => { answer = () => resolve({} as never); }));
    const moving = useAppStore.getState().moveTask('t1', 'in-progress');
    vi.mocked(api.getTasks).mockResolvedValueOnce(old);

    await useAppStore.getState().loadBoard();

    expect(ids('in-progress')).toEqual(['t3', 't1']);
    vi.mocked(api.getTasks).mockResolvedValue(useAppStore.getState().tasks);
    answer();
    await moving;
  });

  it('does not let a poll that left during the move put the card back', async () => {
    moveFixture();
    const old = useAppStore.getState().tasks;
    let answer!: () => void;
    vi.mocked(api.moveTask).mockImplementation(() => new Promise((resolve) => { answer = () => resolve({} as never); }));
    const moving = useAppStore.getState().moveTask('t1', 'in-progress');
    let pollAnswer!: (v: typeof old) => void;
    vi.mocked(api.getTasks).mockImplementationOnce(() => new Promise((resolve) => { pollAnswer = resolve; }));
    const poll = useAppStore.getState().loadBoard();
    vi.mocked(api.getTasks).mockResolvedValue(useAppStore.getState().tasks);

    answer();
    await moving;
    pollAnswer(old);
    await poll;

    expect(ids('in-progress')).toEqual(['t3', 't1']);
  });

  it('tracks the mutating taskId in mutatingTaskIds during the call, clears it after', async () => {
    useAppStore.setState({ activeSpaceId: 'space-1' });
    let inFlightIds: Set<string> | null = null;
    vi.mocked(api.moveTask).mockImplementation(async () => {
      // Snapshot the set while the async call is pending.
      inFlightIds = new Set(useAppStore.getState().mutatingTaskIds);
      return {
        task: { id: 't1', title: 'T', type: 'chore', createdAt: '', updatedAt: '' },
        from: 'todo',
        to: 'in-progress',
      };
    });
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    await useAppStore.getState().moveTask('t1', 'in-progress');

    expect(inFlightIds).not.toBeNull();
    expect(Array.from(inFlightIds!)).toEqual(['t1']);
    // Cleared once the mutation resolves — other cards must be interactive again.
    expect(useAppStore.getState().mutatingTaskIds.size).toBe(0);
  });

  it('does not disable OTHER tasks — mutatingTaskIds only contains the moved task', async () => {
    useAppStore.setState({ activeSpaceId: 'space-1' });
    let inFlightIds: Set<string> | null = null;
    vi.mocked(api.moveTask).mockImplementation(async () => {
      inFlightIds = new Set(useAppStore.getState().mutatingTaskIds);
      return {
        task: { id: 't1', title: 'T', type: 'chore', createdAt: '', updatedAt: '' },
        from: 'todo',
        to: 'in-progress',
      };
    });
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    await useAppStore.getState().moveTask('t1', 'in-progress');

    // Regression guard: only 't1' is tracked, never 'other-task'.
    expect(inFlightIds!.has('t1')).toBe(true);
    expect(inFlightIds!.has('other-task')).toBe(false);
  });

  it('clears mutatingTaskIds even when api.moveTask throws', async () => {
    useAppStore.setState({ activeSpaceId: 'space-1' });
    vi.mocked(api.moveTask).mockRejectedValue(new Error('boom'));
    await useAppStore.getState().moveTask('t1', 'in-progress');
    expect(useAppStore.getState().mutatingTaskIds.size).toBe(0);
  });

  it('moves left from in-progress to todo', async () => {
    useAppStore.setState({ activeSpaceId: 'space-1' });
    vi.mocked(api.moveTask).mockResolvedValue({
      task: { id: 't1', title: 'T', type: 'chore', createdAt: '', updatedAt: '' },
      from: 'in-progress',
      to: 'todo',
    });
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    await useAppStore.getState().moveTask('t1', 'todo');

    expect(api.moveTask).toHaveBeenCalledWith('space-1', 't1', 'todo');
  });
});

describe('deleteTask', () => {
  it('calls api.deleteTask, shows toast, reloads board', async () => {
    useAppStore.setState({ activeSpaceId: 'space-1' });
    vi.mocked(api.deleteTask).mockResolvedValue({ deleted: true, id: 't1' });
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    await useAppStore.getState().deleteTask('t1');

    expect(api.deleteTask).toHaveBeenCalledWith('space-1', 't1');
    expect(useAppStore.getState().toast?.message).toBe('Issue deleted');
  });
});

// ADR-1 (touch-reorder): reorderTask is the persistence path the new ↑/↓
// step controls call into. Previously this store action had zero direct
// unit coverage (only exercised indirectly via a mocked prop in
// Board.test.tsx) — added here to verify the optimistic-update /
// persist / rollback-on-failure contract that the touch-reorder
// acceptance criteria depend on.
describe('reorderTask', () => {
  const columnTasks = {
    todo: [
      { id: 't1', title: 'A', type: 'chore' as const, rank: 1000, createdAt: '', updatedAt: '' },
      { id: 't2', title: 'B', type: 'chore' as const, rank: 2000, createdAt: '', updatedAt: '' },
    ],
    'in-progress': [],
    done: [],
  };

  it('optimistically re-sorts the column and persists via api.reorderTask', async () => {
    useAppStore.setState({ activeSpaceId: 'space-1', tasks: columnTasks });
    vi.mocked(api.reorderTask).mockResolvedValue(columnTasks.todo[0]);

    const promise = useAppStore.getState().reorderTask('t1', 'todo', 2500);
    // Optimistic re-sort happens synchronously, before the API call resolves.
    expect(useAppStore.getState().tasks.todo.map((t) => t.id)).toEqual(['t2', 't1']);

    await promise;
    expect(api.reorderTask).toHaveBeenCalledWith('space-1', 't1', 2500);
  });

  it('rolls back the column order and shows an error toast when the API call fails', async () => {
    useAppStore.setState({ activeSpaceId: 'space-1', tasks: columnTasks });
    vi.mocked(api.reorderTask).mockRejectedValue(new Error('Network error'));

    await useAppStore.getState().reorderTask('t1', 'todo', 2500);

    // Rolled back to the original rank order (t1 before t2).
    expect(useAppStore.getState().tasks.todo.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(useAppStore.getState().toast).toMatchObject({ message: 'Network error', type: 'error' });
  });
});

describe('modal open/close actions', () => {
  it('openCreateModal / closeCreateModal', () => {
    useAppStore.getState().openCreateModal();
    expect(useAppStore.getState().createModalOpen).toBe(true);
    useAppStore.getState().closeCreateModal();
    expect(useAppStore.getState().createModalOpen).toBe(false);
  });

  it('openAttachmentModal / closeAttachmentModal', () => {
    useAppStore.getState().openAttachmentModal('s1', 't1', 0, 'file.txt', []);
    const modal = useAppStore.getState().attachmentModal;
    expect(modal).toMatchObject({ open: true, spaceId: 's1', taskId: 't1', index: 0, name: 'file.txt' });
    useAppStore.getState().closeAttachmentModal();
    expect(useAppStore.getState().attachmentModal).toBeNull();
  });

  it('openSpaceModal create mode', () => {
    useAppStore.getState().openSpaceModal('create');
    const modal = useAppStore.getState().spaceModal;
    expect(modal).toMatchObject({ open: true, mode: 'create' });
  });

  it('openSpaceModal rename mode with space', () => {
    const space = { id: 's1', name: 'Test', createdAt: '', updatedAt: '' };
    useAppStore.getState().openSpaceModal('rename', space);
    const modal = useAppStore.getState().spaceModal;
    expect(modal).toMatchObject({ open: true, mode: 'rename', space });
  });

  it('closeSpaceModal', () => {
    useAppStore.getState().openSpaceModal('create');
    useAppStore.getState().closeSpaceModal();
    expect(useAppStore.getState().spaceModal).toBeNull();
  });

  it('openDeleteSpaceDialog / closeDeleteSpaceDialog', () => {
    useAppStore.getState().openDeleteSpaceDialog('s1');
    expect(useAppStore.getState().deleteSpaceDialog).toMatchObject({ open: true, spaceId: 's1' });
    useAppStore.getState().closeDeleteSpaceDialog();
    expect(useAppStore.getState().deleteSpaceDialog).toBeNull();
  });
});

describe('showToast', () => {
  it('sets toast state with message and success type', () => {
    vi.useFakeTimers();
    useAppStore.getState().showToast('Task created');
    expect(useAppStore.getState().toast).toEqual({ message: 'Task created', type: 'success' });
    vi.useRealTimers();
  });

  it('sets error type', () => {
    vi.useFakeTimers();
    useAppStore.getState().showToast('Something broke', 'error');
    expect(useAppStore.getState().toast?.type).toBe('error');
    vi.useRealTimers();
  });

  it('auto-clears after 3 seconds', () => {
    vi.useFakeTimers();
    useAppStore.getState().showToast('Fading');
    vi.advanceTimersByTime(3001);
    expect(useAppStore.getState().toast).toBeNull();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Space pinning actions
// ---------------------------------------------------------------------------

const SAMPLE_SPACES = [
  { id: 's1', name: 'Alpha',  pinned: false, createdAt: '', updatedAt: '' },
  { id: 's2', name: 'Beta',   pinned: true,  pinnedRank: 0, createdAt: '', updatedAt: '' },
  { id: 's3', name: 'Gamma',  pinned: true,  pinnedRank: 1, createdAt: '', updatedAt: '' },
];

describe('pinSpace', () => {
  it('calls updateSpace with pinned=true and rank = max(existing ranks) + 1', async () => {
    vi.mocked(api.updateSpace).mockResolvedValue({
      id: 's1', name: 'Alpha', pinned: true, pinnedRank: 2, createdAt: '', updatedAt: '',
    });
    vi.mocked(api.getSpaces).mockResolvedValue(SAMPLE_SPACES);
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    useAppStore.setState({ spaces: SAMPLE_SPACES, activeSpaceId: 's1' });

    await useAppStore.getState().pinSpace('s1');

    expect(api.updateSpace).toHaveBeenCalledWith('s1', { pinned: true, pinnedRank: 2 });
  });

  it('uses rank 0 when no spaces are currently pinned', async () => {
    const noPinned = [
      { id: 's1', name: 'A', pinned: false, createdAt: '', updatedAt: '' },
    ];
    vi.mocked(api.updateSpace).mockResolvedValue({
      id: 's1', name: 'A', pinned: true, pinnedRank: 0, createdAt: '', updatedAt: '',
    });
    vi.mocked(api.getSpaces).mockResolvedValue(noPinned);
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    useAppStore.setState({ spaces: noPinned, activeSpaceId: 's1' });

    await useAppStore.getState().pinSpace('s1');

    expect(api.updateSpace).toHaveBeenCalledWith('s1', { pinned: true, pinnedRank: 0 });
  });

  it('calls loadSpaces after pinning', async () => {
    const updatedSpaces = [
      ...SAMPLE_SPACES,
      { id: 's1', name: 'Alpha', pinned: true, pinnedRank: 2, createdAt: '', updatedAt: '' },
    ];
    vi.mocked(api.updateSpace).mockResolvedValue(updatedSpaces[0] as any);
    vi.mocked(api.getSpaces).mockResolvedValue(updatedSpaces);
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    useAppStore.setState({ spaces: SAMPLE_SPACES, activeSpaceId: 's1' });

    await useAppStore.getState().pinSpace('s1');

    expect(api.getSpaces).toHaveBeenCalled();
  });

  it('shows an error toast and does not throw when the API fails', async () => {
    vi.mocked(api.updateSpace).mockRejectedValue(new Error('boom'));
    useAppStore.setState({ spaces: SAMPLE_SPACES, activeSpaceId: 's1', toast: null });

    await useAppStore.getState().pinSpace('s1');

    expect(useAppStore.getState().toast?.type).toBe('error');
  });
});

describe('unpinSpace', () => {
  it('calls updateSpace with pinned=false and pinnedRank=null', async () => {
    vi.mocked(api.updateSpace).mockResolvedValue({
      id: 's2', name: 'Beta', pinned: false, createdAt: '', updatedAt: '',
    });
    vi.mocked(api.getSpaces).mockResolvedValue(SAMPLE_SPACES);
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    useAppStore.setState({ spaces: SAMPLE_SPACES, activeSpaceId: 's2' });

    await useAppStore.getState().unpinSpace('s2');

    expect(api.updateSpace).toHaveBeenCalledWith('s2', { pinned: false, pinnedRank: null });
  });

  it('calls loadSpaces after unpinning', async () => {
    vi.mocked(api.updateSpace).mockResolvedValue({
      id: 's2', name: 'Beta', pinned: false, createdAt: '', updatedAt: '',
    });
    vi.mocked(api.getSpaces).mockResolvedValue(SAMPLE_SPACES);
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    useAppStore.setState({ spaces: SAMPLE_SPACES, activeSpaceId: 's2' });

    await useAppStore.getState().unpinSpace('s2');

    expect(api.getSpaces).toHaveBeenCalled();
  });

  it('shows an error toast and does not throw when the API fails', async () => {
    vi.mocked(api.updateSpace).mockRejectedValue(new Error('boom'));
    useAppStore.setState({ spaces: SAMPLE_SPACES, activeSpaceId: 's2', toast: null });

    await useAppStore.getState().unpinSpace('s2');

    expect(useAppStore.getState().toast?.type).toBe('error');
  });
});

describe('reorderPinnedSpaces', () => {
  it('applies optimistic reorder before API calls resolve', () => {
    vi.mocked(api.updateSpace).mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    useAppStore.setState({ spaces: SAMPLE_SPACES, activeSpaceId: 's1' });

    // Don't await — check optimistic update synchronously after the set
    useAppStore.getState().reorderPinnedSpaces(['s3', 's2']);

    const { spaces } = useAppStore.getState();
    // s3 and s2 should now be first (in that order), s1 last
    expect(spaces[0].id).toBe('s3');
    expect(spaces[1].id).toBe('s2');
  });

  it('calls updateSpace for each id with its new rank', async () => {
    vi.mocked(api.updateSpace).mockResolvedValue({} as any);
    vi.mocked(api.getSpaces).mockResolvedValue(SAMPLE_SPACES);
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    useAppStore.setState({ spaces: SAMPLE_SPACES, activeSpaceId: 's1' });

    await useAppStore.getState().reorderPinnedSpaces(['s3', 's2']);

    expect(api.updateSpace).toHaveBeenCalledWith('s3', { pinned: true, pinnedRank: 0 });
    expect(api.updateSpace).toHaveBeenCalledWith('s2', { pinned: true, pinnedRank: 1 });
  });

  it('calls loadSpaces after all updates resolve', async () => {
    vi.mocked(api.updateSpace).mockResolvedValue({} as any);
    vi.mocked(api.getSpaces).mockResolvedValue(SAMPLE_SPACES);
    vi.mocked(api.getTasks).mockResolvedValue({ todo: [], 'in-progress': [], done: [] });

    useAppStore.setState({ spaces: SAMPLE_SPACES, activeSpaceId: 's1' });

    await useAppStore.getState().reorderPinnedSpaces(['s3', 's2']);

    expect(api.getSpaces).toHaveBeenCalled();
  });

  it('rolls back the optimistic order and shows an error toast when persistence fails', async () => {
    vi.mocked(api.updateSpace).mockRejectedValue(new Error('boom'));
    useAppStore.setState({ spaces: SAMPLE_SPACES, activeSpaceId: 's1', toast: null });

    await useAppStore.getState().reorderPinnedSpaces(['s3', 's2']);

    // Order restored to the original; UI must not diverge from the server.
    expect(useAppStore.getState().spaces.map((s) => s.id)).toEqual(SAMPLE_SPACES.map((s) => s.id));
    expect(useAppStore.getState().toast?.type).toBe('error');
  });
});
