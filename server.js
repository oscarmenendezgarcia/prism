/**
 * Prism - HTTP Server (entry point)
 *
 * ADR-001: Native Node.js http module, no frameworks.
 * ADR-002: Direct disk persistence via JSON files in ./data/.
 * ADR-1 (Spaces): Directory-per-space model, eager migration at startup,
 *   nested REST routes with legacy backward-compatibility shim.
 *
 * Usage: node server.js
 * Port: 3000 (or PORT env var). Listens on 127.0.0.1 unless PRISM_HOST says otherwise.
 *
 * Module layout:
 *   src/services/store.js          — SQLite Store (better-sqlite3), all CRUD ops (ADR-1 sqlite-migration)
 *   src/services/spaceManager.js   — space CRUD backed by Store
 *   src/services/taskRunner.js — task run lifecycle
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
const fs   = require('fs');
const os   = require('os');

const { createStore }        = require('./src/services/store');
const { createSpaceManager } = require('./src/services/spaceManager');
const taskRunner             = require('./src/services/taskRunner');
const { createApp }          = require('./src/handlers/tasks');
const { createRouter }       = require('./src/routes');
const { resolveDataDir }     = require('./src/utils/dataDir');
const { resolveAccess, allowRequest } = require('./src/utils/access');
const { createAuth }         = require('./src/handlers/auth');
const { loadOrCreateSetupCode, removeSetupCode, setupUrl } = require('./src/utils/setupCode');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PORT = parseInt(process.env.PORT || '3000', 10);

const _dataDirResult = resolveDataDir({
  env:         process.env,
  packageRoot: __dirname,
  homedir:     os.homedir(),
});
const DEFAULT_DATA_DIR = _dataDirResult.path;

// ---------------------------------------------------------------------------
// Server factory — exported for use by tests and direct invocation
// ---------------------------------------------------------------------------

/**
 * Create and start an HTTP server.
 *
 * @param {object}  [options]
 * @param {number}  [options.port]      - Port to listen on. Pass 0 for OS-assigned port.
 * @param {string}  [options.dataDir]   - Absolute path to data directory.
 * @param {boolean} [options.silent]    - Suppress startup log.
 * @param {string}  [options.agentsDir] - Absolute path to agents dir (overrides env/default).
 * @param {string}  [options.host]      - Address to listen on (overrides PRISM_HOST, default 127.0.0.1).
 * @param {boolean} [options.auth]      - False to skip accounts. Only for tests: no flag or env var reaches it.
 * @returns {import('http').Server}
 */
function startServer(options = {}) {
  // Resolve the data directory for this invocation.
  // If options.dataDir is provided (e.g. from CLI --data-dir flag or tests),
  // honour it directly. Otherwise use the module-level resolved default.
  let dataDir, dataDirMode;
  if (options.dataDir) {
    dataDir     = options.dataDir;
    dataDirMode = 'env';
  } else {
    const resolved = resolveDataDir({
      env:         process.env,
      packageRoot: __dirname,
      homedir:     os.homedir(),
    });
    dataDir     = resolved.path;
    dataDirMode = resolved.mode;
  }

  const port = options.port !== undefined ? options.port : DEFAULT_PORT;

  // Ensure the data directory exists before opening the SQLite store.
  fs.mkdirSync(dataDir, { recursive: true });

  if (!options.silent) {
    console.log(`[startup] data dir: ${dataDir} (mode=${dataDirMode})`);
  }

  // Step 1: Open SQLite store (creates schema on first run).
  let store;
  try {
    store = createStore(dataDir);
  } catch (err) {
    console.error('[startup] Failed to open SQLite store — server cannot start:', err);
    process.exit(1);
  }

  // Step 2: Create SpaceManager bound to the store and ensure default space.
  const spaceManager = createSpaceManager(store);
  spaceManager.ensureAllSpaces();

  // Step 2b: Pick up the runs of the previous server.
  taskRunner.init(dataDir, store);

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
  // Step 5: Create and start the HTTP server.
  const access = resolveAccess({ host: options.host });
  // Whoever arrives first must not become the admin, and a proxy on this machine looks like
  // a local visitor. So the first account always asks a code only this server's owner can see.
  const usesAccounts = options.auth !== false;
  const setupCode = usesAccounts && !store.accounts.hasUsers() ? loadOrCreateSetupCode(dataDir) : null;
  const auth = createAuth({
    accounts: store.accounts,
    required: usesAccounts,
    setupCode,
    onSetUp: () => removeSetupCode(dataDir),
    trustProxy: !!process.env.PRISM_TRUST_PROXY,
  });

  if (process.env.PRISM_TOKEN && !options.silent) {
    console.warn('[startup] PRISM_TOKEN no longer gives access to this server. Remove it, and sign in with an account.');
  }

  const server = http.createServer((req, res) => {
    if (!allowRequest(access, req, res)) return;
    if (!auth.admit(req, res)) return;
    auth.handle(req, res).then((handled) => (handled ? undefined : mainRouter(req, res))).catch((err) => {
      console.error('Unhandled error in router:', err);
      const payload = JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
      res.end(payload);
    });
  });

  server.listen(port, access.host, () => {
    const boundPort = server.address().port;

    // Agents and card moves default to localhost:3000. On another port or address they
    // would miss this server, or send their credentials to whatever listens there. Port 0
    // is tests, where several servers share one process.
    if (!process.env.KANBAN_API_URL && port !== 0) {
      const wildcard = ['0.0.0.0', '::'].includes(access.host);
      const urlHost  = wildcard ? '127.0.0.1' : access.host.includes(':') ? `[${access.host}]` : access.host;
      process.env.KANBAN_API_URL = `http://${urlHost}:${boundPort}/api/v1`;
    }

    if (options.silent) return;
    if (setupCode) console.log(`[startup] Create the first account: ${setupUrl(setupCode, access, boundPort)}`);
    console.log(access.loopback ? `Prism running at http://localhost:${boundPort}` : `Prism listening on ${access.host}:${boundPort}`);
  });

  // Attach the store to the server instance so callers (e.g. the direct-
  // invocation bootstrap and tests that need to close the DB) can reach it
  // without breaking the existing `server.once('listening', ...)` pattern.
  server._store = store;
  server._access = access;

  return server;
}

module.exports = { startServer, runServer };

// ---------------------------------------------------------------------------
// Direct invocation bootstrap
// ---------------------------------------------------------------------------

/**
 * Run a server until told to stop, letting active runs finish first.
 *
 * @param {object} [options] - As for startServer.
 */
function runServer(options) {
  const { getActiveProcessCount } = taskRunner;
  const server = startServer(options);
  const store  = server._store;

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

if (require.main === module) runServer();
