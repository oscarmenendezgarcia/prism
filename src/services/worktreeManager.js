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
 *   PIPELINE_DELETE_BRANCH_ON_FAILURE  - '1' deletes the branch on non-completed teardown (default: '0')
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
 * `.code` is one of: NOT_A_GIT_REPO | DETACHED_HEAD | WORKTREE_EXISTS | GIT_ERROR
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

/**
 * Emit a structured pipeline log event to stderr.
 * Avoids importing pipelineManager (circular dependency risk).
 *
 * @param {string} event
 * @param {object} payload
 */
function pipelineLog(event, payload = {}) {
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
 * Throws WorktreeError with code:
 *   NOT_A_GIT_REPO   — workingDirectory is not a git repo
 *   DETACHED_HEAD    — parent HEAD is detached (no branch to reference)
 *   WORKTREE_EXISTS  — target path already exists
 *   GIT_ERROR        — any other git failure
 *
 * Does NOT mutate the parent checkout (no branch switch, no commit).
 *
 * @param {string} workingDirectory - Absolute path to the git repository root.
 * @param {string} runId            - Pipeline run UUID.
 * @returns {Promise<{ path: string, branch: string, baseBranch: string, baseRef: string }>}
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

  // --- Resolve current branch (detect detached HEAD) ---
  let baseBranch;
  try {
    const { stdout } = await execFileAsync(
      'git', ['-C', workingDirectory, 'symbolic-ref', '--short', 'HEAD'],
      { timeout: 5_000, encoding: 'utf8' }
    );
    baseBranch = stdout.trim();
  } catch {
    // symbolic-ref exits non-zero when HEAD is detached.
    throw new WorktreeError(
      `HEAD in '${workingDirectory}' is detached. Worktree provisioning requires a named branch.`,
      'DETACHED_HEAD'
    );
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

  // --- Create the worktree ---
  // git worktree add <path> -b <branch> <baseRef>
  // argv-based — no shell interpolation.
  await runGit(workingDirectory, ['worktree', 'add', worktreePath, '-b', branch, baseRef]);

  const durationMs = Date.now() - t0;
  pipelineLog('worktree.created', { runId, path: worktreePath, branch, baseRef, baseBranch, durationMs });

  return { path: worktreePath, branch, baseBranch, baseRef };
}

/**
 * Remove a previously provisioned worktree. Idempotent.
 *
 * Never throws — errors are logged via pipelineLog('worktree.error', …).
 * If opts.deleteBranch is true, also deletes the branch after removing the worktree.
 *
 * @param {object|null|undefined} worktreeMeta - run.worktree object ({ path, branch, baseBranch, baseRef })
 * @param {object} [opts]
 * @param {boolean} [opts.deleteBranch=false]  - Delete the branch after removing the worktree.
 * @param {string}  [opts.reason='unknown']    - Reason for removal (for observability).
 * @param {string}  [opts.runId]               - Run ID (for observability).
 */
async function teardown(worktreeMeta, opts = {}) {
  // Null/undefined guard — callers may pass run.worktree which is absent for solo runs.
  if (!worktreeMeta) return;

  const { path: worktreePath, branch } = worktreeMeta;
  const reason   = opts.reason   || 'unknown';
  const runId    = opts.runId    || undefined;
  const deleteBranch = opts.deleteBranch || false;

  if (!worktreePath) return; // Malformed meta — no-op.

  // Derive the workingDirectory from the worktreePath.
  // Structure: <workingDirectory>/<PIPELINE_WORKTREE_DIR>/run-<short>
  // We need the grandparent directory.
  const worktreeBase = path.dirname(worktreePath); // <workingDirectory>/.worktrees
  const workingDirectory = path.dirname(worktreeBase);

  // --- Remove the worktree ---
  if (fs.existsSync(worktreePath)) {
    try {
      await runGit(workingDirectory, ['worktree', 'remove', '--force', worktreePath]);
      pipelineLog('worktree.removed', { runId, path: worktreePath, reason });
    } catch (err) {
      pipelineLog('worktree.error', { runId, op: 'remove', code: err.code, message: err.message });
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
  if (deleteBranch && branch) {
    try {
      await runGit(workingDirectory, ['branch', '-D', branch]);
      pipelineLog('worktree.branch_deleted', { runId, branch, reason });
    } catch (err) {
      // Branch may already be deleted or not yet created — log and move on.
      pipelineLog('worktree.error', { runId, op: 'branch_delete', code: err.code, message: err.message });
    }
  }
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
          if (run && run.runId) map.set(run.runId, run.status);
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
        if (run && run.runId) map.set(run.runId, run.status);
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

      pipelineLog('worktree.orphan_reaped', { path: wtPath, reason, matchedRunId });

      await teardown(meta, {
        reason,
        runId:        matchedRunId || undefined,
        deleteBranch: false, // preserve branches on reap — user can inspect them
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  WorktreeError,
  provision,
  teardown,
  reapOrphans,
};
