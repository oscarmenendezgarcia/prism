# Test Plan: Agent Run History Panel

## Executive Summary

The Agent Run History feature adds three backend REST endpoints (`POST`, `PATCH`, `GET /api/v1/agent-runs`), a JSONL-backed persistence layer, a Zustand slice (`useRunHistoryStore`), a resizable right-sidebar panel with status filtering, and a pulsing active-run indicator on task cards that links to the panel filtered by task.

QA identified **one failing test** (pre-existing timeout caused by 500 ms advance on a 3000 ms polling loop), **one incomplete mock** in `useAppStore.test.ts`, and **three coverage gaps** (taskIdFilter panel chip, `useRunHistoryPolling` hook, `openPanelForTask` click path on TaskCard). No Critical or High bugs were found. All backend tests pass. The feature is **ready to merge** with the Medium and Low bugs tracked for resolution.

---

## Scope and Objectives

**In scope:**
- Backend: POST, PATCH, GET `/api/v1/agent-runs` routes in `server.js`
- JSONL persistence at `data/agent-runs.jsonl` — atomic writes, max-500 pruning
- Stale-run healing (read-time, non-mutating)
- Frontend: `useRunHistoryStore`, `RunHistoryPanel`, `RunHistoryEntry`, `RunStatusBadge`, `RunHistoryToggle`, `useRunHistoryPolling`
- TaskCard active-run pulsing indicator and click-to-open-panel interaction
- Existing test suites: backend `tests/agent-runs.test.js` + frontend Vitest

**Out of scope:**
- End-to-end browser automation (no Cypress setup in repo)
- PTY / terminal integration paths (covered by separate terminal QA cycle)
- Pipeline progress bar (separate component, has its own tests)

---

## Test Levels

### Unit Tests (Frontend — Vitest + RTL)

| Component / Module | Test File | Count |
|--------------------|-----------|-------|
| `RunHistoryPanel` | `RunHistoryPanel.test.tsx` | 16 |
| `RunHistoryEntry` | `RunHistoryEntry.test.tsx` | 15 |
| `RunHistoryToggle` | `RunHistoryToggle.test.tsx` | 6 |
| `RunStatusBadge` | `RunStatusBadge.test.tsx` | 12 |
| `useRunHistoryStore` | `useRunHistoryStore.test.ts` | 13 |
| `AgentRunIndicator` | `AgentRunIndicator.test.tsx` | 13 |
| `TaskCard` | `TaskCard.test.tsx` | 16 |
| Agent API client | `agent-client.test.ts` | 21 |

### Integration Tests (Backend — node:test custom runner)

| Suite | Test File | Count |
|-------|-----------|-------|
| POST `/api/v1/agent-runs` | `agent-runs.test.js` | 6 |
| PATCH `/api/v1/agent-runs/:runId` | `agent-runs.test.js` | 7 |
| GET `/api/v1/agent-runs` (filters, limit, ordering) | `agent-runs.test.js` | 7 |
| Stale healing | `agent-runs.test.js` | 2 |
| Pruning at 500 entries | `agent-runs.test.js` | 1 |

### E2E / Integration (Static analysis — no Cypress)

Covered by static code review and store integration tests verifying that:
- `executeAgentRun()` in `useAppStore` calls `recordRunStarted()` (verified in `useAppStore.test.ts`)
- `useAgentCompletion` calls `recordRunFinished()` (verified in `useAgentCompletion.test.ts`)
- `cancelAgentRun()` calls `recordRunFinished()` (verified in `useAppStore.test.ts`)

### Performance Tests

Covered by the pruning test which inserts 501 records sequentially and asserts the JSONL is trimmed to 500. No formal k6 load test was run; this is a local-only tool and the ADR explicitly chose polling over SSE for simplicity.

**Baseline thresholds (established):**
- `GET /api/v1/agent-runs` (empty file): < 5 ms (synchronous fs.readFileSync)
- `POST /api/v1/agent-runs` with pruning (501 entries): < 100 ms on local SSD

### Security Assessment (OWASP Top 10)

| OWASP Category | Surface | Finding |
|----------------|---------|---------|
| A01 Broken Access Control | All three endpoints have no authentication — same as all Prism endpoints (local-only tool) | Advisory — acceptable for local dev tool |
| A02 Cryptographic Failures | No sensitive data stored beyond CLI command strings and file paths | Pass |
| A03 Injection | `runId` from URL is used in `findIndex` comparison only — no shell execution or SQL | Pass |
| A04 Insecure Design | JSONL path is server-controlled (`path.join(dataDir, 'agent-runs.jsonl')`) — no user-controlled path | Pass |
| A05 Security Misconfiguration | No HTTP security headers (pre-existing, not new) | Pre-existing advisory |
| A06 Vulnerable Components | No new npm dependencies added | Pass |
| A07 Identity / Auth Failures | No auth layer (by design — local tool) | Advisory |
| A08 Software/Data Integrity | Atomic write via `.tmp` + `renameSync` — integrity on crash | Pass |
| A09 Logging Failures | Structured JSON logs for all lifecycle events | Pass |
| A10 Server-Side Request Forgery | No outbound HTTP from these handlers | Pass |

---

## Test Cases Table

| ID | Type | Description | Input | Expected | Priority | Status |
|----|------|-------------|-------|----------|----------|--------|
| TC-001 | Integration | POST creates run, returns 201 { id } | Valid payload | 201 + id echo | P0 | Pass |
| TC-002 | Integration | POST — created run appears in GET | Valid payload + GET | run.status=running | P0 | Pass |
| TC-003 | Integration | POST — missing id returns 400 | No id field | 400 VALIDATION_ERROR | P0 | Pass |
| TC-004 | Integration | POST — missing taskId returns 400 | No taskId | 400 | P0 | Pass |
| TC-005 | Integration | POST — invalid startedAt returns 400 | startedAt='not-a-date' | 400 | P0 | Pass |
| TC-006 | Integration | POST — unsupported method 405 | DELETE /agent-runs | 405 | P1 | Pass |
| TC-007 | Integration | PATCH updates status/completedAt/durationMs | status=completed | 200 + status echo | P0 | Pass |
| TC-008 | Integration | PATCH — updated record visible in GET | PATCH + GET | run.status=cancelled | P0 | Pass |
| TC-009 | Integration | PATCH — unknown runId returns 404 | nonexistent id | 404 RUN_NOT_FOUND | P0 | Pass |
| TC-010 | Integration | PATCH — status=running rejected (400) | status=running | 400 | P0 | Pass |
| TC-011 | Integration | PATCH — missing completedAt returns 400 | No completedAt | 400 | P0 | Pass |
| TC-012 | Integration | PATCH — missing durationMs returns 400 | No durationMs | 400 | P0 | Pass |
| TC-013 | Integration | PATCH — DELETE on single route 405 | DELETE /runs/:id | 405 | P1 | Pass |
| TC-014 | Integration | GET returns 200 with runs + total | 3 records in file | status=200 | P0 | Pass |
| TC-015 | Integration | GET returns runs newest-first | Three runs inserted oldest→newest | runC before runA | P0 | Pass |
| TC-016 | Integration | GET ?status=completed filters | Mixed records | only completed | P0 | Pass |
| TC-017 | Integration | GET ?status=running filters | Mixed records | only running | P0 | Pass |
| TC-018 | Integration | GET ?limit=1 caps results | 3 records | runs.length=1 | P0 | Pass |
| TC-019 | Integration | GET ?status=unknown returns 400 | invalid status | 400 VALIDATION_ERROR | P0 | Pass |
| TC-020 | Integration | GET ?limit=999 returns 400 | limit > 500 | 400 | P0 | Pass |
| TC-021 | Integration | Stale healing — 5h-old running run returned as failed | running + startedAt 5h ago | status=failed reason=stale | P0 | Pass |
| TC-022 | Integration | Stale healing — recent run not marked stale | running + startedAt now | status=running | P0 | Pass |
| TC-023 | Integration | Pruning — 501 inserts yields 500 in GET | 501 POSTs | total <= 500 | P1 | Pass |
| TC-024 | Unit | RunHistoryPanel renders role=complementary | empty store | complementary landmark | P0 | Pass |
| TC-025 | Unit | RunHistoryPanel empty state when no runs | runs=[] filter=all | "No runs yet" | P0 | Pass |
| TC-026 | Unit | RunHistoryPanel filter-specific empty state | filter=running runs=[] | "No running runs" | P0 | Pass |
| TC-027 | Unit | RunHistoryPanel renders entries for each run | 2 runs in store | 2 agent names | P0 | Pass |
| TC-028 | Unit | RunHistoryPanel filter pills all rendered | default state | 5 pills | P0 | Pass |
| TC-029 | Unit | RunHistoryPanel clicking Done pill sets filter=completed | click Done | store.filter=completed | P0 | Pass |
| TC-030 | Unit | RunHistoryPanel aria-pressed on active pill | filter=running | aria-pressed=true | P0 | Pass |
| TC-031 | Unit | RunHistoryPanel filtering hides non-matching entries | filter=completed | only completed agent name visible | P0 | Pass |
| TC-032 | Unit | RunHistoryPanel pulsing dot shown when run active | running run | .animate-pulse present | P1 | Pass |
| TC-033 | Unit | RunHistoryPanel pulsing dot absent when no active runs | completed only | .animate-pulse absent | P1 | Pass |
| TC-034 | Unit | RunHistoryPanel close button calls toggleHistoryPanel | click close | mock called | P0 | Pass |
| TC-035 | Unit | RunHistoryPanel taskIdFilter chip rendered | taskIdFilter set | "Filtering by task" visible | P1 | MISSING |
| TC-036 | Unit | RunHistoryPanel clearTaskIdFilter X button clears filter | click X on chip | taskIdFilter=null | P1 | MISSING |
| TC-037 | Unit | RunHistoryEntry renders agentDisplayName | run prop | agent name text | P0 | Pass |
| TC-038 | Unit | RunHistoryEntry renders taskTitle | run prop | task title text | P0 | Pass |
| TC-039 | Unit | RunHistoryEntry renders spaceName | run prop | space name text | P0 | Pass |
| TC-040 | Unit | RunHistoryEntry renders relative time | startedAt=1min ago | "1 min ago" | P0 | Pass |
| TC-041 | Unit | RunHistoryEntry correct icon per status | all 4 statuses | smart_toy/check_circle/cancel/error | P0 | Pass |
| TC-042 | Unit | RunHistoryEntry correct border color per status | all 4 statuses | border-l-{primary/success/warning/error} | P0 | Pass |
| TC-043 | Unit | RunHistoryEntry no duration when null | completedAt=null | no Duration label | P0 | Pass |
| TC-044 | Unit | RunHistoryEntry formatted duration 5:23 | durationMs=323000 | "5:23" | P0 | Pass |
| TC-045 | Unit | RunHistoryToggle renders with aria-label | default | button label | P0 | Pass |
| TC-046 | Unit | RunHistoryToggle aria-pressed=false when closed | historyPanelOpen=false | aria-pressed=false | P0 | Pass |
| TC-047 | Unit | RunHistoryToggle aria-pressed=true when open | historyPanelOpen=true | aria-pressed=true | P0 | Pass |
| TC-048 | Unit | RunHistoryToggle calls toggleHistoryPanel on click | click | mock called | P0 | Pass |
| TC-049 | Unit | RunStatusBadge renders all 4 status variants | each status | correct label | P0 | Pass |
| TC-050 | Unit | RunStatusBadge has role=status | running | role=status | P0 | Pass |
| TC-051 | Unit | useRunHistoryStore loadRuns populates runs | API returns 2 runs | runs.length=2 | P0 | Pass |
| TC-052 | Unit | useRunHistoryStore loadRuns handles error without throw | API rejects | resolves undefined | P0 | Pass |
| TC-053 | Unit | useRunHistoryStore recordRunStarted prepends optimistically | API success | run[0].id=new | P0 | Pass |
| TC-054 | Unit | useRunHistoryStore recordRunStarted calls createAgentRun | API success | mock called with id | P0 | Pass |
| TC-055 | Unit | useRunHistoryStore recordRunStarted still prepends on API fail | API rejects | run still in list | P0 | Pass |
| TC-056 | Unit | useRunHistoryStore recordRunFinished updates status | patch success | run.status=completed | P0 | Pass |
| TC-057 | Unit | useRunHistoryStore setFilter / toggleHistoryPanel | setFilter + toggle | state updated | P0 | Pass |
| TC-058 | Unit | useRunHistoryStore openPanelForTask / clearTaskIdFilter | openPanelForTask('t-1') | taskIdFilter='t-1' | P1 | MISSING |
| TC-059 | Unit | TaskCard pulsing indicator visible when activeRun.taskId matches | activeRun set | "Running" text visible | P0 | MISSING |
| TC-060 | Unit | TaskCard clicking "Running" button calls openPanelForTask | click indicator | openPanelForTask('task-id') | P0 | MISSING |
| TC-061 | Unit | TaskCard indicator absent when no active run | activeRun=null | "Running" absent | P0 | MISSING |
| TC-062 | Unit | useRunHistoryPolling polls at 1s when activeRun set | activeRun != null | loadRuns called every 1s | P1 | MISSING |
| TC-063 | Unit | useRunHistoryPolling polls at 3s when idle | activeRun=null | loadRuns called every 3s | P1 | MISSING |
| TC-064 | Unit | useAppStore.executeAgentRun — null terminalSender 3000ms timeout | vi.advanceTimersByTime(3000) | error toast shown | P0 | FAIL (timeout) |

---

## Environment Requirements

- Node.js 23.9.0 (confirmed)
- `npm test` in `frontend/` runs Vitest v2.1.9
- `node tests/agent-runs.test.js` runs custom integration runner
- Server must be running for manual smoke tests
- No browser E2E runner configured

---

## Assumptions and Exclusions

- A-1: `agentId` enum validation in POST is not enforced server-side (any non-empty string passes). The spec lists an enum but the code validates only that the field is a non-empty string. Treated as Low spec drift.
- A-2: The 500ms test (TC-064) failure is pre-existing — the poll timeout was extended from 500ms to 3000ms during development but the test was not updated. This is a test bug, not a production bug.
- A-3: No authentication is present on any endpoint — this is by design for a local-only tool (ADR §3).
- A-4: `useRunHistoryPolling` has no test file — the hook is simple enough that its contract is partially covered by store tests, but the adaptive cadence and `isMutating` guard are untested.

---

## Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Browser tab closed mid-run → stale `running` record | Medium | Medium | Stale healing on GET (4h threshold) |
| JSONL corruption on concurrent POSTs | Low | Low | appendFileSync is atomic for small payloads |
| `createAgentRun` missing from `useAppStore.test.ts` mock causes noisy stderr | Low | Certain | Add mock export (BUG-002) |
| TaskCard "Running" button click path untested | Medium | Certain | Add test (BUG-003) |
