/**
 * Prism HTTP Client
 *
 * Thin HTTP client that wraps the Prism REST API.
 * Uses the Node.js native `http` module — no fetch, no axios.
 *
 * ADR-001 §3.4: HTTP client coupling.
 * ADR-1 (Spaces): All task functions now accept an optional spaceId.
 *   - When spaceId is provided, requests go to /spaces/{spaceId}/tasks/*.
 *   - When omitted, requests use the legacy /tasks/* shim (default space).
 *
 * Base URL: process.env.KANBAN_API_URL ?? 'http://localhost:3000/api/v1'
 * Timeout: 5000 ms per request.
 *
 * All functions return parsed JSON on success.
 * On error they return: { error: true, code: string, message: string }
 */

import http from 'node:http';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL   = process.env.KANBAN_API_URL ?? 'http://localhost:3000/api/v1';
const TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Internal HTTP helper
// ---------------------------------------------------------------------------

/**
 * Parse a URL string into { hostname, port, basePath } for `http.request`.
 * @param {string} url
 * @returns {{ hostname: string, port: number, basePath: string }}
 */
function parseBaseUrl(url) {
  const parsed = new URL(url);
  return {
    hostname: parsed.hostname,
    port:     parseInt(parsed.port || '80', 10),
    basePath: parsed.pathname.replace(/\/$/, ''),
  };
}

/**
 * Make an HTTP request to the Kanban API.
 *
 * @param {'GET'|'POST'|'PUT'|'DELETE'} method
 * @param {string} path - Path relative to base (e.g. '/tasks')
 * @param {object|null} body - Request body (serialized as JSON) or null.
 * @returns {Promise<object>} Parsed response body on success; error object on failure.
 */
function request(method, path, body = null) {
  return new Promise((resolve) => {
    const { hostname, port, basePath } = parseBaseUrl(BASE_URL);
    const fullPath = basePath + path;
    const payload  = body !== null ? JSON.stringify(body) : null;

    const options = {
      hostname,
      port,
      path:    fullPath,
      method,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...(payload !== null && { 'Content-Length': Buffer.byteLength(payload) }),
      },
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          resolve({
            error:   true,
            code:    'INTERNAL_ERROR',
            message: `Server returned non-JSON response with status ${res.statusCode}`,
          });
          return;
        }

        if (res.statusCode >= 400) {
          const apiError = parsed.error ?? {};
          resolve({
            error:   true,
            code:    apiError.code    ?? 'API_ERROR',
            message: apiError.message ?? `Request failed with status ${res.statusCode}`,
          });
          return;
        }

        resolve(parsed);
      });
    });

    // 5-second timeout per request (ADR-001 §3.4).
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      resolve({ error: true, code: 'TIMEOUT', message: 'Request timed out after 5s' });
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        resolve({
          error:   true,
          code:    'SERVER_UNAVAILABLE',
          message: 'Kanban server is not running. Start it with: node server.js',
        });
        return;
      }
      if (!req.destroyed) {
        resolve({
          error:   true,
          code:    'REQUEST_ERROR',
          message: err.message,
        });
      }
    });

    if (payload !== null) {
      req.write(payload);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the tasks base path for a given optional spaceId.
 * When spaceId is provided, returns the canonical space-scoped path.
 * When omitted, returns the legacy /tasks path (default space shim).
 *
 * @param {string|undefined} spaceId
 * @returns {string}
 */
function tasksBasePath(spaceId) {
  return spaceId ? `/spaces/${spaceId}/tasks` : '/tasks';
}

// ---------------------------------------------------------------------------
// Public API — Task operations
// ---------------------------------------------------------------------------

/**
 * List tasks with optional filtering and cursor-based pagination.
 *
 * @param {{ column?: string, assigned?: string, spaceId?: string, limit?: number, cursor?: string }} [filters]
 * @returns {Promise<object>}
 */
export async function listTasks(filters = {}) {
  const { column, assigned, spaceId, limit, cursor } = filters;

  const qs = new URLSearchParams();
  if (column)   qs.set('column',   column);
  if (assigned) qs.set('assigned', assigned);
  if (limit)    qs.set('limit',    String(limit));
  if (cursor)   qs.set('cursor',   cursor);

  const queryString = qs.toString() ? `?${qs.toString()}` : '';
  return request('GET', `${tasksBasePath(spaceId)}${queryString}`);
}

/**
 * Get a single task by ID, searching all columns.
 *
 * @param {string} id - Task UUID.
 * @param {string} [spaceId] - Optional space ID.
 * @returns {Promise<object>}
 */
export async function getTask(id, spaceId) {
  const result = await request('GET', tasksBasePath(spaceId));
  if (result.error) return result;

  const COLUMNS = ['todo', 'in-progress', 'done'];
  for (const column of COLUMNS) {
    const task = (result[column] ?? []).find((t) => t.id === id);
    if (task) {
      return { ...task, column };
    }
  }

  return {
    error:   true,
    code:    'TASK_NOT_FOUND',
    message: `Task with id '${id}' not found`,
  };
}

/**
 * Create a new task in the 'todo' column.
 *
 * @param {{ title: string, type: string, description?: string, assigned?: string }} data
 * @param {string} [spaceId]
 * @returns {Promise<object>}
 */
export async function createTask(data, spaceId) {
  return request('POST', tasksBasePath(spaceId), data);
}

/**
 * Update one or more fields of an existing task.
 *
 * @param {string} id
 * @param {{ title?: string, type?: string, description?: string, assigned?: string }} data
 * @param {string} [spaceId]
 * @returns {Promise<object>}
 */
export async function updateTask(id, data, spaceId) {
  return request('PUT', `${tasksBasePath(spaceId)}/${id}`, data);
}

/**
 * Move a task to a different column.
 *
 * @param {string} id
 * @param {'todo'|'in-progress'|'done'} to
 * @param {string} [spaceId]
 * @returns {Promise<object>}
 */
export async function moveTask(id, to, spaceId) {
  return request('PUT', `${tasksBasePath(spaceId)}/${id}/move`, { to });
}

/**
 * Permanently delete a task.
 *
 * @param {string} id
 * @param {string} [spaceId]
 * @returns {Promise<object>}
 */
export async function deleteTask(id, spaceId) {
  return request('DELETE', `${tasksBasePath(spaceId)}/${id}`);
}

/**
 * Replace the attachments array for a task.
 *
 * @param {string} id
 * @param {Array} attachments
 * @param {string} [spaceId]
 * @returns {Promise<object>}
 */
export async function updateAttachments(id, attachments, spaceId) {
  return request('PUT', `${tasksBasePath(spaceId)}/${id}/attachments`, { attachments });
}

/**
 * Delete all tasks from every column, clearing the entire board of a space.
 *
 * @param {string} [spaceId] - When omitted, clears the default space (legacy shim).
 * @returns {Promise<{ deleted: number }|{ error: true, code: string, message: string }>}
 */
export async function clearBoard(spaceId) {
  return request('DELETE', tasksBasePath(spaceId), null);
}

// ---------------------------------------------------------------------------
// Public API — Space management
// ---------------------------------------------------------------------------

/**
 * List all spaces.
 * @returns {Promise<object[]|{ error: true, code: string, message: string }>}
 */
export async function listSpaces() {
  return request('GET', '/spaces');
}

/**
 * Create a new space.
 * @param {string} name
 * @returns {Promise<object|{ error: true, code: string, message: string }>}
 */
export async function createSpace(name) {
  return request('POST', '/spaces', { name });
}

/**
 * Rename a space.
 * @param {string} id
 * @param {string} name
 * @returns {Promise<object|{ error: true, code: string, message: string }>}
 */
export async function renameSpace(id, name) {
  return request('PUT', `/spaces/${id}`, { name });
}

/**
 * Delete a space and all its tasks.
 * @param {string} id
 * @returns {Promise<{ deleted: boolean, id: string }|{ error: true, code: string, message: string }>}
 */
export async function deleteSpace(id) {
  return request('DELETE', `/spaces/${id}`);
}

// ---------------------------------------------------------------------------
// Pipeline runs — ADR-1 (mcp-start-pipeline)
// ---------------------------------------------------------------------------

/**
 * Start a new pipeline run for the given kanban task (fire-and-forget).
 * Returns the initial Run object including the runId immediately.
 *
 * @param {{ spaceId: string, taskId: string, stages?: string[] }} params
 * @returns {Promise<object|{ error: true, code: string, message: string }>}
 */
export async function startPipeline({ spaceId, taskId, stages }) {
  return request('POST', '/runs', { spaceId, taskId, stages });
}

/**
 * Get the current status of a pipeline run by runId.
 *
 * @param {string} runId - The runId returned by startPipeline.
 * @returns {Promise<object|{ error: true, code: string, message: string }>}
 */
export async function getRunStatus(runId) {
  return request('GET', `/runs/${runId}`);
}

/**
 * Resume an interrupted or failed pipeline run.
 *
 * @param {string} runId - The runId of the interrupted/failed run.
 * @param {number} [fromStage] - Zero-based stage index to resume from.
 *   Omit to resume from the first non-completed stage.
 * @returns {Promise<object|{ error: true, code: string, message: string }>}
 */
export async function resumePipeline({ runId, fromStage }) {
  const body = fromStage !== undefined ? { fromStage } : {};
  return request('POST', `/runs/${runId}/resume`, body);
}

/**
 * Stop a running pipeline run by sending SIGTERM to the active stage process.
 * The run is marked as `interrupted` and its directory is preserved so it can
 * be resumed later with resumePipeline.
 *
 * @param {string} runId - The runId to stop.
 * @returns {Promise<object|{ error: true, code: string, message: string }>}
 */
export async function stopPipeline(runId) {
  return request('POST', `/runs/${runId}/stop`, {});
}

// ---------------------------------------------------------------------------
// Comments — T-001 / T-002 (task-comments feature)
// ---------------------------------------------------------------------------

/**
 * Create a comment on a task.
 *
 * @param {{ spaceId: string, taskId: string, text: string, type: 'note'|'question'|'answer', author?: string, parentId?: string, targetAgent?: string }} params
 * @returns {Promise<object|{ error: true, code: string, message: string }>}
 */
export async function addComment({ spaceId, taskId, text, type, author = 'user', parentId, targetAgent }) {
  const body = { text, type, author };
  if (parentId    !== undefined) body.parentId    = parentId;
  if (targetAgent !== undefined) body.targetAgent = targetAgent;
  return request('POST', `/spaces/${spaceId}/tasks/${taskId}/comments`, body);
}

/**
 * Answer an existing question comment.
 *
 * Steps:
 *   1. Creates a new 'answer' comment with parentId = commentId.
 *   2. Marks the original question as resolved=true via PATCH.
 *
 * @param {{ spaceId: string, taskId: string, commentId: string, answer: string, author?: string }} params
 * @returns {Promise<{ answerComment: object, resolvedQuestion: object }|{ error: true, code: string, message: string }>}
 */
export async function answerComment({ spaceId, taskId, commentId, answer, author = 'user' }) {
  // 1. Create the answer comment.
  const answerComment = await request(
    'POST',
    `/spaces/${spaceId}/tasks/${taskId}/comments`,
    { text: answer, type: 'answer', author, parentId: commentId },
  );
  if (answerComment.error) return answerComment;

  // 2. Mark the original question as resolved.
  const resolvedQuestion = await request(
    'PATCH',
    `/spaces/${spaceId}/tasks/${taskId}/comments/${commentId}`,
    { resolved: true },
  );
  if (resolvedQuestion.error) return resolvedQuestion;

  return { answerComment, resolvedQuestion };
}

// ---------------------------------------------------------------------------
// Pipeline block/unblock — pipeline-blocked feature
// ---------------------------------------------------------------------------

/**
 * Block a pipeline run (set status = 'blocked'). Called automatically
 * when an agent adds a question comment.
 *
 * @param {string} runId
 * @returns {Promise<object|{ error: true, code: string, message: string }>}
 */
export async function blockRun(runId) {
  return request('POST', `/runs/${runId}/block`, {});
}

/**
 * Unblock a pipeline run (set status = 'running'). Called automatically
 * when all question comments on a task are resolved.
 *
 * @param {string} runId
 * @returns {Promise<object|{ error: true, code: string, message: string }>}
 */
export async function unblockRun(runId) {
  return request('POST', `/runs/${runId}/unblock`, {});
}

/**
 * Find the most-recent active pipeline run for a (spaceId, taskId) pair.
 * Returns the registry summary object, or null when no active run is found.
 *
 * "Active" = status is one of: pending, running, blocked, paused.
 *
 * @param {{ spaceId: string, taskId: string }} params
 * @returns {Promise<object|null|{ error: true, code: string, message: string }>}
 */
export async function findActiveRunForTask({ spaceId, taskId }) {
  const result = await request('GET', '/runs');
  if (result && result.error) return result;

  const ACTIVE_STATUSES = new Set(['pending', 'running', 'blocked', 'paused']);
  const runs = Array.isArray(result) ? result : [];
  const match = runs
    .filter((r) => r.spaceId === spaceId && r.taskId === taskId && ACTIVE_STATUSES.has(r.status))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

  return match ?? null;
}

// ---------------------------------------------------------------------------
// Search — cross-space full-text search
// ---------------------------------------------------------------------------

/**
 * Search tasks by text across all spaces using FTS5 BM25 ranking.
 * Calls GET /tasks/search?q=<query>[&limit=<n>].
 *
 * @param {{ q: string, limit?: number }} params
 * @returns {Promise<{ query: string, count: number, results: Array<{task: object, spaceId: string, spaceName: string, column: string}> }|{ error: true, code: string, message: string }>}
 */
export async function searchTasks({ q, limit }) {
  const qs = new URLSearchParams({ q });
  if (limit) qs.set('limit', String(limit));
  return request('GET', `/tasks/search?${qs.toString()}`);
}

// ---------------------------------------------------------------------------
// Activity feed — ADR-1 (Activity Feed) §T-008
// ---------------------------------------------------------------------------

/**
 * List activity events, optionally scoped to a space.
 *
 * @param {{ spaceId?: string, type?: string, limit?: number, from?: string, to?: string, cursor?: string }} [params]
 * @returns {Promise<{ events: object[], nextCursor: string|null }|{ error: true, code: string, message: string }>}
 */
export async function listActivity(params = {}) {
  const { spaceId, type, limit, from, to, cursor } = params;

  const qs = new URLSearchParams();
  if (type)   qs.set('type',   type);
  if (limit)  qs.set('limit',  String(limit));
  if (from)   qs.set('from',   from);
  if (to)     qs.set('to',     to);
  if (cursor) qs.set('cursor', cursor);

  const queryString = qs.toString() ? `?${qs.toString()}` : '';
  const path        = spaceId
    ? `/spaces/${spaceId}/activity${queryString}`
    : `/activity${queryString}`;

  return request('GET', path);
}
