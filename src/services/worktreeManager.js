/**
 * Prism — Worktree Manager
 *
 * Provisions, tears down, and garbage-collects git worktrees for parallel
 * pipeline runs. Each run that conflicts with an already-active run in the
 * same workingDirectory receives an isolated worktree so the two runs cannot
 * race on git operations.
 *
 * ADR-1 (parallel-worktrees) describes the design.
 *
 * Environment variables:
 *   PIPELINE_WORKTREE_ENABLED          - '0' disables all worktree provisioning (default: '1')
 *   PIPELINE_WORKTREE_DIR              - Subdirectory under workingDirectory (default: '.worktrees')
 *   PIPELINE_DELETE_BRANCH_ON_FAILURE  - '1' deletes the branch on non-completed teardown if it has no commits (default: '0')
 */

'use strict';

const fs        = require('fs');
const path      = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Structured error thrown by worktreeManager operations.
 * `.code` is one of: NOT_A_GIT_REPO | WORKTREE_EXISTS | GIT_ERROR
 */
class WorktreeError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   */
  constructor(message, code) {
    super(message);
    this.name = 'WorktreeError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Run a git command inside a directory.
 * Returns { stdout, stderr } on success.
 * Throws WorktreeError(GIT_ERROR) if the command exits non-zero.
 *
 * @param {string}   cwd   - Working directory for git.
 * @param {string[]} args  - git arguments (no shell interpolation).
 * @param {object}  [opts] - Extra execFile options (e.g. { timeout }).
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runGit(cwd, args, opts = {}) {
  try {
    return await execFileAsync('git', ['-C', cwd, ...args], {
      timeout: 30_000,
      encoding: 'utf8',
      ...opts,
    });
  } catch (err) {
    // execFile rejects with an error that has `.stderr` on non-zero exit.
    const message = err.stderr?.trim() || err.message;
    throw new WorktreeError(`git ${args[0]} failed: ${message}`, 'GIT_ERROR');
  }
}

// `add`, `status` and `commit` scale with the number of files an agent left behind.
const SAVE_GIT_OPTS = { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 };

// Beyond this a patch is unreadable in the card's detail panel.
const MAX_PATCH_BYTES = 1024 * 1024;

/**
 * Emit a structured worktree log event to stderr.
 *
 * @param {string} event
 * @param {object} payload
 */
function worktreeLog(event, payload = {}) {
  process.stderr.write(
    `[PIPELINE] ${JSON.stringify({ event, ...payload, ts: new Date().toISOString() })}\n`
  );
}

/**
 * Return the worktree subdirectory name from env or default.
 *
 * @returns {string}
 */
function worktreeSubdir() {
  return process.env.PIPELINE_WORKTREE_DIR || '.worktrees';
}

/**
 * Short run ID prefix used for branch/path names (first 8 chars).
 *
 * @param {string} runId
 * @returns {string}
 */
function shortRunId(runId) {
  return runId.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Provision a git worktree for the given run.
 *
 * Creates:
 *   path:   <workingDirectory>/<PIPELINE_WORKTREE_DIR>/run-<short>
 *   branch: pipeline/run-<short>   (branched off current HEAD of workingDirectory)
 *
 * baseBranch is null when the parent HEAD is detached.
 *
 * Throws WorktreeError with code:
 *   NOT_A_GIT_REPO   — workingDirectory is not a git repo
 *   WORKTREE_EXISTS  — target path already exists
 *   GIT_ERROR        — any other git failure
 *
 * Does NOT mutate the parent checkout (no branch switch, no commit).
 *
 * @param {string} workingDirectory - Absolute path to the git repository root.
 * @param {string} runId            - Pipeline run UUID.
 * @returns {Promise<{ path: string, branch: string, baseBranch: string|null, baseRef: string }>}
 */
async function provision(workingDirectory, runId) {
  const t0    = Date.now();
  const short = shortRunId(runId);

  // --- Guard: verify it's a git repo ---
  try {
    await execFileAsync('git', ['-C', workingDirectory, 'rev-parse', '--git-dir'], {
      timeout: 5_000,
      encoding: 'utf8',
    });
  } catch {
    throw new WorktreeError(
      `'${workingDirectory}' is not a git repository.`,
      'NOT_A_GIT_REPO'
    );
  }

  // --- Resolve HEAD commit ---
  let baseRef;
  try {
    const { stdout } = await execFileAsync(
      'git', ['-C', workingDirectory, 'rev-parse', 'HEAD'],
      { timeout: 5_000, encoding: 'utf8' }
    );
    baseRef = stdout.trim();
  } catch {
    throw new WorktreeError(
      `Failed to resolve HEAD in '${workingDirectory}'.`,
      'GIT_ERROR'
    );
  }

  // --- Resolve current branch (null when HEAD is detached) ---
  let baseBranch = null;
  try {
    const { stdout } = await execFileAsync(
      'git', ['-C', workingDirectory, 'symbolic-ref', '--short', 'HEAD'],
      { timeout: 5_000, encoding: 'utf8' }
    );
    baseBranch = stdout.trim();
  } catch {
    // symbolic-ref exits non-zero when HEAD is detached. The run branch can still
    // start from that commit, and the run must not fall back to the user's checkout.
  }

  // --- Determine worktree path ---
  const worktreePath = path.join(workingDirectory, worktreeSubdir(), `run-${short}`);
  const branch       = `pipeline/run-${short}`;

  // --- Guard: target path must not already exist ---
  if (fs.existsSync(worktreePath)) {
    throw new WorktreeError(
      `Worktree path '${worktreePath}' already exists.`,
      'WORKTREE_EXISTS'
    );
  }

  await excludeWorktreeDir(workingDirectory);

  // --- Create the worktree ---
  // git worktree add <path> -b <branch> <baseRef>
  // argv-based — no shell interpolation.
  await runGit(workingDirectory, ['worktree', 'add', worktreePath, '-b', branch, baseRef]);

  const durationMs = Date.now() - t0;
  worktreeLog('worktree.created', { runId, path: worktreePath, branch, baseRef, baseBranch, durationMs });

  return { path: worktreePath, branch, baseBranch, baseRef };
}

/**
 * Keep the worktrees directory out of the user's `git status` through the repo's
 * local exclude file, so nothing in their history changes. Best-effort.
 *
 * @param {string} workingDirectory
 */
async function excludeWorktreeDir(workingDirectory) {
  const pattern = `${worktreeSubdir().replace(/\/+$/, '')}/`;
  try {
    const { stdout } = await runGit(workingDirectory, ['rev-parse', '--git-common-dir']);
    const excludeFile = path.join(path.resolve(workingDirectory, stdout.trim()), 'info', 'exclude');
    const current = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
    if (current.split('\n').includes(pattern)) return;
    fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
    const separator = current === '' || current.endsWith('\n') ? '' : '\n';
    fs.appendFileSync(excludeFile, `${separator}${pattern}\n`);
  } catch (err) {
    worktreeLog('worktree.error', { op: 'exclude', message: err.message });
  }
}

/**
 * Throw unless the directory is the root of a worktree. A leftover directory
 * without its own .git file would make git walk up to the user's checkout.
 *
 * @param {string} worktreePath
 */
async function assertWorktreeRoot(worktreePath) {
  const { stdout: toplevel } = await runGit(worktreePath, ['rev-parse', '--show-toplevel']);
  if (fs.realpathSync(toplevel.trim()) !== fs.realpathSync(worktreePath)) {
    throw new WorktreeError(`'${worktreePath}' is not a worktree root.`, 'GIT_ERROR');
  }
}

/**
 * Commit whatever the agent left uncommitted in a worktree, so removing the
 * worktree cannot lose it. Gitignored files are not saved.
 *
 * The user's hooks, signing config and identity must not be able to block the
 * commit, so they are overridden. If the agent ended anywhere but the run branch,
 * resuming from that branch would not see the work (and on a detached HEAD it becomes
 * unreachable), so a `<branch>-saved` branch is pointed at it.
 *
 * Throws WorktreeError(GIT_ERROR) when the work could not be saved or the worktree
 * still holds something a commit cannot capture (a nested repo, a dirty submodule).
 *
 * @param {{ path: string, branch: string }} worktreeMeta
 * @param {object} [opts]
 * @param {string} [opts.reason='unknown'] - Reason for saving (commit message).
 * @param {string} [opts.runId]            - Run ID (for observability).
 * @returns {Promise<{ saved: boolean, ref: string|null }>} Whether a new commit was
 *   created, and the branch holding the work when it is not the run branch.
 */
async function saveWork(worktreeMeta, opts = {}) {
  const { path: worktreePath, branch } = worktreeMeta;
  const reason = opts.reason || 'unknown';
  const git    = (args) => runGit(worktreePath, args, SAVE_GIT_OPTS);

  await assertWorktreeRoot(worktreePath);

  const status = () => git(['status', '--porcelain', '--untracked-files=normal', '--ignore-submodules=none']);

  let saved = false;
  if ((await status()).stdout.trim() !== '') {
    await git(['add', '-A']);

    // A gitlink records only a commit id, and that commit dies with the worktree.
    const { stdout: raw } = await git(['diff', '--cached', '--raw', '--no-abbrev']);
    const gitlink = raw.split('\n').find((line) => /^:\d+ 160000 /.test(line));
    if (gitlink) {
      throw new WorktreeError(`Nested repository cannot be saved: ${gitlink.split('\t')[1]}`, 'GIT_ERROR');
    }

    const { stdout: names } = await git(['diff', '--cached', '--name-only']);
    if (names.trim() !== '') {
      await git([
        '-c', 'user.name=Prism',
        '-c', 'user.email=prism@localhost',
        '-c', 'commit.gpgsign=false',
        '-c', 'core.hooksPath=/dev/null',
        'commit', '-q', '--no-verify', '-m', `prism: save uncommitted work (${reason})`,
      ]);
      saved = true;
      const files = names.trim().split('\n');
      worktreeLog('worktree.work_saved', {
        runId: opts.runId, path: worktreePath, reason, fileCount: files.length, files: files.slice(0, 50),
      });
    }

    const { stdout: left } = await status();
    if (left.trim() !== '') {
      throw new WorktreeError(`Could not save everything: ${left.trim().split('\n')[0]}`, 'GIT_ERROR');
    }
  }

  let ref = null;
  const { stdout: head } = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (head.trim() !== branch && branch) {
    ref = `${branch}-saved`;
    await git(['branch', '-f', ref, 'HEAD']);
    worktreeLog('worktree.off_branch_work_saved', { runId: opts.runId, path: worktreePath, ref, head: head.trim() });
  }

  return { saved, ref };
}

/**
 * Whether the run branch has commits beyond the point it was created from.
 * Assumes it does when that cannot be established.
 *
 * @param {string} workingDirectory
 * @param {{ branch: string, baseRef?: string|null }} worktreeMeta
 * @returns {Promise<boolean>}
 */
async function branchHasWork(workingDirectory, { branch, baseRef }) {
  if (!baseRef) return true;
  try {
    const { stdout } = await runGit(workingDirectory, ['rev-list', '--count', `${baseRef}..${branch}`]);
    return stdout.trim() !== '0';
  } catch {
    return true;
  }
}

/**
 * Save any uncommitted work, then remove a previously provisioned worktree. Idempotent.
 *
 * If the work cannot be saved the worktree stays on disk. Nothing removes it until
 * someone deals with what is logged under worktree.error.
 *
 * Never throws — errors are logged via worktreeLog('worktree.error', …).
 * If opts.deleteBranch is true, also deletes the branch after removing the worktree.
 *
 * @param {object|null|undefined} worktreeMeta - run.worktree object ({ path, branch, baseBranch, baseRef })
 * @param {object} [opts]
 * @param {boolean} [opts.deleteBranch=false]  - Delete the branch after removing the worktree.
 * @param {string}  [opts.reason='unknown']    - Reason for removal (for observability).
 * @param {string}  [opts.runId]               - Run ID (for observability).
 * @returns {Promise<{ keptError?: string }>} keptError says why the worktree stayed on disk.
 */
async function teardown(worktreeMeta, opts = {}) {
  // Null/undefined guard — callers may pass run.worktree which is absent for solo runs.
  if (!worktreeMeta) return {};

  const { path: worktreePath, branch } = worktreeMeta;
  const reason   = opts.reason   || 'unknown';
  const runId    = opts.runId    || undefined;
  const deleteBranch = opts.deleteBranch || false;

  if (!worktreePath) return {}; // Malformed meta — no-op.

  // Derive the workingDirectory from the worktreePath.
  // Structure: <workingDirectory>/<PIPELINE_WORKTREE_DIR>/run-<short>
  // We need the grandparent directory.
  const worktreeBase = path.dirname(worktreePath); // <workingDirectory>/.worktrees
  const workingDirectory = path.dirname(worktreeBase);

  // --- Remove the worktree ---
  if (fs.existsSync(worktreePath)) {
    try {
      await saveWork(worktreeMeta, { reason, runId });
    } catch (err) {
      worktreeLog('worktree.error', { runId, op: 'save_work', code: err.code, message: err.message, kept: worktreePath });
      return { keptError: err.message };
    }

    try {
      await runGit(workingDirectory, ['worktree', 'remove', '--force', worktreePath]);
      worktreeLog('worktree.removed', { runId, path: worktreePath, reason });
    } catch (err) {
      worktreeLog('worktree.error', { runId, op: 'remove', code: err.code, message: err.message });
      // Continue — try to prune stale entries at minimum.
      try {
        await runGit(workingDirectory, ['worktree', 'prune']);
      } catch { /* ignore prune errors */ }
    }
  } else {
    // Worktree path gone (already cleaned up or never created) — idempotent no-op.
    // Still call prune to clean any stale admin files.
    try {
      await runGit(workingDirectory, ['worktree', 'prune']);
    } catch { /* ignore */ }
  }

  // --- Optionally delete the branch ---
  if (deleteBranch && branch && (await branchHasWork(workingDirectory, worktreeMeta))) {
    worktreeLog('worktree.branch_kept', { runId, branch, reason: 'holds_work' });
  } else if (deleteBranch && branch) {
    try {
      await runGit(workingDirectory, ['branch', '-D', branch]);
      worktreeLog('worktree.branch_deleted', { runId, branch, reason });
    } catch (err) {
      // Branch may already be deleted or not yet created — log and move on.
      worktreeLog('worktree.error', { runId, op: 'branch_delete', code: err.code, message: err.message });
    }
  }
  return {};
}

/**
 * Move work the agent left off the run branch back onto it. Throws if the two
 * diverged, because resuming from the branch alone would silently drop that work.
 *
 * @param {string} workingDirectory
 * @param {string} branch
 */
async function recoverOffBranchWork(workingDirectory, branch) {
  const saved = `${branch}-saved`;
  const refExists = async (name) => {
    try {
      await runGit(workingDirectory, ['rev-parse', '--verify', '-q', `refs/heads/${name}`]);
      return true;
    } catch {
      return false;
    }
  };

  if (!(await refExists(saved))) return;

  const isAncestor = async (a, b) => {
    try {
      await runGit(workingDirectory, ['merge-base', '--is-ancestor', a, b]);
      return true;
    } catch {
      return false;
    }
  };

  if (await refExists(branch)) {
    if (await isAncestor(saved, branch)) {
      await runGit(workingDirectory, ['branch', '-D', saved]); // Nothing unique in it.
      return;
    }
    if (!(await isAncestor(branch, saved))) {
      throw new WorktreeError(`Branch '${saved}' holds saved work that diverged from '${branch}'.`, 'GIT_ERROR');
    }
  }

  await runGit(workingDirectory, ['branch', '-f', branch, saved]);
  await runGit(workingDirectory, ['branch', '-D', saved]);
}

/**
 * Make sure a run's worktree exists, recreating it from the run branch if it was
 * removed when the run stopped. Work saved from a detached HEAD is brought back
 * when the run branch can fast-forward to it.
 *
 * Throws WorktreeError(GIT_ERROR) when it cannot, for example if the branch is
 * checked out elsewhere. Callers must not fall back to the user's checkout.
 *
 * @param {string} workingDirectory - The repository the worktree belongs to.
 * @param {{ path: string, branch: string, baseRef?: string|null }} worktreeMeta
 * @param {object} [opts]
 * @param {string} [opts.runId] - Run ID (for observability).
 * @returns {Promise<{ restored: boolean }>}
 */
async function restore(workingDirectory, worktreeMeta, opts = {}) {
  const { path: worktreePath, branch, baseRef } = worktreeMeta;

  if (fs.existsSync(worktreePath)) {
    await assertWorktreeRoot(worktreePath);
    return { restored: false };
  }

  await runGit(workingDirectory, ['worktree', 'prune']);

  await recoverOffBranchWork(workingDirectory, branch);

  // PIPELINE_DELETE_BRANCH_ON_FAILURE deletes a branch with no commits, so it can be
  // recreated from where it started without losing anything.
  let branchExists = true;
  try {
    await runGit(workingDirectory, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]);
  } catch {
    branchExists = false;
  }
  await runGit(workingDirectory, branchExists || !baseRef
    ? ['worktree', 'add', worktreePath, branch]
    : ['worktree', 'add', worktreePath, '-b', branch, baseRef]);
  worktreeLog('worktree.restored', { runId: opts.runId, path: worktreePath, branch });
  return { restored: true };
}

/**
 * Startup garbage collection sweep.
 *
 * For each <workingDirectory>/.worktrees/run-* entry:
 *   - If the matching run.json is in a terminal state (completed/failed/interrupted/aborted)
 *     → remove the worktree.
 *   - If no matching run.json exists → remove the worktree (orphan).
 *   - If the run is still active (running/blocked/paused/pending) → leave it.
 *
 * Does not crash when .worktrees/ does not exist.
 *
 * @param {string}   dataDir           - Root data directory containing runs/.
 * @param {string[]} workingDirectories - List of workingDirectory values gathered from known runs.
 * @param {object}   [store]           - Optional SQLite store (post-migration). When provided,
 *                                       runs are queried from SQLite rather than run.json files.
 */
async function reapOrphans(dataDir, workingDirectories, store) {
  const runsDir = process.env.PIPELINE_RUNS_DIR || path.join(dataDir, 'runs');

  const TERMINAL_STATUSES = new Set(['completed', 'failed', 'interrupted', 'aborted']);

  // A direct run keeps its worktree after it ends, until its task is closed.
  const statusForReap = (run) => (run.direct && !run.closedAt ? 'open' : run.status);

  /**
   * Build a map of runId → status.
   * Uses SQLite when a store is provided; falls back to reading run.json files.
   */
  function buildRunStatusMap() {
    const map = new Map();

    if (store) {
      // Post-migration: query all runs from SQLite.
      try {
        const allRuns = store.listRuns();
        for (const run of allRuns) {
          if (run && run.runId) map.set(run.runId, statusForReap(run));
        }
      } catch { /* ignore — best-effort */ }
      return map;
    }

    // Legacy fallback: read run.json files.
    if (!fs.existsSync(runsDir)) return map;
    let entries;
    try { entries = fs.readdirSync(runsDir); } catch { return map; }
    for (const entry of entries) {
      const runJsonFile = path.join(runsDir, entry, 'run.json');
      if (!fs.existsSync(runJsonFile)) continue;
      try {
        const run = JSON.parse(fs.readFileSync(runJsonFile, 'utf8'));
        if (run && run.runId) map.set(run.runId, statusForReap(run));
      } catch { /* skip corrupt files */ }
    }
    return map;
  }

  const runStatusMap = buildRunStatusMap();

  for (const workingDirectory of workingDirectories) {
    if (!workingDirectory || !fs.existsSync(workingDirectory)) continue;

    const wtDir = path.join(workingDirectory, worktreeSubdir());
    if (!fs.existsSync(wtDir)) continue;

    let entries;
    try { entries = fs.readdirSync(wtDir); } catch { continue; }

    for (const entry of entries) {
      // Only process entries matching our naming convention: run-<8chars>
      if (!entry.startsWith('run-')) continue;

      const wtPath  = path.join(wtDir, entry);
      // Extract runId short from entry name.
      const short   = entry.slice(4); // strip 'run-'

      // Find the matching run by short ID prefix.
      let matchedRunId   = null;
      let matchedStatus  = null;
      for (const [runId, status] of runStatusMap) {
        if (runId.startsWith(short)) {
          matchedRunId  = runId;
          matchedStatus = status;
          break;
        }
      }

      let reason;
      if (!matchedRunId) {
        // No matching run record — orphan.
        reason = 'orphan';
      } else if (TERMINAL_STATUSES.has(matchedStatus)) {
        reason = matchedStatus;
      } else {
        // Run is still active — leave worktree alone.
        continue;
      }

      // Read the branch from the worktree's HEAD file to pass to teardown.
      let branch = null;
      const worktreeHeadFile = path.join(wtPath, '.git');
      // git worktrees have a .git file (not dir) with "gitdir: ..." pointing to the admin dir.
      // The branch is stored in <repo>/.git/worktrees/<name>/HEAD.
      // For simplicity, pass null branch — teardown will skip branch deletion.
      // The branch name follows our convention: pipeline/run-<short>.
      if (!branch) {
        branch = `pipeline/run-${short}`;
      }

      const meta = {
        path:   wtPath,
        branch,
        baseBranch: null,
        baseRef:    null,
      };

      worktreeLog('worktree.orphan_reaped', { path: wtPath, reason, matchedRunId });

      await teardown(meta, {
        reason,
        runId:        matchedRunId || undefined,
        deleteBranch: false, // preserve branches on reap — user can inspect them
      });
    }
  }
}

/**
 * Parse `git diff --numstat -z`. A rename is `<add>\t<del>\t\0<old>\0<new>\0`; anything
 * else is `<add>\t<del>\t<path>\0`. Binary files report `-` for both counts.
 *
 * @param {string} raw
 * @returns {Array<{ path: string, oldPath?: string, additions: number, deletions: number, binary: boolean }>}
 */
function parseNumstat(raw) {
  const parts = raw.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(parts[i]);
    if (!match) continue;
    const [, add, del, name] = match;
    const binary = add === '-';
    const file = { path: name, additions: binary ? 0 : Number(add), deletions: binary ? 0 : Number(del), binary };
    if (name === '') {
      file.oldPath = parts[++i];
      file.path    = parts[++i];
    }
    files.push(file);
  }
  return files;
}

/**
 * The commit a branch points at.
 *
 * @param {string} workingDirectory
 * @param {string} ref
 * @returns {Promise<string>}
 */
async function readBranchHead(workingDirectory, ref) {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', `refs/heads/${ref}^{commit}`], { cwd: workingDirectory });
  return stdout.trim();
}

/**
 * List what a branch changed since it was created. Reads refs only, so it works
 * after the worktree is gone.
 *
 * @param {string} workingDirectory
 * @param {{ baseRef: string, ref: string }} range
 * @returns {Promise<Array<{ path: string, oldPath?: string, additions: number, deletions: number, binary: boolean }>>}
 */
async function listChangedFiles(workingDirectory, { baseRef, ref }) {
  const { stdout } = await runGit(
    workingDirectory,
    ['diff', '--numstat', '-z', '-M', baseRef, ref, '--'],
    SAVE_GIT_OPTS,
  );
  return parseNumstat(stdout);
}

/**
 * The patch of one changed file. Returns null when the branch did not change it,
 * so the path cannot be used to read anything else from the repository.
 *
 * @param {string} workingDirectory
 * @param {{ baseRef: string, ref: string }} range
 * @param {string} filePath
 * @returns {Promise<{ patch: string, truncated: boolean }|null>}
 */
async function readFileDiff(workingDirectory, { baseRef, ref }, filePath) {
  const files = await listChangedFiles(workingDirectory, { baseRef, ref });
  const file  = files.find((f) => f.path === filePath);
  if (!file) return null;

  const { stdout } = await runGit(
    workingDirectory,
    ['--literal-pathspecs', 'diff', '-M', baseRef, ref, '--', ...(file.oldPath ? [file.oldPath] : []), file.path],
    SAVE_GIT_OPTS,
  );
  const truncated = Buffer.byteLength(stdout) > MAX_PATCH_BYTES;
  return { patch: truncated ? Buffer.from(stdout).subarray(0, MAX_PATCH_BYTES).toString('utf8') : stdout, truncated };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  WorktreeError,
  provision,
  saveWork,
  assertWorktreeRoot,
  teardown,
  restore,
  reapOrphans,
  listChangedFiles,
  readBranchHead,
  readFileDiff,
};
