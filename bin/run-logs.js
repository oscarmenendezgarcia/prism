#!/usr/bin/env node
'use strict';

/**
 * bin/run-logs.js — `prism run <runId> logs [-f]`
 *
 * Print or follow the stage-log stream for one pipeline run.
 *
 * Two modes:
 *   - Print mode (default): concatenate all stage logs with headers.
 *   - Follow mode (-f):     print the current stage from its current offset,
 *                           poll run.json + the active stage log for growth,
 *                           switch on stage change, exit on terminal status.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { resolveDataDir } = require(path.join(__dirname, '..', 'src', 'utils', 'dataDir.js'));
const runResolver        = require(path.join(__dirname, '..', 'src', 'utils', 'runResolver.js'));

const PACKAGE_ROOT      = path.resolve(__dirname, '..');
const DEFAULT_POLL_MS   = 500;
const POLL_MIN          = 50;
const POLL_MAX          = 10_000;
const TERMINAL_GRACE_MS = 250;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'interrupted', 'cancelled']);

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable)
// ---------------------------------------------------------------------------

function isTty(stream) {
  return Boolean(stream && stream.isTTY);
}

function ansi(open, close, str, enabled) {
  return enabled ? `\x1b[${open}m${str}\x1b[${close}m` : str;
}

function stageHeader(stageIndex, totalStages, agentName, status, opts = {}) {
  const color = isTty(opts.stream);
  const label = `Stage ${stageIndex + 1} / ${totalStages} · ${agentName || '?'} · ${status || 'unknown'}`;
  return `${ansi(36, 39, '━━━ ', color)}${ansi(1, 22, label, color)}${ansi(36, 39, ' ━━━', color)}\n`;
}

function stageFooter(stageIndex, totalStages, agentName, status, opts = {}) {
  const color = isTty(opts.stream);
  const label = `Stage ${stageIndex + 1} / ${totalStages} · ${agentName || '?'} · ${status || 'ended'}`;
  return `${ansi(36, 39, '━━━ ', color)}${ansi(2, 22, label, color)}${ansi(36, 39, ' ━━━', color)}\n`;
}

function normaliseStages(run) {
  const stages = Array.isArray(run.stages) ? run.stages : [];
  const statuses = Array.isArray(run.stageStatuses) ? run.stageStatuses : [];
  return { stages, statuses };
}

function statusFor(run, i) {
  const s = Array.isArray(run.stageStatuses) ? run.stageStatuses[i] : null;
  return s && s.status ? s.status : 'pending';
}

// ---------------------------------------------------------------------------
// Print mode
// ---------------------------------------------------------------------------

async function runPrintMode(runId, flags, deps) {
  const {
    _stdout = process.stdout,
    _stderr = process.stderr,
    _exit   = (n) => process.exit(n),
    _resolveRun    = runResolver.resolveRun,
    _readStageLog  = runResolver.readStageLog,
    _resolveDataDir = resolveDataDir,
    _readFile      = (p) => fs.promises.readFile(p, 'utf8'),
  } = deps;

  const dataDir = flags.dataDir || _resolveDataDir({
    env: process.env, packageRoot: PACKAGE_ROOT, homedir: os.homedir(),
  }).path;

  const { run } = await _resolveRun(runId, {
    dataDir, serverUrl: flags.serverUrl,
  });

  const { stages } = normaliseStages(run);
  const totalStages = stages.length;

  let indices = stages.map((_, i) => i);
  if (flags.stage !== undefined) {
    const n = parseInt(flags.stage, 10);
    if (!Number.isFinite(n) || n < 0 || n >= totalStages) {
      _stderr.write(`Error: stage ${flags.stage} out of range (0..${Math.max(0, totalStages - 1)})\n`);
      _exit(1);
      return;
    }
    indices = [n];
  }

  for (const i of indices) {
    _stdout.write(stageHeader(i, totalStages, stages[i], statusFor(run, i), { stream: _stdout }));
    const loc = await _readStageLog(run.runId, i, { dataDir, serverUrl: flags.serverUrl });
    if (loc.fromHttp) {
      _stdout.write(loc.content || '');
    } else {
      try {
        const content = await _readFile(loc.path);
        _stdout.write(content);
      } catch (err) {
        if (err.code === 'ENOENT') {
          _stdout.write('(no log yet)\n');
        } else {
          throw err;
        }
      }
    }
    _stdout.write('\n');
  }
  _exit(0);
}

// ---------------------------------------------------------------------------
// Follow mode
// ---------------------------------------------------------------------------

async function runFollowMode(runId, flags, deps) {
  const {
    _stdout = process.stdout,
    _stderr = process.stderr,
    _exit   = (n) => process.exit(n),
    _resolveRun     = runResolver.resolveRun,
    _resolveDataDir = resolveDataDir,
    _readFile       = fs.promises.readFile,
    _stat           = fs.promises.stat,
    _setInterval    = (fn, ms) => setInterval(fn, ms),
    _clearInterval  = (h) => clearInterval(h),
    _onSigint       = (fn) => { process.on('SIGINT', fn); return () => process.off('SIGINT', fn); },
  } = deps;

  // Poll interval bounds
  let pollMs = DEFAULT_POLL_MS;
  if (flags.pollMs !== undefined) {
    const n = parseInt(flags.pollMs, 10);
    if (!Number.isFinite(n) || n < POLL_MIN || n > POLL_MAX) {
      _stderr.write(`Error: --poll-ms must be between ${POLL_MIN} and ${POLL_MAX}, got '${flags.pollMs}'\n`);
      _exit(2);
      return;
    }
    pollMs = n;
  }

  const dataDir = flags.dataDir || _resolveDataDir({
    env: process.env, packageRoot: PACKAGE_ROOT, homedir: os.homedir(),
  }).path;

  const initial = await _resolveRun(runId, { dataDir, serverUrl: flags.serverUrl });
  const fullRunId = initial.run.runId;

  const runJsonPath = path.join(dataDir, 'runs', fullRunId, 'run.json');

  // State
  let currentRun    = initial.run;
  let currentStage  = Number.isFinite(currentRun.currentStage) ? currentRun.currentStage : 0;
  let currentOffset = 0;
  const totalStages = Array.isArray(currentRun.stages) ? currentRun.stages.length : 0;

  async function safeStat(p) {
    try { return await _stat(p); }
    catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  }

  function stagePath(idx) {
    return path.join(dataDir, 'runs', fullRunId, `stage-${idx}.log`);
  }

  async function readFromOffset(idx, start) {
    try {
      const content = await _readFile(stagePath(idx), 'utf8');
      return content.slice(start);
    } catch (err) {
      if (err.code === 'ENOENT') return '';
      throw err;
    }
  }

  async function catchUpDelta(idx) {
    const st = await safeStat(stagePath(idx));
    if (!st) return;
    if (st.size <= currentOffset) return;
    const chunk = await readFromOffset(idx, currentOffset);
    currentOffset = st.size;
    if (chunk) _stdout.write(chunk);
  }

  // Initial header + full current-stage content
  const stages = Array.isArray(currentRun.stages) ? currentRun.stages : [];
  _stdout.write(stageHeader(currentStage, totalStages, stages[currentStage], statusFor(currentRun, currentStage), { stream: _stdout }));
  await catchUpDelta(currentStage);

  return new Promise((resolve) => {
    let interval = null;
    let stopped  = false;
    let removeSigint = () => {};

    function done(code) {
      if (stopped) return;
      stopped = true;
      if (interval) _clearInterval(interval);
      try { removeSigint(); } catch { /* ignore */ }
      _exit(code);
      resolve();
    }

    removeSigint = _onSigint(() => done(130));

    async function tick() {
      if (stopped) return;
      try {
        // 1. Catch up the current stage's log growth
        await catchUpDelta(currentStage);

        // 2. Re-read run.json (or HTTP) for status / stage transitions
        let freshRun = null;
        if (flags.serverUrl) {
          try {
            const r = await _resolveRun(fullRunId.slice(0, 12), { dataDir, serverUrl: flags.serverUrl });
            freshRun = r.run;
          } catch { /* keep old */ }
        } else {
          try {
            const raw = await _readFile(runJsonPath, 'utf8');
            freshRun = JSON.parse(raw);
          } catch { /* keep old */ }
        }
        if (freshRun) currentRun = freshRun;

        const newStage = Number.isFinite(currentRun.currentStage) ? currentRun.currentStage : currentStage;
        while (newStage > currentStage) {
          // Flush the last of the previous stage first (best-effort)
          await catchUpDelta(currentStage);
          _stdout.write(stageFooter(currentStage, totalStages, stages[currentStage], statusFor(currentRun, currentStage), { stream: _stdout }));
          currentStage += 1;
          currentOffset = 0;
          if (currentStage < totalStages) {
            _stdout.write(stageHeader(currentStage, totalStages, stages[currentStage], statusFor(currentRun, currentStage), { stream: _stdout }));
          }
        }

        // 3. Terminal-status handling
        if (TERMINAL_STATUSES.has(currentRun.status)) {
          // Grace period + final flush + terminal footer
          if (interval) _clearInterval(interval);
          interval = null;
          setTimeout(async () => {
            if (stopped) return;
            try { await catchUpDelta(currentStage); } catch { /* ignore */ }
            _stdout.write(stageFooter(currentStage, totalStages, stages[currentStage], currentRun.status, { stream: _stdout }));
            done(0);
          }, TERMINAL_GRACE_MS).unref();
        }
      } catch (err) {
        _stderr.write(`[cli] follow error: ${err.message}\n`);
        done(1);
      }
    }

    interval = _setInterval(tick, pollMs);
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function run(runId, flags = {}, deps = {}) {
  if (!runId) {
    (deps._stderr || process.stderr).write('Error: runId is required\n');
    (deps._exit || ((n) => process.exit(n)))(2);
    return;
  }

  if (flags.follow) {
    return runFollowMode(runId, flags, deps);
  }
  return runPrintMode(runId, flags, deps);
}

module.exports = {
  run,
  // exports for tests
  runPrintMode,
  runFollowMode,
  stageHeader,
  stageFooter,
  normaliseStages,
  statusFor,
  DEFAULT_POLL_MS,
  POLL_MIN,
  POLL_MAX,
  TERMINAL_STATUSES,
};

if (require.main === module) {
  const [runId, ...rest] = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-f' || a === '--follow') flags.follow = true;
    else if (a === '--stage') flags.stage = rest[++i];
    else if (a === '--poll-ms') flags.pollMs = rest[++i];
    else if (a === '--server-url') flags.serverUrl = rest[++i];
    else if (a === '--data-dir') flags.dataDir = rest[++i];
  }
  run(runId, flags).catch(err => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(err.exitCode || 1);
  });
}
