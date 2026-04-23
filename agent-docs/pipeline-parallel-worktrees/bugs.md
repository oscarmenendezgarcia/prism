# Bug Report: Pipeline Parallel Worktrees

**Feature**: Pipeline Parallel Worktrees (ADR-1)
**QA Run Date**: 2026-04-23
**Overall Status**: ✅ PASS — Zero Critical or High bugs

All tests pass (33 new + 101 regression = 134 total). Four Low-severity advisories follow.

---

## BUG-001: `teardown()` workingDirectory derivation breaks for absolute `PIPELINE_WORKTREE_DIR`

- **Severity**: Low
- **Type**: Functional / Configuration
- **Component**: `src/services/worktreeManager.js` — `teardown()` (line ~227)

### Reproduction Steps
1. Set `PIPELINE_WORKTREE_DIR=/tmp/my-worktrees` (absolute path)
2. `provision('/home/user/project', runId)` creates worktree at `/tmp/my-worktrees/run-XXXXXXXX`
3. `teardown({ path: '/tmp/my-worktrees/run-XXXXXXXX', branch: '...' })` derives:
   - `worktreeBase = path.dirname('/tmp/my-worktrees/run-XXXXXXXX')` → `/tmp/my-worktrees`
   - `workingDirectory = path.dirname('/tmp/my-worktrees')` → `/tmp`
4. `git -C /tmp worktree remove --force /tmp/my-worktrees/run-XXXXXXXX` — wrong base repo → fails with `GIT_ERROR`

### Expected Behavior
`teardown()` resolves the correct `workingDirectory` regardless of whether `PIPELINE_WORKTREE_DIR` is relative or absolute.

### Actual Behavior
The derivation `path.dirname(path.dirname(worktreePath))` assumes the worktree lives exactly two levels below the git repo. This breaks for absolute `PIPELINE_WORKTREE_DIR` values.

### Root Cause Analysis
The `worktreeMeta` object returned by `provision()` does not include `workingDirectory`. The `teardown()` function reconstructs it by walking up two directory levels, which is only correct when `PIPELINE_WORKTREE_DIR` is a relative path (e.g. `.worktrees`).

### Proposed Fix
Add `workingDirectory` to the object returned by `provision()`:
```js
return { path: worktreePath, branch, baseBranch, baseRef, workingDirectory };
```
Then in `teardown()`, use `worktreeMeta.workingDirectory` directly instead of the path derivation. Maintain backward compatibility by falling back to the current derivation when `workingDirectory` is absent on existing persisted `run.worktree` objects.

### Notes
The default value (`PIPELINE_WORKTREE_DIR='.worktrees'`) is unaffected. This only triggers if an operator explicitly sets an absolute path, which contradicts the documented "Subdirectory under workingDirectory" semantics. Impact is Low.

---

## BUG-002: `deleteRun()` skips worktree cleanup for non-active (pending) runs

- **Severity**: Low
- **Type**: Functional / Resource Leak
- **Component**: `src/services/pipelineManager.js` — `deleteRun()` (line ~2273)

### Reproduction Steps
1. Create run A targeting `/repo` (solo — no worktree)
2. Immediately call `POST /api/v1/runs` for run B on same `/repo`
   - Run B receives a worktree; `createRun` returns
   - `setImmediate(executeNextStage)` is queued but not yet fired
3. Call `DELETE /api/v1/runs/<runB>` synchronously before any I/O event fires
4. Run B's `runId` is not yet in `activeProcesses`

### Expected Behavior
`deleteRun` cleans up the worktree even when the run has not yet entered `activeProcesses`.

### Actual Behavior
```js
if (activeProcesses.has(runId)) {
  // finalizeRun called here
}
// worktree NOT cleaned up if run is still pending
```
The worktree at `.worktrees/run-XXXXXXXX` persists until `reapOrphans` runs at next server restart.

### Root Cause Analysis
`finalizeRun` is gated inside the `activeProcesses.has(runId)` block. A pending run with a worktree (provisioned in `createRun` but `setImmediate` not yet fired) is not in `activeProcesses`.

### Proposed Fix
Move `finalizeRun` outside the `activeProcesses` guard in `deleteRun`:

```js
async function deleteRun(runId, dataDir) {
  if (activeProcesses.has(runId)) {
    // kill active process ...
  }
  const run = readRun(dataDir, runId);
  if (run) {
    run.status = 'aborted';
    await finalizeRun(dataDir, run).catch(() => {});
  }
  // remove run directory and registry entry ...
}
```

### Notes
The window is extremely narrow (between `createRun()` returning and the first `setImmediate` callback). In practice it cannot be triggered via the HTTP API because the DELETE request requires a network round-trip, by which time `setImmediate` has already fired. `reapOrphans` provides a safety net at next restart. Severity is Low.

---

## BUG-003: Stale `pipeline/run-*` branches accumulate in the git repository

- **Severity**: Low
- **Type**: Operational / Resource Management
- **Component**: `src/services/worktreeManager.js` — `teardown()` / `reapOrphans()`

### Description
By default, `teardown()` is called with `deleteBranch: false`. The branch `pipeline/run-XXXXXXXX` is preserved after the worktree is removed. On a repository with many concurrent pipeline runs over time, these stale branches accumulate indefinitely.

### Expected Behavior
Either branches are auto-pruned after successful completion, or there is a documented maintenance command.

### Actual Behavior
Branches are left in the repository. The only auto-cleanup mechanism is `PIPELINE_DELETE_BRANCH_ON_FAILURE=1`, which only applies to non-completed runs.

### Root Cause Analysis
Design decision to preserve branches for inspection (especially on failures). There is no scheduled GC or periodic prune for completed-run branches.

### Proposed Fix (Advisory)
Options (in increasing aggressiveness):
1. Add `PIPELINE_DELETE_BRANCH_ON_SUCCESS=1` env var that triggers branch deletion for successfully completed runs.
2. Document a maintenance cron: `git branch --list 'pipeline/run-*' | xargs git branch -D`
3. Have `reapOrphans` delete branches for terminal-state runs (`deleteBranch: true` when reaping).

### Notes
Low operational impact — git handles thousands of refs without performance degradation. Recommend option 1 (opt-in flag) as a future low-effort improvement.

---

## BUG-004: `provision()` on a repo with no commits returns opaque `GIT_ERROR`

- **Severity**: Low
- **Type**: Developer Experience / Error Messaging
- **Component**: `src/services/worktreeManager.js` — `provision()` (line ~147)

### Reproduction Steps
1. Create a git repo with `git init` but **no commits** (unborn HEAD)
2. Call `provision(emptyRepo, runId)`
3. `git rev-parse HEAD` fails with `fatal: ambiguous argument 'HEAD'`

### Expected Behavior
A descriptive error code such as `NO_COMMITS` with message "Repository has no commits; create an initial commit before provisioning a worktree."

### Actual Behavior
`GIT_ERROR: git rev-parse failed: fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.`

### Root Cause Analysis
The current error handling catches any failure from `rev-parse HEAD` and re-throws as `GIT_ERROR`. An unborn HEAD is a distinct, user-fixable condition that deserves its own error code.

### Proposed Fix
After the `NOT_A_GIT_REPO` guard, add a separate check for unborn HEAD:
```js
try {
  const { stdout: revResult } = await execFileAsync('git', ['-C', workingDirectory, 'rev-parse', 'HEAD'], ...);
  baseRef = revResult.trim();
} catch (err) {
  if (err.stderr?.includes('unknown revision') || err.stderr?.includes('ambiguous argument')) {
    throw new WorktreeError(
      `Repository '${workingDirectory}' has no commits. Create an initial commit first.`,
      'NO_COMMITS'
    );
  }
  throw new WorktreeError(`Failed to resolve HEAD in '${workingDirectory}'.`, 'GIT_ERROR');
}
```

### Notes
Very minor UX improvement. Only affects operators setting up a brand-new repo. All production repos will have at least one commit.

---

## Summary Table

| Bug ID | Severity | Type | Component | Status |
|--------|----------|------|-----------|--------|
| BUG-001 | Low | Functional | worktreeManager.teardown | Open |
| BUG-002 | Low | Functional | pipelineManager.deleteRun | Open |
| BUG-003 | Low | Operational | worktreeManager | Open |
| BUG-004 | Low | DX / Error Messaging | worktreeManager.provision | Open |

**Merge gate: CLEAR** — Zero Critical or High bugs. Feature is shippable.
