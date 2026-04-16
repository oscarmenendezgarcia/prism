# Bugs — Pipeline Blocked Feature

**Feature:** pipeline-blocked  
**QA Date:** 2026-04-16  
**Total bugs:** 4 (0 Critical, 0 High, 2 Medium, 2 Low)  
**Merge gate:** ✅ CLEAR — no Critical or High bugs

---

## BUG-001: `unblockRun` (REST direct) does not delete `blockedReason` from run state

- **Severity:** Medium
- **Type:** Functional / Data Inconsistency
- **Component:** `src/services/pipelineManager.js` — `unblockRun()` function (lines 1439–1464)
- **Test case:** GT-001

### Reproduction Steps

1. Create a run and block it via the comment-driven path (`blockRunByComment`) — the run will have `status: 'blocked'` and a populated `blockedReason` field.
2. Call `POST /api/v1/runs/:runId/unblock` directly (REST).
3. Inspect the HTTP response body and/or the persisted `run.json` on disk.

### Expected Behavior

```json
{
  "status": "running",
  "blockedReason": null
}
```
`blockedReason` should be absent (or explicitly null) after unblocking.

### Actual Behavior

```json
{
  "status": "running",
  "blockedReason": {
    "commentId": "...",
    "taskId": "...",
    "author": "...",
    "text": "...",
    "blockedAt": "..."
  }
}
```
`blockedReason` persists stale while `status` is `"running"` — a contradiction.

### Root Cause Analysis

`unblockRunByComment` (the comment-driven path) correctly calls `delete run.blockedReason` before `writeRun`. The REST-exposed `unblockRun` function does not:

```javascript
// Current — MISSING delete:
run.status = 'running';
writeRun(dataDir, run);  // blockedReason still in run object

// unblockRunByComment — CORRECT:
run.status = 'running';
delete run.blockedReason;   // ← present here
writeRun(dataDir, run);
```

The existing test for IT-007 (`POST /unblock` → 200 status=running) uses a seeded run that has no `blockedReason` field, so the bug is invisible to the test suite.

### Proposed Fix

Add `delete run.blockedReason;` in `unblockRun()` before `writeRun()`:

```javascript
async function unblockRun(runId, dataDir) {
  ...
  run.status = 'running';
  delete run.blockedReason;   // ← add this line
  writeRun(dataDir, run);
  ...
}
```

Then add a test: seed a run with an explicit `blockedReason`, call `/unblock`, assert `body.blockedReason == null`.

---

## BUG-002: `kanban_answer_comment` MCP tool returns `pipelineUnblocked: false` when pipeline was unblocked

- **Severity:** Medium
- **Type:** Functional — Incorrect Tool Response
- **Component:** `mcp/mcp-server.js` — `kanban_answer_comment` handler (lines 568–594)
- **Test case:** GT-002

### Reproduction Steps

1. Create a task with an active pipeline run in `blocked` state (blocked by a question comment via `blockRunByComment`).
2. Call `kanban_answer_comment` tool for the blocking question.
3. Inspect the returned JSON: `{ pipelineUnblocked: ... }`.

### Expected Behavior

```json
{
  "answerComment": { ... },
  "resolvedQuestion": { ... },
  "pipelineUnblocked": true,
  "runId": "..."
}
```

### Actual Behavior

```json
{
  "answerComment": { ... },
  "resolvedQuestion": { ... },
  "pipelineUnblocked": false,
  "openQuestionsRemaining": 0
}
```

The pipeline IS unblocked (correctly, by server-side `unblockRunByComment`), but the tool reports `false`.

### Root Cause Analysis

The `kanban_answer_comment` handler calls `answerComment()` which performs a PATCH on the question (marking it `resolved: true`). The PATCH request triggers `handleUpdateComment` on the server, which synchronously calls `pipelineManager.unblockRunByComment()`. This writes `status: 'running'` to `run.json` before the HTTP response returns.

Then the handler calls `findActiveRunForTask()`, which reads from the registry. Because `writeRun` (called inside `unblockRunByComment`) is synchronous, by the time the HTTP response for the PATCH arrives and `answerComment()` resolves, the registry already shows `status: 'running'`. The condition `run.status === 'blocked'` is then `false`, so `unblockRun` REST is not called, and the handler returns `pipelineUnblocked: false`.

In short: the server-side hook beats the MCP tool's explicit check. The pipeline IS unblocked but the response field is incorrect.

### Proposed Fix

Two options:

**Option A (simple):** After `answerComment`, check if ALL questions are resolved. If yes, report `pipelineUnblocked: true` regardless of current run status:

```javascript
if (openQuestions.length === 0) {
  // Questions all resolved — pipeline was/will be unblocked.
  // unblockRunByComment (server-side) already fired during the PATCH;
  // if it didn't (run was not blocked), find and try direct unblock.
  const run = await findActiveRunForTask({ spaceId, taskId });
  if (run && !run.error && run.status === 'blocked') {
    const unblockResult = await unblockRun(run.runId);
    const unblocked = !unblockResult?.error;
    return { ...result, pipelineUnblocked: unblocked, runId: run.runId };
  }
  // Server-side hook already handled it — still report as unblocked.
  const previouslyBlocked = run && !run.error;
  return { ...result, pipelineUnblocked: previouslyBlocked, runId: run?.runId };
}
```

**Option B (cleaner):** Fetch run status BEFORE calling `answerComment` to know if it was blocked, then use that as the `pipelineUnblocked` flag:

```javascript
const runBefore = await findActiveRunForTask({ spaceId, taskId });
const wasBlocked = runBefore && !runBefore.error && runBefore.status === 'blocked';

const result = await answerComment(...);
// ...
if (openQuestions.length === 0 && wasBlocked) {
  return { ...result, pipelineUnblocked: true, runId: runBefore.runId };
}
```

**Option A** is recommended as it handles edge cases where server-side hook didn't fire (e.g., run was not yet blocked when the answer was posted).

---

## BUG-003: `bypassQuestionCheck` persists on subsequent non-blocked resumes

- **Severity:** Low
- **Type:** Functional — State Persistence
- **Component:** `src/services/pipelineManager.js` — `resumeRun()` (lines 1263–1327)
- **Test case:** GT-003

### Reproduction Steps

1. Create a run with multiple stages.
2. Block the run (via question comment).
3. Manually resume via `POST /resume` → `bypassQuestionCheck: true` is set.
4. Allow the run to proceed and then interrupt it (e.g., `POST /stop`).
5. Resume the interrupted run via `POST /resume` again.
6. Inspect `run.json`: `bypassQuestionCheck` is still `true`.
7. Post a new question — the pipeline won't block even though it should.

### Expected Behavior

On the second resume (from interrupted, not from blocked), `bypassQuestionCheck` should be cleared so that new question checks apply.

### Actual Behavior

```javascript
if (wasBlocked) {
  run.bypassQuestionCheck = true;
}
// No else-branch to delete it
```
The flag is additive — never removed by a non-blocked resume.

### Root Cause Analysis

The `resumeRun` function only sets `bypassQuestionCheck: true` when `wasBlocked`. It never deletes the flag when resuming from a non-blocked state. This means the flag can "leak" across run cycles if the run is blocked → resumed → interrupted → resumed.

### Proposed Fix

Add `delete run.bypassQuestionCheck;` unconditionally, then conditionally re-add it:

```javascript
delete run.bypassQuestionCheck;  // always clear first
if (wasBlocked) {
  run.bypassQuestionCheck = true;
}
```

---

## BUG-004: `POST /api/v1/runs/:runId/block` (REST) does not populate `blockedReason`

- **Severity:** Low (Advisory)
- **Type:** API Contract — Missing Field
- **Component:** `src/services/pipelineManager.js` — `blockRun()` (lines 1403–1423); `src/handlers/pipeline.js` — `handleBlockRun()` (lines 280–293)
- **Test case:** GT-004

### Description

When a run is blocked via the REST endpoint `POST /api/v1/runs/:runId/block`, the response and persisted `run.json` contain `status: 'blocked'` but no `blockedReason` field:

```json
{
  "status": "blocked"
  // blockedReason absent
}
```

The comment-driven path (`blockRunByComment`) always populates `blockedReason` with the triggering comment's metadata. The REST direct path cannot, because it has no comment context.

### Impact

- Callers polling `GET /runs/:runId` after a direct REST block see `status: 'blocked'` but have no `blockedReason` — they cannot determine why the run is blocked.
- The `kanban_add_comment` MCP tool follows up a comment POST with `POST /block`. If the stage was mid-execution (so `blockRunByComment` didn't fire), the run is blocked via REST without `blockedReason`. The `handleStageClose` guard will later re-write it with `blockedReason`, but there's a window of inconsistency.

### Note

The ADR explicitly says `blockedReason` is populated by `blockRunByComment` and `handleStageClose`. The REST `/block` endpoint is described as a manual override without a comment context. This is a documentation gap rather than a code defect.

### Proposed Fix (Advisory)

Either:
- **Accept optional body in `/block`:** `{ commentId?, author?, text? }` — caller can supply context.
- **Document clearly** that REST `/block` produces a `blockedReason`-less blocked run; callers should use the comment endpoint for proper reason tracking.
- Add a note to the OpenAPI spec for `POST /block` response: `blockedReason` field may be absent.
