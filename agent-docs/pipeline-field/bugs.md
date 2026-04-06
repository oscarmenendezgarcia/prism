# Bugs: Pipeline Field Per Card

## BUG-001: Pipeline editor "Add stage" dropdown never appears in a fresh session

- **Severity**: Critical — **STATUS: RESOLVED** (verified 2026-04-06)
- **Type**: Functional
- **Component**: `frontend/src/components/board/TaskDetailPanel.tsx` — `PipelineEditor` component
- **Test Case**: TC-E2E-006
- **Screenshot**: `agent-docs/pipeline-field/screenshots/e2e-tc006-configure-no-agents.png`
- **Fix screenshot**: `agent-docs/pipeline-field/screenshots/bug-001-fix-verified.png`

### Reproduction Steps

1. Open Prism in a fresh browser tab (`http://localhost:3000`).
2. Do NOT open the agent launcher dropdown.
3. Click any task card to open the TaskDetailPanel.
4. Click "Configure" in the Pipeline section.
5. Observe: the edit mode shows "No stages — will use space default on save." but no dropdown or input to add stages.

### Expected Behavior

A dropdown or input control appears, listing all available agents, allowing the user to add stages to the pipeline.

### Actual Behavior

The "Add stage" `<select>` element is not rendered. `availableAgents` in the Zustand store is an empty array (`[]`), so `addableAgents.length === 0`, and the conditional render `{addableAgents.length > 0 && <select ...>}` produces nothing. The API endpoint `GET /api/v1/agents` returns 7 agents; they are simply never fetched.

### Root Cause Analysis

`loadAgents()` is only called in two places:
- `AgentLauncherMenu.tsx` — triggered when the agent launcher dropdown is opened for the first time.
- `PipelineConfirmModal.tsx` — triggered when the pipeline confirm modal opens.

`TaskDetailPanel.tsx` does not call `loadAgents()` anywhere. When a user opens the task detail directly (the primary pathway to configure a per-card pipeline), `availableAgents` is never populated, and the editor is permanently broken for that session unless the user has previously opened the agent launcher.

The frontend unit tests (TC-F-007 through TC-F-012) pass because they inject `availableAgentIds` as a prop directly and do not test the store loading path.

### Proposed Fix

In `TaskDetailPanel.tsx`, add a `useEffect` inside or near the `PipelineEditor` component (or at the `TaskDetailPanel` level) that calls `loadAgents()` when edit mode is entered:

```
// Inside PipelineEditor — on mount, ensure agents are loaded
useEffect(() => {
  if (availableAgentIds.length === 0) {
    loadAgents();
  }
}, []);
```

Alternatively, call `loadAgents()` in the outer `TaskDetailPanel` component when the panel opens (i.e., when `task` becomes non-null), so agents are ready before the user even clicks Configure.

### Resolution

Fix implemented in commit `1766194`: `useEffect` added to `TaskDetailPanel` that calls `loadAgents()` when `detailTask` becomes non-null and `availableAgents.length === 0`. This ensures agents are fetched proactively when the panel opens, so the dropdown is populated before the user clicks Configure.

**Verification evidence (2026-04-06):**
- Fresh browser session, no agent launcher previously opened.
- Opened card detail panel → clicked "Configure" in the Pipeline section.
- `combobox "Add a stage to the pipeline"` appeared immediately with all 7 agents: code-reviewer, developer-agent, orchestrator, qa-engineer-e2e, senior-architect, tagger, ux-api-designer.
- Screenshot: `agent-docs/pipeline-field/screenshots/bug-001-fix-verified.png`
- 3 unit tests added in `frontend/__tests__/components/TaskDetailPanel.test.tsx` covering: call on empty store, no-call when already populated, no-call when panel is closed. All pass.
- Note: frontend dist must be rebuilt (`cd frontend && npm run build`) for the fix to be served in production mode.

---

## BUG-002: Pipeline field accepts unknown / arbitrary agent IDs without allowlist validation

- **Severity**: Medium — **STATUS: RESOLVED** (verified 2026-04-06)
- **Type**: Security / Functional
- **Component**: `src/handlers/tasks.js` — `validatePipelineField()`
- **Test Case**: TC-SEC-001 (advisory)
- **OWASP Reference**: A03:2021 Injection (indirect — agent ID used in file path resolution)

### Reproduction Steps

1. `PUT /api/v1/spaces/:spaceId/tasks/:taskId` with body `{"pipeline": ["../../../etc/passwd"]}`.
2. Response: 200 OK, pipeline stored as `["../../../etc/passwd"]`.
3. When pipeline execution is triggered, `agentResolver.js` resolves this ID to a file path.

### Expected Behavior

The server should reject agent IDs that are not in the known agent list, returning 400 VALIDATION_ERROR.

### Actual Behavior

The server stores the value. Validation only checks:
- Type is array
- Length ≤ 20 elements
- Each element is a non-empty string ≤ 50 characters
- Elements trimmed

The 50-character limit does constrain path traversal depth but does not eliminate it (e.g., `../../.env` is 10 chars and passes).

### Root Cause Analysis

`validatePipelineField` is intentionally permissive at the storage layer — the blueprint specifies soft validation with enforcement at execution time in `agentResolver.js`. However, there is no evidence that `agentResolver.js` validates the incoming agent ID against an allowlist before constructing a file path.

### Proposed Fix

Option A (recommended): In `validatePipelineField`, reject any element that contains `/`, `\`, or `..`. Agent IDs are identifier strings and should not contain path separators.

Option B: At storage time, cross-check each element against `GET /api/v1/agents` response and reject unknown IDs with a descriptive error message. This is stricter but requires reading the agents list on every write.

Option C: In `agentResolver.js`, validate the agent ID against a known allowlist before constructing any file path, and return a clear error for unknown IDs.

### Resolution

Fix implemented in commit `832fb43`: `validatePipelineField()` in `src/handlers/tasks.js` now rejects any element not matching `/^[a-z0-9-]+$/` with a 400 VALIDATION_ERROR.

**Verification evidence (2026-04-06):**
- `PUT /spaces/193f336c-1950-4a39-804e-5691be135ddc/tasks/:id` with `{"pipeline":["../../.env"]}` → **HTTP 400**, body: `{"error":{"code":"VALIDATION_ERROR","message":"pipeline[0] must contain only lowercase letters, digits, and hyphens"}}`
- `PUT /spaces/193f336c-1950-4a39-804e-5691be135ddc/tasks/:id` with `{"pipeline":["senior-architect","developer-agent"]}` → **HTTP 200**, pipeline stored correctly.
- Path characters (`/`), traversal sequences (`..`), uppercase letters, spaces, and special characters are all rejected by the regex negation pattern.

---

## Advisory: `act()` warnings in PipelineConfirmModal tests

- **Severity**: Low
- **Type**: Test quality
- **Component**: `frontend/__tests__/components/PipelineConfirmModal.test.tsx`

### Description

Multiple test cases in `PipelineConfirmModal.test.tsx` produce `"An update to PipelineConfirmModal inside a test was not wrapped in act(...)"` warnings. These do not cause test failures but indicate async state updates happening outside React's act boundary.

### Root Cause

The `PipelineConfirmModal` component fetches preview prompts asynchronously. Tests that trigger this fetch but do not `await waitFor(...)` before asserting will produce the warnings when the fetch resolves after the test's synchronous assertions complete.

### Proposed Fix

Wrap trigger actions in `act()` and use `await waitFor(() => expect(...))` for any assertions that depend on the async fetch completing.

This is a pre-existing issue not introduced by the pipeline-field-per-card feature.
