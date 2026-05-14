#!/usr/bin/env node
'use strict';

/**
 * bin/stop.js — `prism stop` implementation
 *
 * Reads <dataDir>/prism.pid, sends SIGTERM (or SIGKILL with --force),
 * then polls until the process disappears (max 35 s).
 *
 * Exit codes:
 *   0 — stopped cleanly (or was already not running)
 *   1 — timeout after 35 s
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const { resolveDataDir } = require(path.join(__dirname, '..', 'src', 'utils', 'dataDir.js'));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PACKAGE_ROOT     = path.resolve(__dirname, '..');
const POLL_INTERVAL_MS = 250;
const TIMEOUT_MS       = 35_000;

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Read <dataDir>/prism.pid and return the parsed PID, or null when the file
 * is absent or does not contain a valid positive integer.
 *
 * @param {string} dataDir
 * @returns {number|null}
 */
function readPidFile(dataDir) {
  const pidPath = path.join(dataDir, 'prism.pid');
  try {
    const raw = fs.readFileSync(pidPath, 'utf8').trim();
    const pid = parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Returns true when the OS reports `pid` as alive.
 * Uses signal 0 (no-op) which only checks existence.
 *
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
 * Remove <dataDir>/prism.pid, swallowing ENOENT.
 *
 * @param {string} dataDir
 */
function removePidFile(dataDir) {
  try {
    fs.unlinkSync(path.join(dataDir, 'prism.pid'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Poll until `pid` is no longer alive, or until `timeoutMs` elapses.
 *
 * @param {number}   pid
 * @param {number}   timeoutMs
 * @param {number}   pollIntervalMs
 * @returns {Promise<boolean>} true = clean exit, false = timed out
 */
async function waitForExit(pid, timeoutMs, pollIntervalMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

/**
 * @param {object}  flags
 * @param {string}  [flags.dataDir]  - override from --data-dir
 * @param {boolean} [flags.force]    - send SIGKILL instead of SIGTERM
 * @param {boolean} [flags.silent]   - suppress informational output
 *
 * @param {object}  [deps]                  - injectable for unit testing
 * @param {Function} [deps._isPidAlive]     - replaces isPidAlive()
 * @param {Function} [deps._sendSignal]     - replaces process.kill(pid, signal)
 * @param {Function} [deps._waitForExit]    - replaces the polling loop
 * @param {Function} [deps._removePidFile]  - replaces removePidFile()
 * @param {Function} [deps._readPidFile]    - replaces readPidFile()
 * @param {Function} [deps._exit]           - replaces process.exit()
 * @param {object}   [deps._stdout]         - replaces process.stdout
 * @param {object}   [deps._stderr]         - replaces process.stderr
 */
async function run(flags = {}, deps = {}) {
  const {
    _isPidAlive    = isPidAlive,
    _sendSignal    = (pid, signal) => process.kill(pid, signal),
    _waitForExit   = waitForExit,
    _removePidFile = removePidFile,
    _readPidFile   = readPidFile,
    _exit          = (code) => process.exit(code),
    _stdout        = process.stdout,
    _stderr        = process.stderr,
    pollIntervalMs = POLL_INTERVAL_MS,
    timeoutMs      = TIMEOUT_MS,
  } = deps;

  const log = flags.silent ? () => {} : (msg) => _stdout.write(msg + '\n');

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

  // ── Read PID file ─────────────────────────────────────────────────────────
  const pid = _readPidFile(dataDir);

  // Case 1: No PID file (or unparseable)
  if (pid === null) {
    _stdout.write('prism is not running\n');
    _exit(0);
    return;
  }

  // Case 2: Stale PID file — process already dead
  if (!_isPidAlive(pid)) {
    _stdout.write('prism is not running (stale PID file — cleaning up)\n');
    _removePidFile(dataDir);
    _exit(0);
    return;
  }

  // ── Process is alive ──────────────────────────────────────────────────────

  // Case 3: --force → SIGKILL (bypass graceful wait)
  if (flags.force) {
    try {
      _sendSignal(pid, 'SIGKILL');
      log(`Sent SIGKILL to pid ${pid}`);
    } catch (err) {
      if (err.code !== 'ESRCH') {
        _stderr.write(`Error sending SIGKILL to pid ${pid}: ${err.message}\n`);
        _exit(1);
        return;
      }
      // Process died just before we could kill it — still a success
    }
    _removePidFile(dataDir);
    log('prism stopped (forced).');
    _exit(0);
    return;
  }

  // Case 4: Normal graceful shutdown — SIGTERM + poll
  try {
    _sendSignal(pid, 'SIGTERM');
    log(`Sent SIGTERM to pid ${pid} — waiting for graceful shutdown (max 35s)...`);
  } catch (err) {
    if (err.code === 'ESRCH') {
      // Process died in the tiny window between isPidAlive() and kill()
      _stdout.write('prism is not running\n');
      _removePidFile(dataDir);
      _exit(0);
      return;
    }
    _stderr.write(`Error sending SIGTERM to pid ${pid}: ${err.message}\n`);
    _exit(1);
    return;
  }

  const clean = await _waitForExit(pid, timeoutMs, pollIntervalMs);

  if (clean) {
    _removePidFile(dataDir);
    log('prism stopped.');
    _exit(0);
  } else {
    _stderr.write(
      `Timeout: prism (pid ${pid}) did not stop within 35s.\n` +
      `Use 'prism stop --force' to kill it immediately.\n`
    );
    _exit(1);
  }
}

module.exports = {
  run,
  // Exported for unit testing
  readPidFile,
  isPidAlive,
  removePidFile,
  waitForExit,
};

// ---------------------------------------------------------------------------
// Direct invocation
// ---------------------------------------------------------------------------

if (require.main === module) {
  run({}).catch(err => {
    process.stderr.write(`[stop] FATAL: ${err.message}\n`);
    process.exit(1);
  });
}
