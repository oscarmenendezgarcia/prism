# ADR-1: Agent Completion Detection — Replace Change-Diff with `updatedAt` Timestamp

## Status
Accepted

## Context

When a user launches an agent from a task card (single run or pipeline), a visual indicator (`AgentRunIndicator` + `PipelineProgressBar`) is shown in the header. The indicator must:

1. Show the currently-running agent's name.
2. Advance the stage counter when one pipeline stage finishes and the next begins.
3. Disappear when the run (or full pipeline) completes.

**Reported bugs:**
- The pipeline progress bar does not advance between agents (stuck at stage 1).
- The indicator is never closed when the task finishes.

**Root cause** — `useAgentCompletion` detects completion by diffing the done-column task IDs against a persistent `prevTasksRef`:

```
if (doneIds === prevDoneIds) return;
prevTasksRef.current = doneIds;
// then check if activeRun.taskId is in done
```

This breaks in two ways:

**1. Pipeline stages 2–4 (primary bug).**
After stage 1 completes, `prevTasksRef` contains the pipeline `taskId`. For stages 2–4, the same `taskId` is reused. The done column composition does not change (task is already there), so `doneIds === prevDoneIds` is always true → hook never fires → `clearActiveRun()` and `advancePipeline()` are never called.

**2. Race condition (secondary bug).**
If the agent moves the task done → in-progress → done faster than the 3 s polling window, both transitions are invisible to the poller. The done column looks identical before and after, so completion is again never detected.

## Decision

Replace `prevTasksRef` change-detection in `useAgentCompletion` with a direct comparison of `task.updatedAt` against `activeRun.startedAt`.

**New completion predicate:**
```
task ∈ done  AND  task.updatedAt >= activeRun.startedAt
```

Additionally, reduce the polling interval from 3 s to 1 s while an `activeRun` is active, to minimize detection latency.

## Rationale

- `task.updatedAt` is already set by the server on every `PUT /tasks/:id/move` call (server.js line 411). No backend changes required.
- The predicate is **idempotent**: it fires exactly once per run. After `clearActiveRun()` sets `activeRun = null`, the hook's early-return guard (`if (!activeRun) return`) prevents any re-entry.
- It correctly handles all pipeline stages (each stage starts with a fresh `startedAt`).
- It is immune to race conditions: even if done→in-progress→done happens within one poll cycle, the final `updatedAt` is still > `startedAt`.
- It requires changes to only two files: `useAgentCompletion.ts` and `usePolling.ts`. No store-type changes are needed.

## Consequences

**Positive:**
- Pipeline progress bar advances reliably through all four stages.
- AgentRunIndicator closes automatically after every successful run.
- Simpler code: `prevTasksRef` and its update logic are removed entirely.
- Faster UX feedback: 1 s polling during active runs.

**Negative / Risks:**
- If an agent updates `updatedAt` on a task for a reason _other_ than completion (e.g., adding an attachment mid-run), completion may be detected prematurely. Mitigation: this is the existing behaviour of Kanban operations; agents currently only move tasks at completion, so the risk is low.
- 1 s polling increases server request frequency during active runs. Mitigation: at 1 s the load is minimal (a single JSON read per poll), and polling reverts to 3 s when no run is active.

## Alternatives Considered

- **`prevTasksRef` reset on new run**: Reset `prevTasksRef` when `activeRun.startedAt` changes. Rejected: requires two-phase detection logic (wait for task to leave done, then return) which is complex and still races.
- **`doneAtRunStart` field on `AgentRun`**: Snapshot done IDs at run start and compare. Rejected: same race condition; needs type changes.
- **Backend SSE / WebSocket completion event**: Reliable but requires significant backend work (process lifecycle management, streaming). Deferred to a future ADR.
- **Terminal output monitoring**: Detect shell-prompt return as process-exit signal. Rejected: fragile (prompt detection is shell-specific) and complex to implement safely.

## Review
Suggested review date: 2026-09-23
