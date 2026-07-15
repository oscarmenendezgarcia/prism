/**
 * Typed HTTP client for the Prism REST API.
 * Mirrors the api object from the legacy app.js exactly.
 * ADR-002: all endpoints unchanged, only typed wrappers added.
 * ADR-1 (Agent Launcher): agent discovery, prompt generation, settings endpoints added.
 */

import type {
  Space,
  Task,
  BoardTasks,
  CreateTaskPayload,
  UpdateTaskPayload,
  MoveTaskResponse,
  AttachmentContent,
  ConfigFile,
  ConfigFileContent,
  ConfigFileSaveResult,
  AgentInfo,
  AgentDetail,
  PromptGenerationRequest,
  PromptGenerationResponse,
  AgentSettings,
  BackendRun,
  PipelinePromptPreview,
  TaggerOptions,
  TaggerResult,
  Comment,
  SearchResponse,
  StageMetrics,
  EventsResponse,
  DirectoryListing,
  ValidationResult,
  HomeDirectoryResponse,
  StageModelsMap,
} from '@/types';

const API_BASE = '/api/v1';

/**
 * Typed HTTP error that preserves the HTTP status code and backend error code.
 * Thrown by apiFetch on non-2xx responses so callers can discriminate by code
 * (e.g. 409 MAX_CONCURRENT_REACHED) without string-matching the message.
 */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Generic fetch wrapper with typed response and error handling.
 * Throws an ApiError with status + code from the response body on HTTP errors.
 * Returns null for 204 No Content responses.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...defaultHeaders, ...(options.headers as Record<string, string> || {}) },
  });

  if (res.status === 204) return null as unknown as T;

  const data = await res.json();

  if (!res.ok) {
    const errorBody = data as { error?: { message?: string; code?: string } };
    const message = errorBody?.error?.message || `HTTP ${res.status}`;
    const code    = errorBody?.error?.code;
    throw new ApiError(message, res.status, code);
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Space management
// ---------------------------------------------------------------------------

/** List all spaces. */
export const getSpaces = (): Promise<Space[]> =>
  apiFetch<Space[]>('/spaces');

/** Create a new space. */
export const createSpace = (name: string, workingDirectory?: string, pipeline?: string[]): Promise<Space> =>
  apiFetch<Space>('/spaces', {
    method: 'POST',
    body: JSON.stringify({
      name,
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(pipeline ? { pipeline } : {}),
    }),
  });

/** Update a space (name, workingDirectory, pipeline, agentNicknames, stageModels). */
export const renameSpace = (
  id: string,
  name: string,
  workingDirectory?: string,
  pipeline?: string[],
  agentNicknames?: Record<string, string>,
  stageModels?: StageModelsMap | null,
): Promise<Space> =>
  apiFetch<Space>(`/spaces/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name,
      ...(workingDirectory !== undefined ? { workingDirectory } : {}),
      ...(pipeline !== undefined ? { pipeline } : {}),
      ...(agentNicknames !== undefined ? { agentNicknames } : {}),
      ...(stageModels !== undefined ? { stageModels } : {}),
    }),
  });

/** Delete a space and all its tasks. */
export const deleteSpace = (id: string): Promise<{ deleted: true; id: string }> =>
  apiFetch<{ deleted: true; id: string }>(`/spaces/${id}`, {
    method: 'DELETE',
  });

/**
 * Partial update for a space. Accepts any subset of space fields.
 * used for pin/unpin/reorder operations where only pinned/pinnedRank change.
 */
export const updateSpace = (
  id: string,
  patch: { name?: string; pinned?: boolean; pinnedRank?: number | null },
): Promise<Space> =>
  apiFetch<Space>(`/spaces/${id}`, {
    method: 'PUT',
    body:   JSON.stringify(patch),
  });

// ---------------------------------------------------------------------------
// Task operations (space-scoped)
// ---------------------------------------------------------------------------

/** Fetch all tasks in a space grouped by column. */
export const getTasks = (spaceId: string): Promise<BoardTasks> =>
  apiFetch<BoardTasks>(`/spaces/${spaceId}/tasks`);

/** Create a new task in the todo column of a space. */
export const createTask = (spaceId: string, payload: CreateTaskPayload): Promise<Task> =>
  apiFetch<Task>(`/spaces/${spaceId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

/** Move a task to a different column within a space. */
export const moveTask = (spaceId: string, id: string, to: string): Promise<MoveTaskResponse> =>
  apiFetch<MoveTaskResponse>(`/spaces/${spaceId}/tasks/${id}/move`, {
    method: 'PUT',
    body: JSON.stringify({ to }),
  });


/** Update the positional rank of a task within its column. */
export const reorderTask = (
  spaceId: string,
  taskId: string,
  rank: number,
): Promise<Task> =>
  apiFetch<Task>(`/spaces/${spaceId}/tasks/${taskId}/rank`, {
    method: 'PATCH',
    body: JSON.stringify({ rank }),
  });

/**
 * Atomically re-rank multiple tasks in a single space (single transaction on
 * the server). Used by the client-side rank rebalance path so a mid-batch
 * failure cannot leave the column in a mixed old/new rank state.
 */
export const reorderTasks = (
  spaceId: string,
  updates: Array<{ id: string; rank: number }>,
): Promise<{ tasks: Task[] }> =>
  apiFetch<{ tasks: Task[] }>(`/spaces/${spaceId}/tasks/rank`, {
    method: 'PATCH',
    body: JSON.stringify({ updates }),
  });

/** Delete a task from a space. */
export const deleteTask = (spaceId: string, id: string): Promise<{ deleted: true; id: string }> =>
  apiFetch<{ deleted: true; id: string }>(`/spaces/${spaceId}/tasks/${id}`, {
    method: 'DELETE',
  });

/**
 * Update editable task fields via PUT /spaces/:spaceId/tasks/:taskId.
 * Only the keys present in `patch` are applied by the server.
 * ADR-1 (task-detail-edit): reuses existing partial-update PUT endpoint.
 *
 * @param spaceId - The space ID containing the task.
 * @param taskId  - The task ID to update.
 * @param patch   - Partial task payload — at least one field required.
 * @returns The full updated Task object.
 */
export const updateTask = (
  spaceId: string,
  taskId: string,
  patch: UpdateTaskPayload,
): Promise<Task> =>
  apiFetch<Task>(`/spaces/${spaceId}/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });

/**
 * Fetch the content of a single attachment.
 * @param spaceId - The space ID.
 * @param taskId - The task ID.
 * @param index - Zero-based attachment index.
 */
export const getAttachmentContent = (
  spaceId: string,
  taskId: string,
  index: number
): Promise<AttachmentContent> =>
  apiFetch<AttachmentContent>(`/spaces/${spaceId}/tasks/${taskId}/attachments/${index}`);

// ---------------------------------------------------------------------------
// Task comments (ADR-1: task-comments)
// ---------------------------------------------------------------------------

/** Payload for POST /spaces/:spaceId/tasks/:taskId/comments */
export interface CreateCommentPayload {
  author: string;
  text: string;
  type: 'note' | 'question' | 'answer';
  parentId?: string;
  /** Route this question to a specific agent (questions only). */
  targetAgent?: string;
}

/** Payload for PATCH /spaces/:spaceId/tasks/:taskId/comments/:commentId */
export interface UpdateCommentPayload {
  text?: string;
  type?: 'note' | 'question' | 'answer';
  resolved?: boolean;
}

/**
 * Create a new comment on a task.
 * POST /api/v1/spaces/:spaceId/tasks/:taskId/comments
 */
export const createComment = (
  spaceId: string,
  taskId: string,
  payload: CreateCommentPayload,
): Promise<Comment> =>
  apiFetch<Comment>(`/spaces/${spaceId}/tasks/${taskId}/comments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

/**
 * Update an existing comment (resolve, edit text, or change type).
 * PATCH /api/v1/spaces/:spaceId/tasks/:taskId/comments/:commentId
 */
export const updateComment = (
  spaceId: string,
  taskId: string,
  commentId: string,
  payload: UpdateCommentPayload,
): Promise<Comment> =>
  apiFetch<Comment>(`/spaces/${spaceId}/tasks/${taskId}/comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

// ---------------------------------------------------------------------------
// Auto-task generation
// ---------------------------------------------------------------------------

/** Response from POST /spaces/:spaceId/autotask/generate */
export interface AutoTaskResponse {
  tasksCreated: number;
  tasks: Task[];
}

/**
 * Generate tasks from a natural-language prompt and persist them to a column.
 * @param spaceId - Target space.
 * @param prompt  - User's description of the work to break down.
 * @param column  - Target column (defaults to "todo" on the server).
 */
export const generateAutoTasks = (
  spaceId: string,
  prompt: string,
  column?: string,
  preview?: boolean,
): Promise<AutoTaskResponse> =>
  apiFetch<AutoTaskResponse>(`/spaces/${spaceId}/autotask/generate`, {
    method: 'POST',
    body: JSON.stringify({ prompt, ...(column ? { column } : {}), ...(preview ? { preview } : {}) }),
  });

/**
 * Persist a user-reviewed subset of previously generated tasks.
 * @param spaceId - Target space.
 * @param tasks   - Tasks to create (as returned by generateAutoTasks with preview:true).
 * @param column  - Target column (defaults to "todo" on the server).
 */
export const confirmAutoTasks = (
  spaceId: string,
  tasks: Task[],
  column?: string,
): Promise<AutoTaskResponse> =>
  apiFetch<AutoTaskResponse>(`/spaces/${spaceId}/autotask/confirm`, {
    method: 'POST',
    body: JSON.stringify({ tasks, ...(column ? { column } : {}) }),
  });

// ---------------------------------------------------------------------------
// Config file operations (ADR-1: Config Editor Panel)
// ---------------------------------------------------------------------------

/**
 * List all available config files.
 * Triggers a registry rebuild on the server to pick up newly created files.
 */
export const getConfigFiles = (spaceId?: string): Promise<ConfigFile[]> =>
  apiFetch<ConfigFile[]>(spaceId ? `/config/files?spaceId=${encodeURIComponent(spaceId)}` : '/config/files');

/**
 * Read the full content of a config file by its opaque file ID.
 * @param fileId  - Opaque ID returned by getConfigFiles (e.g. "global-claude-md").
 * @param spaceId - Optional space ID to resolve project files from workingDirectory.
 */
export const getConfigFile = (fileId: string, spaceId?: string): Promise<ConfigFileContent> =>
  apiFetch<ConfigFileContent>(`/config/files/${encodeURIComponent(fileId)}${spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : ''}`);

/**
 * Atomically overwrite a config file with new content.
 * @param fileId  - Opaque ID returned by getConfigFiles.
 * @param content - New UTF-8 text content. Empty string is valid (clears file).
 * @param spaceId - Optional space ID to resolve project files from workingDirectory.
 */
export const saveConfigFile = (fileId: string, content: string, spaceId?: string): Promise<ConfigFileSaveResult> =>
  apiFetch<ConfigFileSaveResult>(`/config/files/${encodeURIComponent(fileId)}${spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : ''}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });

// ---------------------------------------------------------------------------
// Agent launcher API (ADR-1: Agent Launcher)
// ---------------------------------------------------------------------------

/**
 * List all available agent definition files from ~/.claude/agents/.
 * Returns an empty array if the directory does not exist.
 */
export const getAgents = (workingDirectory?: string): Promise<AgentInfo[]> => {
  const qs = workingDirectory ? `?workingDirectory=${encodeURIComponent(workingDirectory)}` : '';
  return apiFetch<AgentInfo[]>(`/agents${qs}`);
};

/**
 * Read the full content of a specific agent definition file by its kebab-case ID.
 * @param agentId - Kebab-case stem (e.g. "senior-architect").
 */
export const getAgent = (agentId: string): Promise<AgentDetail> =>
  apiFetch<AgentDetail>(`/agents/${encodeURIComponent(agentId)}`);

/**
 * Generate a full agent prompt from task data + agent file, write it to a
 * temp file on the server, and return the file path plus the CLI command string.
 */
export const generatePrompt = (req: PromptGenerationRequest): Promise<PromptGenerationResponse> =>
  apiFetch<PromptGenerationResponse>('/agent/prompt', {
    method: 'POST',
    body: JSON.stringify(req),
  });

/**
 * Fetch current launcher settings. Returns defaults if data/settings.json does not exist.
 */
export const getSettings = (): Promise<AgentSettings> =>
  apiFetch<AgentSettings>('/settings');

/**
 * Partially update launcher settings (deep merge). Returns the full merged settings.
 * @param partial - Partial settings object — only provided fields are updated.
 */
export const saveSettings = (partial: Partial<AgentSettings>): Promise<AgentSettings> =>
  apiFetch<AgentSettings>('/settings', {
    method: 'PUT',
    body: JSON.stringify(partial),
  });

// ---------------------------------------------------------------------------
// Agent run history API (ADR-1: Agent Run History)
// ---------------------------------------------------------------------------

import type {
  AgentRunRecord,
  AgentRunPatchPayload,
  AgentRunsResponse,
  RunStatus,
} from '@/types';

/**
 * POST /api/v1/agent-runs
 * Record a new agent run with status=running.
 * Called from executeAgentRun() after injecting the CLI command into the PTY.
 *
 * @param record - Run record without server-set fields (status, completedAt, durationMs).
 * @returns The created run ID.
 */
export const createAgentRun = (
  record: Omit<AgentRunRecord, 'status' | 'completedAt' | 'durationMs' | 'reason'>
): Promise<{ id: string }> =>
  apiFetch<{ id: string }>('/agent-runs', {
    method: 'POST',
    body: JSON.stringify(record),
  });

/**
 * PATCH /api/v1/agent-runs/:runId
 * Transition a run to a terminal status (completed, cancelled, or failed).
 * Called from useAgentCompletion and cancelAgentRun.
 *
 * @param runId - The run ID to update.
 * @param patch - Status transition payload.
 * @returns The updated run ID and status.
 */
export const updateAgentRun = (
  runId: string,
  patch: AgentRunPatchPayload
): Promise<{ id: string; status: RunStatus }> =>
  apiFetch<{ id: string; status: RunStatus }>(`/agent-runs/${encodeURIComponent(runId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

/**
 * GET /api/v1/agent-runs
 * Fetch agent run history, newest-first.
 * Stale healing is applied server-side: running records older than 4 hours are returned as failed.
 *
 * @param params - Optional status filter and result limit.
 * @returns Paginated run list and total count.
 */
export const getAgentRuns = (
  params?: { status?: RunStatus; limit?: number }
): Promise<AgentRunsResponse> => {
  const qs = new URLSearchParams();
  if (params?.status)          qs.set('status', params.status);
  if (params?.limit != null)   qs.set('limit', String(params.limit));
  const query = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<AgentRunsResponse>(`/agent-runs${query}`);
};

/**
 * Launch a pipeline run via backend spawn (no PTY required).
 * @param spaceId - Target space.
 * @param taskId  - Main task to process.
 * @param stages  - Override agent stage list; omit to use space/settings default.
 * @param context - Extra context forwarded to the spawned agent (e.g. stages list
 *                  for the orchestrator agent in T-4 mode).
 */
export const startRun = (
  spaceId: string,
  taskId: string,
  stages?: string[],
  context?: Record<string, unknown>,
  checkpoints?: number[],
): Promise<BackendRun> =>
  apiFetch<BackendRun>('/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      spaceId,
      taskId,
      ...(stages ? { stages } : {}),
      ...(context ? { context } : {}),
      ...(checkpoints && checkpoints.length > 0 ? { checkpoints } : {}),
    }),
  });

/** Fetch platform info from the backend (used to determine caffeinate support). */
export const getSystemInfo = (): Promise<{ platform: string }> =>
  apiFetch<{ platform: string }>('/system/info');

/** List all pipeline run summaries. */
export const listRuns = (): Promise<BackendRun[]> =>
  apiFetch<BackendRun[]>('/runs');

/** Fetch the current status of a backend pipeline run. */
export const getBackendRun = (runId: string): Promise<BackendRun> =>
  apiFetch<BackendRun>(`/runs/${runId}`);

/** Cancel a backend pipeline run. */
export const deleteRun = (runId: string): Promise<void> =>
  apiFetch<void>(`/runs/${runId}`, { method: 'DELETE' });

/** Resume an interrupted or failed pipeline run from the first non-completed stage. */
export const resumeRun = (runId: string): Promise<BackendRun> =>
  apiFetch<BackendRun>(`/runs/${runId}/resume`, { method: 'POST' });

/**
 * Fetch the persisted prompt for a specific pipeline stage.
 * Returns raw text/plain content.
 * Throws PromptNotAvailableError when the stage has not started yet (404 PROMPT_NOT_AVAILABLE).
 *
 * @param runId       Pipeline run ID.
 * @param stageIndex  Zero-based stage index.
 */
export async function getStagePrompt(runId: string, stageIndex: number): Promise<string> {
  const url = `${API_BASE}/runs/${encodeURIComponent(runId)}/stages/${stageIndex}/prompt`;
  const res = await fetch(url);

  if (res.ok) {
    return res.text();
  }

  let code: string | undefined;
  try {
    const body = await res.json() as { error?: { code?: string } };
    code = body?.error?.code;
  } catch {
    // Non-JSON body — fall through to generic error.
  }

  if (res.status === 404 && code === 'PROMPT_NOT_AVAILABLE') {
    throw new PromptNotAvailableError();
  }

  throw new Error(
    code
      ? `[PipelinePrompt] fetch error stage=${stageIndex} code=${code} status=${res.status}`
      : `[PipelinePrompt] fetch error stage=${stageIndex} status=${res.status}`,
  );
}

/**
 * Sentinel error thrown when the backend returns 404 PROMPT_NOT_AVAILABLE.
 * The prompt file is written before the stage starts; this error means
 * the stage hasn't begun yet — callers should show a friendly empty state.
 */
export class PromptNotAvailableError extends Error {
  constructor() {
    super('PROMPT_NOT_AVAILABLE');
    this.name = 'PromptNotAvailableError';
  }
}

/**
 * Generate prompts for all pipeline stages without starting a run.
 * Useful for previewing what each agent will receive before confirming launch.
 *
 * @param spaceId  Target space ID.
 * @param taskId   Task ID to build prompts for.
 * @param stages   Ordered list of agent IDs.
 */
export const previewPipelinePrompts = (
  spaceId: string,
  taskId: string,
  stages: string[],
): Promise<PipelinePromptPreview> =>
  apiFetch<PipelinePromptPreview>('/runs/preview-prompts', {
    method: 'POST',
    body: JSON.stringify({ spaceId, taskId, stages }),
  });

// ---------------------------------------------------------------------------
// Tagger API (ADR-1: Tagger Agent)
// ---------------------------------------------------------------------------

/**
 * Trigger the tagger for a space.
 * The backend reads all cards, calls Claude, and returns classification suggestions.
 * No mutations are applied — the user reviews suggestions in TaggerReviewModal before confirming.
 *
 * @param spaceId - The space to tag.
 * @param opts    - Optional filters (column, improveDescriptions).
 * @returns TaggerResult with suggestions and token usage.
 * @throws Error with the server's error message on failure.
 */
export const runTagger = (spaceId: string, opts: TaggerOptions = {}): Promise<TaggerResult> =>
  apiFetch<TaggerResult>(`/spaces/${encodeURIComponent(spaceId)}/tagger/run`, {
    method: 'POST',
    body: JSON.stringify({
      improveDescriptions: opts.improveDescriptions ?? false,
      ...(opts.column !== undefined ? { column: opts.column } : {}),
      ...(opts.prompt !== undefined ? { prompt: opts.prompt } : {}),
    }),
  });

// ---------------------------------------------------------------------------
// Global task search API (ADR-1: global-search)
// ---------------------------------------------------------------------------

/**
 * Search for tasks by title or description across all project spaces.
 * Uses FTS5 full-text search; results ranked by BM25 relevance.
 *
 * GET /api/v1/tasks/search?q=<text>&limit=<n>
 *
 * @param q      - Search query (1–200 chars).
 * @param limit  - Maximum results (1–50, default 20).
 * @param signal - AbortSignal to cancel an in-flight request.
 * @returns Parsed SearchResponse with ranked results across all spaces.
 */
export function searchTasks(q: string, limit = 20, signal?: AbortSignal): Promise<SearchResponse> {
  const qs = new URLSearchParams({ q, limit: String(limit) });
  return apiFetch<SearchResponse>(`/tasks/search?${qs.toString()}`, { signal });
}

// ---------------------------------------------------------------------------
// Stage Metrics API (ADR-1: log-metrics-parser §4.1)
// ---------------------------------------------------------------------------

/**
 * Sentinel error thrown when the backend returns 425 Too Early.
 * This means the stage has not produced a .log file yet.
 * Callers should display a "Stage not started yet." empty state.
 */
export class MetricsNotAvailableError extends Error {
  constructor() {
    super('METRICS_NOT_AVAILABLE');
    this.name = 'MetricsNotAvailableError';
  }
}

/**
 * Fetch parsed stage metrics for a specific pipeline stage.
 *
 * GET /api/v1/runs/:runId/stages/:stageIndex/metrics
 *
 * @param runId       Pipeline run ID.
 * @param stageIndex  Zero-based stage index.
 * @returns Parsed StageMetrics object.
 * @throws {MetricsNotAvailableError} When the stage has no .log yet (425 Too Early).
 * @throws {Error} On any other HTTP error.
 */
export async function getStageMetrics(runId: string, stageIndex: number): Promise<StageMetrics> {
  const url = `${API_BASE}/runs/${encodeURIComponent(runId)}/stages/${stageIndex}/metrics`;
  const res = await fetch(url);

  if (res.ok) {
    return res.json() as Promise<StageMetrics>;
  }

  let code: string | undefined;
  try {
    const body = await res.json() as { error?: { code?: string } };
    code = body?.error?.code;
  } catch {
    // Non-JSON body — fall through to generic error.
  }

  // 425 Too Early = no .log file yet for this stage.
  if (res.status === 425) {
    throw new MetricsNotAvailableError();
  }

  throw new Error(
    code
      ? `[StageMetrics] fetch error stage=${stageIndex} code=${code} status=${res.status}`
      : `[StageMetrics] fetch error stage=${stageIndex} status=${res.status}`,
  );
}

// ---------------------------------------------------------------------------
// Stage Events API (structured log view, blueprint §2.1)
// ---------------------------------------------------------------------------

/**
 * Sentinel error thrown when the backend returns 425 Too Early.
 * This means the stage has not produced a .log file yet.
 */
export class EventsNotAvailableError extends Error {
  constructor() {
    super('EVENTS_NOT_AVAILABLE');
    this.name = 'EventsNotAvailableError';
  }
}

/**
 * Fetch structured events for a specific pipeline stage.
 *
 * GET /api/v1/runs/:runId/stages/:stageIndex/events?since=<idx>
 *
 * @param runId       Pipeline run ID.
 * @param stageIndex  Zero-based stage index.
 * @param since       Return events with idx >= since (default 0).
 * @throws {EventsNotAvailableError} When the stage has no .log yet (425 Too Early).
 * @throws {Error} On any other HTTP error.
 */
export async function getStageEvents(
  runId: string,
  stageIndex: number,
  since = 0,
): Promise<EventsResponse> {
  const url = `${API_BASE}/runs/${encodeURIComponent(runId)}/stages/${stageIndex}/events?since=${since}`;
  const res = await fetch(url);

  if (res.ok) {
    return res.json() as Promise<EventsResponse>;
  }

  let code: string | undefined;
  try {
    const body = await res.json() as { error?: { code?: string } };
    code = body?.error?.code;
  } catch {
    // Non-JSON body — fall through to generic error.
  }

  if (res.status === 425) {
    throw new EventsNotAvailableError();
  }

  throw new Error(
    code
      ? `[StageEvents] fetch error stage=${stageIndex} code=${code} status=${res.status}`
      : `[StageEvents] fetch error stage=${stageIndex} status=${res.status}`,
  );
}

// ---------------------------------------------------------------------------
// Pipeline log viewer API (ADR-1: log-viewer)
// ---------------------------------------------------------------------------

/**
 * Sentinel error thrown when the backend returns 404 with code LOG_NOT_AVAILABLE.
 * This means the stage has not started yet — it is NOT a fatal error.
 * Callers should display "Stage not started yet." rather than an error message.
 */
export class LogNotAvailableError extends Error {
  constructor() {
    super('LOG_NOT_AVAILABLE');
    this.name = 'LogNotAvailableError';
  }
}

/**
 * Fetch log content for a specific pipeline stage.
 *
 * Uses the existing `GET /api/v1/runs/:runId/stages/:stageIndex/log?tail=N`
 * endpoint (no backend changes required per ADR-1 §Decision).
 *
 * @param runId       Pipeline run ID returned by POST /api/v1/runs.
 * @param stageIndex  Zero-based stage index.
 * @param tail        Number of lines to return from the end. 0 = full log.
 *                    Default 500 per ADR-1 §Consequences (mitigates large log risk).
 * @returns Raw text content of the log.
 * @throws {LogNotAvailableError} When the stage has not started yet (404 LOG_NOT_AVAILABLE).
 * @throws {Error} On any other HTTP error.
 */
export async function getStageLog(
  runId: string,
  stageIndex: number,
  tail = 500,
): Promise<string> {
  const qs = tail > 0 ? `?tail=${tail}` : '';
  const url = `${API_BASE}/runs/${encodeURIComponent(runId)}/stages/${stageIndex}/log${qs}`;

  const res = await fetch(url);

  if (res.ok) {
    return res.text();
  }

  // Attempt to parse the JSON error body for a typed code.
  let code: string | undefined;
  try {
    const body = await res.json() as { error?: { code?: string } };
    code = body?.error?.code;
  } catch {
    // Non-JSON body — fall through to generic error.
  }

  if (res.status === 404 && code === 'LOG_NOT_AVAILABLE') {
    throw new LogNotAvailableError();
  }

  throw new Error(
    code ? `[PipelineLog] fetch error stage=${stageIndex} code=${code} status=${res.status}`
         : `[PipelineLog] fetch error stage=${stageIndex} status=${res.status}`,
  );
}

// ---------------------------------------------------------------------------
// Folio reference autocomplete API (folio-task-references)
// ---------------------------------------------------------------------------

/**
 * A page reference item returned by the search endpoint.
 * `slug` is the canonical "chapter/page" form used in [[ ]] syntax.
 */
export interface FolioRef {
  slug:        string;
  title:       string;
  chapterSlug: string;
  pageSlug:    string;
  /** BM25 relevance score (lower = better for non-empty queries; 0 for empty-query listing). */
  score:       number;
}

/**
 * An H2 section item returned by the sections endpoint.
 * `slug` is the GitHub-slugified heading title — used after the `#` in [[ ]] syntax.
 */
export interface FolioSection {
  title: string;
  slug:  string;
}

/**
 * Search pages in a space's folio for the [[ autocomplete level-1 dropdown.
 *
 * GET /api/v1/spaces/:spaceId/folio/refs/search?q=&limit=
 *
 * @param spaceId - Target space.
 * @param q       - Partial text to search; empty string returns up to `limit` pages.
 * @param limit   - Max results (default 20, server-capped at 100).
 * @returns Array of matching page references sorted by relevance.
 */
export const searchFolioRefs = (
  spaceId: string,
  q: string,
  limit = 20,
): Promise<FolioRef[]> => {
  const qs = new URLSearchParams({ q });
  if (limit !== 20) qs.set('limit', String(limit));
  return apiFetch<{ refs: FolioRef[] }>(
    `/spaces/${encodeURIComponent(spaceId)}/folio/refs/search?${qs.toString()}`,
  ).then((r) => r.refs);
};

/**
 * Fetch the H2 sections of a specific page for the [[ autocomplete level-2 dropdown.
 *
 * GET /api/v1/spaces/:spaceId/folio/refs/sections?slug=chapter/page
 *
 * @param spaceId - Target space.
 * @param slug    - Page slug in "chapter/page" format.
 * @returns Array of H2 section headings with their GitHub slugs.
 */
export const getFolioRefSections = (
  spaceId: string,
  slug: string,
): Promise<FolioSection[]> => {
  const qs = new URLSearchParams({ slug });
  return apiFetch<{ sections: FolioSection[] }>(
    `/spaces/${encodeURIComponent(spaceId)}/folio/refs/sections?${qs.toString()}`,
  ).then((r) => r.sections);
};

// ---------------------------------------------------------------------------
// Folio CRUD (T-003: folio-index-ui)
// ---------------------------------------------------------------------------

/** A chapter in the Folio index. */
export interface FolioChapter {
  slug:      string;
  title:     string;
  position:  number;
  pageCount: number;
}

/** Folio index response: active status + chapter list with page counts. */
export interface FolioIndex {
  active:   boolean;
  chapters: FolioChapter[];
}

/** Lightweight page metadata (no content). */
export interface FolioPageMeta {
  id:          string;
  slug:        string;
  chapterSlug: string;
  title:       string;
  author:      'user' | 'agent';
  createdAt:   string;
  updatedAt:   string;
}

/** Full page object with markdown content. */
export interface FolioPage {
  id:          string;
  slug:        string;
  chapterSlug: string;
  title:       string;
  content:     string;
  author:      'user' | 'agent';
  pinned:      boolean;
  createdAt:   string;
  updatedAt:   string;
}

/** Payload for creating a new page. */
export interface CreateFolioPagePayload {
  slug:     string;
  title?:   string;
  content?: string;
}

/** Payload for updating an existing page. */
export interface UpdateFolioPagePayload {
  content?: string;
  title?:   string;
  pinned?:  boolean;
}

/**
 * Fetch the Folio index for a space: chapters with page counts.
 * Returns active=false when no folio is bound.
 */
export const getFolioIndex = (spaceId: string): Promise<FolioIndex> =>
  apiFetch<FolioIndex>(`/spaces/${encodeURIComponent(spaceId)}/folio`);

/**
 * Cheap revision probe for external-change detection (file backend → newest
 * markdown mtime; sqlite → 0). The Folio panel polls this and surfaces a refresh
 * affordance only when the value exceeds the revision captured at last load.
 */
export const getFolioRevision = (spaceId: string): Promise<number> =>
  apiFetch<{ revision: number }>(`/spaces/${encodeURIComponent(spaceId)}/folio/revision`)
    .then((r) => r.revision);

/**
 * Manually trigger a background bootstrap of the space's folio from its repo
 * working directory (the "Bootstrap from repo" empty-state button). Resolves
 * when accepted (202); rejects with ApiError on 409 (folio exists) / 400 (no repo).
 */
export const bootstrapFolio = (spaceId: string): Promise<{ started: boolean }> =>
  apiFetch<{ started: boolean }>(`/spaces/${encodeURIComponent(spaceId)}/folio/bootstrap`, {
    method: 'POST',
  });

/**
 * Move an activated sqlite folio into the repo working directory's .folio/
 * (export → flip backend → delete sqlite rows). Deliberate, destructive cleanup
 * that preserves content. Resolves with the new root + page count; rejects with
 * ApiError on 409 (already file) / 400 (no working dir).
 */
export const migrateFolio = (spaceId: string): Promise<{ ok: true; root: string; pages?: number }> =>
  apiFetch<{ ok: true; root: string; pages?: number }>(
    `/spaces/${encodeURIComponent(spaceId)}/folio/migrate`,
    { method: 'POST' },
  );

/**
 * Fetch all pages in a chapter (metadata only — no content).
 */
export const getChapterPages = (spaceId: string, chapterSlug: string): Promise<FolioPageMeta[]> =>
  apiFetch<{ pages: FolioPageMeta[] }>(
    `/spaces/${encodeURIComponent(spaceId)}/folio/chapters/${encodeURIComponent(chapterSlug)}/pages`,
  ).then((r) => r.pages);

/**
 * Fetch a single page with full markdown content.
 */
export const getFolioPage = (spaceId: string, chapterSlug: string, pageSlug: string): Promise<FolioPage> =>
  apiFetch<FolioPage>(
    `/spaces/${encodeURIComponent(spaceId)}/folio/pages/${encodeURIComponent(chapterSlug)}/${encodeURIComponent(pageSlug)}`,
  );

/**
 * Create a new page (also activates the folio if first page in space).
 */
export const createFolioPage = (spaceId: string, payload: CreateFolioPagePayload): Promise<FolioPage> =>
  apiFetch<FolioPage>(`/spaces/${encodeURIComponent(spaceId)}/folio/pages`, {
    method: 'POST',
    body:   JSON.stringify(payload),
  });

/**
 * Update a page's content, title, or pinned status. Author is preserved.
 */
export const updateFolioPage = (
  spaceId: string,
  chapterSlug: string,
  pageSlug: string,
  payload: UpdateFolioPagePayload,
): Promise<FolioPage> =>
  apiFetch<FolioPage>(
    `/spaces/${encodeURIComponent(spaceId)}/folio/pages/${encodeURIComponent(chapterSlug)}/${encodeURIComponent(pageSlug)}`,
    { method: 'PUT', body: JSON.stringify(payload) },
  );

/**
 * Delete a page. Returns void (204 No Content).
 */
export const deleteFolioPage = (
  spaceId: string,
  chapterSlug: string,
  pageSlug: string,
): Promise<void> =>
  apiFetch<void>(
    `/spaces/${encodeURIComponent(spaceId)}/folio/pages/${encodeURIComponent(chapterSlug)}/${encodeURIComponent(pageSlug)}`,
    { method: 'DELETE' },
  );

// ---------------------------------------------------------------------------
// Filesystem browser API (space-settings-file-browser)
// ---------------------------------------------------------------------------

/** Get the current user's home directory path. */
export const getFsHome = (): Promise<HomeDirectoryResponse> =>
  apiFetch<HomeDirectoryResponse>('/fs/home');

/** List subdirectories of the given path. */
export const browseDirectory = (dirPath: string, includeHidden = false): Promise<DirectoryListing> =>
  apiFetch<DirectoryListing>('/fs/browse', {
    method: 'POST',
    body: JSON.stringify({ path: dirPath, includeHidden }),
  });

/** Validate that a path is an accessible directory. */
export const validateDirectory = (dirPath: string): Promise<ValidationResult> =>
  apiFetch<ValidationResult>('/fs/validate', {
    method: 'POST',
    body: JSON.stringify({ path: dirPath }),
  });
