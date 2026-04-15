/**
 * Centralized Zustand store for Prism.
 * ADR-002: replaces scattered module-level variables across app.js, spaces.js, terminal.js.
 *
 * All cross-cutting state lives here: spaces, tasks, active space, mutations,
 * modal visibility, toast, and terminal open/closed.
 */

import { create } from 'zustand';
import * as api from '@/api/client';
// Imported via getState() to avoid circular imports with useRunHistoryStore.
// ADR-1 (Agent Run History) §5.1: all lifecycle calls use getState() boundary.
import { useRunHistoryStore } from '@/stores/useRunHistoryStore';
import { usePipelineLogStore } from '@/stores/usePipelineLogStore';
// ADR-1 (multi-tab-terminal): terminal state has moved to useTerminalSessionStore.
// getState() boundary avoids circular imports.
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
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
  ConfigFile,
  AgentInfo,
  AgentRun,
  BackendRun,
  PipelineState,
  PipelineStage,
  PreparedRun,
  AgentSettings,
  TaggerSuggestion,
  TaggerResult,
} from '@/types';

/** Keys used to persist state across page reloads. */
const ACTIVE_SPACE_KEY = 'prism-active-space';
const CONFIG_OPEN_KEY  = 'config-panel:open';

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
  // System info (fetched once at startup)
  /** OS platform string from the backend — 'darwin' | 'linux' | 'win32' | ... */
  platform: string | null;
  loadSystemInfo: () => Promise<void>;

  // Spaces
  spaces: Space[];
  activeSpaceId: string;
  setActiveSpace: (id: string) => void;
  loadSpaces: () => Promise<void>;
  createSpace: (name: string, workingDirectory?: string, pipeline?: string[]) => Promise<void>;
  renameSpace: (id: string, name: string, workingDirectory?: string, pipeline?: string[]) => Promise<void>;
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

  /** Agents discovered from ~/.claude/agents/*.md */
  availableAgents: AgentInfo[];
  loadAgents: (workingDirectory?: string) => Promise<void>;

  /** Non-null while an agent command is running in the PTY. */
  activeRun: AgentRun | null;
  clearActiveRun: () => void;
  cancelAgentRun: () => void;

  /**
   * Handle for the setInterval poll loop started by executeAgentRun.
   * Stored in state so cancelAgentRun can clear it without a closure leak.
   * BUG-001: poll interval must be cleared on cancel to prevent a stale tick.
   */
  _agentRunPollId: ReturnType<typeof setInterval> | null;

  /** Prepared run waiting in the prompt preview modal. */
  preparedRun: PreparedRun | null;
  prepareAgentRun: (taskId: string, agentId: string, dangerouslySkipPermissions?: boolean, skipPreview?: boolean) => Promise<void>;
  clearPreparedRun: () => void;

  /** Execute the prepared run — injects command into the terminal PTY. */
  executeAgentRun: () => Promise<void>;

  /** Whether the prompt preview modal is open. */
  promptPreviewOpen: boolean;

  /** Active pipeline state — null when no pipeline is running. */
  pipelineState: PipelineState | null;
  startPipeline: (spaceId: string, taskId: string, stages?: PipelineStage[], checkpoints?: number[], dangerouslySkipPermissions?: boolean) => Promise<void>;
  advancePipeline: () => Promise<void>;
  /**
   * T-3 (manual checkpoints): resume a paused pipeline.
   * The current checkpoint is consumed (not re-triggered) and the pipeline
   * advances to execute the paused stage.
   */
  resumePipeline: () => Promise<void>;
  /** Resume a backend-interrupted run via POST /api/v1/runs/:runId/resume. */
  resumeInterruptedRun: () => Promise<void>;
  abortPipeline: () => void;
  /** Silently dismiss the pipeline indicator without sending Ctrl+C or toasting. */
  clearPipeline: () => void;
  /**
   * Attach to a backend run that is already executing (e.g. after a page
   * refresh or a backend resume). Sets pipelineState so the log panel opens.
   */
  attachRun: (state: PipelineState) => void;
  /**
   * T-4 (orchestrator mode): dispatch a single-stage run using the
   * `orchestrator` agent, which sub-launches the full pipeline internally.
   * Does not use the per-stage PipelineState — shows a simplified "Orchestrator
   * running" indicator via activeRun only.
   */
  executeOrchestratorRun: (spaceId: string, taskId: string, stages: PipelineStage[], dangerouslySkipPermissions?: boolean) => Promise<void>;

  /** Pipeline confirm modal — shown when user clicks "Run Pipeline" on a card. */
  pipelineConfirmModal: {
    open: boolean;
    spaceId: string;
    taskId: string;
    stages: PipelineStage[];
    /** T-3: indices into stages[] where the pipeline should pause before executing. */
    checkpoints: number[];
    /** T-4: when true, the modal will call executeOrchestratorRun instead of startPipeline. */
    useOrchestratorMode: boolean;
  } | null;
  openPipelineConfirm: (spaceId: string, taskId: string) => void;
  closePipelineConfirm: () => void;

  /** Agent settings panel open state. */
  agentSettingsPanelOpen: boolean;
  setAgentSettingsPanelOpen: (open: boolean) => void;

  // ── Agent settings (ADR-1: Settings Persistence) ──────────────────────────

  agentSettings: AgentSettings | null;
  settingsLoading: boolean;
  loadSettings: () => Promise<void>;
  saveSettings: (partial: Partial<AgentSettings>) => Promise<void>;

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

  // ── Tagger agent (ADR-1: Tagger Agent) ───────────────────────────────────

  /** True while a tagger API call is in flight. Disables the TaggerButton. */
  taggerLoading: boolean;
  /** Suggestions returned by the tagger endpoint. */
  taggerSuggestions: TaggerSuggestion[];
  /** Whether the TaggerReviewModal is open. */
  taggerModalOpen: boolean;
  /** Non-null when the tagger call returned an error. */
  taggerError: string | null;

  /** Called immediately on button click — sets taggerLoading=true, clears previous state. */
  startTagger: () => void;
  /** Called when the API returns successfully — stores suggestions and opens modal. */
  setSuggestions: (result: TaggerResult) => void;
  /** Resets all tagger state and closes the modal. */
  closeTagger: () => void;
  /** Stores an error message and clears the loading flag. */
  setTaggerError: (message: string) => void;
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
  // ── System info ─────────────────────────────────────────────────────────

  platform: null,

  loadSystemInfo: async () => {
    try {
      const info = await api.getSystemInfo();
      set({ platform: info.platform });
    } catch {
      // Non-critical — caffeinate will simply not be applied if this fails.
    }
  },

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

  createSpace: async (name: string, workingDirectory?: string, pipeline?: string[]) => {
    const newSpace = await api.createSpace(name, workingDirectory, pipeline);
    get().setActiveSpace(newSpace.id);
    await get().loadSpaces();
    get().showToast('Space created.');
  },

  renameSpace: async (id: string, name: string, workingDirectory?: string, pipeline?: string[]) => {
    await api.renameSpace(id, name, workingDirectory, pipeline);
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
      const files = await api.getConfigFiles(get().activeSpaceId);
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
      const file = await api.getConfigFile(fileId, get().activeSpaceId);
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
      await api.saveConfigFile(activeConfigFileId, activeConfigContent, get().activeSpaceId);
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

  availableAgents: [],
  loadAgents: async (workingDirectory?: string) => {
    try {
      const agents = await api.getAgents(workingDirectory);
      set({ availableAgents: agents });
    } catch (err) {
      get().showToast(`Failed to load agents: ${(err as Error).message}`, 'error');
    }
  },

  activeRun: null,
  _agentRunPollId: null,
  clearActiveRun: () => set({ activeRun: null }),

  cancelAgentRun: () => {
    const { activeRun, showToast } = get();
    const terminalSender = useTerminalSessionStore.getState().activeSendInput();

    // Record cancellation in history before clearing activeRun.
    if (activeRun) {
      const durationMs = Date.now() - Date.parse(activeRun.startedAt);
      const runs = useRunHistoryStore.getState().runs;
      const activeRecord = runs.find(
        (r) => r.status === 'running' && r.taskId === activeRun.taskId
      );
      if (activeRecord) {
        useRunHistoryStore.getState().recordRunFinished(activeRecord.id, 'cancelled', durationMs);
      }

      if (activeRun.backendRunId) {
        // Backend spawn run — cancel via API (fire-and-forget).
        api.deleteRun(activeRun.backendRunId).catch(() => {});

        // BUG-002: clear pipelineState synchronously for single-stage runs so
        // the log panel closes immediately instead of waiting up to one poll cycle.
        // activeRun must be read before it is cleared below.
        const ps    = get().pipelineState;
        const runId = activeRun.backendRunId;
        if (ps && ps.stages.length === 1 && ps.runId === runId) {
          set({ pipelineState: null });
          usePipelineLogStore.getState().setLogPanelOpen(false);
        }

        showToast('Agent run cancelled.');
      } else if (terminalSender) {
        // PTY run — send Ctrl+C.
        terminalSender('\x03');
        showToast('Agent run cancelled.');
      } else {
        showToast('Run cleared.', 'error');
      }
    }

    // BUG-001: clear the poll loop before nulling activeRun so the interval
    // callback cannot fire a final tick after cancellation.
    clearInterval(get()._agentRunPollId ?? undefined);
    set({ activeRun: null, _agentRunPollId: null });
  },

  preparedRun:      null,
  promptPreviewOpen: false,

  prepareAgentRun: async (taskId: string, agentId: string, dangerouslySkipPermissions = false, skipPreview = false) => {
    const { activeSpaceId, agentSettings, showToast } = get();
    try {
      const result = await api.generatePrompt({
        agentId,
        taskId,
        spaceId:          activeSpaceId,
        workingDirectory: agentSettings?.prompts.workingDirectory,
        dangerouslySkipPermissions,
      });
      set({
        preparedRun: {
          taskId,
          agentId,
          spaceId:                    activeSpaceId,
          promptPath:                 result.promptPath,
          cliCommand:                 result.cliCommand,
          promptPreview:              result.promptPreview,
          promptFull:                 result.promptFull,
          estimatedTokens:            result.estimatedTokens,
          dangerouslySkipPermissions,
        },
        promptPreviewOpen: !skipPreview,
      });
    } catch (err) {
      showToast(`Failed to prepare agent run: ${(err as Error).message}`, 'error');
    }
  },

  clearPreparedRun: () => set({ preparedRun: null, promptPreviewOpen: false }),

  executeAgentRun: async () => {
    const { preparedRun } = get();
    if (!preparedRun) return;
    // Treat a single-agent run as a 1-stage pipeline — same code path for all runs.
    const { spaceId, taskId, agentId, dangerouslySkipPermissions } = preparedRun;
    set({ preparedRun: null, promptPreviewOpen: false });
    await get().startPipeline(spaceId, taskId, [agentId as PipelineStage], [], dangerouslySkipPermissions ?? false);
  },

  // ── Pipeline ──────────────────────────────────────────────────────────────

  pipelineState: null,
  pipelineConfirmModal: null,

  openPipelineConfirm: (spaceId: string, taskId: string) => {
    const { agentSettings, spaces, tasks, detailTask } = get();
    const space = spaces.find((s) => s.id === spaceId);

    // T-008: resolution chain — task.pipeline > space.pipeline > agentSettings > DEFAULT_STAGES
    // Search all board columns and the open detail panel for the task.
    const allBoardTasks = [
      ...tasks.todo,
      ...tasks['in-progress'],
      ...tasks.done,
      ...(detailTask ? [detailTask] : []),
    ];
    const boardTask    = allBoardTasks.find((t) => t.id === taskId);
    const taskPipeline = boardTask?.pipeline && boardTask.pipeline.length > 0
      ? boardTask.pipeline
      : null;

    const stages = (
      taskPipeline ??
      (space?.pipeline && space.pipeline.length > 0 ? space.pipeline : null) ??
      agentSettings?.pipeline?.stages ??
      ['senior-architect', 'ux-api-designer', 'developer-agent', 'qa-engineer-e2e']
    ) as PipelineStage[];
    set({
      pipelineConfirmModal: {
        open: true,
        spaceId,
        taskId,
        stages,
        checkpoints: [],
        useOrchestratorMode: false,
      },
    });
  },

  closePipelineConfirm: () => {
    set({ pipelineConfirmModal: null });
  },

  startPipeline: async (spaceId: string, taskId: string, stages?: PipelineStage[], checkpoints: number[] = [], dangerouslySkipPermissions = false) => {
    const { agentSettings, availableAgents, showToast, spaces, tasks } = get();
    const space = spaces.find((s) => s.id === spaceId);
    const resolvedStages: PipelineStage[] = stages && stages.length > 0
      ? stages
      : (
          (space?.pipeline && space.pipeline.length > 0 ? space.pipeline : null) ??
          agentSettings?.pipeline?.stages ??
          ['senior-architect', 'ux-api-designer', 'developer-agent', 'qa-engineer-e2e']
        ) as PipelineStage[];

    // T-3: pause at stage 0 before creating any backend run.
    if (checkpoints.includes(0)) {
      set({
        pipelineState: {
          spaceId,
          stages: resolvedStages,
          currentStageIndex: 0,
          startedAt: new Date().toISOString(),
          status: 'paused',
          taskId,
          subTaskIds: [],
          checkpoints,
          pausedBeforeStage: 0,
          dangerouslySkipPermissions,
        },
      });
      showToast(`Pipeline paused before stage 1: ${resolvedStages[0]}. Click Continue to proceed.`);
      return;
    }

    // Launch ALL stages at once — backend manages stage transitions.
    let run: BackendRun;
    try {
      run = await api.startRun(spaceId, taskId, resolvedStages, undefined, checkpoints);
    } catch (err) {
      showToast(`Failed to start pipeline: ${(err as Error).message}`, 'error');
      return;
    }

    const startedAt        = run.createdAt;
    const firstAgent       = availableAgents.find((a) => a.id === resolvedStages[0]);
    const firstDisplayName = firstAgent?.displayName ?? resolvedStages[0];

    set({
      pipelineState: {
        spaceId,
        stages: resolvedStages,
        currentStageIndex: 0,
        startedAt,
        status: 'running',
        taskId,
        subTaskIds: [],
        checkpoints,
        dangerouslySkipPermissions,
        runId: run.runId,
      },
      // Keep activeRun set so task-card indicator and abort buttons work.
      activeRun: {
        taskId,
        agentId:      resolvedStages[0],
        spaceId,
        startedAt,
        cliCommand:   '',
        promptPath:   '',
        backendRunId: run.runId,
      },
    });

    usePipelineLogStore.getState().clearStageLogs();
    usePipelineLogStore.getState().setSelectedStageIndex(0);
    usePipelineLogStore.getState().setLogPanelOpen(true);

    // Record in run history.
    const allTasks  = [...tasks['todo'], ...tasks['in-progress'], ...tasks['done']];
    const task      = allTasks.find((t) => t.id === taskId);
    const displayLabel = resolvedStages.length > 1
      ? `Pipeline: ${resolvedStages.map((s) => availableAgents.find((a) => a.id === s)?.displayName ?? s).join(' → ')}`
      : firstDisplayName;

    useRunHistoryStore.getState().recordRunStarted({
      id:               run.runId,
      taskId,
      taskTitle:        task?.title ?? `Task ${taskId}`,
      agentId:          resolvedStages.length > 1 ? 'pipeline' : resolvedStages[0],
      agentDisplayName: displayLabel,
      spaceId,
      spaceName:        space?.name ?? spaceId,
      startedAt,
      cliCommand:       '',
      promptPath:       '',
    });

    const stageLabel = resolvedStages.length > 1
      ? `${resolvedStages.length} stages`
      : firstDisplayName;
    showToast(`Pipeline started — ${stageLabel}`);
  },

  advancePipeline: async () => {
    const { pipelineState } = get();
    if (!pipelineState || pipelineState.status !== 'running') return;
    // Backend-managed runs: the backend handles stage transitions automatically.
    // syncPipelineState() in usePolling keeps the frontend in sync.
    if (pipelineState.runId) return;
  },

  abortPipeline: () => {
    const { pipelineState, showToast } = get();
    if (!pipelineState) return;

    // If this is a server-side run, cancel via REST API - Issue 5 fix.
    if (pipelineState.runId) {
      api.deleteRun(pipelineState.runId).catch(() => {});
    }

    const terminalSender = useTerminalSessionStore.getState().activeSendInput();
    if (terminalSender) {
      terminalSender('\x03'); // Ctrl+C
    }

    const stage = pipelineState.currentStageIndex + 1;
    set({ pipelineState: null, activeRun: null });
    showToast(`Pipeline aborted at stage ${stage}.`);
  },
  clearPipeline: () => {
    const { pipelineState } = get();
    if (pipelineState?.runId && pipelineState.status !== 'completed') {
      api.deleteRun(pipelineState.runId).catch(() => {});
    }
    set({ pipelineState: null, activeRun: null });
  },

  attachRun: (state) => set({ pipelineState: state }),

  /**
   * Resume a backend-interrupted run via POST /api/v1/runs/:runId/resume.
   * Updates pipelineState to 'running' so the indicator live-tracks again.
   */
  resumeInterruptedRun: async () => {
    const { pipelineState, showToast } = get();
    if (!pipelineState?.runId) return;
    if (pipelineState.status !== 'interrupted' && pipelineState.status !== 'paused') return;
    try {
      await api.resumeRun(pipelineState.runId);
      set({
        pipelineState: {
          ...pipelineState,
          status: 'running',
          pausedBeforeStage: undefined,
          finishedAt: undefined,
        },
      });
    } catch {
      showToast('Failed to resume run.', 'error');
    }
  },

  /**
   * T-3 (manual checkpoints): resume a paused pipeline.
   * Removes the current pausedBeforeStage from checkpoints so the same stage
   * does not pause again on the next run, then executes the paused stage.
   */
  resumePipeline: async () => {
    const { pipelineState, showToast } = get();
    if (!pipelineState || pipelineState.status !== 'paused') return;

    // Backend run already created — just tell it to resume.
    if (pipelineState.runId) {
      try {
        await api.resumeRun(pipelineState.runId);
        set({ pipelineState: { ...pipelineState, status: 'running', pausedBeforeStage: undefined } });
        showToast('Pipeline resumed.');
      } catch (err) {
        showToast(`Failed to resume: ${(err as Error).message}`, 'error');
      }
      return;
    }

    // Stage-0 pause (before any backend run was created) — now launch the backend run.
    const remainingCheckpoints = (pipelineState.checkpoints ?? []).filter((c) => c !== 0);
    try {
      const run = await api.startRun(pipelineState.spaceId, pipelineState.taskId, pipelineState.stages, undefined, remainingCheckpoints);
      set({
        pipelineState: {
          ...pipelineState,
          status: 'running',
          pausedBeforeStage: undefined,
          checkpoints: remainingCheckpoints,
          runId: run.runId,
        },
        activeRun: {
          taskId:       pipelineState.taskId,
          agentId:      pipelineState.stages[0],
          spaceId:      pipelineState.spaceId,
          startedAt:    run.createdAt,
          cliCommand:   '',
          promptPath:   '',
          backendRunId: run.runId,
        },
      });
      usePipelineLogStore.getState().clearStageLogs();
      usePipelineLogStore.getState().setLogPanelOpen(true);
      showToast('Pipeline started.');
    } catch (err) {
      showToast(`Failed to start pipeline: ${(err as Error).message}`, 'error');
    }
  },

  /**
   * T-4 (orchestrator mode): dispatch a backend run using the orchestrator
   * agent.  The orchestrator receives the stages list as context and launches
   * each sub-agent internally using the `Agent` tool.  The frontend shows a
   * simplified "Orchestrator running" state via activeRun (no per-stage
   * PipelineState).
   */
  executeOrchestratorRun: async (spaceId: string, taskId: string, stages: PipelineStage[], dangerouslySkipPermissions = false) => {
    const { showToast, tasks, spaces, availableAgents, platform, pipelineConfirmModal } = get();
    const terminalSender = useTerminalSessionStore.getState().activeSendInput();
    const startedAt = new Date().toISOString();

    let cliCommand: string;
    let promptPath: string;
    let backendRunId: string | undefined;

    if (terminalSender) {
      // Terminal is open — generate a prompt file and inject the command into PTY.
      let generated;
      try {
        generated = await api.generatePrompt({
          agentId:            'orchestrator',
          taskId,
          spaceId,
          customInstructions: `Pipeline stages to execute in order: ${stages.join(' → ')}`,
          dangerouslySkipPermissions,
        });
      } catch (err) {
        showToast(`Failed to prepare orchestrator prompt: ${(err as Error).message}`, 'error');
        return;
      }
      cliCommand = generated.cliCommand;
      promptPath = generated.promptPath;
      // Part 3: caffeinate -i on macOS prevents idle sleep during long runs.
      const finalCmd = platform === 'darwin' ? `caffeinate -i ${cliCommand}` : cliCommand;
      const sent = terminalSender(finalCmd + '\r');
      if (!sent) {
        showToast('Could not send to terminal. Please try again.', 'error');
        return;
      }
    } else {
      const checkpoints = pipelineConfirmModal?.checkpoints ?? [];
      // No terminal — spawn in backend.
      promptPath = '~/.claude/agents/orchestrator.md';
      cliCommand = `orchestrator (${stages.join(' → ')})`;
      try {
        const run = await api.startRun(spaceId, taskId, ['orchestrator'], { stages, dangerouslySkipPermissions }, checkpoints);
        backendRunId = run.runId;
      } catch (err) {
        showToast(`Failed to start orchestrator run: ${(err as Error).message}`, 'error');
        return;
      }
    }

    set({
      activeRun: {
        taskId,
        agentId:    'orchestrator',
        spaceId,
        startedAt,
        cliCommand,
        promptPath,
        ...(backendRunId ? { backendRunId } : {}),
      },
    });

    // Set pipelineState so PipelineLogPanel becomes visible and can poll logs.
    if (backendRunId) {
      set({
        pipelineState: {
          spaceId,
          stages,
          currentStageIndex: 0,
          startedAt,
          status:      'running',
          taskId,
          subTaskIds:  [],
          checkpoints: [],
          runId:       backendRunId,
        },
      });
      usePipelineLogStore.getState().clearStageLogs();
      usePipelineLogStore.getState().setSelectedStageIndex(0);
      usePipelineLogStore.getState().setLogPanelOpen(true);
    }

    // Register in run history so it appears in the history panel.
    const allTasks     = [...tasks['todo'], ...tasks['in-progress'], ...tasks['done']];
    const task         = allTasks.find((t) => t.id === taskId);
    const space        = spaces.find((s) => s.id === spaceId);
    const historyRunId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    useRunHistoryStore.getState().recordRunStarted({
      id:               historyRunId,
      taskId,
      taskTitle:        task?.title ?? `Task ${taskId}`,
      agentId:          'orchestrator',
      agentDisplayName: availableAgents.find((a) => a.id === 'orchestrator')?.displayName ?? 'Orchestrator',
      spaceId,
      spaceName:        space?.name ?? spaceId,
      startedAt,
      cliCommand,
      promptPath,
    });

    showToast(`Orchestrator started — ${stages.length} stages queued.`);

    // For backend runs (no terminal): poll for completion.
    if (backendRunId) {
      const runIdToWatch = backendRunId;
      const POLL_MS = 5000;
      const pollId = setInterval(async () => {
        try {
          const run = await api.getBackendRun(runIdToWatch);
          // Keep pipelineState.currentStageIndex in sync with backend.
          const ps = get().pipelineState;
          if (ps && ps.runId === runIdToWatch && typeof run.currentStage === 'number') {
            set({ pipelineState: { ...ps, currentStageIndex: run.currentStage } });
          }
          // Surface interrupted state so InterruptedBanner shows.
          if (run.status === 'interrupted') {
            clearInterval(pollId);
            set({ _agentRunPollId: null });
            get().clearActiveRun();
            const ps2 = get().pipelineState;
            if (ps2 && ps2.runId === runIdToWatch && ps2.status !== 'interrupted') {
              set({ pipelineState: { ...ps2, status: 'interrupted' } });
            }
            return;
          }
          // Part 2: surface paused state so the UI can show "Continue".
          if (run.status === 'paused') {
            const ps = get().pipelineState;
            if (ps && ps.runId === runIdToWatch && ps.status !== 'paused') {
              set({
                pipelineState: {
                  ...ps,
                  status: 'paused',
                  ...(typeof run.pausedBeforeStage === 'number'
                    ? { currentStageIndex: run.pausedBeforeStage, pausedBeforeStage: run.pausedBeforeStage }
                    : {}),
                },
              });
            }
          }
          if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
            clearInterval(pollId);
            set({ _agentRunPollId: null });
            const durationMs = Date.now() - Date.parse(startedAt);
            useRunHistoryStore.getState().recordRunFinished(
              historyRunId,
              run.status === 'completed' ? 'completed' : 'failed',
              durationMs,
            );
            const finalPs = get().pipelineState;
            if (finalPs && finalPs.runId === runIdToWatch) {
              const terminalStatus = run.status === 'completed' ? 'completed' : 'aborted';
              set({ pipelineState: { ...finalPs, status: terminalStatus } });
              setTimeout(() => set({ pipelineState: null }), 3000);
            }
            get().clearActiveRun();
            get().loadBoard();
            if (run.status === 'completed') {
              showToast('Orchestrator run completed.');
            } else {
              showToast(`Orchestrator run ${run.status}.`, 'error');
            }
          }
        } catch {
          clearInterval(pollId);
          set({ _agentRunPollId: null });
          get().clearActiveRun();
          const ps = get().pipelineState;
          if (ps && ps.runId === runIdToWatch) {
            set({ pipelineState: null });
          }
        }
      }, POLL_MS);
      set({ _agentRunPollId: pollId });
    }
  },

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

  // ── Task detail panel (ADR-1: task-detail-edit) ───────────────────────────

  detailTask: null,

  openDetailPanel: (task: Task) => {
    set({ detailTask: task });
  },

  closeDetailPanel: () => {
    set({ detailTask: null });
  },

  updateTask: async (taskId: string, patch: UpdateTaskPayload) => {
    const { activeSpaceId, tasks, detailTask, showToast } = get();

    // Optimistic update: apply patch immediately in-place across all columns.
    const applyOptimistic = (columnTasks: Task[]): Task[] =>
      columnTasks.map((t) =>
        t.id === taskId ? { ...t, ...patch } : t
      );

    const optimisticTasks: BoardTasks = {
      'todo':        applyOptimistic(tasks['todo']),
      'in-progress': applyOptimistic(tasks['in-progress']),
      'done':        applyOptimistic(tasks['done']),
    };

    // Also optimistically update detailTask if it's the same task.
    const optimisticDetail =
      detailTask?.id === taskId ? { ...detailTask, ...patch } : detailTask;

    set({ isMutating: true, tasks: optimisticTasks, detailTask: optimisticDetail });

    try {
      const updated = await api.updateTask(activeSpaceId, taskId, patch);

      // Reconcile with server response (authoritative timestamps, etc.).
      const reconciled = (columnTasks: Task[]): Task[] =>
        columnTasks.map((t) => (t.id === taskId ? updated : t));

      set({
        tasks: {
          'todo':        reconciled(get().tasks['todo']),
          'in-progress': reconciled(get().tasks['in-progress']),
          'done':        reconciled(get().tasks['done']),
        },
        detailTask: get().detailTask?.id === taskId ? updated : get().detailTask,
      });

      showToast('Saved');
    } catch (err) {
      // Roll back optimistic changes on error.
      set({ tasks, detailTask });
      showToast(`Failed to save: ${(err as Error).message}`, 'error');
    } finally {
      set({ isMutating: false });
    }
  },

  // ── Tagger agent (ADR-1: Tagger Agent) ───────────────────────────────────

  taggerLoading:     false,
  taggerSuggestions: [],
  taggerModalOpen:   false,
  taggerError:       null,

  startTagger: () => {
    set({ taggerLoading: true, taggerSuggestions: [], taggerModalOpen: false, taggerError: null });
  },

  setSuggestions: (result: TaggerResult) => {
    set({
      taggerLoading:     false,
      taggerSuggestions: result.suggestions,
      taggerModalOpen:   true,
      taggerError:       null,
    });
  },

  closeTagger: () => {
    set({
      taggerLoading:     false,
      taggerSuggestions: [],
      taggerModalOpen:   false,
      taggerError:       null,
    });
  },

  setTaggerError: (message: string) => {
    set({ taggerLoading: false, taggerError: message });
  },
}));

// Convenience selector hooks for common slices
export const useActiveSpaceId = () => useAppStore((s) => s.activeSpaceId);
export const useSpaces = () => useAppStore((s) => s.spaces);
export const useTasks = () => useAppStore((s) => s.tasks);
export const useIsMutating = () => useAppStore((s) => s.isMutating);
export const useToast = () => useAppStore((s) => s.toast);
/** T-1: true during the exit animation window (200ms before toast clears). */
export const useToastLeaving = () => useAppStore((s) => s.toastLeaving);
/** @deprecated Use useTerminalSessionStore(s => s.panelOpen) instead. */
export const useTerminalOpen = () => useTerminalSessionStore((s) => s.panelOpen);

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

// Tagger selectors
export const useTaggerLoading     = () => useAppStore((s) => s.taggerLoading);
export const useTaggerSuggestions = () => useAppStore((s) => s.taggerSuggestions);
export const useTaggerModalOpen   = () => useAppStore((s) => s.taggerModalOpen);
export const useTaggerError       = () => useAppStore((s) => s.taggerError);
