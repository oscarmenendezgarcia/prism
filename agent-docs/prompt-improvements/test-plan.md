# Test Plan: Prompt Improvements

## Executive Summary

The Prompt Improvements feature adds full prompt visibility across the pipeline: `buildStagePrompt()` is extracted as a reusable function, prompts are persisted to disk before spawning, a new endpoint serves persisted stage prompts, and a new `POST /api/v1/runs/preview-prompts` endpoint generates all stage prompts without starting a run. The frontend shows the full prompt in `AgentPromptPreview`, adds a Prompt/Log toggle to `PipelineLogPanel`, and adds a "Preview Prompts" button to `PipelineConfirmModal`.

QA identified **4 pre-existing test failures** (unrelated to this feature) and **1 regression** introduced by this feature (PipelineLogToggle always visible). The backend tests all pass. The merge gate is NOT satisfied until BUG-001 is resolved.

---

## Scope & Objectives

- Verify `buildStagePrompt()` extraction is correct and testable
- Verify `GET /api/v1/runs/:runId/stages/:stageIndex/prompt` returns prompt or correct 404
- Verify `POST /api/v1/runs/preview-prompts` generates all stage prompts without spawning
- Verify `POST /api/v1/agent/prompt` response includes `promptFull` field
- Verify `AgentPromptPreview` displays full prompt with collapse/expand
- Verify `PipelineLogPanel` Prompt/Log toggle works
- Verify `PipelineConfirmModal` Preview Prompts button works
- Verify `PipelineLogToggle` in Header only renders when `pipelineState !== null`

---

## Test Levels

### Unit Tests
- `buildStagePrompt()` shape, content, token estimation, compile gate, fallback
- `stagePromptPath()` helper returns correct path pattern
- `AgentPromptPreview` modal visibility, sections, token badge, edit mode, copy, collapse/expand
- `PipelineConfirmModal` preview-prompts button, loading state, error handling

### Integration Tests
- `GET /api/v1/runs/:runId/stages/:stageIndex/prompt` — 200, 404 PROMPT_NOT_AVAILABLE, 404 RUN_NOT_FOUND
- `POST /api/v1/runs/preview-prompts` — returns all stage prompt entries with correct shape
- `POST /api/v1/agent/prompt` — response includes `promptFull` and `promptPreview`

### E2E Tests
- Board renders at `http://localhost:3000` with no JS errors
- `PipelineLogToggle` button: visible state in Header verified via Playwright

### Performance Tests
Not applicable for this feature scope. All endpoints are either file-read or prompt-generation; existing P95 < 500ms baseline applies.

### Security Tests
- `GET .../stages/:stageIndex/prompt`: only serves files within the run directory — path traversal not possible as stageIndex is an integer from the URL
- No user-supplied data is written to file paths in this feature

---

## Test Cases

| ID | Type | Description | Input | Expected Output | Priority |
|----|------|-------------|-------|-----------------|----------|
| TC-001 | unit | buildStagePrompt returns shape `{ promptText, estimatedTokens }` | valid spaceId, taskId, agentId | object with both fields | High |
| TC-002 | unit | buildStagePrompt includes task title in promptText | task with title "Build feature X" | promptText contains "Build feature X" | High |
| TC-003 | unit | buildStagePrompt estimatedTokens ≈ promptText.length / 4 | any task | tokens within 10% of len/4 | Medium |
| TC-004 | unit | buildStagePrompt includes MANDATORY COMPILE GATE for developer-agent | agentId = developer-agent | promptText contains compile gate block | High |
| TC-005 | unit | buildStagePrompt does NOT include compile gate for non-developer agents | agentId = senior-architect | promptText does NOT contain compile gate | Medium |
| TC-006 | unit | buildStagePrompt returns fallback prompt when task not found | unknown taskId | promptText contains fallback message | Medium |
| TC-007 | unit | stagePromptPath() returns path matching pattern stage-N-prompt.md | runId, stageIndex | path ends with stage-0-prompt.md | Low |
| TC-008 | integration | GET .../stages/0/prompt returns 200 text/plain when file exists | valid runId + stageIndex | 200, Content-Type: text/plain | High |
| TC-009 | integration | GET .../stages/0/prompt returns 404 PROMPT_NOT_AVAILABLE when file missing | valid runId, missing prompt | 404, error.code = PROMPT_NOT_AVAILABLE | High |
| TC-010 | integration | GET .../stages/0/prompt returns 404 RUN_NOT_FOUND for unknown runId | unknown runId | 404, error.code = RUN_NOT_FOUND | High |
| TC-011 | integration | POST /runs/preview-prompts returns array with all stage entries | spaceId, taskId, stages list | array with stageIndex, agentId, promptFull, estimatedTokens | High |
| TC-012 | integration | POST /agent/prompt response includes promptFull field | valid agent prompt request | response.promptFull is non-empty string | High |
| TC-013 | integration | POST /agent/prompt response includes promptPreview (first 500 chars) | long prompt | promptPreview.length <= 500 | Medium |
| TC-014 | unit | AgentPromptPreview renders nothing when preparedRun is null | preparedRun=null | no dialog in DOM | High |
| TC-015 | unit | AgentPromptPreview renders full prompt (promptFull) in read mode | PREPARED_RUN fixture | TASK CONTEXT heading visible | High |
| TC-016 | unit | AgentPromptPreview Collapse button toggles to Show full | click Collapse | Show full button appears | Medium |
| TC-017 | unit | AgentPromptPreview edit mode textarea starts with promptFull | click Edit | textarea.value = FULL_PROMPT | High |
| TC-018 | unit | AgentPromptPreview token badge formats >=1000 as "~2.4k tokens" | estimatedTokens=2400 | badge shows ~2.4k tokens | Low |
| TC-019 | unit | PipelineConfirmModal renders "Preview Prompts" button | modal open | button visible | High |
| TC-020 | unit | PipelineConfirmModal calls previewPipelinePrompts on click | click Preview Prompts | api call made | High |
| TC-021 | unit | PipelineLogToggle is NOT rendered when pipelineState is null | pipelineState=null | button absent from DOM | High |
| TC-022 | unit | PipelineLogToggle IS rendered when pipelineState is non-null | pipelineState set | button visible | High |
| TC-023 | e2e | Board loads at http://localhost:3000 with no critical JS errors | navigate to root | page title = Prism, no error-level console output | High |
| TC-024 | unit | AgentLauncherMenu shows "Run Pipeline" option in dropdown | dropdown opened | Run Pipeline button visible | Medium |

---

## Environment Requirements

- Node.js 23.9.0
- Backend: `node server.js` running on port 3000
- Frontend dev: `cd frontend && npm run dev` on port 5173 (optional for E2E)
- Test runner (backend): `node --test 'tests/*.test.js'`
- Test runner (frontend): `cd frontend && npm test` (Vitest)

---

## Assumptions & Exclusions

- `spawnStage()` prompt persistence is not integration-tested due to process spawning complexity; covered by unit test on `stagePromptPath()`.
- Backend recursive `node:test run()` warning is pre-existing and does not indicate test failures — all files execute with exit code 0.
- Performance and soak testing excluded: feature is read-only file serving and prompt text generation.
- `qa-attachments.test.js` failures (path traversal) are pre-existing bugs unrelated to this feature.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| PipelineLogToggle always visible | Confirmed | High UX regression | BUG-001 — fix required before merge |
| AgentLauncherMenu label mismatch | Confirmed | Medium test debt | BUG-002 — "Run Pipeline" vs "Run Full Pipeline" |
| TaskCard aria/class regressions | Confirmed | Medium | Pre-existing; unrelated to this feature |
| useAgentCompletion confirmBetweenStages logic | Confirmed | Medium | Pre-existing; pipeline advance always called |
