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
 *   PIPELINE_STAGE_TIMEOUT_MS  - Kill timeout per stage (default: 600000)
 *   PIPELINE_MAX_CONCURRENT    - Max active runs (default: 5)
 *   PIPELINE_RUNS_DIR          - Override runs directory
 *   PIPELINE_AGENT_MODE        - 'subagent' (default) or 'headless'
 *   PIPELINE_AGENTS_DIR        - Override agents directory
 */

'use strict';

const fs           = require('fs');
const path         = require('path');
const crypto       = require('crypto');
const { spawn }    = require('child_process');

const { resolveAgent, AgentNotFoundError } = require('./agentResolver');

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

const DEFAULT_STAGE_TIMEOUT_MS = 3_600_000; // 1 hour
const DEFAULT_MAX_CONCURRENT   = 5;

// ---------------------------------------------------------------------------
// Module-level state (in-process registry of active child processes)
// ---------------------------------------------------------------------------

/** Map<runId, { process: ChildProcess, stageIndex: number }> */
const activeProcesses = new Map();

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

  // Check if all stages have completed.
  if (run.currentStage >= run.stages.length) {
    run.status = 'completed';
    writeRun(dataDir, run);
    pipelineLog('run.completed', { runId, totalDurationMs: Date.now() - new Date(run.createdAt).getTime() });
    await moveKanbanTask(run.spaceId, run.taskId, 'done');
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
  const agentId   = run.stages[stageIndex];
  const agentsDir = process.env.PIPELINE_AGENTS_DIR;
  const baseTimeout = parseInt(process.env.PIPELINE_STAGE_TIMEOUT_MS || String(DEFAULT_STAGE_TIMEOUT_MS), 10);
  // Orchestrator coordinates the full pipeline internally — give it 6× the per-stage timeout.
  const timeoutMs = agentId === 'orchestrator' ? baseTimeout * 6 : baseTimeout;

  // Resolve spawn args — may throw AgentNotFoundError.
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

  // Update stage state to running.
  run.status = 'running';
  run.stageStatuses[stageIndex].status    = 'running';
  run.stageStatuses[stageIndex].startedAt = new Date().toISOString();
  writeRun(dataDir, run);

  pipelineLog('stage.started', { runId: run.runId, stageIndex, agentId });

  // Build the task prompt to pass via stdin.
  const task = readTaskFromSpace(dataDir, run.spaceId, run.taskId);
  let taskPrompt = task
    ? `Task: ${task.title}\n${task.description ? `Description: ${task.description}\n` : ''}TaskId: ${task.id}\nSpaceId: ${run.spaceId}\n`
    : `TaskId: ${run.taskId}\nSpaceId: ${run.spaceId}\n`;

  // Include artifact paths from previous stages (attached to the task by earlier agents).
  // This gives each stage full context of what was produced before it.
  if (task && Array.isArray(task.attachments) && task.attachments.length > 0) {
    const fileArtifacts = task.attachments.filter((a) => a.type === 'file' && a.content);
    if (fileArtifacts.length > 0) {
      taskPrompt += '\n## ARTIFACTS FROM PREVIOUS STAGES\n';
      taskPrompt += 'The following files were produced by earlier pipeline stages. Read them before starting your work:\n';
      for (const att of fileArtifacts) {
        taskPrompt += `- ${att.name}: ${att.content}\n`;
      }
    }
  }

  const logPath   = stageLogPath(dataDir, run.runId, stageIndex);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  const child = spawn('claude', agentSpec.spawnArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env:   { ...process.env },
  });

  // Write task context to stdin and close so claude receives the prompt.
  child.stdin.write(taskPrompt);
  child.stdin.end();

  activeProcesses.set(run.runId, { process: child, stageIndex });

  // Pipe stdout and stderr to log file.
  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });

  const stageStartMs = Date.now();

  // Enforce stage timeout.
  const timer = setTimeout(() => {
    child.kill('SIGTERM');
    const currentRun = readRun(dataDir, run.runId);
    if (currentRun) {
      currentRun.stageStatuses[stageIndex].status     = 'timeout';
      currentRun.stageStatuses[stageIndex].exitCode   = null;
      currentRun.stageStatuses[stageIndex].finishedAt = new Date().toISOString();
      currentRun.status = 'failed';
      writeRun(dataDir, currentRun);
    }
    pipelineLog('stage.timeout', { runId: run.runId, stageIndex, agentId, timeoutMs });
  }, timeoutMs);

  child.on('close', async (code) => {
    clearTimeout(timer);
    logStream.end();
    activeProcesses.delete(run.runId);

    const durationMs    = Date.now() - stageStartMs;
    const currentRun    = readRun(dataDir, run.runId);

    // Guard: run may have been deleted or interrupted while the stage ran.
    if (!currentRun) return;

    // Guard: if timeout already fired, stageStatus is 'timeout' — don't overwrite.
    if (currentRun.stageStatuses[stageIndex].status === 'timeout') return;

    currentRun.stageStatuses[stageIndex].exitCode   = code;
    currentRun.stageStatuses[stageIndex].finishedAt = new Date().toISOString();

    if (code !== 0) {
      currentRun.stageStatuses[stageIndex].status = 'failed';
      currentRun.status = 'failed';
      writeRun(dataDir, currentRun);
      pipelineLog('run.failed', { runId: run.runId, stageIndex, agentId, exitCode: code });
    } else {
      currentRun.stageStatuses[stageIndex].status = 'completed';
      currentRun.currentStage = stageIndex + 1;
      writeRun(dataDir, currentRun);
      pipelineLog('stage.done', { runId: run.runId, stageIndex, agentId, exitCode: code, durationMs });
      await executeNextStage(dataDir, run.runId);
    }
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
function init(dataDir) {
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

  for (const entry of entries) {
    const runJsonFile = path.join(dir, entry, 'run.json');
    if (!fs.existsSync(runJsonFile)) continue;
    try {
      const run = JSON.parse(fs.readFileSync(runJsonFile, 'utf8'));
      if (run && run.status === 'running') {
        run.status    = 'interrupted';
        run.updatedAt = new Date().toISOString();
        writeJSON(runJsonFile, run);
        upsertRegistryEntry(dataDir, { runId: run.runId, spaceId: run.spaceId, taskId: run.taskId, status: 'interrupted', createdAt: run.createdAt, updatedAt: run.updatedAt });
        console.warn(`[pipelineManager] WARN: run ${run.runId} was interrupted (server restart)`);
      }
    } catch (err) {
      console.warn(`[pipelineManager] WARN: could not process run entry '${entry}':`, err.message);
    }
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
async function createRun({ spaceId, taskId, stages, dataDir }) {
  const stageList = stages && stages.length > 0 ? stages : DEFAULT_STAGES;

  // --- Validate task exists and is in 'todo'. ---
  const taskResult = findTaskInDataDir(spaceId, taskId, dataDir);
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

  // --- Build initial run state. ---
  const runId     = crypto.randomUUID();
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
 * Delete a run: send SIGTERM to active process, remove run directory,
 * and remove entry from runs.json.
 *
 * @param {string} runId
 * @param {string} dataDir
 * @returns {Promise<void>}
 */
async function deleteRun(runId, dataDir) {
  // Send SIGTERM to active process if running.
  if (activeProcesses.has(runId)) {
    const { process: child } = activeProcesses.get(runId);
    try { child.kill('SIGTERM'); } catch { /* process may already be gone */ }
    activeProcesses.delete(runId);
  }

  // Remove run directory.
  const dir = runDir(dataDir, runId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // Remove from registry.
  removeRegistryEntry(dataDir, runId);
}

module.exports = {
  init,
  createRun,
  getRun,
  listRuns,
  deleteRun,
  // Exported for testing:
  runsDir,
  runDir,
  stageLogPath,
  DEFAULT_STAGES,
};
