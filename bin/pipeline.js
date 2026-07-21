#!/usr/bin/env node
'use strict';

/**
 * bin/pipeline.js — `prism pipeline` verb dispatcher + list mode.
 *
 * Layout:
 *   prism pipeline                       → list N most-recent runs
 *   prism pipeline <runId>               → alias for `<runId> logs`
 *   prism pipeline <runId> <verb> ...    → dispatch to bin/pipeline-<verb>.js
 *
 * Verbs currently supported:
 *   - logs   → bin/pipeline-logs.js
 * (status, stop, resume land in follow-up ADRs.)
 */

const path = require('path');
const os   = require('os');

const { resolveDataDir } = require(path.join(__dirname, '..', 'src', 'utils', 'dataDir.js'));
const runResolver        = require(path.join(__dirname, '..', 'src', 'utils', 'runResolver.js'));

const PACKAGE_ROOT   = path.resolve(__dirname, '..');
const DEFAULT_LIMIT  = 10;
const MAX_LIMIT      = 100;

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable)
// ---------------------------------------------------------------------------

/**
 * Humanise a Date-diff into a compact "Xs/Xm/Xh/Xd ago" string.
 */
function formatAgo(then, now = new Date()) {
  const thenDate = then instanceof Date ? then : new Date(then);
  if (isNaN(thenDate.getTime())) return '';
  const seconds = Math.max(0, Math.floor((now.getTime() - thenDate.getTime()) / 1000));
  if (seconds < 60)         return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)         return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)           return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function padRight(str, width) {
  const s = String(str == null ? '' : str);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function truncate(str, max) {
  const s = String(str == null ? '' : str);
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

/**
 * Compose a single row for the list-mode table.
 */
function formatRunRow(run, titleLookup, now) {
  const shortId    = String(run.runId || '').slice(0, 8);
  const totalStages = Array.isArray(run.stages) ? run.stages.length : (run.stagesCount || 0);
  const currentIdx  = Number.isFinite(run.currentStage) ? run.currentStage : 0;
  const stagePos   = totalStages > 0
    ? `${Math.min(currentIdx + 1, totalStages)}/${totalStages}`
    : '–';
  const agentName  = (Array.isArray(run.stages) && run.stages[currentIdx]) || '';
  const stageCol   = `${stagePos}  ${agentName}`.trim();
  const title      = (titleLookup && titleLookup(run.taskId)) || '';

  return {
    runId:   padRight(shortId, 9),
    status:  padRight(run.status || 'unknown', 12),
    stage:   padRight(stageCol, 22),
    updated: padRight(formatAgo(run.updatedAt || run.createdAt, now), 12),
    title:   truncate(title, 40),
  };
}

/**
 * Build a title lookup: taskId → title. Uses the SQLite store when available,
 * falls back to an empty lookup on any error (title column will show blank).
 */
function buildTitleLookup(dataDir) {
  try {
    const { openStore } = require(path.join(__dirname, '..', 'src', 'services', 'store.js'));
    const store = openStore(dataDir);
    if (!store) return () => '';
    return (taskId) => {
      if (!taskId) return '';
      try {
        const t = typeof store.getTask === 'function' ? store.getTask(taskId) : null;
        return (t && t.title) || '';
      } catch { return ''; }
    };
  } catch {
    return () => '';
  }
}

// ---------------------------------------------------------------------------
// List mode
// ---------------------------------------------------------------------------

async function runListMode(flags, deps) {
  const {
    _stdout = process.stdout,
    _stderr = process.stderr,
    _exit   = (n) => process.exit(n),
    _now    = () => new Date(),
    _resolveDataDir = resolveDataDir,
    _listRuns       = runResolver.listRuns,
    _titleLookup    = null,
  } = deps;

  let limit = DEFAULT_LIMIT;
  if (flags.limit !== undefined) {
    const n = parseInt(flags.limit, 10);
    if (!Number.isFinite(n) || n <= 0) {
      _stderr.write(`Error: --limit must be a positive integer, got '${flags.limit}'\n`);
      _exit(2);
      return;
    }
    limit = Math.min(n, MAX_LIMIT);
  }

  const dataDir = flags.dataDir || _resolveDataDir({
    env: process.env, packageRoot: PACKAGE_ROOT, homedir: os.homedir(),
  }).path;

  const runs = await _listRuns({
    dataDir, serverUrl: flags.serverUrl, limit,
  });

  if (!runs || runs.length === 0) {
    _stderr.write('No runs yet.\n');
    _exit(0);
    return;
  }

  const titleLookup = _titleLookup || (flags.serverUrl ? () => '' : buildTitleLookup(dataDir));

  const header = {
    runId:   padRight('RUN ID', 9),
    status:  padRight('STATUS', 12),
    stage:   padRight('STAGE', 22),
    updated: padRight('UPDATED', 12),
    title:   'TITLE',
  };

  _stdout.write(`${header.runId}${header.status}${header.stage}${header.updated}${header.title}\n`);
  const now = _now();
  for (const run of runs) {
    const row = formatRunRow(run, titleLookup, now);
    _stdout.write(`${row.runId}${row.status}${row.stage}${row.updated}${row.title}\n`);
  }
  _exit(0);
}

// ---------------------------------------------------------------------------
// Verb dispatcher
// ---------------------------------------------------------------------------

const VERB_HANDLERS = {
  logs: (runId, flags, deps) =>
    require(path.join(__dirname, 'pipeline-logs.js')).run(runId, flags, deps),
};

/**
 * Entry point invoked from bin/cli.js.
 *
 * @param {object} flags
 * @param {string[]} positional  argv after "pipeline"
 * @param {object} [deps]
 */
async function run(flags = {}, positional = [], deps = {}) {
  const _stderr = deps._stderr || process.stderr;
  const _exit   = deps._exit   || ((n) => process.exit(n));

  // Case: no positional → list mode
  if (positional.length === 0) {
    await runListMode(flags, deps);
    return;
  }

  const runIdArg = positional[0];
  const verb     = positional[1] || 'logs'; // default verb

  if (!VERB_HANDLERS[verb]) {
    _stderr.write(`Error: unknown verb '${verb}' (valid: ${Object.keys(VERB_HANDLERS).join(', ')})\n`);
    _exit(2);
    return;
  }

  await VERB_HANDLERS[verb](runIdArg, flags, deps);
}

module.exports = {
  run,
  // exported for unit tests
  formatAgo,
  formatRunRow,
  padRight,
  truncate,
  runListMode,
  VERB_HANDLERS,
};

if (require.main === module) {
  const argv = process.argv.slice(3); // strip node + cli.js + 'pipeline'
  run({}, argv).catch(err => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(err.exitCode || 1);
  });
}
