# Bug Report: Cross-Agent Question Resolver

## Summary

| ID | Severity | Type | Status |
|----|----------|------|--------|
| BUG-001 | Medium | Functional | Open |
| BUG-002 | Low | Functional (Observability) | Open |
| BUG-003 | Low | Test Coverage Gap | Open |

---

## BUG-001: `unblockRunByComment` does not trigger resolver for subsequent questions with `targetAgent`

- **Severity**: Medium
- **Type**: Functional
- **Component**: `src/services/pipelineManager.js` — `unblockRunByComment()`, lines ~1694–1709

### Reproduction Steps

1. Create a task with two questions, both with `targetAgent` set (e.g., Q1 targets `ux-api-designer`, Q2 targets `senior-architect`).
2. Start a pipeline run with both agents in `stages`.
3. The run blocks on Q1. `attemptCrossAgentResolution` is called and spawns a resolver for Q1.
4. The resolver answers Q1 by calling `kanban_answer_comment` → `unblockRunByComment` fires.
5. `unblockRunByComment` sees Q2 is still unresolved → updates `blockedReason` to point to Q2.
6. **Expected**: resolver is automatically spawned for Q2 (it also has `targetAgent`).
7. **Actual**: no resolver spawned for Q2. Pipeline remains blocked. Human must answer Q2 manually.

### Expected Behavior

When `unblockRunByComment` transitions `blockedReason` to the next unresolved question, if that question has a `targetAgent`, `attemptCrossAgentResolution` should be called for it. The `blockedReason` should also include the `targetAgent` field for the new question.

### Actual Behavior

`unblockRunByComment` builds the new `blockedReason` without the `targetAgent` field:

```js
run.blockedReason = {
  commentId: next.id,
  taskId,
  author:    next.author,
  text:      next.text,
  // ← targetAgent missing!
  blockedAt: run.blockedReason?.blockedAt || new Date().toISOString(),
};
writeRun(dataDir, run);
// ← attemptCrossAgentResolution never called for next question
```

### Root Cause Analysis

The `unblockRunByComment` function was written before the `targetAgent` / resolver feature and was not updated to forward resolver triggering. The `attemptCrossAgentResolution` call is only present in two places: `blockRunByComment` and `handleStageClose`. Neither fires when transitioning from Q1 → Q2 within `unblockRunByComment`.

### Proposed Fix

In `unblockRunByComment`, after updating `blockedReason` for the next question:

1. Include `targetAgent` in the new `blockedReason` if `next.targetAgent` is set.
2. If `next.targetAgent` is present and `run.resolverActive !== true`, call `attemptCrossAgentResolution(dataDir, updatedRun, next)`.

```js
// In the else branch of unblockRunByComment:
const next = unresolvedQuestions[0];
run.blockedReason = {
  commentId: next.id,
  taskId,
  author:    next.author,
  text:      next.text,
  ...(next.targetAgent && { targetAgent: next.targetAgent }),  // ← ADD THIS
  blockedAt: run.blockedReason?.blockedAt || new Date().toISOString(),
};
writeRun(dataDir, run);
pipelineLog('run.still_blocked', { ... });

// ← ADD THIS:
if (next.targetAgent) {
  const freshRun = readRun(dataDir, run.runId);
  if (freshRun) attemptCrossAgentResolution(dataDir, freshRun, next);
}
```

---

## BUG-002: `resolver.timeout` log event reads already-deleted `resolverPid` field

- **Severity**: Low
- **Type**: Functional (Observability)
- **Component**: `src/services/pipelineManager.js` — `handleResolverClose()`, lines ~1349–1395

### Reproduction Steps

1. Configure `PIPELINE_RESOLVER_TIMEOUT_MS=500` (very short timeout).
2. Start a pipeline with a question + valid `targetAgent`.
3. Wait for the resolver to be spawned.
4. Wait > 500ms for the timeout to fire.
5. Inspect stderr for the `resolver.timeout` log event.
6. **Expected**: log includes `pid: <process PID>`.
7. **Actual**: log includes `pid: undefined`.

### Expected Behavior

The `resolver.timeout` log event should include the PID of the process that was killed, per the blueprint's observability spec:
```
resolver.timeout: { runId, commentId, targetAgent, pid, timeoutMs }
```

### Actual Behavior

`handleResolverClose` deletes `run.blockedReason.resolverPid` **before** the timeout log event reads it:

```js
function handleResolverClose(...) {
  // Step 1: delete the field
  run.resolverActive = false;
  if (run.blockedReason) {
    delete run.blockedReason.resolverPid;    // ← deleted here
    delete run.blockedReason.resolverStartedAt;
  }
  writeRun(dataDir, run);

  // Step 2: try to read the deleted field
  if (reason === 'timeout') {
    pipelineLog('resolver.timeout', {
      pid: run.blockedReason?.resolverPid,   // ← always undefined!
      ...
    });
  }
```

### Root Cause Analysis

The cleanup of `blockedReason` fields happens unconditionally at the top of `handleResolverClose`, before the success/failure branching. The PID needed for the timeout log is consumed before the log runs.

### Proposed Fix

Capture the PID before deleting it:

```js
function handleResolverClose(dataDir, runId, comment, exitCode, startedAt, reason) {
  const durationMs = Date.now() - startedAt;
  const run = readRun(dataDir, runId);
  if (!run) return;

  // Capture PID before deleting it from blockedReason
  const resolverPid = run.blockedReason?.resolverPid;  // ← ADD THIS

  run.resolverActive = false;
  if (run.blockedReason) {
    delete run.blockedReason.resolverPid;
    delete run.blockedReason.resolverStartedAt;
  }
  writeRun(dataDir, run);

  if (exitCode === 0 && reason !== 'timeout') {
    pipelineLog('resolver.completed', { ... });
  } else {
    if (reason === 'timeout') {
      pipelineLog('resolver.timeout', {
        runId,
        commentId:   comment.id,
        targetAgent: comment.targetAgent,
        pid:         resolverPid,              // ← USE CAPTURED VALUE
        timeoutMs:   parseInt(process.env.PIPELINE_RESOLVER_TIMEOUT_MS || ...),
      });
    }
    ...
  }
}
```

---

## BUG-003: Missing automated tests for T-010 (server restart resolver recovery)

- **Severity**: Low
- **Type**: Test Coverage Gap
- **Component**: `src/services/pipelineManager.js` — `init()`, lines ~997–1037 / `tests/pipeline-blocked.test.js`

### Description

The `init()` function implements T-010 logic: when the server restarts with a blocked run that has `resolverActive=true`:
- If the resolver PID is still alive → reattach polling
- If the resolver PID is dead/stale → mark `needsHuman=true`, clear `resolverActive`

The code is implemented and appears correct, but there are no automated tests covering either path. All 5 resolver tests (R-1 through R-5) test live behavior, not restart recovery.

### Missing Test Cases

**T-010-A** (restart, live resolver):
```
1. Write a run.json with status=blocked, resolverActive=true, resolverPid=<live PID>
2. Write a valid resolver-<commentId>.done sentinel (simulating in-progress resolver)
3. Call init() (simulating server restart)
4. Verify: the done sentinel is detected, resolverActive is cleared appropriately
```

**T-010-B** (restart, dead resolver):
```
1. Write a run.json with status=blocked, resolverActive=true, resolverPid=99999 (dead PID)
2. Call init()
3. Verify: comment.needsHuman=true, resolverActive=false in run.json
```

**T-010-C** (restart, blocked run without resolverActive):
```
1. Write a run.json with status=blocked, resolverActive=false/absent
2. Call init()
3. Verify: run remains blocked, no changes made (existing behavior preserved)
```

### Impact

Without these tests, a regression in the restart-recovery path would not be automatically detected. The T-010 acceptance criteria in tasks.json are unverified by CI.

### Proposed Fix

Add a new `Unit: T-010 resolver restart recovery` suite to `tests/pipeline-blocked.test.js` covering the three scenarios above. Use the same pattern as existing unit tests (direct file manipulation, no server needed).

---

## Notes on TC-033 Assertion Gap

TC-033 in `mcp-comment-pipeline.test.js` verifies that a question with an invalid `targetAgent` causes the run to block. However, it does not assert that `comment.needsHuman=true` after pipelineManager processes the invalid targetAgent. While the code path is confirmed correct by R-2, adding this assertion would make TC-033 a complete acceptance test for the invalid-targetAgent path.

This is not filed as a separate bug but is noted here for completeness.
