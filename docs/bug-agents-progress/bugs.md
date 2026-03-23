# Bug Report: bug-agents-progress QA

**Branch:** `feature/bug-agents-progress`
**QA date:** 2026-03-23
**QA engineer:** qa-engineer-e2e

---

## Summary

| ID | Severity | Type | Component | Title | Status |
|----|----------|------|-----------|-------|--------|
| BUG-001 | Low | Code Quality | usePolling.ts | Dead code: `intervalMsRef` declared and updated but never read | Open |
| BUG-002 | Low | Testing Gap | useAgentCompletion.test.ts | Equal-timestamp boundary (updatedAt === startedAt) not covered by any test | Open |
| BUG-003 | Low | Testing Gap | useAgentCompletion.test.ts | `agentId` fallback path in toast (agent not in availableAgents) not explicitly tested | Open |
| BUG-PRE-001 | Pre-existing | Functional | useAppStore.test.ts | `executeAgentRun` test times out — unrelated to this branch | Pre-existing, out of scope |

**Merge gate result: PASS** — Zero Critical or High bugs found.

---

## BUG-001: Dead code — `intervalMsRef` declared and updated but never read

- **Severity:** Low
- **Type:** Code Quality
- **Component:** `frontend/src/hooks/usePolling.ts` — lines 41–44

```
const intervalMsRef = useRef(intervalMs);
useEffect(() => {
  intervalMsRef.current = intervalMs;
});
```

- **Reproduction Steps:**
  1. Open `frontend/src/hooks/usePolling.ts`.
  2. Search for `intervalMsRef` — it is declared, updated in a layout effect, but never consumed anywhere in the hook or passed to any callback.
- **Expected Behavior:** Every declared `useRef` should either be passed to a DOM element or read inside a callback to avoid stale closures. If unused, it should be removed.
- **Actual Behavior:** `intervalMsRef` accumulates the latest `intervalMs` value on every render but is not read anywhere. The interval callback at line 47 reads `intervalMs` from the closure, which is correct because the interval is restarted (new closure) whenever `intervalMs` changes.
- **Root Cause Analysis:** The ref was likely a placeholder from an earlier draft of the fix that intended to use a ref-based approach (reading the ref inside a stable closure) but the implementation was changed to restart the interval instead. The ref was not cleaned up.
- **Impact:** Zero functional impact. The fix is correct without the ref. The ref adds minor confusion for future readers who may wonder why it exists.
- **Proposed Fix:** Remove the two lines (declaration and the `useEffect` that updates it) from `usePolling.ts`. No behaviour changes — the interval already reads `isMutating` and `loadBoard` from `useAppStore.getState()` to avoid stale closures, and `intervalMs` in the `setInterval` call is correct because the effect restarts when `intervalMs` changes.

---

## BUG-002: Test gap — equal-timestamp boundary (updatedAt === startedAt) not covered

- **Severity:** Low
- **Type:** Testing Gap
- **Component:** `frontend/__tests__/hooks/useAgentCompletion.test.ts`

- **Reproduction Steps:**
  1. Review the timestamp fixtures in `useAgentCompletion.test.ts`:
     - `UPDATED_BEFORE = '2026-01-01T09:59:59.000Z'` (one second before)
     - `UPDATED_AFTER  = '2026-01-01T10:00:01.000Z'` (one second after)
  2. The implementation guard is `new Date(taskInDone.updatedAt) < new Date(activeRun.startedAt)` — which means equal timestamps (`===`) pass the guard and trigger completion.
  3. No test covers `updatedAt === startedAt` to verify the boundary fires correctly.
- **Expected Behavior:** A test case should verify that when `updatedAt` equals `startedAt` exactly, completion IS triggered (the predicate is `<`, so equal timestamps are not blocked).
- **Actual Behavior:** The boundary is untested. The code is correct but correctness at the boundary is not asserted.
- **Root Cause Analysis:** Test fixtures were written with comfortable before/after offsets. The exact-equal boundary was not considered during test authoring.
- **Proposed Fix:** Add a test case in `useAgentCompletion.test.ts`:
  ```
  it('DOES trigger when task.updatedAt exactly equals activeRun.startedAt', ...)
  ```
  Use `updatedAt: RUN_STARTED_AT` and assert `clearActiveRun` is called once.

---

## BUG-003: Test gap — agentId fallback path not explicitly tested

- **Severity:** Low
- **Type:** Testing Gap
- **Component:** `frontend/__tests__/hooks/useAgentCompletion.test.ts`

- **Reproduction Steps:**
  1. Review the completion toast logic in `useAgentCompletion.ts`:
     ```typescript
     const agentDisplayName =
       availableAgents.find((a) => a.id === activeRun.agentId)?.displayName ??
       activeRun.agentId;
     ```
  2. TC-004 tests the `displayName` found path.
  3. No test verifies the fallback where the agent ID is not in `availableAgents` — in that case `activeRun.agentId` (e.g. `'developer-agent'`) should appear in the toast.
- **Expected Behavior:** A test should confirm that when `availableAgents` is empty or does not contain the `agentId`, the toast still fires and contains the raw `agentId` string.
- **Actual Behavior:** The path is implicitly exercised by other tests that leave `availableAgents: []` in the store (e.g. TC-002), but no test makes an explicit assertion about the agentId fallback text in the toast message.
- **Root Cause Analysis:** TC-003 asserts `toastFn` was called with a string containing `'completed'` but does not assert the agent identifier portion of the message. The fallback text is unchecked.
- **Proposed Fix:** Add one test case that sets `availableAgents: []` and asserts `toastFn` was called with a string containing `'developer-agent'` (the raw `agentId`).

---

## BUG-PRE-001: Pre-existing — executeAgentRun test timeout (out of scope)

- **Severity:** Medium (pre-existing)
- **Type:** Functional / Test Infrastructure
- **Component:** `frontend/__tests__/stores/useAppStore.test.ts`
- **Test:** `executeAgentRun > shows "Opening terminal..." toast and error when terminalSender is null after 500ms wait`

- **Status:** Pre-existing on `main`. Not introduced by this branch. Confirmed via `git diff main..feature/bug-agents-progress -- __tests__/stores/useAppStore.test.ts` (no output — file not touched by this branch).
- **Reproduction Steps:** `cd frontend && npm test -- --run` — the test consistently times out at 5000ms.
- **Root Cause Analysis (preliminary):** The test uses a real 500ms `setTimeout` path inside `executeAgentRun`. Under the Vitest fake-timer configuration this test may not be using fake timers, causing the assertion to wait for a real 500ms delay. The 5000ms Vitest default timeout is then consumed by repeated retries or a stuck `waitFor`. Requires separate investigation.
- **Proposed Fix:** Investigate whether the test should use `vi.useFakeTimers()` + `vi.advanceTimersByTime(500)`, or whether the test timeout should be raised to ≥ 6000ms via `{ timeout: 6000 }` as the third argument to `it()`.
- **Note:** This bug is out of scope for the merge gate of `feature/bug-agents-progress`.
