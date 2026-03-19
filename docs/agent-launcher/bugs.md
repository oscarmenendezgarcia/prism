# Bug Report: Agent Launcher

**Feature:** agent-launcher
**QA Cycle:** 2026-03-19
**Branch:** feature/agent-launcher
**Tester:** qa-engineer-e2e

---

## Summary

| ID | Title | Severity | Type | Status |
|----|-------|----------|------|--------|
| BUG-001 | SETTINGS_FILE hardcoded to DEFAULT_DATA_DIR — ignores dataDir option | High | Functional | Resolved (QA cycle 2) |
| BUG-002 | AgentRunIndicator, AgentSettingsPanel, PipelineProgressBar, useAgentCompletion have zero test coverage | High | Functional | Resolved (QA cycle 2) |
| BUG-003 | Launcher store slice actions are untested | High | Functional | Resolved (QA cycle 2) |
| BUG-004 | customInstructions maxLength=2000 not enforced server-side | Medium | Functional | Open |
| BUG-005 | Missing HTTP security headers on all agent-launcher endpoints (pre-existing) | Medium | Security | Open (pre-existing) |
| BUG-006 | buildCliCommand does not quote prompt paths containing spaces | Medium | Functional | Open |
| BUG-007 | startPipeline uses synthetic taskId='pipeline' — prompt generation fails for space with no tasks | Medium | Functional | Open |
| BUG-008 | cleanupOldPromptFiles not called on a periodic interval — only on startup | Low | Functional | Open |
| BUG-009 | console.log in executeAgentRun pollutes test and production console output | Low | Quality | Open |
| BUG-010 | ErrorResponse 'suggestion' field missing from actual server responses (pre-existing) | Medium | Functional | Open (pre-existing) |

---

## BUG-001: SETTINGS_FILE hardcoded to DEFAULT_DATA_DIR — ignores dataDir option

- **Severity:** High
- **Type:** Functional / Test Isolation
- **Component:** `server.js` — `handleGetSettings`, `handlePutSettings`, `readSettings`, `writeSettings`
- **Status:** Resolved — QA cycle 2 (2026-03-19). All 32 backend tests pass. TC-032 and TC-055 both pass.

**Reproduction Steps:**
1. Run `node --test 'tests/agent-launcher.test.js'`
2. Observe test failure: `Assertion failed: default fileInputMethod should be cat-subshell`
3. Inspect `data/settings.json` — it contains `"fileInputMethod": "stdin-redirect"` (or any other non-default value left by a previous test run)

**Expected Behavior:**
`GET /api/v1/settings` on an isolated test server (using a temp `dataDir`) should return default settings, because no `settings.json` exists in that temp directory.

**Actual Behavior:**
The settings handler reads from `path.join(DEFAULT_DATA_DIR, 'settings.json')` regardless of what `dataDir` was passed to `startServer()`. The test server's isolation is bypassed: it reads the real `data/settings.json` from the project root.

**Root Cause Analysis:**
`SETTINGS_FILE` is computed at module load time as a constant:
```
const SETTINGS_FILE = path.join(DEFAULT_DATA_DIR, 'settings.json');
```
`DEFAULT_DATA_DIR` is `process.env.DATA_DIR || path.join(__dirname, 'data')`. When the test server is started with `{ dataDir: tmpDir }`, the `tmpDir` value is used for task and space persistence, but the separately-scoped `SETTINGS_FILE` constant is not updated. The settings handlers (`readSettings`, `writeSettings`) reference `SETTINGS_FILE` directly without accepting a `dataDir` parameter.

**Proposed Fix:**
Pass `dataDir` into the settings read/write functions and compute `SETTINGS_FILE` dynamically within the handler context (or within a factory that takes `dataDir`). Pattern: the same `dataDir` parameter already used for task persistence and `PROMPTS_DIR` (which also has this issue) should be threaded through to the settings path.

---

## BUG-002: AgentRunIndicator, AgentSettingsPanel, PipelineProgressBar, and useAgentCompletion have zero test coverage

- **Severity:** High
- **Type:** Functional — Coverage gap
- **Component:**
  - `frontend/src/components/agent-launcher/AgentRunIndicator.tsx`
  - `frontend/src/components/agent-launcher/AgentSettingsPanel.tsx`
  - `frontend/src/components/agent-launcher/PipelineProgressBar.tsx`
  - `frontend/src/hooks/useAgentCompletion.ts`
- **Status:** Resolved — QA cycle 2 (2026-03-19). Test files created: AgentRunIndicator.test.tsx (13 tests), AgentSettingsPanel.test.tsx (24 tests), PipelineProgressBar.test.tsx (14 tests), useAgentCompletion.test.ts (11 tests). All pass.

**Reproduction Steps:**
1. Run `cd frontend && npm test -- --run`
2. No test file exists for any of these four artifacts
3. Coverage for these files is 0%

**Expected Behavior:**
Per the feature Definition of Done: "Frontend test coverage >90% for new components and store slices." The missing components contain critical user-facing behavior:
- `AgentRunIndicator`: elapsed timer, Cancel button, aria-live region
- `AgentSettingsPanel`: all form interactions, save/cancel flow
- `PipelineProgressBar`: stage rendering, abort button
- `useAgentCompletion`: the auto-completion detection hook that clears `activeRun` and advances the pipeline

**Actual Behavior:**
Zero test files exist for these components and hook. Their behavior is completely untested.

**Root Cause Analysis:**
These components were shipped without corresponding test files. `AgentLauncherMenu` and `AgentPromptPreview` were properly covered; the remaining three components and the hook were omitted.

**Proposed Fix:**
Create the following test files:
- `frontend/__tests__/components/AgentRunIndicator.test.tsx`
- `frontend/__tests__/components/AgentSettingsPanel.test.tsx`
- `frontend/__tests__/components/PipelineProgressBar.test.tsx`
- `frontend/__tests__/hooks/useAgentCompletion.test.ts`

Minimum test requirements:
- `AgentRunIndicator`: null render when activeRun=null; displays agent name and elapsed time; Cancel button calls `cancelAgentRun`; elapsed timer increments
- `AgentSettingsPanel`: renders when open; hides when closed; shows Custom binary input only when 'custom' selected; Save Settings calls `saveSettings`; Cancel closes panel without saving
- `PipelineProgressBar`: renders stage indicators for running pipeline; Abort button calls `abortPipeline`; hides when `pipelineState` is null
- `useAgentCompletion`: mock store subscription; when activeRun task moves to done column, `clearActiveRun` is called; when pipeline + autoAdvance + no confirmation, `advancePipeline` is called

---

## BUG-003: Launcher store slice actions are untested

- **Severity:** High
- **Type:** Functional — Coverage gap
- **Component:** `frontend/src/stores/useAppStore.ts` — agent launcher slice
- **Status:** Resolved — QA cycle 2 (2026-03-19). Launcher slice suites added to useAppStore.test.ts covering prepareAgentRun, executeAgentRun, cancelAgentRun, startPipeline, advancePipeline, abortPipeline, loadSettings, saveSettings. useAppStore.test.ts now has 60 total tests, all pass.

**Reproduction Steps:**
1. Open `frontend/__tests__/stores/useAppStore.test.ts`
2. Search for `prepareAgentRun`, `executeAgentRun`, `cancelAgentRun`, `startPipeline`, `advancePipeline`, `abortPipeline`, `loadSettings`, `saveSettings`
3. None of these actions have test cases

**Expected Behavior:**
All Zustand store actions introduced by the agent launcher feature should have unit tests covering happy path and error branches.

**Actual Behavior:**
The store test file covers only pre-existing actions (spaces, tasks, modals, toast, terminal toggle). The entire agent launcher slice is absent.

**Root Cause Analysis:**
Test cases were not added to `useAppStore.test.ts` when the launcher slice was implemented.

**Proposed Fix:**
Add test suites to `useAppStore.test.ts` covering:
- `prepareAgentRun`: calls `api.generatePrompt`, sets `preparedRun` and `promptPreviewOpen`, shows error toast on failure
- `executeAgentRun`: with `terminalSender` present — calls `sender(cmd + '\n')`, sets `activeRun`, clears `preparedRun`; with `terminalSender` null — shows 'Opening terminal...' toast, waits 500ms, shows error toast if still null
- `cancelAgentRun`: with `terminalSender` — sends '\x03', clears `activeRun`, shows cancel toast; without `terminalSender` — clears `activeRun`, shows disconnect toast
- `startPipeline`: sets `pipelineState.status='running'`, sets `currentStageIndex=0`, calls `prepareAgentRun` with first stage
- `advancePipeline`: increments `currentStageIndex`; sets `status='completed'` when last stage finishes; shows completion toast
- `abortPipeline`: sends '\x03', clears `pipelineState` and `activeRun`, shows abort toast with stage number
- `loadSettings`: calls `api.getSettings`, sets `agentSettings`; shows error toast on failure
- `saveSettings`: calls `api.saveSettings`, updates `agentSettings`; shows error toast on failure

---

## BUG-004: customInstructions maxLength=2000 not enforced server-side

- **Severity:** Medium
- **Type:** Functional / Security Advisory
- **Component:** `server.js` — `handleGeneratePrompt`
- **OWASP Reference:** A03:2021 Injection (resource exhaustion vector)

**Reproduction Steps:**
1. Send a `POST /api/v1/agent/prompt` request with `customInstructions` set to a string of 100,000 characters
2. The server accepts the request and writes the oversized content into the prompt file
3. `GET /api/v1/settings` still shows a valid response — the server does not crash
4. The prompt file size on disk is proportionally large

**Expected Behavior:**
Per `api-spec.json` (`PromptGenerationRequest.customInstructions.maxLength: 2000`): requests with `customInstructions` longer than 2000 characters should be rejected with 400 VALIDATION_ERROR.

**Actual Behavior:**
The handler performs required-field validation but does not check the length of optional string fields. `customInstructions` is passed directly to `buildPromptText` and written verbatim into the temp file. A 1MB `customInstructions` payload would produce a 1MB prompt file.

**Root Cause Analysis:**
The `handleGeneratePrompt` function validates presence of `agentId`, `taskId`, and `spaceId`, and validates `agentId` format, but has no validation for optional field lengths (`customInstructions`, `workingDirectory`).

**Proposed Fix:**
Add length validation after the required-field checks in `handleGeneratePrompt`:
- If `customInstructions` is present and its length exceeds 2000 characters: return 400 VALIDATION_ERROR with `field: 'customInstructions'`
- Optionally, apply a reasonable limit to `workingDirectory` (e.g. 500 characters) to prevent oversized path strings

---

## BUG-005: Missing HTTP security headers on all agent-launcher endpoints (pre-existing)

- **Severity:** Medium
- **Type:** Security
- **Component:** `server.js` — all response paths (pre-existing across entire server)
- **OWASP Reference:** A05:2021 Security Misconfiguration

**Reproduction Steps:**
1. `curl -I http://localhost:3000/api/v1/agents`
2. Observe response headers — no `X-Content-Type-Options`, `X-Frame-Options`, or `Content-Security-Policy` headers

**Expected Behavior:**
All HTTP responses should include standard security headers:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Content-Security-Policy: default-src 'self'`

**Actual Behavior:**
None of these headers are present on any API response (including the new agent-launcher endpoints).

**Root Cause Analysis:**
Pre-existing pattern — the `server.js` request handler does not set security headers in a middleware layer. This affects all endpoints, not just the new ones.

**Proposed Fix:**
Add a global header-injection step in the `requestListener` function that applies the above security headers to every response before it is written. Because this is a local dev tool, this is low urgency but good hygiene. The fix is a single block at the top of the request handler.

**Note:** This is a pre-existing bug that predates the agent-launcher feature. It is flagged here for completeness.

---

## BUG-006: buildCliCommand does not quote prompt paths containing spaces

- **Severity:** Medium
- **Type:** Functional
- **Component:** `server.js` — `buildCliCommand`

**Reproduction Steps:**
1. Set `workingDirectory` to `/Users/oscar/my projects/prism` (contains a space)
2. `POST /api/v1/agent/prompt` — the `promptPath` will be under a directory with spaces in parent path
3. Alternatively: place `data/.prompts/` under a path with spaces
4. Observe `cliCommand` output in the `cat-subshell` case:
   ```
   claude -p "$(cat /path/with spaces/prompt-123.md)" --allowedTools ...
   ```
   The `$(cat ...)` subshell argument is double-quoted, which correctly protects spaces inside the subshell expansion — however the path inside `$(cat ...)` is NOT quoted.

**Expected Behavior:**
The shell command produced by `buildCliCommand` should correctly handle prompt paths with spaces in all three `fileInputMethod` modes.

**Actual Behavior:**
For `cat-subshell`: `promptRef = '"$(cat ' + promptPath + ')"'` — the path is not quoted inside the `$(cat ...)` expression. A path like `/home/user/my projects/prism/data/.prompts/prompt-123.md` would cause a "too many arguments" shell error when injected into the PTY.

For `stdin-redirect`: `promptRef = '< "' + promptPath + '"'` — path IS double-quoted. Safe.

For `flag-file`: `promptRef = '--file "' + promptPath + '"'` — path IS double-quoted. Safe.

**Root Cause Analysis:**
In `buildCliCommand`, the `cat-subshell` branch constructs:
```javascript
promptRef = `"$(cat ${promptPath})"`;
```
The outer double-quotes wrap the subshell, but the path itself is bare inside the `$()`. The `stdin-redirect` and `flag-file` branches correctly wrap the path in double-quotes.

**Proposed Fix:**
In the `cat-subshell` branch, quote the path:
```
promptRef = `"$(cat '${promptPath}')"`;
```
Single-quoting the inner path prevents word-splitting on spaces and avoids any variable expansion within the path itself.

---

## BUG-007: startPipeline uses synthetic taskId='pipeline' — prompt generation fails for spaces with no tasks

- **Severity:** Medium
- **Type:** Functional
- **Component:** `frontend/src/stores/useAppStore.ts` — `startPipeline`

**Reproduction Steps:**
1. Open Prism with a space that has no tasks in any column
2. Click "Run Agent" on any task card (there are none), or trigger `startPipeline(spaceId)` via the Run Full Pipeline button
3. Observe that `prepareAgentRun('pipeline', firstStage)` is called with `taskId='pipeline'`
4. The server responds with 404 TASK_NOT_FOUND because no task with id='pipeline' exists

**Expected Behavior:**
Per E-05-S1: "The pipeline runs stages sequentially: it injects stage 1's command..." — the pipeline needs a valid task context to generate the prompt. If the pipeline is launched from a space with no tasks, the behavior should be clearly defined (e.g. use a space-level context, or show an error).

**Actual Behavior:**
`startPipeline` calls `prepareAgentRun('pipeline', firstStage)`. The string `'pipeline'` is used as `taskId`. `handleGeneratePrompt` searches all columns for a task with `id='pipeline'` and returns 404 TASK_NOT_FOUND. `prepareAgentRun` catches the error and calls `showToast('Failed to prepare agent run: ...')` — the pipeline is silently not started.

**Root Cause Analysis:**
The current implementation uses a hard-coded string `'pipeline'` as `taskId` in `startPipeline`. The ADR describes pipeline as using the space as context, but the `POST /api/v1/agent/prompt` endpoint requires a valid `taskId` by design. There is a design gap: either the endpoint needs a null-task pipeline mode, or `startPipeline` needs to discover or create a real task.

**Proposed Fix (description only):**
Option A: Modify `POST /api/v1/agent/prompt` to accept an optional `taskId` — when absent, the TASK CONTEXT section is omitted (replaced with a space-level context block using `spaceId` and `spaceName`).
Option B: `startPipeline` picks the first `todo` task from the active space board to use as context. If no todo tasks exist, show an error toast "No todo tasks found in this space to run the pipeline."
Option B is simpler and does not require API changes.

---

## BUG-008: cleanupOldPromptFiles not called on a periodic interval — only on startup

- **Severity:** Low
- **Type:** Functional
- **Component:** `server.js` — `cleanupOldPromptFiles`

**Reproduction Steps:**
1. Start the Prism server
2. Generate > 50 prompt files via `POST /api/v1/agent/prompt`
3. Leave the server running for > 24 hours without restarting
4. Observe: all prompt files from the first hour are still present on disk (none older than 24h are cleaned up, because cleanup only ran once at startup)

**Expected Behavior:**
ADR states: "server cleans up files older than 24 hours on startup and periodically." Prompt files should be removed on a recurring schedule, not only at startup.

**Actual Behavior:**
`cleanupOldPromptFiles()` is called once at startup. No `setInterval` or recurring schedule is established.

**Root Cause Analysis:**
The ADR mentions periodic cleanup but the implementation only runs cleanup at server start. Under continuous operation the `data/.prompts/` directory will grow unboundedly between restarts.

**Proposed Fix:**
Add a `setInterval(cleanupOldPromptFiles, 60 * 60 * 1000)` (every 1 hour) in the server startup sequence, after the initial cleanup call.

---

## BUG-009: console.log in executeAgentRun pollutes test and production console output

- **Severity:** Low
- **Type:** Quality
- **Component:** `frontend/src/stores/useAppStore.ts` — `executeAgentRun`

**Reproduction Steps:**
1. Run the frontend test suite: `cd frontend && npm test -- --run`
2. Observe: when `executeAgentRun` is called in tests, a JSON structured log line is written to stdout
3. In production, the browser DevTools console shows a JSON log on every agent execution

**Expected Behavior:**
Structured logging in the frontend store is non-standard. If telemetry is needed, it should go through a dedicated logging utility or `console.debug` (which can be suppressed in production builds).

**Actual Behavior:**
```javascript
console.log(JSON.stringify({ timestamp, level: 'info', component: 'agent-launcher', event: 'agent_run_started', ... }));
```
This line is always active, including in production builds, and appears in browser DevTools and test output.

**Root Cause Analysis:**
Structured logging is a server-side pattern (used in `server.js` with `console.log(JSON.stringify(...))`) that was carried into the frontend store without considering that browser console output is end-user visible.

**Proposed Fix:**
Replace with `console.debug(...)` so it is suppressed in production DevTools (or remove entirely if no telemetry is needed). Alternatively, wrap in a `if (import.meta.env.DEV)` guard.

---

## BUG-010: ErrorResponse 'suggestion' field missing from actual server responses (pre-existing)

- **Severity:** Medium
- **Type:** Functional — API spec drift
- **Component:** `server.js` — `sendError()`

**Reproduction Steps:**
1. Trigger any error response (e.g. `GET /api/v1/agents/UPPER_CASE`)
2. Inspect the response body: `{ "error": { "code": "INVALID_AGENT_ID", "message": "..." } }`
3. Note that `"suggestion"` field is absent from the actual response

**Expected Behavior:**
Per `api-spec.json` `ErrorResponse.error` schema: `required: ["code", "message", "suggestion"]`. The `suggestion` field should always be present in error responses.

**Actual Behavior:**
`sendError()` builds responses as `{ error: { code, message, ...extras } }`. The `suggestion` field is passed as part of `extras` when provided — but it is not included for all error code paths. For example, in `handleGeneratePrompt`: `sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be valid JSON.')` — no suggestion is provided.

**Root Cause Analysis:**
Pre-existing across the codebase. `sendError()` accepts an optional extras object but the signature does not enforce `suggestion` as required. Some call sites omit it.

**Proposed Fix:**
Update `sendError()` to require a `suggestion` parameter (or provide a sensible default) to enforce the spec contract. Audit all `sendError()` call sites to add missing suggestion strings.

**Note:** This is a pre-existing bug that predates the agent-launcher feature. It is flagged here because the new endpoints introduced additional call sites that omit `suggestion`.
