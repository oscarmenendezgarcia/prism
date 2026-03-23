# Bug Report: Pipeline Sub-Tasks

Feature branch: `feature/bug-agents-progress`
QA date: 2026-03-23
QA agent: `qa-engineer-e2e`

---

## Summary

| ID | Severity | Type | Component | Status |
|----|----------|------|-----------|--------|
| BUG-001 | Medium | Test Defect | `useAppStore.test.ts` | Open |
| BUG-002 | Low | Test Coverage Gap | `useAppStore.test.ts` | Open |

**Merge gate: PASSED** — zero Critical or High bugs.

---

## BUG-001: executeAgentRun fake-timer test times out — `vi.advanceTimersByTime` miscalibrated

- **Severity**: Medium
- **Type**: Test Defect (not a production defect)
- **Component**: `frontend/__tests__/stores/useAppStore.test.ts`
  — test: `executeAgentRun > shows "Opening terminal..." toast and error when terminalSender is null after 500ms wait`

### Reproduction Steps

1. `cd frontend && npm test -- --run`
2. Observe timeout after 5 seconds on the above test case.

### Expected Behavior

The test should complete within the default 5 s timeout and assert that:
- `toast.type === 'error'`
- The error message contains the "could not connect" string

### Actual Behavior

```
Error: Test timed out in 5000ms.
```
The test advances fake timers by only 500 ms, then calls `await execPromise`. The `executeAgentRun` action contains a polling loop:

```ts
const POLL_INTERVAL = 100;
const POLL_TIMEOUT  = 3000;
let elapsed = 0;
while (elapsed < POLL_TIMEOUT) {
  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  elapsed += POLL_INTERVAL;
  if (get().terminalSender) break;
}
```

With fake timers, each `setTimeout(resolve, 100)` only fires when `vi.advanceTimersByTime` is called. After advancing 500 ms the loop has completed 5 of 30 iterations. The remaining 25 iterations (2500 ms of fake time) never advance because `vi.advanceTimersByTime` is not called again. `execPromise` never resolves and the test hangs until the 5 s global timeout.

### Root Cause Analysis

The test comment says `"Advance the 500ms wait"` implying the author expected a 500 ms poll timeout. The actual production constant is `POLL_TIMEOUT = 3000`. There are two possible root causes:

1. The production constant was changed from 500 ms to 3000 ms after the test was written, without updating the test.
2. The test was written with an incorrect assumption about the poll duration.

In either case the fix is in the test, not the production code. The polling duration of 3000 ms is intentional (gives the terminal shell time to initialize).

### Proposed Fix

In `useAppStore.test.ts`, change `vi.advanceTimersByTime(500)` to `vi.advanceTimersByTime(3100)`. The value 3100 is sufficient to exhaust all 30 poll iterations (30 × 100 ms = 3000 ms) plus a 100 ms margin. The `await execPromise` will then resolve with the timeout error path.

The corrected test should be:

```ts
// Advance past the full 3000ms poll window — sender is still null
vi.advanceTimersByTime(3100);
await execPromise;

expect(useAppStore.getState().toast?.type).toBe('error');
```

**Note:** The test must also ensure that `advanceTimersByTime` is called before `await execPromise`, or use `Promise.all` with timer advancement, because `await execPromise` with insufficient timer advance causes deadlock under fake timers. The existing structure (advance then await) is correct — only the duration needs updating.

---

## BUG-002: `startPipeline` / `advancePipeline` — `api.createTask` payload fields not fully asserted in tests

- **Severity**: Low
- **Type**: Test Coverage Gap
- **Component**: `frontend/__tests__/stores/useAppStore.test.ts`
  — `startPipeline` and `advancePipeline` describe blocks

### Description

The blueprint specifies the following required fields for the sub-task creation payload (section 7):

```json
{
  "title":       "[Main Task Title] / Stage N: [Agent Display Name]",
  "type":        "research",
  "assigned":    "[agent-id]",
  "description": "Pipeline sub-task for stage N. Parent task: [mainTaskId]"
}
```

The existing tests assert:
- `title` — only that it `stringContaining(mainTitle)`. The `/ Stage N: [displayName]` segment is **not** verified.
- `type` — **not asserted** (MOCK_SUB_TASK has `type: 'research'` but no test inspects the actual call arguments for this field).
- `assigned` — **not asserted** (no test verifies the agent ID is passed to the createTask payload).
- `description` — **not asserted** (no test verifies the `"Parent task: <id>"` format).

### Risk

If a developer inadvertently removes `type: 'research'` or `assigned: firstStage` from the `api.createTask` call, no test will fail. The sub-task would be created with wrong metadata, agents would receive no `assigned` field, and the board would not show correct attribution.

### Reproduction Steps

1. In `useAppStore.ts`, remove `assigned: firstStage` from the `api.createTask` payload in `startPipeline`.
2. Run `npm test -- --run`.
3. Observe: all tests pass despite the payload being incorrect.

### Proposed Fix

Add assertions for the full payload shape in the `startPipeline` and `advancePipeline` test suites. Specifically, add one test each for the correct title pattern, `type`, `assigned`, and description format:

```ts
it('calls api.createTask with correct payload shape for stage 1', async () => {
  vi.mocked(api.generatePrompt).mockResolvedValue(MOCK_PROMPT_RESULT);
  useAppStore.setState({
    availableAgents: [{ id: 'senior-architect', displayName: 'Senior Architect', ... }],
    tasks: { todo: [{ id: 'task-main', title: 'My Feature', ... }], ... }
  });

  await useAppStore.getState().startPipeline('space-1', 'task-main');

  expect(api.createTask).toHaveBeenCalledWith('space-1', {
    title:       'My Feature / Stage 1: Senior Architect',
    type:        'research',
    assigned:    'senior-architect',
    description: 'Pipeline sub-task for stage 1. Parent task: task-main',
  });
});
```

The same pattern should be applied to `advancePipeline` for stage 2+.
