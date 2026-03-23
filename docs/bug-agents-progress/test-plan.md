# Test Plan: Bug Fix — Agent Progress UI (completion detection)

**Branch:** `feature/bug-agents-progress`
**QA date:** 2026-03-23
**QA engineer:** qa-engineer-e2e

---

## Executive Summary

This bug fix addresses two root causes that prevented the `AgentRunIndicator` from closing and the `PipelineProgressBar` from advancing between stages:

1. `useAgentCompletion` used a done-column diff (`prevTasksRef`) that was always equal for pipeline stages 2–4 (task already in done), so `clearActiveRun()` and `advancePipeline()` were never called.
2. `usePolling` used a fixed 3000 ms interval, meaning completion could be detected up to 3 s late and fast-completing agents could be missed entirely.

The fix replaces the diff with a direct `updatedAt >= startedAt` predicate and introduces adaptive polling (1000 ms active / 3000 ms idle).

No regressions were found in the 20 tests for the two changed hooks. One pre-existing unrelated test timeout exists in `useAppStore.test.ts` and is excluded from scope. TypeScript compilation is clean.

---

## Scope and Objectives

### In Scope
- `frontend/src/hooks/useAgentCompletion.ts` — completion predicate logic
- `frontend/src/hooks/usePolling.ts` — adaptive polling interval
- `frontend/__tests__/hooks/useAgentCompletion.test.ts` — unit tests
- `frontend/__tests__/hooks/usePolling.test.ts` — unit tests
- TypeScript type correctness for changed files

### Out of Scope
- `AgentRunIndicator.tsx` — not changed, no UI regression found
- `PipelineProgressBar.tsx` — not changed
- `useAppStore.ts` — not changed
- `server.js` — not changed
- Pre-existing `useAppStore.test.ts` timeout (tracked separately, predates this branch)

---

## Test Levels

### Unit Tests (automated — Vitest + React Testing Library)

All executed via `cd frontend && npm test -- --run`.

### TypeScript Static Analysis

Executed via `npx tsc --noEmit`.

### Static / Code Review

Manual analysis of logic correctness, dead code, and edge-case coverage gaps.

### Performance (advisory)

Polling cadence change assessed analytically against spec thresholds.

---

## Test Cases

| ID | Type | Component | Description | Input / Precondition | Expected Output | Priority | Status |
|----|------|-----------|-------------|----------------------|-----------------|----------|--------|
| TC-001 | Unit | useAgentCompletion | Does nothing when activeRun is null | `activeRun = null`, task appears in done | `clearActiveRun` not called | Critical | Pass |
| TC-002 | Unit | useAgentCompletion | Fires clearActiveRun when task enters done with updatedAt >= startedAt | `activeRun` set, task.updatedAt = UPDATED_AFTER | `clearActiveRun` called once | Critical | Pass |
| TC-003 | Unit | useAgentCompletion | Shows completion toast when task moves to done | Same as TC-002 | `showToast` called with "completed" | High | Pass |
| TC-004 | Unit | useAgentCompletion | Uses agent displayName in toast | `availableAgents` contains matching agent | Toast contains displayName | Medium | Pass |
| TC-005 | Unit | useAgentCompletion | Does NOT fire when task is in in-progress, not done | Task in in-progress column | `clearActiveRun` not called | High | Pass |
| TC-006 | Unit | useAgentCompletion | Does NOT fire when task.updatedAt < startedAt (pipeline stage guard) | `updatedAt = UPDATED_BEFORE` (predates startedAt) | `clearActiveRun` not called | Critical | Pass |
| TC-007 | Unit | useAgentCompletion | Calls advancePipeline when autoAdvance=true, confirmBetweenStages=false | Pipeline running, settings set | `advancePipeline` called once | Critical | Pass |
| TC-008 | Unit | useAgentCompletion | Does NOT call advancePipeline when autoAdvance=false | `autoAdvance: false` | `advancePipeline` not called | High | Pass |
| TC-009 | Unit | useAgentCompletion | Shows confirmation toast instead of advancing when confirmBetweenStages=true | `confirmBetweenStages: true, autoAdvance: true` | `advancePipeline` not called; toast with "Advance" | High | Pass |
| TC-010 | Unit | useAgentCompletion | Does NOT call advancePipeline when pipelineState is null | `pipelineState = null` | `advancePipeline` not called | High | Pass |
| TC-011 | Unit | useAgentCompletion | Does NOT call advancePipeline when pipelineState.status != running | `status: 'completed'` | `advancePipeline` not called | Medium | Pass |
| TC-012 | Unit | usePolling | Polls loadBoard every 3000ms at idle | `activeRun = null`, advance 3000ms | `getTasks` called once | High | Pass |
| TC-013 | Unit | usePolling | Skips loadBoard when isMutating=true | `isMutating: true`, advance 3000ms | `getTasks` not called | High | Pass |
| TC-014 | Unit | usePolling | Clears interval on unmount | Unmount hook | `clearInterval` called | High | Pass |
| TC-015 | Unit | usePolling | Does not create multiple intervals on re-render | Render + 2 rerenders | `setInterval` called exactly once | Medium | Pass |
| TC-016 | Unit | usePolling | Resumes polling when isMutating becomes false | Toggle isMutating false | `getTasks` called on next tick | Medium | Pass |
| TC-017 | Unit | usePolling | Polls at 1000ms when activeRun is set | `activeRun != null`, advance 1000ms | `getTasks` called once | Critical | Pass |
| TC-018 | Unit | usePolling | Does NOT poll at 1000ms when activeRun is null | `activeRun = null`, advance 1000ms | `getTasks` not called; fires at 3000ms | Critical | Pass |
| TC-019 | Unit | usePolling | Switches to 1000ms when activeRun becomes non-null | Start idle, set activeRun mid-run | Fires at +1000ms after run starts | Critical | Pass |
| TC-020 | Unit | usePolling | Switches back to 3000ms when activeRun cleared | Clear activeRun, advance 1000ms | No extra fire; fires at 3000ms | Critical | Pass |
| TC-021 | Static | usePolling | Dead code: intervalMsRef declared but never read | Code review | `intervalMsRef` unused — dead code | Low | Fail |
| TC-022 | Static | useAgentCompletion | Equal-timestamp boundary: updatedAt === startedAt | `updatedAt == startedAt` | Should fire (>=). Test uses strict > gap; boundary not explicitly covered | Medium | Gap |
| TC-023 | Static | useAgentCompletion | agentSettings null guard — null agentSettings when pipelineState is running | `agentSettings: null`, pipelineState running, task done | `autoAdvance ?? true` so hook calls `confirmBetween` path; then calls `advancePipeline` — correct by nullish coalescing defaults | Low | Pass |
| TC-024 | TypeScript | All changed files | No type errors after fix | `npx tsc --noEmit` | Zero errors | Critical | Pass |
| TC-025 | Static | usePolling | Blueprint spec calls for React selector (`useAppStore(s => s.activeRun)`); implementation uses subscription + useState | Code review | Functional equivalence confirmed; subscription is safe and avoids selector-in-hook re-renders | Low | Pass (advisory) |

---

## Coverage Assessment

| Hook | Tests | Critical paths covered | Notes |
|------|-------|------------------------|-------|
| useAgentCompletion | 11 | Yes | Missing explicit equal-timestamp boundary test (TC-022) |
| usePolling | 9 | Yes | Dead code `intervalMsRef` (TC-021) |

Overall automated test coverage for changed files: **20/20 passing**.

---

## Environment Requirements

- Node.js 23+
- `cd frontend && npm test -- --run`
- `npx tsc --noEmit`

---

## Assumptions and Exclusions

1. `useAppStore.test.ts` timeout failure pre-dates this branch (confirmed via `git diff`). Excluded from scope.
2. E2E / manual pipeline run (blueprint T-003) is out of scope for this automated QA cycle. Flagged as a gap below.
3. `AgentRunIndicator.tsx` and `PipelineProgressBar.tsx` rendering correctness is assumed correct — those files are unchanged and have separate test coverage.
4. Performance threshold for polling: P95 < 500ms API response assumed satisfied by existing server — no new latency introduced by this change.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Equal-timestamp edge case fires or silently drops completion | Low | Medium | `>=` operator in code; add explicit boundary unit test |
| Dead `intervalMsRef` ref causes confusion in future refactors | Low | Low | Remove ref (Low severity bug) |
| Manual E2E pipeline run not verified in automation | Medium | High | Blueprint T-003 requires manual verification before merge |
| `usePolling` creates 2 intervals if `intervalMs` changes simultaneously with re-render | Low | Medium | Covered by TC-015 — confirmed only 1 interval per cadence |
