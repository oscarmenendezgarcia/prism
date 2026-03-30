'use strict';

/**
 * Pipeline run route handlers — ADR-1 (mcp-start-pipeline)
 *
 * Routes:
 *   POST   /api/v1/runs                               → handleCreateRun
 *   GET    /api/v1/runs/:runId                         → handleGetRun
 *   GET    /api/v1/runs/:runId/stages/:stageIndex/log  → handleGetStageLog
 *   DELETE /api/v1/runs/:runId                         → handleDeleteRun
 */

const fs = require('fs');

const { sendJSON, sendError, parseBody } = require('../utils/http');
const pipelineManager                    = require('../pipelineManager');

// ---------------------------------------------------------------------------
// Route patterns (compiled once at module load)
// ---------------------------------------------------------------------------

const PIPELINE_RUNS_LIST_ROUTE   = /^\/api\/v1\/runs$/;
const PIPELINE_RUNS_SINGLE_ROUTE = /^\/api\/v1\/runs\/([^/]+)$/;
const PIPELINE_RUNS_LOG_ROUTE    = /^\/api\/v1\/runs\/([^/]+)\/stages\/(\d+)\/log$/;

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/runs
 * Create and kick off a new pipeline run.
 * Body: { spaceId, taskId, stages? }
 * When stages is omitted, falls back to the space's default pipeline, then
 * the pipelineManager default.
 */
async function handleCreateRun(req, res, dataDir, spaceManager) {
  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  if (!body || typeof body !== 'object') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
  }

  const { spaceId, taskId, stages } = body;

  if (!spaceId || typeof spaceId !== 'string') {
    return sendError(res, 400, 'VALIDATION_ERROR', "The 'spaceId' field is required.");
  }
  if (!taskId || typeof taskId !== 'string') {
    return sendError(res, 400, 'VALIDATION_ERROR', "The 'taskId' field is required.");
  }
  if (stages !== undefined && !Array.isArray(stages)) {
    return sendError(res, 400, 'VALIDATION_ERROR', "The 'stages' field must be an array when provided.");
  }

  // Resolve stages: explicit body > space.pipeline > pipelineManager default
  let resolvedStages = stages;
  if (!resolvedStages || resolvedStages.length === 0) {
    const spaceResult = spaceManager.getSpace(spaceId);
    if (spaceResult.ok && Array.isArray(spaceResult.space.pipeline) && spaceResult.space.pipeline.length > 0) {
      resolvedStages = spaceResult.space.pipeline;
    }
  }

  try {
    const run = await pipelineManager.createRun({ spaceId, taskId, stages: resolvedStages, dataDir });
    return sendJSON(res, 201, run);
  } catch (err) {
    if (err.code === 'TASK_NOT_FOUND')        return sendError(res, 404, err.code, err.message);
    if (err.code === 'TASK_NOT_IN_TODO')       return sendError(res, 422, err.code, err.message);
    if (err.code === 'MAX_CONCURRENT_REACHED') return sendError(res, 409, err.code, err.message);
    if (err.code === 'AGENT_NOT_FOUND')        return sendError(res, 422, err.code, err.message);
    console.error('[pipeline] ERROR creating run:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
}

/**
 * GET /api/v1/runs/:runId
 * Return the full run state, or 404 if not found.
 */
async function handleGetRun(req, res, runId, dataDir) {
  const run = await pipelineManager.getRun(runId, dataDir);
  if (!run) {
    return sendError(res, 404, 'RUN_NOT_FOUND', `Run '${runId}' not found.`);
  }
  return sendJSON(res, 200, run);
}

/**
 * GET /api/v1/runs/:runId/stages/:stageIndex/log?tail=200
 * Return the log file content for a specific stage.
 */
async function handleGetStageLog(req, res, runId, stageIndex, dataDir) {
  const run = await pipelineManager.getRun(runId, dataDir);
  if (!run) {
    return sendError(res, 404, 'RUN_NOT_FOUND', `Run '${runId}' not found.`);
  }

  if (stageIndex < 0 || stageIndex >= run.stages.length) {
    return sendError(res, 404, 'STAGE_NOT_FOUND', `Stage ${stageIndex} does not exist in run '${runId}'.`);
  }

  const logPath = pipelineManager.stageLogPath(dataDir, runId, stageIndex);
  if (!fs.existsSync(logPath)) {
    return sendError(res, 404, 'LOG_NOT_AVAILABLE', `Log for stage ${stageIndex} of run '${runId}' is not yet available.`);
  }

  try {
    const urlObj   = new URL(req.url, 'http://x');
    const tailParam = urlObj.searchParams.get('tail');
    const tailN    = tailParam ? parseInt(tailParam, 10) : 0;

    const content = fs.readFileSync(logPath, 'utf8');
    let output    = content;

    if (tailN > 0) {
      const lines = content.split('\n');
      output = lines.slice(Math.max(0, lines.length - tailN)).join('\n');
    }

    const buf = Buffer.from(output, 'utf8');
    res.writeHead(200, {
      'Content-Type':   'text/plain; charset=utf-8',
      'Content-Length': buf.length,
    });
    res.end(buf);
  } catch (err) {
    console.error(`[pipeline] ERROR reading log for run ${runId} stage ${stageIndex}:`, err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read stage log file');
  }
}

/**
 * DELETE /api/v1/runs/:runId
 * Cancel and remove a run. Sends SIGTERM to any active stage process.
 */
async function handleDeleteRun(req, res, runId, dataDir) {
  const run = await pipelineManager.getRun(runId, dataDir);
  if (!run) {
    return sendError(res, 404, 'RUN_NOT_FOUND', `Run '${runId}' not found.`);
  }

  try {
    await pipelineManager.deleteRun(runId, dataDir);
    return sendJSON(res, 200, { deleted: true, runId });
  } catch (err) {
    console.error(`[pipeline] ERROR deleting run ${runId}:`, err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
}

module.exports = {
  PIPELINE_RUNS_LIST_ROUTE,
  PIPELINE_RUNS_SINGLE_ROUTE,
  PIPELINE_RUNS_LOG_ROUTE,
  handleCreateRun,
  handleGetRun,
  handleGetStageLog,
  handleDeleteRun,
};
