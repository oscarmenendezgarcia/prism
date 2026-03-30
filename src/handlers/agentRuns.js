'use strict';

/**
 * Agent run history handlers — ADR-1 (Agent Run History)
 *
 * Persistence: data/agent-runs.jsonl — one JSON object per line.
 * Max 500 entries enforced at POST time (prune oldest on overflow).
 * Atomic rewrites use .tmp + renameSync.
 *
 * Routes:
 *   GET   /api/v1/agent-runs           → handleListAgentRuns
 *   POST  /api/v1/agent-runs           → handleCreateAgentRun
 *   PATCH /api/v1/agent-runs/:runId    → handleUpdateAgentRun
 */

const fs   = require('fs');
const path = require('path');

const { sendJSON, sendError, parseBody } = require('../utils/http');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_RUNS_MAX_ENTRIES  = 500;
const STALE_THRESHOLD_MS      = 4 * 60 * 60 * 1000; // 4 hours
const VALID_TERMINAL_STATUSES = ['completed', 'cancelled', 'failed'];
const VALID_RUN_STATUSES      = ['running', 'completed', 'cancelled', 'failed'];

/** Route patterns (compiled once at module load). */
const AGENT_RUNS_LIST_ROUTE   = /^\/api\/v1\/agent-runs$/;
const AGENT_RUNS_SINGLE_ROUTE = /^\/api\/v1\/agent-runs\/([^/]+)$/;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/**
 * Read all run records from the JSONL file. Returns [] if file does not exist.
 *
 * @param {string} dataDir
 * @returns {object[]}
 */
function readAgentRuns(dataDir) {
  const filePath = path.join(dataDir, 'agent-runs.jsonl');
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw   = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    return lines.map((l) => JSON.parse(l));
  } catch (err) {
    console.error('[agent-runs] ERROR reading agent-runs.jsonl:', err.message);
    return [];
  }
}

/**
 * Overwrite the JSONL file atomically using .tmp + renameSync.
 *
 * @param {string}   dataDir
 * @param {object[]} records
 */
function writeAgentRuns(dataDir, records) {
  const filePath = path.join(dataDir, 'agent-runs.jsonl');
  const tmpPath  = filePath + '.tmp';
  const content  = records.map((r) => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '');
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/agent-runs
 * Append a new run record (status=running) to data/agent-runs.jsonl.
 * Prunes to 500 entries if the file would exceed the limit.
 */
async function handleCreateAgentRun(req, res, dataDir) {
  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  if (!body || typeof body !== 'object') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
  }

  const requiredFields = ['id', 'taskId', 'taskTitle', 'agentId', 'agentDisplayName',
                          'spaceId', 'spaceName', 'cliCommand', 'promptPath', 'startedAt'];

  for (const field of requiredFields) {
    if (!body[field] || typeof body[field] !== 'string') {
      return sendError(res, 400, 'VALIDATION_ERROR',
        `The '${field}' field is required and must be a non-empty string.`,
        { field });
    }
  }

  if (isNaN(Date.parse(body.startedAt))) {
    return sendError(res, 400, 'VALIDATION_ERROR',
      'The start time must be a valid ISO 8601 timestamp.',
      { field: 'startedAt' });
  }

  const record = {
    id:               body.id,
    taskId:           body.taskId,
    taskTitle:        body.taskTitle,
    agentId:          body.agentId,
    agentDisplayName: body.agentDisplayName,
    spaceId:          body.spaceId,
    spaceName:        body.spaceName,
    status:           'running',
    startedAt:        body.startedAt,
    completedAt:      null,
    durationMs:       null,
    cliCommand:       body.cliCommand,
    promptPath:       body.promptPath,
  };

  try {
    const filePath = path.join(dataDir, 'agent-runs.jsonl');

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');

    const allLines = fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);

    if (allLines.length > AGENT_RUNS_MAX_ENTRIES) {
      const pruned  = allLines.slice(allLines.length - AGENT_RUNS_MAX_ENTRIES);
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, pruned.join('\n') + '\n', 'utf8');
      fs.renameSync(tmpPath, filePath);
    }

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level:     'info',
      component: 'agent-runs',
      event:     'run_created',
      runId:     record.id,
      status:    record.status,
    }));

    sendJSON(res, 201, { id: record.id });
  } catch (err) {
    console.error('[agent-runs] ERROR creating run:', err.message);
    sendError(res, 500, 'STORAGE_ERROR',
      'Could not save the run record. The run may not appear in history.',
      { suggestion: 'Check that the data/ directory is writable.' });
  }
}

/**
 * PATCH /api/v1/agent-runs/:runId
 * Update the status of an existing run record.
 */
async function handleUpdateAgentRun(req, res, dataDir, runId) {
  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  if (!body || typeof body !== 'object') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
  }

  if (!body.status || !VALID_TERMINAL_STATUSES.includes(body.status)) {
    return sendError(res, 400, 'VALIDATION_ERROR',
      "The status value is not valid for an update. Use one of: completed, cancelled, failed.",
      { field: 'status' });
  }

  if (!body.completedAt || typeof body.completedAt !== 'string' || isNaN(Date.parse(body.completedAt))) {
    return sendError(res, 400, 'VALIDATION_ERROR',
      'A completion timestamp is required.',
      { field: 'completedAt' });
  }

  if (body.durationMs === undefined || body.durationMs === null || typeof body.durationMs !== 'number') {
    return sendError(res, 400, 'VALIDATION_ERROR',
      'The run duration in milliseconds is required.',
      { field: 'durationMs' });
  }

  try {
    const records = readAgentRuns(dataDir);
    const idx     = records.findIndex((r) => r.id === runId);

    if (idx === -1) {
      return sendError(res, 404, 'RUN_NOT_FOUND',
        'No agent run was found with the given ID.',
        { suggestion: 'Check that the run ID is correct.' });
    }

    records[idx] = {
      ...records[idx],
      status:      body.status,
      completedAt: body.completedAt,
      durationMs:  body.durationMs,
    };

    writeAgentRuns(dataDir, records);

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level:     'info',
      component: 'agent-runs',
      event:     'run_updated',
      runId,
      status:    body.status,
    }));

    sendJSON(res, 200, { id: runId, status: body.status });
  } catch (err) {
    console.error(`[agent-runs] ERROR updating run ${runId}:`, err.message);
    sendError(res, 500, 'STORAGE_ERROR',
      'Could not update the run record. The status may not have changed in history.',
      { suggestion: 'Check that the data/ directory is writable.' });
  }
}

/**
 * GET /api/v1/agent-runs
 * Return run history newest-first with optional status filter and limit.
 * Applies stale-run healing at read time (running > 4h → failed, not persisted).
 */
function handleListAgentRuns(req, res, dataDir) {
  const urlObj       = new URL(req.url, 'http://localhost');
  const statusFilter = urlObj.searchParams.get('status') || null;
  const limitParam   = urlObj.searchParams.get('limit');

  if (statusFilter !== null && !VALID_RUN_STATUSES.includes(statusFilter)) {
    return sendError(res, 400, 'VALIDATION_ERROR',
      'The status filter value is not valid.',
      { suggestion: 'Use one of: running, completed, cancelled, failed.', field: 'status' });
  }

  let limit = 100;
  if (limitParam !== null) {
    limit = parseInt(limitParam, 10);
    if (isNaN(limit) || limit < 1 || limit > AGENT_RUNS_MAX_ENTRIES) {
      return sendError(res, 400, 'VALIDATION_ERROR',
        'The limit must be between 1 and 500.',
        { suggestion: 'Use a number between 1 and 500. The default is 100.', field: 'limit' });
    }
  }

  try {
    const records = readAgentRuns(dataDir);
    const now     = Date.now();

    // Apply stale healing (read-time only — does NOT mutate the file)
    const healed = records.map((r) => {
      if (r.status === 'running' && (now - Date.parse(r.startedAt)) > STALE_THRESHOLD_MS) {
        return { ...r, status: 'failed', reason: 'stale' };
      }
      return r;
    });

    const newestFirst = [...healed].reverse();
    const filtered    = statusFilter ? newestFirst.filter((r) => r.status === statusFilter) : newestFirst;
    const total       = filtered.length;
    const runs        = filtered.slice(0, limit);

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level:     'info',
      component: 'agent-runs',
      event:     'runs_listed',
      total,
      limit,
      statusFilter,
    }));

    sendJSON(res, 200, { runs, total });
  } catch (err) {
    console.error('[agent-runs] ERROR listing runs:', err.message);
    sendError(res, 500, 'STORAGE_ERROR', 'Could not load run history.',
      { suggestion: 'Check that data/agent-runs.jsonl exists and is readable.' });
  }
}

module.exports = {
  AGENT_RUNS_LIST_ROUTE,
  AGENT_RUNS_SINGLE_ROUTE,
  readAgentRuns,
  writeAgentRuns,
  handleCreateAgentRun,
  handleUpdateAgentRun,
  handleListAgentRuns,
};
