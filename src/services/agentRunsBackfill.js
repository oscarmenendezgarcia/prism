'use strict';

/**
 * Startup backfill for orphaned "running" entries in data/agent-runs.jsonl.
 *
 * Historical bug: bridgeUpdateRunFinished used findIndex(), which after a
 * resume closed the OLD (already-cancelled) duplicate record and left the new
 * "running" record permanently un-closed. The frontend RunsPanel reads
 * run.status directly from this file, so those rows stayed visible as ACTIVE
 * forever. See ADR-1 (runs-zombie-active-fix).
 *
 * The bridge writer is now fixed. This module cleans up jsonl files that were
 * written before the fix: any 'running' entry whose parent pipeline run is
 * already in a terminal state ({completed, failed, interrupted, cancelled})
 * is flipped to 'cancelled' with a completedAt timestamp.
 *
 * Semantics:
 *   - Records whose parent run is still 'running' / 'paused' / 'blocked' are
 *     left untouched — they may legitimately still be running.
 *   - Records with no matching parent run are left untouched (defensive: the
 *     parent may have been pruned or belong to a foreign dataset).
 *   - Idempotent: a second invocation on the same file makes zero writes.
 *   - Non-fatal: any read/write error is caught, logged, and the function
 *     returns { changed: 0, error: <msg> } so server startup is not blocked.
 */

const { readAgentRuns, writeAgentRuns } = require('../handlers/agentRuns');

const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'interrupted', 'cancelled']);

/**
 * Emit a structured log line. Kept private so tests can spy via console.log.
 * @param {object} payload
 */
function log(payload) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level:     'info',
    component: 'agent-runs-backfill',
    ...payload,
  }));
}

/**
 * Build a Map<runId, run> from whatever run source is available.
 *  - store.listRuns() when a SQLite store is injected (production).
 *  - readRegistry(dataDir) fallback via callback for tests without a store.
 *
 * @param {object|null} store
 * @param {(dataDir: string) => object[]} [readRegistryFn]
 * @param {string} dataDir
 * @returns {Map<string, object>}
 */
function buildRunsIndex(store, readRegistryFn, dataDir) {
  const list = store
    ? store.listRuns()
    : (readRegistryFn ? readRegistryFn(dataDir) : []);
  const index = new Map();
  for (const run of list || []) {
    if (run && run.runId) index.set(run.runId, run);
  }
  return index;
}

/**
 * Run the backfill.
 *
 * @param {object}   opts
 * @param {string}   opts.dataDir
 * @param {object|null} [opts.store]        - SQLite store (production).
 * @param {Function} [opts.readRegistryFn]  - Fallback used only when store is absent.
 * @param {Function} [opts.now]             - Injectable clock for tests.
 * @returns {{ changed: number, scanned: number, error?: string }}
 */
function runBackfill({ dataDir, store = null, readRegistryFn = null, now = () => new Date().toISOString() }) {
  try {
    const records = readAgentRuns(dataDir);
    if (records.length === 0) {
      return { changed: 0, scanned: 0 };
    }

    const runsIndex = buildRunsIndex(store, readRegistryFn, dataDir);
    const nowIso    = now();

    let changed = 0;
    const cleaned = records.map((rec) => {
      if (rec.status !== 'running') return rec;
      // pipelineRunId is written by bridgeWriteRunStarted; older records may
      // omit it, in which case we cannot know the parent status → skip.
      const parentId = rec.pipelineRunId;
      if (!parentId) return rec;
      const parent = runsIndex.get(parentId);
      if (!parent) return rec;                          // parent missing → leave alone
      if (!TERMINAL_RUN_STATUSES.has(parent.status)) return rec;

      changed += 1;
      return {
        ...rec,
        status:      'cancelled',
        completedAt: rec.completedAt || parent.finishedAt || nowIso,
      };
    });

    if (changed > 0) {
      writeAgentRuns(dataDir, cleaned);
    }

    log({ event: 'agent_runs.backfill_cancelled', changed, scanned: records.length });
    return { changed, scanned: records.length };
  } catch (err) {
    console.warn(`[agent-runs-backfill] WARN: backfill failed (non-fatal): ${err.message}`);
    return { changed: 0, scanned: 0, error: err.message };
  }
}

module.exports = {
  runBackfill,
  TERMINAL_RUN_STATUSES,
};
