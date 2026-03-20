# Bug Report: Settings Bar Redesign (feature/settings-bar)

**Date:** 2026-03-20
**Author:** qa-engineer-e2e
**Branch:** feature/settings-bar
**Merge gate:** BLOCKED — see BUG-001, BUG-002, BUG-003, BUG-004

---

## Summary

| ID      | Title                                                        | Severity | Type        | Status   |
|---------|--------------------------------------------------------------|----------|-------------|----------|
| BUG-001 | AgentLauncherMenu test asserts startPipeline called with one arg | Medium | Functional  | Open     |
| BUG-002 | ConfigFileSidebar agent-scope section has zero test coverage | Medium   | Functional  | Open     |
| BUG-003 | executeAgentRun sends \\r but test asserts \\n              | Medium   | Functional  | Open     |
| BUG-004 | executeAgentRun null-sender test times out due to real polling | Low    | Performance | Open     |
| BUG-005 | AgentLauncherMenu uses inline style={{}} for dropdown position | Low    | Code Style  | Open     |

---

## BUG-001: AgentLauncherMenu test asserts startPipeline called with one arg only

- **Severity:** Medium
- **Type:** Functional (test-code mismatch)
- **Component:** `frontend/__tests__/components/AgentLauncherMenu.test.tsx:299`
- **Affects:** `AgentLauncherMenu.tsx`, `useAppStore.startPipeline`

### Reproduction Steps

1. Run `cd frontend && npm test -- --run --reporter=verbose`.
2. Observe the failure:
   ```
   FAIL  AgentLauncherMenu — Run Full Pipeline > clicking Run Full Pipeline calls startPipeline with the spaceId
   AssertionError: expected "spy" to be called with arguments: [ 'my-space-id' ]
   Received:  Array [ "my-space-id", "task-1" ]
   ```

### Expected Behavior

The test should assert that `startPipeline` is called with both `spaceId` and `taskId`, matching the
updated `startPipeline(spaceId: string, taskId: string)` signature added in T-008.

### Actual Behavior

The test at line 299 calls:
```
expect(mockStartPipeline).toHaveBeenCalledWith('my-space-id');
```
The implementation calls `startPipeline(spaceId, taskId)` where `taskId` comes from the `taskId`
prop passed to `AgentLauncherMenu`. The test renders `<AgentLauncherMenu taskId="task-1" spaceId="my-space-id" />`,
so the actual call is `startPipeline('my-space-id', 'task-1')`. The test assertion is missing the
second argument.

### Root Cause Analysis

T-008 added `taskId` as a second parameter to `startPipeline` and updated `handleRunPipeline` in
`AgentLauncherMenu.tsx` to pass it. The test at line 299 was not updated to reflect the new
signature. This is a test-code synchronization failure — the implementation is correct, the test
is stale.

### Proposed Fix

Update `AgentLauncherMenu.test.tsx:299`:
```
// Before:
expect(mockStartPipeline).toHaveBeenCalledWith('my-space-id');

// After:
expect(mockStartPipeline).toHaveBeenCalledWith('my-space-id', 'task-1');
```

---

## BUG-002: ConfigFileSidebar agent-scope section has zero test coverage

- **Severity:** Medium
- **Type:** Functional (coverage gap)
- **Component:** `frontend/src/components/config/ConfigFileSidebar.tsx` — Agents section (lines 107–119)
- **Affects:** T-008 acceptance criteria

### Reproduction Steps

1. Search `__tests__/components/ConfigFileSidebar.test.tsx` for any test involving `scope: 'agent'`.
2. Confirm zero results.
3. The "Agents" section in `ConfigFileSidebar` was added in T-008 to surface agent config files.
   No test covers this new code path.

### Expected Behavior

`ConfigFileSidebar.test.tsx` should include at least one test:
- That renders the component with one or more `scope=agent` files in the store.
- Asserts the "Agents" section heading appears.
- Asserts the agent file names are listed.
- Asserts clicking an agent file calls `onRequestSwitch` with the correct fileId.

### Actual Behavior

`ConfigFileSidebar.test.tsx` uses fixtures with only `scope: 'global'` and `scope: 'project'`
files. The `agentFiles` render branch (lines 107–119 of `ConfigFileSidebar.tsx`) is never
exercised by any automated test.

### Root Cause Analysis

The `ConfigFileSidebar` component was modified in T-008 to add an "Agents" scope section, but
the test file was not updated to cover this new section. The pre-existing tests only provided
fixtures for global and project scopes.

### Proposed Fix

Add to `ConfigFileSidebar.test.tsx`:
```
// Setup an agentFile fixture:
{ id: 'agent-qa-md', name: 'qa-engineer-e2e.md', scope: 'agent', directory: '~/.claude/agents', sizeBytes: 100, modifiedAt: '...' }

// Tests to add:
it('renders "Agents" section heading when agent files exist', ...)
it('renders agent file names under the Agents section', ...)
it('calls onRequestSwitch with agent file id on click', ...)
```

---

## BUG-003: executeAgentRun sends \\r (carriage return) but test expects \\n (newline)

- **Severity:** Medium
- **Type:** Functional (implementation vs test contract mismatch)
- **Component:** `frontend/src/stores/useAppStore.ts:549` and `frontend/__tests__/stores/useAppStore.test.ts:451`

### Reproduction Steps

1. Run `cd frontend && npm test -- --run --reporter=verbose`.
2. Observe the failure:
   ```
   FAIL  executeAgentRun > sends the CLI command + newline via terminalSender when connected
   AssertionError: expected "spy" to be called with arguments: [ Array(1) ]
   Received:
     1st spy call: Array [
   -   "claude -p \"$(cat '/tmp/prompt.md')\"\n",
   +   "claude -p \"$(cat '/tmp/prompt.md')\"",
     ]
   ```
   (The actual call includes `\r` which in the diff display appears as a bare trailing newline.)

### Expected Behavior

The test documents the contract: `terminalSender` is called with `cliCommand + '\n'`.

### Actual Behavior

`useAppStore.ts:549`:
```javascript
const sent = sender(cmd + '\r');
```
The implementation appends `\r` (carriage return) rather than `\n` (newline). PTY terminals
require `\r` as the Enter key equivalent, so `\r` is the correct value for executing a command
in a shell. The test was written expecting `\n`, which would submit as Enter in some terminal
emulators but is generally incorrect for PTY/xterm contexts.

### Root Cause Analysis

Either:
1. The implementation was intentionally changed from `\n` to `\r` after the test was written
   (more likely — PTY terminals require `\r`), and the test was not updated; or
2. The implementation has a bug and should use `\n`.

Given that xterm.js/PTY use `\r` as Enter, the implementation is likely correct and the test
assertion needs to be updated to `cmd + '\r'`.

### Proposed Fix

Update `useAppStore.test.ts:450-452`:
```javascript
// Before:
expect(senderFn).toHaveBeenCalledWith(
  'claude -p "$(cat \'/tmp/prompt.md\')"' + '\n'
);

// After:
expect(senderFn).toHaveBeenCalledWith(
  'claude -p "$(cat \'/tmp/prompt.md\')"' + '\r'
);
```

Developer should confirm which character is correct for the PTY integration before making
this change.

---

## BUG-004: executeAgentRun null-sender test times out due to real async polling

- **Severity:** Low
- **Type:** Performance (test infrastructure)
- **Component:** `frontend/__tests__/stores/useAppStore.test.ts` — executeAgentRun null-sender test

### Reproduction Steps

1. Run `cd frontend && npm test -- --run --reporter=verbose`.
2. Observe:
   ```
   FAIL  executeAgentRun > shows "Opening terminal..." toast and error when terminalSender is null after 500ms wait
   Error: Test timed out in 5000ms.
   ```

### Expected Behavior

The test should complete within Vitest's 5-second default timeout, verifying that when
`terminalSender` is null, the store shows a toast and returns without sending a command.

### Actual Behavior

`executeAgentRun` in `useAppStore.ts` contains a polling loop that awaits 100ms intervals
up to 3 seconds waiting for `terminalSender` to become non-null:
```javascript
while (elapsed < POLL_TIMEOUT) {
  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  elapsed += POLL_INTERVAL;
  if (get().terminalSender) break;
}
```
With 3000ms polling + 800ms open-delay + test overhead, the test exceeds 5 seconds.

### Root Cause Analysis

The test uses real timers while the production code contains `setTimeout`-based polling.
The polling loop was introduced to handle slow terminal startup (PTY), but it makes the
null-path test inherently slow. The test should use Vitest fake timers to fast-forward time.

### Proposed Fix

Wrap the test with fake timers:
```javascript
it('shows "Opening terminal..." toast and error when terminalSender is null', async () => {
  vi.useFakeTimers();
  // ... set up store state ...
  const runPromise = useAppStore.getState().executeAgentRun();
  await vi.runAllTimersAsync();
  await runPromise;
  expect(/* toast appeared */).toBe(true);
  vi.useRealTimers();
});
```
Or increase the test timeout to 10 seconds as a minimal mitigation.

---

## BUG-005: AgentLauncherMenu uses inline style={{}} for dropdown position

- **Severity:** Low
- **Type:** Code Style (CLAUDE.md violation)
- **Component:** `frontend/src/components/agent-launcher/AgentLauncherMenu.tsx:116`

### Reproduction Steps

1. Open `frontend/src/components/agent-launcher/AgentLauncherMenu.tsx`.
2. Line 116:
   ```tsx
   style={{ top: menuPos.top, left: menuPos.left, maxHeight: 300 }}
   ```
3. The project CLAUDE.md states: "No `style={{}}` attributes — use Tailwind arbitrary values."

### Expected Behavior

Position values should be applied via Tailwind arbitrary values or CSS custom properties where
possible. For dynamically computed pixel values (result of `getBoundingClientRect()`), a CSS
custom property set via `style` is an accepted exception pattern used elsewhere in the codebase.

### Actual Behavior

Three values (`top`, `left`, `maxHeight`) are applied via inline `style={{}}`. The `maxHeight`
value (300) is static and could be a Tailwind class (`max-h-[300px]`). The `top` and `left`
values are dynamic and computed at runtime from viewport geometry — these cannot be expressed as
Tailwind classes without a dynamic arbitrary value, which Tailwind does not support at runtime.

### Root Cause Analysis

The `createPortal` + viewport-clamped-positioning approach (T-008) inherently requires runtime
pixel values for `top` and `left`. The `style` attribute is the only way to apply these. However,
the static `maxHeight: 300` is avoidable.

### Proposed Fix

Extract `maxHeight` from the inline style and move it to the `className`:
```tsx
// Before:
style={{ top: menuPos.top, left: menuPos.left, maxHeight: 300 }}
className="fixed z-[9999] min-w-[200px] ..."

// After:
style={{ top: menuPos.top, left: menuPos.left }}
className="fixed z-[9999] min-w-[200px] max-h-[300px] ..."
```

For `top` and `left`, the inline style is unavoidable for dynamic viewport-clamped positioning.
This is an accepted exception. A comment in the source should document why inline style is used
here to prevent future linting false positives.

---

## Pre-existing Issues (not introduced by this feature)

### PRE-001: agent-launcher.test.js backend tests fail with SPACE_NOT_FOUND

- **Status:** Pre-existing
- **Severity:** Medium (blocks backend test suite for agent-launcher)
- **Component:** `tests/agent-launcher.test.js`
- **Root Cause:** Tests use `spaceId: 'default'` hardcoded, but the `startTestServer()` helper
  creates the initial space as a UUID-based "General" space. The 'default' space ID does not exist.
  This is the `SETTINGS_FILE` isolation pattern documented in QA agent memory.
- **Not introduced by settings-bar.** Not blocking the settings-bar merge gate.

---

## Merge Gate Assessment

| Gate Criterion                            | Status |
|-------------------------------------------|--------|
| Zero Critical bugs                        | PASS   |
| Zero High bugs                            | PASS   |
| Zero Medium bugs                          | FAIL — BUG-001, BUG-002, BUG-003 are Medium |
| All AgentSettingsToggle tests pass (T-007) | PASS  |
| Header zone layout correct (T-005)        | PASS   |
| Style normalization applied (T-002/3/4)   | PASS   |

**Verdict: BLOCKED.** Three Medium bugs must be resolved before merging to main.
BUG-004 (Low) and BUG-005 (Low) may be deferred.
