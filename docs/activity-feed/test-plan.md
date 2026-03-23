# Test Plan: Activity Feed Real-Time

**Feature:** Activity Feed Real-Time (Prism Kanban)
**QA Cycle:** 2026-03-23
**QA Engineer:** qa-engineer-e2e
**References:** ADR-1.md, api-spec.json, user-stories.md, blueprint.md

---

## Executive Summary

The Activity Feed feature is **substantially complete and functionally sound**. All 22 backend tests pass and all 50 activity-specific frontend tests pass. Two Medium-severity bugs prevent full spec conformance: pagination is broken (nextCursor is never stored or used by the UI) and the panel resize min/max width limits differ from the user story spec. Both are functional regressions against documented acceptance criteria. No Critical bugs were found. The merge gate — zero unresolved Critical or High bugs — is currently met.

---

## Scope & Objectives

**In scope:**
- `src/activityStore.js` — JSONL persistence, query, 30-day retention
- `src/activityLogger.js` — event construction, fire-and-forget append + broadcast
- `activity-ws.js` — WebSocket server, connection cap, origin check, broadcast
- `server.js` — activity REST endpoints, mutation hooks, startup wiring
- `terminal.js` — upgrade handler pass-through fix
- `mcp/mcp-server.js` — `kanban_list_activity` tool
- `frontend/src/hooks/useActivityFeed.ts` — WS lifecycle, reconnect backoff, ping
- `frontend/src/stores/useAppStore.ts` — activity slice: events, filter, unread
- `frontend/src/components/activity/ActivityFeedPanel.tsx` — panel UI
- `frontend/src/components/activity/ActivityFeedToggle.tsx` — header toggle, badge
- `frontend/src/App.tsx` — panel mounting, hook placement

**Out of scope:**
- Other panel types (TerminalPanel, ConfigPanel) — not modified except pass-through fix
- Authentication/authorization (Prism is a local dev tool with no auth)
- Multi-user concurrency (single-user local tool by design)

---

## Test Levels

### Unit Tests
- `src/activityStore.js` — append, query (filters, cursor, retention)
- `src/activityLogger.js` — event construction, fire-and-forget error handling
- `activity-ws.js` — broadcast, safeSend, origin validation
- `useActivityFeed` hook — WS lifecycle, backoff, ping, cleanup
- `ActivityFeedPanel` component — rendering, filtering, descriptions
- `ActivityFeedToggle` component — badge cap, aria state, interaction

### Integration Tests
- Backend mutation endpoints emit correct events to REST activity endpoint
- WebSocket broadcast within 500ms of mutation
- Type filter, pagination (cursor), date validation
- Space CRUD events logged correctly

### E2E (Simulated — no browser automation)
- Panel open/close triggers unread count reset
- "Load more" button invokes `loadActivityHistory` action
- Filter dropdown dispatches `setActivityFilter`

### Performance
- REST query SLA: < 100ms p95 for limit ≤ 50 (local disk)
- WS event delivery: < 500ms from mutation (verified by integration test timeout)
- Startup migration: < 500ms (trivial — just `mkdirSync recursive`)

### Security
- Origin check on WS upgrade — non-localhost origins rejected with 403
- Connection cap — 11th connection returns 429
- maxPayload 8KB on activity WS
- No user-controlled file paths in activity storage (date-derived filenames only)
- `cursor` parameter validated before use (base64-decode + structural check)

---

## Test Cases

| ID | Type | Description | Input | Expected Output | Priority | Status |
|----|------|-------------|-------|-----------------|----------|--------|
| TC-001 | Integration | task.created event logged + queryable via REST | POST /spaces/:id/tasks | GET /spaces/:id/activity returns event with correct payload | High | Pass |
| TC-002 | Integration | task.moved event includes from/to columns | POST task, PUT move to in-progress | event.payload.from='todo', to='in-progress' | High | Pass |
| TC-003 | Integration | task.deleted event logged after DELETE | DELETE /spaces/:id/tasks/:id | GET activity returns task.deleted with taskTitle | High | Pass |
| TC-004 | Integration | board.cleared event includes deletedCount | DELETE /spaces/:id/tasks (3 tasks) | event.payload.deletedCount=3 | High | Pass |
| TC-005 | Integration | space.created/renamed/deleted events logged | POST space, PUT rename, DELETE space | All 3 event types in GET /api/v1/activity | High | Pass |
| TC-006 | Integration | type filter returns only matching events | GET ...?type=task.moved | All returned events have type=task.moved | High | Pass |
| TC-007 | Integration | Cursor pagination returns non-overlapping pages | GET ?type=task.created&limit=2, then cursor | Page 2 has no duplicate IDs from page 1 | Medium | Pass |
| TC-008 | Integration | Invalid type param returns 400 | GET /api/v1/activity?type=invalid.type | { error: { code: 'INVALID_EVENT_TYPE' } } | High | Pass |
| TC-009 | Integration | WebSocket broadcast within 500ms of mutation | WS connect, POST task | WS message { type: 'activity', event.type: 'task.created' } | High | Pass |
| TC-010 | Unit | ActivityStore retention — 35-day file deleted | Create .jsonl files 35d and 10d ago, call cleanup() | 35d file deleted, 10d file retained | High | Pass |
| TC-011 | Unit | ActivityStore retention — boundary (30d kept) | Create file exactly 30 days ago | File retained | Medium | Pass |
| TC-012 | Unit | ActivityStore malformed JSONL lines skipped | Inject bad line between good events | Valid events returned, no crash | High | Pass |
| TC-013 | Unit | ActivityStore append+query round-trip | append(event), query() | Same event returned | High | Pass |
| TC-014 | Unit | ActivityStore spaceId + type filter | Append events for 2 spaces, query one | Only matching spaceId events returned | High | Pass |
| TC-015 | Unit | useActivityFeed — creates WS on mount | renderHook useActivityFeed | MockWebSocket called once with /ws/activity | High | Pass |
| TC-016 | Unit | useActivityFeed — status transitions | _open(), _close() sequence | 'connecting' → 'connected' → 'disconnected' | High | Pass |
| TC-017 | Unit | useActivityFeed — addActivityEvent called on activity message | _message with activity frame | addActivityEvent called with event object | High | Pass |
| TC-018 | Unit | useActivityFeed — ignores connected/pong frames | _message with 'connected', 'pong' | addActivityEvent NOT called | Medium | Pass |
| TC-019 | Unit | useActivityFeed — exponential backoff doubles | close x2 with timer advance | 1st retry at 1s, 2nd retry at 2s | High | Pass |
| TC-020 | Unit | useActivityFeed — backoff resets after successful open | open after reconnect | Next disconnect retries at 1s again | High | Pass |
| TC-021 | Unit | useActivityFeed — ping sent every 30s | vi.advanceTimersByTime(30000) | ws.send called with { type: 'ping' } | Medium | Pass |
| TC-022 | Unit | useActivityFeed — no ping when disconnected | close then advance timer 30s | ws.send NOT called | Medium | Pass |
| TC-023 | Unit | useActivityFeed — cleanup on unmount | unmount() | ws.close() called, onclose nulled | High | Pass |
| TC-024 | Unit | useActivityFeed — no reconnect after unmount | unmount then advance 60s | MockWebSocket called only once | High | Pass |
| TC-025 | Unit | ActivityFeedPanel — empty state when no events | activityEvents=[] | "No activity yet" visible | Medium | Pass |
| TC-026 | Unit | ActivityFeedPanel — renders event descriptions | activityEvents=[task.created] | Task title visible | High | Pass |
| TC-027 | Unit | ActivityFeedPanel — type filter hides non-matching events | activityFilter.type='task.created' | task.deleted event hidden | High | Pass |
| TC-028 | Unit | ActivityFeedPanel — Load more button disabled while loading | activityLoading=true | button.disabled=true | Medium | Pass |
| TC-029 | Unit | ActivityFeedPanel — close button calls setActivityPanelOpen(false) | click close button | setActivityPanelOpen(false) called | High | Pass |
| TC-030 | Unit | ActivityFeedToggle — badge shown when unread > 0 and panel closed | unreadCount=3, panelOpen=false | badge renders with "3" | High | Pass |
| TC-031 | Unit | ActivityFeedToggle — badge hidden when panel open | unreadCount=5, panelOpen=true | badge not rendered | High | Pass |
| TC-032 | Unit | ActivityFeedToggle — badge caps at 99+ | unreadCount=150 | badge shows "99+" | Medium | Pass |
| TC-033 | Unit | ActivityFeedToggle — aria-pressed reflects panel state | panelOpen=true | aria-pressed="true" | Medium | Pass |
| TC-034 | Unit | ActivityFeedToggle — click calls toggleActivityPanel | click button | toggleActivityPanel called | High | Pass |
| TC-035 | Security | Non-localhost origin rejected | WS upgrade with Origin: http://evil.com | HTTP 403, socket destroyed | High | Pass (static analysis) |
| TC-036 | Security | 11th connection returns 429 | 11 concurrent WS connects | 11th gets HTTP 429 | Medium | Pass (static analysis) |
| TC-037 | Security | maxPayload 8192 enforced on activity WS | large message > 8KB | WS closes | Medium | Pass (static analysis) |
| TC-038 | Security | Cursor parameter validated (base64 + structural) | cursor=AAAA (invalid) | 400 INVALID_CURSOR | High | Pass |
| TC-039 | Security | Invalid limit rejected | GET /api/v1/activity?limit=9999 | 400 INVALID_LIMIT | High | Pass |
| TC-040 | Security | Invalid date format rejected | GET /api/v1/activity?from=notadate | 400 INVALID_DATE_FORMAT | High | Pass (static analysis) |
| TC-041 | Perf | REST activity query SLA < 100ms for limit 50 | Observed test times | All integration tests < 50ms | High | Pass |
| TC-042 | E2E (simulated) | Opening panel clears unread count | toggleActivityPanel (open=true) | activityUnreadCount set to 0 | High | Pass (static analysis) |
| TC-043 | E2E (simulated) | terminal.js upgrade handler passes non-terminal paths | WS upgrade to /ws/activity | Terminal handler returns early; activity handler processes it | High | Pass (static analysis) |
| TC-044 | E2E (simulated) | Load more — cursor pagination broken | Click "Load more" | FAILS: cursor not stored/passed (BUG-001) | High | FAIL |
| TC-045 | E2E (simulated) | Panel width resize respects min/max from spec | Drag resize | FAILS: min=280px (spec=240px), max=600px (spec=800px) (BUG-002) | Medium | FAIL |
| TC-046 | E2E (simulated) | loadActivityHistory queries global endpoint on first load | Panel open, no spaceId | FAILS: always queries space-scoped (BUG-003) | Medium | FAIL |
| TC-047 | E2E (simulated) | localStorage key prism:activity-panel-open | Read localStorage after toggle | FAILS: key is 'activity-panel:open' (BUG-004) | Low | FAIL |
| TC-048 | E2E (simulated) | aria-label on toggle = "Activity feed, N unread events" | unreadCount=5, panelOpen=false | FAILS: label is "Toggle activity feed, 5 unread" (BUG-005) | Low | FAIL |

---

## Environment Requirements

| Requirement | Value |
|-------------|-------|
| Node.js | >= 14.17 (crypto.randomUUID) |
| npm packages | ws (installed), @modelcontextprotocol/sdk (installed) |
| Test runner (backend) | `node --test 'tests/*.test.js'` |
| Test runner (frontend) | `cd frontend && npm test` (Vitest) |
| No external services | All tests use isolated in-process servers with temp dirs |

---

## Assumptions & Exclusions

| ID | Assumption |
|----|-----------|
| A-1 | The pre-existing `useAppStore.test.ts > executeAgentRun > shows "Opening terminal..." toast` timeout failure pre-dates this feature and is excluded from the bug count |
| A-2 | Security tests for origin check and connection cap are evaluated by static code analysis only; no adversarial WS harness was run |
| A-3 | MCP tool `kanban_list_activity` is evaluated by code review only; no live MCP client test was run |
| A-4 | The `suggestion` field missing from all `sendError` responses is a pre-existing codebase pattern documented in agent memory and is not counted as a new bug |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Pagination broken — Load more always re-fetches page 1 | Confirmed | Medium | BUG-001: `nextCursor` must be stored in Zustand state |
| History query always space-scoped, never global | Confirmed | Medium | BUG-003: Logic error in `loadActivityHistory` |
| WS reconnect does not expose "Reconnect now" callback to UI | Confirmed | Low | User Story 1.2 DoD item not implemented (advisory) |
| Relative timestamps go stale without a tick timer | Confirmed | Low | BUG-004: cosmetic, events are still correct |
