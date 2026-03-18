/**
 * Centralized Zustand store for Prism.
 * ADR-002: replaces scattered module-level variables across app.js, spaces.js, terminal.js.
 *
 * All cross-cutting state lives here: spaces, tasks, active space, mutations,
 * modal visibility, toast, and terminal open/closed.
 */

import { create } from 'zustand';
import * as api from '@/api/client';
import type {
  Space,
  Task,
  BoardTasks,
  Column,
  CreateTaskPayload,
  AttachmentModalState,
  SpaceModalState,
  DeleteSpaceDialogState,
  ToastState,
  ConfigFile,
} from '@/types';

/** Keys used to persist state across page reloads. */
const ACTIVE_SPACE_KEY  = 'prism-active-space';
const TERMINAL_OPEN_KEY = 'terminal:open';
const CONFIG_OPEN_KEY   = 'config-panel:open';

const COLUMNS: Column[] = ['todo', 'in-progress', 'done'];

const COLUMN_LABELS: Record<Column, string> = {
  'todo': 'Todo',
  'in-progress': 'In Progress',
  'done': 'Done',
};

const emptyBoard = (): BoardTasks => ({
  'todo': [],
  'in-progress': [],
  'done': [],
});

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface AppState {
  // Spaces
  spaces: Space[];
  activeSpaceId: string;
  setActiveSpace: (id: string) => void;
  loadSpaces: () => Promise<void>;
  createSpace: (name: string) => Promise<void>;
  renameSpace: (id: string, name: string) => Promise<void>;
  deleteSpace: (id: string) => Promise<void>;

  // Tasks
  tasks: BoardTasks;
  isMutating: boolean;
  loadBoard: () => Promise<void>;
  createTask: (payload: CreateTaskPayload) => Promise<void>;
  moveTask: (taskId: string, direction: 'left' | 'right', currentColumn: Column) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;

  // Create task modal
  createModalOpen: boolean;
  openCreateModal: () => void;
  closeCreateModal: () => void;

  // Attachment modal
  attachmentModal: AttachmentModalState | null;
  openAttachmentModal: (spaceId: string, taskId: string, index: number, name: string) => void;
  closeAttachmentModal: () => void;

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
  showToast: (message: string, type?: 'success' | 'error') => void;

  // Terminal
  terminalOpen: boolean;
  toggleTerminal: () => void;
  setTerminalOpen: (open: boolean) => void;

  // Config editor (ADR-1: Config Editor Panel)
  configPanelOpen: boolean;
  configFiles: ConfigFile[];
  activeConfigFileId: string | null;
  /** Current textarea value — may differ from activeConfigOriginal when dirty. */
  activeConfigContent: string;
  /** Last-saved content — used for dirty detection. */
  activeConfigOriginal: string;
  /** True when activeConfigContent !== activeConfigOriginal. */
  configDirty: boolean;
  /** True while fetching the file list or file content. */
  configLoading: boolean;
  /** True while a save operation is in flight. */
  configSaving: boolean;

  toggleConfigPanel: () => void;
  setConfigPanelOpen: (open: boolean) => void;
  loadConfigFiles: () => Promise<void>;
  selectConfigFile: (fileId: string) => Promise<void>;
  setConfigContent: (content: string) => void;
  saveConfigFile: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useAppStore = create<AppState>((set, get) => ({
  // ── Spaces ──────────────────────────────────────────────────────────────

  spaces: [],
  activeSpaceId: localStorage.getItem(ACTIVE_SPACE_KEY) || 'default',

  setActiveSpace: (id: string) => {
    localStorage.setItem(ACTIVE_SPACE_KEY, id);
    set({ activeSpaceId: id });
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

  createSpace: async (name: string) => {
    const newSpace = await api.createSpace(name);
    // Switch to the newly created space
    get().setActiveSpace(newSpace.id);
    await get().loadSpaces();
    get().showToast('Space created.');
  },

  renameSpace: async (id: string, name: string) => {
    await api.renameSpace(id, name);
    await get().loadSpaces();
    get().showToast(`Space renamed to "${name}"`);
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

  // ── Tasks ───────────────────────────────────────────────────────────────

  tasks: emptyBoard(),
  isMutating: false,

  loadBoard: async () => {
    const { activeSpaceId, showToast } = get();
    try {
      const data = await api.getTasks(activeSpaceId);
      set({ tasks: data });
    } catch (err) {
      showToast(`Failed to load tasks: ${(err as Error).message}`, 'error');
    }
  },

  createTask: async (payload: CreateTaskPayload) => {
    const { activeSpaceId, closeCreateModal, loadBoard, showToast } = get();
    set({ isMutating: true });
    try {
      await api.createTask(activeSpaceId, payload);
      closeCreateModal();
      await loadBoard();
      showToast('Task created');
    } catch (err) {
      showToast((err as Error).message, 'error');
      throw err; // Re-throw so the modal can re-enable the submit button
    } finally {
      set({ isMutating: false });
    }
  },

  moveTask: async (taskId: string, direction: 'left' | 'right', currentColumn: Column) => {
    const { activeSpaceId, loadBoard, showToast } = get();
    const idx = COLUMNS.indexOf(currentColumn);
    const targetColumn: Column = direction === 'left' ? COLUMNS[idx - 1] : COLUMNS[idx + 1];

    set({ isMutating: true });
    try {
      await api.moveTask(activeSpaceId, taskId, targetColumn);
      showToast(`Moved to ${COLUMN_LABELS[targetColumn]}`);
      await loadBoard();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      set({ isMutating: false });
    }
  },

  deleteTask: async (taskId: string) => {
    const { activeSpaceId, loadBoard, showToast } = get();
    set({ isMutating: true });
    try {
      await api.deleteTask(activeSpaceId, taskId);
      showToast('Task deleted');
      await loadBoard();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      set({ isMutating: false });
    }
  },

  // ── Create task modal ────────────────────────────────────────────────────

  createModalOpen: false,
  openCreateModal: () => set({ createModalOpen: true }),
  closeCreateModal: () => set({ createModalOpen: false }),

  // ── Attachment modal ─────────────────────────────────────────────────────

  attachmentModal: null,
  openAttachmentModal: (spaceId, taskId, index, name) =>
    set({ attachmentModal: { open: true, spaceId, taskId, index, name } }),
  closeAttachmentModal: () => set({ attachmentModal: null }),

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
  showToast: (message, type = 'success') => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { message, type } });
    toastTimer = setTimeout(() => {
      set({ toast: null });
      toastTimer = null;
    }, 3000);
  },

  // ── Terminal ─────────────────────────────────────────────────────────────

  terminalOpen: localStorage.getItem(TERMINAL_OPEN_KEY) === '1',

  toggleTerminal: () => {
    const next = !get().terminalOpen;
    if (next) {
      localStorage.setItem(TERMINAL_OPEN_KEY, '1');
    } else {
      localStorage.removeItem(TERMINAL_OPEN_KEY);
    }
    set({ terminalOpen: next });
  },

  setTerminalOpen: (open: boolean) => {
    if (open) {
      localStorage.setItem(TERMINAL_OPEN_KEY, '1');
    } else {
      localStorage.removeItem(TERMINAL_OPEN_KEY);
    }
    set({ terminalOpen: open });
  },

  // ── Config editor ─────────────────────────────────────────────────────────

  configPanelOpen:     localStorage.getItem(CONFIG_OPEN_KEY) === '1',
  configFiles:         [],
  activeConfigFileId:  null,
  activeConfigContent: '',
  activeConfigOriginal: '',
  configDirty:         false,
  configLoading:       false,
  configSaving:        false,

  toggleConfigPanel: () => {
    const next = !get().configPanelOpen;
    if (next) {
      localStorage.setItem(CONFIG_OPEN_KEY, '1');
    } else {
      localStorage.removeItem(CONFIG_OPEN_KEY);
    }
    set({ configPanelOpen: next });
  },

  setConfigPanelOpen: (open: boolean) => {
    if (open) {
      localStorage.setItem(CONFIG_OPEN_KEY, '1');
    } else {
      localStorage.removeItem(CONFIG_OPEN_KEY);
    }
    set({ configPanelOpen: open });
  },

  loadConfigFiles: async () => {
    set({ configLoading: true });
    try {
      const files = await api.getConfigFiles();
      set({ configFiles: files });
    } catch (err) {
      get().showToast(`Failed to load config files: ${(err as Error).message}`, 'error');
    } finally {
      set({ configLoading: false });
    }
  },

  selectConfigFile: async (fileId: string) => {
    set({ configLoading: true });
    try {
      const file = await api.getConfigFile(fileId);
      set({
        activeConfigFileId:   file.id,
        activeConfigContent:  file.content,
        activeConfigOriginal: file.content,
        configDirty:          false,
      });
    } catch (err) {
      get().showToast(`Failed to load file: ${(err as Error).message}`, 'error');
    } finally {
      set({ configLoading: false });
    }
  },

  setConfigContent: (content: string) => {
    const { activeConfigOriginal } = get();
    set({
      activeConfigContent: content,
      configDirty:         content !== activeConfigOriginal,
    });
  },

  saveConfigFile: async () => {
    const { activeConfigFileId, activeConfigContent, showToast } = get();
    if (!activeConfigFileId) return;

    set({ configSaving: true });
    try {
      await api.saveConfigFile(activeConfigFileId, activeConfigContent);
      set({
        activeConfigOriginal: activeConfigContent,
        configDirty:          false,
      });
      showToast('File saved');
    } catch (err) {
      showToast(`Failed to save file: ${(err as Error).message}`, 'error');
    } finally {
      set({ configSaving: false });
    }
  },
}));

// Convenience selector hooks for common slices
export const useActiveSpaceId = () => useAppStore((s) => s.activeSpaceId);
export const useSpaces = () => useAppStore((s) => s.spaces);
export const useTasks = () => useAppStore((s) => s.tasks);
export const useIsMutating = () => useAppStore((s) => s.isMutating);
export const useToast = () => useAppStore((s) => s.toast);
export const useTerminalOpen = () => useAppStore((s) => s.terminalOpen);

// Named export for direct task access by column
export const useColumnTasks = (column: Column): Task[] =>
  useAppStore((s) => s.tasks[column]);

// Config editor selectors
export const useConfigPanelOpen    = () => useAppStore((s) => s.configPanelOpen);
export const useConfigFiles        = () => useAppStore((s) => s.configFiles);
export const useActiveConfigFileId = () => useAppStore((s) => s.activeConfigFileId);
export const useConfigDirty        = () => useAppStore((s) => s.configDirty);
export const useConfigLoading      = () => useAppStore((s) => s.configLoading);
export const useConfigSaving       = () => useAppStore((s) => s.configSaving);
