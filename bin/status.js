#!/usr/bin/env node
'use strict';

/**
 * bin/status.js — `prism status` implementation
 *
 * Reports the state of the local Prism server for both humans and scripts:
 *   - server running/stopped (PID + signal-0 is the source of truth)
 *   - PID, port, version, active pipeline-run count, dataDir, SQLite path
 *   - API reachability flag
 *
 * The port is NOT persisted on disk (prism.pid holds only the PID), so it is
 * resolved as `--port` ▸ `PORT` env ▸ `3000`. When the process is alive but the
 * API is unreachable (booting / wrong port / wedged) we still report `running`
 * with `activeRuns: null` and `api: "unreachable"` rather than lying.
 *
 * Exit codes:
 *   0 — server running (PID alive)
 *   1 — server stopped (no PID file / stale PID)
 */

const path = require('path');
const os   = require('os');

const { resolveDataDir } = require(path.join(__dirname, '..', 'src', 'utils', 'dataDir.js'));
// DRY: PID semantics live in stop.js — single source of truth.
const { readPidFile, isPidAlive } = require(path.join(__dirname, 'stop.js'));
const { version } = require(path.join(__dirname, '..', 'package.json'));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PACKAGE_ROOT   = path.resolve(__dirname, '..');
const DEFAULT_PORT   = 3000;
const PROBE_TIMEOUT_MS = 1500;

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Resolve the port to probe: `--port` flag ▸ `PORT` env ▸ 3000.
 * Always returns an integer; falls back to the default on non-numeric input.
 *
 * @param {object} [flags]
 * @param {object} [env]
 * @returns {number}
 */
function resolvePort(flags = {}, env = process.env) {
  if (flags.port !== undefined && flags.port !== null) {
    const p = parseInt(flags.port, 10);
    if (Number.isFinite(p)) return p;
  }
  if (env.PORT !== undefined && env.PORT !== '') {
    const p = parseInt(env.PORT, 10);
    if (Number.isFinite(p)) return p;
  }
  return DEFAULT_PORT;
}

/**
 * Assemble the status object from resolved inputs. Pure — no fs/http/process.
 * Single source for text output, JSON output, and the exit code.
 *
 * @param {object}  inputs
 * @param {boolean} inputs.running
 * @param {number|null} inputs.pid
 * @param {number}  inputs.port
 * @param {string}  inputs.version
 * @param {number|null} inputs.activeRuns  - integer when known, null when unknown
 * @param {string}  inputs.dataDir
 * @returns {object} status object { running, pid, port, version, activeRuns, dataDir, sqlitePath, api }
 */
function buildStatus({ running, pid, port, version, activeRuns, dataDir }) {
  return {
    running,
    pid: pid ?? null,
    port,
    version,
    activeRuns: typeof activeRuns === 'number' ? activeRuns : null,
    dataDir,
    sqlitePath: path.join(dataDir, 'prism.db'),
    api: typeof activeRuns === 'number' ? 'reachable' : 'unreachable',
  };
}

/**
 * Fetch the count of active (running) pipeline runs from the local server.
 *
 * GETs http://127.0.0.1:<port>/api/v1/runs?status=running with a ~1.5s abort
 * budget and counts `status === 'running'` client-side (the live handler has no
 * server-side filter — the query string is future-compatible but harmless).
 *
 * Never throws: any failure (network error, timeout, non-200, non-array body)
 * degrades to `{ count: null, reason }`.
 *
 * @param {number} port
 * @param {object} [deps]
 * @param {Function} [deps._fetch]   - replaces globalThis.fetch for tests
 * @param {number}   [deps.timeoutMs]
 * @returns {Promise<{count: number|null, reason?: string}>}
 */
async function fetchActiveRunCount(port, deps = {}) {
  const _fetch    = deps._fetch    || globalThis.fetch;
  const timeoutMs = deps.timeoutMs || PROBE_TIMEOUT_MS;

  if (typeof _fetch !== 'function') {
    return { count: null, reason: 'fetch unavailable' };
  }

  const url = `http://127.0.0.1:${port}/api/v1/runs?status=running`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await _fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res || !res.ok) {
      return { count: null, reason: `http ${res ? res.status : 'no-response'}` };
    }
    const body = await res.json();
    if (!Array.isArray(body)) {
      return { count: null, reason: 'non-array body' };
    }
    return { count: body.filter(r => r && r.status === 'running').length };
  } catch (err) {
    return { count: null, reason: err && err.message ? err.message : 'fetch failed' };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const ANSI_GREEN = '\x1b[32m';
const ANSI_RED   = '\x1b[31m';
const ANSI_RESET = '\x1b[0m';

/**
 * True when stdout is a real TTY and NO_COLOR is unset. Called lazily so tests
 * can override process.stdout.isTTY before invocation (matches doctor.js).
 */
function shouldColorize() {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function green(str) { return shouldColorize() ? `${ANSI_GREEN}${str}${ANSI_RESET}` : str; }
function red(str)   { return shouldColorize() ? `${ANSI_RED}${str}${ANSI_RESET}`   : str; }

// Width of the label column so values align.
const LABEL_COL_WIDTH = 12;

function pad(label) { return label.padEnd(LABEL_COL_WIDTH); }

/**
 * Render the status object as an aligned human-readable block.
 *
 * @param {object} status
 * @returns {string}
 */
function formatText(status) {
  const lines = ['prism status', ''];

  if (!status.running) {
    lines.push(`  ${pad('Server')} ${red('not running')}`);
    lines.push(`  ${pad('Version')} ${status.version}`);
    lines.push(`  ${pad('Data dir')} ${status.dataDir}`);
    lines.push(`  ${pad('SQLite')} ${status.sqlitePath}`);
    return lines.join('\n');
  }

  const runsLabel = status.activeRuns === null
    ? `unknown (API not responding on port ${status.port})`
    : String(status.activeRuns);

  lines.push(`  ${pad('Server')} ${green('running')} (pid ${status.pid})`);
  lines.push(`  ${pad('Port')} ${status.port}`);
  lines.push(`  ${pad('Version')} ${status.version}`);
  lines.push(`  ${pad('Active runs')} ${runsLabel}`);
  lines.push(`  ${pad('Data dir')} ${status.dataDir}`);
  lines.push(`  ${pad('SQLite')} ${status.sqlitePath}`);
  return lines.join('\n');
}

/**
 * Render the status object as a single-line JSON string.
 *
 * @param {object} status
 * @returns {string}
 */
function formatJson(status) {
  return JSON.stringify(status);
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

/**
 * @param {object}  flags
 * @param {string}  [flags.dataDir] - override from --data-dir
 * @param {string}  [flags.port]    - override probe port from --port
 * @param {boolean} [flags.json]    - machine-readable output
 *
 * @param {object}   [deps]                    - injectable for unit testing
 * @param {Function} [deps._readPidFile]       - replaces readPidFile()
 * @param {Function} [deps._isPidAlive]        - replaces isPidAlive()
 * @param {Function} [deps._fetchActiveRunCount] - replaces fetchActiveRunCount()
 * @param {Function} [deps._exit]              - replaces process.exit()
 * @param {object}   [deps._stdout]            - replaces process.stdout
 * @param {object}   [deps._stderr]            - replaces process.stderr
 */
async function run(flags = {}, deps = {}) {
  const {
    _readPidFile         = readPidFile,
    _isPidAlive          = isPidAlive,
    _fetchActiveRunCount = fetchActiveRunCount,
    _exit                = (code) => process.exit(code),
    _stdout              = process.stdout,
    _stderr              = process.stderr,
  } = deps;

  // ── Resolve data directory ────────────────────────────────────────────────
  let dataDir;
  if (flags.dataDir) {
    dataDir = flags.dataDir;
  } else {
    const resolved = resolveDataDir({
      env:         process.env,
      packageRoot: PACKAGE_ROOT,
      homedir:     os.homedir(),
    });
    dataDir = resolved.path;
  }

  const emit = (status) => {
    const out = flags.json ? formatJson(status) : formatText(status);
    _stdout.write(out + '\n');
  };

  // ── Read PID file ─────────────────────────────────────────────────────────
  const pid = _readPidFile(dataDir);

  // Stopped: no PID file, unparseable PID, or stale (dead) process.
  if (pid === null || !_isPidAlive(pid)) {
    const status = buildStatus({
      running:    false,
      pid:        null,
      port:       resolvePort(flags, process.env),
      version,
      activeRuns: null,
      dataDir,
    });
    emit(status);
    _exit(1);
    return;
  }

  // ── Running: enrich with a best-effort run count ──────────────────────────
  const port = resolvePort(flags, process.env);
  const { count } = await _fetchActiveRunCount(port);

  const status = buildStatus({
    running:    true,
    pid,
    port,
    version,
    activeRuns: count,
    dataDir,
  });
  emit(status);
  _exit(0);
}

module.exports = {
  run,
  // Exported for unit testing
  readPidFile,
  isPidAlive,
  resolvePort,
  buildStatus,
  fetchActiveRunCount,
  formatText,
  formatJson,
};

// ---------------------------------------------------------------------------
// Direct invocation
// ---------------------------------------------------------------------------

if (require.main === module) {
  run({}).catch(err => {
    process.stderr.write(`[status] FATAL: ${err.message}\n`);
    process.exit(1);
  });
}
