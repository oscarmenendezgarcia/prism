/**
 * folioRunSurface — surface a one-off Folio agent (bootstrap or consolidation)
 * as a single-stage run so it shows up in the UI like any pipeline run.
 *
 * A Folio side-agent is not a pipeline stage, so without this it runs invisibly.
 * Surfacing it means writing the same two artifacts a pipeline stage writes:
 *
 *   - agent-runs.jsonl  → the Runs panel LIST (one row per run), and
 *   - a single-stage run in the store + stage-0.log/meta → the log VIEWER
 *     (getRun finds it; the `kind` marker keeps it out of the pipeline run lists).
 *
 * Both the bootstrap (activation-triggered) and the consolidation (pipeline
 * epilogue) reuse this so the surfacing logic lives in exactly one place.
 *
 * Every write is best-effort: a failure here logs a warning and never blocks the
 * agent it is describing.
 */

const fs   = require('fs');
const path = require('path');
const { readAgentRuns, writeAgentRuns } = require('../handlers/agentRuns');

/**
 * Build the single-stage run object persisted to the store so the agent is
 * viewable through the normal run log viewer (getRun → stage-0.log). The `kind`
 * (e.g. 'bootstrap' | 'consolidation') keeps it out of the pipeline run lists.
 *
 * @param {{ runId: string, spaceId: string, kind: string, taskTitle: string,
 *   agentId: string, status: string, stageStatus: object, startedAt: string }} args
 */
function buildFolioRun({ runId, spaceId, kind, taskTitle, agentId, status, stageStatus, startedAt }) {
  return {
    runId,
    spaceId,
    taskId:        `__${kind}__`,   // store column is NOT NULL; no FK to tasks
    kind,
    taskTitle,
    stages:        [agentId],
    stageStatuses: [stageStatus],
    currentStage:  0,
    status,
    createdAt:     startedAt,
    updatedAt:     new Date().toISOString(),
  };
}

/**
 * Open a single-stage Folio run: create the run dir + stage-0.meta.json, persist
 * a 'running' store run, and append a 'running' agent-runs.jsonl row. Returns the
 * agent-runs entry id (needed by closeFolioRun). Each step is independent and
 * best-effort.
 *
 * @param {{ dataDir: string, runId: string, spaceId: string, spaceName?: string,
 *   kind: string, agentId: string, agentDisplayName: string, taskTitle: string,
 *   phase: string, startedAt: string,
 *   runStore?: { upsert: (run) => void, remove: (runId) => void } }} args
 * @returns {string} entryId
 */
function openFolioRun({ dataDir, runId, spaceId, spaceName, kind, agentId, agentDisplayName, taskTitle, phase, startedAt, runStore }) {
  const entryId = `${runId}-${kind}`;
  const dir     = path.join(dataDir, 'runs', runId);

  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* best-effort */ }

  // stage-0.meta.json so the events parser reads the claude-code stream format.
  try {
    fs.writeFileSync(
      path.join(dir, 'stage-0.meta.json'),
      JSON.stringify({ source: 'claude-code', schemaVersion: 1, agentId, startedAt }),
      'utf8',
    );
  } catch (_) { /* parser falls back to first-line sniffing */ }

  // Store run (running) → the log viewer finds it via getRun.
  if (runStore) {
    try {
      runStore.upsert(buildFolioRun({
        runId, spaceId, kind, taskTitle, agentId, status: 'running',
        stageStatus: { status: 'running', startedAt, finishedAt: null, exitCode: null, pid: null },
        startedAt,
      }));
    } catch (err) {
      console.warn(`[folio.run] WARN: could not persist ${kind} run:`, err.message);
    }
  }

  // Runs-history entry (the panel reads agent-runs.jsonl).
  try {
    const entry = {
      id:               entryId,
      pipelineRunId:    runId,
      stageIndex:       0,
      taskId:           null,
      taskTitle,
      agentId,
      agentDisplayName,
      spaceId,
      spaceName:        spaceName || '',
      phase,
      status:           'running',
      startedAt,
      completedAt:      null,
      durationMs:       null,
    };
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(path.join(dataDir, 'agent-runs.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.warn(`[folio.run] WARN: could not write ${kind} run entry:`, err.message);
  }

  return entryId;
}

/**
 * Close a single-stage Folio run: finalise BOTH the store run and the
 * agent-runs.jsonl row to completed/failed — or remove both when `drop` is set
 * (a no-op the user shouldn't see, e.g. a skipped bootstrap).
 *
 * @param {{ dataDir: string, runId: string, entryId: string, spaceId: string,
 *   kind: string, taskTitle: string, agentId: string, startedAt: string,
 *   ok?: boolean, drop?: boolean, extra?: object,
 *   runStore?: { upsert: (run) => void, remove: (runId) => void } }} args
 */
function closeFolioRun({ dataDir, runId, entryId, spaceId, kind, taskTitle, agentId, startedAt, ok, drop, extra, runStore }) {
  const finishedAt = new Date().toISOString();

  // Store run (log viewer).
  if (runStore) {
    try {
      if (drop) {
        runStore.remove(runId);
      } else {
        runStore.upsert(buildFolioRun({
          runId, spaceId, kind, taskTitle, agentId, status: ok ? 'completed' : 'failed',
          stageStatus: { status: ok ? 'completed' : 'failed', startedAt, finishedAt, exitCode: ok ? 0 : 1, pid: null },
          startedAt,
        }));
      }
    } catch (err) {
      console.warn(`[folio.run] WARN: could not finalise ${kind} run:`, err.message);
    }
  }

  // agent-runs.jsonl row (Runs panel list).
  try {
    const records = readAgentRuns(dataDir);
    const idx = records.findIndex((r) => r.id === entryId);
    if (idx !== -1) {
      if (drop) {
        records.splice(idx, 1);
      } else {
        records[idx] = {
          ...records[idx],
          status:      ok ? 'completed' : 'failed',
          completedAt: finishedAt,
          durationMs:  Date.parse(finishedAt) - Date.parse(startedAt),
          ...(extra || {}),   // callers may override durationMs / add pagesWritten
        };
      }
      writeAgentRuns(dataDir, records);
    }
  } catch (err) {
    console.warn(`[folio.run] WARN: could not finalise ${kind} run entry:`, err.message);
  }
}

module.exports = { buildFolioRun, openFolioRun, closeFolioRun };
