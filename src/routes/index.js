/**
 * Prism — Main Router
 *
 * All URL pattern matching and handler dispatch lives here.
 *
 * Usage:
 *   const { createRouter } = require('./src/routes');
 *   const mainRouter = createRouter({ dataDir, spaceManager, getApp, evictApp });
 */

'use strict';

const { sendJSON, sendError, parseBody } = require('../utils/http');
const { createApp }                      = require('../handlers/tasks');
const { handleUpdateStatuses }           = require('../handlers/statuses');
const taskRunner                         = require('../services/taskRunner');
const { handleStatic }                   = require('../handlers/static');
const { handleGetHarnesses }             = require('../handlers/harnesses');
const { handleCreateComment, handleUpdateComment } = require('../handlers/comments');
const { handleValidate }                 = require('../handlers/fs');
const { handleSearchTasks }              = require('../handlers/search');
const {
  handleStartTaskRun,
  handleListTaskRuns,
  handleRequestChanges,
  handleCloseTaskRun,
  handleCreatePullRequest,
  handleGetRunDiff,
  handleGetRunLog,
  handleStopRun,
  handleResumeRun,
  handleUpdateHooks,
} = require('../handlers/taskRuns');

// ---------------------------------------------------------------------------
// Route patterns
// ---------------------------------------------------------------------------

const TASK_RUN_ACTION_ROUTE = /^\/api\/v1\/spaces\/([^/]+)\/tasks\/([^/]+)\/(run|request-changes|close|pr)$/;
const SPACE_TASK_RUNS_ROUTE = /^\/api\/v1\/spaces\/([^/]+)\/task-runs$/;
const SPACE_HOOKS_ROUTE     = /^\/api\/v1\/spaces\/([^/]+)\/hooks$/;
const RUN_ACTION_ROUTE      = /^\/api\/v1\/runs\/([^/]+)\/(diff|log|stop|resume)$/;
const COMMENTS_LIST_ROUTE   = /^\/api\/v1\/spaces\/([^/]+)\/tasks\/([^/]+)\/comments$/;
const COMMENTS_SINGLE_ROUTE = /^\/api\/v1\/spaces\/([^/]+)\/tasks\/([^/]+)\/comments\/([^/]+)$/;
const FS_VALIDATE_ROUTE     = /^\/api\/v1\/fs\/validate$/;
// With a space, or the legacy form for the default space.
const ISSUE_KEY_IN_PATH     = /^\/api\/v1(?:\/spaces\/([^/]+))?\/tasks\/([A-Za-z][A-Za-z0-9]{1,9}-\d+)(?=\/|$)/;
const ISSUE_ROUTE           = /^\/api\/v1\/issues\/([^/]+)$/;
const SPACE_STATUSES_ROUTE  = /^\/api\/v1\/spaces\/([^/]+)\/statuses$/;
const SPACES_LIST_ROUTE     = /^\/api\/v1\/spaces$/;
const SPACES_SINGLE_ROUTE   = /^\/api\/v1\/spaces\/([^/]+)$/;
// Matches /api/v1/spaces/:spaceId/tasks and everything under it.
const SPACES_TASKS_ROUTE    = /^\/api\/v1\/spaces\/([^/]+)(\/tasks.*)$/;
// MUST be registered before LEGACY_TASKS_ROUTE, which would swallow it.
const SEARCH_ROUTE          = /^\/api\/v1\/tasks\/search(\?|$)/;
// Legacy: /api/v1/tasks and everything under it.
const LEGACY_TASKS_ROUTE    = /^\/api\/v1(\/tasks.*)$/;
const HARNESSES_ROUTE       = /^\/api\/v1\/harnesses$/;

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Create the main request router.
 *
 * Accepts shared dependencies so the router is testable without a running
 * server (dependency-injection pattern).
 *
 * @param {object} deps
 * @param {string}   deps.dataDir      - Absolute path to the data directory.
 * @param {object}   deps.store        - Open Store instance (SQLite).
 * @param {object}   deps.spaceManager - SpaceManager instance.
 * @param {Function} deps.getApp       - `(spaceId) => app` cache accessor.
 * @param {Function} deps.evictApp     - `(spaceId) => void` cache eviction.
 * @returns {Function} `async (req, res) => void`
 */
function createRouter({ dataDir, store, spaceManager, getApp, evictApp }) {
  return async function mainRouter(req, res) {
    const { method } = req;
    let urlPath      = req.url.split('?')[0];

    // Any route of an issue also takes its key, such as WEB-142, in place of its id.
    const issueKeyMatch = ISSUE_KEY_IN_PATH.exec(urlPath);
    if (issueKeyMatch) {
      const found = store.getTaskByKey(issueKeyMatch[2]);
      if (found && found.spaceId === (issueKeyMatch[1] ?? 'default')) {
        urlPath = urlPath.replace(issueKeyMatch[2], found.task.id);
      }
    }

    // GET /api/v1/issues/:key, for what only knows the key. Old keys keep working.
    const issueMatch = ISSUE_ROUTE.exec(urlPath);
    if (issueMatch) {
      if (method !== 'GET') {
        return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
      }
      const found = store.getTaskByKey(issueMatch[1]);
      if (!found) return sendError(res, 404, 'TASK_NOT_FOUND', `Issue '${issueMatch[1]}' not found`);
      return sendJSON(res, 200, { ...found.task, spaceId: found.spaceId });
    }

    const spaceStatusesMatch = SPACE_STATUSES_ROUTE.exec(urlPath);
    if (spaceStatusesMatch) {
      const spaceResult = spaceManager.getSpace(spaceStatusesMatch[1]);
      if (!spaceResult.ok) return sendError(res, 404, 'SPACE_NOT_FOUND', spaceResult.message);
      if (method !== 'PUT') {
        return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
      }
      return handleUpdateStatuses(req, res, store, spaceStatusesMatch[1]);
    }

    // -------------------------------------------------------------------------
    // Comment routes — BEFORE SPACES_TASKS_ROUTE to avoid regex swallowing.
    // POST  /api/v1/spaces/:spaceId/tasks/:taskId/comments
    // PATCH /api/v1/spaces/:spaceId/tasks/:taskId/comments/:commentId
    // -------------------------------------------------------------------------
    const commentsSingleMatch = COMMENTS_SINGLE_ROUTE.exec(urlPath);
    if (commentsSingleMatch) {
      const spaceId   = commentsSingleMatch[1];
      const taskId    = commentsSingleMatch[2];
      const commentId = commentsSingleMatch[3];

      const spaceResult = spaceManager.getSpace(spaceId);
      if (!spaceResult.ok) {
        return sendError(res, 404, 'SPACE_NOT_FOUND', spaceResult.message);
      }

      if (method === 'PATCH') {
        return handleUpdateComment(req, res, store, spaceId, taskId, commentId);
      }

      return sendError(res, 405, 'METHOD_NOT_ALLOWED',
        `Method '${method}' is not allowed on this route`);
    }

    // -------------------------------------------------------------------------
    // Direct task runs — BEFORE SPACES_TASKS_ROUTE to avoid regex swallowing.
    // -------------------------------------------------------------------------
    const taskRunActionMatch = TASK_RUN_ACTION_ROUTE.exec(urlPath);
    if (taskRunActionMatch) {
      const [, spaceId, taskId, action] = taskRunActionMatch;
      const spaceResult = spaceManager.getSpace(spaceId);
      if (!spaceResult.ok) {
        return sendError(res, 404, 'SPACE_NOT_FOUND', spaceResult.message);
      }
      if (method !== 'POST') {
        return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
      }
      if (action === 'run') {
        return handleStartTaskRun(req, res, store, spaceId, taskId, spaceResult.space.workingDirectory);
      }
      if (action === 'request-changes') {
        return handleRequestChanges(req, res, store, spaceId, taskId);
      }
      if (action === 'pr') {
        return handleCreatePullRequest(res, spaceId, taskId);
      }
      return handleCloseTaskRun(res, spaceId, taskId);
    }

    const spaceTaskRunsMatch = SPACE_TASK_RUNS_ROUTE.exec(urlPath);
    if (spaceTaskRunsMatch) {
      const spaceResult = spaceManager.getSpace(spaceTaskRunsMatch[1]);
      if (!spaceResult.ok) {
        return sendError(res, 404, 'SPACE_NOT_FOUND', spaceResult.message);
      }
      if (method === 'GET') return handleListTaskRuns(res, spaceTaskRunsMatch[1]);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const spaceHooksMatch = SPACE_HOOKS_ROUTE.exec(urlPath);
    if (spaceHooksMatch) {
      const spaceResult = spaceManager.getSpace(spaceHooksMatch[1]);
      if (!spaceResult.ok) {
        return sendError(res, 404, 'SPACE_NOT_FOUND', spaceResult.message);
      }
      if (method === 'PUT') return handleUpdateHooks(req, res, store, spaceHooksMatch[1]);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const commentsListMatch = COMMENTS_LIST_ROUTE.exec(urlPath);
    if (commentsListMatch) {
      const spaceId = commentsListMatch[1];
      const taskId  = commentsListMatch[2];

      const spaceResult = spaceManager.getSpace(spaceId);
      if (!spaceResult.ok) {
        return sendError(res, 404, 'SPACE_NOT_FOUND', spaceResult.message);
      }

      if (method === 'POST') {
        return handleCreateComment(req, res, store, spaceId, taskId);
      }

      return sendError(res, 405, 'METHOD_NOT_ALLOWED',
        `Method '${method}' is not allowed on this route`);
    }


    // -------------------------------------------------------------------------
    // Space-scoped task routes: /api/v1/spaces/:spaceId/tasks/*
    // -------------------------------------------------------------------------
    const spaceTasksMatch = SPACES_TASKS_ROUTE.exec(urlPath);
    if (spaceTasksMatch) {
      const spaceId  = spaceTasksMatch[1];
      const taskPath = spaceTasksMatch[2];

      const spaceResult = spaceManager.getSpace(spaceId);
      if (!spaceResult.ok) {
        console.warn(`[router] SPACE_NOT_FOUND: ${spaceId}`);
        return sendError(res, 404, 'SPACE_NOT_FOUND', spaceResult.message);
      }

      const app     = getApp(spaceId);
      const handled = await app.router(req, res, taskPath);
      if (handled !== null) return;

      return sendError(res, 404, 'NOT_FOUND', `Route '${method} ${urlPath}' not found`);
    }

    // -------------------------------------------------------------------------
    // Space management routes: /api/v1/spaces and /api/v1/spaces/:spaceId
    // -------------------------------------------------------------------------
    if (SPACES_LIST_ROUTE.test(urlPath)) {
      if (method === 'GET') {
        return sendJSON(res, 200, spaceManager.listSpaces());
      }

      if (method === 'POST') {
        let body;
        try {
          body = await parseBody(req);
        } catch (err) {
          return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
        }

        const name             = body && body.name;
        const workingDirectory = body && body.workingDirectory;
        const key    = body && body.key;
        if (key !== undefined) {
          const keyCheck = spaceManager.checkKey(key);
          if (!keyCheck.ok) return sendError(res, keyCheck.code === 'DUPLICATE_KEY' ? 409 : 400, keyCheck.code, keyCheck.message);
        }
        const result = spaceManager.createSpace(name, workingDirectory, undefined, key);

        if (!result.ok) {
          const status = result.code === 'DUPLICATE_NAME' ? 409 : 400;
          return sendError(res, status, result.code, result.message);
        }

        getApp(result.space.id);
        return sendJSON(res, 201, result.space);
      }

      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const singleSpaceMatch = SPACES_SINGLE_ROUTE.exec(urlPath);
    if (singleSpaceMatch) {
      const spaceId = singleSpaceMatch[1];

      if (method === 'GET') {
        const result = spaceManager.getSpace(spaceId);
        if (!result.ok) {
          return sendError(res, 404, 'SPACE_NOT_FOUND', result.message);
        }
        return sendJSON(res, 200, result.space);
      }

      if (method === 'PUT') {
        let body;
        try {
          body = await parseBody(req);
        } catch {
          return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
        }

        const name             = body && body.name;
        const workingDirectory = body && body.workingDirectory;
        // pin/rank fields (optional; name is also optional for pin-only updates).
        const pinned      = body && body.pinned      !== undefined ? body.pinned      : undefined;
        const pinnedRank  = body && body.pinnedRank  !== undefined ? body.pinnedRank  : undefined;

        const key         = body && body.key;
        if (key !== undefined) {
          const keyCheck = spaceManager.checkKey(key, spaceId);
          if (!keyCheck.ok) return sendError(res, keyCheck.code === 'DUPLICATE_KEY' ? 409 : 400, keyCheck.code, keyCheck.message);
        }

        const result = spaceManager.renameSpace(spaceId, name, workingDirectory, pinned, pinnedRank);
        if (result.ok && key !== undefined) {
          spaceManager.setKey(spaceId, key);
          result.space = spaceManager.getSpace(spaceId).space;
        }

        if (!result.ok) {
          const status = result.code === 'SPACE_NOT_FOUND' ? 404
                       : result.code === 'DUPLICATE_NAME'  ? 409
                       : 400;
          return sendError(res, status, result.code, result.message);
        }

        return sendJSON(res, 200, result.space);
      }

      if (method === 'DELETE') {
        if (taskRunner.spaceHasActiveRun(spaceId)) {
          return sendError(res, 409, 'SPACE_RUN_ACTIVE',
            'An agent is running a task here. Stop it before deleting the space.');
        }
        await taskRunner.closeSpaceRuns(spaceId);
        const result = spaceManager.deleteSpace(spaceId);

        if (!result.ok) {
          const status = result.code === 'SPACE_NOT_FOUND' ? 404
                       : result.code === 'LAST_SPACE'       ? 400
                       : 400;
          evictApp(spaceId);
          return sendError(res, status, result.code, result.message);
        }

        evictApp(spaceId);
        return sendJSON(res, 200, { deleted: true, id: result.id });
      }

      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    // -------------------------------------------------------------------------
    // Harness discovery routes
    // -------------------------------------------------------------------------
    if (HARNESSES_ROUTE.test(urlPath)) {
      if (method === 'GET') return handleGetHarnesses(req, res);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    // -------------------------------------------------------------------------
    // Run routes: /api/v1/runs/:runId/(diff|log|stop|resume)
    // -------------------------------------------------------------------------
    const runActionMatch = RUN_ACTION_ROUTE.exec(urlPath);
    if (runActionMatch) {
      const [, runId, action] = runActionMatch;
      const expected = action === 'diff' || action === 'log' ? 'GET' : 'POST';
      if (method !== expected) {
        return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
      }
      if (action === 'diff') return handleGetRunDiff(req, res, runId);
      if (action === 'log') return handleGetRunLog(res, runId);
      if (action === 'stop') return handleStopRun(res, runId);
      return handleResumeRun(res, runId);
    }

    // -------------------------------------------------------------------------
    // Working directory check, for the space form.
    // -------------------------------------------------------------------------
    if (FS_VALIDATE_ROUTE.test(urlPath)) {
      if (method === 'POST') return handleValidate(req, res);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    // -------------------------------------------------------------------------
    // Global search route: GET /api/v1/tasks/search
    // MUST be before LEGACY_TASKS_ROUTE to avoid being swallowed by the shim.
    // -------------------------------------------------------------------------
    if (SEARCH_ROUTE.test(urlPath)) {
      if (method === 'GET') {
        return handleSearchTasks(req, res, store, spaceManager);
      }
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    // -------------------------------------------------------------------------
    // Legacy backward-compatibility shim: /api/v1/tasks/* → default space
    // ADR-1 §D2: internally rewrite to spaceId='default', no branching in
    // task-level business logic.
    // -------------------------------------------------------------------------
    const legacyMatch = LEGACY_TASKS_ROUTE.exec(urlPath);
    if (legacyMatch) {
      const taskPath = legacyMatch[1];
      console.log(`[router] route.legacy=true — rewriting '${urlPath}' → default space`);

      const app     = getApp('default');
      const handled = await app.router(req, res, taskPath);
      if (handled !== null) return;

      return sendError(res, 404, 'NOT_FOUND', `Route '${method} ${urlPath}' not found`);
    }

    // -------------------------------------------------------------------------
    // Static file serving
    // -------------------------------------------------------------------------
    if (method === 'GET') {
      return handleStatic(req, res);
    }

    sendError(res, 404, 'NOT_FOUND', `Route '${method} ${urlPath}' not found`);
  };
}

module.exports = { createRouter };
