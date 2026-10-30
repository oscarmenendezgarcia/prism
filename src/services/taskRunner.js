/**
 * Prism — Task Runner
 *
 * A task goes to an agent. The agent works alone in the task's own worktree and branch,
 * and asks through the task's comments. When it finishes, Prism saves the work, runs the
 * space's check, opens the pull request if the space asks for it, and closes the task.
 *
 * Each agent process is detached and reports through a done file, so it survives a server
 * restart and the next server picks it up.
 *
 * Environment variables:
 *   PRISM_AGENT_TIMEOUT_MS - Kill an agent after this long (default: 1h)
 *   PRISM_STALL_TIMEOUT_MS - Kill an agent with no output for this long (default: 15min)
 *   PRISM_MAX_RUNS         - Runs going at once (default: 5)
 *   PRISM_POLL_INTERVAL_MS - How often to look at a running agent (default: 2s)
 *   PIPELINE_RUNS_DIR      - Where runs keep their logs and prompts
 */

'use strict';

const fs              = require('fs');
const path            = require('path');
const crypto          = require('crypto');
const { spawn, execSync } = require('child_process');

const worktreeManager = require('./worktreeManager');
const { runHookProcess } = require('./hookRunner');
const { pushAndOpenPullRequest } = require('./pullRequests');
const { getAdapter }  = require('./cliAdapters');
const { normalize }   = require('../utils/streamJsonNormalizer');
const {
  buildGitContextBlock,
  buildDirectCardBlock,
  buildCommentsBlock,
  buildChangeRequestBlock,
} = require('../utils/promptBuilder');

const AGENT_NAME          = 'prism-agent';
const AGENT_FILE          = path.join(__dirname, '..', '..', 'agents', `${AGENT_NAME}.md`);
const DEFAULT_AGENT       = { cliTool: 'claude', model: 'sonnet' };
const DEFAULT_TIMEOUT_MS  = 3_600_000;
const DEFAULT_STALL_MS    = 900_000;
const DEFAULT_MAX_RUNS    = 5;
const DEFAULT_POLL_MS     = 2_000;
const AGENT_EXIT_GRACE_MS = 5_000;
const LOG_TAIL_BYTES      = 16_384;
const ACTIVE_STATUSES     = ['pending', 'running', 'blocked'];
const RESUMABLE_STATUSES  = ['interrupted', 'failed', 'blocked'];

// Names these settings had in the pipeline versions, still honoured.
const OLD_ENV_NAMES = {
  PRISM_AGENT_TIMEOUT_MS: 'PIPELINE_STAGE_TIMEOUT_MS',
  PRISM_STALL_TIMEOUT_MS: 'PIPELINE_STALL_TIMEOUT_MS',
  PRISM_MAX_RUNS:         'PIPELINE_MAX_CONCURRENT',
};

function envInt(name, fallback) {
  return parseInt(process.env[name] || process.env[OLD_ENV_NAMES[name]] || String(fallback), 10);
}

let _store   = null;
let _dataDir = null;

/** The startup worktree sweep while it runs. It also removes worktrees of old runs. */
let startupSweep = null;

// runId → the timer watching its agent.
const activeAgents = new Map();
// runId → the check or pull request it is running: { pid?, abort? }.
const activeHooks = new Map();
// runId → the save in flight. A new turn waits for it.
const activeSaves = new Map();
// runId → how many times it was stopped. An action queued before a stop must not go on.
const stopCounts = new Map();
// Runs being created: they count towards the limit before they are on record.
let creatingRuns = 0;
// taskId → tail of the queue of actions on its run. Each spans git operations, and two
// tabs must not interleave them.
const taskLocks = new Map();

function runnerError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function log(event, payload = {}) {
  process.stderr.write(`[RUN] ${JSON.stringify({ event, ...payload, ts: new Date().toISOString() })}\n`);
}

/**
 * Run an action on a task's run after the ones already queued for that task.
 *
 * @template T
 * @param {string} taskId
 * @param {() => Promise<T>} action
 * @returns {Promise<T>}
 */
function withTaskLock(taskId, action) {
  const tail = taskLocks.get(taskId) ?? Promise.resolve();
  const result = tail.then(action);
  const settled = result.catch(() => {}).finally(() => {
    if (taskLocks.get(taskId) === settled) taskLocks.delete(taskId);
  });
  taskLocks.set(taskId, settled);
  return result;
}

// ---------------------------------------------------------------------------
// Run state and files
// ---------------------------------------------------------------------------

function runDir(runId) {
  return path.join(process.env.PIPELINE_RUNS_DIR || path.join(_dataDir, 'runs'), runId);
}

function agentLogPath(runId) {
  return path.join(runDir(runId), 'agent.log');
}

function agentDonePath(runId) {
  return path.join(runDir(runId), 'agent.done');
}

/** Runs from the pipeline versions stay in the database, but nothing here runs them. */
function isTaskRun(run) {
  return !!run?.direct && !!run.agent;
}

function readRun(runId) {
  const run = _store.getRun(runId);
  return isTaskRun(run) ? run : null;
}

function writeRun(run) {
  run.updatedAt = new Date().toISOString();
  _store.upsertRun(run);
}

function requireRun(runId) {
  const run = readRun(runId);
  if (!run) throw runnerError('RUN_NOT_FOUND', `Run '${runId}' not found.`);
  return run;
}

function openQuestions(run) {
  const task = _store.getTask(run.spaceId, run.taskId);
  return (task?.comments ?? []).filter((c) => c.type === 'question' && !c.resolved);
}

/**
 * What a space asks for when an agent finishes.
 *
 * @param {string} spaceId
 * @returns {{ checkCommand: string|null, autoPr: boolean }}
 */
function spaceHooks(spaceId) {
  const hooks = _store.getSpace(spaceId)?.hooks;
  return {
    checkCommand: hooks?.checkCommand ?? null,
    autoPr:       hooks?.autoPr === true,
  };
}

/** An epic only groups issues, so no agent works on one, whichever way it became one. */
function assertNotEpic(task) {
  if (task?.type === 'epic') throw runnerError('TASK_IS_EPIC', 'An epic groups issues. Run the issues in it instead.');
}

/** Who the history says did what a run did. */
function agentName(run) {
  return run.agentConfig?.cliTool ?? 'claude';
}

/**
 * Put a task the agent is working on in an in-progress status: the first one, unless it
 * was already in one that is not where finished work lands.
 *
 * @param {object} run
 */
function moveToInProgress(run) {
  const { spaceId, taskId } = run;
  const task = _store.getTask(spaceId, taskId);
  const space = _store.getSpace(spaceId);
  if (!task || !space) return;
  if (task.category === 'in-progress' && task.statusId !== space.finishStatusId) return;
  _store.moveTask(spaceId, taskId, _store.firstStatusOf(spaceId, 'in-progress').id, { actor: agentName(run) });
}

// ---------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Signal a process group. Never the server itself. */
function killGroup(pid, signal = 'SIGTERM') {
  if (!pid || pid === process.pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' });
    } else {
      process.kill(-pid, signal);
    }
  } catch { /* already gone */ }
}

/**
 * Wait for a process group that was just signalled to exit, killing it if it takes too
 * long, so that saving the worktree does not race an agent still writing to it.
 *
 * @param {number|undefined} pid
 */
async function waitForExit(pid) {
  if (!pid || pid === process.pid || process.platform === 'win32') return;

  const alive = () => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const deadline = Date.now() + AGENT_EXIT_GRACE_MS;
  while (alive() && Date.now() < deadline) await sleep(100);
  if (alive()) {
    log('agent.killed', { pid });
    killGroup(pid, 'SIGKILL');
    await sleep(200);
  }
}

function isGroupAlive(pid) {
  if (!pid || process.platform === 'win32') return isProcessAlive(pid);
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a pid recorded before a restart is still this run's. A process that now runs
 * outside the worktree is something else that got the same pid.
 *
 * @param {object} run
 * @param {number} pid
 * @returns {boolean}
 */
function isRunsProcess(run, pid) {
  if (!pid || pid === process.pid) return false;

  let cwd = null;
  try {
    cwd = fs.realpathSync(`/proc/${pid}/cwd`);
  } catch (err) {
    // ENOENT: the leader is gone, or this is not Linux. While its group lives the kernel
    // does not reuse the pid, so that group can only be the run's. Anything else, such
    // as a process of another user, is not ours to signal.
    return err.code === 'ENOENT';
  }
  try {
    const worktree = fs.realpathSync(run.worktree.path);
    return cwd === worktree || cwd.startsWith(worktree + path.sep);
  } catch {
    return false;
  }
}

/**
 * Stop what a run left running across a restart, so it does not write to the worktree
 * while Prism saves it.
 *
 * @param {object} run
 * @param {number} pid
 * @returns {number|undefined} The process group signalled.
 */
function killLeftover(run, pid) {
  if (!isRunsProcess(run, pid) || !isGroupAlive(pid)) return undefined;
  killGroup(pid);
  log('process.killed_on_startup', { runId: run.runId, pid });
  return pid;
}

// ---------------------------------------------------------------------------
// Saving the result
// ---------------------------------------------------------------------------

/**
 * Commit what the agent left in its worktree and record what the branch changed. The
 * worktree stays, so the agent can continue on it if the user asks for changes. A failed
 * save goes on the run because the task has to show it.
 *
 * @param {string} runId
 */
async function saveResult(runId) {
  const run = readRun(runId);
  if (!run) return;

  const { branch, baseBranch, baseRef } = run.worktree;
  let saveError = null;
  let ref = run.result?.ref ?? null;
  if (fs.existsSync(run.worktree.path)) {
    try {
      ref = (await worktreeManager.saveWork(run.worktree, { reason: run.status, runId })).ref;
    } catch (err) {
      saveError = err.message;
      log('worktree.error', { runId, op: 'save_work', code: err.code, message: err.message, kept: run.worktree.path });
    }
  } else {
    saveError = 'The worktree is gone, so what the agent left there could not be saved.';
    log('worktree.error', { runId, op: 'save_work', message: 'worktree missing' });
  }

  let files = null;
  try {
    files = await worktreeManager.listChangedFiles(run.workingDirectory, { baseRef, ref: ref || branch });
  } catch (err) {
    log('worktree.error', { runId, op: 'list_changed_files', code: err.code, message: err.message });
  }

  let head = null;
  try {
    head = await worktreeManager.readBranchHead(run.workingDirectory, ref || branch);
  } catch (err) {
    log('worktree.error', { runId, op: 'read_head', code: err.code, message: err.message });
  }

  // The run may have been deleted, and its status may have changed, while git worked.
  const fresh = readRun(runId);
  if (!fresh) return;
  fresh.result = {
    branch,
    baseBranch,
    ref,
    head,
    fileCount: files ? files.length : null,
    additions: files ? files.reduce((sum, f) => sum + f.additions, 0) : null,
    deletions: files ? files.reduce((sum, f) => sum + f.deletions, 0) : null,
    saveError,
    pr: fresh.result?.pr ?? null,
  };
  writeRun(fresh);
}

/**
 * Save a run's work once at a time. Never throws.
 *
 * @param {string} runId
 * @param {number} [signalledPid] - Process group just signalled, to wait for first.
 */
async function save(runId, signalledPid) {
  const pending = activeSaves.get(runId);
  if (pending) return pending;

  const saving = (async () => {
    await waitForExit(signalledPid);
    await saveResult(runId);
  })().catch((err) => {
    log('worktree.error', { runId, op: 'save', message: err.message });
  });

  activeSaves.set(runId, saving);
  try {
    await saving;
  } finally {
    activeSaves.delete(runId);
  }
}

// ---------------------------------------------------------------------------
// After the agent: check, pull request, done
// ---------------------------------------------------------------------------

/**
 * Push a run's branch, open its pull request, and record it on the run.
 *
 * @param {object} run
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ url: string, number: number }>}
 * @throws PR_FAILED.
 */
async function openPullRequest(run, { signal } = {}) {
  if (run.result?.saveError) {
    throw runnerError('PR_FAILED', 'Some work could not be saved to the branch, so it would be missing from the pull request.');
  }
  const task = _store.getTask(run.spaceId, run.taskId);
  const pr = await pushAndOpenPullRequest({
    signal,
    cwd:        run.workingDirectory,
    branch:     run.worktree.branch,
    sourceRef:  run.result?.ref ?? undefined,
    baseBranch: run.worktree.baseBranch,
    title:      task ? `${task.key}: ${task.title}` : run.worktree.branch,
    body:       task?.description || 'Created from Prism.',
  });

  const fresh = readRun(run.runId);
  if (fresh) {
    // What was pushed is what was saved when this started.
    fresh.result = { ...fresh.result, pr: { ...pr, pushedHead: run.result?.head ?? null } };
    writeRun(fresh);
  }
  return pr;
}

/**
 * The run as long as nobody has stopped or restarted it since `turn` began.
 */
function currentRun(runId, turn) {
  const run = readRun(runId);
  return run && run.status === 'running' && run.turnId === turn ? run : null;
}

/**
 * Run the space's check in the worktree.
 *
 * @returns {Promise<boolean>} Whether to carry on.
 */
async function runCheck(runId, command, turn) {
  let run = currentRun(runId, turn);
  if (!run) return false;

  const execution = crypto.randomUUID();
  const started = { id: execution, type: 'command', name: 'Check', command, status: 'running', startedAt: new Date().toISOString() };

  // Without its own .git, git in the check would walk up and act on the user's checkout.
  try {
    await worktreeManager.assertWorktreeRoot(run.worktree.path);
  } catch (err) {
    log('worktree.error', { runId, op: 'check_cwd', code: err.code, message: err.message });
    run = currentRun(runId, turn);
    if (!run) return false;
    run.status = 'failed';
    run.hook = {
      ...started,
      status:     'failed',
      exitCode:   null,
      outputTail: 'The worktree is missing or damaged, so this check did not run.',
      finishedAt: new Date().toISOString(),
    };
    writeRun(run);
    return false;
  }

  run = currentRun(runId, turn);
  if (!run) return false;
  run.hook = started;
  writeRun(run);
  log('check.started', { runId });

  const handle = runHookProcess({
    command,
    cwd:     run.worktree.path,
    logPath: path.join(runDir(runId), 'check.log'),
    env: {
      PRISM_RUN_ID:      run.runId,
      PRISM_SPACE_ID:    run.spaceId,
      PRISM_TASK_ID:     run.taskId,
      PRISM_BRANCH:      run.worktree.branch,
      PRISM_BASE_BRANCH: run.worktree.baseBranch || '',
    },
  });
  activeHooks.set(runId, handle);
  // Persisted so a restart can stop a check that outlived the server.
  run.hook.pid = handle.pid;
  writeRun(run);

  const outcome = await handle.done;
  if (activeHooks.get(runId) === handle) activeHooks.delete(runId);

  run = currentRun(runId, turn);
  if (!run || run.hook?.id !== execution) return false;

  const passed = outcome.exitCode === 0 && !outcome.timedOut;
  run.hook = {
    ...run.hook,
    status:     passed ? 'passed' : 'failed',
    exitCode:   outcome.exitCode,
    timedOut:   outcome.timedOut,
    outputTail: outcome.outputTail,
    finishedAt: new Date().toISOString(),
  };
  if (passed) run.checkPassed = command;
  else run.status = 'failed';
  writeRun(run);
  log(passed ? 'check.passed' : 'check.failed', { runId, exitCode: outcome.exitCode, timedOut: outcome.timedOut });

  // The check may have changed files (a formatter, a generated changelog).
  await save(runId);
  return passed;
}

/**
 * Open the pull request the space asks for. Having nothing to propose is not a failure:
 * an agent can rightly conclude that nothing had to change. Stop aborts it.
 *
 * @returns {Promise<boolean>} Whether to carry on.
 */
async function runAutoPullRequest(runId, turn) {
  let run = currentRun(runId, turn);
  if (!run) return false;
  // Unsaved work is not "nothing": it falls through to the failure that reports it.
  if (run.result?.fileCount === 0 && !run.result.saveError) return true;

  const execution = crypto.randomUUID();
  run.hook = { id: execution, type: 'pr', name: 'Pull request', status: 'running', startedAt: new Date().toISOString() };
  writeRun(run);

  const controller = new AbortController();
  const handle = { abort: () => controller.abort() };
  activeHooks.set(runId, handle);
  let failure = null;
  try {
    await openPullRequest(run, { signal: controller.signal });
  } catch (err) {
    failure = err.message;
  } finally {
    if (activeHooks.get(runId) === handle) activeHooks.delete(runId);
  }

  run = currentRun(runId, turn);
  if (!run || run.hook?.id !== execution) return false;
  run.hook = {
    ...run.hook,
    status:     failure ? 'failed' : 'passed',
    exitCode:   null,
    timedOut:   false,
    ...(failure && { outputTail: failure }),
    finishedAt: new Date().toISOString(),
  };
  if (failure) run.status = 'failed';
  writeRun(run);
  return !failure;
}

/**
 * What follows the agent: save the work, run what the space asks for, close the task.
 *
 * @param {string} runId
 */
async function finishRun(runId, signalledPid) {
  await save(runId, signalledPid);

  let run = readRun(runId);
  if (!run || run.status !== 'running') return; // Stopped while saving.

  // A failed check was kept for the agent's prompt. The agent has now seen it.
  run.hook = null;
  // A check would pass on code that is not on the branch, and the task would close
  // without the work.
  if (run.result?.saveError) {
    run.status = 'failed';
    writeRun(run);
    log('run.failed', { runId, reason: 'save_failed' });
    return;
  }
  run.turnId = run.turnId ?? crypto.randomUUID();
  const turn = run.turnId;
  writeRun(run);

  const { checkCommand, autoPr } = spaceHooks(run.spaceId);
  if (checkCommand && run.checkPassed !== checkCommand && !await runCheck(runId, checkCommand, turn)) return;
  if (autoPr && !await runAutoPullRequest(runId, turn)) return;

  run = currentRun(runId, turn);
  if (!run) return;
  run.status = 'completed';
  writeRun(run);
  log('run.completed', { runId, totalDurationMs: Date.now() - new Date(run.createdAt).getTime() });
  // Directly: the HTTP route refuses moves while a queued action holds the task's lock.
  // A person reviews it from here, unless the space says otherwise.
  const finishStatusId = _store.getSpace(run.spaceId)?.finishStatusId;
  if (finishStatusId) _store.moveTask(run.spaceId, run.taskId, finishStatusId, { actor: agentName(run) });
}

// ---------------------------------------------------------------------------
// The agent
// ---------------------------------------------------------------------------

/**
 * The agent's instructions, from the agent file without its frontmatter.
 *
 * @returns {string}
 */
function readSystemPrompt() {
  return fs.readFileSync(AGENT_FILE, 'utf8').replace(/^---\n[\s\S]*?\n---\n+/, '');
}

/**
 * Build the task prompt of an agent's turn.
 *
 * @param {object} run
 * @returns {string}
 */
function buildPrompt(run) {
  const { spaceId, taskId, runId } = run;
  const task = _store.getTask(spaceId, taskId);
  const cwd  = run.worktree.path;

  let prompt = `Task: ${task.key}: ${task.title}\n`;
  if (task.description) prompt += `Description: ${task.description}\n`;
  prompt += `TaskId: ${task.id}\nSpaceId: ${spaceId}\nRunId: ${runId}\n`;
  prompt += `\nWorking Directory: ${cwd}\n`;
  prompt += '⚠️ You MUST cd into this directory before starting work. All file paths should be relative to this directory.\n';

  const files = (task.attachments ?? []).filter((a) => a.type === 'file' && a.content);
  if (files.length > 0) {
    prompt += '\n## FILES ATTACHED TO THE TASK\n';
    for (const file of files) prompt += `- ${file.name}: ${file.content}\n`;
  }

  const comments = buildCommentsBlock(task.comments);
  if (comments) prompt += `\n${comments}\n`;

  const git = buildGitContextBlock(cwd);
  if (git) prompt += `${git}\n`;

  if (run.changeRequest) {
    prompt += `\n${buildChangeRequestBlock(run.changeRequest.text, run.worktree.baseRef ?? null)}\n`;
  }
  if (run.hook?.status === 'failed') {
    const what = run.hook.command ? ` (\`${run.hook.command}\`)` : '';
    prompt += `\n## FAILED CHECK\nThe check "${run.hook.name}"${what} failed after your last turn. Fix what it reports. Its output:\n\n${run.hook.outputTail}\n`;
  }
  prompt += `\n${buildDirectCardBlock(spaceId, taskId, AGENT_NAME)}\n`;
  return prompt;
}

function failAgent(run, reason, exitCode = -1) {
  run.agent.status        = 'failed';
  run.agent.exitCode      = exitCode;
  run.agent.finishedAt    = new Date().toISOString();
  run.agent.failureReason = reason;
  run.status              = 'failed';
  writeRun(run);
  log('run.failed', { runId: run.runId, reason, exitCode });
}

/**
 * Start a turn of the run's agent, in the run's worktree.
 *
 * @param {string} runId
 */
async function startAgent(runId) {
  let run = readRun(runId);
  if (!run || run.status !== 'running') return;

  // Never run an agent in the user's checkout because its worktree went missing.
  const missing = !fs.existsSync(path.join(run.worktree.path, '.git'));
  if (missing || activeSaves.has(runId) || startupSweep) {
    let restoreErr = null;
    try {
      await restoreWorktree(run);
    } catch (err) {
      restoreErr = err;
    }
    // The run may have been stopped or deleted while git was working.
    run = readRun(runId);
    if (!run || run.status !== 'running') return;
    if (restoreErr) {
      log('worktree.error', { runId, op: 'restore', code: restoreErr.code, message: restoreErr.message });
      failAgent(run, 'worktree_unavailable');
      return;
    }
  }

  // The agent is about to change the code, so what the check said about it no longer holds.
  delete run.checkPassed;

  const config  = run.agentConfig ?? DEFAULT_AGENT;
  const adapter = getAdapter(config.cliTool);

  run.agent = {
    ...run.agent,
    status:     'running',
    cliTool:    config.cliTool,
    model:      config.model ?? null,
    exitCode:   null,
    finishedAt: null,
    failureReason: null,
    startedAt:  new Date().toISOString(),
  };
  writeRun(run);

  let binary;
  try {
    binary = adapter.resolveBinary();
  } catch {
    failAgent(run, 'binary_missing');
    return;
  }

  const dir        = runDir(runId);
  const logPath    = agentLogPath(runId);
  const doneFile   = agentDonePath(runId);
  const promptPath = path.join(dir, 'prompt.md');
  const systemPath = path.join(dir, 'system.md');
  const systemPrompt = readSystemPrompt();

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(promptPath, buildPrompt(run), 'utf8');
  fs.writeFileSync(systemPath, systemPrompt, 'utf8');
  // A done file left by an earlier turn would end this one as soon as it starts. So would
  // its log: the watcher reads a final result event in it as the agent being done. The
  // old log stays beside the new one.
  try { fs.unlinkSync(doneFile); } catch { /* not present */ }
  try { fs.renameSync(logPath, `${logPath}.${Date.now()}`); } catch { /* not present */ }

  const mergedPromptPath = adapter.needsPromptFile
    ? adapter.buildPromptFile({ agentSpec: { systemPrompt }, taskPromptPath: promptPath, runDirPath: dir, stageIndex: 0 })
    : null;

  // The prompt goes in a file because it spans lines, which a Windows command line
  // cannot carry. There is nobody to answer a permission prompt.
  const finalArgs = [
    '--print', '--output-format', 'stream-json', '--verbose',
    '--append-system-prompt-file', systemPath,
    '--permission-mode', 'bypassPermissions',
    ...(config.model ? ['--model', config.model] : []),
  ];
  const commandOpts = { binary, model: config.model, mergedPromptPath, finalArgs, promptPath, logPath, doneFile };

  const child = process.platform === 'win32'
    // /V:ON evaluates !ERRORLEVEL! after the CLI exits, not at parse time.
    ? spawn('cmd.exe', ['/V:ON', '/C', adapter.buildWindowsCommand(commandOpts)], { stdio: 'ignore', detached: true, cwd: run.worktree.path, env: { ...process.env } })
    : spawn('sh', ['-c', adapter.buildUnixCommand(commandOpts)], { stdio: 'ignore', detached: true, cwd: run.worktree.path, env: { ...process.env } });

  // The agent keeps running if the server restarts.
  child.unref();

  // On macOS, prevent idle sleep while the agent runs.
  if (process.platform === 'darwin' && child.pid) {
    spawn('caffeinate', ['-w', String(child.pid)], { stdio: 'ignore' }).unref();
  }

  run.agent.pid = child.pid;
  writeRun(run);
  log('agent.spawned', { runId, pid: child.pid, cliTool: config.cliTool, model: config.model ?? null });

  watchAgent(runId, Date.now(), adapter.streamsProgress !== false);

  child.on('error', (err) => {
    stopWatching(runId);
    const current = readRun(runId);
    if (current?.agent.status === 'running') failAgent(current, 'spawn_error');
    log('agent.spawn_error', { runId, error: err.message });
  });
}

function stopWatching(runId) {
  const timer = activeAgents.get(runId);
  if (timer) clearInterval(timer);
  activeAgents.delete(runId);
}

function readExitCode(doneFile) {
  try {
    const code = parseInt(fs.readFileSync(doneFile, 'utf8').trim(), 10);
    return Number.isNaN(code) ? 1 : code;
  } catch {
    return 1;
  }
}

/**
 * Watch a running agent for its done file, its time limit and a lack of output.
 *
 * @param {string} runId
 * @param {number} startedAt  - When the agent started, in ms.
 * @param {boolean} stallWatch - False for a harness that buffers its output until it
 *   exits: a log that does not grow says nothing about it.
 */
function watchAgent(runId, startedAt, stallWatch) {
  const timeoutMs = envInt('PRISM_AGENT_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const stallMs   = envInt('PRISM_STALL_TIMEOUT_MS', DEFAULT_STALL_MS);
  const logPath   = agentLogPath(runId);
  const doneFile  = agentDonePath(runId);
  let lastOutput  = startedAt;

  const tick = async () => {
    if (fs.existsSync(doneFile)) {
      stopWatching(runId);
      // Whatever the agent left running (a browser, a dev server) ends with it.
      const pid = readRun(runId)?.agent.pid;
      killGroup(pid);
      await handleAgentExit(runId, readExitCode(doneFile), pid);
      return;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      stopWatching(runId);
      await killAgent(runId, 'timeout');
      return;
    }

    // Claude can finish its output and then hang shutting down its tools. A write here
    // is harmless if the agent's own exit writes the file too: the first one wins.
    let stat = null;
    try { stat = fs.statSync(logPath); } catch { /* not created yet */ }
    if (stat?.size > 0) {
      try {
        const size = Math.min(stat.size, LOG_TAIL_BYTES);
        const buf  = Buffer.allocUnsafe(size);
        const fd   = fs.openSync(logPath, 'r');
        try { fs.readSync(fd, buf, 0, size, stat.size - size); } finally { fs.closeSync(fd); }
        const match = buf.toString('utf8').match(/"terminal_reason":"([^"]+)"/);
        if (match) fs.writeFileSync(doneFile, match[1] === 'completed' ? '0' : '1', 'utf8');
      } catch { /* the next tick looks again */ }
    }

    if (stat && stat.mtimeMs > lastOutput) lastOutput = stat.mtimeMs;
    if (stallWatch && Date.now() - lastOutput >= stallMs) {
      stopWatching(runId);
      await killAgent(runId, 'stall');
    }
  };

  const timer = setInterval(() => {
    tick().catch((err) => log('agent.watch_error', { runId, message: err.message }));
  }, Number(process.env.PRISM_POLL_INTERVAL_MS) || DEFAULT_POLL_MS);
  timer.unref();
  activeAgents.set(runId, timer);
}

/**
 * Kill an agent that ran out of time, and save what it did.
 *
 * @param {string} runId
 * @param {'timeout'|'stall'} reason
 */
async function killAgent(runId, reason) {
  const run = readRun(runId);
  if (run?.agent.status !== 'running') return;
  const { pid } = run.agent;
  killGroup(pid);
  failAgent(run, reason, null);
  await save(runId, pid);
}

/**
 * The agent exited. It either failed, asked something, or finished.
 *
 * @param {string} runId
 * @param {number} exitCode
 * @param {number} [signalledPid] - Its process group, just signalled.
 */
async function handleAgentExit(runId, exitCode, signalledPid) {
  const run = readRun(runId);
  // Stopped, or killed for its time limit, in the meantime.
  if (run?.agent.status !== 'running') return;

  if (exitCode !== 0) {
    failAgent(run, null, exitCode);
    await save(runId, signalledPid);
    return;
  }

  run.agent.status     = 'completed';
  run.agent.exitCode   = 0;
  run.agent.finishedAt = new Date().toISOString();

  const questions = openQuestions(run);
  if (questions.length > 0) {
    const [question] = questions;
    run.status = 'blocked';
    run.blockedReason = { commentId: question.id, author: question.author, text: question.text, blockedAt: new Date().toISOString() };
    writeRun(run);
    log('run.blocked', { runId, commentId: question.id });
    return;
  }

  // The user answered while the agent was still going, so it has not seen the answer.
  if (run.answeredDuringTurn) {
    log('agent.turn_for_answer', { runId });
    await waitForExit(signalledPid);
    launchTurn(run);
    return;
  }

  writeRun(run);
  log('agent.done', { runId });
  await finishRun(runId, signalledPid);
}

async function restoreWorktree(run) {
  // A save in flight or the startup sweep could be touching the worktree.
  await activeSaves.get(run.runId);
  await startupSweep;
  await worktreeManager.restore(run.workingDirectory, run.worktree, { runId: run.runId });
}

/**
 * Set a run up for another turn of its agent, and start it. The caller holds the lock.
 *
 * @param {object} run
 * @param {object} [opts]
 * @param {boolean} [opts.newTurn] - The user gave the agent something new to work on.
 */
function launchTurn(run, { newTurn = true } = {}) {
  run.agent = { ...run.agent, status: 'pending', pid: null };
  if (newTurn) run.iteration = (run.iteration ?? 1) + 1;
  // A failed check stays on the run: the agent's prompt shows it.
  if (run.hook?.status !== 'failed') run.hook = null;
  delete run.blockedReason;
  delete run.answeredDuringTurn;
  delete run.closedAt; // Its worktree is back.
  // A branch of unsaved work from an earlier turn may be gone by now.
  if (run.result) run.result.ref = null;
  run.status = 'running';
  run.turnId = crypto.randomUUID();
  writeRun(run);
  setImmediate(() => {
    startAgent(run.runId).catch((err) => {
      log('agent.start_error', { runId: run.runId, message: err.message });
      const current = readRun(run.runId);
      if (current?.status === 'running') failAgent(current, 'spawn_error');
    });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pick up where the last server left off. Runs from the pipeline versions end here: they
 * stay on record, but nothing can continue them.
 *
 * @param {string} dataDir
 * @param {object} store
 */
function init(dataDir, store) {
  _dataDir = dataDir;
  _store   = store;
  fs.mkdirSync(process.env.PIPELINE_RUNS_DIR || path.join(dataDir, 'runs'), { recursive: true });

  const workingDirs = new Set();
  const stopped = [];
  for (const stored of store.listActiveRuns()) {
    try {
      if (stored.workingDirectory) workingDirs.add(stored.workingDirectory);
      if (!isTaskRun(stored)) {
        stopped.push(...endOldRun(stored));
        continue;
      }
      recoverRun(stored);
    } catch (err) {
      log('run.recover_error', { runId: stored.runId, message: err.message });
    }
  }

  if (workingDirs.size > 0) {
    // After the old agents exit, since the sweep saves and removes their worktrees.
    const sweep = Promise.all(stopped.map(waitForExit))
      .then(() => worktreeManager.reapOrphans(dataDir, [...workingDirs], store))
      .catch((err) => {
        log('worktree.error', { op: 'reap_orphans', message: err.message });
      })
      .finally(() => {
        if (startupSweep === sweep) startupSweep = null;
      });
    startupSweep = sweep;
  }
}

/**
 * End a run from a pipeline version, along with an agent of it that survived the upgrade.
 *
 * @param {object} run
 * @returns {number[]} The process groups signalled.
 */
function endOldRun(run) {
  const pids = !run.worktree ? [] : (run.stageStatuses ?? [])
    .filter((stage) => stage.status === 'running')
    .map((stage) => killLeftover(run, stage.pid))
    .filter(Boolean);
  run.status = 'interrupted';
  writeRun(run);
  log('run.legacy_interrupted', { runId: run.runId });
  return pids;
}

function recoverRun(run) {
  const { runId } = run;
  if (run.status === 'blocked') return; // Nothing runs: it waits for an answer.

  const interrupt = (signalledPid) => {
    run.status = 'interrupted';
    if (run.agent.status === 'running') {
      run.agent.status     = 'interrupted';
      run.agent.finishedAt = new Date().toISOString();
    }
    if (run.hook?.status === 'running') run.hook.status = 'interrupted';
    writeRun(run);
    save(runId, signalledPid);
    log('run.interrupted', { runId });
  };

  if (run.agent.status !== 'running') {
    interrupt(run.hook?.status === 'running' ? killLeftover(run, run.hook.pid) : undefined);
    return;
  }

  // The agent finished while the server was down.
  const doneFile = agentDonePath(runId);
  if (fs.existsSync(doneFile)) {
    const pid = killLeftover(run, run.agent.pid);
    handleAgentExit(runId, readExitCode(doneFile), pid).catch((err) => {
      log('agent.exit_error', { runId, message: err.message });
    });
    return;
  }

  // The agent survived the restart.
  if (isGroupAlive(run.agent.pid) && isRunsProcess(run, run.agent.pid)) {
    const startedAt = run.agent.startedAt ? new Date(run.agent.startedAt).getTime() : Date.now();
    watchAgent(runId, startedAt, getAdapter(run.agent.cliTool).streamsProgress !== false);
    log('run.reattached', { runId, pid: run.agent.pid });
    return;
  }

  interrupt();
}

/**
 * @throws MAX_CONCURRENT_REACHED when as many runs as allowed are going.
 */
function assertRoomForRun() {
  const maxRuns = envInt('PRISM_MAX_RUNS', DEFAULT_MAX_RUNS);
  const going = _store.listActiveRuns().filter((run) => isTaskRun(run) && run.status === 'running').length;
  if (going + creatingRuns >= maxRuns) {
    throw runnerError('MAX_CONCURRENT_REACHED', `Maximum concurrent runs (${maxRuns}) reached.`);
  }
}

/**
 * Give a task to an agent, in a new worktree and branch.
 *
 * @param {object} params
 * @param {string} params.spaceId
 * @param {string} params.taskId
 * @param {string} params.workingDirectory - The space's git repository.
 * @param {object|null} [params.agentConfig] - { cliTool, model, provider }.
 * @returns {Promise<object>} The new run.
 * @throws NOT_A_GIT_REPO, RUN_ACTIVE, TASK_NOT_FOUND, TASK_NOT_IN_TODO,
 *   MAX_CONCURRENT_REACHED, WORKTREE_PROVISION_FAILED.
 */
async function createRun({ spaceId, taskId, workingDirectory, agentConfig = null }) {
  if (!workingDirectory) {
    throw runnerError('NOT_A_GIT_REPO', 'This space has no working directory. Set one to a git repository to run tasks.');
  }

  return withTaskLock(taskId, async () => {
    if (_store.findActiveRunByTaskId(taskId)) {
      throw runnerError('RUN_ACTIVE', `Task '${taskId}' already has an active run.`);
    }

    const found = _store.getTaskWithColumn(spaceId, taskId);
    if (!found) throw runnerError('TASK_NOT_FOUND', `Task '${taskId}' not found in space '${spaceId}'.`);
    // A task left in progress can start again, e.g. after it was stopped.
    if (found.column === 'done') {
      throw runnerError('TASK_NOT_IN_TODO', `Task '${taskId}' is already done.`);
    }
    assertNotEpic(found.task);
    // Starting over would drop the finished work from the card. A person decides first:
    // ask for changes, or move the card back to run it again.
    const finished = listRunViews(spaceId)[taskId];
    if (finished?.status === 'done' && found.task.statusId === _store.getSpace(spaceId).finishStatusId) {
      throw runnerError('TASK_AWAITING_REVIEW', 'This task is waiting for review. Ask for changes, or move it back to run it again.');
    }

    assertRoomForRun();
    creatingRuns++;

    const runId = crypto.randomUUID();
    // Before the run exists, so a failure leaves nothing behind and the task where it was.
    let worktree;
    try {
      worktree = await worktreeManager.provision(workingDirectory, runId);
    } catch (err) {
      creatingRuns--;
      if (err.code !== 'NOT_A_GIT_REPO') err.code = 'WORKTREE_PROVISION_FAILED';
      throw err;
    }
    // Provisioning takes a while, and its space may be gone by now.
    if (!_store.getTask(spaceId, taskId)) {
      creatingRuns--;
      await worktreeManager.teardown(worktree).catch(() => {});
      throw runnerError('TASK_NOT_FOUND', `Task '${taskId}' not found in space '${spaceId}'.`);
    }

    const now = new Date().toISOString();
    const run = {
      runId,
      spaceId,
      taskId,
      status: 'running',
      direct: true,
      iteration: 1,
      turnId: crypto.randomUUID(),
      agent: { status: 'pending', exitCode: null, startedAt: null, finishedAt: null, failureReason: null, pid: null },
      workingDirectory,
      worktree,
      ...(agentConfig && { agentConfig }),
      createdAt: now,
      updatedAt: now,
    };
    fs.mkdirSync(runDir(runId), { recursive: true });
    writeRun(run);
    creatingRuns--;
    log('run.created', { runId, spaceId, taskId });

    moveToInProgress(run);
    setImmediate(() => {
      startAgent(runId).catch((err) => {
        log('agent.start_error', { runId, message: err.message });
        const current = readRun(runId);
        if (current?.status === 'running') failAgent(current, 'spawn_error');
      });
    });

    // A task shows its latest run. Earlier ones no longer need their worktrees.
    closeTaskRuns(spaceId, taskId, runId).catch(() => {});
    return run;
  });
}

/**
 * What the board needs to know about a run.
 *
 * @param {object} run
 * @returns {object}
 */
function runView(run) {
  const STATUS = {
    pending:     'working',
    running:     run.agent.status === 'completed' ? 'checking' : 'working',
    blocked:     'question',
    failed:      'failed',
    interrupted: 'stopped',
    completed:   'done',
  };

  let failure = null;
  if (run.status === 'failed' && run.agent.status === 'completed' && run.result?.saveError) {
    failure = { kind: 'save', exitCode: null, timedOut: false };
  } else if (run.status === 'failed' && run.agent.status === 'completed' && run.hook?.status === 'failed') {
    failure = { kind: run.hook.type === 'pr' ? 'pr' : 'check', exitCode: run.hook.exitCode ?? null, timedOut: !!run.hook.timedOut };
  } else if (run.status === 'failed') {
    failure = { kind: 'agent', exitCode: run.agent.exitCode ?? null, reason: run.agent.failureReason ?? null };
  }

  return {
    runId:     run.runId,
    taskId:    run.taskId,
    status:    STATUS[run.status] ?? 'stopped',
    cliTool:   run.agent.cliTool ?? run.agentConfig?.cliTool ?? DEFAULT_AGENT.cliTool,
    model:     run.agent.model ?? run.agentConfig?.model ?? null,
    iteration: run.iteration ?? 1,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    closedAt:  run.closedAt ?? null,
    result:    run.result ?? null,
    hook:      run.hook ?? null,
    failure,
  };
}

/**
 * The latest run of each task in a space, as the board shows them.
 *
 * @param {string} spaceId
 * @returns {Record<string, object>} taskId → view.
 */
function listRunViews(spaceId) {
  const views = {};
  for (const run of _store.listRunsBySpace(spaceId)) { // Newest first.
    if (isTaskRun(run) && !views[run.taskId]) views[run.taskId] = runView(run);
  }
  return views;
}

/**
 * Whether a task has a run that has not ended, or an action on it in flight: a worktree
 * may be being created for a run that is not on record yet.
 *
 * @param {string} taskId
 * @returns {boolean}
 */
function hasActiveRun(taskId) {
  return taskLocks.has(taskId) || isTaskRun(_store.findActiveRunByTaskId(taskId));
}

/**
 * @param {string} spaceId
 * @returns {boolean} Whether a space has a run that has not ended.
 */
function spaceHasActiveRun(spaceId) {
  // One being set up holds its task's lock before it is written down.
  if ([...taskLocks.keys()].some((taskId) => _store.getTask(spaceId, taskId))) return true;
  return _store.listActiveRuns().some((run) => isTaskRun(run) && run.spaceId === spaceId);
}

/**
 * Remove a finished run's worktree. Its branch stays, so the work remains reachable and
 * asking for changes recreates the worktree from it.
 *
 * @param {string} runId
 * @returns {Promise<object>} Updated run.
 * @throws RUN_NOT_FOUND, RUN_ACTIVE, WORKTREE_KEPT.
 */
async function closeRun(runId) {
  const { taskId } = requireRun(runId);
  return withTaskLock(taskId, async () => {
    const run = requireRun(runId);
    if (ACTIVE_STATUSES.includes(run.status)) {
      throw runnerError('RUN_ACTIVE', `Run '${runId}' is still active.`);
    }

    await activeSaves.get(runId);
    const { keptError } = await worktreeManager.teardown(run.worktree, { reason: 'closed', runId });
    if (keptError) {
      throw runnerError('WORKTREE_KEPT', `The worktree was kept because its work could not be saved: ${keptError}`);
    }

    const fresh = readRun(runId);
    if (!fresh) return null;
    fresh.closedAt = new Date().toISOString();
    writeRun(fresh);
    log('run.closed', { runId });
    return fresh;
  });
}

/**
 * Remove the worktrees of a task's ended runs, ignoring failures because the caller has
 * already moved on (the task was deleted, or a new run replaced them).
 *
 * @param {string} spaceId
 * @param {string} taskId
 * @param {string} [exceptRunId]
 */
async function closeTaskRuns(spaceId, taskId, exceptRunId) {
  for (const run of _store.listRunsBySpace(spaceId)) {
    if (!isTaskRun(run) || run.taskId !== taskId || run.closedAt || run.runId === exceptRunId) continue;
    try {
      await closeRun(run.runId);
    } catch (err) {
      log('worktree.error', { runId: run.runId, op: 'close', code: err.code, message: err.message });
    }
  }
}

/**
 * Remove the worktrees of a space's ended runs, ignoring failures, when its tasks go away.
 *
 * @param {string} spaceId
 */
async function closeSpaceRuns(spaceId) {
  for (const run of _store.listRunsBySpace(spaceId)) {
    if (!isTaskRun(run) || run.closedAt) continue;
    try {
      await closeRun(run.runId);
    } catch (err) {
      log('worktree.error', { runId: run.runId, op: 'close', code: err.code, message: err.message });
    }
  }
}

/**
 * Relaunch a run's agent in the same worktree with what the user asked for. The agent
 * sees the request and the task's comments in a new process. A worktree that was closed
 * is recreated from the run branch.
 *
 * @param {string} runId
 * @param {string} text - What the user asked for.
 * @returns {Promise<object>} Updated run.
 * @throws RUN_NOT_FOUND, RUN_ACTIVE, WORKTREE_UNAVAILABLE.
 */
async function requestChanges(runId, text) {
  const { taskId } = requireRun(runId);
  const stops = stopCounts.get(runId);
  return withTaskLock(taskId, async () => {
    let run = requireRun(runId);
    if (ACTIVE_STATUSES.includes(run.status)) {
      throw runnerError('RUN_ACTIVE', `Run '${runId}' is still active.`);
    }
    assertRoomForRun();

    // Before changing anything, so that a failure leaves the run as it was.
    try {
      await restoreWorktree(run);
    } catch (err) {
      throw runnerError('WORKTREE_UNAVAILABLE', `Run '${runId}' cannot continue: its worktree could not be restored. ${err.message}`);
    }

    run = requireRun(runId);
    if (ACTIVE_STATUSES.includes(run.status)) {
      throw runnerError('RUN_ACTIVE', `Run '${runId}' changed while its worktree was being restored.`);
    }
    if (stopCounts.get(runId) !== stops) {
      throw runnerError('RUN_ACTIVE', `Run '${runId}' was stopped while this was waiting.`);
    }

    assertNotEpic(_store.getTask(run.spaceId, run.taskId));
    // The agent reads the task's comments in its prompt, so this goes first.
    const now  = new Date().toISOString();
    _store.addComment(run.spaceId, run.taskId, {
      id: crypto.randomUUID(), author: 'user', text, type: 'note', changeRequest: true,
      resolved: false, createdAt: now,
    });

    run.changeRequest = { text, at: now };
    launchTurn(run);
    moveToInProgress(run);
    return run;
  });
}

/**
 * Try a stopped or failed run again. If the agent had finished, only what follows it runs
 * again.
 *
 * @param {string} runId
 * @returns {Promise<object>} Updated run.
 * @throws RUN_NOT_FOUND, RUN_NOT_RESUMABLE, OPEN_QUESTION, WORKTREE_UNAVAILABLE.
 */
async function resumeRun(runId) {
  const { taskId } = requireRun(runId);
  const stops = stopCounts.get(runId);
  return withTaskLock(taskId, async () => {
    let run = requireRun(runId);
    if (!RESUMABLE_STATUSES.includes(run.status)) {
      throw runnerError('RUN_NOT_RESUMABLE', `Run '${runId}' has status '${run.status}' and cannot be resumed.`);
    }
    assertNotEpic(_store.getTask(run.spaceId, run.taskId));
    // The agent stops to ask. Resuming must not take that for the end of the work.
    if (run.blockedReason && openQuestions(run).length > 0) {
      throw runnerError('OPEN_QUESTION', 'Answer the open question first.');
    }
    assertRoomForRun();

    try {
      await restoreWorktree(run);
    } catch (err) {
      throw runnerError('WORKTREE_UNAVAILABLE', `Run '${runId}' cannot resume: its worktree could not be restored. ${err.message}`);
    }

    run = readRun(runId);
    if (!run || !RESUMABLE_STATUSES.includes(run.status)) {
      throw runnerError('RUN_NOT_RESUMABLE', `Run '${runId}' changed while its worktree was being restored and cannot be resumed.`);
    }
    if (stopCounts.get(runId) !== stops) {
      throw runnerError('RUN_NOT_RESUMABLE', `Run '${runId}' was stopped while this was waiting.`);
    }

    // It may have been moved by hand since it stopped.
    moveToInProgress(run);

    if (run.agent.status === 'completed' && !run.blockedReason) {
      run.status = 'running';
      run.turnId = crypto.randomUUID();
      delete run.closedAt;
      writeRun(run);
      log('run.resumed', { runId, agent: false });
      finishRun(runId).catch((err) => log('run.finish_error', { runId, message: err.message }));
      return run;
    }

    log('run.resumed', { runId, agent: true });
    launchTurn(run, { newTurn: !!run.blockedReason });
    return run;
  });
}

/**
 * A question on a task was answered. Once none is open, the agent that asked runs again
 * with the answers in its prompt.
 *
 * @param {string} taskId
 */
function questionAnswered(taskId) {
  const found = _store.findActiveRunByTaskId(taskId);
  if (!isTaskRun(found)) return;
  if (found.status === 'running' && found.agent.status === 'running') {
    found.answeredDuringTurn = true;
    writeRun(found);
    return;
  }
  if (found.status !== 'blocked') return;
  // Not limited by PRISM_MAX_RUNS: the user would lose the answer's turn.
  withTaskLock(taskId, async () => {
    const run = readRun(found.runId);
    if (run?.status !== 'blocked' || openQuestions(run).length > 0) return;
    log('run.unblocked', { runId: run.runId });
    launchTurn(run);
  }).catch((err) => log('run.unblock_error', { taskId, message: err.message }));
}

/**
 * Stop whatever a run is doing and save what it did. It can be resumed later.
 *
 * @param {string} runId
 * @returns {Promise<object|null>} Updated run, or null if it does not exist.
 */
async function stopRun(runId) {
  const run = readRun(runId);
  if (!run) return null;
  stopCounts.set(runId, (stopCounts.get(runId) ?? 0) + 1);
  if (!ACTIVE_STATUSES.includes(run.status)) return run;

  let stoppedPid;
  stopWatching(runId);
  if (run.agent.status === 'running') {
    stoppedPid = run.agent.pid;
    killGroup(stoppedPid);
    run.agent.status     = 'interrupted';
    run.agent.finishedAt = new Date().toISOString();
    log('run.stopped', { runId, pid: stoppedPid });
  }

  const hook = activeHooks.get(runId);
  if (hook) {
    activeHooks.delete(runId);
    hook.abort?.();
    if (hook.pid) {
      killGroup(hook.pid);
      stoppedPid = hook.pid;
    }
  }
  if (run.hook?.status === 'running') run.hook.status = 'interrupted';

  run.turnId = crypto.randomUUID();
  run.status = 'interrupted';
  writeRun(run);

  save(runId, stoppedPid);
  return run;
}

/**
 * Create the pull request of a task's run, or push what is new to the one it has.
 *
 * @param {string} runId
 * @returns {Promise<object>} Updated run.
 * @throws RUN_NOT_FOUND, RUN_ACTIVE, PR_FAILED.
 */
async function createPullRequest(runId) {
  const { taskId } = requireRun(runId);
  return withTaskLock(taskId, async () => {
    await activeSaves.get(runId); // A stop just before this is still saving the work.
    const run = requireRun(runId);
    if (ACTIVE_STATUSES.includes(run.status)) {
      throw runnerError('RUN_ACTIVE', 'Wait for the agent to finish.');
    }
    if (run.result?.fileCount === 0 && !run.result.saveError) {
      throw runnerError('PR_FAILED', 'The agent changed nothing, so there is no pull request to open.');
    }
    await openPullRequest(run);
    log('pr.opened', { runId });
    return readRun(runId);
  });
}

/**
 * The output of a run's latest agent turn, as readable text.
 *
 * @param {string} runId
 * @returns {string|null} Null when there is no output yet.
 */
function readAgentLog(runId) {
  try {
    return normalize(fs.readFileSync(agentLogPath(runId), 'utf8')).content;
  } catch {
    return null;
  }
}

/**
 * Kill every running agent and check. For test teardown.
 */
async function abortAll() {
  const runIds = [...new Set([...activeAgents.keys(), ...activeHooks.keys()])];
  await Promise.all(runIds.map(async (runId) => {
    const run = readRun(runId);
    stopWatching(runId);
    const hook = activeHooks.get(runId);
    activeHooks.delete(runId);
    hook?.abort?.();
    const pids = [run?.agent.pid, hook?.pid].filter(Boolean);
    pids.forEach((pid) => killGroup(pid));
    await Promise.all(pids.map(waitForExit));
    await activeSaves.get(runId);
    if (run) _store.deleteRun(runId);
  }));
}

/** @returns {number} Agents running in this server. */
function getActiveProcessCount() {
  return activeAgents.size;
}

function getRun(runId) {
  return readRun(runId);
}

module.exports = {
  init,
  createRun,
  getRun,
  listRunViews,
  hasActiveRun,
  spaceHasActiveRun,
  closeRun,
  closeTaskRuns,
  closeSpaceRuns,
  requestChanges,
  resumeRun,
  stopRun,
  createPullRequest,
  questionAnswered,
  readAgentLog,
  abortAll,
  getActiveProcessCount,
};
