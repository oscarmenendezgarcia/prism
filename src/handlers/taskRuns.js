'use strict';

/**
 * Direct task runs: a task goes to an agent, its result stays on the card.
 *
 * Endpoints:
 *   GET  /api/v1/spaces/:spaceId/task-runs                 → latest run per task
 *   PUT  /api/v1/spaces/:spaceId/hooks                     → set the space's hooks
 *   POST /api/v1/spaces/:spaceId/tasks/:taskId/run         → start the agent
 *   POST /api/v1/spaces/:spaceId/tasks/:taskId/request-changes
 *   POST /api/v1/spaces/:spaceId/tasks/:taskId/close       → remove the worktree
 *   POST /api/v1/spaces/:spaceId/tasks/:taskId/approve     → OK the hook the run waits on
 *   POST /api/v1/spaces/:spaceId/tasks/:taskId/pr          → create or update the PR
 *   GET  /api/v1/runs/:runId/diff[?path=<file>]            → changed files, or one patch
 *
 * Stopping and retrying use the existing /runs/:runId/stop and /resume.
 */

const crypto = require('crypto');

const { sendJSON, sendError, parseBody } = require('../utils/http');
const pipelineManager = require('../services/pipelineManager');
const worktreeManager = require('../services/worktreeManager');
const { validateStageModelConfig, SLASH_MODEL_CLI_TOOLS } = require('../services/modelConfigResolver');

const DIRECT_CLI_TOOLS = ['claude', 'opencode', 'pi', 'hermes'];
// The model reaches a shell command line through the harness adapters.
const MODEL_RE         = /^[\w./:@-]+$/;

const MAX_HOOKS             = 10;
const HOOK_TYPES            = ['command', 'agent', 'pr'];
const HOOK_ON_FAIL          = ['stop', 'retry'];
const HOOK_MAX_RETRIES      = 3;
const HOOK_MAX_MINUTES      = 240;
const HOOK_ID_RE            = /^[\w-]{1,64}$/;
const HOOK_NAME_MAX_LEN     = 60;
const HOOK_COMMAND_MAX_LEN  = 2000;
const HOOK_PROMPT_MAX_LEN   = 5000;
const CHANGE_TEXT_MAX_LEN   = 5000;
const COMMENT_MAX_COUNT     = 200;

const ERROR_STATUS = {
  TASK_NOT_FOUND:            404,
  RUN_NOT_FOUND:             404,
  TASK_NOT_IN_TODO:          422,
  NOT_A_GIT_REPO:            422,
  AGENT_NOT_FOUND:           422,
  RUN_ACTIVE:                409,
  RUN_NOT_RESUMABLE:         409,
  MAX_CONCURRENT_REACHED:    409,
  WORKTREE_KEPT:             409,
  WORKTREE_UNAVAILABLE:      409,
  RUN_NOT_WAITING:           409,
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
 * the space's default.
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

  const config = {
    cliTool,
    ...(model !== undefined && { model }),
    ...(needsSlashModel && { provider: model.split('/')[0] }),
  };
  const { valid, errors } = validateStageModelConfig(config);
  return valid ? { config, error: null } : { config: null, error: errors[0] };
}

async function handleStartTaskRun(req, res, store, spaceId, taskId, workingDirectory, dataDir) {
  const body = await readObjectBody(req, res);
  if (!body) return undefined;

  const { config, error } = readAgentConfig(body);
  if (error) return sendError(res, 400, 'VALIDATION_ERROR', error);

  const target = store.getAllTasksForSpaceWithStatus(spaceId).find((t) => t.id === taskId);
  if (target?.isBlocked) {
    return sendError(res, 409, 'TASK_BLOCKED',
      `Task is blocked by ${target.blockedByCount} unfinished ` +
      `dependenc${target.blockedByCount === 1 ? 'y' : 'ies'}.`);
  }

  try {
    const run = await pipelineManager.createRun({
      spaceId, taskId, dataDir, workingDirectory, direct: true, agentConfig: config,
    });
    return sendJSON(res, 201, run);
  } catch (err) {
    return sendRunError(res, err, 'starting task run');
  }
}

function handleListTaskRuns(res, spaceId) {
  return sendJSON(res, 200, pipelineManager.listDirectRunViews(spaceId));
}

/**
 * The run that a task-level action applies to: the task's latest direct run.
 *
 * @returns {object|null}
 */
function latestRunView(spaceId, taskId) {
  return pipelineManager.listDirectRunViews(spaceId)[taskId] ?? null;
}

async function handleRequestChanges(req, res, store, spaceId, taskId, dataDir) {
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
    return sendJSON(res, 200, await pipelineManager.requestChanges(view.runId, dataDir, text));
  } catch (err) {
    return sendRunError(res, err, 'requesting changes');
  }
}

async function handleCloseTaskRun(res, spaceId, taskId, dataDir) {
  const view = latestRunView(spaceId, taskId);
  if (!view) return sendError(res, 409, 'NO_RUN', 'This task has not been run yet.');
  try {
    return sendJSON(res, 200, await pipelineManager.closeDirectRun(view.runId, dataDir));
  } catch (err) {
    return sendRunError(res, err, 'closing task run');
  }
}

async function handleApproveHook(res, spaceId, taskId, dataDir) {
  const view = latestRunView(spaceId, taskId);
  if (!view) return sendError(res, 409, 'NO_RUN', 'This task has not been run yet.');
  try {
    return sendJSON(res, 200, await pipelineManager.approveHook(view.runId, dataDir));
  } catch (err) {
    return sendRunError(res, err, 'approving hook');
  }
}

async function handleCreatePullRequest(res, spaceId, taskId, dataDir) {
  const view = latestRunView(spaceId, taskId);
  if (!view) return sendError(res, 409, 'NO_RUN', 'This task has not been run yet.');
  try {
    return sendJSON(res, 200, await pipelineManager.createPullRequest(view.runId, dataDir));
  } catch (err) {
    return sendRunError(res, err, 'creating pull request');
  }
}

async function handleGetRunDiff(req, res, runId, dataDir) {
  const run = await pipelineManager.getRun(runId, dataDir);
  if (!run || !run.direct) return sendError(res, 404, 'RUN_NOT_FOUND', `Direct run '${runId}' not found.`);

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

/**
 * Validate a hook from the settings form. It keeps its id across edits, which is how a
 * run finds the hook it stopped at; a new one gets its id here.
 *
 * @param {object} hook
 * @returns {{ value: object|null, error: string|null }}
 */
function readHook(hook) {
  const fail = (error) => ({ value: null, error });
  const name = typeof hook?.name === 'string' ? hook.name.trim() : '';
  if (!name || name.length > HOOK_NAME_MAX_LEN) return fail(`hook name is required, up to ${HOOK_NAME_MAX_LEN} characters`);

  const type = hook.type ?? 'command';
  if (!HOOK_TYPES.includes(type)) return fail(`hook type must be one of: ${HOOK_TYPES.join(', ')}`);
  const onFail = hook.onFail ?? 'stop';
  if (!HOOK_ON_FAIL.includes(onFail)) return fail(`hook onFail must be one of: ${HOOK_ON_FAIL.join(', ')}`);
  if (type === 'pr' && onFail === 'retry') return fail('an agent cannot fix a pull request that fails to open, so onFail must be stop');
  const maxRetries = hook.maxRetries ?? 2;
  if (!Number.isInteger(maxRetries) || maxRetries < 1 || maxRetries > HOOK_MAX_RETRIES) return fail(`hook maxRetries must be from 1 to ${HOOK_MAX_RETRIES}`);
  const minutes = hook.timeoutMinutes;
  if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 1 || minutes > HOOK_MAX_MINUTES)) return fail(`hook timeoutMinutes must be from 1 to ${HOOK_MAX_MINUTES}`);
  if (hook.id !== undefined && (typeof hook.id !== 'string' || !HOOK_ID_RE.test(hook.id))) return fail('hook id is not valid');

  const value = {
    id: hook.id ?? crypto.randomUUID(),
    name,
    type,
    onFail,
    approval: hook.approval === true,
    maxRetries,
    ...(minutes !== undefined && { timeoutMinutes: minutes }),
  };

  if (type === 'command') {
    const command = typeof hook.command === 'string' ? hook.command.trim() : '';
    if (!command || command.length > HOOK_COMMAND_MAX_LEN) return fail(`hook command is required, up to ${HOOK_COMMAND_MAX_LEN} characters`);
    value.command = command;
  }
  if (type === 'agent') {
    const prompt = typeof hook.prompt === 'string' ? hook.prompt.trim() : '';
    if (!prompt || prompt.length > HOOK_PROMPT_MAX_LEN) return fail(`what the agent must check is required, up to ${HOOK_PROMPT_MAX_LEN} characters`);
    const { config, error } = readAgentConfig(hook.agent ?? {});
    if (error) return fail(error);
    if (!config) return fail('hook agent needs a cliTool');
    value.prompt = prompt;
    value.agent  = config;
  }
  return { value, error: null };
}

async function handleUpdateHooks(req, res, store, spaceId) {
  const body = await readObjectBody(req, res);
  if (!body) return undefined;

  const { hooks } = body;
  if (!Array.isArray(hooks) || hooks.length > MAX_HOOKS) {
    return sendError(res, 400, 'VALIDATION_ERROR', `hooks must be an array of at most ${MAX_HOOKS}`);
  }

  const clean = [];
  for (const hook of hooks) {
    const { value, error } = readHook(hook);
    if (error) return sendError(res, 400, 'VALIDATION_ERROR', error);
    clean.push(value);
  }
  if (new Set(clean.map((h) => h.id)).size !== clean.length) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'hook ids must be unique');
  }

  // An agent running in this space must not be able to change the checks it will face.
  if (pipelineManager.spaceHasActiveDirectRun(spaceId)) {
    return sendError(res, 409, 'SPACE_RUN_ACTIVE', 'Wait for the running tasks to finish before changing hooks.');
  }

  const space = store.getSpace(spaceId);
  const updated = { ...space, hooks: clean, updatedAt: new Date().toISOString() };
  store.upsertSpace(updated);
  return sendJSON(res, 200, updated);
}

module.exports = {
  handleStartTaskRun,
  handleListTaskRuns,
  handleRequestChanges,
  handleCloseTaskRun,
  handleGetRunDiff,
  handleApproveHook,
  handleCreatePullRequest,
  handleUpdateHooks,
};
