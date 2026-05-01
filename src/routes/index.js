/**
 * Prism — Main Router
 *
 * Extracted from server.js to keep the entry point lean.
 * All URL pattern matching and handler dispatch lives here.
 *
 * Usage:
 *   const { createRouter } = require('./src/routes');
 *   const mainRouter = createRouter({ dataDir, spaceManager, getApp, evictApp });
 */

'use strict';

const { sendJSON, sendError, parseBody } = require('../utils/http');
const { createApp }                      = require('../handlers/tasks');
const { handleStatic }                   = require('../handlers/static');
const { handleGetSettings, handlePutSettings } = require('../handlers/settings');
const {
  CONFIG_FILES_LIST_ROUTE,
  CONFIG_FILES_SINGLE_ROUTE,
  handleConfigListFiles,
  handleConfigReadFile,
  handleConfigSaveFile,
} = require('../handlers/config');
const {
  AGENTS_LIST_ROUTE,
  AGENTS_SINGLE_ROUTE,
  handleListAgents,
  handleGetAgent,
} = require('../handlers/agents');
const {
  AGENT_PROMPT_ROUTE,
  handleGeneratePrompt,
} = require('../handlers/prompt');
const {
  AGENT_RUNS_LIST_ROUTE,
  AGENT_RUNS_SINGLE_ROUTE,
  handleCreateAgentRun,
  handleUpdateAgentRun,
  handleListAgentRuns,
} = require('../handlers/agentRuns');
const { handleTaggerRun }          = require('../handlers/tagger');
const { handleAutoTaskGenerate, handleAutoTaskConfirm } = require('../handlers/autoTask');
const {
  TEMPLATES_LIST_ROUTE,
  TEMPLATES_SINGLE_ROUTE,
  handleListTemplates,
  handleCreateTemplate,
  handleGetTemplate,
  handleUpdateTemplate,
  handleDeleteTemplate,
} = require('../handlers/templates');
const {
  handleCreateComment,
  handleUpdateComment,
} = require('../handlers/comments');
const { handleSearchTasks } = require('../handlers/search');

const {
  PIPELINE_RUNS_LIST_ROUTE,
  PIPELINE_RUNS_SINGLE_ROUTE,
  PIPELINE_RUNS_LOG_ROUTE,
  PIPELINE_RUNS_PROMPT_ROUTE,
  PIPELINE_RUNS_PREVIEW_ROUTE,
  PIPELINE_RUNS_RESUME_ROUTE,
  PIPELINE_RUNS_STOP_ROUTE,
  PIPELINE_RUNS_BLOCK_ROUTE,
  PIPELINE_RUNS_UNBLOCK_ROUTE,
  handleCreateRun,
  handleListRuns,
  handleGetRun,
  handleGetStageLog,
  handleGetStagePrompt,
  handlePreviewPrompts,
  handleDeleteRun,
  handleResumeRun,
  handleStopRun,
  handleBlockRun,
  handleUnblockRun,
} = require('../handlers/pipeline');

// ---------------------------------------------------------------------------
// Route patterns
// ---------------------------------------------------------------------------

const COMMENTS_LIST_ROUTE   = /^\/api\/v1\/spaces\/([^/]+)\/tasks\/([^/]+)\/comments$/;
const COMMENTS_SINGLE_ROUTE = /^\/api\/v1\/spaces\/([^/]+)\/tasks\/([^/]+)\/comments\/([^/]+)$/;

const SYSTEM_INFO_ROUTE   = /^\/api\/v1\/system\/info$/;
const SPACES_LIST_ROUTE   = /^\/api\/v1\/spaces$/;
const SPACES_SINGLE_ROUTE = /^\/api\/v1\/spaces\/([^/]+)$/;
// Matches /api/v1/spaces/:spaceId/tasks and everything under it.
const SPACES_TASKS_ROUTE  = /^\/api\/v1\/spaces\/([^/]+)(\/tasks.*)$/;
// Tagger route — must be registered BEFORE SPACES_TASKS_ROUTE to avoid regex swallowing.
const TAGGER_RUN_ROUTE       = /^\/api\/v1\/spaces\/([^/]+)\/tagger\/run$/;
// Auto-task routes — also before SPACES_TASKS_ROUTE.
const AUTOTASK_GENERATE_ROUTE = /^\/api\/v1\/spaces\/([^/]+)\/autotask\/generate$/;
const AUTOTASK_CONFIRM_ROUTE  = /^\/api\/v1\/spaces\/([^/]+)\/autotask\/confirm$/;
// Global search route — MUST be registered before LEGACY_TASKS_ROUTE
// to avoid being swallowed by the /api/v1/tasks/* shim.
const SEARCH_ROUTE        = /^\/api\/v1\/tasks\/search$/;
// Legacy: /api/v1/tasks and everything under it.
const LEGACY_TASKS_ROUTE  = /^\/api\/v1(\/tasks.*)$/;
// Settings route
const SETTINGS_ROUTE      = /^\/api\/v1\/settings$/;

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
    const urlPath    = req.url.split('?')[0];

    // -------------------------------------------------------------------------
    // System info route: GET /api/v1/system/info
    // -------------------------------------------------------------------------
    if (SYSTEM_INFO_ROUTE.test(urlPath)) {
      if (method === 'GET') {
        return sendJSON(res, 200, { platform: process.platform });
      }
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    // -------------------------------------------------------------------------
    // Tagger route: POST /api/v1/spaces/:spaceId/tagger/run
    // Must be before SPACES_TASKS_ROUTE to avoid regex swallowing.
    // -------------------------------------------------------------------------
    const taggerMatch = TAGGER_RUN_ROUTE.exec(urlPath);
    if (taggerMatch) {
      const spaceId = taggerMatch[1];

      const spaceResult = spaceManager.getSpace(spaceId);
      if (!spaceResult.ok) {
        return sendError(res, 404, 'SPACE_NOT_FOUND', spaceResult.message);
      }

      if (method === 'POST') {
        return handleTaggerRun(req, res, spaceId, store, dataDir);
      }

      return sendError(res, 405, 'METHOD_NOT_ALLOWED',
        `Method '${method}' is not allowed on this route`);
    }

    // -------------------------------------------------------------------------
    // Auto-task route: POST /api/v1/spaces/:spaceId/autotask/generate
    // Must be before SPACES_TASKS_ROUTE to avoid regex swallowing.
    // -------------------------------------------------------------------------
    const autoTaskMatch = AUTOTASK_GENERATE_ROUTE.exec(urlPath);
    if (autoTaskMatch) {
      const spaceId = autoTaskMatch[1];

      const spaceResult = spaceManager.getSpace(spaceId);
      if (!spaceResult.ok) {
        return sendError(res, 404, 'SPACE_NOT_FOUND', spaceResult.message);
      }

      if (method === 'POST') {
        return handleAutoTaskGenerate(req, res, spaceId, store, spaceResult.space.workingDirectory, dataDir);
      }

      return sendError(res, 405, 'METHOD_NOT_ALLOWED',
        `Method '${method}' is not allowed on this route`);
    }

    // -------------------------------------------------------------------------
    // Auto-task confirm: POST /api/v1/spaces/:spaceId/autotask/confirm
    // -------------------------------------------------------------------------
    const autoTaskConfirmMatch = AUTOTASK_CONFIRM_ROUTE.exec(urlPath);
    if (autoTaskConfirmMatch) {
      const spaceId = autoTaskConfirmMatch[1];

      const spaceResult = spaceManager.getSpace(spaceId);
      if (!spaceResult.ok) {
        return sendError(res, 404, 'SPACE_NOT_FOUND', spaceResult.message);
      }

      if (method === 'POST') {
        return handleAutoTaskConfirm(req, res, spaceId, store);
      }

      return sendError(res, 405, 'METHOD_NOT_ALLOWED',
        `Method '${method}' is not allowed on this route`);
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
        return handleUpdateComment(req, res, store, spaceId, taskId, commentId, dataDir);
      }

      return sendError(res, 405, 'METHOD_NOT_ALLOWED',
        `Method '${method}' is not allowed on this route`);
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
        return handleCreateComment(req, res, store, spaceId, taskId, dataDir);
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
        const pipeline         = body && body.pipeline;
        const result = spaceManager.createSpace(name, workingDirectory, pipeline);

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
        const pipeline         = body && body.pipeline;
        const agentNicknames   = body && body.agentNicknames;
        const result = spaceManager.renameSpace(spaceId, name, workingDirectory, pipeline, undefined, agentNicknames);

        if (!result.ok) {
          const status = result.code === 'SPACE_NOT_FOUND' ? 404
                       : result.code === 'DUPLICATE_NAME'  ? 409
                       : 400;
          return sendError(res, status, result.code, result.message);
        }

        return sendJSON(res, 200, result.space);
      }

      if (method === 'DELETE') {
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
    // Agent launcher routes
    // -------------------------------------------------------------------------
    if (AGENTS_LIST_ROUTE.test(urlPath)) {
      if (method === 'GET') return handleListAgents(req, res);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const agentSingleMatch = AGENTS_SINGLE_ROUTE.exec(urlPath);
    if (agentSingleMatch) {
      if (method === 'GET') return handleGetAgent(req, res, agentSingleMatch[1]);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    if (AGENT_PROMPT_ROUTE.test(urlPath)) {
      if (method === 'POST') return handleGeneratePrompt(req, res, dataDir, spaceManager, store);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    // -------------------------------------------------------------------------
    // Settings routes
    // -------------------------------------------------------------------------
    if (SETTINGS_ROUTE.test(urlPath)) {
      if (method === 'GET') return handleGetSettings(req, res, dataDir);
      if (method === 'PUT') return handlePutSettings(req, res, dataDir);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    // -------------------------------------------------------------------------
    // Config file routes
    // -------------------------------------------------------------------------
    if (CONFIG_FILES_LIST_ROUTE.test(urlPath)) {
      if (method === 'GET') return handleConfigListFiles(req, res, spaceManager);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const configFileSingleMatch = CONFIG_FILES_SINGLE_ROUTE.exec(urlPath);
    if (configFileSingleMatch) {
      const fileId = configFileSingleMatch[1];
      if (method === 'GET') return handleConfigReadFile(req, res, fileId, spaceManager);
      if (method === 'PUT') return handleConfigSaveFile(req, res, fileId, spaceManager);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    // -------------------------------------------------------------------------
    // Agent run history routes
    // List route MUST be tested before single-run route to avoid regex match.
    // -------------------------------------------------------------------------
    if (AGENT_RUNS_LIST_ROUTE.test(urlPath)) {
      if (method === 'GET')  return handleListAgentRuns(req, res, dataDir);
      if (method === 'POST') return handleCreateAgentRun(req, res, dataDir);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const agentRunSingleMatch = AGENT_RUNS_SINGLE_ROUTE.exec(urlPath);
    if (agentRunSingleMatch) {
      const runId = agentRunSingleMatch[1];
      if (method === 'PATCH') return handleUpdateAgentRun(req, res, dataDir, runId);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    // -------------------------------------------------------------------------
    // Pipeline run routes
    // Order matters:
    //   1. PREVIEW_ROUTE  (/runs/preview-prompts)          — before LIST_ROUTE
    //   2. RESUME_ROUTE   (/runs/:id/resume)               — before SINGLE_ROUTE
    //   3. STOP_ROUTE     (/runs/:id/stop)                 — before SINGLE_ROUTE
    //   4. BLOCK_ROUTE    (/runs/:id/block)                — before SINGLE_ROUTE
    //   5. UNBLOCK_ROUTE  (/runs/:id/unblock)              — before SINGLE_ROUTE
    //   6. LOG_ROUTE      (/runs/:id/stages/:n/log)        — before SINGLE_ROUTE
    //   7. PROMPT_ROUTE   (/runs/:id/stages/:n/prompt)     — before SINGLE_ROUTE
    //   8. LIST_ROUTE     (/runs)
    //   9. SINGLE_ROUTE   (/runs/:id)
    // -------------------------------------------------------------------------
    if (PIPELINE_RUNS_PREVIEW_ROUTE.test(urlPath)) {
      if (method === 'POST') return handlePreviewPrompts(req, res, dataDir, spaceManager);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const pipelineResumeMatch = PIPELINE_RUNS_RESUME_ROUTE.exec(urlPath);
    if (pipelineResumeMatch) {
      const runId = pipelineResumeMatch[1];
      if (method === 'POST') return handleResumeRun(req, res, runId, dataDir);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const pipelineStopMatch = PIPELINE_RUNS_STOP_ROUTE.exec(urlPath);
    if (pipelineStopMatch) {
      const runId = pipelineStopMatch[1];
      if (method === 'POST') return handleStopRun(req, res, runId, dataDir);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const pipelineBlockMatch = PIPELINE_RUNS_BLOCK_ROUTE.exec(urlPath);
    if (pipelineBlockMatch) {
      const runId = pipelineBlockMatch[1];
      if (method === 'POST') return handleBlockRun(req, res, runId, dataDir);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const pipelineUnblockMatch = PIPELINE_RUNS_UNBLOCK_ROUTE.exec(urlPath);
    if (pipelineUnblockMatch) {
      const runId = pipelineUnblockMatch[1];
      if (method === 'POST') return handleUnblockRun(req, res, runId, dataDir);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const pipelineLogMatch = PIPELINE_RUNS_LOG_ROUTE.exec(urlPath);
    if (pipelineLogMatch) {
      const runId      = pipelineLogMatch[1];
      const stageIndex = parseInt(pipelineLogMatch[2], 10);
      if (method === 'GET') return handleGetStageLog(req, res, runId, stageIndex, dataDir);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const pipelinePromptMatch = PIPELINE_RUNS_PROMPT_ROUTE.exec(urlPath);
    if (pipelinePromptMatch) {
      const runId      = pipelinePromptMatch[1];
      const stageIndex = parseInt(pipelinePromptMatch[2], 10);
      if (method === 'GET') return handleGetStagePrompt(req, res, runId, stageIndex, dataDir);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    if (PIPELINE_RUNS_LIST_ROUTE.test(urlPath)) {
      if (method === 'POST') return handleCreateRun(req, res, dataDir, spaceManager);
      if (method === 'GET')  return handleListRuns(req, res, dataDir);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const pipelineSingleMatch = PIPELINE_RUNS_SINGLE_ROUTE.exec(urlPath);
    if (pipelineSingleMatch) {
      const runId = pipelineSingleMatch[1];
      if (method === 'GET')    return handleGetRun(req, res, runId, dataDir);
      if (method === 'DELETE') return handleDeleteRun(req, res, runId, dataDir);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    // -------------------------------------------------------------------------
    // Pipeline template routes
    // List route MUST be tested before single-template route to avoid regex match.
    // -------------------------------------------------------------------------
    if (TEMPLATES_LIST_ROUTE.test(urlPath)) {
      if (method === 'GET')  return handleListTemplates(req, res, dataDir);
      if (method === 'POST') return handleCreateTemplate(req, res, dataDir);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const templateSingleMatch = TEMPLATES_SINGLE_ROUTE.exec(urlPath);
    if (templateSingleMatch) {
      const templateId = templateSingleMatch[1];
      if (method === 'GET')    return handleGetTemplate(req, res, templateId, dataDir);
      if (method === 'PUT')    return handleUpdateTemplate(req, res, templateId, dataDir);
      if (method === 'DELETE') return handleDeleteTemplate(req, res, templateId, dataDir);
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
