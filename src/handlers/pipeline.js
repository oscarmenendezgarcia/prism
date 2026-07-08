'use strict';

/**
 * Pipeline run route handlers — ADR-1 (mcp-start-pipeline)
 *
 * Routes:
 *   POST   /api/v1/runs                                              → handleCreateRun
 *   POST   /api/v1/runs/preview-prompts                              → handlePreviewPrompts
 *   GET    /api/v1/runs/:runId                                        → handleGetRun
 *   GET    /api/v1/runs/:runId/stages/:stageIndex/log                → handleGetStageLog
 *   GET    /api/v1/runs/:runId/stages/:stageIndex/metrics            → handleGetStageMetrics
 *   GET    /api/v1/runs/:runId/stages/:stageIndex/prompt             → handleGetStagePrompt
 *   DELETE /api/v1/runs/:runId                                        → handleDeleteRun
 */

const fs   = require('fs');
const path = require('path');

const { sendJSON, sendError, parseBody } = require('../utils/http');
const pipelineManager                    = require('../services/pipelineManager');
const { resolveAgent, AgentNotFoundError } = require('../services/agentResolver');
const { parseStageLog, parseStageEvents } = require('../services/logMetrics');

// ---------------------------------------------------------------------------
// Route patterns (compiled once at module load)
// NOTE: more-specific routes must be checked BEFORE more-general ones.
//   - METRICS_ROUTE and LOG_ROUTE must come before SINGLE_ROUTE
//   - PREVIEW_ROUTE must come before LIST_ROUTE
// ---------------------------------------------------------------------------

const PIPELINE_RUNS_LIST_ROUTE    = /^\/api\/v1\/runs$/;
const PIPELINE_RUNS_SINGLE_ROUTE  = /^\/api\/v1\/runs\/([^/]+)$/;
const PIPELINE_RUNS_LOG_ROUTE     = /^\/api\/v1\/runs\/([^/]+)\/stages\/(\d+)\/log$/;
const PIPELINE_RUNS_METRICS_ROUTE = /^\/api\/v1\/runs\/([^/]+)\/stages\/([^/]+)\/metrics$/;
const PIPELINE_RUNS_EVENTS_ROUTE  = /^\/api\/v1\/runs\/([^/]+)\/stages\/(\d+)\/events$/;
const PIPELINE_RUNS_PROMPT_ROUTE  = /^\/api\/v1\/runs\/([^/]+)\/stages\/(\d+)\/prompt$/;
const PIPELINE_RUNS_PREVIEW_ROUTE = /^\/api\/v1\/runs\/preview-prompts$/;
const PIPELINE_RUNS_RESUME_ROUTE  = /^\/api\/v1\/runs\/([^/]+)\/resume$/;
const PIPELINE_RUNS_STOP_ROUTE    = /^\/api\/v1\/runs\/([^/]+)\/stop$/;
const PIPELINE_RUNS_BLOCK_ROUTE   = /^\/api\/v1\/runs\/([^/]+)\/block$/;
const PIPELINE_RUNS_UNBLOCK_ROUTE = /^\/api\/v1\/runs\/([^/]+)\/unblock$/;

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/runs
 * Create and kick off a new pipeline run.
 * Body: { spaceId, taskId, stages?, dangerouslySkipPermissions? }
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

  const { spaceId, taskId, stages, dangerouslySkipPermissions, checkpoints } = body;

  if (!spaceId || typeof spaceId !== 'string') {
    return sendError(res, 400, 'VALIDATION_ERROR', "The 'spaceId' field is required.");
  }
  if (!taskId || typeof taskId !== 'string') {
    return sendError(res, 400, 'VALIDATION_ERROR', "The 'taskId' field is required.");
  }
  if (stages !== undefined && !Array.isArray(stages)) {
    return sendError(res, 400, 'VALIDATION_ERROR', "The 'stages' field must be an array when provided.");
  }
  if (checkpoints !== undefined && !Array.isArray(checkpoints)) {
    return sendError(res, 400, 'VALIDATION_ERROR', "The 'checkpoints' field must be an array when provided.");
  }

  // T-004: Resolve stages — explicit body > task.pipeline > space.pipeline > DEFAULT_STAGES
  let resolvedStages = stages && stages.length > 0 ? stages : undefined;
  let resolvedFrom   = resolvedStages ? 'explicit' : undefined;

  if (!resolvedStages) {
    // Try task.pipeline — prefer SQLite store when available (post-migration), fall back to JSON files.
    const pmStore = pipelineManager.getStore();
    if (pmStore) {
      const taskResult = pmStore.getTaskWithColumn(spaceId, taskId);
      if (taskResult && Array.isArray(taskResult.task.pipeline) && taskResult.task.pipeline.length > 0) {
        resolvedStages = taskResult.task.pipeline;
        resolvedFrom   = 'task';
      }
    } else {
      const spaceDir = path.join(dataDir, 'spaces', spaceId);
      for (const col of ['todo', 'in-progress', 'done']) {
        const filePath = path.join(spaceDir, `${col}.json`);
        if (!fs.existsSync(filePath)) continue;
        try {
          const tasks   = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          const found   = Array.isArray(tasks) ? tasks.find((t) => t.id === taskId) : null;
          if (found && Array.isArray(found.pipeline) && found.pipeline.length > 0) {
            resolvedStages = found.pipeline;
            resolvedFrom   = 'task';
          }
          if (found) break;
        } catch (err) {
          console.warn(JSON.stringify({ event: 'run.task_pipeline_read_error', spaceId, taskId, col, message: err.message }));
        }
      }
    }
  }

  // Get space to resolve stages and extract workingDirectory
  const spaceResult = spaceManager.getSpace(spaceId);
  const workingDirectory = spaceResult.ok ? spaceResult.space.workingDirectory : undefined;

  if (!resolvedStages) {
    // Try space.pipeline
    if (spaceResult.ok && Array.isArray(spaceResult.space.pipeline) && spaceResult.space.pipeline.length > 0) {
      resolvedStages = spaceResult.space.pipeline;
      resolvedFrom   = 'space';
    }
  }

  if (!resolvedStages) {
    resolvedFrom = 'default';
  }

  process.stderr.write(JSON.stringify({
    event: 'run.pipeline_resolved',
    spaceId, taskId,
    resolvedFrom: resolvedFrom ?? 'explicit',
    stages: resolvedStages ?? pipelineManager.DEFAULT_STAGES,
    workingDirectory,
    ts: new Date().toISOString(),
  }) + '\n');

  try {
    const run = await pipelineManager.createRun({ spaceId, taskId, stages: resolvedStages, dataDir, workingDirectory, dangerouslySkipPermissions: dangerouslySkipPermissions === true, checkpoints: Array.isArray(checkpoints) ? checkpoints : [] });
    // Include resolvedFrom in the response when stages were not explicitly provided (MCP path).
    const responseBody = resolvedFrom && resolvedFrom !== 'explicit'
      ? { ...run, resolvedFrom, stages: run.stages }
      : run;
    return sendJSON(res, 201, responseBody);
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
 * GET /api/v1/runs
 * Return summary list of all runs from the registry.
 */
async function handleListRuns(req, res, dataDir) {
  const runs = await pipelineManager.listRuns(dataDir);
  return sendJSON(res, 200, runs);
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
 * GET /api/v1/runs/:runId/stages/:stageIndex/metrics[?force=true]
 * Return structured metrics extracted from the stage log.
 *
 * Responses:
 *   200  StageMetrics JSON
 *   404  run or stage does not exist
 *   425  Too Early — stage has no .log file yet (still starting or not started)
 *   500  Parse error (partial metrics may be included)
 */
async function handleGetStageMetrics(req, res, runId, stageIndex, dataDir) {
  const run = await pipelineManager.getRun(runId, dataDir);
  if (!run) {
    return sendError(res, 404, 'RUN_NOT_FOUND', `Run '${runId}' not found.`);
  }

  if (!Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex >= run.stages.length) {
    return sendError(res, 404, 'STAGE_NOT_FOUND', `Stage ${stageIndex} does not exist in run '${runId}'.`);
  }

  const logPath = pipelineManager.stageLogPath(dataDir, runId, stageIndex);
  if (!fs.existsSync(logPath)) {
    return sendError(res, 425, 'STAGE_NO_OUTPUT',
      `Stage ${stageIndex} of run '${runId}' has not produced any output yet.`,
      { suggestion: 'Retry after a few seconds.' });
  }

  // Parse ?force query param.
  const urlObj = new URL(req.url, 'http://x');
  const force  = urlObj.searchParams.get('force') === 'true';

  const agentId = run.stages[stageIndex] ?? 'unknown';

  try {
    const metrics = await parseStageLog(runId, stageIndex, agentId, dataDir, { force });
    return sendJSON(res, 200, metrics);
  } catch (err) {
    console.error(`[pipeline] ERROR parsing metrics for run ${runId} stage ${stageIndex}:`, err.message);
    return sendError(res, 500, 'PARSE_ERROR', `Failed to parse stage metrics: ${err.message}`);
  }
}

/**
 * POST /api/v1/runs/:runId/resume
 * Resume an interrupted or failed run from a given stage.
 * Body (optional): { fromStage?: number }
 * When fromStage is omitted, resumes from the first non-completed stage.
 */
async function handleResumeRun(req, res, runId, dataDir) {
  let body = {};
  try {
    body = await parseBody(req) || {};
  } catch (err) {
    return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  const { fromStage } = body;

  if (fromStage !== undefined && !Number.isInteger(fromStage)) {
    return sendError(res, 400, 'VALIDATION_ERROR', "'fromStage' must be an integer when provided.");
  }

  try {
    const run = await pipelineManager.resumeRun(runId, dataDir, { fromStage });
    return sendJSON(res, 200, run);
  } catch (err) {
    if (err.code === 'RUN_NOT_FOUND')      return sendError(res, 404, err.code, err.message);
    if (err.code === 'RUN_NOT_RESUMABLE')  return sendError(res, 422, err.code, err.message);
    if (err.code === 'INVALID_FROM_STAGE') return sendError(res, 400, err.code, err.message);
    console.error(`[pipeline] ERROR resuming run ${runId}:`, err);
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
}

/**
 * POST /api/v1/runs/:runId/stop
 * Stop a running pipeline: sends SIGTERM to the active stage process and marks
 * the run as `interrupted`. The run directory is preserved so it can be resumed
 * later with POST /api/v1/runs/:runId/resume.
 *
 * Returns the updated run object on success, 404 if the run does not exist,
 * or 422 if the run is already in a terminal state.
 */
async function handleStopRun(req, res, runId, dataDir) {
  const run = await pipelineManager.getRun(runId, dataDir);
  if (!run) {
    return sendError(res, 404, 'RUN_NOT_FOUND', `Run '${runId}' not found.`);
  }

  const stoppableStatuses = new Set(['pending', 'running', 'paused', 'blocked']);
  if (!stoppableStatuses.has(run.status)) {
    return sendError(
      res,
      422,
      'RUN_NOT_STOPPABLE',
      `Run '${runId}' is already in terminal state '${run.status}' and cannot be stopped.`,
    );
  }

  try {
    const updated = await pipelineManager.stopRun(runId, dataDir);
    return sendJSON(res, 200, updated);
  } catch (err) {
    console.error(`[pipeline] ERROR stopping run ${runId}:`, err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
}

/**
 * POST /api/v1/runs/:runId/block
 * Block a pipeline run — set status to 'blocked' so it will not advance to
 * the next stage when the current stage subprocess finishes.
 * Called automatically by kanban_add_comment when type='question'.
 */
async function handleBlockRun(req, res, runId, dataDir) {
  const run = await pipelineManager.getRun(runId, dataDir);
  if (!run) {
    return sendError(res, 404, 'RUN_NOT_FOUND', `Run '${runId}' not found.`);
  }

  try {
    const updated = await pipelineManager.blockRun(runId, dataDir);
    return sendJSON(res, 200, updated);
  } catch (err) {
    const status = err.code === 'RUN_IN_TERMINAL_STATE' ? 422 : 500;
    return sendError(res, status, err.code ?? 'INTERNAL_ERROR', err.message);
  }
}

/**
 * POST /api/v1/runs/:runId/unblock
 * Unblock a pipeline run — set status back to 'running' and resume execution
 * if the current stage has already completed.
 * Called automatically by kanban_answer_comment when all questions are resolved.
 */
async function handleUnblockRun(req, res, runId, dataDir) {
  const run = await pipelineManager.getRun(runId, dataDir);
  if (!run) {
    return sendError(res, 404, 'RUN_NOT_FOUND', `Run '${runId}' not found.`);
  }

  try {
    const updated = await pipelineManager.unblockRun(runId, dataDir);
    return sendJSON(res, 200, updated);
  } catch (err) {
    const status = err.code === 'RUN_NOT_BLOCKED' ? 422 : 500;
    return sendError(res, status, err.code ?? 'INTERNAL_ERROR', err.message);
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

/**
 * GET /api/v1/runs/:runId/stages/:stageIndex/events?since=<int>
 * Return paginated structured events from the stage log.
 *
 * Responses:
 *   200  { schemaVersion:1, events: PublicEvent[], nextSince, complete, stageStatus }
 *   404  run or stage does not exist
 *   425  Too Early — stage has no .log file yet
 *   500  Parse error
 */
async function handleGetStageEvents(req, res, runId, stageIndex, dataDir) {
  const run = await pipelineManager.getRun(runId, dataDir);
  if (!run) {
    return sendError(res, 404, 'RUN_NOT_FOUND', `Run '${runId}' not found.`);
  }

  if (!Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex >= run.stages.length) {
    return sendError(res, 404, 'STAGE_NOT_FOUND', `Stage ${stageIndex} does not exist in run '${runId}'.`);
  }

  const logPath = pipelineManager.stageLogPath(dataDir, runId, stageIndex);
  if (!fs.existsSync(logPath)) {
    return sendError(res, 425, 'LOG_NOT_READY',
      `Stage ${stageIndex} log not yet available. Stage status: ${run.stageStatuses?.[stageIndex]?.status ?? 'pending'}`,
      { suggestion: 'Wait for the stage to start before polling events' });
  }

  // Parse ?since query param (default 0).
  const urlObj   = new URL(req.url, 'http://x');
  const sinceRaw = urlObj.searchParams.get('since');
  const since    = sinceRaw !== null ? parseInt(sinceRaw, 10) : 0;

  if (!Number.isInteger(since) || since < 0 || isNaN(since)) {
    return sendError(res, 400, 'INVALID_SINCE', "'since' must be a non-negative integer.");
  }

  const agentId = run.stages[stageIndex] ?? 'unknown';

  // Derive stage-level status for polling cadence hint.
  const stageStatus = run.stageStatuses?.[stageIndex]?.status ?? 'running';

  try {
    const { events, nextSince, complete } = await parseStageEvents(runId, stageIndex, agentId, dataDir, { since });

    const body = {
      schemaVersion: 1,
      events,
      nextSince,
      complete,
      stageStatus,
    };

    return sendJSON(res, 200, body);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return sendError(res, 425, 'LOG_NOT_READY',
        `Stage ${stageIndex} log not yet available.`,
        { suggestion: 'Wait for the stage to start before polling events' });
    }
    console.error(`[pipeline] ERROR reading events for run ${runId} stage ${stageIndex}:`, err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', `Failed to parse stage events: ${err.message}`);
  }
}

/**
 * GET /api/v1/runs/:runId/stages/:stageIndex/prompt
 * Return the persisted prompt file for a specific stage as text/plain.
 * Returns 404 PROMPT_NOT_AVAILABLE if the file does not yet exist.
 */
async function handleGetStagePrompt(req, res, runId, stageIndex, dataDir) {
  const run = await pipelineManager.getRun(runId, dataDir);
  if (!run) {
    return sendError(res, 404, 'RUN_NOT_FOUND', `Run '${runId}' not found.`);
  }

  if (stageIndex < 0 || stageIndex >= run.stages.length) {
    return sendError(res, 404, 'STAGE_NOT_FOUND', `Stage ${stageIndex} does not exist in run '${runId}'.`);
  }

  const promptFile = pipelineManager.stagePromptPath(dataDir, runId, stageIndex);
  if (!fs.existsSync(promptFile)) {
    return sendError(
      res,
      404,
      'PROMPT_NOT_AVAILABLE',
      `Prompt for stage ${stageIndex} of run '${runId}' is not yet available.`,
    );
  }

  try {
    const content = fs.readFileSync(promptFile, 'utf8');
    const buf = Buffer.from(content, 'utf8');
    res.writeHead(200, {
      'Content-Type':   'text/plain; charset=utf-8',
      'Content-Length': buf.length,
    });
    res.end(buf);
  } catch (err) {
    console.error(`[pipeline] ERROR reading prompt for run ${runId} stage ${stageIndex}:`, err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read stage prompt file');
  }
}

/**
 * POST /api/v1/runs/preview-prompts
 * Generate prompts for all requested stages without starting a run.
 * Body: { spaceId, taskId, stages: string[] }
 * Returns: { prompts: [{ stageIndex, agentId, promptFull, estimatedTokens }] }
 * Does NOT create a run directory or any files on disk.
 */
async function handlePreviewPrompts(req, res, dataDir, spaceManager) {
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
  if (!Array.isArray(stages) || stages.length === 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', "The 'stages' field must be a non-empty array.");
  }

  // Validate the space exists.
  const spaceResult = spaceManager.getSpace(spaceId);
  if (!spaceResult.ok) {
    return sendError(res, 404, 'SPACE_NOT_FOUND', `Space '${spaceId}' not found.`);
  }

  // Validate all agent files exist before doing any work.
  // Project-scoped agents under `<workingDirectory>/.claude/agents/` take precedence.
  const agentsDir = process.env.PIPELINE_AGENTS_DIR;
  const workingDirectory = spaceResult.space.workingDirectory;
  for (const agentId of stages) {
    try {
      resolveAgent(agentId, agentsDir, workingDirectory);
    } catch (err) {
      if (err instanceof AgentNotFoundError) {
        return sendError(res, 422, 'AGENT_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  // Build the prompts in-memory — no files written to disk.
  const prompts = [];
  for (let i = 0; i < stages.length; i++) {
    const agentId = stages[i];
    try {
      const { promptText, estimatedTokens } = pipelineManager.buildStagePrompt(
        dataDir, spaceId, taskId, i, agentId, stages,
      );
      prompts.push({ stageIndex: i, agentId, promptFull: promptText, estimatedTokens });
    } catch (err) {
      console.error(`[pipeline] ERROR building preview prompt stage ${i} agent ${agentId}:`, err.message);
      return sendError(res, 500, 'INTERNAL_ERROR', `Failed to build prompt for stage ${i} (${agentId}): ${err.message}`);
    }
  }

  process.stderr.write(
    `[PIPELINE] ${JSON.stringify({ event: 'pipeline_prompts_previewed', spaceId, taskId, stageCount: stages.length, ts: new Date().toISOString() })}\n`,
  );

  return sendJSON(res, 200, { prompts });
}

module.exports = {
  PIPELINE_RUNS_LIST_ROUTE,
  PIPELINE_RUNS_SINGLE_ROUTE,
  PIPELINE_RUNS_LOG_ROUTE,
  PIPELINE_RUNS_METRICS_ROUTE,
  PIPELINE_RUNS_EVENTS_ROUTE,
  PIPELINE_RUNS_PROMPT_ROUTE,
  PIPELINE_RUNS_PREVIEW_ROUTE,
  PIPELINE_RUNS_RESUME_ROUTE,
  PIPELINE_RUNS_STOP_ROUTE,
  PIPELINE_RUNS_BLOCK_ROUTE,
  PIPELINE_RUNS_UNBLOCK_ROUTE,
  handleCreateRun,
  handleListRuns,
  handleGetRun,
  handleGetStageLog,
  handleGetStageMetrics,
  handleGetStageEvents,
  handleGetStagePrompt,
  handlePreviewPrompts,
  handleDeleteRun,
  handleResumeRun,
  handleStopRun,
  handleBlockRun,
  handleUnblockRun,
};
