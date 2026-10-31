/**
 * Centralized Zustand store for Prism.
 * ADR-002: replaces scattered module-level variables across app.js, spaces.js, terminal.js.
 *
 * All cross-cutting state lives here: spaces, tasks, active space, mutations,
 * modal visibility, and toast.
 */

import { create } from 'zustand';
import * as api from '@/api/client';
import { useTaskRunStore } from '@/stores/useTaskRunStore';
import { updateSpace as apiUpdateSpace } from '@/api/client';
import type {
  Space,
  Task,
  BoardEpic,
  BoardTasks,
  Column,
  CreateTaskPayload,
  UpdateTaskPayload,
  Attachment,
  AttachmentModalState,
  MarkdownModalState,
  SpaceModalState,
  DeleteSpaceDialogState,
  ToastState,
  Comment,
  EditConflict,
} from '@/types';
import { safeStorage } from '@/utils/safeStorage';
import { boardIndex, keepUnchanged, localToday, mapBoard } from '@/utils/issues';

/** Key used to persist the active space across page reloads. */
const ACTIVE_SPACE_KEY = 'prism-active-space';

const emptyBoard = (): BoardTasks => ({});

/** How many more cards "Show more" brings, and the most a column can ask the server for. */
const SHOW_MORE_STEP = 100;
export const MAX_COLUMN_LIMIT = 2000;

/**
 * Immutable helpers for `mutatingTaskIds`. Always return a fresh Set so
 * Zustand's default reference equality re-renders the affected selectors.
 */
function addMutatingId(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev);
  next.add(id);
  return next;
}
function removeMutatingId(prev: Set<string>, id: string): Set<string> {
  if (!prev.has(id)) return prev;
  const next = new Set(prev);
  next.delete(id);
  return next;
}
/** Batch variant of `addMutatingId` for mutations that touch several tasks at once (e.g. rank rebalance). */
function addMutatingIds(prev: Set<string>, ids: string[]): Set<string> {
  const next = new Set(prev);
  for (const id of ids) next.add(id);
  return next;
}
/** Batch variant of `removeMutatingId`; returns `prev` unchanged when nothing applies. */
function removeMutatingIds(prev: Set<string>, ids: string[]): Set<string> {
  if (!ids.some((id) => prev.has(id))) return prev;
  const next = new Set(prev);
  for (const id of ids) next.delete(id);
  return next;
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface AppState {
  // Spaces
  spaces: Space[];
  activeSpaceId: string;
  setActiveSpace: (id: string) => void;
  loadSpaces: () => Promise<void>;
  createSpace: (name: string, workingDirectory?: string, key?: string) => Promise<void>;
  renameSpace: (id: string, name: string, workingDirectory?: string, key?: string) => Promise<void>;
  deleteSpace: (id: string) => Promise<void>;
  /** Pin a space — appends it to the pinned zone with the next available rank. */
  pinSpace: (id: string) => Promise<void>;
  /** Unpin a space — removes it from the pinned zone. */
  unpinSpace: (id: string) => Promise<void>;
  /** Persist a new order for the pinned zone. Optimistic local update first. */
  reorderPinnedSpaces: (orderedIds: string[]) => Promise<void>;

  // Tasks
  /** The cards loaded of each column: not all there are. See columnTotals. */
  tasks: BoardTasks;
  /** How many cards each column really has, with the epic filter on if there is one. */
  columnTotals: Record<Column, number>;
  /** The ranks of the cards next to those loaded, for a drop at the end of what is loaded. */
  columnBounds: Record<Column, { rankBefore?: number; rankAfter?: number }>;
  /** How many cards a column was asked to show. Only those "Show more" raised. */
  columnLimits: Record<Column, number>;
  /** Every epic of the space, loaded or not. */
  epics: BoardEpic[];
  /** The space and filter the loaded cards are of, which change later than what was asked for. */
  boardScope: string;
  /** Which version of the board the browser has. Changes when anything on it does. */
  boardVersion: string | null;
  /** Load more of a column: of a done one, the cards before those it shows. */
  showMoreCards: (column: Column) => Promise<void>;
  /**
   * Global "any mutation in flight" flag. Used by polling loops to skip a
   * refetch that would clobber optimistic state, and by createTask (which has
   * no taskId yet to scope per-task). For per-card gating (disabling move /
   * delete on a specific card), read `mutatingTaskIds` instead — that way an
   * in-flight move on one card doesn't disable the buttons on every other.
   */
  isMutating: boolean;
  /**
   * IDs of tasks that currently have an in-flight mutation (move / delete /
   * updateTask / reorder). Scoped per-task so only the affected card shows a
   * disabled state; the rest of the board stays interactive.
   */
  mutatingTaskIds: Set<string>;
  /** The local date, kept current by polling, for what depends on the day. */
  today: string;
  loadBoard: () => Promise<void>;
  /** Pick up changes made elsewhere to the spaces, such as a renamed status. */
  refreshSpaces: () => Promise<void>;
  createTask: (payload: CreateTaskPayload) => Promise<void>;
  /** Move a task to a status of the active space. */
  moveTask: (taskId: string, statusId: Column) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  reorderTask: (taskId: string, column: Column, newRank: number) => Promise<void>;
  /**
   * Atomically re-rank multiple tasks in a single column. All updates are sent
   * in one server request wrapped in a SQLite transaction: either every rank
   * lands or none do. On failure the entire column is rolled back to the
   * pre-batch snapshot — never a mixed old/new state.
   */
  reorderTasks: (column: Column, updates: Array<{ id: string; rank: number }>) => Promise<void>;

  // Create task modal
  createModalOpen: boolean;
  openCreateModal: () => void;
  closeCreateModal: () => void;

  // Attachment modal
  attachmentModal: AttachmentModalState | null;
  openAttachmentModal: (spaceId: string, taskId: string, index: number, name: string, attachments: Attachment[]) => void;
  closeAttachmentModal: () => void;

  // Markdown modal (rendered .md viewer)
  markdownModal: MarkdownModalState | null;
  openMarkdownModal: (title: string, content: string, source?: string) => void;
  closeMarkdownModal: () => void;

  // Space modal (create/rename)
  spaceModal: SpaceModalState | null;
  openSpaceModal: (mode: 'create' | 'rename', space?: Space) => void;
  closeSpaceModal: () => void;

  // Delete space dialog
  deleteSpaceDialog: DeleteSpaceDialogState | null;
  openDeleteSpaceDialog: (spaceId: string) => void;
  closeDeleteSpaceDialog: () => void;

  // Toast
  toast: ToastState | null;
  /** T-1: true during the 200ms exit animation window before toast is cleared */
  toastLeaving: boolean;
  showToast: (message: string, type?: 'success' | 'error' | 'info', action?: { label: string; onClick: () => void }) => void;

  // ── Task detail panel (ADR-1: task-detail-edit) ───────────────────────────

  /**
   * The task currently shown in the detail panel.
   * null means the panel is closed.
   */
  detailTask: Task | null;

  /**
   * Whether detailTask is the issue in full. Until then it may be a card, with only the
   * beginning of the description, or something less, and its description must not be saved.
   */
  detailLoaded: boolean;

  /** Open the detail panel for the given task, and get it in full. */
  openDetailPanel: (task: Task) => void;

  /** Bring the issue open in the panel up to date. If it no longer exists, close the panel. */
  refreshDetail: () => Promise<void>;

  /** Close the detail panel and clear detailTask. */
  closeDetailPanel: () => void;

  /**
   * Update a task's editable fields via the PUT endpoint.
   * Applies an optimistic update to the board and refreshes detailTask on success.
   * Uses the current activeSpaceId from the store — no spaceId argument needed.
   *
   * @param taskId - The task to update.
   * @param patch  - Partial payload; only present keys are sent.
   */
  /** @returns Whether it was saved. */
  updateTask: (taskId: string, patch: UpdateTaskPayload) => Promise<boolean>;
  /** Someone else changed a field while this person was editing it, and they have to choose. */
  editConflict: EditConflict | null;
  /** Others waiting for that one to be settled. */
  conflictQueue: EditConflict[];
  /** Text to go back to editing, after a conflict. */
  resumedEdit: { taskId: string; field: EditConflict['field']; text: string; base: string; focus?: boolean } | null;
  resolveConflict: (choice: 'keep-editing' | 'theirs' | 'mine') => void;

  /**
   * Post a new comment on a task.
   * Appends to detailTask.comments, and updates what the card says about its questions.
   * Throws on API failure (so CommentsSection can show the error).
   */
  addComment: (
    taskId: string,
    payload: { author: string; text: string; type: Comment['type']; parentId?: string },
  ) => Promise<void>;

  /**
   * Update an existing comment (resolve / re-open / edit text).
   * Updates detailTask.comments, and what the card says about its questions.
   * Throws on API failure.
   */
  patchComment: (
    taskId: string,
    commentId: string,
    patch: { resolved?: boolean; text?: string },
  ) => Promise<void>;

  /**
   * Answer an open question: posts the linked 'answer' comment and marks the
   * question as resolved (the server unblocks a run waiting on it, when it
   * was the task's last open question).
   * Optimistically updates the question and appends the answer in place.
   * Throws on API failure.
   */
  answerQuestion: (taskId: string, questionCommentId: string, text: string) => Promise<void>;

  // ── Epic filter ───────────────────────────────────────────────────────────

  /** Id of the epic the board shows (null = show all). */
  epicFilter: string | null;
  setEpicFilter: (epicId: string | null) => void;

  // ── Global search (ADR-1: global-search) ─────────────────────────────────

  /** Whether the GlobalSearchModal is currently open. */
  isGlobalSearchOpen: boolean;
  /** Open the GlobalSearchModal. */
  openGlobalSearch: () => void;
  /** Close the GlobalSearchModal. */
  closeGlobalSearch: () => void;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** Saves of an issue so far, to tell a board read before one from one read after. */
let savesStarted = 0;
let movesInFlight = 0;

/** The version of the board in `tasks`. Reset whenever `tasks` stops being what it describes. */
let boardEtag: string | null = null;
let boardRequests = 0;
let boardApplied = 0;

/** The same for the issue in the panel, and what stops a read from undoing a write around it. */
let detailEtag: string | null = null;
let detailRequests = 0;
let detailWrites = 0;
let detailWritesInFlight = 0;

const boardQueryKey = (s: { epicFilter: string | null; columnLimits: Record<string, number> }) =>
  JSON.stringify([s.epicFilter, s.columnLimits]);

/** Questions open on an issue, as a card shows them, from its comments. */
function questionsOf(comments: Comment[] | undefined): Pick<Task, 'pendingQuestions' | 'pendingQuestionText'> {
  const open = (comments ?? []).filter((c) => c.type === 'question' && !c.resolved);
  return { pendingQuestions: open.length, pendingQuestionText: open[0]?.text };
}

/** What the server worked out for a card, which an answer about just that issue does not bring. */
function cardFields(card: Task): Partial<Task> {
  const { epic, parentKey, progress, pendingQuestions, pendingQuestionText } = card;
  return { epic, parentKey, progress, pendingQuestions, pendingQuestionText };
}

/** Comments are only for the panel: a card has their count. */
function withoutComments({ comments: _comments, ...task }: Task): Task {
  return task;
}

/** A write of comments, during which what the panel reads must not undo it. */
async function writeComment<T>(write: () => Promise<T>, taskId: string): Promise<T> {
  detailWrites += 1;
  detailWritesInFlight += 1;
  try {
    return await write();
  } finally {
    detailWrites += 1;
    detailWritesInFlight -= 1;
    const { detailTask, refreshDetail } = useAppStore.getState();
    if (detailTask?.id === taskId) void refreshDetail();
  }
}

/** Change the comments of the issue in the panel, and what its card says about them. */
function applyToComments(taskId: string, change: (comments: Comment[]) => Comment[]): void {
  const { detailTask: open, tasks } = useAppStore.getState();
  if (open?.id !== taskId) return;
  const comments = change(open.comments ?? []);
  useAppStore.setState({
    detailTask: { ...open, comments },
    tasks: mapBoard(tasks, (t) => (t.id === taskId ? { ...t, ...questionsOf(comments) } : t)),
  });
}

export const useAppStore = create<AppState>((set, get) => ({
  // ── Spaces ──────────────────────────────────────────────────────────────

  spaces: [],
  activeSpaceId: safeStorage.getItem(ACTIVE_SPACE_KEY) || 'default',

  setActiveSpace: (id: string) => {
    safeStorage.setItem(ACTIVE_SPACE_KEY, id);
    // An epic of the old space would hide every card in the new one.
    boardEtag = null;
    set({
      activeSpaceId: id, epicFilter: null, columnLimits: {},
      ...(id !== get().activeSpaceId && {
        tasks: emptyBoard(), columnTotals: {}, columnBounds: {}, epics: [], boardScope: `${id}|`, boardVersion: null,
      }),
    });
  },

  loadSpaces: async () => {
    try {
      const spaces = await api.getSpaces();
      const { activeSpaceId, setActiveSpace, loadBoard } = get();

      // Guard: stored activeSpaceId might refer to a deleted space.
      const exists = spaces.some((s) => s.id === activeSpaceId);
      if (!exists && spaces.length > 0) {
        const fallback = spaces.find((s) => s.id === 'default') || spaces[0];
        setActiveSpace(fallback.id);
      }

      set({ spaces });
      await loadBoard();
    } catch (err) {
      get().showToast(`Failed to load spaces: ${(err as Error).message}`, 'error');
    }
  },

  createSpace: async (name: string, workingDirectory?: string, key?: string) => {
    const newSpace = await api.createSpace(name, workingDirectory, key);
    get().setActiveSpace(newSpace.id);
    await get().loadSpaces();
    get().showToast('Space created.');
  },

  renameSpace: async (id: string, name: string, workingDirectory?: string, key?: string) => {
    await api.renameSpace(id, name, workingDirectory, key);
    await get().loadSpaces();
    get().showToast('Space updated.');
  },

  deleteSpace: async (id: string) => {
    const { spaces, activeSpaceId, setActiveSpace, loadSpaces, showToast } = get();
    const spaceName = spaces.find((s) => s.id === id)?.name;

    await api.deleteSpace(id);

    // If we deleted the active space, switch to fallback
    if (id === activeSpaceId) {
      const remaining = spaces.filter((s) => s.id !== id);
      if (remaining.length > 0) {
        const fallback = remaining.find((s) => s.id === 'default') || remaining[0];
        setActiveSpace(fallback.id);
      }
    }

    await loadSpaces();
    showToast(`Space "${spaceName}" deleted.`);
  },

  // ── Space pinning ────────────────────────────────────────────────

  pinSpace: async (id: string) => {
    const { spaces, showToast } = get();
    const maxRank = Math.max(
      -1,
      ...spaces.filter((s) => s.pinned).map((s) => s.pinnedRank ?? -1),
    );
    try {
      await apiUpdateSpace(id, { pinned: true, pinnedRank: maxRank + 1 });
      await get().loadSpaces();
    } catch (err) {
      showToast(`Failed to pin space: ${(err as Error).message}`, 'error');
    }
  },

  unpinSpace: async (id: string) => {
    const { showToast } = get();
    try {
      await apiUpdateSpace(id, { pinned: false, pinnedRank: null });
      await get().loadSpaces();
    } catch (err) {
      showToast(`Failed to unpin space: ${(err as Error).message}`, 'error');
    }
  },

  reorderPinnedSpaces: async (orderedIds: string[]) => {
    const { showToast } = get();
    // Snapshot for rollback if persistence fails after the optimistic update.
    const prevSpaces = get().spaces;

    // Optimistic: reorder local state immediately so the UI snaps without a
    // round-trip. Non-pinned spaces retain their positions after the pinned block.
    set((state) => {
      const idxMap = new Map(orderedIds.map((id, i) => [id, i]));
      const pinned    = orderedIds
        .map((id) => state.spaces.find((s) => s.id === id))
        .filter(Boolean) as Space[];
      const nonPinned = state.spaces.filter((s) => !idxMap.has(s.id));
      return { spaces: [...pinned, ...nonPinned] };
    });

    try {
      // Persist each rank in parallel.
      await Promise.all(
        orderedIds.map((id, rank) =>
          apiUpdateSpace(id, { pinned: true, pinnedRank: rank }),
        ),
      );
      await get().loadSpaces();
    } catch (err) {
      // Roll back the optimistic reorder so the UI never diverges from the server.
      set({ spaces: prevSpaces });
      showToast(`Failed to reorder spaces: ${(err as Error).message}`, 'error');
    }
  },

  // ── Tasks ───────────────────────────────────────────────────────────────

  tasks: emptyBoard(),
  columnTotals: {},
  columnBounds: {},
  columnLimits: {},
  epics: [],
  boardScope: '',
  boardVersion: null,
  isMutating: false,
  mutatingTaskIds: new Set<string>(),

  today: localToday(),

  loadBoard: async () => {
    const { activeSpaceId, showToast } = get();
    try {
      const startedAt = savesStarted;
      const asked = get();
      const queryKey = boardQueryKey(asked);
      const request = ++boardRequests;
      const fresh = await api.getBoard(activeSpaceId, { limits: asked.columnLimits, epic: asked.epicFilter, etag: boardEtag });
      // The user may have moved to another space while this was on its way.
      if (get().activeSpaceId !== activeSpaceId) return;
      // From before a save, it would undo it on the screen until the next one.
      if (savesStarted !== startedAt) return;
      // Started during a move, and answered before the server applied it.
      if (movesInFlight > 0) return;
      // Of another filter, or of fewer cards than are asked for now. Whoever changed that asked again.
      if (boardQueryKey(get()) !== queryKey) return;
      const today = localToday();
      if (!fresh) {
        // Nothing changed, not even on the screen. Only the day goes on.
        if (today !== get().today) set({ today });
        // A card that is not loaded changes without the board finding out.
        const { detailTask, detailLoaded, tasks } = get();
        if (detailTask && (!detailLoaded || !boardIndex(tasks).byId.has(detailTask.id))) void get().refreshDetail();
        return;
      }
      if (request < boardApplied) return;
      boardApplied = request;
      const { data, etag } = fresh;
      // An epic that is gone would leave the board empty, with nothing to clear the filter.
      const { epicFilter } = get();
      if (epicFilter !== null && !data.epics.some((e) => e.id === epicFilter)) {
        boardEtag = null;
        set({ epicFilter: null, columnLimits: {} });
        void get().loadBoard();
        return;
      }
      boardEtag = etag;
      const statuses = Object.entries(data.columns);
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      const totals = Object.fromEntries(statuses.map(([id, column]) => [id, column.total]));
      const bounds = Object.fromEntries(statuses.map(([id, { rankBefore, rankAfter }]) => [id, { rankBefore, rankAfter }]));
      const now = get();
      set({
        tasks: keepUnchanged(now.tasks, Object.fromEntries(statuses.map(([id, column]) => [id, column.tasks]))),
        columnTotals: same(now.columnTotals, totals) ? now.columnTotals : totals,
        columnBounds: same(now.columnBounds, bounds) ? now.columnBounds : bounds,
        epics: same(now.epics, data.epics) ? now.epics : data.epics,
        boardScope: `${activeSpaceId}|${epicFilter ?? ''}`,
        boardVersion: etag,
        ...(today !== now.today && { today }),
      });
      if (get().detailTask) void get().refreshDetail();
      // Someone changed the statuses: the board must show them as they are now.
      const known = get().spaces.find((s) => s.id === activeSpaceId)?.statuses;
      const columns = Object.keys(data.columns);
      if (known && (columns.length !== known.length || columns.some((id) => !known.some((s) => s.id === id)))) {
        set({ spaces: await api.getSpaces() });
      }
    } catch (err) {
      showToast(`Failed to load tasks: ${(err as Error).message}`, 'error');
    }
  },

  showMoreCards: async (column) => {
    const { columnLimits, tasks, loadBoard } = get();
    const limit = Math.min(MAX_COLUMN_LIMIT, (columnLimits[column] ?? tasks[column]?.length ?? 0) + SHOW_MORE_STEP);
    set({ columnLimits: { ...columnLimits, [column]: limit } });
    await loadBoard();
  },

  refreshSpaces: async () => {
    try {
      const spaces = await api.getSpaces();
      // Only if something changed: every subscriber re-renders otherwise.
      if (JSON.stringify(spaces) !== JSON.stringify(get().spaces)) set({ spaces });
    } catch {
      // The next poll tries again.
    }
  },

  createTask: async (payload: CreateTaskPayload) => {
    const { activeSpaceId, closeCreateModal, loadBoard, showToast } = get();
    set({ isMutating: true });
    try {
      await api.createTask(activeSpaceId, payload);
      closeCreateModal();
      await loadBoard();
      showToast('Issue created');
    } catch (err) {
      showToast((err as Error).message, 'error');
      throw err; // Re-throw so the modal can re-enable the submit button
    } finally {
      set({ isMutating: false });
    }
  },

  moveTask: async (taskId: string, statusId: Column) => {
    const { activeSpaceId, spaces, tasks, loadBoard, showToast } = get();
    const target = spaces.find((s) => s.id === activeSpaceId)?.statuses?.find((s) => s.id === statusId);
    const source = Object.keys(tasks).find((column) => tasks[column]?.some((t) => t.id === taskId));
    const moved = source && source !== statusId ? tasks[source].find((t) => t.id === taskId) : undefined;
    // The panel shows it too, and it may be the only place that does: not every card is loaded.
    const { detailTask } = get();
    const panelBefore = detailTask?.id === taskId ? { statusId: detailTask.statusId, category: detailTask.category } : null;

    savesStarted += 1;
    movesInFlight += 1;
    detailWrites += 1;
    detailWritesInFlight += 1;
    let movedInFlight = true;
    const totals = get().columnTotals;
    set({
      isMutating: true,
      mutatingTaskIds: addMutatingId(get().mutatingTaskIds, taskId),
      ...(detailTask && panelBefore && {
        detailTask: { ...detailTask, statusId, category: target?.category ?? detailTask.category },
      }),
      // At once, and last in the column: where the server will put it.
      ...(moved && {
        columnTotals: {
          ...totals,
          [source!]: (totals[source!] ?? tasks[source!].length) - 1,
          [statusId]: (totals[statusId] ?? tasks[statusId]?.length ?? 0) + 1,
        },
        tasks: {
          ...tasks,
          [source!]: tasks[source!].filter((t) => t.id !== taskId),
          [statusId]: [
            ...(tasks[statusId] ?? []),
            {
              ...moved,
              statusId,
              category: target?.category ?? moved.category,
              rank: Math.max(0, ...(tasks[statusId] ?? []).map((t) => t.rank ?? 0)) + 1000,
            },
          ],
        },
      }),
    });
    try {
      await api.moveTask(activeSpaceId, taskId, statusId);
      // A poll that left while this was on its way still carries the old column.
      savesStarted += 1;
      movesInFlight -= 1;
      movedInFlight = false;
      showToast(`Moved to ${target?.name ?? statusId}`);
      await loadBoard();
    } catch (err) {
      if (movedInFlight) movesInFlight -= 1;
      // Only this card, and only here: the columns may have changed since, or this may be another space.
      if (moved && get().activeSpaceId === activeSpaceId) {
        const now = get().tasks;
        set({
          tasks: {
            ...now,
            [statusId]: (now[statusId] ?? []).filter((t) => t.id !== taskId),
            [source!]: [...(now[source!] ?? []).filter((t) => t.id !== taskId), moved]
              .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.createdAt.localeCompare(b.createdAt)),
          },
          columnTotals: {
            ...get().columnTotals,
            [source!]: (get().columnTotals[source!] ?? 0) + 1,
            [statusId]: Math.max(0, (get().columnTotals[statusId] ?? 0) - 1),
          },
        });
      }
      const open = get().detailTask;
      if (panelBefore && open?.id === taskId) set({ detailTask: { ...open, ...panelBefore } });
      showToast((err as Error).message, 'error');
    } finally {
      set({ isMutating: false, mutatingTaskIds: removeMutatingId(get().mutatingTaskIds, taskId) });
      detailWrites += 1;
      detailWritesInFlight -= 1;
      if (get().detailTask?.id === taskId) void get().refreshDetail();
    }
  },

  deleteTask: async (taskId: string) => {
    const { activeSpaceId, loadBoard, showToast } = get();
    set({ isMutating: true, mutatingTaskIds: addMutatingId(get().mutatingTaskIds, taskId) });
    try {
      await api.deleteTask(activeSpaceId, taskId);
      showToast('Issue deleted');
      await loadBoard();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      set({ isMutating: false, mutatingTaskIds: removeMutatingId(get().mutatingTaskIds, taskId) });
    }
  },


  reorderTasks: async (column: Column, updates: Array<{ id: string; rank: number }>) => {
    if (updates.length === 0) return;
    const { activeSpaceId, tasks, showToast } = get();
    const taskIds = updates.map((u) => u.id);
    // Snapshot the entire column for all-or-nothing rollback.
    const prevColumnTasks = [...(tasks[column] ?? [])];
    const rankById = new Map(updates.map((u) => [u.id, u.rank]));
    // Optimistic update: apply all new ranks locally in one commit and re-sort.
    const updated = (tasks[column] ?? []).map((t) =>
      rankById.has(t.id) ? { ...t, rank: rankById.get(t.id)! } : t
    );
    updated.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.createdAt.localeCompare(b.createdAt));
    // Mark the whole batch in flight so keyboard/drag guards and polling treat
    // the reorder like any other mutation (no overlapping writes, no clobbering
    // of the optimistic state by a poll mid-flight).
    set({
      tasks: { ...tasks, [column]: updated },
      isMutating: true,
      mutatingTaskIds: addMutatingIds(get().mutatingTaskIds, taskIds),
    });
    try {
      await api.reorderTasks(activeSpaceId, updates);
    } catch (err) {
      // Full-batch rollback — restore the pre-batch column snapshot verbatim.
      set({ tasks: { ...get().tasks, [column]: prevColumnTasks } });
      showToast((err as Error).message, 'error');
    } finally {
      set({ isMutating: false, mutatingTaskIds: removeMutatingIds(get().mutatingTaskIds, taskIds) });
    }
  },

  reorderTask: async (taskId: string, column: Column, newRank: number) => {
    const { activeSpaceId, tasks, showToast } = get();
    // Snapshot for rollback
    const prevColumnTasks = [...(tasks[column] ?? [])];
    // Optimistic update: set new rank and re-sort
    const updated = (tasks[column] ?? []).map((t) =>
      t.id === taskId ? { ...t, rank: newRank } : t
    );
    updated.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.createdAt.localeCompare(b.createdAt));
    // Mark in flight (same contract as moveTask / deleteTask) so rapid Alt+Arrow
    // presses and polling can't overlap the write.
    set({
      tasks: { ...tasks, [column]: updated },
      isMutating: true,
      mutatingTaskIds: addMutatingId(get().mutatingTaskIds, taskId),
    });
    try {
      await api.reorderTask(activeSpaceId, taskId, newRank);
    } catch (err) {
      // Rollback on failure
      set({ tasks: { ...get().tasks, [column]: prevColumnTasks } });
      showToast((err as Error).message, 'error');
    } finally {
      set({ isMutating: false, mutatingTaskIds: removeMutatingId(get().mutatingTaskIds, taskId) });
    }
  },

  // ── Create task modal ────────────────────────────────────────────────────

  createModalOpen: false,
  openCreateModal: () => set({ createModalOpen: true }),
  closeCreateModal: () => set({ createModalOpen: false }),

  // ── Attachment modal ─────────────────────────────────────────────────────

  attachmentModal: null,
  openAttachmentModal: (spaceId, taskId, index, name, attachments) =>
    set({ attachmentModal: { open: true, spaceId, taskId, index, name, attachments } }),
  closeAttachmentModal: () => set({ attachmentModal: null }),

  // ── Markdown modal ───────────────────────────────────────────────────────

  markdownModal: null,
  openMarkdownModal: (title, content, source) =>
    set({ markdownModal: { open: true, title, content, source } }),
  closeMarkdownModal: () => set({ markdownModal: null }),

  // ── Space modal ──────────────────────────────────────────────────────────

  spaceModal: null,
  openSpaceModal: (mode, space) =>
    set({ spaceModal: { open: true, mode, space } }),
  closeSpaceModal: () => set({ spaceModal: null }),

  // ── Delete space dialog ──────────────────────────────────────────────────

  deleteSpaceDialog: null,
  openDeleteSpaceDialog: (spaceId) =>
    set({ deleteSpaceDialog: { open: true, spaceId } }),
  closeDeleteSpaceDialog: () => set({ deleteSpaceDialog: null }),

  // ── Toast ────────────────────────────────────────────────────────────────

  toast: null,
  toastLeaving: false,
  showToast: (message, type = 'success', action?) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { message, type, action }, toastLeaving: false });
    // Toasts with action buttons stay visible longer (6s) so the user can click.
    const displayMs = action ? 6000 : 2800;
    toastTimer = setTimeout(() => {
      set({ toastLeaving: true });
      setTimeout(() => {
        set({ toast: null, toastLeaving: false });
        toastTimer = null;
      }, 200);
    }, displayMs);
  },

  // ── Task detail panel (ADR-1: task-detail-edit) ───────────────────────────

  detailTask: null,
  detailLoaded: false,

  openDetailPanel: (task: Task) => {
    // Already open: what it has is at least as complete as what this brings, which may be a card.
    if (get().detailTask?.id === task.id) {
      void get().refreshDetail();
      return;
    }
    detailEtag = null;
    set({ detailTask: task, detailLoaded: false });
    void get().refreshDetail();
  },

  closeDetailPanel: () => {
    detailEtag = null;
    set({ detailTask: null, detailLoaded: false });
  },

  refreshDetail: async () => {
    const { activeSpaceId, detailTask, detailLoaded } = get();
    if (!detailTask) return;
    const taskId = detailTask.id;
    const request = ++detailRequests;
    const writesAtStart = detailWrites;
    const isStale = () => request !== detailRequests || get().detailTask?.id !== taskId || get().activeSpaceId !== activeSpaceId;
    try {
      const fresh = await api.getTaskForPanel(activeSpaceId, taskId, detailLoaded ? detailEtag : null);
      if (isStale() || !fresh) return;
      // From before a write finished. Whoever wrote asks again when done.
      if (detailWrites !== writesAtStart || detailWritesInFlight > 0) return;
      detailEtag = fresh.etag;
      set({ detailTask: fresh.data, detailLoaded: true });
    } catch (err) {
      // Anything else, and the next poll tries again: the panel goes on waiting.
      if ((err as { code?: string }).code !== 'TASK_NOT_FOUND' || isStale()) return;
      get().showToast(`${detailTask.key ?? 'This issue'} was deleted`, 'info');
      get().closeDetailPanel();
    }
  },

  editConflict: null,
  conflictQueue: [],
  resumedEdit: null,

  resolveConflict: (choice) => {
    const conflict = get().editConflict;
    if (!conflict) return;
    const { taskId, field, mine, theirs, base } = conflict;
    const [next = null, ...rest] = get().conflictQueue;
    set({ editConflict: next, conflictQueue: rest });
    const isOpen = get().detailTask?.id === taskId;

    if (choice === 'mine') {
      if (isOpen) set({ resumedEdit: { taskId, field, text: mine, base: theirs } });
      // If it fails, they have not chosen yet, and their text has nowhere else to be.
      void get().updateTask(taskId, { [field]: mine, base: { [field]: theirs } }).then((saved) => {
        if (saved === false && !get().editConflict) set({ editConflict: conflict });
      });
    } else if (choice === 'theirs') {
      if (isOpen) set({ resumedEdit: { taskId, field, text: theirs, base: theirs } });
    } else {
      // From what it started from, so that saving asks again rather than overwrite what they saw.
      set({ resumedEdit: { taskId, field, text: mine, base, focus: true } });
      if (!isOpen) {
        const task = boardIndex(get().tasks).byId.get(taskId);
        if (task) get().openDetailPanel(task);
        else {
          // Not among the cards loaded, which says nothing about whether it exists.
          const { activeSpaceId, showToast } = get();
          void api.getTaskForPanel(activeSpaceId, taskId).then((fresh) => {
            if (fresh && get().activeSpaceId === activeSpaceId && !get().detailTask) get().openDetailPanel(fresh.data);
          }).catch((err: Error) => showToast(err.message, 'error'));
        }
      }
    }
  },

  updateTask: async (taskId: string, { base, ...patch }: UpdateTaskPayload) => {
    const { activeSpaceId, tasks, detailTask, showToast } = get();
    savesStarted += 1;
    detailWrites += 1;
    detailWritesInFlight += 1;

    // Optimistic update: apply patch immediately in-place across all statuses.
    const optimisticTasks = mapBoard(tasks, (t) => (t.id === taskId ? { ...t, ...patch } : t));

    // Also optimistically update detailTask if it's the same task.
    const optimisticDetail =
      detailTask?.id === taskId ? { ...detailTask, ...patch } : detailTask;

    set({
      isMutating: true,
      mutatingTaskIds: addMutatingId(get().mutatingTaskIds, taskId),
      tasks: optimisticTasks,
      detailTask: optimisticDetail,
    });

    try {
      const updated = await api.updateTask(activeSpaceId, taskId, { ...patch, ...(base && { base }) });

      // Reconcile with server response (authoritative timestamps, etc.).
      // The response does not derive these, and a poll would flicker them back.
      const derived = (t: Task): Partial<Task> => ({
        ...(!('dependsOn' in patch) && { isBlocked: t.isBlocked, blockedByCount: t.blockedByCount }),
      });
      const open = get().detailTask;
      set({
        tasks: mapBoard(get().tasks, (t) => (t.id === taskId
          ? { ...withoutComments(updated), ...cardFields(t), ...derived(t) }
          : t)),
        detailTask: open?.id === taskId
          ? { ...updated, ...derived(open), ...(!('parentId' in patch) && { parent: open.parent }) }
          : open,
      });

      showToast('Saved');
      // What a card shows of its place in the hierarchy is the server's to work out.
      if ('parentId' in patch || 'type' in patch) void get().loadBoard();
      return true;
    } catch (err) {
      // Roll back optimistic changes on error. Only what was changed: the rest may have arrived
      // since, such as the whole description. A panel closed meanwhile stays closed.
      const open = get().detailTask;
      let restored = open;
      if (open && open.id === taskId && detailTask?.id === taskId) {
        const fields = { ...open } as Record<string, unknown>;
        for (const field of Object.keys(patch)) {
          if (field in detailTask) fields[field] = (detailTask as unknown as Record<string, unknown>)[field];
          else delete fields[field];
        }
        restored = fields as unknown as Task;
      }
      set({ tasks, detailTask: restored });
      const { code, details } = err as { code?: string; details?: Omit<EditConflict, 'taskId' | 'mine' | 'key' | 'base'> };
      if (code === 'EDIT_CONFLICT' && details) {
        // Nothing is lost: what they wrote waits for them to choose.
        const { field, theirs, by, at } = details;
        const mine = patch[field as 'title' | 'description'] ?? '';
        const key = boardIndex(tasks).byId.get(taskId)?.key ?? (detailTask?.id === taskId ? detailTask.key : undefined);
        const conflict: EditConflict = { taskId, key, field, mine, theirs, base: base?.[field] ?? '', by, at };
        if (get().editConflict) set({ conflictQueue: [...get().conflictQueue, conflict] });
        else set({ editConflict: conflict });
        void get().loadBoard();
      } else {
        showToast(`Failed to save: ${(err as Error).message}`, 'error');
      }
      return false;
    } finally {
      set({ isMutating: false, mutatingTaskIds: removeMutatingId(get().mutatingTaskIds, taskId) });
      detailWrites += 1;
      detailWritesInFlight -= 1;
      if (get().detailTask?.id === taskId) void get().refreshDetail();
    }
  },

  // ── Task comments (task-ui-comments) ────────────────────────────────────

  addComment: async (taskId, payload) => {
    const { activeSpaceId, showToast } = get();
    try {
      const comment = await writeComment(() => api.createComment(activeSpaceId, taskId, payload), taskId);
      applyToComments(taskId, (comments) => [...comments, comment]);
    } catch (err) {
      showToast(`Failed to post comment: ${(err as Error).message}`, 'error');
      throw err;
    }
  },

  patchComment: async (taskId, commentId, patch) => {
    const { activeSpaceId, showToast } = get();
    try {
      const updated = await writeComment(() => api.updateComment(activeSpaceId, taskId, commentId, patch), taskId);
      applyToComments(taskId, (comments) => comments.map((c) => (c.id === commentId ? updated : c)));
      if (patch.resolved) void useTaskRunStore.getState().load(activeSpaceId); // The agent may be starting again.
    } catch (err) {
      showToast(`Failed to update comment: ${(err as Error).message}`, 'error');
      throw err;
    }
  },

  answerQuestion: async (taskId, questionCommentId, text) => {
    const { activeSpaceId, showToast } = get();
    try {
      const { question, answer } = await writeComment(() => api.answerQuestion(activeSpaceId, taskId, questionCommentId, text), taskId);
      applyToComments(taskId, (comments) => [
        ...comments.map((c) => (c.id === questionCommentId ? { ...c, ...question } : c)),
        answer,
      ]);
      void useTaskRunStore.getState().load(activeSpaceId); // The agent may be starting again.
    } catch (err) {
      showToast(`Failed to answer question: ${(err as Error).message}`, 'error');
      throw err;
    }
  },

  // ── Epic filter ───────────────────────────────────────────────────────────

  epicFilter:    null,
  setEpicFilter: (epicId) => {
    if (epicId === get().epicFilter) return;
    // The server filters, and what it sent was for the other filter.
    boardEtag = null;
    set({ epicFilter: epicId, columnLimits: {} });
    void get().loadBoard();
  },

  // ── Global search (ADR-1: global-search) ─────────────────────────────────

  isGlobalSearchOpen: false,
  openGlobalSearch:   () => set({ isGlobalSearchOpen: true }),
  closeGlobalSearch:  () => set({ isGlobalSearchOpen: false }),
}));

export const useTasks = () => useAppStore((s) => s.tasks);
export const useToast = () => useAppStore((s) => s.toast);
/** T-1: true during the exit animation window (200ms before toast clears). */
export const useToastLeaving = () => useAppStore((s) => s.toastLeaving);

