# Blueprint: Bug Fix — Agent Progress UI (completion detection)

## 1. Problem Summary

| Symptom | Root Cause |
|---------|-----------|
| Pipeline progress bar stuck at stage 1 | `useAgentCompletion` uses a done-column diff (`prevTasksRef`). For stages 2–4, the task is already in the done column, so the diff never triggers. |
| AgentRunIndicator never closes | Same root cause: `clearActiveRun()` is never called because the completion predicate never fires. |
| Intermittent non-detection on fast agents | Race condition: agent moves task done→in-progress→done within one 3 s poll window. Diff sees no change. |

---

## 2. Current Flow (broken)

```
executeAgentRun()
  └─ activeRun = { taskId, agentId, startedAt }

[every 3 s] loadBoard() → store.tasks updated
  └─ useAgentCompletion subscriber fires
       ├─ if (doneIds === prevDoneIds) return          ← ALWAYS TRUE for pipeline stages 2+
       ├─ prevTasksRef.current = doneIds
       └─ if (taskId ∉ done) return
           └─ clearActiveRun()  ← NEVER REACHED in pipeline stages 2+
```

---

## 3. Fixed Flow

```
executeAgentRun()
  └─ activeRun = { taskId, agentId, startedAt }

[every 1 s while activeRun ≠ null, else 3 s] loadBoard() → store.tasks updated
  └─ useAgentCompletion subscriber fires
       ├─ if (activeRun == null) return
       ├─ taskInDone = tasks['done'].find(t => t.id === activeRun.taskId)
       ├─ if (taskInDone == null) return
       ├─ if (taskInDone.updatedAt < activeRun.startedAt) return  ← handles pipeline stages 2+
       └─ clearActiveRun() + showToast() + advancePipeline()?     ← ALWAYS REACHED correctly
```

---

## 4. Component Design

### 4.1 `useAgentCompletion.ts` — changed

**Remove:** `prevTasksRef`, `prevDoneIds` change-detection logic.

**Add:** direct `updatedAt ≥ startedAt` predicate on the task found in the done column.

```typescript
const taskInDone = doneTasks.find(t => t.id === activeRun.taskId);
if (!taskInDone) return;
if (new Date(taskInDone.updatedAt) < new Date(activeRun.startedAt)) return;
// → completion
```

No other logic changes needed. Pipeline advancement (`advancePipeline` / toast) remains identical.

### 4.2 `usePolling.ts` — changed

**Replace** the fixed `POLL_INTERVAL_MS = 3000` constant with an adaptive interval:
- `activeRun !== null` → 1000 ms
- `activeRun === null` → 3000 ms

Implementation: subscribe to `activeRun` via `useAppStore` inside the hook; restart the `setInterval` when the interval value changes.

```typescript
const activeRun = useAppStore(s => s.activeRun);
const interval = activeRun ? 1000 : 3000;

useEffect(() => {
  const id = setInterval(() => {
    const { isMutating, loadBoard } = useAppStore.getState();
    if (!isMutating) loadBoard();
  }, interval);
  return () => clearInterval(id);
}, [interval]);
```

### 4.3 No changes needed

| Component | Reason |
|-----------|--------|
| `AgentRunIndicator.tsx` | Correctly hides when `activeRun = null`. No change needed. |
| `PipelineProgressBar.tsx` | Correctly renders `currentStageIndex`. Will work once `advancePipeline()` is called. |
| `useAppStore.ts` | `AgentRun` type, `clearActiveRun`, `advancePipeline` are all correct. No change needed. |
| `server.js` | Already sets `task.updatedAt` on every move. No change needed. |

---

## 5. Data Flow Diagram

```
┌─────────────────────────────────────────┐
│              Browser                    │
│                                         │
│  AgentLauncherMenu                      │
│       │ prepareAgentRun()               │
│       ▼                                 │
│  AgentPromptPreview ──(execute)──►      │
│       │ executeAgentRun()               │
│       ▼                                 │
│  activeRun = { taskId, startedAt }      │
│       │                                 │
│       ▼                                 │
│  AgentRunIndicator (visible, pulsing)   │
│  PipelineProgressBar (stage N active)   │
│                                         │
│  usePolling: 1 s (activeRun != null)    │
│       │ loadBoard()                     │
│       ▼                                 │
│  tasks['done'] updated                  │
│       │                                 │
│  useAgentCompletion subscriber          │
│       │ find taskId in done?            │
│       │ updatedAt >= startedAt?         │
│       ▼                                 │
│  clearActiveRun()                       │
│  showToast("completed")                 │
│  advancePipeline() [if pipeline]        │
│       │                                 │
│  activeRun = null                       │
│  pipelineState.currentStageIndex++      │
│       │                                 │
│  AgentRunIndicator (hidden)             │
│  PipelineProgressBar (stage N+1 active) │
└─────────────────────────────────────────┘
         │ GET /spaces/:id/tasks (every 1 s during run)
         ▼
┌─────────────────────────────────────────┐
│              server.js                  │
│  PUT /tasks/:id/move                    │
│    → task.updatedAt = new Date()        │
└─────────────────────────────────────────┘
```

---

## 6. Edge Cases

| Case | Behaviour |
|------|-----------|
| Agent never moves task (no Kanban use) | Indicator stays until user manually cancels via ✕. Same as before — not regressed. |
| Agent crashes mid-run | Task stays in in-progress. Indicator stays. User cancels or retries. No change. |
| Task updated mid-run for another reason (attachment added) | `updatedAt` may be newer than `startedAt` but task is not yet in done. Predicate requires task to be in done column, so no false positive. |
| Very fast agent (< 1 s) | Task in done when first poll fires. Detected on first 1 s poll. |
| Multiple concurrent runs | `activeRun` holds one run at a time. Already enforced by `AgentLauncherMenu` (`disabled when activeRun ≠ null`). |

---

## 7. Acceptance Criteria (traceability to tasks.json)

- T-001: `useAgentCompletion` detects pipeline stage completion using `updatedAt` predicate. `prevTasksRef` removed. Unit tests updated.
- T-002: Polling interval is 1 s when `activeRun ≠ null`, 3 s otherwise. Existing poll tests updated.
- T-003: Manual E2E verification: launch 4-stage pipeline → all 4 stages advance and bar closes after final stage.
