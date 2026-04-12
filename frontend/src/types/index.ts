/**
 * Shared TypeScript types matching the Prism REST API contracts exactly.
 * ADR-002: migrate frontend to React + TypeScript.
 */

/** The three canonical Kanban columns. */
export type Column = 'todo' | 'in-progress' | 'done';

/** A space (project board). */
export interface Space {
  id: string;
  name: string;
  workingDirectory?: string;
  pipeline?: string[]; // ordered agent IDs for this space's default pipeline
  createdAt: string;
  updatedAt: string;
}

/** Attachment metadata (content stripped in list responses). */
export interface Attachment {
  name: string;
  type: 'text' | 'file';
}

/** Full attachment content (only returned by the single-attachment endpoint). */
export interface AttachmentContent {
  name: string;
  type: 'text' | 'file';
  content: string;
  /** Only present when type === 'file' */
  source?: string;
}

/**
 * Semantic task type — v1.2.0.
 * Replaces the legacy 'task' | 'research' enum (see scripts/migrate-card-types.js).
 */
export type TaskType = 'feature' | 'bug' | 'tech-debt' | 'chore';

/** A Kanban task. */
export interface Task {
  id: string;
  title: string;
  type: TaskType;
  description?: string;
  assigned?: string;
  /**
   * Optional per-card pipeline override. When non-empty, takes precedence over
   * the space-level pipeline default when "Run Pipeline" is invoked.
   * ADR-1 (pipeline-field-per-card): resolution chain is task > space > DEFAULT_STAGES.
   */
  pipeline?: string[];
  attachments?: Attachment[];
  createdAt: string;
  updatedAt: string;
}

/** Board response — tasks grouped by column. */
export type BoardTasks = Record<Column, Task[]>;

/** Payload for POST /spaces/:spaceId/tasks */
export interface CreateTaskPayload {
  title: string;
  type: TaskType;
  /** Omit from body when empty — never send null. */
  assigned?: string;
  description?: string;
  /** Optional ordered list of agent IDs. Omit to inherit the space default. */
  pipeline?: string[];
}

/**
 * Payload for PUT /spaces/:spaceId/tasks/:taskId — partial update.
 * All fields are optional; server applies only the keys present in the body.
 * ADR-1 (task-detail-edit): no new backend endpoint — existing PUT already
 * supports partial updates by checking `'key' in body`.
 */
export interface UpdateTaskPayload {
  title?: string;
  type?: TaskType;
  /** Empty string deletes the field on the server. */
  description?: string;
  /** Empty string deletes the field on the server. */
  assigned?: string;
  /**
   * Per-card pipeline override. Non-empty array = set; empty array = clear
   * (reverts to space default). Omit to leave the field unchanged.
   */
  pipeline?: string[];
}

/** Response from PUT /spaces/:spaceId/tasks/:id/move */
export interface MoveTaskResponse {
  task: Task;
  from: Column;
  to: Column;
}

/** Generic API error shape returned by the server. */
export interface ApiError {
  code: string;
  message: string;
}

/** Attachment modal state. */
export interface AttachmentModalState {
  open: boolean;
  spaceId: string;
  taskId: string;
  index: number;
  name: string;
  /** Full attachment list for the task — enables prev/next navigation. */
  attachments: Attachment[];
}

/** Space modal state. */
export interface SpaceModalState {
  open: boolean;
  mode: 'create' | 'rename';
  space?: Space;
}

/** Delete-space dialog state. */
export interface DeleteSpaceDialogState {
  open: boolean;
  spaceId: string;
}

/** Toast notification state. */
export interface ToastState {
  message: string;
  type: 'success' | 'error' | 'info';
  /** Optional action button rendered inside the toast. */
  action?: { label: string; onClick: () => void };
}

/** Markdown viewer modal state — used to show .md attachments rendered. */
export interface MarkdownModalState {
  open: boolean;
  /** Display title shown in the modal header. */
  title: string;
  /** Raw markdown string to render. */
  content: string;
  /** Optional source file path (shown in a footer banner). */
  source?: string;
}

/** Terminal connection status. */
export type TerminalStatus = 'connecting' | 'connected' | 'disconnected';

// ---------------------------------------------------------------------------
// Agent launcher types (ADR-1: Agent Launcher)
// ---------------------------------------------------------------------------

/** Metadata for an agent definition file discovered in ~/.claude/agents/. */
export interface AgentInfo {
  id: string;          // kebab-case stem, e.g. "senior-architect"
  name: string;        // full filename, e.g. "senior-architect.md"
  displayName: string; // human-readable, e.g. "Senior Architect"
  path: string;        // absolute path on disk
  sizeBytes: number;
}

/** AgentInfo extended with full file content (returned by GET /agents/:agentId). */
export interface AgentDetail extends AgentInfo {
  content: string;
}

/** An active agent run — set in store when a run is dispatched (backend spawn or PTY). */
export interface AgentRun {
  taskId: string;
  agentId: string;
  spaceId: string;
  startedAt: string; // ISO timestamp
  cliCommand: string;
  promptPath: string;
  backendRunId?: string; // set when launched via POST /api/v1/runs (backend spawn)
}

/** Per-stage status returned by GET /api/v1/runs/:runId. */
export interface BackendStageStatus {
  index: number;
  agentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
}

/** Run object returned by the backend pipeline API. */
export interface BackendRun {
  runId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  stages: string[];
  stageStatuses?: BackendStageStatus[];
  spaceId: string;
  taskId: string;
  createdAt: string;
  updatedAt?: string;
  currentStage?: number;
}

/** The four canonical pipeline stage agent IDs. */
export type PipelineStage =
  | 'senior-architect'
  | 'ux-api-designer'
  | 'developer-agent'
  | 'qa-engineer-e2e';

/** State of an in-progress pipeline run. */
export interface PipelineState {
  spaceId: string;
  /** Main task anchor — never moved by the pipeline. */
  taskId: string;
  stages: PipelineStage[];
  currentStageIndex: number;
  startedAt: string;  // ISO timestamp
  /** ISO timestamp when the run finished (completed, aborted, or interrupted). */
  finishedAt?: string;
  status: 'running' | 'paused' | 'completed' | 'aborted' | 'interrupted';
  /**
   * Backend run ID returned by POST /api/v1/runs when the pipeline is launched
   * via backend spawn. Used by PipelineLogPanel to fetch stage logs.
   * ADR-1 (log-viewer): optional — only set when startRun() is called.
   */
  runId?: string;
  /**
   * Parallel index with stages[]. subTaskIds[i] is the Kanban ID of the
   * dedicated sub-task created for stages[i]. Grows incrementally as stages run.
   * ADR-1 (pipeline-subtasks): each agent works on its own sub-task, not the
   * main task, so completion detection is unambiguous.
   */
  subTaskIds: string[];
  /**
   * T-3 (manual checkpoints): zero-based stage indices where the pipeline
   * pauses and waits for human confirmation before executing that stage.
   * An empty array means no checkpoints (default behaviour — auto-advance).
   */
  checkpoints: number[];
  /**
   * Set when status === 'paused' to record which stage index we are waiting
   * on.  Cleared when resumePipeline() is called.
   */
  pausedBeforeStage?: number;
  dangerouslySkipPermissions?: boolean;
}

/** A prepared (but not yet executed) agent run — shown in the preview modal. */
export interface PreparedRun {
  taskId: string;
  agentId: string;
  spaceId: string;
  promptPath: string;
  cliCommand: string;
  promptPreview: string;
  promptFull: string;      // complete prompt text (T-006)
  estimatedTokens: number;
}

/** One prompt entry in a pipeline prompt preview response. */
export interface PipelinePromptPreviewEntry {
  stageIndex: number;
  agentId: string;
  promptFull: string;
  estimatedTokens: number;
}

/** Response from POST /api/v1/runs/preview-prompts. */
export interface PipelinePromptPreview {
  prompts: PipelinePromptPreviewEntry[];
}

/** CLI tool configuration. */
export interface CliSettings {
  tool: 'claude' | 'opencode' | 'custom';
  binary: string;
  flags: string[];
  promptFlag: string;
  fileInputMethod: 'cat-subshell' | 'stdin-redirect' | 'flag-file';
}

/** Pipeline orchestration configuration. */
export interface PipelineSettings {
  autoAdvance: boolean;
  confirmBetweenStages: boolean;
  stages: PipelineStage[];
}

/** Prompt content configuration. */
export interface PromptsSettings {
  includeKanbanBlock: boolean;
  includeGitBlock: boolean;
  workingDirectory: string;
  customInstructions: string;
}

/** Full launcher settings object — persisted in data/settings.json. */
export interface AgentSettings {
  cli: CliSettings;
  pipeline: PipelineSettings;
  prompts: PromptsSettings;
}

// ---------------------------------------------------------------------------
// Tagger agent types (ADR-1: Tagger Agent)
// ---------------------------------------------------------------------------

/** Options for POST /api/v1/spaces/:spaceId/tagger/run */
export interface TaggerOptions {
  /** If true, Claude also returns rewritten card descriptions. Default false. */
  improveDescriptions?: boolean;
  /** Restrict tagging to a single column. Omit to process all columns. */
  column?: 'todo' | 'in-progress' | 'done';
  /** Classification instructions from the user. If omitted, the server uses a built-in default. */
  prompt?: string;
}

/** One classification suggestion returned by the tagger endpoint. */
export interface TaggerSuggestion {
  id: string;
  title: string;
  currentType: string;
  inferredType: 'feature' | 'bug' | 'tech-debt' | 'chore';
  confidence: 'high' | 'medium' | 'low';
  /** Only present when improveDescriptions=true was requested. */
  description?: string;
}

/** Response from POST /api/v1/spaces/:spaceId/tagger/run */
export interface TaggerResult {
  suggestions: TaggerSuggestion[];
  /** Card IDs Claude could not classify. */
  skipped: string[];
  /** Model used for the inference (for observability). */
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Tagger UI state stored in useAppStore. */
export interface TaggerState {
  taggerLoading: boolean;
  taggerSuggestions: TaggerSuggestion[];
  taggerModalOpen: boolean;
  taggerError: string | null;
}

/** Request body for POST /api/v1/agent/prompt. */
export interface PromptGenerationRequest {
  agentId: string;
  taskId: string;
  spaceId: string;
  customInstructions?: string;
  workingDirectory?: string;
  dangerouslySkipPermissions?: boolean;
}

/** Response from POST /api/v1/agent/prompt. */
export interface PromptGenerationResponse {
  promptPath: string;
  promptPreview: string;
  promptFull: string;      // complete prompt text (T-005)
  cliCommand: string;
  estimatedTokens: number;
}

// ---------------------------------------------------------------------------
// Config editor types (ADR-1: Config Editor Panel)
// ---------------------------------------------------------------------------

/** A config file descriptor returned by the list endpoint (no content). */
export interface ConfigFile {
  id: string;
  name: string;
  scope: 'global' | 'agent' | 'project' | 'space-project' | 'space-agent';
  directory: string;
  sizeBytes: number;
  modifiedAt: string;
}

/** A config file with its full text content, returned by the read endpoint. */
export interface ConfigFileContent {
  id: string;
  name: string;
  scope: 'global' | 'agent' | 'project' | 'space-project' | 'space-agent';
  content: string;
  sizeBytes: number;
  modifiedAt: string;
}

/** Result returned after a successful save — metadata only, no content echo. */
export interface ConfigFileSaveResult {
  id: string;
  name: string;
  scope: 'global' | 'agent' | 'project' | 'space-project' | 'space-agent';
  sizeBytes: number;
  modifiedAt: string;
}

// ---------------------------------------------------------------------------
// Agent run history types (ADR-1: Agent Run History)
// ---------------------------------------------------------------------------

/** Lifecycle status of an agent run. Terminal states: completed, cancelled, failed. */
export type RunStatus = 'running' | 'completed' | 'cancelled' | 'failed';

/**
 * A persisted record of one agent run lifecycle.
 * Fields are denormalized at write time so historical records remain accurate
 * even if the task or space is later renamed or deleted.
 */
export interface AgentRunRecord {
  id: string;
  taskId: string;
  taskTitle: string;
  agentId: string;
  agentDisplayName: string;
  spaceId: string;
  spaceName: string;
  status: RunStatus;
  startedAt: string;           // ISO timestamp
  completedAt: string | null;  // ISO timestamp or null while running
  durationMs: number | null;   // milliseconds, null while running
  cliCommand: string;
  promptPath: string;
  reason?: 'stale';            // only on status=failed stale runs (not persisted)
}

/** Payload for PATCH /api/v1/agent-runs/:runId — transitions run to a terminal status. */
export interface AgentRunPatchPayload {
  status: 'completed' | 'cancelled' | 'failed';
  completedAt: string;
  durationMs: number;
}

/** Response from GET /api/v1/agent-runs. */
export interface AgentRunsResponse {
  runs: AgentRunRecord[];
  total: number;
}
