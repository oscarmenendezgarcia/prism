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
} from '@/types';

const API_BASE = '/api/v1';

/**
 * Generic fetch wrapper with typed response and error handling.
 * Throws an Error with the message from the response body on HTTP errors.
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
    const message = (data as { error?: { message?: string } })?.error?.message || `HTTP ${res.status}`;
    throw new Error(message);
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

/** Update a space (name, workingDirectory, pipeline). */
export const renameSpace = (id: string, name: string, workingDirectory?: string, pipeline?: string[]): Promise<Space> =>
  apiFetch<Space>(`/spaces/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name,
      ...(workingDirectory !== undefined ? { workingDirectory } : {}),
      ...(pipeline !== undefined ? { pipeline } : {}),
    }),
  });

/** Delete a space and all its tasks. */
export const deleteSpace = (id: string): Promise<{ deleted: true; id: string }> =>
  apiFetch<{ deleted: true; id: string }>(`/spaces/${id}`, {
    method: 'DELETE',
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
// Config file operations (ADR-1: Config Editor Panel)
// ---------------------------------------------------------------------------

/**
 * List all available config files.
 * Triggers a registry rebuild on the server to pick up newly created files.
 */
export const getConfigFiles = (): Promise<ConfigFile[]> =>
  apiFetch<ConfigFile[]>('/config/files');

/**
 * Read the full content of a config file by its opaque file ID.
 * @param fileId - Opaque ID returned by getConfigFiles (e.g. "global-claude-md").
 */
export const getConfigFile = (fileId: string): Promise<ConfigFileContent> =>
  apiFetch<ConfigFileContent>(`/config/files/${encodeURIComponent(fileId)}`);

/**
 * Atomically overwrite a config file with new content.
 * @param fileId  - Opaque ID returned by getConfigFiles.
 * @param content - New UTF-8 text content. Empty string is valid (clears file).
 */
export const saveConfigFile = (fileId: string, content: string): Promise<ConfigFileSaveResult> =>
  apiFetch<ConfigFileSaveResult>(`/config/files/${encodeURIComponent(fileId)}`, {
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
export const getAgents = (): Promise<AgentInfo[]> =>
  apiFetch<AgentInfo[]>('/agents');

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
): Promise<BackendRun> =>
  apiFetch<BackendRun>('/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      spaceId,
      taskId,
      ...(stages ? { stages } : {}),
      ...(context ? { context } : {}),
    }),
  });

/** Fetch the current status of a backend pipeline run. */
export const getBackendRun = (runId: string): Promise<BackendRun> =>
  apiFetch<BackendRun>(`/runs/${runId}`);

/** Cancel a backend pipeline run. */
export const deleteRun = (runId: string): Promise<void> =>
  apiFetch<void>(`/runs/${runId}`, { method: 'DELETE' });
