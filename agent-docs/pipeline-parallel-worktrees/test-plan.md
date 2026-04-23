# Test Plan: Pipeline Parallel Worktrees (ADR-1)

## Executive Summary

The parallel-worktrees feature provides git isolation for concurrent pipeline runs that share a `workingDirectory`. When a second run targets the same directory, `pipelineManager` provisions a `git worktree` so the two runs cannot race on branch/commit operations. This plan covers the new `worktreeManager` module, the `pipelineManager` integration helpers, and the end-to-end parallel-run behaviour.

**Overall verdict: PASS. Zero Critical or High bugs.** Four Low-severity advisories documented in `bugs.md`.

---

## Scope & Objectives

| In Scope | Out of Scope |
|----------|-------------|
| `src/services/worktreeManager.js` (provision, teardown, reapOrphans, WorktreeError) | Frontend UI changes (none) |
| `pipelineManager` helpers: `effectiveCwd`, `hasActiveRunInDir`, `finalizeRun` | `git merge` of worktree branch back to base (not implemented by design) |
| `pipelineManager.createRun` worktree-provision path | MCP tools / kanban handlers (unchanged) |
| `pipelineManager.init` startup GC sweep (reapOrphans) | Security of git binary itself |
| Kill-switch `PIPELINE_WORKTREE_ENABLED=0` | Windows-specific git behaviour |
| `finalizeRun` called from all terminal-state transitions | |
| Regression: 59 existing `pipeline.test.js` tests | |

---

## Test Levels

### Unit Tests

| ID | Description | Component | Priority |
|----|-------------|-----------|----------|
| TC-U-001 | Module exports are correct types | worktreeManager | Critical |
| TC-U-002 | `WorktreeError` is an Error subclass with `.code` | worktreeManager | High |
| TC-U-003 | Module load has no side effects (no git calls at require) | worktreeManager | High |
| TC-U-004 | `provision()` returns correct metadata shape | worktreeManager | Critical |
| TC-U-005 | `provision()` creates the directory and .git link | worktreeManager | Critical |
| TC-U-006 | `provision()` emits `worktree.created` log with durationMs | worktreeManager | Medium |
| TC-U-007 | `provision()` throws `NOT_A_GIT_REPO` for non-git dir | worktreeManager | Critical |
| TC-U-008 | `provision()` throws `DETACHED_HEAD` for detached HEAD | worktreeManager | Critical |
| TC-U-009 | `provision()` throws `WORKTREE_EXISTS` for duplicate runId | worktreeManager | High |
| TC-U-010 | `provision()` uses `execFile` (no shell injection) | worktreeManager | High |
| TC-U-011 | `teardown(null)` is a no-op | worktreeManager | High |
| TC-U-012 | `teardown(undefined)` is a no-op | worktreeManager | High |
| TC-U-013 | `teardown()` removes worktree from disk | worktreeManager | Critical |
| TC-U-014 | `teardown()` is idempotent (safe to call twice) | worktreeManager | High |
| TC-U-015 | `teardown(opts.deleteBranch=true)` removes the branch | worktreeManager | High |
| TC-U-016 | `teardown(opts.deleteBranch=false)` preserves the branch | worktreeManager | Medium |
| TC-U-017 | `teardown()` emits `worktree.removed` log | worktreeManager | Medium |
| TC-U-018 | `reapOrphans()` no-op when `.worktrees/` missing | worktreeManager | High |
| TC-U-019 | `reapOrphans()` removes orphaned worktrees (no run.json) | worktreeManager | Critical |
| TC-U-020 | `reapOrphans()` removes worktrees with terminal-status run | worktreeManager | High |
| TC-U-021 | `reapOrphans()` leaves worktrees with active-status run | worktreeManager | Critical |
| TC-U-022 | `reapOrphans()` handles empty workingDirectories list | worktreeManager | Medium |
| TC-U-023 | `effectiveCwd()` returns `worktree.path` when present | pipelineManager | Critical |
| TC-U-024 | `effectiveCwd()` returns `workingDirectory` when no worktree | pipelineManager | Critical |
| TC-U-025 | `effectiveCwd()` returns `undefined` for empty run | pipelineManager | High |
| TC-U-026 | `effectiveCwd(null)` returns `undefined` | pipelineManager | High |
| TC-U-027 | `hasActiveRunInDir()` returns `false` with no active processes | pipelineManager | High |
| TC-U-028 | `hasActiveRunInDir(null)` returns `false` | pipelineManager | Medium |

### Integration Tests

| ID | Description | Component | Priority |
|----|-------------|-----------|----------|
| TC-I-001 | First run on a directory has no worktree (solo run — backward compatible) | pipelineManager | Critical |
| TC-I-002 | Second concurrent run on same directory gets a worktree | pipelineManager | Critical |
| TC-I-003 | `PIPELINE_WORKTREE_ENABLED=0` disables worktrees even on conflict | pipelineManager | High |
| TC-I-004 | `buildStagePrompt` solo run: GIT CONTEXT uses `workingDirectory` | pipelineManager | High |
| TC-I-005 | `buildStagePrompt` worktree run: GIT CONTEXT uses `worktree.path` | pipelineManager | High |

### Regression Tests (existing suite)

| ID | Description | Component | Priority |
|----|-------------|-----------|----------|
| TC-R-001 | 59 existing `pipeline.test.js` tests all pass | pipelineManager | Critical |
| TC-R-002 | 4 `pipeline-workingdir.test.js` tests all pass | pipelineManager | High |
| TC-R-003 | 38 `pipeline-blocked.test.js` tests all pass | pipelineManager | High |

### Security Tests

| ID | Description | Component | Priority |
|----|-------------|-----------|----------|
| TC-SEC-001 | `worktreeManager.js` uses `execFile`, not `exec()` with shell=true | worktreeManager | High |
| TC-SEC-002 | Short runId (8-char hex UUID prefix) cannot form shell injection in branch names | worktreeManager | High |
| TC-SEC-003 | `worktreePath` derivation: `path.join` normalises traversal in runId | worktreeManager | Medium |

---

## Performance Thresholds

| Metric | Threshold | Observed |
|--------|-----------|---------|
| `provision()` p95 latency | < 500 ms | ~52 ms (single git worktree add) |
| `teardown()` p95 latency | < 300 ms | ~20 ms |
| `reapOrphans()` per directory | < 1 000 ms | negligible (I/O only) |

---

## Environment Requirements

- Node.js ≥ 18.x
- `git` ≥ 2.15 (worktrees support)
- Tests run with `PIPELINE_NO_SPAWN=1` (no real `claude` binary needed)
- Temp directories created and destroyed per test (no shared state)

---

## Assumptions & Exclusions

1. `git` binary is on PATH in the CI environment.
2. Tests use isolated temp repos — no real Prism working tree is touched.
3. `PIPELINE_WORKTREE_DIR` is assumed to be a relative path (subdirectory name). Absolute paths are not validated and may cause teardown issues (see BUG-001).
4. `git merge` of the worktree branch back to the base branch is explicitly out of scope for this feature — branches are preserved by default and cleaned up by operators or the optional `PIPELINE_DELETE_BRANCH_ON_FAILURE` flag.
5. E2E browser tests are not applicable (no UI changes).

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Git worktree creation fails in CI (missing git version) | Low | High | Test helper uses `execFileSync` to verify git presence |
| Worktree path leak on `deleteRun` for pending (not-yet-active) run | Low | Low | `reapOrphans` at next startup cleans orphans; BUG-002 documents |
| Stale `pipeline/run-*` branches accumulate in repo | Medium | Low | BUG-003; manual `git branch -D` or `PIPELINE_DELETE_BRANCH_ON_FAILURE=1` |
| Short runId prefix collision (1:4 billion) in `reapOrphans` | Very Low | Low | BUG-004; acceptable UUID entropy |
