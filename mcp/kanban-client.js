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
