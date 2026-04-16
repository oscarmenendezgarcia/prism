# Test Plan: Pipeline Blocked — Pausa Automática en Pregunta sin Responder

**Feature:** pipeline-blocked  
**Stage:** QA  
**Date:** 2026-04-16  
**QA Agent:** qa-engineer-e2e  
**Depends on:** task-comments (ADR-1, Accepted)

---

## Executive Summary

The `pipeline-blocked` feature adds a `blocked` status to the pipeline run lifecycle. When an agent posts a `type=question` comment with `resolved=false`, the pipeline manager transitions the run to `blocked` and halts stage advancement. Auto-resume fires when the comment is resolved via `PATCH`. Manual override is available via `POST /runs/:runId/resume`.

**All 52 existing tests pass (26 integration + 26 unit/comment-driven).** Two Medium bugs and two Low advisories were found through static analysis and gap testing. No Critical or High issues — feature is **approved to merge** after recommended fixes.

---

## Scope & Objectives

| Scope | In |
|-------|----|
| `blocked` state transitions (running→blocked, blocked→running) | ✅ |
| `blockedReason` field populated correctly on GET /runs/:runId | ✅ |
| `handleStageClose` guard prevents advancement past stage with open questions | ✅ |
| `blockRunByComment` — event-driven block when question created between stages | ✅ |
| `unblockRunByComment` — event-driven resume when last question resolved | ✅ |
| `resumeRun` accepts `blocked` status, sets `bypassQuestionCheck` | ✅ |
| `stopRun` accepts `blocked` status | ✅ |
| `init()` preserves `blocked` runs across server restarts | ✅ |
| REST endpoints: `/block`, `/unblock` | ✅ |
| MCP tools: `kanban_add_comment`, `kanban_answer_comment` | ✅ |
| Multiple unresolved questions — `blockedReason` chaining | ✅ |

| Out of scope |
|-------------|
| Frontend UI for `blocked` state |
| Push notifications on block |
| Auto-timeout for unanswered questions |

---

## Test Levels

### Unit Tests

| ID | Description | Target |
|----|-------------|--------|
| UT-001 | `findActiveRunByTaskId` returns run for status=blocked | pipelineManager |
| UT-002 | `findActiveRunByTaskId` returns null for completed/failed/interrupted | pipelineManager |
| UT-003 | `blockRunByComment` blocks run between stages with `blockedReason` | pipelineManager |
| UT-004 | `blockRunByComment` does NOT block when stage is mid-execution | pipelineManager |
| UT-005 | `unblockRunByComment` resumes when last question resolved | pipelineManager |
| UT-006 | `unblockRunByComment` updates `blockedReason` to second question when first resolved | pipelineManager |
| UT-007 | `unblockRunByComment` does nothing when run is not blocked | pipelineManager |

### Integration Tests — REST Block/Unblock

| ID | Description | Expected |
|----|-------------|----------|
| IT-001 | `POST /block` on unknown runId → 404 RUN_NOT_FOUND | ✅ |
| IT-002 | `GET /block` → 405 Method Not Allowed | ✅ |
| IT-003 | `POST /block` on running pipeline → 200 status=blocked | ✅ |
| IT-004 | `POST /block` on already-blocked run → 200 idempotent | ✅ |
| IT-005 | `POST /unblock` on unknown runId → 404 RUN_NOT_FOUND | ✅ |
| IT-006 | `GET /unblock` → 405 Method Not Allowed | ✅ |
| IT-007 | `POST /unblock` on blocked run → 200 status=running | ✅ |
| IT-008 | `POST /unblock` on running run → 422 RUN_NOT_BLOCKED | ✅ |
| IT-009 | `POST /block` on completed run → 422 RUN_IN_TERMINAL_STATE | ✅ |
| IT-010 | `POST /block` on failed run → 422 RUN_IN_TERMINAL_STATE | ✅ |
| IT-011 | Blocked run appears in `GET /runs` list with correct status | ✅ |

### Integration Tests — Comment-Driven (PIPELINE_NO_SPAWN=1)

| ID | Description | Expected |
|----|-------------|----------|
| CD-001 | Question on task → `handleStageClose` guard blocks run after stage completes | ✅ |
| CD-002 | `GET /runs/:runId` returns full `blockedReason` (commentId, taskId, author, text, blockedAt) | ✅ |
| CD-003 | Resolving blocking question auto-resumes pipeline to completion | ✅ |
| CD-004 | 2 questions: resolving first keeps run blocked, pointing to second question | ✅ |
| CD-005 | `POST /resume` manually resumes blocked run, clears `blockedReason` | ✅ |
| CD-006 | `POST /stop` transitions blocked run to interrupted | ✅ |
| CD-007 | Note comment does NOT block pipeline | ✅ |
| CD-008 | Question on paused (checkpoint) run → `blockRunByComment` blocks immediately | ✅ |

### Integration Tests — MCP Comment/Comment-Pipeline

| ID | Description | Expected |
|----|-------------|----------|
| TC-001..004 | Note comment — happy path, no pipeline blocking | ✅ |
| TC-005..008 | Question comment → auto-block pipeline (between stages) | ✅ |
| TC-009..012 | PATCH resolved=true → auto-unblock pipeline (single question) | ✅ |
| TC-013..016 | Multiple questions → only unblock when ALL resolved | ✅ |
| TC-017..019 | Question comment with no active run — graceful (no crash) | ✅ |
| TC-020..026 | Edge cases: missing fields, unknown IDs, mid-execution guard | ✅ |

### Gap Tests (New, identified by QA)

| ID | Description | Expected | Status |
|----|-------------|----------|--------|
| GT-001 | `POST /unblock` on run with `blockedReason` → `blockedReason` absent in response | blockedReason should be null | ❌ FAIL — BUG-001 |
| GT-002 | `kanban_answer_comment` returns `pipelineUnblocked` accurately when server-side hook fires | pipelineUnblocked=true | ❌ FAIL — BUG-002 |
| GT-003 | `bypassQuestionCheck` cleared on resumeRun from non-blocked state | flag absent | ⚠️ LOW — BUG-003 |
| GT-004 | `POST /block` (REST) response has no `blockedReason` | documented absence | ℹ️ LOW ADVISORY — BUG-004 |

### Security Tests (OWASP Top 10)

| Category | Check | Status |
|----------|-------|--------|
| A01 Broken Access Control | No auth required — all endpoints open by design (local dev tool) | Advisory |
| A03 Injection | `blockedReason.text` from user input is serialized, not eval'd | ✅ Safe |
| A03 Injection | `commentId` used in log messages only, not in shell commands | ✅ Safe |
| A05 Security Misconfiguration | `PIPELINE_NO_SPAWN=1` env var disables real spawning (test hook) | ✅ Documented |
| A08 Insecure Deserialization | `blockRunByComment` reads `run.json` atomically — no deserialization risk | ✅ Safe |
| A09 Logging | Pipeline log events include `blockedReason.text` snapshot — PII risk if questions contain sensitive data | Advisory |

### Performance Tests

| Check | Threshold | Status |
|-------|-----------|--------|
| `blockRunByComment` is synchronous, runs in comment handler path | < 5ms (1 registry read + 1 run write) | ✅ Acceptable |
| `unblockRunByComment` reads task from disk (N=1) | < 5ms | ✅ Acceptable |
| `init()` does not process blocked runs — no restart overhead | O(1) per blocked run | ✅ |
| No polling overhead added for blocked state | Event-driven — 0ms polling cost | ✅ |

---

## Environment Requirements

- Node.js ≥ 14.17 (crypto.randomUUID)
- `PIPELINE_NO_SPAWN=1` for comment-driven integration tests
- Isolated temp directory per test server
- `tests/helpers/server.js` — `startTestServer()` returning `{ port, agentsDir, close }`

---

## Assumptions & Exclusions

- Auth: No authentication layer — intentional for local dev tool
- `blocked` state is not exposed in the frontend UI (out of scope per ADR)
- MCP tool `kanban_add_comment` double-block (REST /block after server-side `blockRunByComment`) is idempotent and benign
- `unblockRun` REST called directly by humans — normal path is via `unblockRunByComment`

---

## Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Stale `blockedReason` after REST `/unblock` confuses API clients | Medium | Low | Fix in BUG-001 |
| Agent using `kanban_answer_comment` reads `pipelineUnblocked: false` and takes incorrect action | Medium | Medium | Fix in BUG-002 |
| `bypassQuestionCheck` persists across unrelated resumes | Low | Low | Fix in BUG-003 |
| Double-unblock race (server-side hook + MCP tool) | Low | Low | Already idempotent |
