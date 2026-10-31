/**
 * Typed HTTP client for the Prism REST API.
 * Mirrors the api object from the legacy app.js exactly.
 * ADR-002: all endpoints unchanged, only typed wrappers added.
 */

import type {
  Space,
  Task,
  BoardResponse,
  BoardTasks,
  CreateTaskPayload,
  UpdateTaskPayload,
  MoveTaskResponse,
  AttachmentContent,
  BackendRun,
  Comment,
  SearchResponse,
  ValidationResult,
  HarnessesResponse,
  TaskRunView,
  ChangedFile,
  SpaceHooks,
  HistoryEntry,
  Status,
  AuthStatus,
  AccountLink,
  ApiToken,
  Invite,
  Role,
  SpaceAgents,
  User,
} from '@/types';

const API_BASE = '/api/v1';

/**
 * Typed HTTP error that preserves the HTTP status code and backend error code.
 * Thrown by apiFetch on non-2xx responses so callers can discriminate by code
 * (e.g. 409 MAX_CONCURRENT_REACHED) without string-matching the message.
 */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
  }
}

let onSignedOut: () => void = () => {};
let onForbidden: () => void = () => {};

/** What to do when the server no longer knows who this is, as when a session expires. */
export function setSignedOutHandler(handler: () => void): void {
  onSignedOut = handler;
}

/** What to do when the server refuses for the role, which may have changed. */
export function setForbiddenHandler(handler: () => void): void {
  onForbidden = handler;
}

/**
 * Generic fetch wrapper with typed response and error handling.
 * Throws an ApiError with status + code from the response body on HTTP errors.
 * Returns null for 204 No Content and 304 Not Modified responses.
 *
 * @param onResponse - To read what is in the headers, such as an ETag.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  onResponse?: (res: Response) => void,
): Promise<T> {
  const defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...defaultHeaders, ...(options.headers as Record<string, string> || {}) },
  });

  onResponse?.(res);

  if (res.status === 204 || res.status === 304) return null as unknown as T;

  const data = await res.json();

  if (!res.ok) {
    const errorBody = data as { error?: { message?: string; code?: string } & Record<string, unknown> };
    const message = errorBody?.error?.message || `HTTP ${res.status}`;
    const code    = errorBody?.error?.code;
    if (code === 'UNAUTHENTICATED') onSignedOut();
    if (code === 'FORBIDDEN') onForbidden();
    throw new ApiError(message, res.status, code, errorBody?.error);
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const getAuthStatus = (): Promise<AuthStatus> =>
  apiFetch<AuthStatus>('/auth/status');

/** Make the first account, the admin. */
export const setUp = (body: { name: string; email: string; password: string; setupCode?: string }): Promise<{ user: User }> =>
  apiFetch<{ user: User }>('/auth/setup', { method: 'POST', body: JSON.stringify(body) });

export const signIn = (email: string, password: string): Promise<{ user: User }> =>
  apiFetch<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });

export const signOut = (): Promise<{ ok: true }> =>
  apiFetch<{ ok: true }>('/auth/logout', { method: 'POST' });

/** What an invitation or reset link is for. */
export const getAccountLink = (token: string): Promise<AccountLink> =>
  apiFetch<AccountLink>(`/auth/links/${encodeURIComponent(token)}`);

export const redeemAccountLink = (token: string, body: { name?: string; password: string }): Promise<{ user: User }> =>
  apiFetch<{ user: User }>(`/auth/links/${encodeURIComponent(token)}`, { method: 'POST', body: JSON.stringify(body) });

export const updateSpaceAgents = (spaceId: string, agents: SpaceAgents): Promise<Space> =>
  apiFetch<Space>(`/spaces/${spaceId}/agents`, { method: 'PUT', body: JSON.stringify(agents) });

export const getUnlinkedAssignees = (): Promise<string[]> => apiFetch<string[]>('/assignees/unlinked');

export const claimAssignee = (userId: string, name: string): Promise<{ moved: number }> =>
  apiFetch<{ moved: number }>(`/users/${encodeURIComponent(userId)}/claim-assignee`, { method: 'POST', body: JSON.stringify({ name }) });

export const getApiTokens = (): Promise<ApiToken[]> => apiFetch<ApiToken[]>('/tokens');

export const createApiToken = (body: { name: string; access: ApiToken['access']; days: number | null }): Promise<ApiToken & { secret: string }> =>
  apiFetch<ApiToken & { secret: string }>('/tokens', { method: 'POST', body: JSON.stringify(body) });

export const deleteApiToken = (id: string): Promise<{ deleted: true; id: string }> =>
  apiFetch<{ deleted: true; id: string }>(`/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const getUsers = (): Promise<User[]> => apiFetch<User[]>('/users');

export const updateUser = (id: string, patch: { role?: Role; active?: boolean }): Promise<User> =>
  apiFetch<User>(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const getInvites = (): Promise<Invite[]> => apiFetch<Invite[]>('/invites');

export const createInvite = (email: string, role: Role): Promise<Invite & { path: string }> =>
  apiFetch<Invite & { path: string }>('/invites', { method: 'POST', body: JSON.stringify({ email, role }) });

export const deleteInvite = (id: string): Promise<{ deleted: true; id: string }> =>
  apiFetch<{ deleted: true; id: string }>(`/invites/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const createResetLink = (userId: string): Promise<{ expiresAt: string; path: string }> =>
  apiFetch<{ expiresAt: string; path: string }>(`/users/${encodeURIComponent(userId)}/reset-link`, { method: 'POST' });

// ---------------------------------------------------------------------------
// Space management
// ---------------------------------------------------------------------------

/** List all spaces. */
export const getSpaces = (): Promise<Space[]> =>
  apiFetch<Space[]>('/spaces');

/** Create a new space. */
export const createSpace = (name: string, workingDirectory?: string, key?: string): Promise<Space> =>
  apiFetch<Space>('/spaces', {
    method: 'POST',
    body: JSON.stringify({
      name,
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(key ? { key } : {}),
    }),
  });

/** Update a space's name and working directory. */
export const renameSpace = (id: string, name: string, workingDirectory?: string, key?: string): Promise<Space> =>
  apiFetch<Space>(`/spaces/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name,
      ...(workingDirectory !== undefined ? { workingDirectory } : {}),
      ...(key ? { key } : {}),
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

/** Fetch all tasks in a space grouped by status. */
export const getTasks = async (spaceId: string): Promise<BoardTasks> => {
  const data = await apiFetch<Record<string, unknown>>(`/spaces/${spaceId}/tasks`);
  // The response also has total and nextCursor, next to the statuses.
  return Object.fromEntries(Object.entries(data).filter(([, value]) => Array.isArray(value))) as BoardTasks;
};

/** What came back from a route that answers 304, or null if it was what the caller already had. */
export type Fresh<T> = { data: T; etag: string | null } | null;

async function getIfChanged<T>(path: string, etag: string | null | undefined): Promise<Fresh<T>> {
  let received: string | null = null;
  const data = await apiFetch<T | null>(
    path,
    etag ? { headers: { 'If-None-Match': etag } } : {},
    (res) => { received = res.headers?.get('ETag') ?? null; },
  );
  return data === null ? null : { data, etag: received };
}

/**
 * What the board shows of a space: the first cards of each column, or the last of a done one.
 *
 * @param query.limits How many cards of a status, where it is not the default.
 * @param query.epic   Only what is in this epic.
 * @param query.include Cards to bring even past the limit of their column.
 * @param query.etag   The version the caller has: if it is still current, the answer is null.
 */
export const getBoard = (
  spaceId: string,
  { limits = {}, epic = null, include = [], etag }: { limits?: Record<string, number>; epic?: string | null; include?: string[]; etag?: string | null } = {},
): Promise<Fresh<BoardResponse>> => {
  const params = new URLSearchParams();
  const overrides = Object.entries(limits).map(([statusId, n]) => `${statusId}:${n}`).join(',');
  if (overrides) params.set('limits', overrides);
  if (epic) params.set('epic', epic);
  if (include.length > 0) params.set('include', include.join(','));
  const query = params.size > 0 ? `?${params}` : '';
  return getIfChanged<BoardResponse>(`/spaces/${spaceId}/board${query}`, etag);
};

/** An issue in full, for the detail panel: cards only have the beginning of a description. */
export const getTaskForPanel = (spaceId: string, taskId: string, etag?: string | null): Promise<Fresh<Task>> =>
  getIfChanged<Task>(`/spaces/${spaceId}/tasks/${taskId}?view=panel`, etag);

/** The issues under one, without their descriptions, and how many there are and are done. */
export const getChildren = (spaceId: string, parentId: string, limit: number): Promise<{ tasks: Task[]; done: number; total: number }> =>
  apiFetch(`/spaces/${spaceId}/tasks?parent=${encodeURIComponent(parentId)}&limit=${limit}`);

/** Issues by id, wherever they are. Those that do not exist are left out. */
export const getTasksByIds = (spaceId: string, ids: string[]): Promise<{ tasks: Task[]; total: number }> =>
  apiFetch(`/spaces/${spaceId}/tasks?ids=${ids.map(encodeURIComponent).join(',')}`);

/** Find an issue by its key, in any space. */
export const getIssue = (key: string): Promise<Task & { spaceId: string }> =>
  apiFetch<Task & { spaceId: string }>(`/issues/${encodeURIComponent(key)}`);

/** What has changed in an issue, newest first. */
export const getTaskHistory = (spaceId: string, taskId: string): Promise<{ history: HistoryEntry[] }> =>
  apiFetch<{ history: HistoryEntry[] }>(`/spaces/${spaceId}/tasks/${taskId}/history`);

/**
 * Replace a space's statuses. A status without id is new. Issues in a removed status go
 * where `moves` says.
 */
export const updateSpaceStatuses = (
  spaceId: string,
  statuses: Array<Omit<Status, 'id'> & { id?: string }>,
  moves: Record<string, string>,
): Promise<Space> =>
  apiFetch<Space>(`/spaces/${spaceId}/statuses`, {
    method: 'PUT',
    body: JSON.stringify({ statuses, moves }),
  });

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

/**
 * Answer an open question on a task: post the answer comment (type 'answer',
 * linked via parentId) and then mark the question as resolved. Mirrors the
 * MCP `kanban_answer_comment` call pair — the server unblocks a run
 * blocked on the task when that was its last open question.
 */
export const answerQuestion = async (
  spaceId: string,
  taskId: string,
  questionCommentId: string,
  text: string,
  author = 'user',
): Promise<{ question: Comment; answer: Comment }> => {
  const answer = await createComment(spaceId, taskId, {
    author,
    text,
    type: 'answer',
    parentId: questionCommentId,
  });
  const question = await updateComment(spaceId, taskId, questionCommentId, { resolved: true });
  return { question, answer };
};

// ---------------------------------------------------------------------------
// Task runs
// ---------------------------------------------------------------------------

/**
 * Discover installed CLI harnesses and their availability.
 */
export const getHarnesses = (): Promise<HarnessesResponse> =>
  apiFetch<HarnessesResponse>('/harnesses');

const postJson = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Latest run of each task in a space, by task ID. */
export const getTaskRuns = (spaceId: string): Promise<Record<string, TaskRunView>> =>
  apiFetch<Record<string, TaskRunView>>(`/spaces/${spaceId}/task-runs`);

export const startTaskRun = (spaceId: string, taskId: string): Promise<BackendRun> =>
  postJson<BackendRun>(`/spaces/${spaceId}/tasks/${taskId}/run`, {});

export const requestTaskChanges = (spaceId: string, taskId: string, text: string): Promise<BackendRun> =>
  postJson<BackendRun>(`/spaces/${spaceId}/tasks/${taskId}/request-changes`, { text });

export const closeTaskRun = (spaceId: string, taskId: string): Promise<BackendRun> =>
  postJson<BackendRun>(`/spaces/${spaceId}/tasks/${taskId}/close`, {});

export const getRunFiles = (runId: string): Promise<{ files: ChangedFile[] }> =>
  apiFetch<{ files: ChangedFile[] }>(`/runs/${runId}/diff`);

export const getRunFilePatch = (runId: string, filePath: string): Promise<{ patch: string; truncated: boolean }> =>
  apiFetch<{ patch: string; truncated: boolean }>(`/runs/${runId}/diff?path=${encodeURIComponent(filePath)}`);

export const stopRun = (runId: string): Promise<BackendRun> =>
  postJson<BackendRun>(`/runs/${runId}/stop`, {});

export const createTaskPullRequest = (spaceId: string, taskId: string): Promise<BackendRun> =>
  postJson<BackendRun>(`/spaces/${spaceId}/tasks/${taskId}/pr`, {});

export const updateSpaceHooks = (spaceId: string, hooks: SpaceHooks): Promise<Space> =>
  apiFetch<Space>(`/spaces/${spaceId}/hooks`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(hooks),
  });

/** Try a stopped or failed run again. */
export const resumeRun = (runId: string): Promise<BackendRun> =>
  apiFetch<BackendRun>(`/runs/${runId}/resume`, { method: 'POST' });

/** The output of the run's latest agent turn. */
export const getRunLog = async (runId: string): Promise<string> =>
  (await apiFetch<{ log: string }>(`/runs/${runId}/log`)).log;

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
// Working directory check
// ---------------------------------------------------------------------------

/** Validate that a path is an accessible directory. */
export const validateDirectory = (dirPath: string): Promise<ValidationResult> =>
  apiFetch<ValidationResult>('/fs/validate', {
    method: 'POST',
    body: JSON.stringify({ path: dirPath }),
  });
