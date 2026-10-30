'use strict';

/**
 * Task runs: a task goes to an agent, its result stays on the card.
 *
 * Endpoints:
 *   GET  /api/v1/spaces/:spaceId/task-runs                 → latest run per task
 *   PUT  /api/v1/spaces/:spaceId/hooks                     → what follows the agent
 *   POST /api/v1/spaces/:spaceId/tasks/:taskId/run         → start the agent
 *   POST /api/v1/spaces/:spaceId/tasks/:taskId/request-changes
 *   POST /api/v1/spaces/:spaceId/tasks/:taskId/close       → remove the worktree
 *   POST /api/v1/spaces/:spaceId/tasks/:taskId/pr          → create or update the PR
 *   GET  /api/v1/runs/:runId/diff[?path=<file>]            → changed files, or one patch
 *   GET  /api/v1/runs/:runId/log                           → the agent's output
 *   POST /api/v1/runs/:runId/stop
 *   POST /api/v1/runs/:runId/resume
 */

const { sendJSON, sendError, parseBody, readActor } = require('../utils/http');
const taskRunner      = require('../services/taskRunner');
const worktreeManager = require('../services/worktreeManager');

const DIRECT_CLI_TOOLS = ['claude', 'opencode', 'pi', 'hermes'];
// The model reaches a shell command line through the harness adapters.
const MODEL_RE         = /^[\w./:@-]+$/;

// These take the model as <provider>/<model>.
const SLASH_MODEL_CLI_TOOLS = ['opencode', 'pi', 'hermes'];

const CHECK_COMMAND_MAX_LEN = 2000;
const CHANGE_TEXT_MAX_LEN   = 5000;
const COMMENT_MAX_COUNT     = 200;

const ERROR_STATUS = {
  TASK_NOT_FOUND:            404,
  RUN_NOT_FOUND:             404,
  TASK_NOT_IN_TODO:          422,
  NOT_A_GIT_REPO:            422,
  AGENT_NOT_FOUND:           422,
  RUN_ACTIVE:                409,
  TASK_IS_EPIC:              409,
  TASK_AWAITING_REVIEW:      409,
  RUN_NOT_RESUMABLE:         409,
  MAX_CONCURRENT_REACHED:    409,
  WORKTREE_KEPT:             409,
  WORKTREE_UNAVAILABLE:      409,
  OPEN_QUESTION:             409,
  PR_FAILED:                 422,
  WORKTREE_PROVISION_FAILED: 500,
};

/**
 * Parse a JSON object body, answering the request if it is not one.
 *
 * @returns {Promise<object|null>}
 */
async function readObjectBody(req, res) {
  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    if (err.message === 'PAYLOAD_TOO_LARGE') {
      sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 512 KB limit');
    } else {
      sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
    }
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
    return null;
  }
  return body;
}

function sendRunError(res, err, op) {
  const status = ERROR_STATUS[err.code];
  if (status && status < 500) return sendError(res, status, err.code, err.message);
  console.error(`[taskRuns] ERROR ${op}:`, err);
  return sendError(res, 500, err.code || 'INTERNAL_ERROR', err.message);
}

/**
 * Validate the harness and model chosen for a run. Without a harness the run uses
 * the default agent.
 *
 * @param {object} body
 * @returns {{ config: object|null, error: string|null }}
 */
function readAgentConfig({ cliTool, model }) {
  if (cliTool === undefined) {
    return model === undefined
      ? { config: null, error: null }
      : { config: null, error: 'model requires cliTool' };
  }
  if (!DIRECT_CLI_TOOLS.includes(cliTool)) {
    return { config: null, error: `cliTool must be one of: ${DIRECT_CLI_TOOLS.join(', ')}` };
  }
  if (model !== undefined && (typeof model !== 'string' || !MODEL_RE.test(model))) {
    return { config: null, error: 'model contains characters that are not allowed' };
  }
  const needsSlashModel = SLASH_MODEL_CLI_TOOLS.includes(cliTool);
  if (needsSlashModel && model === undefined) {
    return { config: null, error: `${cliTool} needs a model in <provider>/<model> format` };
  }

  if (needsSlashModel && !model.includes('/')) {
    return { config: null, error: `${cliTool} model must be in <provider>/<model> format` };
  }

  return {
    config: {
      cliTool,
      ...(model !== undefined && { model }),
      ...(needsSlashModel && { provider: model.split('/')[0] }),
    },
    error: null,
  };
}

async function handleStartTaskRun(req, res, store, spaceId, taskId, workingDirectory) {
  const body = await readObjectBody(req, res);
  if (!body) return undefined;

  const { config, error } = readAgentConfig(body);
  if (error) return sendError(res, 400, 'VALIDATION_ERROR', error);

  const target = store.getAllTasksForSpaceWithStatus(spaceId).find((t) => t.id === taskId);
  if (target?.type === 'epic') {
    return sendError(res, 409, 'TASK_IS_EPIC', 'An epic groups issues. Run the issues in it instead.');
  }
  if (target?.isBlocked) {
    return sendError(res, 409, 'TASK_BLOCKED',
      `Task is blocked by ${target.blockedByCount} unfinished ` +
      `dependenc${target.blockedByCount === 1 ? 'y' : 'ies'}.`);
  }

  try {
    const run = await taskRunner.createRun({ spaceId, taskId, workingDirectory, agentConfig: config });
    return sendJSON(res, 201, run);
  } catch (err) {
    return sendRunError(res, err, 'starting task run');
  }
}

function handleListTaskRuns(req, res, spaceId) {
  const views = taskRunner.listRunViews(spaceId);
  if (req.user?.role !== 'viewer') return sendJSON(res, 200, views);
  // The output of a check can show code, as the diff and the log do, and viewers see neither.
  const withoutOutput = Object.fromEntries(Object.entries(views).map(([taskId, view]) => [
    taskId,
    view.hook ? { ...view, hook: { type: view.hook.type, status: view.hook.status } } : view,
  ]));
  return sendJSON(res, 200, withoutOutput);
}

/**
 * The run that a task-level action applies to: the task's latest direct run.
 *
 * @returns {object|null}
 */
function latestRunView(spaceId, taskId) {
  return taskRunner.listRunViews(spaceId)[taskId] ?? null;
}

async function handleRequestChanges(req, res, store, spaceId, taskId) {
  const body = await readObjectBody(req, res);
  if (!body) return undefined;

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length === 0) return sendError(res, 400, 'VALIDATION_ERROR', 'text is required');
  if (text.length > CHANGE_TEXT_MAX_LEN) {
    return sendError(res, 400, 'VALIDATION_ERROR', `text must not exceed ${CHANGE_TEXT_MAX_LEN} characters`);
  }

  const task = store.getTask(spaceId, taskId);
  if (!task) return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);

  const view = latestRunView(spaceId, taskId);
  if (!view) return sendError(res, 409, 'NO_RUN', 'This task has not been run yet.');

  const comments = Array.isArray(task.comments) ? task.comments : [];
  if (comments.length >= COMMENT_MAX_COUNT) {
    return sendError(res, 400, 'COMMENT_LIMIT_EXCEEDED',
      `Task has reached the maximum of ${COMMENT_MAX_COUNT} comments`);
  }
  if (comments.some((c) => c.type === 'question' && !c.resolved)) {
    return sendError(res, 409, 'OPEN_QUESTION', 'Answer the open question first.');
  }

  try {
    return sendJSON(res, 200, await taskRunner.requestChanges(view.runId, text, { author: readActor(req, 'user'), authorId: req.user?.unverified ? undefined : req.user?.id }));
  } catch (err) {
    return sendRunError(res, err, 'requesting changes');
  }
}

async function handleCloseTaskRun(res, spaceId, taskId) {
  const view = latestRunView(spaceId, taskId);
  if (!view) return sendError(res, 409, 'NO_RUN', 'This task has not been run yet.');
  try {
    return sendJSON(res, 200, await taskRunner.closeRun(view.runId));
  } catch (err) {
    return sendRunError(res, err, 'closing task run');
  }
}

async function handleCreatePullRequest(res, spaceId, taskId) {
  const view = latestRunView(spaceId, taskId);
  if (!view) return sendError(res, 409, 'NO_RUN', 'This task has not been run yet.');
  try {
    return sendJSON(res, 200, await taskRunner.createPullRequest(view.runId));
  } catch (err) {
    return sendRunError(res, err, 'creating pull request');
  }
}

async function handleGetRunDiff(req, res, runId) {
  const run = taskRunner.getRun(runId);
  if (!run) return sendError(res, 404, 'RUN_NOT_FOUND', `Run '${runId}' not found.`);

  const range = { baseRef: run.worktree.baseRef, ref: run.result?.ref || run.worktree.branch };
  const filePath = new URL(req.url, 'http://x').searchParams.get('path');

  try {
    if (filePath === null) {
      const files = await worktreeManager.listChangedFiles(run.workingDirectory, range);
      return sendJSON(res, 200, { files });
    }
    const diff = await worktreeManager.readFileDiff(run.workingDirectory, range, filePath);
    if (!diff) return sendError(res, 404, 'FILE_NOT_CHANGED', 'This run did not change that file.');
    return sendJSON(res, 200, diff);
  } catch (err) {
    console.error(`[taskRuns] ERROR reading diff of run ${runId}:`, err);
    return sendError(res, 409, 'DIFF_UNAVAILABLE', 'The run branch is no longer available.');
  }
}

function handleGetRunLog(res, runId) {
  if (!taskRunner.getRun(runId)) return sendError(res, 404, 'RUN_NOT_FOUND', `Run '${runId}' not found.`);
  return sendJSON(res, 200, { log: taskRunner.readAgentLog(runId) ?? '' });
}

async function handleStopRun(res, runId) {
  try {
    const run = await taskRunner.stopRun(runId);
    if (!run) return sendError(res, 404, 'RUN_NOT_FOUND', `Run '${runId}' not found.`);
    return sendJSON(res, 200, run);
  } catch (err) {
    return sendRunError(res, err, 'stopping run');
  }
}

async function handleResumeRun(res, runId) {
  try {
    return sendJSON(res, 200, await taskRunner.resumeRun(runId));
  } catch (err) {
    return sendRunError(res, err, 'resuming run');
  }
}

/**
 * Set what follows the agent in a space: a command that must pass, and whether the
 * pull request opens by itself.
 */
async function handleUpdateHooks(req, res, store, spaceId) {
  const body = await readObjectBody(req, res);
  if (!body) return undefined;

  const { checkCommand = null, autoPr = false } = body;
  if (checkCommand !== null && typeof checkCommand !== 'string') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'checkCommand must be a string or null');
  }
  const command = checkCommand?.trim() || null;
  if (command && command.length > CHECK_COMMAND_MAX_LEN) {
    return sendError(res, 400, 'VALIDATION_ERROR', `checkCommand must not exceed ${CHECK_COMMAND_MAX_LEN} characters`);
  }
  if (typeof autoPr !== 'boolean') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'autoPr must be a boolean');
  }

  // An agent running in this space must not be able to change the check it will face.
  if (taskRunner.spaceHasActiveRun(spaceId)) {
    return sendError(res, 409, 'SPACE_RUN_ACTIVE', 'Wait for the running tasks to finish before changing this.');
  }

  const space = store.getSpace(spaceId);
  const finishStatus = body.finishStatus ?? space.hooks?.finishStatus;
  // Not a to-do one: work that is finished would look like work not started.
  const finishable = space.statuses.filter((s) => s.category !== 'todo');
  if (body.finishStatus !== undefined && !finishable.some((s) => s.id === body.finishStatus)) {
    return sendError(res, 400, 'VALIDATION_ERROR', `finishStatus must be one of: ${finishable.map((s) => s.id).join(', ')}`);
  }
  store.upsertSpace({
    ...space,
    hooks: { checkCommand: command, autoPr, ...(finishStatus && { finishStatus }) },
    updatedAt: new Date().toISOString(),
  });
  return sendJSON(res, 200, store.getSpace(spaceId));
}

module.exports = {
  handleStartTaskRun,
  handleListTaskRuns,
  handleRequestChanges,
  handleCloseTaskRun,
  handleGetRunDiff,
  handleGetRunLog,
  handleStopRun,
  handleResumeRun,
  handleCreatePullRequest,
  handleUpdateHooks,
};
