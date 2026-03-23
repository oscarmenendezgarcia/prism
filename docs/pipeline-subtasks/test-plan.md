# Test Plan: Pipeline Sub-Tasks (ADR-1)

## Executive Summary

The pipeline sub-tasks feature changes how the Prism agent pipeline tracks per-stage work: instead of all four agents sharing the original Kanban task ID, each stage now creates its own dedicated sub-task. This fixes a fragile completion-detection edge case and provides per-agent artifact organization.

One **Medium** bug was found: a pre-existing test for `executeAgentRun` times out due to a miscalibrated `vi.advanceTimersByTime` value (advances 500 ms but the production polling loop runs for 3000 ms). The test hangs the entire test file.

No Critical or High bugs were found. **Merge gate: PASSED** (zero unresolved Critical/High bugs).

---

## Scope & Objectives

### In Scope
- `PipelineState.subTaskIds` type addition (`frontend/src/types/index.ts`)
- `startPipeline` — sub-task creation before stage 1 (`frontend/src/stores/useAppStore.ts`)
- `advancePipeline` — sub-task creation before stages 2–N (`frontend/src/stores/useAppStore.ts`)
- `resolveMainTaskTitle` private helper (exercised indirectly through pipeline actions)
- `useAgentCompletion` — sub-task vs main-task discrimination (`frontend/src/hooks/useAgentCompletion.ts`)
- TypeScript type correctness across all changed interfaces

### Out of Scope
- Sub-task cleanup / archival on pipeline completion (explicitly deferred in ADR-1)
- `PipelineProgressBar` sub-task ID display (marked "optional" in blueprint)
- Backend API (no changes required per ADR-1)
- E2E browser tests (no runner configured; all tests are Vitest unit/integration)

---

## Environment Requirements

| Requirement | Value |
|---|---|
| Node.js | >= 14.17 (crypto.randomUUID) |
| Test runner | Vitest via `cd frontend && npm test -- --run` |
| TypeScript compiler | `npx tsc --noEmit` |
| Mocking strategy | `vi.mock('../../src/api/client')` — all HTTP calls mocked |
| Branch | `feature/bug-agents-progress` |

---

## Test Cases

### Level: Unit — `PipelineState` type

| ID | Type | Description | Input | Expected Output | Priority |
|----|------|-------------|-------|-----------------|----------|
| TC-001 | Unit | `PipelineState` has `subTaskIds: string[]` field | Inspect type definition | Field present, typed as `string[]` | High |
| TC-002 | Unit | `subTaskIds` is not optional (no `?`) — grows incrementally | Type inspection | Required field, initialized as `[]` | High |

### Level: Unit — `resolveMainTaskTitle`

| ID | Type | Description | Input | Expected Output | Priority |
|----|------|-------------|-------|-----------------|----------|
| TC-003 | Unit | Finds title in `todo` column | task in `tasks.todo` | Returns `task.title` | High |
| TC-004 | Unit | Finds title in `in-progress` column | task in `tasks['in-progress']` | Returns `task.title` | High |
| TC-005 | Unit | Finds title in `done` column | task in `tasks.done` | Returns `task.title` | High |
| TC-006 | Unit | Falls back to `"Task <id>"` when task absent from all columns | empty board | Returns `"Task <taskId>"` | High |

### Level: Unit — `startPipeline` (Stage 1)

| ID | Type | Description | Input | Expected Output | Priority |
|----|------|-------------|-------|-----------------|----------|
| TC-007 | Unit | Initializes `pipelineState` with `status=running`, `currentStageIndex=0`, `subTaskIds=[]` | `startPipeline('space-1', 'task-main')` | `pipelineState` matches expected shape | Critical |
| TC-008 | Unit | Calls `api.createTask` with correct spaceId before calling `prepareAgentRun` | api mock | `createTask` called with `spaceId='space-1'` | Critical |
| TC-009 | Unit | Sub-task title follows `"[Main Title] / Stage 1: [DisplayName]"` pattern | main task title = "Foo", displayName = "Senior Architect" | title = `"Foo / Stage 1: Senior Architect"` | High |
| TC-010 | Unit | Sub-task `type = 'research'` | api.createTask call | `type: 'research'` in payload | High |
| TC-011 | Unit | Sub-task `assigned` = first stage agent ID | first stage = `'senior-architect'` | `assigned: 'senior-architect'` | High |
| TC-012 | Unit | Sub-task description contains parent task ID | `taskId = 'task-main'` | description includes `'task-main'` | Medium |
| TC-013 | Unit | `prepareAgentRun` receives sub-task ID, NOT main task ID | sub-task returned with id=`'sub-xyz'` | `generatePrompt` called with `taskId: 'sub-xyz'` | Critical |
| TC-014 | Unit | `pipelineState.subTaskIds` = `[subTask.id]` after success | sub-task id = `'new-sub-001'` | `subTaskIds = ['new-sub-001']` | High |
| TC-015 | Unit | `pipelineState.taskId` remains the main task ID unchanged | start with `taskId='task-main'` | `pipelineState.taskId = 'task-main'` | Critical |
| TC-016 | Unit | Uses default 4-stage pipeline when `agentSettings` is null | `agentSettings = null` | stages = `['senior-architect','ux-api-designer','developer-agent','qa-engineer-e2e']` | High |
| TC-017 | Unit | Uses `agentSettings.pipeline.stages` when present | custom stages | `pipelineState.stages` matches custom list | Medium |
| TC-018 | Unit | Shows `"Pipeline started"` toast on success | success path | `toast.message` contains `'Pipeline started'` | Medium |
| TC-019 | Unit | Uses stage ID as display name fallback when agent not in `availableAgents` | `availableAgents = []` | title includes agent ID string | Low |

### Level: Unit — `startPipeline` error path

| ID | Type | Description | Input | Expected Output | Priority |
|----|------|-------------|-------|-----------------|----------|
| TC-020 | Unit | Sets `pipelineState = null` when `api.createTask` throws | `createTask` rejects | `pipelineState === null` | Critical |
| TC-021 | Unit | Shows error toast containing `"stage 1"` when `createTask` fails | `createTask` rejects | `toast.type = 'error'`, message contains `'stage 1'` | High |
| TC-022 | Unit | Does NOT call `generatePrompt` (prepareAgentRun) when `createTask` fails | `createTask` rejects | `generatePrompt` not called | High |

### Level: Unit — `advancePipeline` (Stages 2–N)

| ID | Type | Description | Input | Expected Output | Priority |
|----|------|-------------|-------|-----------------|----------|
| TC-023 | Unit | Does nothing when `pipelineState` is null | `pipelineState = null` | `generatePrompt` not called | High |
| TC-024 | Unit | Does nothing when `pipelineState.status !== 'running'` | `status = 'completed'` | `generatePrompt` not called | High |
| TC-025 | Unit | Creates new sub-task via `api.createTask` for the next stage | `currentStageIndex=0`, 2-stage pipeline | `createTask` called once | Critical |
| TC-026 | Unit | `prepareAgentRun` receives new sub-task ID, NOT main task ID | sub-task id = `'sub-task-stage2'` | `generatePrompt` called with `taskId: 'sub-task-stage2'` | Critical |
| TC-027 | Unit | `subTaskIds` grows by exactly one per call | pre: `['sub-1']`, advance succeeds | post: `['sub-1', 'sub-2']` | High |
| TC-028 | Unit | `currentStageIndex` increments by one | pre: index=0 | post: index=1 | High |
| TC-029 | Unit | Shows `"Stage N: <agent>"` toast | advancing to stage 2 | toast contains `'Stage 2'` | Medium |
| TC-030 | Unit | Sets `status = 'completed'` when last stage is advanced past | `currentStageIndex = stages.length - 1` | `pipelineState.status = 'completed'` | High |
| TC-031 | Unit | Shows completion toast when all stages done | last stage done | toast contains `'complete'` | Medium |
| TC-032 | Unit | Auto-clears `pipelineState` to null 3 s after completion | last stage done | `pipelineState = null` after 3 s | Medium |

### Level: Unit — `advancePipeline` error path

| ID | Type | Description | Input | Expected Output | Priority |
|----|------|-------------|-------|-----------------|----------|
| TC-033 | Unit | Sets `pipelineState = null` when `api.createTask` throws | `createTask` rejects | `pipelineState === null` | Critical |
| TC-034 | Unit | Shows error toast containing stage number when `createTask` fails | `createTask` rejects on stage 2 | toast contains `'stage 2'` | High |
| TC-035 | Unit | Does NOT call `generatePrompt` when `createTask` fails | `createTask` rejects | `generatePrompt` not called | High |

### Level: Integration — `useAgentCompletion`

| ID | Type | Description | Input | Expected Output | Priority |
|----|------|-------------|-------|-----------------|----------|
| TC-036 | Integration | Does nothing when `activeRun` is null | `activeRun = null`, task moves to done | `clearActiveRun` not called | High |
| TC-037 | Integration | Fires `clearActiveRun` when sub-task (activeRun.taskId) moves to done with updatedAt >= startedAt | sub-task in done column | `clearActiveRun` called once | Critical |
| TC-038 | Integration | Does NOT fire when main anchor task moves to done (activeRun.taskId = sub-task ID) | main task in done, sub-task not | `clearActiveRun` not called | Critical |
| TC-039 | Integration | Does NOT fire when task.updatedAt < activeRun.startedAt (stale done entry) | sub-task in done with old timestamp | `clearActiveRun` not called | Critical |
| TC-040 | Integration | Calls `advancePipeline` when `autoAdvance=true` and `confirmBetweenStages=false` | pipeline running | `advancePipeline` called once | High |
| TC-041 | Integration | Does NOT call `advancePipeline` when `autoAdvance=false` | settings override | `advancePipeline` not called | High |
| TC-042 | Integration | Shows confirmation toast when `confirmBetweenStages=true` | `confirmBetweenStages=true` | toast contains `'Advance'` | Medium |
| TC-043 | Integration | Does NOT call `advancePipeline` when `pipelineState = null` | no active pipeline | `advancePipeline` not called | High |
| TC-044 | Integration | Does NOT call `advancePipeline` when `pipelineState.status = 'completed'` | completed pipeline | `advancePipeline` not called | High |

### Level: Performance

| ID | Type | Description | Threshold | Priority |
|----|------|-------------|-----------|----------|
| TC-045 | Perf | Sub-task creation round-trip latency (localhost) | P95 < 50 ms | Low |
| TC-046 | Perf | `resolveMainTaskTitle` search across 3 columns | < 1 ms for <= 500 tasks | Low |

### Level: Security

| ID | Type | Description | OWASP | Priority |
|----|------|-------------|-------|----------|
| TC-047 | Security | Sub-task title constructed from user-supplied main task title — verify no XSS surface in board rendering | A03:2021 Injection | Medium |
| TC-048 | Security | `api.createTask` spaceId is taken from store state, not user input — no injection surface | A01:2021 Broken Access Control | Low |
| TC-049 | Security | Sub-task description includes `taskId` (UUID) — no path traversal possible | A01:2021 | Low |

---

## Assumptions & Exclusions

1. The TypeScript compiler check passing (`npx tsc --noEmit`) is treated as a proxy for type correctness — no runtime type validation layer exists.
2. Performance thresholds for sub-task creation are advisory; no load test was executed (frontend-only feature, localhost latency).
3. Security posture is unchanged: the Kanban board already renders task titles — the sub-task title carries no new XSS surface beyond what existed before.
4. The `useAgentCompletion` hook tests (TC-036 to TC-044) are integration-level because they require the full Zustand store subscription mechanism, exercised via `renderHook`.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Fake-timer miscalibration causes test hangs in CI | High (already occurring) | Medium — blocks `useAppStore.test.ts` from completing | Fix `vi.advanceTimersByTime` to advance 3100 ms instead of 500 ms |
| Sub-task creation failure leaves `pipelineState` in transitional state | Low | High | Error handler explicitly sets `pipelineState: null` — covered |
| `resolveMainTaskTitle` returns stale title if board not loaded | Low | Low | Fallback to `"Task <id>"` is safe — non-fatal per blueprint |
| Concurrent `advancePipeline` calls could double-create sub-tasks | Low | Medium | No concurrency guard present; pipeline is single-user desktop tool — acceptable risk |
| `confirmBetweenStages` toast is informational only — no UI button wired to it | Medium | Low | PipelineProgressBar handles advance/abort; toast is advisory |
