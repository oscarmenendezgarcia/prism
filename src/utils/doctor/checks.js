'use strict';

/**
 * src/utils/doctor/checks.js — Individual `prism doctor` check functions.
 *
 * Each check is a pure function with signature:
 *   (ctx) => { name, status: 'pass'|'fail', message, details? }
 *
 * ctx shape:
 *   ctx.env         — process.env (or stub)
 *   ctx.packageRoot — absolute path of the package root
 *   ctx.dataDir     — resolved data directory path
 *   ctx.deps        — optional injected dependencies for unit testing
 *
 * No check ever throws — all errors are caught and returned as fail results.
 */

const path         = require('path');
const fs           = require('fs');
const childProcess = require('child_process');

// ---------------------------------------------------------------------------
// 1. Node.js version >= 20
// ---------------------------------------------------------------------------

/**
 * @param {object} ctx
 * @returns {{ name: string, status: 'pass'|'fail', message: string }}
 */
function checkNodeVersion(ctx) {
  const deps = ctx.deps || {};
  const nodeVersion = deps.nodeVersion !== undefined
    ? deps.nodeVersion
    : process.versions.node;

  const major = parseInt(String(nodeVersion).split('.')[0], 10);

  if (major >= 20) {
    return { name: 'node-version', status: 'pass', message: `v${nodeVersion} (>= 20)` };
  }
  return {
    name:    'node-version',
    status:  'fail',
    message: `v${nodeVersion} (< 20, need >= 20)`,
  };
}

// ---------------------------------------------------------------------------
// 2. node-pty spawn-helper executable bit
// ---------------------------------------------------------------------------

/**
 * Replicates bin/postinstall.js logic:
 *   - win32              → pass (spawn-helper is not used on Windows)
 *   - file missing       → pass with "not installed for this platform" note
 *   - file exists + +x   → pass
 *   - file exists, no +x → fail
 *
 * @param {object} ctx
 * @returns {{ name: string, status: 'pass'|'fail', message: string }}
 */
function checkSpawnHelperExecutable(ctx) {
  const deps     = ctx.deps || {};
  const _fs      = deps.fs       || fs;
  const platform = deps.platform !== undefined ? deps.platform : process.platform;
  const arch     = deps.arch     !== undefined ? deps.arch     : process.arch;

  const name = 'spawn-helper';

  if (platform === 'win32') {
    return { name, status: 'pass', message: 'N/A on Windows' };
  }

  const helperPath = path.join(
    ctx.packageRoot,
    'node_modules', 'node-pty', 'prebuilds',
    `${platform}-${arch}`,
    'spawn-helper',
  );

  // Check existence
  try {
    _fs.accessSync(helperPath, _fs.constants.F_OK);
  } catch {
    return {
      name,
      status:  'pass',
      message: 'node-pty not installed for this platform (spawn-helper absent)',
    };
  }

  // Check executable bit
  let stat;
  try {
    stat = _fs.statSync(helperPath);
  } catch (err) {
    return { name, status: 'fail', message: `stat failed: ${err.message}` };
  }

  const isExecutable = (stat.mode & 0o111) !== 0;
  if (isExecutable) {
    return { name, status: 'pass', message: 'executable (+x)' };
  }
  return {
    name,
    status:  'fail',
    message: 'spawn-helper exists but is not executable (run: npm rebuild node-pty)',
  };
}

// ---------------------------------------------------------------------------
// 3. better-sqlite3 loadable
// ---------------------------------------------------------------------------

/**
 * Attempts to require and open an in-memory database.
 *
 * @param {object} ctx
 * @returns {{ name: string, status: 'pass'|'fail', message: string }}
 */
function checkBetterSqlite3(ctx) {
  const deps          = ctx.deps || {};
  const requireSqlite = deps.requireSqlite || (() => require('better-sqlite3'));

  const name = 'better-sqlite3';

  try {
    const Database = requireSqlite();
    const db = new Database(':memory:');
    db.close();
    return { name, status: 'pass', message: 'loads and opens :memory:' };
  } catch (err) {
    return { name, status: 'fail', message: err.message };
  }
}

// ---------------------------------------------------------------------------
// 4. Claude CLI available in PATH
// ---------------------------------------------------------------------------

/**
 * Spawns `claude --version` with a 2 s timeout and shell:false.
 * Uses a version-ish pattern to validate stdout.
 *
 * @param {object} ctx
 * @returns {{ name: string, status: 'pass'|'fail', message: string }}
 */
function checkClaudeCli(ctx) {
  const deps       = ctx.deps || {};
  const _spawnSync = deps.spawnSync || childProcess.spawnSync;

  const name = 'claude-cli';

  let result;
  try {
    result = _spawnSync('claude', ['--version'], {
      timeout:  2000,
      shell:    false,
      encoding: 'utf8',
    });
  } catch (err) {
    return { name, status: 'fail', message: err.message };
  }

  // spawnSync surfaces errors in result.error (not a thrown exception)
  if (result.error) {
    const code = result.error.code;
    if (code === 'ETIMEDOUT') {
      return { name, status: 'fail', message: 'timed out after 2s' };
    }
    if (code === 'ENOENT') {
      return { name, status: 'fail', message: 'not found in PATH' };
    }
    return { name, status: 'fail', message: result.error.message };
  }

  if (result.status === 0) {
    // First non-empty line of stdout is the version string
    const stdout  = typeof result.stdout === 'string' ? result.stdout : '';
    const version = stdout.split('\n').map(l => l.trim()).find(l => l.length > 0) || 'ok';
    return { name, status: 'pass', message: version };
  }

  return {
    name,
    status:  'fail',
    message: `exited with code ${result.status}`,
  };
}

// ---------------------------------------------------------------------------
// 5. dataDir writable
// ---------------------------------------------------------------------------

/**
 * Ensures the data directory exists and is writable.
 *
 * @param {object} ctx
 * @returns {{ name: string, status: 'pass'|'fail', message: string }}
 */
function checkDataDirWritable(ctx) {
  const deps = ctx.deps || {};
  const _fs  = deps.fs || fs;

  const name    = 'data-dir-writable';
  const dataDir = ctx.dataDir;

  try {
    _fs.mkdirSync(dataDir, { recursive: true });
    _fs.accessSync(dataDir, _fs.constants.W_OK);
    return { name, status: 'pass', message: dataDir };
  } catch (err) {
    return { name, status: 'fail', message: err.message };
  }
}

// ---------------------------------------------------------------------------
// 6. Server status via prism.pid
// ---------------------------------------------------------------------------

/**
 * Reads <dataDir>/prism.pid:
 *   - absent       → pass "stopped"
 *   - pid alive    → pass "server running (pid N)"
 *   - pid dead     → fail "stale pid file (pid N not alive)"
 *
 * @param {object} ctx
 * @returns {{ name: string, status: 'pass'|'fail', message: string }}
 */
function checkServerStatus(ctx) {
  const deps        = ctx.deps || {};
  const _fs         = deps.fs          || fs;
  const processKill = deps.processKill || ((pid, sig) => process.kill(pid, sig));

  const name    = 'server-status';
  const pidPath = path.join(ctx.dataDir, 'prism.pid');

  // Read the pid file
  let raw;
  try {
    raw = _fs.readFileSync(pidPath, 'utf8').trim();
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { name, status: 'pass', message: 'stopped' };
    }
    return { name, status: 'fail', message: err.message };
  }

  // Parse the PID
  const pid = parseInt(raw, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return { name, status: 'fail', message: `invalid pid in prism.pid: "${raw}"` };
  }

  // Check if the process is alive (signal 0 = existence check only)
  try {
    processKill(pid, 0);
    return { name, status: 'pass', message: `server running (pid ${pid})` };
  } catch {
    return { name, status: 'fail', message: `stale pid file (pid ${pid} not alive)` };
  }
}

// ---------------------------------------------------------------------------
// Exported checks array — display order matters
// ---------------------------------------------------------------------------

const CHECKS = [
  checkNodeVersion,
  checkSpawnHelperExecutable,
  checkBetterSqlite3,
  checkClaudeCli,
  checkDataDirWritable,
  checkServerStatus,
];

module.exports = {
  CHECKS,
  checkNodeVersion,
  checkSpawnHelperExecutable,
  checkBetterSqlite3,
  checkClaudeCli,
  checkDataDirWritable,
  checkServerStatus,
};
