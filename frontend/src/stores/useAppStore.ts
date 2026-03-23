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
  MarkdownModalState,
  SpaceModalState,
  DeleteSpaceDialogState,
  ToastState,
  ConfigFile,
  AgentInfo,
  AgentRun,
  PipelineState,
  PipelineStage,
  PreparedRun,
  AgentSettings,
  ActivityEvent,
  ActivityFilter,
} from '@/types';

/** Keys used to persist state across page reloads. */
const ACTIVE_SPACE_KEY    = 'prism-active-space';
const TERMINAL_OPEN_KEY   = 'terminal:open';
const CONFIG_OPEN_KEY     = 'config-panel:open';
const ACTIVITY_OPEN_KEY   = 'activity-panel:open';

/** Maximum number of activity events held in memory at once. */
const ACTIVITY_MAX_EVENTS = 500;

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

  // ── Agent launcher (ADR-1: Agent Launcher) ────────────────────────────────

  /** Bridge function from useTerminal — null when terminal is not connected. */
  terminalSender: ((data: string) => boolean) | null;
  setTerminalSender: (fn: ((data: string) => boolean) | null) => void;

  /** Agents discovered from ~/.claude/agents/*.md */
  availableAgents: AgentInfo[];
  loadAgents: () => Promise<void>;

  /** Non-null while an agent command is running in the PTY. */
  activeRun: AgentRun | null;
  clearActiveRun: () => void;
  cancelAgentRun: () => void;

  /** Prepared run waiting in the prompt preview modal. */
  preparedRun: PreparedRun | null;
  prepareAgentRun: (taskId: string, agentId: string) => Promise<void>;
  clearPreparedRun: () => void;

  /** Execute the prepared run — injects command into the terminal PTY. */
  executeAgentRun: () => Promise<void>;

  /** Whether the prompt preview modal is open. */
  promptPreviewOpen: boolean;

  /** Active pipeline state — null when no pipeline is running. */
  pipelineState: PipelineState | null;
  startPipeline: (spaceId: string, taskId: string) => Promise<void>;
  advancePipeline: () => Promise<void>;
  abortPipeline: () => void;
  /** Silently dismiss the pipeline indicator without sending Ctrl+C or toasting. */
  clearPipeline: () => void;

  /** Agent settings panel open state. */
  agentSettingsPanelOpen: boolean;
  setAgentSettingsPanelOpen: (open: boolean) => void;

  // ── Agent settings (ADR-1: Settings Persistence) ──────────────────────────

  agentSettings: AgentSettings | null;
  settingsLoading: boolean;
  loadSettings: () => Promise<void>;
  saveSettings: (partial: Partial<AgentSettings>) => Promise<void>;

  // ── Activity Feed (ADR-1: Activity Feed) ──────────────────────────────────

  /** Whether the activity sidebar panel is visible. Persisted in localStorage. */
  activityPanelOpen: boolean;
  /** Live + loaded events. Capped at ACTIVITY_MAX_EVENTS (oldest dropped). */
  activityEvents: ActivityEvent[];
  /** Current filter applied in the activity panel. */
  activityFilter: ActivityFilter;
  /** Count of unseen events that arrived while the panel was closed. */
  activityUnreadCount: number;
  /** True while loadActivityHistory is in flight. */
  activityLoading: boolean;
  /** Cursor returned by the last loadActivityHistory call. Null when all pages exhausted. */
  activityNextCursor: string | null;

  toggleActivityPanel: () => void;
  setActivityPanelOpen: (open: boolean) => void;
  /**
   * Prepend a single event from the WebSocket broadcast.
   * Increments unreadCount when the panel is closed.
   * Drops oldest events beyond ACTIVITY_MAX_EVENTS.
   */
  addActivityEvent: (event: ActivityEvent) => void;
  /**
   * Merge partial filter fields into the current activityFilter.
   * Passing undefined for a field leaves it unchanged.
   */
  setActivityFilter: (filter: Partial<ActivityFilter>) => void;
  /**
   * Fetch a page of historical events from the REST API and append them.
   * @param cursor - Pagination cursor from a previous nextCursor value. Omit for first page.
   */
  loadActivityHistory: (cursor?: string) => Promise<void>;
  /** Reset activityUnreadCount to 0 (called when the panel is opened). */
  clearActivityUnread: () => void;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Private pipeline helpers (not part of AppState interface)
// ---------------------------------------------------------------------------

/**
 * Search the already-loaded tasks slice for a task by ID and return its title.
 * Looks across all three columns so it works regardless of the task's current position.
 * Falls back to a safe string when the task is not in the local store yet.
 *
 * ADR-1 (pipeline-subtasks): avoids an extra API round-trip because the board
 * is already loaded in Zustand when the pipeline starts.
 *
 * @param get   - Zustand get() accessor from the store closure
 * @param taskId - The task ID to look up
 */
function resolveMainTaskTitle(
  get: () => AppState,
  taskId: string,
): string {
  const tasks = get().tasks;
  const found =
    tasks['todo'].find((t) => t.id === taskId) ??
    tasks['in-progress'].find((t) => t.id === taskId) ??
    tasks['done'].find((t) => t.id === taskId);
  return found?.title ?? `Task ${taskId}`;
}

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

  // ── Agent launcher ────────────────────────────────────────────────────────

  terminalSender:    null,
  setTerminalSender: (fn) => {
    set({ terminalSender: fn });
    // When the terminal disconnects, clear any active run so the launcher
    // button re-enables. The pipeline indicator stays visible (user dismisses
    // it explicitly via the × button).
    if (!fn && get().activeRun) {
      set({ activeRun: null });
    }
  },

  availableAgents: [],
  loadAgents: async () => {
    try {
      const agents = await api.getAgents();
      set({ availableAgents: agents });
    } catch (err) {
      get().showToast(`Failed to load agents: ${(err as Error).message}`, 'error');
    }
  },

  activeRun: null,
  clearActiveRun: () => set({ activeRun: null }),

  cancelAgentRun: () => {
    const { terminalSender, activeRun, showToast } = get();
    if (terminalSender) {
      terminalSender('\x03'); // Ctrl+C
      showToast('Agent run cancelled.');
    } else {
      showToast('Terminal disconnected — run cleared.', 'error');
    }
    set({ activeRun: null });
  },

  preparedRun:      null,
  promptPreviewOpen: false,

  prepareAgentRun: async (taskId: string, agentId: string) => {
    const { activeSpaceId, agentSettings, showToast } = get();
    try {
      const result = await api.generatePrompt({
        agentId,
        taskId,
        spaceId:          activeSpaceId,
        workingDirectory: agentSettings?.prompts.workingDirectory,
      });
      set({
        preparedRun: {
          taskId,
          agentId,
          spaceId:        activeSpaceId,
          promptPath:     result.promptPath,
          cliCommand:     result.cliCommand,
          promptPreview:  result.promptPreview,
          estimatedTokens: result.estimatedTokens,
        },
        promptPreviewOpen: true,
      });
    } catch (err) {
      showToast(`Failed to prepare agent run: ${(err as Error).message}`, 'error');
    }
  },

  clearPreparedRun: () => set({ preparedRun: null, promptPreviewOpen: false }),

  executeAgentRun: async () => {
    const { preparedRun, terminalSender, setTerminalOpen, showToast } = get();
    if (!preparedRun) return;

    // If terminal sender is null, open the terminal and poll until connected (up to 3s).
    let justOpened = false;
    if (!terminalSender) {
      justOpened = true;
      showToast('Opening terminal...', 'success');
      setTerminalOpen(true);
      const POLL_INTERVAL = 100;
      const POLL_TIMEOUT  = 3000;
      let elapsed = 0;
      while (elapsed < POLL_TIMEOUT) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
        elapsed += POLL_INTERVAL;
        if (get().terminalSender) break;
      }
      if (!get().terminalSender) {
        showToast('Could not connect to terminal. Please open the terminal panel and try again.', 'error');
        return;
      }
    }

    // When the terminal was just opened, the shell (zsh/bash) may still be loading
    // its rc files. Give it time to fully initialize before injecting the command,
    // otherwise the \r can be consumed during shell startup and the command appears
    // typed but not submitted.
    if (justOpened) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    const sender = get().terminalSender!;
    const cmd    = preparedRun.cliCommand;
    const sent   = sender(cmd + '\r');

    if (!sent) {
      showToast('Could not connect to terminal. Please open the terminal panel and try again.', 'error');
      return;
    }

    set({
      activeRun: {
        taskId:     preparedRun.taskId,
        agentId:    preparedRun.agentId,
        spaceId:    preparedRun.spaceId,
        startedAt:  new Date().toISOString(),
        cliCommand: cmd,
        promptPath: preparedRun.promptPath,
      },
      preparedRun:       null,
      promptPreviewOpen: false,
    });

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level:     'info',
      component: 'agent-launcher',
      event:     'agent_run_started',
      agentId:   preparedRun.agentId,
      taskId:    preparedRun.taskId,
    }));
  },

  // ── Pipeline ──────────────────────────────────────────────────────────────

  pipelineState: null,

  startPipeline: async (spaceId: string, taskId: string) => {
    const { agentSettings, availableAgents, showToast } = get();
    const stages = (agentSettings?.pipeline.stages ?? [
      'senior-architect',
      'ux-api-designer',
      'developer-agent',
      'qa-engineer-e2e',
    ]) as PipelineStage[];

    // Initialise pipeline state with an empty subTaskIds array.
    // taskId is the main anchor task — it is never moved by the pipeline.
    // ADR-1 (pipeline-subtasks): each stage gets its own dedicated sub-task.
    set({
      pipelineState: {
        spaceId,
        stages,
        currentStageIndex: 0,
        startedAt: new Date().toISOString(),
        status:    'running',
        taskId,
        subTaskIds: [],
      },
    });

    const firstStage      = stages[0];
    const mainTitle       = resolveMainTaskTitle(get, taskId);
    const agentDisplayName =
      availableAgents.find((a) => a.id === firstStage)?.displayName ?? firstStage;

    let subTask;
    try {
      subTask = await api.createTask(spaceId, {
        title:       `${mainTitle} / Stage 1: ${agentDisplayName}`,
        type:        'research',
        assigned:    firstStage,
        description: `Pipeline sub-task for stage 1. Parent task: ${taskId}`,
      });
    } catch (err) {
      showToast(
        `Pipeline aborted: could not create sub-task for stage 1 — ${(err as Error).message}`,
        'error',
      );
      set({ pipelineState: null, activeRun: null });
      return;
    }

    // Store the sub-task ID and pass it — not the main taskId — to the agent.
    set({ pipelineState: { ...get().pipelineState!, subTaskIds: [subTask.id] } });

    console.log(JSON.stringify({
      timestamp:  new Date().toISOString(),
      level:      'info',
      component:  'agent-launcher',
      event:      'pipeline_subtask_created',
      stageIndex: 0,
      subTaskId:  subTask.id,
      mainTaskId: taskId,
      agentId:    firstStage,
    }));

    await get().prepareAgentRun(subTask.id, firstStage);
    showToast(`Pipeline started — Stage 1: ${agentDisplayName}`);
  },

  advancePipeline: async () => {
    const { pipelineState, availableAgents, showToast } = get();
    if (!pipelineState || pipelineState.status !== 'running') return;

    const nextIndex = pipelineState.currentStageIndex + 1;

    if (nextIndex >= pipelineState.stages.length) {
      set({ pipelineState: { ...pipelineState, status: 'completed' } });
      showToast('Pipeline complete. All stages finished.');
      setTimeout(() => set({ pipelineState: null }), 3000);
      return;
    }

    const nextStage        = pipelineState.stages[nextIndex];
    const agentDisplayName =
      availableAgents.find((a) => a.id === nextStage)?.displayName ?? nextStage;
    const mainTitle        = resolveMainTaskTitle(get, pipelineState.taskId);

    let subTask;
    try {
      subTask = await api.createTask(pipelineState.spaceId, {
        title:       `${mainTitle} / Stage ${nextIndex + 1}: ${agentDisplayName}`,
        type:        'research',
        assigned:    nextStage,
        description: `Pipeline sub-task for stage ${nextIndex + 1}. Parent task: ${pipelineState.taskId}`,
      });
    } catch (err) {
      showToast(
        `Pipeline aborted: could not create sub-task for stage ${nextIndex + 1} — ${(err as Error).message}`,
        'error',
      );
      set({ pipelineState: null, activeRun: null });
      return;
    }

    // Advance the stage index and append the new sub-task ID atomically.
    set({
      pipelineState: {
        ...pipelineState,
        currentStageIndex: nextIndex,
        subTaskIds: [...pipelineState.subTaskIds, subTask.id],
      },
    });

    console.log(JSON.stringify({
      timestamp:  new Date().toISOString(),
      level:      'info',
      component:  'agent-launcher',
      event:      'pipeline_subtask_created',
      stageIndex: nextIndex,
      subTaskId:  subTask.id,
      mainTaskId: pipelineState.taskId,
      agentId:    nextStage,
    }));

    showToast(`Stage ${nextIndex + 1}: ${agentDisplayName}`);
    await get().prepareAgentRun(subTask.id, nextStage);
  },

  abortPipeline: () => {
    const { pipelineState, terminalSender, showToast } = get();
    if (!pipelineState) return;

    if (terminalSender) {
      terminalSender('\x03'); // Ctrl+C
    }

    const stage = pipelineState.currentStageIndex + 1;
    set({ pipelineState: null, activeRun: null });
    showToast(`Pipeline aborted at stage ${stage}.`);
  },

  clearPipeline: () => set({ pipelineState: null, activeRun: null }),

  agentSettingsPanelOpen:    false,
  setAgentSettingsPanelOpen: (open: boolean) => set({ agentSettingsPanelOpen: open }),

  // ── Agent settings ────────────────────────────────────────────────────────

  agentSettings:  null,
  settingsLoading: false,

  loadSettings: async () => {
    set({ settingsLoading: true });
    try {
      const settings = await api.getSettings();
      set({ agentSettings: settings });
    } catch (err) {
      get().showToast(`Failed to load settings: ${(err as Error).message}`, 'error');
    } finally {
      set({ settingsLoading: false });
    }
  },

  saveSettings: async (partial: Partial<AgentSettings>) => {
    try {
      const updated = await api.saveSettings(partial);
      set({ agentSettings: updated });
      get().showToast('Settings saved.');
    } catch (err) {
      get().showToast(`Failed to save settings: ${(err as Error).message}`, 'error');
    }
  },

  // ── Activity Feed ─────────────────────────────────────────────────────────

  activityPanelOpen:   localStorage.getItem(ACTIVITY_OPEN_KEY) === '1',
  activityEvents:      [],
  activityFilter:      {},
  activityUnreadCount: 0,
  activityLoading:     false,
  activityNextCursor:  null,

  toggleActivityPanel: () => {
    const next = !get().activityPanelOpen;
    if (next) {
      localStorage.setItem(ACTIVITY_OPEN_KEY, '1');
      // Clear badge when panel is opened
      set({ activityPanelOpen: true, activityUnreadCount: 0 });
    } else {
      localStorage.removeItem(ACTIVITY_OPEN_KEY);
      set({ activityPanelOpen: false });
    }
  },

  setActivityPanelOpen: (open: boolean) => {
    if (open) {
      localStorage.setItem(ACTIVITY_OPEN_KEY, '1');
      set({ activityPanelOpen: true, activityUnreadCount: 0 });
    } else {
      localStorage.removeItem(ACTIVITY_OPEN_KEY);
      set({ activityPanelOpen: false });
    }
  },

  addActivityEvent: (event: ActivityEvent) => {
    const { activityEvents, activityPanelOpen, activityUnreadCount } = get();
    // Prepend newest; drop oldest when the cap is exceeded
    const updated = [event, ...activityEvents].slice(0, ACTIVITY_MAX_EVENTS);
    set({
      activityEvents:      updated,
      activityUnreadCount: activityPanelOpen ? 0 : activityUnreadCount + 1,
    });
  },

  setActivityFilter: (filter: Partial<ActivityFilter>) => {
    const current = get().activityFilter;
    set({ activityFilter: { ...current, ...filter } });
  },

  loadActivityHistory: async (cursor?: string) => {
    const { activityFilter, activityEvents, showToast } = get();
    set({ activityLoading: true });
    try {
      const params = {
        ...activityFilter,
        limit: 50,
        ...(cursor ? { cursor } : {}),
      };
      // Always query the global (all-spaces) endpoint per Story 2.1 DoD.
      // Per-space filtering is UI-controlled via the filter dropdown, not
      // hard-coded to the active space (BUG-003 fix).
      const result = await api.getGlobalActivity(params);

      // Append fetched events (deduplicate by id to be safe)
      const existingIds = new Set(activityEvents.map((e) => e.id));
      const newEvents   = result.events.filter((e) => !existingIds.has(e.id));
      const merged      = [...activityEvents, ...newEvents].slice(0, ACTIVITY_MAX_EVENTS);
      // Persist nextCursor so the panel can pass it on the next "Load more" click (BUG-001 fix).
      set({ activityEvents: merged, activityNextCursor: result.nextCursor ?? null });
    } catch (err) {
      showToast(`Failed to load activity: ${(err as Error).message}`, 'error');
    } finally {
      set({ activityLoading: false });
    }
  },

  clearActivityUnread: () => set({ activityUnreadCount: 0 }),
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

// Agent launcher selectors
export const useActiveRun      = () => useAppStore((s) => s.activeRun);
export const useAvailableAgents = () => useAppStore((s) => s.availableAgents);
export const usePipelineState  = () => useAppStore((s) => s.pipelineState);
export const usePreparedRun    = () => useAppStore((s) => s.preparedRun);
export const usePromptPreviewOpen = () => useAppStore((s) => s.promptPreviewOpen);

// Agent settings selectors
export const useAgentSettings        = () => useAppStore((s) => s.agentSettings);
export const useAgentSettingsPanelOpen = () => useAppStore((s) => s.agentSettingsPanelOpen);

// Activity Feed selectors
export const useActivityPanelOpen   = () => useAppStore((s) => s.activityPanelOpen);
export const useActivityEvents      = () => useAppStore((s) => s.activityEvents);
export const useActivityUnreadCount = () => useAppStore((s) => s.activityUnreadCount);
export const useActivityFilter      = () => useAppStore((s) => s.activityFilter);
export const useActivityLoading     = () => useAppStore((s) => s.activityLoading);
