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
        'X-Prism-Actor': process.env.PRISM_ACTOR ?? 'agent',
        ...(process.env.PRISM_TOKEN && { Authorization: `Bearer ${process.env.PRISM_TOKEN}` }),
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
 * Get a single task by ID or key, such as WEB-142, searching all statuses.
 *
 * When spaceId is provided the search is limited to that space.
 * When omitted, all spaces are iterated in order and the first match is
 * returned. The response always includes a `spaceId` field so callers know
 * which space the task belongs to.
 *
 * @param {string} id      - Task UUID.
 * @param {string} [spaceId] - Optional space ID.
 * @returns {Promise<object>}
 */
export async function getTask(id, spaceId) {
  const wantedKey = String(id).toUpperCase();

  /** A key its space used to have is not on the board any more, but still finds the issue. */
  async function findByOldKey() {
    const notFound = { error: true, code: 'TASK_NOT_FOUND', message: `Task with id '${id}' not found` };
    if (!/^[A-Z][A-Z0-9]{1,9}-\d+$/.test(wantedKey)) return notFound;
    const issue = await request('GET', `/issues/${wantedKey}`);
    if (issue.error || (spaceId && issue.spaceId !== spaceId)) return notFound;
    return { ...issue, column: issue.statusId };
  }

  /** Search a single space's task-list response, keyed by status, for `id` or a key. */
  function findInResult(result, sid) {
    for (const [column, tasks] of Object.entries(result)) {
      if (!Array.isArray(tasks)) continue;
      const task = tasks.find((t) => t.id === id || t.key === wantedKey);
      if (task) return { ...task, column, spaceId: sid };
    }
    return null;
  }

  if (spaceId) {
    // Explicit space — search only there.
    const result = await request('GET', tasksBasePath(spaceId));
    if (result.error) return result;
    return findInResult(result, spaceId) ?? findByOldKey();
  }

  // No spaceId — iterate every space until the task is found.
  const spaces = await listSpaces();
  if (spaces.error) return spaces;

  for (const space of spaces) {
    const result = await request('GET', tasksBasePath(space.id));
    if (result.error) continue; // Skip unreachable spaces.
    const found = findInResult(result, space.id);
    if (found) return found;
  }

  return findByOldKey();
}

/**
 * Create a new issue in the first to-do status of its space.
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
 * Move a task to another status of its space.
 *
 * @param {string} id
 * @param {string} to - Status id, such as 'in-review'.
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
 * Update the attachments array for a task.
 *
 * @param {string} id
 * @param {Array} attachments
 * @param {string} [spaceId]
 * @param {'merge'|'replace'} [mode] - Defaults to 'merge' (PATCH — upsert by name, keep existing).
 *   Pass 'replace' to overwrite the entire array via PUT; an empty array clears all attachments.
 * @returns {Promise<object>}
 */
export async function updateAttachments(id, attachments, spaceId, mode) {
  const body = { attachments };
  if (mode === 'replace') {
    return request('PUT', `${tasksBasePath(spaceId)}/${id}/attachments`, body);
  }
  return request('PATCH', `${tasksBasePath(spaceId)}/${id}/attachments`, body);
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
  const body = { name };
  return request('POST', '/spaces', body);
}

/**
 * Rename a space.
 * @param {string} id
 * @param {string} name
 * @returns {Promise<object|{ error: true, code: string, message: string }>}
 */
export async function renameSpace(id, name) {
  const body = { name };
  return request('PUT', `/spaces/${id}`, body);
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
// Comments — T-001 / T-002 (task-comments feature)
// ---------------------------------------------------------------------------

/**
 * Create a comment on a task.
 *
 * @param {{ spaceId: string, taskId: string, text: string, type: 'note'|'question'|'answer', author?: string, parentId?: string }} params
 * @returns {Promise<object|{ error: true, code: string, message: string }>}
 */
export async function addComment({ spaceId, taskId, text, type, author = 'user', parentId }) {
  const body = { text, type, author };
  if (parentId    !== undefined) body.parentId    = parentId;
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

