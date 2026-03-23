# Bug Report: Agent Run History Panel

## Summary

| ID | Severity | Type | Status |
|----|----------|------|--------|
| BUG-001 | Medium | Test | Open |
| BUG-002 | Low | Test | Open |
| BUG-003 | Medium | Coverage | Open |
| BUG-004 | Low | Spec Drift | Open |
| BUG-005 | Low | Spec Drift | Open |

**Merge gate:** Zero Critical or High bugs. Current status: PASS — feature is mergeable. Medium and Low bugs should be resolved post-merge or in the next QA cycle.

---

## BUG-001: executeAgentRun terminal-wait test times out with fake timers

- **Severity:** Medium
- **Type:** Test
- **Component:** `frontend/__tests__/stores/useAppStore.test.ts` — `executeAgentRun > shows "Opening terminal..." toast and error when terminalSender is null after 500ms wait`
- **Reproduction Steps:**
  1. Run `cd frontend && npm test`
  2. Observe test `shows "Opening terminal..." toast and error when terminalSender is null after 500ms wait` in `useAppStore.test.ts` fails with "Test timed out in 5000ms".
- **Expected Behavior:** The test advances fake timers to simulate the full 3000ms terminal-connection timeout, observes the error toast, and passes.
- **Actual Behavior:** The test calls `vi.advanceTimersByTime(500)` — advancing only 500ms. The `executeAgentRun` function loops every 100ms for up to 3000ms (POLL_TIMEOUT) waiting for `terminalSender` to become non-null. With only 500ms advanced, 25 pending 100ms setTimeout callbacks remain, so `await execPromise` never resolves within the 5000ms test timeout.
- **Root Cause Analysis:** When the poll timeout was extended from approximately 500ms to 3000ms during development, the test assertion `vi.advanceTimersByTime(500)` was not updated to reflect the new total. The test name still says "500ms wait" but the implementation polls for 3000ms.
- **Proposed Fix:** Update the test to call `vi.advanceTimersByTime(3000)` (or `vi.runAllTimersAsync()`) to exhaust the full 3000ms POLL_TIMEOUT. Also update the test name to match the actual timeout: `"shows error toast when terminalSender is still null after 3000ms polling timeout"`.

---

## BUG-002: useAppStore.test.ts mock missing createAgentRun / updateAgentRun / getAgentRuns exports

- **Severity:** Low
- **Type:** Test
- **Component:** `frontend/__tests__/stores/useAppStore.test.ts` — `vi.mock('../../src/api/client')` factory
- **Reproduction Steps:**
  1. Run `cd frontend && npm test`
  2. Observe stderr for tests in the `executeAgentRun` describe block: `[run-history] Failed to persist run start: Error: [vitest] No "createAgentRun" export is defined on the "../../src/api/client" mock.`
- **Expected Behavior:** All api/client mock exports are defined. No stderr noise about missing mock exports. The `useRunHistoryStore.recordRunStarted()` call inside `executeAgentRun` resolves cleanly.
- **Actual Behavior:** The `vi.mock` factory in `useAppStore.test.ts` was written before the `createAgentRun`, `updateAgentRun`, and `getAgentRuns` exports were added to `api/client` by the Agent Run History feature. The missing exports cause Vitest to throw when `recordRunStarted` calls `createAgentRun`. The error is caught by the `try/catch` in `recordRunStarted` (non-fatal), so affected `executeAgentRun` tests still pass — but the stderr pollution can mask real errors in CI logs.
- **Root Cause Analysis:** The mock factory was not updated when the new API functions were added. The `executeAgentRun` function now calls into `useRunHistoryStore` which calls `createAgentRun` from `api/client`. The mock must include all exports that any transitively-loaded module uses.
- **Proposed Fix:** Add `createAgentRun: vi.fn().mockResolvedValue({ id: 'run_mock' })`, `updateAgentRun: vi.fn().mockResolvedValue({ id: 'run_mock', status: 'completed' })`, and `getAgentRuns: vi.fn().mockResolvedValue({ runs: [], total: 0 })` to the `vi.mock` factory in `useAppStore.test.ts`.

---

## BUG-003: Missing tests — TaskCard active-run click interaction, taskIdFilter chip, openPanelForTask, useRunHistoryPolling

- **Severity:** Medium
- **Type:** Coverage
- **Component:** Multiple — `TaskCard.tsx`, `RunHistoryPanel.tsx`, `useRunHistoryStore.ts`, `useRunHistoryPolling.ts`

**Description:**

The following interactions added or confirmed after developer implementation have no test coverage:

1. **TaskCard active-run indicator (click path):** `TaskCard.tsx` renders a `<button>` labeled "Agent running — view run history for this task" when `isActiveTask` is true. Clicking it calls `openPanelForTask(task.id)`. The existing `TaskCard.test.tsx` has no `activeRun` scenario — it does not test that the indicator renders, that it is absent when `activeRun` is null, or that clicking it calls `openPanelForTask`. This is the specific interaction described in the QA task brief ("Clicking the pulsing Running badge on a task card opens the Run History panel filtered to that task").

2. **RunHistoryPanel taskIdFilter chip:** `RunHistoryPanel.tsx` renders a "Filtering by task" chip with an X button when `taskIdFilter` is non-null. No test covers this conditional rendering or the X button's `clearTaskIdFilter` call.

3. **useRunHistoryStore openPanelForTask / clearTaskIdFilter:** The `useRunHistoryStore.test.ts` file covers `loadRuns`, `recordRunStarted`, `recordRunFinished`, `setFilter`, and `toggleHistoryPanel`, but not `openPanelForTask` (sets `historyPanelOpen=true`, `taskIdFilter`, `filter='all'`) or `clearTaskIdFilter` (sets `taskIdFilter=null`).

4. **useRunHistoryPolling hook:** No test file exists. The hook's two behaviors — switching from 3000ms to 1000ms when `activeRun` becomes non-null, and skipping calls when `isMutating` is true — are untested.

- **Reproduction Steps:** Run `cd frontend && npm test`. Observe that `TaskCard.test.tsx` has 16 tests with no `activeRun` scenario. No test file for `useRunHistoryPolling`. No `taskIdFilter` scenario in `RunHistoryPanel.test.tsx` or `useRunHistoryStore.test.ts`.

- **Expected Behavior:** All user-facing interaction paths have at least one test verifying the expected behavior, per the QA task brief requirement and the user stories DoD (Story 3.1: "Test: indicator visible when activeRun.taskId === task.id, not visible otherwise"; Story 2.1: panel open state tested).

- **Actual Behavior:** The click-to-open-panel path on TaskCard is entirely untested. The taskIdFilter chip UI is untested. The `useRunHistoryPolling` hook has zero tests.

- **Root Cause Analysis:** The TaskCard active-run indicator and panel-task-filter interaction were noted as "added after dev" in the QA task brief. The developer tests were written for the initial feature set and were not extended for this post-dev addition.

- **Proposed Fix:**
  - Add to `TaskCard.test.tsx`: (a) mock `useRunHistoryStore` alongside `useAppStore`; (b) test that "Running" button renders when `activeRun.taskId === task.id`; (c) test that clicking it calls `openPanelForTask(task.id)`; (d) test that the button is absent when `activeRun` is null.
  - Add to `RunHistoryPanel.test.tsx`: (a) set `taskIdFilter` in store state; (b) assert "Filtering by task" chip renders; (c) click X button and assert `clearTaskIdFilter` was called.
  - Add to `useRunHistoryStore.test.ts`: tests for `openPanelForTask` and `clearTaskIdFilter` state transitions.
  - Create `frontend/__tests__/hooks/useRunHistoryPolling.test.ts` with fake-timer tests for the 1s/3s cadence switch and the `isMutating` skip guard.

---

## BUG-004: Filter pill label "Done" diverges from spec "Completed"

- **Severity:** Low
- **Type:** Spec Drift
- **Component:** `frontend/src/components/agent-run-history/RunHistoryPanel.tsx` — `FILTER_OPTIONS` array

- **Reproduction Steps:**
  1. Open the Run History panel in the browser.
  2. Observe the third filter pill is labeled "Done".

- **Expected Behavior:** User story 2.3 Acceptance Criteria lists five filter pills as: "All, Running, Completed, Cancelled, Failed".

- **Actual Behavior:** The implementation uses the label "Done" for the `completed` filter value:
  ```
  { label: 'Done', value: 'completed' }
  ```
  The `RunHistoryPanel.test.tsx` test asserts `getByRole('button', { name: 'Done' })`, confirming this is not a test error.

- **Root Cause Analysis:** "Done" is the board column name used in the Kanban UI ("todo", "in-progress", "done"). The developer appears to have re-used this terminology instead of the spec's "Completed". The underlying `filter` value is correctly set to `'completed'`.

- **Proposed Fix:** Change the label string in `FILTER_OPTIONS` from `'Done'` to `'Completed'`. Update the corresponding assertion in `RunHistoryPanel.test.tsx` from `{ name: 'Done' }` to `{ name: 'Completed' }`.

---

## BUG-005: RunHistoryPanel header pulse uses animate-pulse instead of animate-ping

- **Severity:** Low
- **Type:** Spec Drift
- **Component:** `frontend/src/components/agent-run-history/RunHistoryPanel.tsx` — pulsing dot in header

- **Reproduction Steps:**
  1. While an agent run is active, open the Run History panel.
  2. Observe the dot next to "Run History" in the panel header.

- **Expected Behavior:** User story 4.1 states: "The dot uses `animate-ping` pattern and `bg-primary` color." The TaskCard indicator correctly uses the `animate-ping` overlay pattern (a relative container with an absolute ping overlay plus a static dot).

- **Actual Behavior:** The panel header dot uses `animate-pulse` (opacity fade) on a single element:
  ```tsx
  <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
  ```
  The TaskCard active-run indicator uses the two-element `animate-ping` / static dot pattern consistently with the header indicator in the original design.

- **Root Cause Analysis:** The developer used `animate-pulse` (a simple opacity oscillation) in the panel header but `animate-ping` (expanding ring) in the TaskCard indicator. The user story specifies `animate-ping` for the panel header dot too. The `RunStatusBadge` also uses `animate-pulse` for the running dot — however, the badge was not covered by this specific user story requirement.

- **Proposed Fix:** Replace the single `animate-pulse` span in `RunHistoryPanel` header with the two-element `animate-ping` overlay pattern:
  ```tsx
  <span className="relative flex h-2 w-2" aria-label="A run is currently active">
    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
  </span>
  ```
  Update the test assertion in `RunHistoryPanel.test.tsx` from `.animate-pulse` to `.animate-ping`.
