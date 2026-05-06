#!/usr/bin/env node
'use strict';

/**
 * bin/init.js — `prism init` implementation
 *
 * Idempotently provisions Prism end-to-end after `npm i -g prism-kanban`:
 *   1. ensureDataDir   — create <dataDir> tree + write default settings.json
 *   2. startServer     — spawn server.js detached + write <dataDir>/prism.pid
 *   3. waitForServer   — poll /api/v1/spaces until 200 (6 s budget)
 *   4. registerMcp     — merge mcpServers.prism into ~/.claude/settings.json (atomic)
 *   5. installAgents   — copy agents/*.md → ~/.claude/agents/ (skip-existing)
 *   6. verifyClaude    — run `claude mcp list` as advisory check
 *
 * Exit codes:
 *   0 — success (some steps may have printed warnings)
 *   1 — fatal error (ensureDataDir failed)
 */

const path          = require('path');
const fs            = require('fs');
const os            = require('os');
const { spawn, spawnSync } = require('child_process');

const { resolveDataDir } = require(path.join(__dirname, '..', 'src', 'utils', 'dataDir.js'));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PORT            = Number(process.env.PORT || 3000);
const SERVER_BOOT_BUDGET_MS   = 6000;
const SERVER_POLL_INTERVAL_MS = 200;
const MCP_KEY                 = 'prism';

// Absolute path to the package root (works wherever npm installs the pkg)
const PACKAGE_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Default settings template (data dir)
// ---------------------------------------------------------------------------

function defaultSettings() {
  return {
    pipeline: {
      agentsDir:     path.join(os.homedir(), '.claude', 'agents'),
      timeout:       600000,
      maxConcurrent: 5,
    },
    ui: {
      theme: 'dark',
    },
  };
}

// ---------------------------------------------------------------------------
// T-201: Private helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the process identified by `pid` is alive.
 * Uses signal 0 (no-op) — throws if the process doesn't exist.
 * @param {number} pid
 * @returns {boolean}
 */
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write `obj` as pretty JSON to `filePath` atomically via a .tmp file.
 * A crash mid-write leaves only the .tmp file — never a partial target.
 * @param {string} filePath
 * @param {object} obj
 */
function atomicWriteJson(filePath, obj) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);
}

// ---------------------------------------------------------------------------
// T-202: startServer + waitForServer
// ---------------------------------------------------------------------------

/**
 * Spawns `node server.js` detached from the current process tree.
 * Skips the spawn when a PID file already points to a live process.
 *
 * @param {string} dataDir   - directory where prism.pid is stored
 * @param {number} port      - HTTP port the server will bind to
 * @returns {{ pid: number, started: boolean }}
 */
function startServer(dataDir, port) {
  const pidFile = path.join(dataDir, 'prism.pid');

  // Check whether a live server is already running
  if (fs.existsSync(pidFile)) {
    const raw = fs.readFileSync(pidFile, 'utf8').trim();
    const existingPid = parseInt(raw, 10);
    if (!isNaN(existingPid) && isPidAlive(existingPid)) {
      return { pid: existingPid, started: false };
    }
  }

  // Spawn detached — server outlives the CLI process
  const serverScript = path.join(PACKAGE_ROOT, 'server.js');
  const child = spawn(process.execPath, [serverScript], {
    detached: true,
    stdio:    'ignore',
    cwd:      PACKAGE_ROOT,
    env:      Object.assign({}, process.env, { PORT: String(port) }),
  });
  child.unref();

  fs.writeFileSync(pidFile, String(child.pid) + '\n', 'utf8');
  return { pid: child.pid, started: true };
}

/**
 * Polls `GET http://127.0.0.1:<port>/api/v1/spaces` every 200 ms until it
 * returns HTTP 200 or the budget is exhausted.
 *
 * @param {number} port
 * @param {number} [timeoutMs=6000]
 * @returns {Promise<void>} — resolves on first 200, rejects on timeout
 */
async function waitForServer(port, timeoutMs = SERVER_BOOT_BUDGET_MS) {
  const url      = `http://127.0.0.1:${port}/api/v1/spaces`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await globalThis.fetch(url);
      if (res.status === 200) return;
    } catch {
      // Connection refused or not ready yet — keep polling
    }
    await new Promise(resolve => setTimeout(resolve, SERVER_POLL_INTERVAL_MS));
  }

  throw new Error(`server boot timeout after ${timeoutMs}ms — port ${port} unreachable`);
}

// ---------------------------------------------------------------------------
// T-203: registerMcp
// ---------------------------------------------------------------------------

/**
 * Merges `mcpServers.prism` into `~/.claude/settings.json` atomically.
 * Preserves all existing top-level keys and sibling `mcpServers.*` entries.
 * Aborts (without writing) when the file exists but contains malformed JSON.
 *
 * @param {string} packageRoot  - absolute path to the installed package
 * @param {string} homedir      - user home directory (injectable for tests)
 * @returns {{ action: 'created' | 'updated' | 'unchanged' }}
 */
function registerMcp(packageRoot, homedir) {
  const claudeDir    = path.join(homedir, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const mcpServerPath = path.resolve(packageRoot, 'mcp', 'mcp-server.js');

  // Ensure ~/.claude/ exists
  fs.mkdirSync(claudeDir, { recursive: true });

  // Read existing settings (or start with empty object)
  let settings = {};
  let fileExisted = false;

  if (fs.existsSync(settingsPath)) {
    fileExisted = true;
    const raw = fs.readFileSync(settingsPath, 'utf8').trim();
    if (raw.length > 0) {
      try {
        settings = JSON.parse(raw);
      } catch {
        // Malformed — abort this step to avoid overwriting user data
        console.error(
          `[init] mcp        : ERROR — ${settingsPath} contains invalid JSON.\n` +
          `                    Fix the file manually, then re-run prism init.`
        );
        return { action: 'unchanged' };
      }
    }
  }

  // Determine current mcp entry (if any)
  const existing = settings.mcpServers && settings.mcpServers[MCP_KEY];
  const newEntry = { command: 'node', args: [mcpServerPath] };

  if (
    existing &&
    existing.command === newEntry.command &&
    Array.isArray(existing.args) &&
    existing.args[0] === mcpServerPath
  ) {
    return { action: 'unchanged' };
  }

  // Merge: preserve all top-level keys + all other mcpServers entries
  settings.mcpServers = Object.assign({}, settings.mcpServers || {}, {
    [MCP_KEY]: newEntry,
  });

  atomicWriteJson(settingsPath, settings);
  return { action: fileExisted ? 'updated' : 'created' };
}

// ---------------------------------------------------------------------------
// T-204: installAgents
// ---------------------------------------------------------------------------

/**
 * Copies `<packageRoot>/agents/*.md` into `~/.claude/agents/`.
 * Never overwrites existing destination files.
 *
 * @param {string} packageRoot
 * @param {string} homedir
 * @returns {{ installed: string[], skipped: string[] }}
 */
function installAgents(packageRoot, homedir) {
  const srcDir  = path.join(packageRoot, 'agents');
  const destDir = path.join(homedir, '.claude', 'agents');

  fs.mkdirSync(destDir, { recursive: true });

  const installed = [];
  const skipped   = [];

  // Tolerate missing agents/ directory
  if (!fs.existsSync(srcDir)) {
    return { installed, skipped };
  }

  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.md'));

  for (const filename of files) {
    const src  = path.join(srcDir, filename);
    const dest = path.join(destDir, filename);

    if (fs.existsSync(dest)) {
      skipped.push(filename);
    } else {
      fs.copyFileSync(src, dest);
      installed.push(filename);
    }
  }

  return { installed, skipped };
}

// ---------------------------------------------------------------------------
// T-205: verifyClaude
// ---------------------------------------------------------------------------

/**
 * Runs `claude mcp list` as an advisory check.
 * Never throws — ENOENT and non-zero exits are surfaced as warnings.
 *
 * @returns {{ available: boolean, output?: string, warning?: string }}
 */
function verifyClaude() {
  try {
    const result = spawnSync('claude', ['mcp', 'list'], { encoding: 'utf8' });

    if (result.error) {
      if (result.error.code === 'ENOENT') {
        return { available: false, warning: 'claude CLI not found' };
      }
      return { available: false, warning: result.error.message };
    }

    if (result.status !== 0) {
      return { available: true, warning: (result.stderr || '').trim() };
    }

    return { available: true, output: (result.stdout || '').trim() };
  } catch {
    return { available: false, warning: 'claude CLI not found' };
  }
}

// ---------------------------------------------------------------------------
// T-201 (step 1): ensureDataDir — extended from T-005
// ---------------------------------------------------------------------------

/**
 * Creates the data directory tree and writes a default settings.json when
 * absent (or when --force is passed).
 *
 * @param {object} flags
 * @param {string} [flags.dataDir]
 * @param {boolean} [flags.force]
 * @returns {{ dataDirPath: string, mode: string, settingsAction: string }}
 */
function ensureDataDir(flags = {}) {
  let dataDir, mode;

  if (flags.dataDir) {
    dataDir = flags.dataDir;
    mode    = 'env';
  } else {
    const resolved = resolveDataDir({
      env:         process.env,
      packageRoot: PACKAGE_ROOT,
      homedir:     os.homedir(),
    });
    dataDir = resolved.path;
    mode    = resolved.mode;
  }

  // This is fatal — let it throw
  fs.mkdirSync(dataDir, { recursive: true });

  const settingsPath = path.join(dataDir, 'settings.json');
  const exists       = fs.existsSync(settingsPath);
  let settingsAction;

  if (!exists || flags.force) {
    atomicWriteJson(settingsPath, defaultSettings());
    settingsAction = flags.force && exists ? 'overwritten' : 'created';
  } else {
    settingsAction = 'already exists — skipped';
  }

  return { dataDirPath: dataDir, mode, settingsAction };
}

// ---------------------------------------------------------------------------
// T-206: run() — orchestrate all steps
// ---------------------------------------------------------------------------

/**
 * @param {object}  flags
 * @param {string}  [flags.dataDir]    - override from --data-dir
 * @param {boolean} [flags.force]      - overwrite existing data-dir settings.json
 * @param {boolean} [flags.silent]     - suppress output
 * @param {number}  [flags.port]       - HTTP port (default PORT env / 3000)
 * @param {string}  [flags.homedir]    - injectable home dir (for tests)
 * @param {string}  [flags.packageRoot] - injectable package root (for tests)
 */
async function run(flags = {}) {
  const log     = flags.silent ? () => {} : (msg) => console.log(msg);
  const port    = flags.port    ? Number(flags.port)  : DEFAULT_PORT;
  const homedir = flags.homedir || os.homedir();
  const pkgRoot = flags.packageRoot || PACKAGE_ROOT;

  const warnings = [];

  // ── Step 1: ensureDataDir (fatal on failure) ────────────────────────────
  let dataDirPath;
  try {
    const result = ensureDataDir(flags);
    dataDirPath  = result.dataDirPath;
    log(`[init] data dir   : ${result.dataDirPath} (mode=${result.mode})`);
    log(`[init] settings   : ${path.join(result.dataDirPath, 'settings.json')} (${result.settingsAction})`);
  } catch (err) {
    console.error(`[init] data dir   : FATAL — ${err.message}`);
    process.exitCode = 1;
    return;
  }

  // ── Step 2: startServer ─────────────────────────────────────────────────
  let serverStarted = false;
  try {
    const result = startServer(dataDirPath, port);
    serverStarted = result.started;
    if (result.started) {
      log(`[init] server     : started (pid=${result.pid}, port=${port})`);
    } else {
      log(`[init] server     : already running (pid=${result.pid})`);
    }
  } catch (err) {
    warnings.push(`server start: ${err.message}`);
    log(`[init] server     : WARNING — ${err.message}`);
  }

  // ── Step 3: waitForServer ───────────────────────────────────────────────
  if (serverStarted) {
    try {
      await waitForServer(port);
      log(`[init] server     : ready on port ${port}`);
    } catch (err) {
      warnings.push(err.message);
      log(`[init] server     : WARNING — ${err.message}`);
      log(`[init]              Hint: set PORT=<n> if port ${port} is taken by another process.`);
    }
  }

  // ── Step 4: registerMcp ─────────────────────────────────────────────────
  try {
    const result = registerMcp(pkgRoot, homedir);
    log(`[init] mcp        : ${result.action}`);
    if (result.action === 'unchanged') {
      // Could be a skip due to malformed JSON — already logged above in registerMcp
    }
  } catch (err) {
    warnings.push(`mcp register: ${err.message}`);
    log(`[init] mcp        : WARNING — ${err.message}`);
  }

  // ── Step 5: installAgents ───────────────────────────────────────────────
  try {
    const result = installAgents(pkgRoot, homedir);
    const parts  = [];
    if (result.installed.length > 0) parts.push(`installed ${result.installed.length}`);
    if (result.skipped.length  > 0) parts.push(`skipped ${result.skipped.length}`);
    log(`[init] agents     : ${parts.length > 0 ? parts.join(', ') : 'nothing to do'}`);
  } catch (err) {
    warnings.push(`agents install: ${err.message}`);
    log(`[init] agents     : WARNING — ${err.message}`);
  }

  // ── Step 6: verifyClaude ────────────────────────────────────────────────
  try {
    const result = verifyClaude();
    if (!result.available) {
      log(`[init] claude     : not found — skipping MCP verification`);
    } else if (result.warning) {
      warnings.push(`claude mcp list: ${result.warning}`);
      log(`[init] claude     : WARNING — ${result.warning}`);
    } else {
      log(`[init] claude     : MCP entry verified`);
    }
  } catch {
    // verifyClaude guarantees no-throw, but be defensive
    log(`[init] claude     : not found — skipping MCP verification`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  if (warnings.length > 0) {
    log(`[init] Done with warnings: ${warnings.length}`);
  } else {
    log('[init] Done.');
  }
}

module.exports = {
  run,
  // Export helpers for unit testing
  isPidAlive,
  atomicWriteJson,
  startServer,
  waitForServer,
  registerMcp,
  installAgents,
  verifyClaude,
  ensureDataDir,
};

// ---------------------------------------------------------------------------
// Direct invocation
// ---------------------------------------------------------------------------

if (require.main === module) {
  run({}).catch(err => {
    console.error(`[init] FATAL: ${err.message}`);
    process.exit(1);
  });
}
