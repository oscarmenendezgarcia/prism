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
import { allTasks, boardIndex, keepUnchanged, localToday, mapBoard } from '@/utils/issues';

/** Key used to persist the active space across page reloads. */
const ACTIVE_SPACE_KEY = 'prism-active-space';

const emptyBoard = (): BoardTasks => ({});

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
  tasks: BoardTasks;
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

  /** Open the detail panel for the given task. */
  openDetailPanel: (task: Task) => void;

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
  updateTask: (taskId: string, patch: UpdateTaskPayload) => Promise<void>;
  /** Someone else changed a field while this person was editing it, and they have to choose. */
  editConflict: EditConflict | null;
  /** Text to go back to editing, after a conflict. */
  resumedEdit: { taskId: string; field: EditConflict['field']; text: string; base: string } | null;
  resolveConflict: (choice: 'keep-editing' | 'theirs' | 'mine') => void;

  /**
   * Post a new comment on a task.
   * Optimistically appends to detailTask.comments and the board task's comments.
   * Throws on API failure (so CommentsSection can show the error).
   */
  addComment: (
    taskId: string,
    payload: { author: string; text: string; type: Comment['type']; parentId?: string },
  ) => Promise<void>;

  /**
   * Update an existing comment (resolve / re-open / edit text).
   * Optimistically updates detailTask.comments and the board task.
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

export const useAppStore = create<AppState>((set, get) => ({
  // ── Spaces ──────────────────────────────────────────────────────────────

  spaces: [],
  activeSpaceId: safeStorage.getItem(ACTIVE_SPACE_KEY) || 'default',

  setActiveSpace: (id: string) => {
    safeStorage.setItem(ACTIVE_SPACE_KEY, id);
    // An epic of the old space would hide every card in the new one.
    set({
      activeSpaceId: id, epicFilter: null,
      ...(id !== get().activeSpaceId && { tasks: emptyBoard() }),
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
  isMutating: false,
  mutatingTaskIds: new Set<string>(),

  today: localToday(),

  loadBoard: async () => {
    const { activeSpaceId, showToast } = get();
    try {
      const data = await api.getTasks(activeSpaceId);
      // The user may have moved to another space while this was on its way.
      if (get().activeSpaceId !== activeSpaceId) return;
      // An epic that is gone would leave the board empty, with nothing to clear the filter.
      const { epicFilter } = get();
      const epicGone = epicFilter !== null && !allTasks(data).some((t) => t.id === epicFilter && t.type === 'epic');
      const today = localToday();
      set({ tasks: keepUnchanged(get().tasks, data), ...(epicGone && { epicFilter: null }), ...(today !== get().today && { today }) });
      // Someone changed the statuses: the board must show them as they are now.
      const known = get().spaces.find((s) => s.id === activeSpaceId)?.statuses;
      const columns = Object.keys(data);
      if (known && (columns.length !== known.length || columns.some((id) => !known.some((s) => s.id === id)))) {
        set({ spaces: await api.getSpaces() });
      }
    } catch (err) {
      showToast(`Failed to load tasks: ${(err as Error).message}`, 'error');
    }
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
    const { activeSpaceId, spaces, loadBoard, showToast } = get();
    const target = spaces.find((s) => s.id === activeSpaceId)?.statuses?.find((s) => s.id === statusId);

    set({ isMutating: true, mutatingTaskIds: addMutatingId(get().mutatingTaskIds, taskId) });
    try {
      await api.moveTask(activeSpaceId, taskId, statusId);
      showToast(`Moved to ${target?.name ?? statusId}`);
      await loadBoard();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      set({ isMutating: false, mutatingTaskIds: removeMutatingId(get().mutatingTaskIds, taskId) });
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

  openDetailPanel: (task: Task) => {
    set({ detailTask: task });
  },

  closeDetailPanel: () => {
    set({ detailTask: null });
  },

  editConflict: null,
  resumedEdit: null,

  resolveConflict: (choice) => {
    const conflict = get().editConflict;
    if (!conflict) return;
    const { taskId, field, mine, theirs } = conflict;
    set({ editConflict: null });
    if (choice === 'mine') {
      void get().updateTask(taskId, { [field]: mine, base: { [field]: theirs } });
      set({ resumedEdit: { taskId, field, text: mine, base: mine } });
      return;
    }
    const text = choice === 'theirs' ? theirs : mine;
    set({ resumedEdit: { taskId, field, text, base: theirs } });
    // The panel may have closed as they saved, and they asked to go on.
    if (choice === 'keep-editing' && get().detailTask?.id !== taskId) {
      const task = boardIndex(get().tasks).byId.get(taskId);
      if (task) get().openDetailPanel(task);
    }
  },

  updateTask: async (taskId: string, { base, ...patch }: UpdateTaskPayload) => {
    const { activeSpaceId, tasks, detailTask, showToast } = get();

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
      set({
        // The response does not derive these, and a poll would flicker them back.
        tasks: mapBoard(get().tasks, (t) => (t.id === taskId
          ? { ...updated, ...(!('dependsOn' in patch) && { isBlocked: t.isBlocked, blockedByCount: t.blockedByCount }) }
          : t)),
        detailTask: get().detailTask?.id === taskId ? updated : get().detailTask,
      });

      showToast('Saved');
    } catch (err) {
      // Roll back optimistic changes on error. A panel closed meanwhile stays closed.
      set({ tasks, ...(get().detailTask?.id === detailTask?.id && { detailTask }) });
      const { code, details } = err as { code?: string; details?: Omit<EditConflict, 'taskId' | 'mine' | 'key'> };
      if (code === 'EDIT_CONFLICT' && details) {
        // Nothing is lost: what they wrote waits for them to choose.
        const { field, theirs, by, at } = details;
        const mine = patch[field as 'title' | 'description'] ?? '';
        const key = boardIndex(tasks).byId.get(taskId)?.key;
        set({ editConflict: { taskId, key, field, mine, theirs, by, at } });
        void get().loadBoard();
      } else {
        showToast(`Failed to save: ${(err as Error).message}`, 'error');
      }
    } finally {
      set({ isMutating: false, mutatingTaskIds: removeMutatingId(get().mutatingTaskIds, taskId) });
    }
  },

  // ── Task comments (task-ui-comments) ────────────────────────────────────

  addComment: async (taskId, payload) => {
    const { activeSpaceId, showToast } = get();
    try {
      const comment = await api.createComment(activeSpaceId, taskId, payload);

      const applyAdd = (t: Task): Task => {
        if (t.id !== taskId) return t;
        return { ...t, comments: [...(t.comments ?? []), comment] };
      };

      const currentTasks = get().tasks;
      set({
        tasks: mapBoard(currentTasks, applyAdd),
        ...(get().detailTask?.id === taskId ? { detailTask: applyAdd(get().detailTask as Task) } : {}),
      });
    } catch (err) {
      showToast(`Failed to post comment: ${(err as Error).message}`, 'error');
      throw err;
    }
  },

  patchComment: async (taskId, commentId, patch) => {
    const { activeSpaceId, showToast } = get();
    try {
      const updated = await api.updateComment(activeSpaceId, taskId, commentId, patch);

      const applyPatch = (t: Task): Task => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          comments: (t.comments ?? []).map((c) => (c.id === commentId ? updated : c)),
        };
      };

      const currentTasks = get().tasks;
      set({
        tasks: mapBoard(currentTasks, applyPatch),
        ...(get().detailTask?.id === taskId ? { detailTask: applyPatch(get().detailTask as Task) } : {}),
      });
      if (patch.resolved) void useTaskRunStore.getState().load(activeSpaceId); // The agent may be starting again.
    } catch (err) {
      showToast(`Failed to update comment: ${(err as Error).message}`, 'error');
      throw err;
    }
  },

  answerQuestion: async (taskId, questionCommentId, text) => {
    const { activeSpaceId, showToast } = get();
    try {
      const { question, answer } = await api.answerQuestion(activeSpaceId, taskId, questionCommentId, text);

      const applyAnswer = (t: Task): Task => {
        if (t.id !== taskId) return t;
        const comments = (t.comments ?? []).map((c) =>
          c.id === questionCommentId ? { ...c, ...question } : c,
        );
        comments.push(answer);
        return { ...t, comments };
      };

      const currentTasks = get().tasks;
      set({
        tasks: mapBoard(currentTasks, applyAnswer),
        ...(get().detailTask?.id === taskId ? { detailTask: applyAnswer(get().detailTask as Task) } : {}),
      });
      void useTaskRunStore.getState().load(activeSpaceId); // The agent may be starting again.
    } catch (err) {
      showToast(`Failed to answer question: ${(err as Error).message}`, 'error');
      throw err;
    }
  },

  // ── Epic filter ───────────────────────────────────────────────────────────

  epicFilter:    null,
  setEpicFilter: (epicId) => set({ epicFilter: epicId }),

  // ── Global search (ADR-1: global-search) ─────────────────────────────────

  isGlobalSearchOpen: false,
  openGlobalSearch:   () => set({ isGlobalSearchOpen: true }),
  closeGlobalSearch:  () => set({ isGlobalSearchOpen: false }),
}));

export const useTasks = () => useAppStore((s) => s.tasks);
export const useToast = () => useAppStore((s) => s.toast);
/** T-1: true during the exit animation window (200ms before toast clears). */
export const useToastLeaving = () => useAppStore((s) => s.toastLeaving);

