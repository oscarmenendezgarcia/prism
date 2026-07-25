'use strict';

/**
 * runResolver.js — Prefix-match runId → full run, with FS-first / HTTP-fallback source.
 *
 * Consumers:
 *   - bin/run.js         (list mode)
 *   - bin/run-logs.js    (print + follow)
 *
 * Design notes:
 *   - FS-first: reads data/runs/runs.json + data/runs/<runId>/run.json directly, so the
 *     CLI works when the server is stopped (post-mortem inspection).
 *   - HTTP fallback: passed --server-url or FS unreadable → GET /api/v1/runs and
 *     GET /api/v1/runs/:runId. Uses global fetch (Node 20+); DI seam via deps._fetch.
 *   - Typed errors so the CLI can format nicely and pick exit codes.
 */

const fs   = require('fs');
const path = require('path');

const MIN_PREFIX_LEN = 8;

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

class RunNotFoundError extends Error {
  constructor(prefix) {
    super(`run '${prefix}' not found`);
    this.name   = 'RunNotFoundError';
    this.prefix = prefix;
    this.exitCode = 1;
  }
}

class AmbiguousRunError extends Error {
  constructor(prefix, candidates) {
    const list = candidates.map(r => r.runId.slice(0, 12)).join(', ');
    super(`ambiguous runId '${prefix}' — candidates: ${list}`);
    this.name       = 'AmbiguousRunError';
    this.prefix     = prefix;
    this.candidates = candidates;
    this.exitCode   = 2;
  }
}

class StageNotAvailableError extends Error {
  constructor(msg) {
    super(msg);
    this.name     = 'StageNotAvailableError';
    this.exitCode = 1;
  }
}

class ShortPrefixError extends Error {
  constructor(prefix) {
    super(`runId prefix must be at least ${MIN_PREFIX_LEN} characters (got '${prefix}')`);
    this.name     = 'ShortPrefixError';
    this.exitCode = 2;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readJSONSafe(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

/**
 * Best-effort load of the SQLite store. Returns null when the DB/deps are
 * missing — we still have the registry JSON as a fallback and the caller can
 * proceed.
 */
function tryLoadStore(dataDir) {
  try {
    const { openStore } = require(path.join(__dirname, '..', 'services', 'store.js'));
    return openStore(dataDir);
  } catch {
    return null;
  }
}

/**
 * Shared fetch wrapper for the two shapes runResolver needs: a parsed JSON
 * body (`as: 'json'`, 404 → null) or raw text (`as: 'text'`, 404 → throws a
 * typed 404 error so callers can map it to StageNotAvailableError).
 */
async function httpFetch(url, _fetch, { as }) {
  const fetchFn = _fetch || (typeof fetch === 'function' ? fetch : null);
  if (!fetchFn) {
    throw new Error('global fetch is unavailable (Node < 18) and no _fetch was injected');
  }
  const res = await fetchFn(url);
  if (!res.ok) {
    if (res.status === 404) {
      if (as === 'json') return null;
      const err = new Error(`HTTP 404 for ${url}`);
      err.status = 404;
      throw err;
    }
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return as === 'json' ? res.json() : res.text();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List run summaries, newest first.
 *
 * @param {object} opts
 * @param {string} opts.dataDir
 * @param {string} [opts.serverUrl]
 * @param {number} [opts.limit]
 * @param {Function} [opts._fetch]
 * @param {Function} [opts._openStore]
 * @returns {Promise<Array<{runId,spaceId,taskId,status,createdAt,updatedAt}>>}
 */
async function listRuns(opts = {}) {
  const { dataDir, serverUrl, limit, _fetch, _openStore } = opts;

  let summaries = [];

  if (serverUrl) {
    const base = serverUrl.replace(/\/+$/, '');
    const json = await httpFetch(`${base}/api/v1/runs`, _fetch, { as: 'json' });
    summaries = Array.isArray(json) ? json : [];
  } else {
    // Prefer SQLite store when available
    const store = (_openStore ? _openStore(dataDir) : tryLoadStore(dataDir));
    if (store && typeof store.listRuns === 'function') {
      try {
        const rows = store.listRuns(limit ? { limit, offset: 0 } : {});
        summaries = Array.isArray(rows) ? rows : [];
      } catch {
        summaries = [];
      } finally {
        try { if (typeof store.close === 'function') store.close(); } catch { /* ignore */ }
      }
    }
    if (summaries.length === 0) {
      // Filesystem registry fallback
      const registryPath = path.join(dataDir, 'runs', 'runs.json');
      summaries = readJSONSafe(registryPath, []) || [];
    }
  }

  // Sort by updatedAt desc (fallback to createdAt)
  summaries.sort((a, b) => {
    const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  });

  return typeof limit === 'number' && limit > 0 ? summaries.slice(0, limit) : summaries;
}

/**
 * Resolve a runId prefix to a full run object.
 *
 * @param {string} prefix
 * @param {object} opts
 * @param {string} opts.dataDir
 * @param {string} [opts.serverUrl]
 * @param {Function} [opts._fetch]
 * @param {Function} [opts._openStore]
 * @returns {Promise<{ run: object, source: 'fs'|'store'|'http' }>}
 */
async function resolveRun(prefix, opts = {}) {
  if (typeof prefix !== 'string' || prefix.length < MIN_PREFIX_LEN) {
    throw new ShortPrefixError(String(prefix));
  }

  const summaries = await listRuns(opts);
  const matches   = summaries.filter(r => r.runId && r.runId.startsWith(prefix));

  if (matches.length === 0) throw new RunNotFoundError(prefix);
  if (matches.length > 1)   throw new AmbiguousRunError(prefix, matches);

  const runId = matches[0].runId;

  if (opts.serverUrl) {
    const base = opts.serverUrl.replace(/\/+$/, '');
    const run  = await httpFetch(`${base}/api/v1/runs/${runId}`, opts._fetch, { as: 'json' });
    if (!run) throw new RunNotFoundError(prefix);
    return { run, source: 'http' };
  }

  // Prefer store
  const store = (opts._openStore ? opts._openStore(opts.dataDir) : tryLoadStore(opts.dataDir));
  if (store && typeof store.getRun === 'function') {
    try {
      const run = store.getRun(runId);
      if (run) return { run, source: 'store' };
    } finally {
      try { if (typeof store.close === 'function') store.close(); } catch { /* ignore */ }
    }
  }

  const runJsonPath = path.join(opts.dataDir, 'runs', runId, 'run.json');
  const run = readJSONSafe(runJsonPath, null);
  if (!run) throw new RunNotFoundError(prefix);
  return { run, source: 'fs' };
}

/**
 * Locate a stage log. In FS mode returns the local path; in HTTP mode
 * returns the log content (already fetched).
 *
 * @param {string} runId
 * @param {number} stageIndex
 * @param {object} opts
 * @returns {Promise<{ path?: string, content?: string, fromHttp: boolean }>}
 */
async function readStageLog(runId, stageIndex, opts = {}) {
  if (opts.serverUrl) {
    const base = opts.serverUrl.replace(/\/+$/, '');
    const url  = `${base}/api/v1/runs/${runId}/stages/${stageIndex}/log`;
    try {
      const content = await httpFetch(url, opts._fetch, { as: 'text' });
      return { content, fromHttp: true };
    } catch (err) {
      if (err.status === 404) {
        throw new StageNotAvailableError(`log for stage ${stageIndex} of run '${runId}' is not available`);
      }
      throw err;
    }
  }

  const logPath = path.join(opts.dataDir, 'runs', runId, `stage-${stageIndex}.log`);
  return { path: logPath, fromHttp: false };
}

module.exports = {
  listRuns,
  resolveRun,
  readStageLog,
  RunNotFoundError,
  AmbiguousRunError,
  StageNotAvailableError,
  ShortPrefixError,
  MIN_PREFIX_LEN,
};
