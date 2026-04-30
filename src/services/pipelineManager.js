/**
 * Prism — Pipeline Manager
 *
 * ADR-1 (mcp-start-pipeline) §pipelineManager:
 * Manages the lifecycle of pipeline runs: creation, stage execution,
 * completion, failure, timeout, and cancellation.
 *
 * Run state is persisted to data/runs/<runId>/run.json with atomic
 * writes (.tmp + rename). Per-stage output is streamed to stage-N.log.
 *
 * The run registry (data/runs/runs.json) holds a summary list for fast
 * listing without reading individual run directories.
 *
 * Environment variables:
 *   PIPELINE_STAGE_TIMEOUT_MS    - Kill timeout per stage (default: 3600000 = 1h)
 *   PIPELINE_STALL_TIMEOUT_MS    - Kill if no output for this long (default: 300000 = 5min)
 *   PIPELINE_MAX_CONCURRENT      - Max active runs (default: 5)
 *   PIPELINE_RUNS_DIR            - Override runs directory
 *   PIPELINE_AGENT_MODE          - 'subagent' (default) or 'headless'
 *   PIPELINE_AGENTS_DIR          - Override agents directory
 *   PIPELINE_RESOLVER_TIMEOUT_MS - Kill timeout for resolver agents (default: 300000 = 5min)
 */

'use strict';

const fs                        = require('fs');
const path                      = require('path');
const crypto                    = require('crypto');
const { spawn, execSync }       = require('child_process');

const { resolveAgent, AgentNotFoundError } = require('./agentResolver');
const { readAgentRuns, writeAgentRuns } = require('../handlers/agentRuns');
const worktreeManager = require('./worktreeManager');
const { buildCommentGuidanceLines } = require('../utils/promptComments');
const {
  buildKanbanBlock,
  buildGitContextBlock,
  buildCompileGateBlock,
} = require('../utils/promptBuilder');

// Resolve the claude binary path once at startup so caffeinate (and sh) can
// find it even when the server was launched from a shell with a different PATH.
// Falls back through common install locations if `which` fails.
let CLAUDE_BIN = 'claude';
{
  const home = process.env.HOME ?? '';
  const candidates = [
    // PATH lookup first (covers most cases)
    () => execSync('which claude 2>/dev/null', { encoding: 'utf8', env: process.env }).trim(),
    // Common install locations as fallback
    () => `${home}/.local/bin/claude`,
    () => '/usr/local/bin/claude',
    () => '/opt/homebrew/bin/claude',
  ];
  for (const candidate of candidates) {
    try {
      const p = candidate();
      if (p && fs.existsSync(p)) { CLAUDE_BIN = p; break; }
    } catch { /* try next */ }
  }
}

/**
 * Read a task from the kanban column files by ID.
 * Searches todo, in-progress, and done columns.
 * Returns null if not found.
 *
 * @param {string} baseDataDir - Base data directory (parent of spaceId dirs)
 * @param {string} spaceId
 * @param {string} taskId
 * @returns {object|null}
 */
function readTaskFromSpace(baseDataDir, spaceId, taskId) {
  const spaceDir = path.join(baseDataDir, spaceId);
  for (const col of ['todo', 'in-progress', 'done']) {
    try {
      const tasks = JSON.parse(fs.readFileSync(path.join(spaceDir, `${col}.json`), 'utf8'));
      const task  = tasks.find((t) => t.id === taskId);
      if (task) return task;
    } catch {
      // Column file missing or unreadable — skip.
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Constants and configuration
// ---------------------------------------------------------------------------

const DEFAULT_STAGES = [
  'senior-architect',
  'ux-api-designer',
  'developer-agent',
  'code-reviewer',
  'qa-engineer-e2e',
];

const DEFAULT_STAGE_TIMEOUT_MS    = 3_600_000; // 1 hour
const DEFAULT_MAX_CONCURRENT      = 5;
// Stall watchdog: kill if no output for this long.  5 min is conservative —
// tool calls (Bash builds, WebSearch) can be silent for a while, but AskUserQuestion
// and permission prompts produce no output forever, so we still need a ceiling.
const DEFAULT_STALL_TIMEOUT_MS    = 300_000;   // 5 min without any output → kill
// Resolver agent gets a shorter timeout: it only needs to answer one question.
const DEFAULT_RESOLVER_TIMEOUT_MS = 300_000;   // 5 min

// ---------------------------------------------------------------------------
// Module-level state (in-process registry of active child processes)
// ---------------------------------------------------------------------------

/** Map<runId, { interval: ReturnType<setInterval>, stageIndex: number }> */
const activeProcesses = new Map();

/** Store instance injected via init(). Used to look up tasks in SQLite. */
let _store = null;

/** Timestamp when this Node.js process was started (used as a PID stale guard). */
const BOOT_TIME = Date.now();

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the runs directory from environment or dataDir.
 *
 * @param {string} dataDir - Root data directory.
 * @returns {string}
 */
function runsDir(dataDir) {
  return process.env.PIPELINE_RUNS_DIR || path.join(dataDir, 'runs');
}

/**
 * Path to the global runs.json registry.
 *
 * @param {string} dataDir
 * @returns {string}
 */
function runsRegistryPath(dataDir) {
  return path.join(runsDir(dataDir), 'runs.json');
}

/**
 * Path to the run-specific directory.
 *
 * @param {string} dataDir
 * @param {string} runId
 * @returns {string}
 */
function runDir(dataDir, runId) {
  return path.join(runsDir(dataDir), runId);
}

/**
 * Path to run.json inside the run directory.
 *
 * @param {string} dataDir
 * @param {string} runId
 * @returns {string}
 */
function runJsonPath(dataDir, runId) {
  return path.join(runDir(dataDir, runId), 'run.json');
}

/**
 * Path to stage log file.
 *
 * @param {string} dataDir
 * @param {string} runId
 * @param {number} stageIndex
 * @returns {string}
 */
function stageLogPath(dataDir, runId, stageIndex) {
  return path.join(runDir(dataDir, runId), `stage-${stageIndex}.log`);
}

/**
 * Path to stage prompt file.
 *
 * @param {string} dataDir
 * @param {string} runId
 * @param {number} stageIndex
 * @returns {string}
 */
function stagePromptPath(dataDir, runId, stageIndex) {
  return path.join(runDir(dataDir, runId), `stage-${stageIndex}-prompt.md`);
}

/**
 * Path to the done-sentinel file written by the shell wrapper when the stage exits.
 *
 * @param {string} dataDir
 * @param {string} runId
 * @param {number} stageIndex
 * @returns {string}
 */
function stageDonePath(dataDir, runId, stageIndex) {
  return path.join(runDir(dataDir, runId), `stage-${stageIndex}.done`);
}

/**
 * Path to the done-sentinel file for a resolver agent process.
 * Named after the commentId so multiple resolvers per run are distinguishable.
 *
 * @param {string} dataDir
 * @param {string} runId
 * @param {string} commentId
 * @returns {string}
 */
function resolverDonePath(dataDir, runId, commentId) {
  return path.join(runDir(dataDir, runId), `resolver-${commentId}.done`);
}

/**
 * POSIX single-quote escaping for shell arguments.
 * Wraps s in single quotes and escapes embedded single quotes as '\''
 *
 * @param {string} s
 * @returns {string}
 */
function shellEscape(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// ---------------------------------------------------------------------------
// Loop injection helpers
// ---------------------------------------------------------------------------

const DEFAULT_MAX_LOOPS = 5;

/**
 * Path to the inject-signal file written by an agent to request stage injection.
 *
 * An agent writes this file (JSON array of agent IDs) before exiting to ask the
 * pipeline to insert those stages immediately after the current one.  The manager
 * reads it after detecting the done-sentinel and injects accordingly.
 *
 * Example content:  ["developer-agent", "code-reviewer"]
 *
 * @param {string} dataDir
 * @param {string} runId
 * @param {number} stageIndex
 * @returns {string}
 */
function stageInjectPath(dataDir, runId, stageIndex) {
  return path.join(runDir(dataDir, runId), `stage-${stageIndex}.inject`);
}

/**
 * Read the inject-signal file for a completed stage.
 * Returns the array of agent IDs to inject, or [] if the file is absent/invalid.
 *
 * @param {string} dataDir
 * @param {string} runId
 * @param {number} stageIndex
 * @param {string} agentId     - The agent that just completed (used for loop-cap tracking).
 * @param {object} run         - Current run state (read-only here).
 * @returns {string[]}
 */
function readInjectSignal(dataDir, runId, stageIndex, agentId, run) {
  const injectFile = stageInjectPath(dataDir, runId, stageIndex);
  if (!fs.existsSync(injectFile)) return [];

  let stages;
  try {
    stages = JSON.parse(fs.readFileSync(injectFile, 'utf8'));
  } catch {
    pipelineLog('run.inject_parse_error', { runId, stageIndex, agentId });
    return [];
  }

  if (!Array.isArray(stages) || stages.length === 0) return [];

  // Enforce loop cap: count how many times this agent has already triggered a loop.
  const maxLoops   = parseInt(process.env.PIPELINE_MAX_LOOPS || String(DEFAULT_MAX_LOOPS), 10);
  const loopCounts = run.loopCounts || {};
  if ((loopCounts[agentId] || 0) >= maxLoops) {
    pipelineLog('run.loop_cap_reached', { runId, stageIndex, agentId, loopCounts });
    return [];
  }

  return stages;
}

/**
 * Return true if a process with the given PID is alive.
 * Uses kill(pid, 0) — signal 0 does not kill but checks existence.
 *
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write the child PID into stageStatuses[stageIndex].pid in run.json.
 *
 * @param {string} dataDir
 * @param {object} run        - Current run state (mutated in place and written).
 * @param {number} stageIndex
 * @param {number} pid
 */
function persistStagePid(dataDir, run, stageIndex, pid) {
  run.stageStatuses[stageIndex].pid = pid;
  writeRun(dataDir, run);
}

/**
 * Kill the stage process by PID and mark the run as failed.
 * Safe to call even when the process is already gone.
 *
 * @param {string} dataDir
 * @param {string} runId
 * @param {number} stageIndex
 * @param {string} reason  - 'timeout' | 'stall'
 */
async function killStage(dataDir, runId, stageIndex, reason) {
  const run = readRun(dataDir, runId);
  if (!run) return;

  // Guard: only act on stages that are still running.
  if (run.stageStatuses[stageIndex].status !== 'running') return;

  const pid = run.stageStatuses[stageIndex].pid;
  if (pid && pid !== process.pid) {
    pipelineLog('stage.kill', { runId, stageIndex, agentId: run.stages[stageIndex], pid, reason });
    try {
      if (process.platform === 'win32') {
        require('child_process').execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' });
      } else {
        process.kill(-pid, 'SIGTERM');
      }
    } catch { /* already gone */ }
  }

  // Clear the polling interval and remove from activeProcesses.
  if (activeProcesses.has(runId)) {
    const { interval } = activeProcesses.get(runId);
    clearInterval(interval);
    activeProcesses.delete(runId);
  }

  run.stageStatuses[stageIndex].status     = reason;   // 'timeout' or 'stall'
  run.stageStatuses[stageIndex].exitCode   = null;
  run.stageStatuses[stageIndex].finishedAt = new Date().toISOString();
  run.status = 'failed';
  writeRun(dataDir, run);
  pipelineLog(`stage.${reason}`, { runId, stageIndex, agentId: run.stages[stageIndex] });

  // T-003 (pipeline-run-history-bridge): update the agent-runs entry to 'failed'.
  const killDurationMs = run.stageStatuses[stageIndex].startedAt
    ? Date.now() - new Date(run.stageStatuses[stageIndex].startedAt).getTime()
    : 0;
  bridgeUpdateRunFinished(dataDir, runId, stageIndex, 'failed', run.stageStatuses[stageIndex].finishedAt, killDurationMs);

  // Teardown worktree if this run used one (parallel-worktrees).
  finalizeRun(dataDir, run).catch((err) => {
    pipelineLog('worktree.error', { runId, op: `finalize_${reason}`, message: err.message });
  });
}

/**
 * Handle stage completion once the done-sentinel is detected.
 * Extracted from the old child.on('close') handler.
 * Guard: if the stage is no longer 'running' (e.g. was stopped externally), returns early.
 *
 * @param {string} dataDir
 * @param {string} runId
 * @param {number} stageIndex
 * @param {number} exitCode - Integer exit code from the done-sentinel file.
 */
async function handleStageClose(dataDir, runId, stageIndex, exitCode) {
  const run = readRun(dataDir, runId);
  if (!run) return;

  const stage = run.stageStatuses[stageIndex];

  // Guard: stop, timeout, stall, or external deletion already processed this stage.
  if (stage.status !== 'running') return;

  const agentId    = run.stages[stageIndex];
  const durationMs = stage.startedAt ? Date.now() - new Date(stage.startedAt).getTime() : 0;

  stage.exitCode   = exitCode;
  stage.finishedAt = new Date().toISOString();

  if (exitCode !== 0) {
    stage.status = 'failed';
    run.status   = 'failed';
    writeRun(dataDir, run);
    pipelineLog('run.failed', { runId, stageIndex, agentId, exitCode });

    // T-003 (pipeline-run-history-bridge): update history entry to 'failed'.
    bridgeUpdateRunFinished(dataDir, runId, stageIndex, 'failed', stage.finishedAt, durationMs);

    // Teardown worktree if this run used one (parallel-worktrees).
    finalizeRun(dataDir, run).catch((err) => {
      pipelineLog('worktree.error', { runId, op: 'finalize_failed_stage', message: err.message });
    });
    return;
  }

  stage.status       = 'completed';
  run.currentStage   = stageIndex + 1;
  pipelineLog('stage.done', { runId, stageIndex, agentId, exitCode, durationMs });

  // T-003 (pipeline-run-history-bridge): update history entry to 'completed'.
  bridgeUpdateRunFinished(dataDir, runId, stageIndex, 'completed', stage.finishedAt, durationMs);

  // Part 2: inject stages requested by the agent via the stage-N.inject signal file.
  const stagesToInject = readInjectSignal(dataDir, runId, stageIndex, agentId, run);
  if (stagesToInject.length > 0) {
    const insertAt = run.currentStage;
    run.stages.splice(insertAt, 0, ...stagesToInject);
    run.stageStatuses.splice(insertAt, 0, ...stagesToInject.map((id) => ({
      agentId:    id,
      status:     'pending',
      exitCode:   null,
      startedAt:  null,
      finishedAt: null,
    })));
    // Re-index every entry so index === position in array.
    run.stageStatuses.forEach((s, i) => { s.index = i; });
    run.loopCounts = run.loopCounts || {};
    run.loopCounts[agentId] = (run.loopCounts[agentId] || 0) + 1;
    pipelineLog('run.loop_injected', { runId, agentId, stagesToInject, loopCount: run.loopCounts[agentId] });
  }

  writeRun(dataDir, run);

  // Part 3: pause before the next stage if it is a checkpoint.
  const nextStage = stageIndex + 1;
  if (nextStage < run.stages.length && (run.checkpoints ?? []).includes(nextStage)) {
    const freshRun = readRun(dataDir, runId);
    if (!freshRun) return;
    freshRun.status            = 'paused';
    freshRun.pausedBeforeStage = nextStage;
    freshRun.currentStage      = nextStage;
    writeRun(dataDir, freshRun);
    pipelineLog('run.paused', { runId, pausedBeforeStage: nextStage });
    return;
  }

  // Part 3b: check for unresolved questions before advancing to the next stage.
  // Reads the task after stage completion so agents can post questions
  // and the pipeline will pause until they are resolved.
  // Skip the check if the run was manually resumed (bypassQuestionCheck = true).
  // Prefers the SQLite store when available; falls back to JSON files (legacy / unit tests).
  {
    let task = null;
    if (!run.bypassQuestionCheck) {
      if (_store) {
        task = _store.getTask(run.spaceId, run.taskId);
      } else {
        const spacesDir = path.join(dataDir, 'spaces');
        task = readTaskFromSpace(spacesDir, run.spaceId, run.taskId);
      }
    }
    if (task) {
      const unresolvedQuestions = (task.comments || []).filter(
        (c) => c.type === 'question' && !c.resolved
      );
      if (unresolvedQuestions.length > 0) {
        const q = unresolvedQuestions[0];
        const freshRun = readRun(dataDir, runId);
        if (!freshRun) return;
        freshRun.status = 'blocked';
        freshRun.blockedReason = {
          commentId:   q.id,
          taskId:      freshRun.taskId,
          author:      q.author,
          text:        q.text,
          ...(q.targetAgent && { targetAgent: q.targetAgent }),
          blockedAt:   new Date().toISOString(),
        };
        writeRun(dataDir, freshRun);
        pipelineLog('run.blocked', { runId, stageIndex, commentId: q.id, author: q.author });

        // Attempt cross-agent resolution if the question has a targetAgent.
        if (q.targetAgent) {
          attemptCrossAgentResolution(dataDir, freshRun, q);
        }
        return;
      }
    }
    // Also handle a concurrent blockRun call (e.g. via direct API).
    const freshRun = readRun(dataDir, runId);
    if (freshRun && freshRun.status === 'blocked') {
      pipelineLog('run.blocked', { runId, blockedBeforeStage: run.currentStage });
      return;
    }
  }

  await executeNextStage(dataDir, runId);
}

/**
 * Start a poll loop that watches the done-sentinel file for stage completion.
 * Also enforces the stage timeout and stall watchdog.
 *
 * @param {string} dataDir
 * @param {string} runId
 * @param {number} stageIndex
 * @param {string} doneFile       - Path to stage-N.done sentinel.
 * @param {number} stageStartedAt - Date.now() when the stage was spawned.
 * @param {number} timeoutMs      - Maximum stage duration before kill.
 */
function startPolling(dataDir, runId, stageIndex, doneFile, stageStartedAt, timeoutMs) {
  const stallMs      = Number(process.env.PIPELINE_STALL_TIMEOUT_MS) || DEFAULT_STALL_TIMEOUT_MS;
  const logPath      = stageLogPath(dataDir, runId, stageIndex);
  let   lastLogMtime = stageStartedAt;

  const interval = setInterval(async () => {
    // --- Done sentinel check ---
    if (fs.existsSync(doneFile)) {
      clearInterval(interval);
      activeProcesses.delete(runId);

      let exitCode = 1;
      try {
        const raw = fs.readFileSync(doneFile, 'utf8').trim();
        exitCode = parseInt(raw, 10);
        if (isNaN(exitCode)) exitCode = 1;
      } catch { /* read error — treat as failure */ }

      pipelineLog('stage.sentinel_detected', { runId, stageIndex, exitCode });

      // Kill the entire process group so any child processes the agent left open
      // (Chromium, pytest workers, vite, etc.) are reaped before the next stage starts.
      try {
        const _r = readRun(dataDir, runId);
        const _pid = _r?.stageStatuses?.[stageIndex]?.pid;
        if (_pid && _pid !== process.pid) {
          if (process.platform === 'win32') {
            require('child_process').execSync(`taskkill /T /F /PID ${_pid}`, { stdio: 'ignore' });
          } else {
            process.kill(-_pid, 'SIGTERM');
          }
          pipelineLog('stage.group_kill', { runId, stageIndex, pid: _pid });
        }
      } catch { /* process group already gone — fine */ }

      await handleStageClose(dataDir, runId, stageIndex, exitCode);
      return;
    }

    const elapsed = Date.now() - stageStartedAt;

    // --- Timeout check ---
    if (elapsed >= timeoutMs) {
      clearInterval(interval);
      activeProcesses.delete(runId);
      await killStage(dataDir, runId, stageIndex, 'timeout');
      return;
    }

    // --- Stall check (no new log output) ---
    // Only advance lastLogMtime if the file is newer — an old log file from a
    // previous run of the same stage must not reset the baseline backwards and
    // cause an immediate false stall.
    try {
      const stat = fs.statSync(logPath);
      if (stat.mtimeMs > lastLogMtime) lastLogMtime = stat.mtimeMs;
    } catch {
      // Log not yet created — use stageStartedAt as baseline.
    }

    if (Date.now() - lastLogMtime >= stallMs) {
      clearInterval(interval);
      activeProcesses.delete(runId);
      await killStage(dataDir, runId, stageIndex, 'stall');
    }
  }, 2000);

  // Unref so this interval does not prevent the Node event loop from exiting
  // cleanly during test teardown (server.close resolves even when a poll tick
  // is outstanding).
  interval.unref();

  return interval;
}

// ---------------------------------------------------------------------------
// Atomic JSON I/O helpers
// ---------------------------------------------------------------------------

/**
 * Read and parse a JSON file. Returns `defaultValue` if file does not exist.
 *
 * @template T
 * @param {string} filePath
 * @param {T} defaultValue
 * @returns {T}
 */
function readJSON(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) return defaultValue;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultValue;
  }
}

/**
 * Write JSON atomically using .tmp + rename.
 *
 * @param {string} filePath
 * @param {*} data
 */
function writeJSON(filePath, data) {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

/**
 * Read the global runs registry (summary list).
 *
 * @param {string} dataDir
 * @returns {object[]}
 */
function readRegistry(dataDir) {
  return readJSON(runsRegistryPath(dataDir), []);
}

/**
 * Append or update a summary entry in runs.json.
 *
 * @param {string} dataDir
 * @param {object} summary - { runId, spaceId, taskId, status, createdAt }
 */
function upsertRegistryEntry(dataDir, summary) {
  const registry = readRegistry(dataDir);
  const idx      = registry.findIndex((r) => r.runId === summary.runId);
  if (idx === -1) {
    registry.push(summary);
  } else {
    registry[idx] = { ...registry[idx], ...summary };
  }
  writeJSON(runsRegistryPath(dataDir), registry);
}

/**
 * Remove an entry from runs.json.
 *
 * @param {string} dataDir
 * @param {string} runId
 */
function removeRegistryEntry(dataDir, runId) {
  const registry = readRegistry(dataDir).filter((r) => r.runId !== runId);
  writeJSON(runsRegistryPath(dataDir), registry);
}

// ---------------------------------------------------------------------------
// Run state I/O
// ---------------------------------------------------------------------------

/**
 * Read full run state from disk.
 *
 * @param {string} dataDir
 * @param {string} runId
 * @returns {object|null}
 */
function readRun(dataDir, runId) {
  return readJSON(runJsonPath(dataDir, runId), null);
}

/**
 * Write full run state to disk atomically.
 *
 * @param {string} dataDir
 * @param {object} run
 */
function writeRun(dataDir, run) {
  run.updatedAt = new Date().toISOString();
  writeJSON(runJsonPath(dataDir, run.runId), run);
  // Keep registry summary in sync.
  upsertRegistryEntry(dataDir, {
    runId:     run.runId,
    spaceId:   run.spaceId,
    taskId:    run.taskId,
    status:    run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  });
}

// ---------------------------------------------------------------------------
// Pipeline observability — structured log lines to stderr
// ---------------------------------------------------------------------------

/**
 * Emit a structured pipeline event to stderr.
 *
 * @param {string} event
 * @param {object} payload
 */
function pipelineLog(event, payload = {}) {
  process.stderr.write(`[PIPELINE] ${JSON.stringify({ event, ...payload, ts: new Date().toISOString() })}\n`);
}

// ---------------------------------------------------------------------------
// Worktree helpers (ADR-1: parallel-worktrees)
// ---------------------------------------------------------------------------

/**
 * Return true when any active run is already targeting the given workingDirectory.
 *
 * Checks two sources:
 *   1. `activeProcesses` (in-memory: stages that have started polling).
 *   2. The runs registry (on-disk: covers the window between createRun() returning
 *      and the first setImmediate callback, during which status is 'pending' but the
 *      run is not yet in activeProcesses).
 *
 * @param {string} dataDir
 * @param {string} workingDirectory
 * @returns {boolean}
 */
function hasActiveRunInDir(dataDir, workingDirectory) {
  if (!workingDirectory) return false;

  // Fast path: check in-memory active stages.
  for (const [runId] of activeProcesses) {
    const run = readRun(dataDir, runId);
    if (run && run.workingDirectory === workingDirectory) return true;
  }

  // Slow path: check the registry for any active-status run targeting the same dir.
  // This covers pending runs that haven't entered activeProcesses yet.
  const ACTIVE_STATUSES = new Set(['pending', 'running', 'blocked', 'paused']);
  const registry = readRegistry(dataDir);
  for (const entry of registry) {
    if (!ACTIVE_STATUSES.has(entry.status)) continue;
    const run = readRun(dataDir, entry.runId);
    if (run && run.workingDirectory === workingDirectory) return true;
  }

  return false;
}

/**
 * Resolve the effective working directory for a run.
 * When the run has an isolated worktree, return its path; otherwise return
 * the configured workingDirectory (or undefined for runs without one).
 *
 * @param {object|null|undefined} run
 * @returns {string|undefined}
 */
function effectiveCwd(run) {
  if (!run) return undefined;
  if (run.worktree && run.worktree.path) return run.worktree.path;
  return run.workingDirectory || undefined;
}

/**
 * Tear down the worktree for a run that has reached a terminal state.
 * No-op when the run has no worktree. Never throws.
 *
 * @param {string} dataDir
 * @param {object} run  - Run state at the point of finalization.
 */
async function finalizeRun(dataDir, run) {
  if (!run || !run.worktree) return; // Solo runs have no worktree — skip.

  const deleteBranch =
    process.env.PIPELINE_DELETE_BRANCH_ON_FAILURE === '1' &&
    run.status !== 'completed';

  await worktreeManager.teardown(run.worktree, {
    reason:       run.status || 'unknown',
    runId:        run.runId,
    deleteBranch,
  });
}

// ---------------------------------------------------------------------------
// Agent-runs bridge helpers (ADR-1: pipeline-run-history-bridge)
// ---------------------------------------------------------------------------

/**
 * Read the name of a space from data/spaces.json.
 * Returns spaceId as fallback when the file is missing or the space is not found.
 *
 * @param {string} dataDir
 * @param {string} spaceId
 * @returns {string}
 */
function readSpaceName(dataDir, spaceId) {
  try {
    const spaces = JSON.parse(fs.readFileSync(path.join(dataDir, 'spaces.json'), 'utf8'));
    return spaces.find((s) => s.id === spaceId)?.name ?? spaceId;
  } catch {
    return spaceId;
  }
}

/**
 * Convert a kebab-case agent ID to a human-readable display name.
 * Example: 'senior-architect' → 'Senior Architect'
 *
 * @param {string} agentId
 * @returns {string}
 */
function toDisplayName(agentId) {
  return agentId.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Append a new "running" entry to agent-runs.jsonl for a pipeline stage.
 * Prunes to AGENT_RUNS_MAX_ENTRIES if needed.
 * Non-fatal: logs a warning and returns on any error.
 *
 * @param {string} dataDir
 * @param {object} run         - Current run state.
 * @param {number} stageIndex
 * @param {string} taskTitle
 * @param {string} spaceName
 * @param {string} cliCommand
 * @param {string} promptPath
 */
function bridgeWriteRunStarted(dataDir, run, stageIndex, taskTitle, spaceName, cliCommand, promptPath) {
  try {
    const agentId  = run.stages[stageIndex];
    const entryId  = `${run.runId}-${stageIndex}`;
    const entry = {
      id:               entryId,
      pipelineRunId:    run.runId,
      stageIndex,
      taskId:           run.taskId,
      taskTitle,
      agentId,
      agentDisplayName: toDisplayName(agentId),
      spaceId:          run.spaceId,
      spaceName,
      status:           'running',
      startedAt:        run.stageStatuses[stageIndex].startedAt ?? new Date().toISOString(),
      completedAt:      null,
      durationMs:       null,
      cliCommand,
      promptPath,
    };

    const filePath = path.join(dataDir, 'agent-runs.jsonl');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');

    // Prune to 500 entries.
    const MAX_ENTRIES = 500;
    const allLines = fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    if (allLines.length > MAX_ENTRIES) {
      const pruned  = allLines.slice(allLines.length - MAX_ENTRIES);
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, pruned.join('\n') + '\n', 'utf8');
      fs.renameSync(tmpPath, filePath);
    }

    pipelineLog('agent_run_entry.created', { runId: run.runId, stageIndex, entryId });
  } catch (err) {
    console.warn(`[pipelineManager] WARN: could not write agent-run entry for stage ${stageIndex}:`, err.message);
  }
}

/**
 * Update an existing agent-runs.jsonl entry for a stage that has completed, failed,
 * or been killed. Non-fatal.
 *
 * @param {string} dataDir
 * @param {string} runId
 * @param {number} stageIndex
 * @param {string} status     - 'completed' | 'failed' | 'cancelled'
 * @param {string} completedAt - ISO timestamp
 * @param {number} durationMs
 */
function bridgeUpdateRunFinished(dataDir, runId, stageIndex, status, completedAt, durationMs) {
  try {
    const entryId = `${runId}-${stageIndex}`;
    const records = readAgentRuns(dataDir);
    const idx     = records.findIndex((r) => r.id === entryId);
    if (idx === -1) return; // entry may not exist (e.g. PIPELINE_NO_SPAWN=1 without bridgeWrite)

    records[idx] = { ...records[idx], status, completedAt, durationMs };
    writeAgentRuns(dataDir, records);
    pipelineLog('agent_run_entry.updated', { runId, stageIndex, entryId, status });
  } catch (err) {
    console.warn(`[pipelineManager] WARN: could not update agent-run entry for stage ${stageIndex}:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Kanban integration — thin HTTP client calls via child http
// ---------------------------------------------------------------------------

/**
 * Move the kanban task to a different column by calling the REST API.
 * Best-effort: logs on failure but does not throw (pipeline continues).
 *
 * @param {string} spaceId
 * @param {string} taskId
 * @param {string} column - 'todo' | 'in-progress' | 'done'
 */
async function moveKanbanTask(spaceId, taskId, column) {
  const http     = require('http');
  const baseUrl  = process.env.KANBAN_API_URL || 'http://localhost:3000/api/v1';
  const parsed   = new URL(baseUrl);
  const hostname = parsed.hostname;
  const port     = parseInt(parsed.port || '80', 10);
  const urlPath  = `${parsed.pathname.replace(/\/$/, '')}/spaces/${spaceId}/tasks/${taskId}/move`;
  const payload  = JSON.stringify({ to: column });

  return new Promise((resolve) => {
    const req = http.request(
      { hostname, port, path: urlPath, method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        res.resume(); // drain response
        res.on('end', () => resolve());
      }
    );
    req.setTimeout(5000, () => { req.destroy(); resolve(); });
    req.on('error', (err) => {
      console.warn(`[pipelineManager] WARN: could not move task ${taskId} to '${column}': ${err.message}`);
      resolve();
    });
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Build the prompt text that a pipeline stage agent receives via stdin.
 *
 * Reads the task from the space, appends artifact paths from previous stages,
 * git context, and the compile gate block for developer-agent.
 * Returns an object with the full prompt text and an estimated token count.
 *
 * This is the single source of truth used by both spawnStage() (actual
 * execution) and handlePreviewPrompts() (dry-run preview endpoint).
 *
 * @param {string}   dataDir          - Root data directory.
 * @param {string}   spaceId          - Kanban space containing the task.
 * @param {string}   taskId           - Task ID to build the prompt for.
 * @param {number}   stageIndex       - Zero-based index of this stage in the run.
 * @param {string}   agentId          - Agent ID for this stage.
 * @param {string[]} stages           - Full ordered list of agent IDs in the pipeline.
 * @param {string}   [workingDirectory]
 * @param {string}   [runId]          - Run ID, included so agents can write stage-N.inject.
 * @returns {{ promptText: string, estimatedTokens: number }}
 */
function buildStagePrompt(dataDir, spaceId, taskId, stageIndex, agentId, stages, workingDirectory, runId) {
  // Use the SQLite store when available; fall back to legacy JSON file reading.
  let task;
  if (_store) {
    task = _store.getTask(spaceId, taskId);
  } else {
    // readTaskFromSpace uses path.join(baseDataDir, spaceId) for legacy layout.
    const spacesDir = path.join(dataDir, 'spaces');
    task = readTaskFromSpace(spacesDir, spaceId, taskId);
  }

  const isLastStage = stageIndex === stages.length - 1;

  let promptText = task
    ? `Task: ${task.title}\n${task.description ? `Description: ${task.description}\n` : ''}TaskId: ${task.id}\nSpaceId: ${spaceId}\n`
    : `TaskId: ${taskId}\nSpaceId: ${spaceId}\n`;

  // Tell the agent whether it is the last stage so it knows to move the task to done.
  promptText += `LastStage: ${isLastStage}\n`;

  // Provide run context so agents can write the loop-inject signal file if needed.
  if (runId) {
    promptText += `RunId: ${runId}\nStageIndex: ${stageIndex}\n`;
  }

  // Include working directory if set — tells the agent where to cd into.
  if (workingDirectory) {
    promptText += `\nWorking Directory: ${workingDirectory}\n`;
    promptText += '⚠️ You MUST cd into this directory before starting work. All file paths should be relative to this directory.\n';
  }

  // Include artifact paths from previous stages (accumulated on the task by earlier agents).
  if (task && Array.isArray(task.attachments) && task.attachments.length > 0) {
    const fileArtifacts = task.attachments.filter((a) => a.type === 'file' && a.content);
    if (fileArtifacts.length > 0) {
      promptText += '\n## ARTIFACTS FROM PREVIOUS STAGES\n';
      promptText += 'The following files were produced by earlier pipeline stages. Read them before starting your work:\n';
      for (const att of fileArtifacts) {
        promptText += `- ${att.name}: ${att.content}\n`;
      }
    }
  }

  // Include git context so agents can evaluate what work has already been done.
  // IMPORTANT: Only included when workingDirectory is explicitly set — falling back
  // to process.cwd() would expose Prism's own git history to agents that have no
  // project directory, which is misleading and incorrect.
  // buildGitContextBlock filters untracked (??) files which are irrelevant to agents.
  const gitCtxBlock = buildGitContextBlock(workingDirectory);
  if (gitCtxBlock) promptText += gitCtxBlock + '\n';

  // Kanban instructions — always included so agents can move tasks and post questions.
  // buildKanbanBlock includes stop conditions, note/handoff guidance, and MCP examples.
  promptText += '\n' + buildKanbanBlock(spaceId, taskId) + '\n';
  promptText += '\n';
  promptText += buildCommentGuidanceLines(spaceId, taskId).join('\n') + '\n';

  // For the developer stage: require compilation gate before closing.
  // Prevents QA from launching against code that does not compile.
  if (agentId === 'developer-agent') {
    promptText += '\n' + buildCompileGateBlock() + '\n';
  }

  const estimatedTokens = Math.ceil(promptText.length / 4);
  return { promptText, estimatedTokens };
}

// ---------------------------------------------------------------------------
// Stage execution
// ---------------------------------------------------------------------------

/**
 * Advance the pipeline to the next pending stage, or mark it complete.
 * Called asynchronously — does not block createRun().
 *
 * @param {string} dataDir
 * @param {string} runId
 */
async function executeNextStage(dataDir, runId) {
  const run = readRun(dataDir, runId);
  if (!run) return;

  // Guard: don't advance if the pipeline is blocked (agent asked a question).
  if (run.status === 'blocked') {
    pipelineLog('run.blocked_guard', { runId, currentStage: run.currentStage });
    return;
  }

  // Check if all stages have completed.
  if (run.currentStage >= run.stages.length) {
    run.status = 'completed';
    writeRun(dataDir, run);
    pipelineLog('run.completed', { runId, totalDurationMs: Date.now() - new Date(run.createdAt).getTime() });
    await moveKanbanTask(run.spaceId, run.taskId, 'done');
    // Teardown worktree now that the run is complete (parallel-worktrees).
    await finalizeRun(dataDir, run);
    return;
  }

  await spawnStage(dataDir, run, run.currentStage);
}

/**
 * Spawn the subprocess for a single pipeline stage.
 *
 * @param {string} dataDir
 * @param {object} run       - Current run state object.
 * @param {number} stageIndex
 */
async function spawnStage(dataDir, run, stageIndex) {
  const agentId     = run.stages[stageIndex];
  const baseTimeout = parseInt(process.env.PIPELINE_STAGE_TIMEOUT_MS || String(DEFAULT_STAGE_TIMEOUT_MS), 10);
  // Orchestrator coordinates the full pipeline internally — give it 6× the per-stage timeout.
  const timeoutMs = agentId === 'orchestrator' ? baseTimeout * 6 : baseTimeout;

  // Update stage state to running.
  run.status = 'running';
  run.stageStatuses[stageIndex].status    = 'running';
  run.stageStatuses[stageIndex].startedAt = new Date().toISOString();
  writeRun(dataDir, run);

  pipelineLog('stage.started', { runId: run.runId, stageIndex, agentId });

  // Build the task prompt to pass via stdin.
  // Use effectiveCwd so isolated runs see the worktree path, not the parent repo.
  const { promptText: taskPrompt } = buildStagePrompt(
    dataDir, run.spaceId, run.taskId, stageIndex, agentId, run.stages, effectiveCwd(run), run.runId,
  );

  // T-002: Persist the prompt to disk before piping it to the child process.
  // Written atomically (.tmp + rename) so the file is available even if the child crashes.
  const promptFilePath = stagePromptPath(dataDir, run.runId, stageIndex);
  try {
    const tmpPath = promptFilePath + '.tmp';
    fs.writeFileSync(tmpPath, taskPrompt, 'utf8');
    fs.renameSync(tmpPath, promptFilePath);
    pipelineLog('stage_prompt_persisted', {
      runId:      run.runId,
      stageIndex,
      sizeBytes:  Buffer.byteLength(taskPrompt, 'utf8'),
    });
  } catch (writeErr) {
    console.warn(`[pipelineManager] WARN: could not persist prompt for stage ${stageIndex}:`, writeErr.message);
  }

  // T-002 (pipeline-run-history-bridge): write a 'running' entry to agent-runs.jsonl.
  // Runs after the prompt file is persisted so promptPath is ready.
  // Non-fatal — see bridgeWriteRunStarted.
  {
    const spacesDir  = path.join(dataDir, 'spaces');
    const task       = readTaskFromSpace(spacesDir, run.spaceId, run.taskId);
    const taskTitle  = task?.title ?? `Task ${run.taskId}`;
    const spaceName  = readSpaceName(dataDir, run.spaceId);
    bridgeWriteRunStarted(dataDir, run, stageIndex, taskTitle, spaceName, '', promptFilePath);
  }

  const logPath  = stageLogPath(dataDir, run.runId, stageIndex);
  const doneFile = stageDonePath(dataDir, run.runId, stageIndex);

  const stageStartedAt = Date.now();

  // Test hook: when PIPELINE_NO_SPAWN=1, skip agent resolution and real spawning.
  // This allows unit/integration tests to exercise block/unblock flows without
  // needing real agent files on disk or launching actual claude processes.
  if (process.env.PIPELINE_NO_SPAWN === '1') {
    fs.writeFileSync(doneFile, '0', 'utf8');
    // null PID: no real process — deleteRun/abortAll will skip the kill() call
    // and avoid accidentally sending SIGTERM to the current process (e.g. test runner).
    persistStagePid(dataDir, run, stageIndex, null);
    const interval = startPolling(dataDir, run.runId, stageIndex, doneFile, stageStartedAt, timeoutMs);
    activeProcesses.set(run.runId, { interval, stageIndex });
    pipelineLog('stage.spawned', { runId: run.runId, stageIndex, agentId, pid: null, mock: true });
    return;
  }

  // Resolve spawn args — may throw AgentNotFoundError.
  // Placed after the PIPELINE_NO_SPAWN guard so test-mode bypasses agent resolution.
  const agentsDir = process.env.PIPELINE_AGENTS_DIR;
  let agentSpec;
  try {
    agentSpec = resolveAgent(agentId, agentsDir);
  } catch (err) {
    if (err instanceof AgentNotFoundError) {
      run.status = 'failed';
      run.stageStatuses[stageIndex].status   = 'failed';
      run.stageStatuses[stageIndex].exitCode = -1;
      run.stageStatuses[stageIndex].finishedAt = new Date().toISOString();
      writeRun(dataDir, run);
      pipelineLog('run.failed', { runId: run.runId, stageIndex, agentId, reason: 'AGENT_NOT_FOUND' });
      return;
    }
    throw err;
  }

  // Backend spawns always get --permission-mode bypassPermissions: there is no user
  // present to respond to permission prompts, so any interactive pause would
  // hang the stage until the stall watchdog kills it.
  const hasPermissionMode = agentSpec.spawnArgs.includes('--permission-mode');
  const finalArgs = hasPermissionMode
    ? agentSpec.spawnArgs
    : [...agentSpec.spawnArgs, '--permission-mode', 'bypassPermissions'];

  // Build shell command: shell wrapper reads prompt from file, appends to log,
  // writes exit code to done-sentinel when finished.
  // spawn() with detached=true gives sh its own process group (PGID = child.pid).
  // Kill uses -pid (negative) to send SIGTERM to the entire group (sh + claude).
  // NOTE: do NOT use `exec claude` here — exec replaces sh, so the trailing
  //       `echo $? > doneFile` would never run and the sentinel would never be written.
  const escapedArgs = finalArgs.map(shellEscape).join(' ');
  // After claude exits, kill any Playwright/Chromium processes left behind by the
  // persistent Playwright MCP server. Targets the playwright cache path to avoid
  // killing the user's own Chrome browser.
  const _playwrightCleanup = `pkill -f 'ms-playwright' 2>/dev/null; true`;
  const shellCmd    = `${CLAUDE_BIN} ${escapedArgs} < ${shellEscape(promptFilePath)} >> ${shellEscape(logPath)} 2>&1; _EXIT=$?; ${_playwrightCleanup}; echo $_EXIT > ${shellEscape(doneFile)}`;

  const child = spawn('sh', ['-c', shellCmd], {
    stdio:    'ignore',
    detached: true,
    env:      { ...process.env },
  });

  // Decouple from server.js — child keeps running even if server restarts.
  child.unref();

  // On macOS, prevent idle sleep while the stage runs.
  // caffeinate -w <pid> watches the process and exits automatically when it finishes.
  // It is a macOS system binary (/usr/bin/caffeinate) — no PATH issues.
  // Non-critical: if it fails the pipeline still runs normally.
  if (process.platform === 'darwin' && child.pid) {
    const caff = spawn('caffeinate', ['-w', String(child.pid)], { stdio: 'ignore' });
    caff.unref();
  }

  // Persist PID so init() can re-attach after a server restart.
  persistStagePid(dataDir, run, stageIndex, child.pid);

  // Start polling loop that watches the done-sentinel, timeout, and stall.
  const interval = startPolling(dataDir, run.runId, stageIndex, doneFile, stageStartedAt, timeoutMs);
  activeProcesses.set(run.runId, { interval, stageIndex });

  pipelineLog('stage.spawned', { runId: run.runId, stageIndex, agentId, pid: child.pid });

  // Handle spawn errors (e.g. sh not found — very unlikely but safe to handle).
  child.on('error', (err) => {
    clearInterval(interval);
    activeProcesses.delete(run.runId);

    const currentRun = readRun(dataDir, run.runId);
    if (!currentRun) return;
    if (currentRun.stageStatuses[stageIndex].status !== 'running') return;

    currentRun.stageStatuses[stageIndex].status     = 'failed';
    currentRun.stageStatuses[stageIndex].finishedAt = new Date().toISOString();
    currentRun.status = 'failed';
    writeRun(dataDir, currentRun);
    pipelineLog('stage.spawn_error', { runId: run.runId, stageIndex, agentId, error: err.message });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan data/runs/ on startup and mark any 'running' runs as 'interrupted'.
 * Prevents stale state after an unclean server shutdown.
 *
 * @param {string} dataDir - Root data directory.
 */
function init(dataDir, store) {
  if (store) _store = store;

  // Re-register this module instance in the require cache.
  // In test environments the cache is sometimes cleared between server restarts,
  // causing lazy require() calls in route handlers to create a second, uninitialized
  // instance (with _store=null) instead of returning this initialized one.
  // Re-registering here guarantees a single initialized instance per process.
  try {
    const selfPath = require.resolve(__filename);
    if (!require.cache[selfPath]) {
      require.cache[selfPath] = module;
    }
  } catch { /* ignore — not critical */ }

  const dir = runsDir(dataDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }

  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    console.warn('[pipelineManager] WARN: could not read runs dir:', err.message);
    return;
  }

  // Collect unique workingDirectories for the reapOrphans sweep below.
  const knownWorkingDirs = new Set();

  for (const entry of entries) {
    const runJsonFile = path.join(dir, entry, 'run.json');
    if (!fs.existsSync(runJsonFile)) continue;

    try {
      const run = JSON.parse(fs.readFileSync(runJsonFile, 'utf8'));
      if (!run) continue;

      // Collect workingDirectory for reapOrphans sweep (parallel-worktrees).
      if (run.workingDirectory) knownWorkingDirs.add(run.workingDirectory);

      // T-010: Handle blocked runs with an active resolver on restart.
      if (run.status === 'blocked' && run.resolverActive === true) {
        const resolverPid        = run.blockedReason?.resolverPid;
        const resolverStartedAt  = run.blockedReason?.resolverStartedAt
          ? new Date(run.blockedReason.resolverStartedAt).getTime()
          : 0;
        const commentId          = run.blockedReason?.commentId;
        const pidIsStale         = resolverStartedAt < BOOT_TIME;

        if (!pidIsStale && resolverPid && isProcessAlive(resolverPid)) {
          // Resolver still alive — reattach polling.
          const timeoutMs = parseInt(
            process.env.PIPELINE_RESOLVER_TIMEOUT_MS || String(DEFAULT_RESOLVER_TIMEOUT_MS),
            10
          );
          const doneFile = resolverDonePath(dataDir, run.runId, commentId);
          // Reconstruct a minimal comment object for handleResolverClose.
          const comment = {
            id:          commentId,
            targetAgent: run.blockedReason?.targetAgent,
            author:      run.blockedReason?.author,
            text:        run.blockedReason?.text,
          };
          startResolverPolling(dataDir, run.runId, comment, doneFile, resolverStartedAt || BOOT_TIME, timeoutMs, resolverPid);
          pipelineLog('resolver.reattached', { runId: run.runId, commentId, resolverPid });
        } else if (commentId) {
          // Resolver PID dead or stale — mark needsHuman and clear resolverActive.
          run.resolverActive = false;
          if (run.blockedReason) {
            delete run.blockedReason.resolverPid;
            delete run.blockedReason.resolverStartedAt;
          }
          run.updatedAt = new Date().toISOString();
          writeJSON(runJsonFile, run);
          upsertRegistryEntry(dataDir, {
            runId: run.runId, spaceId: run.spaceId, taskId: run.taskId,
            status: run.status, createdAt: run.createdAt, updatedAt: run.updatedAt,
          });
          markCommentNeedsHuman(dataDir, run.spaceId, run.taskId, commentId);
          pipelineLog('resolver.dead_on_restart', { runId: run.runId, commentId });
        }
        continue;
      }

      if (run.status !== 'running') continue;

      // Find the currently-running stage.
      const runningStageIdx = Array.isArray(run.stageStatuses)
        ? run.stageStatuses.findIndex((s) => s.status === 'running')
        : -1;

      if (runningStageIdx === -1) {
        // No stage is marked running — interrupt at run level.
        run.status    = 'interrupted';
        run.updatedAt = new Date().toISOString();
        writeJSON(runJsonFile, run);
        upsertRegistryEntry(dataDir, { runId: run.runId, spaceId: run.spaceId, taskId: run.taskId, status: 'interrupted', createdAt: run.createdAt, updatedAt: run.updatedAt });
        console.warn(`[pipelineManager] WARN: run ${run.runId} was interrupted (server restart)`);
        continue;
      }

      const stage      = run.stageStatuses[runningStageIdx];
      const pid        = stage.pid;
      const startedAt  = stage.startedAt ? new Date(stage.startedAt).getTime() : 0;

      // Boot-time guard: if the stage started before this server booted,
      // treat the PID as stale even if another process with the same PID is alive.
      const pidIsStale = startedAt < BOOT_TIME;

      if (!pidIsStale && pid && isProcessAlive(pid)) {
        // Process is still running — re-attach polling so completion is detected.
        const agentId     = run.stages[runningStageIdx];
        const baseTimeout = parseInt(process.env.PIPELINE_STAGE_TIMEOUT_MS || String(DEFAULT_STAGE_TIMEOUT_MS), 10);
        const timeoutMs   = agentId === 'orchestrator' ? baseTimeout * 6 : baseTimeout;
        const doneFile    = stageDonePath(dataDir, run.runId, runningStageIdx);

        const interval = startPolling(dataDir, run.runId, runningStageIdx, doneFile, startedAt || BOOT_TIME, timeoutMs);
        activeProcesses.set(run.runId, { interval, stageIndex: runningStageIdx });
        pipelineLog('run.reattached', { runId: run.runId, runningStageIdx, pid });
      } else {
        // PID is dead or stale — but check if the done-sentinel was written
        // before we mark as interrupted. The stage may have completed cleanly
        // while the server was down (e.g. code-reviewer writing its sentinel
        // after the server restarted and lost the polling interval).
        const doneFile = stageDonePath(dataDir, run.runId, runningStageIdx);
        if (fs.existsSync(doneFile)) {
          let exitCode = 1;
          try {
            const raw = fs.readFileSync(doneFile, 'utf8').trim();
            exitCode = parseInt(raw, 10);
            if (isNaN(exitCode)) exitCode = 1;
          } catch { /* read error — treat as failure */ }
          pipelineLog('stage.sentinel_detected_on_reattach', { runId: run.runId, runningStageIdx, exitCode });
          // Process the completed stage asynchronously.
          handleStageClose(dataDir, run.runId, runningStageIdx, exitCode).catch((err) => {
            console.warn(`[pipelineManager] WARN: handleStageClose on reattach failed for run ${run.runId}:`, err.message);
          });
        } else {
          // No sentinel — stage truly did not complete. Mark interrupted.
          // Defensively kill the process group: the agent may still be running even when
          // flagged as stale, because detached+unref'd processes survive server restarts.
          if (pid && pid !== process.pid) {
            try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ }
          }
          run.status    = 'interrupted';
          run.updatedAt = new Date().toISOString();
          for (const s of run.stageStatuses) {
            if (s.status === 'running') {
              s.status     = 'interrupted';
              s.finishedAt = run.updatedAt;
            }
          }
          writeJSON(runJsonFile, run);
          upsertRegistryEntry(dataDir, { runId: run.runId, spaceId: run.spaceId, taskId: run.taskId, status: 'interrupted', createdAt: run.createdAt, updatedAt: run.updatedAt });
          console.warn(`[pipelineManager] WARN: run ${run.runId} was interrupted (server restart, PID dead)`);
        }
      }
    } catch (err) {
      console.warn(`[pipelineManager] WARN: could not process run entry '${entry}':`, err.message);
    }
  }

  // Garbage-collect orphaned worktrees from unclean shutdowns (parallel-worktrees T-008).
  // Run asynchronously — init() is synchronous overall; reapOrphans is a best-effort sweep.
  if (knownWorkingDirs.size > 0) {
    worktreeManager.reapOrphans(dataDir, [...knownWorkingDirs]).catch((err) => {
      console.warn('[pipelineManager] WARN: reapOrphans failed:', err.message);
    });
  }
}

/**
 * Create a new pipeline run and kick it off asynchronously.
 *
 * Validates:
 *   1. The task exists in the given space and is in the 'todo' column.
 *   2. The number of active runs does not exceed PIPELINE_MAX_CONCURRENT.
 *   3. All agent IDs in `stages` resolve to existing files.
 *
 * Returns the initial Run object immediately (before any stage executes).
 *
 * @param {object} params
 * @param {string} params.spaceId  - Kanban space containing the task.
 * @param {string} params.taskId   - Task ID to pipeline. Must be in 'todo'.
 * @param {string[]} [params.stages] - Ordered agent IDs. Defaults to DEFAULT_STAGES.
 * @param {string} params.dataDir  - Root data directory.
 * @returns {Promise<object>} Initial run state.
 * @throws On validation failure (TASK_NOT_FOUND, TASK_NOT_IN_TODO, MAX_CONCURRENT_REACHED, AGENT_NOT_FOUND).
 */
async function createRun({ spaceId, taskId, stages, dataDir, workingDirectory, dangerouslySkipPermissions = false, checkpoints = [] }) {
  const stageList = stages && stages.length > 0 ? stages : DEFAULT_STAGES;

  // --- Validate task exists and is in 'todo'. ---
  const taskResult = _store
    ? _store.getTaskWithColumn(spaceId, taskId)
    : findTaskInDataDir(spaceId, taskId, dataDir);
  if (!taskResult) {
    const err = new Error(`Task '${taskId}' not found in space '${spaceId}'.`);
    err.code = 'TASK_NOT_FOUND';
    throw err;
  }
  if (taskResult.column !== 'todo') {
    const err = new Error(`Task '${taskId}' is in column '${taskResult.column}', not 'todo'.`);
    err.code = 'TASK_NOT_IN_TODO';
    throw err;
  }

  // --- Check concurrency limit. ---
  const maxConcurrent = parseInt(process.env.PIPELINE_MAX_CONCURRENT || String(DEFAULT_MAX_CONCURRENT), 10);
  if (activeProcesses.size >= maxConcurrent) {
    const err = new Error(`Maximum concurrent runs (${maxConcurrent}) reached.`);
    err.code = 'MAX_CONCURRENT_REACHED';
    throw err;
  }

  // --- Validate all agent files exist upfront. ---
  const agentsDir = process.env.PIPELINE_AGENTS_DIR;
  for (const agentId of stageList) {
    try {
      resolveAgent(agentId, agentsDir);
    } catch (err) {
      if (err instanceof AgentNotFoundError) throw err;
      throw err;
    }
  }

  // --- Generate run ID upfront so it can be used in worktree path/branch names. ---
  const runId = crypto.randomUUID();

  // --- Provision a worktree if another active run uses the same workingDirectory. ---
  // This is done BEFORE building the run object so that failures here do not
  // leave a partial run.json on disk. The task stays in 'todo'.
  let worktreeMeta = null;
  const worktreeEnabled = process.env.PIPELINE_WORKTREE_ENABLED !== '0';
  if (worktreeEnabled && workingDirectory && hasActiveRunInDir(dataDir, workingDirectory)) {
    try {
      worktreeMeta = await worktreeManager.provision(workingDirectory, runId);
    } catch (err) {
      const provErr = new Error(`Worktree provisioning failed: ${err.message}`);
      provErr.code = 'WORKTREE_PROVISION_FAILED';
      provErr.original = err;
      throw provErr;
    }
  }

  // --- Build initial run state. ---
  const now       = new Date().toISOString();
  const run = {
    runId,
    spaceId,
    taskId,
    stages: stageList,
    currentStage: 0,
    status: 'pending',
    stageStatuses: stageList.map((agentId, index) => ({
      index,
      agentId,
      status:     'pending',
      exitCode:   null,
      startedAt:  null,
      finishedAt: null,
    })),
    createdAt: now,
    updatedAt: now,
    dangerouslySkipPermissions,
    checkpoints: Array.isArray(checkpoints) ? checkpoints : [],
    ...(workingDirectory ? { workingDirectory } : {}),
    ...(worktreeMeta    ? { worktree: worktreeMeta } : {}),
  };

  // --- Ensure runs directory exists. ---
  const runDirPath = runDir(dataDir, runId);
  fs.mkdirSync(runDirPath, { recursive: true });

  // --- Persist initial state. ---
  writeRun(dataDir, run);
  pipelineLog('run.created', { runId, spaceId, taskId, stages: stageList });

  // --- Move task to in-progress. ---
  await moveKanbanTask(spaceId, taskId, 'in-progress');

  // --- Kick off pipeline asynchronously (fire-and-forget). ---
  setImmediate(() => executeNextStage(dataDir, runId));

  return run;
}

/**
 * Look up a task across all columns in a space's directory.
 *
 * @param {string} spaceId
 * @param {string} taskId
 * @param {string} dataDir
 * @returns {{ task: object, column: string } | null}
 */
function findTaskInDataDir(spaceId, taskId, dataDir) {
  const spaceDir = path.join(dataDir, 'spaces', spaceId);
  for (const column of ['todo', 'in-progress', 'done']) {
    const filePath = path.join(spaceDir, `${column}.json`);
    if (!fs.existsSync(filePath)) continue;
    try {
      const tasks = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const task  = Array.isArray(tasks) ? tasks.find((t) => t.id === taskId) : null;
      if (task) return { task, column };
    } catch { /* skip corrupt files */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resolver helpers — cross-agent question resolver (ADR-1 cross-agent-questions)
// ---------------------------------------------------------------------------

/**
 * Mark a comment as needsHuman=true by directly patching the task's column JSON.
 * Used by pipelineManager to escalate unresolvable questions without an HTTP round-trip.
 *
 * @param {string} dataDir
 * @param {string} spaceId
 * @param {string} taskId
 * @param {string} commentId
 */
function markCommentNeedsHuman(dataDir, spaceId, taskId, commentId) {
  // Post-migration: use the SQLite store when available.
  if (_store) {
    const task = _store.getTask(spaceId, taskId);
    if (!task) {
      console.warn(`[pipelineManager] WARN: markCommentNeedsHuman — task ${taskId} not found in space ${spaceId}`);
      return;
    }
    const comments = Array.isArray(task.comments) ? task.comments : [];
    const cIdx     = comments.findIndex((c) => c.id === commentId);
    if (cIdx === -1) {
      console.warn(`[pipelineManager] WARN: markCommentNeedsHuman — comment ${commentId} not found in task ${taskId}`);
      return;
    }
    const now = new Date().toISOString();
    comments[cIdx] = { ...comments[cIdx], needsHuman: true, updatedAt: now };
    _store.updateTask(spaceId, taskId, { comments, updatedAt: now });
    pipelineLog('comment.needs_human', { taskId, commentId, spaceId, reason: 'resolver_failed' });
    return;
  }

  // Legacy fallback: read/write JSON column files (used by unit tests that inject no store).
  const spaceDir = path.join(dataDir, 'spaces', spaceId);
  for (const col of ['todo', 'in-progress', 'done']) {
    const filePath = path.join(spaceDir, `${col}.json`);
    if (!fs.existsSync(filePath)) continue;
    let tasks;
    try {
      tasks = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(tasks)) continue;

    const taskIdx = tasks.findIndex((t) => t.id === taskId);
    if (taskIdx === -1) continue;

    const task     = tasks[taskIdx];
    const comments = Array.isArray(task.comments) ? task.comments : [];
    const cIdx     = comments.findIndex((c) => c.id === commentId);
    if (cIdx === -1) continue;

    comments[cIdx] = { ...comments[cIdx], needsHuman: true, updatedAt: new Date().toISOString() };
    tasks[taskIdx] = { ...task, comments, updatedAt: new Date().toISOString() };

    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(tasks, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
    pipelineLog('comment.needs_human', { taskId, commentId, spaceId, reason: 'resolver_failed' });
    return;
  }
  console.warn(`[pipelineManager] WARN: markCommentNeedsHuman — comment ${commentId} not found in task ${taskId}`);
}

/**
 * Build a minimal resolver prompt for a cross-agent question.
 *
 * @param {object} run    - Current run state.
 * @param {object} task   - The task object (may be null).
 * @param {object} comment - The question comment.
 * @param {string} dataDir
 * @returns {string}
 */
function buildResolverPrompt(run, task, comment, dataDir) {
  const spaceId   = run.spaceId;
  const taskId    = run.taskId;
  const commentId = comment.id;

  let prompt = `You are answering a question from another agent in the pipeline.\n\n`;

  prompt += `## Question\n`;
  prompt += `Author: ${comment.author}\n`;
  prompt += `Text: ${comment.text}\n\n`;

  prompt += `## Task Context\n`;
  prompt += `Title: ${task ? task.title : taskId}\n`;
  if (task && task.description) {
    prompt += `Description: ${task.description}\n`;
  }
  prompt += `SpaceId: ${spaceId}\n`;
  prompt += `TaskId: ${taskId}\n`;
  prompt += `CommentId: ${commentId}\n\n`;

  // Include file attachments so the resolver can read ADR/blueprint etc.
  if (task && Array.isArray(task.attachments) && task.attachments.length > 0) {
    const fileArtifacts = task.attachments.filter((a) => a.type === 'file' && a.content);
    if (fileArtifacts.length > 0) {
      prompt += `## Available Artifacts\n`;
      for (const att of fileArtifacts) {
        prompt += `- ${att.name}: ${att.content}\n`;
      }
      prompt += '\n';
    }
  }

  if (run.workingDirectory) {
    prompt += `## Working Directory\n${run.workingDirectory}\n\n`;
  }

  prompt += `## Instructions\n`;
  prompt += `1. Read any relevant artifacts (ADR, blueprint, code) to understand the context.\n`;
  prompt += `2. Formulate a clear, actionable answer.\n`;
  prompt += `3. Call kanban_answer_comment with your answer:\n`;
  prompt += `   kanban_answer_comment({ spaceId: "${spaceId}", taskId: "${taskId}", commentId: "${commentId}", answer: "your answer here" })\n`;
  prompt += `4. Do NOT create new files or modify code. Your only job is to answer the question.\n\n`;
  prompt += `IMPORTANT: You must call kanban_answer_comment before exiting. `;
  prompt += `If you cannot answer, call it with "I cannot answer this question — it requires human expertise" so the pipeline can proceed.\n`;

  return prompt;
}

/**
 * Handle resolver agent exit: success or failure.
 *
 * On exit 0: log completion — the resolver called kanban_answer_comment which
 *   already triggered unblockRunByComment. We just clear resolverActive.
 * On exit != 0 or timeout: mark the comment needsHuman=true, clear resolverActive.
 *   The pipeline stays blocked until human intervention.
 *
 * @param {string} dataDir
 * @param {string} runId
 * @param {object} comment    - The question comment that triggered the resolver.
 * @param {number} exitCode   - Resolver process exit code (1 for timeout/forced kill).
 * @param {number} startedAt  - Date.now() when the resolver was spawned.
 * @param {string} [reason]   - 'timeout' if killed by watchdog, otherwise omitted.
 */
function handleResolverClose(dataDir, runId, comment, exitCode, startedAt, reason) {
  const durationMs = Date.now() - startedAt;
  const run = readRun(dataDir, runId);
  if (!run) return;

  // Capture PID before clearing (BUG-002: needed for resolver.timeout log below).
  const resolverPid = run.blockedReason?.resolverPid;

  // Clear the resolver-active flag regardless of outcome.
  run.resolverActive = false;
  if (run.blockedReason) {
    delete run.blockedReason.resolverPid;
    delete run.blockedReason.resolverStartedAt;
  }
  writeRun(dataDir, run);

  if (exitCode === 0 && reason !== 'timeout') {
    pipelineLog('resolver.completed', {
      runId,
      commentId: comment.id,
      targetAgent: comment.targetAgent,
      exitCode,
      durationMs,
      success: true,
    });
    // The resolver called kanban_answer_comment → unblockRunByComment already fired.
    // Nothing more to do here.
  } else {
    // Failure or timeout — escalate to human.
    if (reason === 'timeout') {
      pipelineLog('resolver.timeout', {
        runId,
        commentId: comment.id,
        targetAgent: comment.targetAgent,
        pid: resolverPid,
        timeoutMs: parseInt(process.env.PIPELINE_RESOLVER_TIMEOUT_MS || String(DEFAULT_RESOLVER_TIMEOUT_MS), 10),
      });
    } else {
      pipelineLog('resolver.completed', {
        runId,
        commentId: comment.id,
        targetAgent: comment.targetAgent,
        exitCode,
        durationMs,
        success: false,
      });
    }
    markCommentNeedsHuman(dataDir, run.spaceId, run.taskId, comment.id);
    // Pipeline stays blocked — human must answer via kanban_answer_comment.
  }
}

/**
 * Start polling for resolver agent completion using the done-sentinel pattern.
 * A stripped-down version of startPolling with no stall watchdog (resolvers
 * have no log file to watch) and a shorter default timeout.
 *
 * @param {string} dataDir
 * @param {string} runId
 * @param {object} comment      - The question comment being resolved.
 * @param {string} doneFile     - Path to resolver-<commentId>.done sentinel.
 * @param {number} startedAt    - Date.now() when the resolver was spawned.
 * @param {number} timeoutMs    - Maximum resolver duration before kill.
 * @param {number|null} pid     - Resolver PID (for killing on timeout).
 * @returns {ReturnType<setInterval>}
 */
function startResolverPolling(dataDir, runId, comment, doneFile, startedAt, timeoutMs, pid) {
  const interval = setInterval(() => {
    // --- Done sentinel check ---
    if (fs.existsSync(doneFile)) {
      clearInterval(interval);

      let exitCode = 1;
      try {
        const raw = fs.readFileSync(doneFile, 'utf8').trim();
        exitCode = parseInt(raw, 10);
        if (isNaN(exitCode)) exitCode = 1;
      } catch { /* read error — treat as failure */ }

      pipelineLog('resolver.sentinel_detected', { runId, commentId: comment.id, exitCode });
      handleResolverClose(dataDir, runId, comment, exitCode, startedAt);
      return;
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeoutMs) {
      clearInterval(interval);

      // Kill resolver process group on timeout.
      if (pid && pid !== process.pid) {
        pipelineLog('resolver.kill', { runId, commentId: comment.id, pid, reason: 'timeout' });
        try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ }
      }

      handleResolverClose(dataDir, runId, comment, 1, startedAt, 'timeout');
    }
  }, 2000);

  interval.unref();
  return interval;
}

/**
 * Attempt to resolve a question comment by spawning a target agent.
 * Called from blockRunByComment after the run transitions to 'blocked'.
 *
 * Guards:
 *   1. comment.targetAgent must be present.
 *   2. run.resolverActive must be false (no resolver already running).
 *   3. targetAgent must be in run.stages[].
 *
 * On success: spawns the resolver and sets run.resolverActive=true.
 * On invalid targetAgent: marks comment.needsHuman=true.
 *
 * @param {string} dataDir
 * @param {object} run     - Current run state.
 * @param {object} comment - The question comment with optional targetAgent.
 */
function attemptCrossAgentResolution(dataDir, run, comment) {
  if (!comment.targetAgent) return; // no resolver needed

  // Guard: only one resolver per run at a time.
  if (run.resolverActive === true) {
    pipelineLog('resolver.skipped_already_running', {
      runId:     run.runId,
      commentId: comment.id,
    });
    return;
  }

  // Validate targetAgent is in the pipeline.
  if (!Array.isArray(run.stages) || !run.stages.includes(comment.targetAgent)) {
    pipelineLog('resolver.skipped_invalid_agent', {
      runId:       run.runId,
      commentId:   comment.id,
      targetAgent: comment.targetAgent,
      stages:      run.stages,
    });
    markCommentNeedsHuman(dataDir, run.spaceId, run.taskId, comment.id);
    return;
  }

  const timeoutMs = parseInt(
    process.env.PIPELINE_RESOLVER_TIMEOUT_MS || String(DEFAULT_RESOLVER_TIMEOUT_MS),
    10
  );

  // In test-mode (PIPELINE_NO_SPAWN=1), write the done-sentinel immediately.
  if (process.env.PIPELINE_NO_SPAWN === '1') {
    const doneFile   = resolverDonePath(dataDir, run.runId, comment.id);
    fs.writeFileSync(doneFile, '0', 'utf8');

    // Mark resolver active and persist.
    const freshRun = readRun(dataDir, run.runId);
    if (!freshRun) return;
    freshRun.resolverActive                      = true;
    freshRun.blockedReason                       = freshRun.blockedReason || {};
    freshRun.blockedReason.targetAgent           = comment.targetAgent;
    freshRun.blockedReason.resolverStartedAt     = new Date().toISOString();
    writeRun(dataDir, freshRun);

    const startedAt = Date.now();
    startResolverPolling(dataDir, run.runId, comment, doneFile, startedAt, timeoutMs, null);
    pipelineLog('resolver.started', {
      runId: run.runId, commentId: comment.id, targetAgent: comment.targetAgent, pid: null, mock: true,
    });
    return;
  }

  // Resolve agent spec — may throw AgentNotFoundError.
  const agentsDir = process.env.PIPELINE_AGENTS_DIR;
  let agentSpec;
  try {
    agentSpec = resolveAgent(comment.targetAgent, agentsDir);
  } catch (err) {
    if (err instanceof AgentNotFoundError) {
      pipelineLog('resolver.skipped_invalid_agent', {
        runId: run.runId, commentId: comment.id, targetAgent: comment.targetAgent, reason: 'AGENT_NOT_FOUND',
      });
      markCommentNeedsHuman(dataDir, run.spaceId, run.taskId, comment.id);
      return;
    }
    throw err;
  }

  // Build the resolver prompt.
  const spacesDir = path.join(dataDir, 'spaces');
  const task      = readTaskFromSpace(spacesDir, run.spaceId, run.taskId);
  const promptText = buildResolverPrompt(run, task, comment, dataDir);

  // Persist prompt to disk.
  const promptFilePath = path.join(runDir(dataDir, run.runId), `resolver-${comment.id}-prompt.md`);
  try {
    const tmpPath = promptFilePath + '.tmp';
    fs.writeFileSync(tmpPath, promptText, 'utf8');
    fs.renameSync(tmpPath, promptFilePath);
  } catch (err) {
    console.warn(`[pipelineManager] WARN: could not persist resolver prompt:`, err.message);
  }

  const logPath  = path.join(runDir(dataDir, run.runId), `resolver-${comment.id}.log`);
  const doneFile = resolverDonePath(dataDir, run.runId, comment.id);

  const hasPermissionMode = agentSpec.spawnArgs.includes('--permission-mode');
  const finalArgs = hasPermissionMode
    ? agentSpec.spawnArgs
    : [...agentSpec.spawnArgs, '--permission-mode', 'bypassPermissions'];

  const escapedArgs = finalArgs.map(shellEscape).join(' ');
  const _playwrightCleanup2 = `pkill -f 'ms-playwright' 2>/dev/null; true`;
  const shellCmd    = `${CLAUDE_BIN} ${escapedArgs} < ${shellEscape(promptFilePath)} >> ${shellEscape(logPath)} 2>&1; _EXIT=$?; ${_playwrightCleanup2}; echo $_EXIT > ${shellEscape(doneFile)}`;

  const child = spawn('sh', ['-c', shellCmd], {
    stdio:    'ignore',
    detached: true,
    env:      { ...process.env },
  });
  child.unref();

  if (process.platform === 'darwin' && child.pid) {
    const caff = spawn('caffeinate', ['-w', String(child.pid)], { stdio: 'ignore' });
    caff.unref();
  }

  const startedAt = Date.now();

  // Persist resolver state.
  const freshRun = readRun(dataDir, run.runId);
  if (!freshRun) return;
  freshRun.resolverActive                    = true;
  freshRun.blockedReason                     = freshRun.blockedReason || {};
  freshRun.blockedReason.targetAgent         = comment.targetAgent;
  freshRun.blockedReason.resolverPid         = child.pid;
  freshRun.blockedReason.resolverStartedAt   = new Date().toISOString();
  writeRun(dataDir, freshRun);

  startResolverPolling(dataDir, run.runId, comment, doneFile, startedAt, timeoutMs, child.pid);
  pipelineLog('resolver.started', {
    runId: run.runId, commentId: comment.id, targetAgent: comment.targetAgent, pid: child.pid,
  });

  child.on('error', (err) => {
    pipelineLog('resolver.spawn_error', { runId: run.runId, commentId: comment.id, error: err.message });
    handleResolverClose(dataDir, run.runId, comment, 1, startedAt);
  });
}

// ---------------------------------------------------------------------------
// Comment-driven block/unblock helpers — T-001 (pipeline-blocked)
// ---------------------------------------------------------------------------

/**
 * Search the registry for an active run (pending/running/paused/blocked) for a given taskId.
 * Returns the full run object from disk, or null if no active run exists.
 *
 * @param {string} dataDir
 * @param {string} taskId
 * @returns {object|null}
 */
function findActiveRunByTaskId(dataDir, taskId) {
  const registry = readRegistry(dataDir);
  const ACTIVE_STATUSES = ['pending', 'running', 'paused', 'blocked'];
  const entry = registry.find(
    (r) => r.taskId === taskId && ACTIVE_STATUSES.includes(r.status)
  );
  if (!entry) return null;
  return readRun(dataDir, entry.runId);
}

/**
 * Called from comments handler when a type=question comment is created.
 * Transitions an active run to 'blocked' with blockedReason if the run is
 * between stages (the current stage is not actively running). If the stage is
 * still executing, the guard in handleStageClose will catch it on exit.
 *
 * @param {string} dataDir
 * @param {string} taskId
 * @param {object} comment - The newly created comment object.
 */
function blockRunByComment(dataDir, taskId, comment) {
  const run = findActiveRunByTaskId(dataDir, taskId);
  if (!run) return;
  if (run.status === 'blocked') {
    // Already blocked — anti-recursion guard: if a resolver is active and the
    // new question has a targetAgent, do NOT spawn another resolver.
    if (run.resolverActive === true && comment.targetAgent) {
      pipelineLog('resolver.recursion_blocked', {
        runId:       run.runId,
        commentId:   comment.id,
        targetAgent: comment.targetAgent,
      });
      return; // question persisted but no second resolver spawned
    }
    return;
  }

  // Only block between stages (not mid-execution).
  // "Between stages" means the current stage is pending (not actively running).
  const currentStageStatus = run.stageStatuses[run.currentStage]?.status;
  if (currentStageStatus === 'running') return; // handleStageClose will catch it on exit

  run.status = 'blocked';
  run.blockedReason = {
    commentId:   comment.id,
    taskId,
    author:      comment.author,
    text:        comment.text,
    ...(comment.targetAgent && { targetAgent: comment.targetAgent }),
    blockedAt:   new Date().toISOString(),
  };
  writeRun(dataDir, run);
  pipelineLog('run.blocked', { runId: run.runId, commentId: comment.id, author: comment.author });

  // Attempt cross-agent resolution if the question has a targetAgent.
  if (comment.targetAgent) {
    attemptCrossAgentResolution(dataDir, run, comment);
  }
}

/**
 * Called from comments handler when PATCH resolved=true on a question comment.
 * Checks whether all questions on the task are now resolved. If so, resumes
 * the pipeline. If more remain, updates blockedReason to the next question.
 *
 * @param {string} dataDir
 * @param {string} taskId
 * @param {string} commentId - The ID of the comment that was just resolved.
 */
function unblockRunByComment(dataDir, taskId, commentId) {
  const run = findActiveRunByTaskId(dataDir, taskId);
  if (!run) return;
  if (run.status !== 'blocked') return;

  // Read the task to check remaining unresolved questions.
  // Prefer the SQLite store (post-migration) and fall back to JSON files (legacy / unit tests).
  let task;
  if (_store) {
    task = _store.getTask(run.spaceId, taskId);
  } else {
    const spacesDir = path.join(dataDir, 'spaces');
    task = readTaskFromSpace(spacesDir, run.spaceId, taskId);
  }
  if (!task) return;

  const unresolvedQuestions = (task.comments || []).filter(
    (c) => c.type === 'question' && !c.resolved
  );

  if (unresolvedQuestions.length === 0) {
    // All questions resolved — resume the pipeline.
    run.status = 'running';
    delete run.blockedReason;
    writeRun(dataDir, run);
    pipelineLog('run.unblocked', { runId: run.runId, commentId, reason: 'all_questions_resolved' });
    setImmediate(() => executeNextStage(dataDir, run.runId));
  } else {
    // More questions remain — update blockedReason to the first unresolved one.
    const next = unresolvedQuestions[0];
    run.blockedReason = {
      commentId: next.id,
      taskId,
      author:    next.author,
      text:      next.text,
      ...(next.targetAgent && { targetAgent: next.targetAgent }),
      blockedAt: run.blockedReason?.blockedAt || new Date().toISOString(),
    };
    writeRun(dataDir, run);
    pipelineLog('run.still_blocked', {
      runId:              run.runId,
      resolvedCommentId:  commentId,
      remainingQuestions: unresolvedQuestions.length,
    });
    // BUG-001: if the next question also has a targetAgent, spawn its resolver.
    if (next.targetAgent && !run.resolverActive) {
      const freshRun = readRun(dataDir, run.runId);
      if (freshRun) attemptCrossAgentResolution(dataDir, freshRun, next);
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * Resume an interrupted or failed pipeline run from a given stage.
 *
 * Marks any stale 'running' stages before fromStage as 'completed', resets
 * stages at and after fromStage to 'pending', then kicks off execution.
 *
 * @param {string} runId
 * @param {string} dataDir
 * @param {object} [opts]
 * @param {number} [opts.fromStage] - Zero-based stage index to resume from.
 *   Defaults to the first stage whose status is not 'completed'.
 * @returns {Promise<object>} Updated run state.
 * @throws On validation failure (RUN_NOT_FOUND, RUN_NOT_RESUMABLE).
 */
async function resumeRun(runId, dataDir, { fromStage } = {}) {
  const run = readRun(dataDir, runId);
  if (!run) {
    const err = new Error(`Run '${runId}' not found.`);
    err.code = 'RUN_NOT_FOUND';
    throw err;
  }

  if (!['interrupted', 'failed', 'paused', 'blocked'].includes(run.status)) {
    const err = new Error(`Run '${runId}' has status '${run.status}' and cannot be resumed. Only interrupted, failed, paused, or blocked runs can be resumed.`);
    err.code = 'RUN_NOT_RESUMABLE';
    throw err;
  }

  const wasBlocked = run.status === 'blocked';

  // Determine resume index.
  let resumeIndex;
  if (fromStage !== undefined) {
    if (!Number.isInteger(fromStage) || fromStage < 0 || fromStage >= run.stages.length) {
      const err = new Error(`fromStage must be an integer between 0 and ${run.stages.length - 1}.`);
      err.code = 'INVALID_FROM_STAGE';
      throw err;
    }
    resumeIndex = fromStage;
  } else {
    // Default: first stage that is not 'completed'.
    resumeIndex = run.stageStatuses.findIndex((s) => s.status !== 'completed');
    if (resumeIndex === -1) resumeIndex = run.stages.length; // all done — will complete immediately
  }

  // Fix any stale 'running' stages before the resume point — assume they completed.
  for (let i = 0; i < resumeIndex; i++) {
    if (run.stageStatuses[i].status === 'running') {
      run.stageStatuses[i].status     = 'completed';
      run.stageStatuses[i].exitCode   = 0;
      run.stageStatuses[i].finishedAt = new Date().toISOString();
    }
  }

  // Reset stages from resumeIndex onwards to pending.
  // Also delete any leftover done-sentinel files so the poller doesn't
  // immediately fire on a stale file from a previous run of the same stage.
  for (let i = resumeIndex; i < run.stages.length; i++) {
    run.stageStatuses[i].status     = 'pending';
    run.stageStatuses[i].exitCode   = null;
    run.stageStatuses[i].startedAt  = null;
    run.stageStatuses[i].finishedAt = null;
    const staleFile = stageDonePath(dataDir, run.runId, i);
    try { fs.unlinkSync(staleFile); } catch { /* not present — fine */ }
  }

  run.currentStage       = resumeIndex;
  run.status             = 'running';
  delete run.pausedBeforeStage;
  delete run.blockedReason;
  // Always clear bypassQuestionCheck first so it cannot leak from a prior blocked resume
  // into a subsequent non-blocked resume (e.g. blocked → resumed → interrupted → resumed).
  delete run.bypassQuestionCheck;
  // When manually resuming a previously-blocked run, skip future question checks
  // so the pipeline runs to completion regardless of any remaining open questions.
  if (wasBlocked) {
    run.bypassQuestionCheck = true;
  }
  writeRun(dataDir, run);

  pipelineLog('run.resumed', { runId, resumeIndex, agentId: run.stages[resumeIndex] });

  setImmediate(() => executeNextStage(dataDir, runId));

  return run;
}

/**
 * Get the full run state for a given runId.
 *
 * @param {string} runId
 * @param {string} dataDir
 * @returns {Promise<object|null>}
 */
async function getRun(runId, dataDir) {
  return readRun(dataDir, runId);
}

/**
 * List all run summaries from the registry.
 *
 * @param {string} dataDir
 * @returns {Promise<object[]>}
 */
async function listRuns(dataDir) {
  return readRegistry(dataDir);
}

/**
 * Stop a running pipeline: send SIGTERM to the active process, mark the run
 * as `interrupted`, and persist the updated state.
 *
 * Unlike deleteRun, the run directory and state are preserved so the run can
 * be inspected and resumed later with resumeRun.
 *
 * @param {string} runId
 * @param {string} dataDir
 * @returns {object} The updated run object, or null if the run does not exist.
 */
async function stopRun(runId, dataDir) {
  const run = readRun(dataDir, runId);
  if (!run) return null;

  if (activeProcesses.has(runId)) {
    const { interval, stageIndex } = activeProcesses.get(runId);
    clearInterval(interval);
    activeProcesses.delete(runId);

    // Kill by PID stored in run.json (never signal the current process itself).
    const pid = run.stageStatuses[stageIndex] && run.stageStatuses[stageIndex].pid;
    if (pid && pid !== process.pid) {
      pipelineLog('run.stopped', { runId, pid, stageIndex });
      try { process.kill(-pid, 'SIGTERM'); } catch { /* process may already be gone */ }
    }

    // Mark the currently-running stage as interrupted.
    if (run.stageStatuses[stageIndex] && run.stageStatuses[stageIndex].status === 'running') {
      run.stageStatuses[stageIndex].status     = 'interrupted';
      run.stageStatuses[stageIndex].finishedAt = new Date().toISOString();
    }
  }

  run.status = 'interrupted';
  writeRun(dataDir, run);

  // Teardown worktree if this run used one (parallel-worktrees).
  finalizeRun(dataDir, run).catch((err) => {
    pipelineLog('worktree.error', { runId, op: 'finalize_stop', message: err.message });
  });

  return run;
}

/**
 * Block a pipeline run due to an open question comment.
 *
 * Sets run.status = 'blocked'. The current stage subprocess continues running
 * (it is NOT killed). When the stage finishes, handleStageClose will see
 * 'blocked' status and will not advance to the next stage.
 *
 * Valid transition: running/pending/paused → blocked.
 * Terminal states (completed, failed, interrupted) cannot be blocked.
 *
 * @param {string} runId
 * @param {string} dataDir
 * @returns {object|null} Updated run, or null if not found.
 */
async function blockRun(runId, dataDir) {
  const run = readRun(dataDir, runId);
  if (!run) return null;

  const TERMINAL_STATES = ['completed', 'failed', 'interrupted'];
  if (TERMINAL_STATES.includes(run.status)) {
    const err = new Error(`Run '${runId}' is in terminal state '${run.status}' and cannot be blocked.`);
    err.code = 'RUN_IN_TERMINAL_STATE';
    throw err;
  }

  if (run.status === 'blocked') {
    // Already blocked — idempotent success.
    return run;
  }

  run.status = 'blocked';
  writeRun(dataDir, run);
  pipelineLog('run.blocked', { runId, spaceId: run.spaceId, taskId: run.taskId });
  return run;
}

/**
 * Unblock a pipeline run after all question comments have been resolved.
 *
 * Sets run.status back to 'running' and, if the current stage has already
 * completed (status 'completed'), calls executeNextStage to advance the
 * pipeline. If the current stage is still running, just unblocking the
 * status is enough — handleStageClose will advance naturally when it finishes.
 *
 * Valid transition: blocked → running.
 *
 * @param {string} runId
 * @param {string} dataDir
 * @returns {object|null} Updated run, or null if not found.
 */
async function unblockRun(runId, dataDir) {
  const run = readRun(dataDir, runId);
  if (!run) return null;

  if (run.status !== 'blocked') {
    const err = new Error(`Run '${runId}' is not blocked (status: '${run.status}').`);
    err.code = 'RUN_NOT_BLOCKED';
    throw err;
  }

  run.status = 'running';
  delete run.blockedReason;
  writeRun(dataDir, run);
  pipelineLog('run.unblocked', { runId, spaceId: run.spaceId, taskId: run.taskId, currentStage: run.currentStage });

  // If the current stage has already completed (e.g. the agent exited before the
  // question was answered), resume the pipeline from the next stage.
  const currentStageStatus = run.stageStatuses[run.currentStage];
  const stageAlreadyDone = !currentStageStatus || currentStageStatus.status === 'completed';
  if (stageAlreadyDone) {
    await executeNextStage(dataDir, runId);
  }
  // Otherwise the stage is still running — it will call handleStageClose when
  // it exits and executeNextStage will be called then.

  return run;
}

/**
 * Delete a run: send SIGTERM to active process, remove run directory,
 * and remove entry from runs.json.
 *
 * @param {string} runId
 * @param {string} dataDir
 * @returns {Promise<void>}
 */
async function deleteRun(runId, dataDir) {
  // Clear polling interval and kill by PID if running.
  if (activeProcesses.has(runId)) {
    const { interval, stageIndex } = activeProcesses.get(runId);
    clearInterval(interval);
    activeProcesses.delete(runId);

    const run = readRun(dataDir, runId);
    const pid = run && run.stageStatuses[stageIndex] && run.stageStatuses[stageIndex].pid;
    if (pid && pid !== process.pid) {
      pipelineLog('run.aborted', { runId, pid, stageIndex });
      try { process.kill(-pid, 'SIGTERM'); } catch { /* process may already be gone */ }
    }

    // Teardown worktree on abort (parallel-worktrees).
    if (run) {
      run.status = 'aborted';
      await finalizeRun(dataDir, run);
    }
  }

  // Remove run directory.
  const dir = runDir(dataDir, runId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // Remove from registry.
  removeRegistryEntry(dataDir, runId);
}

/**
 * Kill all active pipeline processes. Intended for test teardown to prevent
 * spawned claude subprocesses from outliving the test and contaminating the
 * environment (e.g. starting a new node server.js with test env vars).
 *
 * @param {string} dataDir
 * @returns {Promise<void>}
 */
async function abortAll(dataDir) {
  const runIds = [...activeProcesses.keys()];
  await Promise.all(runIds.map((runId) => deleteRun(runId, dataDir).catch(() => {})));
}

/**
 * Returns the number of currently active (running) pipeline processes.
 * Used by the graceful shutdown handler in server.js.
 *
 * @returns {number}
 */
function getActiveProcessCount() {
  return activeProcesses.size;
}

module.exports = {
  init,
  createRun,
  resumeRun,
  blockRun,
  unblockRun,
  // Comment-driven block/unblock (pipeline-blocked feature):
  findActiveRunByTaskId,
  blockRunByComment,
  unblockRunByComment,
  getRun,
  listRuns,
  stopRun,
  deleteRun,
  abortAll,
  getActiveProcessCount,
  // Cross-agent question resolver (cross-agent-questions feature):
  attemptCrossAgentResolution,
  handleResolverClose,
  markCommentNeedsHuman,
  // Parallel-worktrees helpers (exported for testing):
  hasActiveRunInDir,
  effectiveCwd,
  finalizeRun,
  // Exported for testing and preview endpoint:
  runsDir,
  runDir,
  stageLogPath,
  stagePromptPath,
  stageDonePath,
  resolverDonePath,
  stageInjectPath,
  readInjectSignal,
  buildStagePrompt,
  buildResolverPrompt,
  shellEscape,
  DEFAULT_STAGES,
  getStore: () => _store,
};
