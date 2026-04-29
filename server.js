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
 *   src/services/migrator.js       — startup data migration
 *   src/services/spaceManager.js   — space CRUD and directory management
 *   src/services/pipelineManager.js — pipeline run lifecycle
 *   src/services/agentResolver.js  — agent file resolution for pipeline
 *   src/services/templateManager.js — pipeline template CRUD
 *   src/routes/index.js            — URL pattern matching and handler dispatch
 *   src/handlers/tasks.js          — per-space task router factory
 *   src/handlers/static.js         — static file serving
 *   src/handlers/settings.js       — GET/PUT /api/v1/settings
 *   src/handlers/config.js         — GET/PUT /api/v1/config/files/*
 *   src/handlers/agents.js         — GET /api/v1/agents[/:id]
 *   src/handlers/prompt.js         — POST /api/v1/agent/prompt + cleanup
 *   src/handlers/agentRuns.js      — GET/POST/PATCH /api/v1/agent-runs[/:id]
 *   src/handlers/pipeline.js       — POST/GET/DELETE /api/v1/runs[/:id]
 *   src/utils/http.js              — sendJSON / sendError / parseBody
 *   src/constants.js               — COLUMNS shared constant
 */

'use strict';

const http = require('http');
const path = require('path');

const { migrate }            = require('./src/services/migrator');
const { createSpaceManager } = require('./src/services/spaceManager');
const pipelineManager        = require('./src/services/pipelineManager');
const { readSettings }       = require('./src/handlers/settings');
const { createApp }          = require('./src/handlers/tasks');
const { cleanupOldPromptFiles } = require('./src/handlers/prompt');
const { createRouter }       = require('./src/routes');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PORT     = parseInt(process.env.PORT || '3000', 10);
const DEFAULT_DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

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

  // Step 1: Run migrator + open SQLite store before anything else.
  let store;
  try {
    store = migrate(dataDir);
  } catch (err) {
    console.error('[startup] Migration failed — server cannot start:', err);
    process.exit(1);
  }

  // Step 2: Create SpaceManager bound to the store and ensure default space.
  const spaceManager = createSpaceManager(store);
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
      const app = createApp(spaceId, store);
      appCache.set(spaceId, app);
    }
    return appCache.get(spaceId);
  }

  function evictApp(spaceId) {
    appCache.delete(spaceId);
  }

  // Step 4: Build the main request handler via the router factory.
  const mainRouter = createRouter({ dataDir, store, spaceManager, getApp, evictApp });

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
  const { getActiveProcessCount } = require('./src/services/pipelineManager');
  const server = startServer();
  setupTerminalWebSocket(server);

  // Graceful shutdown: wait up to 30s for active pipeline runs to finish
  // before closing the server. This prevents SIGPIPE killing child processes.
  function gracefulShutdown(signal) {
    console.log(`\n[server] ${signal} received — starting graceful shutdown...`);
    server.close(() => {
      console.log('[server] HTTP server closed.');
    });

    try { store.close(); } catch { /* ignore — may already be closed */ }
    console.log('[server] SQLite store closed.');

    const active = typeof getActiveProcessCount === 'function' ? getActiveProcessCount() : 0;
    if (active === 0) {
      console.log('[server] No active pipeline runs. Exiting.');
      process.exit(0);
      return;
    }

    console.log(`[server] Waiting for ${active} active pipeline run(s) to finish (max 30s)...`);
    const deadline = setTimeout(() => {
      console.warn('[server] Deadline reached — forcing exit.');
      process.exit(1);
    }, 30_000);
    deadline.unref();

    const poll = setInterval(() => {
      const remaining = typeof getActiveProcessCount === 'function' ? getActiveProcessCount() : 0;
      if (remaining === 0) {
        clearInterval(poll);
        console.log('[server] All pipeline runs finished. Exiting.');
        process.exit(0);
      }
    }, 500);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
}
