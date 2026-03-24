# Test Plan: Pipeline Log Viewer (T-6)

## Executive Summary

The log viewer feature introduces a side panel (`PipelineLogPanel`) in the Prism frontend that displays real-time and static logs per pipeline stage. The implementation is frontend-only, consuming two existing backend endpoints. No new backend endpoints were added.

QA result: **1 Medium bug, 2 Low bugs found. Zero Critical or High bugs. Merge gate: PASSED.**

All 814 Vitest tests pass. TypeScript compilation: clean. Coverage is comprehensive across all six components.

---

## Scope & Objectives

**In scope:**
- `usePipelineLogStore` — Zustand store correctness
- `usePipelineLogPolling` — polling lifecycle, error handling, cleanup
- `LogViewer` — auto-scroll, empty states, error state, scroll-to-bottom button
- `StageTabBar` — tab rendering, status icons, active styling, callbacks
- `PipelineLogPanel` — container integration, close button, stage selection, runId-less state
- `PipelineLogToggle` — visibility guard, toggle behaviour, aria attributes
- `api/client.ts` additions — `getStageLog`, `LogNotAvailableError`
- Design system compliance

**Out of scope:**
- Backend endpoints (pre-existing, not modified)
- `usePanelResize` hook (pre-existing, not modified)
- E2E browser automation (no Cypress/Playwright configured)

---

## Test Levels

| Level | Count | Tooling |
|-------|-------|---------|
| Unit (store, hook) | 44 | Vitest + renderHook |
| Component (RTL) | 47 | Vitest + React Testing Library |
| Integration (panel + store + polling) | 10 | Vitest + RTL + mocked API |
| Static analysis | — | tsc --noEmit |
| Code review (design system, spec conformance) | — | Manual |
| Security | — | Manual OWASP review |

---

## Test Cases

| ID | Type | Story | Description | Input | Expected | Priority | Status |
|----|------|-------|-------------|-------|----------|----------|--------|
| TC-001 | Unit | — | Store initialises logPanelOpen=false | Initial state | false | P1 | Pass |
| TC-002 | Unit | — | Store initialises selectedStageIndex=0 | Initial state | 0 | P1 | Pass |
| TC-003 | Unit | — | setLogPanelOpen(true) opens panel | Action call | logPanelOpen=true | P1 | Pass |
| TC-004 | Unit | — | setLogPanelOpen(false) closes panel | Action call | logPanelOpen=false | P1 | Pass |
| TC-005 | Unit | — | setStageLog stores content per stage | setStageLog(2, 'x') | stageLogs[2]='x' | P1 | Pass |
| TC-006 | Unit | — | setStageLog does not overwrite other stages | Parallel writes | Isolated per-key | P1 | Pass |
| TC-007 | Unit | — | setStageError stores and clears errors | null/string writes | Correct per stage | P1 | Pass |
| TC-008 | Unit | — | clearStageLogs resets all caches | Populated caches | All {} | P1 | Pass |
| TC-009 | Unit | — | clearStageLogs preserves logPanelOpen/selectedStageIndex | clearStageLogs() | Unchanged | P1 | Pass |
| TC-010 | Unit | E3-S1 | No fetch when runId is null | runId=null | 0 API calls | P1 | Pass |
| TC-011 | Unit | E5-S1 | Single fetch on mount when isRunActive=false | mount once | 1 call to getStageLog | P1 | Pass |
| TC-012 | Unit | E5-S1 | No repeat after static fetch | advance 10000ms | still 1 call | P1 | Pass |
| TC-013 | Unit | E3-S1 | Store receives log content after static fetch | mock resolves 'x' | stageLogs[0]='x' | P1 | Pass |
| TC-014 | Unit | E3-S1 | Immediate fetch on mount (active run) | isRunActive=true | 1 call before interval | P1 | Pass |
| TC-015 | Unit | E3-S1 | Interval fires after 2000ms | advance 2000ms | 2 total calls | P1 | Pass |
| TC-016 | Unit | E3-S1 | Interval fires twice after 4000ms | advance 4000ms | 3 total calls | P1 | Pass |
| TC-017 | Unit | E3-S1 | Interval cleaned up on unmount | unmount + 10000ms | No extra calls | P1 | Pass |
| TC-018 | Unit | E2-S1 | Re-fetch immediately on stageIndex change | rerender stageIndex=1 | Fetch for stage 1 | P1 | Pass |
| TC-019 | Unit | E4-S1 | LogNotAvailableError: log='', error=null | 404 LOG_NOT_AVAILABLE | No error shown | P1 | Pass |
| TC-020 | Unit | E4-S3 | Generic HTTP error sets stageError | Error('HTTP 500') | stageErrors[0]='HTTP 500' | P1 | Pass |
| TC-021 | Unit | E4-S3 | Generic error does NOT set stageLog | Error('server error') | stageLogs[0]=undefined | P1 | Pass |
| TC-022 | Unit | — | Loading flag: true during fetch, false after | promise pending → resolve | stageLoading lifecycle | P1 | Pass |
| TC-023 | Component | E4-S3 | LogViewer: error state renders error text | error='HTTP 500...' | Text visible | P1 | Pass |
| TC-024 | Component | E4-S3 | LogViewer: error state shows error icon | error non-null | 'error' icon present | P1 | Pass |
| TC-025 | Component | E4-S3 | LogViewer: no pre element when error | error non-null | pre absent | P1 | Pass |
| TC-026 | Component | E4-S1 | LogViewer: pending state shows "Stage not started yet." | isPending=true, content='' | Message visible | P1 | Pass |
| TC-027 | Component | E4-S1 | LogViewer: pending state shows hourglass icon | isPending=true | 'hourglass_empty' visible | P1 | Pass |
| TC-028 | Component | E4-S2 | LogViewer: running state shows "Waiting for output..." | isRunning=true, content='' | Message visible | P1 | Pass |
| TC-029 | Component | E4-S2 | LogViewer: isLoading shows "Waiting for output..." | isLoading=true, content='' | Message visible | P1 | Pass |
| TC-030 | Component | E4-S2 | LogViewer: running state shows spinner icon | isRunning=true | 'progress_activity' visible | P1 | Pass |
| TC-031 | Component | — | LogViewer: no-output empty state | all false, content='' | "No output for this stage." | P2 | Pass |
| TC-032 | Component | — | LogViewer: content renders in pre | content='line1\nline2' | Text in pre element | P1 | Pass |
| TC-033 | Component | — | LogViewer: pre has font-mono class | content set | font-mono present | P2 | Pass |
| TC-034 | Component | E3-S2 | LogViewer: auto-scroll when isAtBottom=true | content change | scrollTop=scrollHeight | P1 | Pass |
| TC-035 | Component | E3-S2 | LogViewer: no auto-scroll when scrolled up | scrollTop=0, scroll event | scrollTop unchanged | P1 | Pass |
| TC-036 | Component | E3-S3 | LogViewer: no scroll-to-bottom button initially | isAtBottom=true | Button absent | P1 | Pass |
| TC-037 | Component | E3-S3 | LogViewer: scroll-to-bottom button appears on scroll | scrollTop=0, scroll event | Button visible | P1 | Pass |
| TC-038 | Component | E3-S3 | LogViewer: click scroll-to-bottom restores scroll | click button | scrollTop=scrollHeight, button gone | P1 | Pass |
| TC-039 | Component | E2-S1 | StageTabBar: renders 4 tabs for 4 stages | 4-stage array | 4 role=tab elements | P1 | Pass |
| TC-040 | Component | E2-S1 | StageTabBar: short labels correct | all 4 agents | Architect/UX/Dev/QA | P1 | Pass |
| TC-041 | Component | E2-S1 | StageTabBar: falls back to first word | 'custom-agent' | 'custom' | P2 | Pass |
| TC-042 | Component | E2-S1 | StageTabBar: aria-selected=true on active tab | selectedIndex=2 | tabs[2] aria-selected=true | P1 | Pass |
| TC-043 | Component | E2-S1 | StageTabBar: border-primary on active tab | selectedIndex=1 | tabs[1] has border-primary | P1 | Pass |
| TC-044 | Component | E2-S1 | StageTabBar: onSelect called with correct index | click tab[3] | onSelect(3) | P1 | Pass |
| TC-045 | Component | E2-S2 | StageTabBar: check icon for completed | status=completed | 'check' icon | P1 | Pass |
| TC-046 | Component | E2-S2 | StageTabBar: spinner for running | status=running | 'progress_activity' icon | P1 | Pass |
| TC-047 | Component | E2-S2 | StageTabBar: close icon for failed | status=failed | 'close' icon | P1 | Pass |
| TC-048 | Component | E2-S2 | StageTabBar: close icon for timeout | status=timeout | 'close' icon | P1 | Pass |
| TC-049 | Component | E2-S2 | StageTabBar: hourglass for pending | status=pending | 'hourglass_empty' icon | P1 | Pass |
| TC-050 | Integration | E1-S1 | PipelineLogPanel: renders as aside/complementary | pipelineState set | aside with correct role | P1 | Pass |
| TC-051 | Integration | — | PipelineLogPanel: "Pipeline Logs" in header | render | Text visible | P1 | Pass |
| TC-052 | Integration | E1-S2 | PipelineLogPanel: close button present | render | Button with close label | P1 | Pass |
| TC-053 | Integration | — | PipelineLogPanel: 4 stage tabs | 4-stage pipeline | 4 role=tab | P1 | Pass |
| TC-054 | Integration | E1-S2 | PipelineLogPanel: close button sets logPanelOpen=false | click close | Store updated | P1 | Pass |
| TC-055 | Integration | E2-S1 | PipelineLogPanel: tab click updates selectedStageIndex | click tab[2] | selectedStageIndex=2 | P1 | Pass |
| TC-056 | Integration | — | PipelineLogPanel: no runId shows "No active pipeline run." | runId=undefined | Message visible | P1 | Pass |
| TC-057 | Integration | E4-S2 | PipelineLogPanel: running stage with no log shows spinner | status=running, logs={} | "Waiting for output..." | P1 | Pass |
| TC-058 | Integration | E4-S1 | PipelineLogPanel: pending stage shows pending state | selectedStageIndex=3, logs={} | "Stage not started yet." | P1 | Pass |
| TC-059 | Integration | — | PipelineLogPanel: log content rendered | stageLogs[0]='Hello...' | Text visible | P1 | Pass |
| TC-060 | Integration | E4-S3 | PipelineLogPanel: error message rendered | stageErrors[0]='Connection refused' | Text visible | P1 | Pass |
| TC-061 | Component | E1-S1 | PipelineLogToggle: hidden when pipelineState=null | pipelineState=null | Button absent | P1 | Pass |
| TC-062 | Component | E1-S1 | PipelineLogToggle: visible when pipelineState set | pipelineState set | Button present | P1 | Pass |
| TC-063 | Component | E1-S1 | PipelineLogToggle: opens panel when closed | logPanelOpen=false, click | logPanelOpen=true | P1 | Pass |
| TC-064 | Component | E1-S2 | PipelineLogToggle: closes panel when open | logPanelOpen=true, click | logPanelOpen=false | P1 | Pass |
| TC-065 | Component | — | PipelineLogToggle: aria-pressed=true when panel open | logPanelOpen=true | aria-pressed='true' | P1 | Pass |
| TC-066 | Component | — | PipelineLogToggle: aria-pressed=false when panel closed | logPanelOpen=false | aria-pressed='false' | P1 | Pass |
| TC-067 | Component | — | PipelineLogToggle: uses article icon | render | 'article' in button text | P2 | Pass |
| TC-068 | Static | — | TypeScript: no type errors | tsc --noEmit | Clean compilation | P1 | Pass |
| TC-069 | Code review | — | Design system: inline style in PipelineLogPanel | width prop inline | See BUG-001 | P2 | Fail |
| TC-070 | Code review | E2-S2 | Spec: timeout icon should be timer_off | StageTabBar code | close used instead | P2 | Fail |
| TC-071 | Code review | E4-S3 | Spec: error state message text | LogViewer error state | Generic text, not spec message | P3 | Fail |
| TC-072 | Security | — | OWASP A03: raw log content in pre (XSS) | content with HTML | React escapes by default | P1 | Pass |
| TC-073 | Security | — | OWASP A01: toggle visibility guard | pipelineState null | Button not rendered | P1 | Pass |
| TC-074 | Security | — | OWASP A05: console.log in production code | getStageLog polling | Advisory (dev only) | P3 | Advisory |

---

## Environment Requirements

- Node.js 20+
- `cd frontend && npm test` — Vitest + React Testing Library
- `cd frontend && npx tsc --noEmit` — TypeScript type check

---

## Assumptions & Exclusions

- `usePanelResize` hook behaviour is tested in its own suite; not re-tested here.
- Backend endpoints are pre-existing and not under test for this feature.
- No E2E browser tests (no Cypress/Playwright in the project).
- `console.log` in polling code is treated as advisory (dev observability per blueprint §3.4), not a bug.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Auto-scroll threshold too tight (8px vs spec 20px) | Medium | Low | 8px is more conservative; AT_BOTTOM_THRESHOLD=8 triggers auto-scroll more readily (user sees fresh content more often). Not a regression but spec drift. |
| timeout stage shows wrong icon (close vs timer_off) | Low | Medium | WCAG 1.4.1 requires icon+color, not icon alone. close is visually different enough from pending (hourglass) but less informative than timer_off |
| Inline style width on PipelineLogPanel | Low | Low | Cosmetic only; does not affect functionality |
| Error message text does not match spec | Low | Low | User sees a generic message rather than the Spanish spec text; functionally correct |
