/**
 * Prism - HTTP Server (entry point)
 *
 * ADR-001: Native Node.js http module, no frameworks.
 * ADR-002: Direct disk persistence via JSON files in ./data/.
 * ADR-1 (Spaces): Directory-per-space model, eager migration at startup,
 *   nested REST routes with legacy backward-compatibility shim.
 *
 * Usage: node server.js
 * Port: 3000 (or PORT env var)
 *
 * Module layout:
 *   src/constants.js          — COLUMNS shared constant
 *   src/utils/http.js         — sendJSON / sendError / parseBody
 *   src/handlers/tasks.js     — createApp() task router factory
 *   src/handlers/static.js    — static file serving
 *   src/handlers/settings.js  — GET/PUT /api/v1/settings
 *   src/handlers/config.js    — GET/PUT /api/v1/config/files/*
 *   src/handlers/agents.js    — GET /api/v1/agents[/:id]
 *   src/handlers/prompt.js    — POST /api/v1/agent/prompt + cleanup
 *   src/handlers/agentRuns.js — GET/POST/PATCH /api/v1/agent-runs[/:id]
 *   src/handlers/pipeline.js  — POST/GET/DELETE /api/v1/runs[/:id]
 */

'use strict';

const http = require('http');
const path = require('path');

const { migrate }            = require('./src/migrator');
const { createSpaceManager } = require('./src/spaceManager');
const pipelineManager        = require('./src/pipelineManager');

const { sendJSON, sendError, parseBody } = require('./src/utils/http');
const { createApp }                      = require('./src/handlers/tasks');
const { handleStatic }                   = require('./src/handlers/static');
const { readSettings }                   = require('./src/handlers/settings');
const { handleGetSettings, handlePutSettings } = require('./src/handlers/settings');
const {
  CONFIG_FILES_LIST_ROUTE,
  CONFIG_FILES_SINGLE_ROUTE,
  handleConfigListFiles,
  handleConfigReadFile,
  handleConfigSaveFile,
} = require('./src/handlers/config');
const {
  AGENTS_LIST_ROUTE,
  AGENTS_SINGLE_ROUTE,
  handleListAgents,
  handleGetAgent,
} = require('./src/handlers/agents');
const {
  AGENT_PROMPT_ROUTE,
  handleGeneratePrompt,
  cleanupOldPromptFiles,
} = require('./src/handlers/prompt');
const {
  AGENT_RUNS_LIST_ROUTE,
  AGENT_RUNS_SINGLE_ROUTE,
  handleCreateAgentRun,
  handleUpdateAgentRun,
  handleListAgentRuns,
} = require('./src/handlers/agentRuns');
const { handleTaggerRun } = require('./src/handlers/tagger');

const {
  PIPELINE_RUNS_LIST_ROUTE,
  PIPELINE_RUNS_SINGLE_ROUTE,
  PIPELINE_RUNS_LOG_ROUTE,
  PIPELINE_RUNS_PROMPT_ROUTE,
  PIPELINE_RUNS_PREVIEW_ROUTE,
  handleCreateRun,
  handleGetRun,
  handleGetStageLog,
  handleGetStagePrompt,
  handlePreviewPrompts,
  handleDeleteRun,
} = require('./src/handlers/pipeline');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PORT     = parseInt(process.env.PORT || '3000', 10);
const DEFAULT_DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// ---------------------------------------------------------------------------
// Route patterns for space management
// ---------------------------------------------------------------------------

const SPACES_LIST_ROUTE   = /^\/api\/v1\/spaces$/;
const SPACES_SINGLE_ROUTE = /^\/api\/v1\/spaces\/([^/]+)$/;
// Matches /api/v1/spaces/:spaceId/tasks and everything under it.
const SPACES_TASKS_ROUTE  = /^\/api\/v1\/spaces\/([^/]+)(\/tasks.*)$/;
// Tagger route — must be registered BEFORE SPACES_TASKS_ROUTE to avoid regex swallowing.
const TAGGER_RUN_ROUTE    = /^\/api\/v1\/spaces\/([^/]+)\/tagger\/run$/;
// Legacy: /api/v1/tasks and everything under it.
const LEGACY_TASKS_ROUTE  = /^\/api\/v1(\/tasks.*)$/;
// Settings route
const SETTINGS_ROUTE      = /^\/api\/v1\/settings$/;

// ---------------------------------------------------------------------------
// Server factory — exported for use by tests and direct invocation
// ---------------------------------------------------------------------------

/**
 * Create and start an HTTP server.
 *
 * @param {object}  [options]
 * @param {number}  [options.port]    - Port to listen on. Pass 0 for OS-assigned port.
 * @param {string}  [options.dataDir] - Absolute path to data directory.
 * @param {boolean} [options.silent]  - Suppress startup log.
 * @returns {import('http').Server}
 */
function startServer(options = {}) {
  const dataDir = options.dataDir || DEFAULT_DATA_DIR;
  const port    = options.port !== undefined ? options.port : DEFAULT_PORT;

  // Step 1: Run migrator before anything else.
  try {
    migrate(dataDir);
  } catch (err) {
    console.error('[startup] Migration failed — server cannot start:', err);
    process.exit(1);
  }

  // Step 2: Create SpaceManager and ensure all space directories exist.
  const spaceManager = createSpaceManager(dataDir);
  spaceManager.ensureAllSpaces();

  // Step 2b: Initialize pipeline manager (startup recovery).
  // Marks any run with status='running' as 'interrupted' from a previous crash.
  pipelineManager.init(dataDir);
  // Propagate pipeline.agentsDir from settings to env (if not already set via env var).
  if (!process.env.PIPELINE_AGENTS_DIR) {
    const startupSettings = readSettings(dataDir);
    if (startupSettings.pipeline && startupSettings.pipeline.agentsDir) {
      process.env.PIPELINE_AGENTS_DIR = startupSettings.pipeline.agentsDir;
    }
  }

  // Step 3: Build a Map-based cache of createApp instances by spaceId.
  /** @type {Map<string, ReturnType<import('./src/handlers/tasks').createApp>>} */
  const appCache = new Map();

  function getApp(spaceId) {
    if (!appCache.has(spaceId)) {
      const spaceDataDir = path.join(dataDir, 'spaces', spaceId);
      const app          = createApp(spaceDataDir);
      app.ensureDataFiles();
      appCache.set(spaceId, app);
    }
    return appCache.get(spaceId);
  }

  function evictApp(spaceId) {
    appCache.delete(spaceId);
  }

  // Step 4: Build the main request handler.

  async function mainRouter(req, res) {
    const { method } = req;
    const urlPath    = req.url.split('?')[0];

    // -----------------------------------------------------------------------
    // Tagger route: POST /api/v1/spaces/:spaceId/tagger/run
    // Must be before SPACES_TASKS_ROUTE to avoid regex swallowing.
    // -----------------------------------------------------------------------
    const taggerMatch = TAGGER_RUN_ROUTE.exec(urlPath);
    if (taggerMatch) {
      const spaceId = taggerMatch[1];

      const spaceResult = spaceManager.getSpace(spaceId);
      if (!spaceResult.ok) {
        return sendError(res, 404, 'SPACE_NOT_FOUND', spaceResult.message);
      }

      if (method === 'POST') {
        const spaceDataDir = path.join(dataDir, 'spaces', spaceId);
        return handleTaggerRun(req, res, spaceId, spaceDataDir);
      }

      return sendError(res, 405, 'METHOD_NOT_ALLOWED',
        `Method '${method}' is not allowed on this route`);
    }

    // -----------------------------------------------------------------------
    // Space-scoped task routes: /api/v1/spaces/:spaceId/tasks/*
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // Space management routes: /api/v1/spaces and /api/v1/spaces/:spaceId
    // -----------------------------------------------------------------------
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
        const result = spaceManager.renameSpace(spaceId, name, workingDirectory, pipeline);

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

    // -----------------------------------------------------------------------
    // Agent launcher routes
    // -----------------------------------------------------------------------
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
      if (method === 'POST') return handleGeneratePrompt(req, res, dataDir, spaceManager);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    // -----------------------------------------------------------------------
    // Settings routes
    // -----------------------------------------------------------------------
    if (SETTINGS_ROUTE.test(urlPath)) {
      if (method === 'GET') return handleGetSettings(req, res, dataDir);
      if (method === 'PUT') return handlePutSettings(req, res, dataDir);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    // -----------------------------------------------------------------------
    // Config file routes
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // Agent run history routes
    // List route MUST be tested before single-run route to avoid regex match.
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // Pipeline run routes
    // Order matters:
    //   1. PREVIEW_ROUTE  (/runs/preview-prompts)          — before LIST_ROUTE
    //   2. LOG_ROUTE      (/runs/:id/stages/:n/log)        — before SINGLE_ROUTE
    //   3. PROMPT_ROUTE   (/runs/:id/stages/:n/prompt)     — before SINGLE_ROUTE
    //   4. LIST_ROUTE     (/runs)
    //   5. SINGLE_ROUTE   (/runs/:id)
    // -----------------------------------------------------------------------
    if (PIPELINE_RUNS_PREVIEW_ROUTE.test(urlPath)) {
      if (method === 'POST') return handlePreviewPrompts(req, res, dataDir, spaceManager);
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
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const pipelineSingleMatch = PIPELINE_RUNS_SINGLE_ROUTE.exec(urlPath);
    if (pipelineSingleMatch) {
      const runId = pipelineSingleMatch[1];
      if (method === 'GET')    return handleGetRun(req, res, runId, dataDir);
      if (method === 'DELETE') return handleDeleteRun(req, res, runId, dataDir);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    // -----------------------------------------------------------------------
    // Legacy backward-compatibility shim: /api/v1/tasks/* → default space
    // ADR-1 §D2: internally rewrite to spaceId='default', no branching in
    // task-level business logic.
    // -----------------------------------------------------------------------
    const legacyMatch = LEGACY_TASKS_ROUTE.exec(urlPath);
    if (legacyMatch) {
      const taskPath = legacyMatch[1];
      console.log(`[router] route.legacy=true — rewriting '${urlPath}' → default space`);

      const app     = getApp('default');
      const handled = await app.router(req, res, taskPath);
      if (handled !== null) return;

      return sendError(res, 404, 'NOT_FOUND', `Route '${method} ${urlPath}' not found`);
    }

    // -----------------------------------------------------------------------
    // Static file serving
    // -----------------------------------------------------------------------
    if (method === 'GET') {
      return handleStatic(req, res);
    }

    sendError(res, 404, 'NOT_FOUND', `Route '${method} ${urlPath}' not found`);
  }

  // Step 4b: Tagger startup info — log the configured CLI.
  // Server start is NOT blocked — tagger is not a core feature (ADR-1 §Consequences).
  const taggerCli = process.env.TAGGER_CLI || 'claude';
  console.log(`[tagger] using CLI '${taggerCli}' (override with TAGGER_CLI env var)`);

  // Step 5: Run startup cleanup for old prompt files.
  cleanupOldPromptFiles(dataDir);
  setInterval(() => cleanupOldPromptFiles(dataDir), 6 * 60 * 60 * 1000).unref();

  // Step 6: Create and start the HTTP server.
  const server = http.createServer((req, res) => {
    mainRouter(req, res).catch((err) => {
      console.error('Unhandled error in router:', err);
      const payload = JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
      res.end(payload);
    });
  });

  server.listen(port, () => {
    if (!options.silent) {
      console.log(`Prism running at http://localhost:${server.address().port}`);
    }
  });

  return server;
}

module.exports = { startServer };

// ---------------------------------------------------------------------------
// Direct invocation bootstrap
// ---------------------------------------------------------------------------

if (require.main === module) {
  const { setupTerminalWebSocket } = require('./terminal');
  const server = startServer();
  setupTerminalWebSocket(server);
}
