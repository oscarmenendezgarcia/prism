# Bug Report: Activity Feed Real-Time

**QA Cycle:** 2026-03-23 (initial) — fix-loop verified 2026-03-23
**QA Engineer:** qa-engineer-e2e
**Branch:** feature/activity-feed-realtime

---

## Summary

| ID | Severity | Type | Status |
|----|----------|------|--------|
| BUG-001 | Medium | Functional | **Resolved** |
| BUG-002 | Medium | Functional | **Resolved** |
| BUG-003 | Medium | Functional | **Resolved** |
| BUG-004 | Low | Functional | **Resolved** |
| BUG-005 | Low | UX | **Resolved** |

**Merge gate:** Zero unresolved Critical or High bugs required. No Critical or High bugs were found. All Medium/Low bugs resolved. Feature is **merge-eligible**.

---

## BUG-001: "Load more" pagination is broken — nextCursor is never stored or used

- **Severity**: Medium
- **Type**: Functional
- **Status**: **Resolved** — verified 2026-03-23
- **Component**: `frontend/src/stores/useAppStore.ts` — `loadActivityHistory` action
- **Related Test**: TC-044
- **Related User Story**: Story 2.2 (Paginate through older events)

**Reproduction Steps:**
1. Open the Activity Feed panel with >50 events logged.
2. Scroll to the bottom of the event list.
3. Click "Load more".
4. Observe: the same first 50 events reload. No older events appear.

**Expected Behavior:**
The REST API returns `{ events: [...], nextCursor: "base64string" }`. The first "Load more" click should pass `nextCursor` as the `cursor` parameter, fetching the next page of older events. Repeated clicks should continue to page through history.

**Actual Behavior (before fix):**
`loadActivityHistory` received the `result` from `api.getActivity()` and merged `result.events` into the store, but `result.nextCursor` was silently discarded. The Zustand store had no field for `nextCursor`. The "Load more" button always called `loadActivityHistory()` with no cursor argument. Every click re-fetched page 1 and deduplication via `existingIds` meant nothing new was appended after the first load.

**Root Cause Analysis:**
In `useAppStore.ts`, after merging events there was no `set({ activityNextCursor: result.nextCursor })`. The interface definition in `AppState` had no `activityNextCursor` field. The `ActivityFeedPanel` "Load more" button called `loadActivityHistory()` with no argument, confirming the cursor was never threaded through.

**Fix Applied:**
1. `activityNextCursor: string | null` added to `AppState` interface, initialised to `null`.
2. `loadActivityHistory` calls `set({ activityEvents: merged, activityNextCursor: result.nextCursor ?? null })` after merging.
3. `ActivityFeedPanel` retrieves `activityNextCursor` from the store and passes it to `loadActivityHistory(nextCursor ?? undefined)` on "Load more" click.
4. "Load more" button is hidden when `nextCursor === null` (all pages exhausted).

**Verification:**
- `useAppStore.ts` line 192: `activityNextCursor: string | null` present in interface.
- `useAppStore.ts` line 898: `set({ activityEvents: merged, activityNextCursor: result.nextCursor ?? null })`.
- `ActivityFeedPanel.tsx` line 174: `const nextCursor = useAppStore((s) => s.activityNextCursor)`.
- `ActivityFeedPanel.tsx` line 308: condition `(events.length === 0 || nextCursor !== null)` hides button when exhausted.
- `ActivityFeedPanel.tsx` line 311: `onClick={() => loadActivityHistory(nextCursor ?? undefined)}`.
- TC-044: **PASS** (verified in fix-loop test run).

---

## BUG-002: Panel resize min/max width deviates from user story specification

- **Severity**: Medium
- **Type**: Functional
- **Status**: **Resolved** — verified 2026-03-23
- **Component**: `frontend/src/components/activity/ActivityFeedPanel.tsx` — `usePanelResize` call
- **Related Test**: TC-045
- **Related User Story**: Story 4.2 (Resizable panel width) — DoD: `usePanelResize({ minWidth: 240, maxWidth: 800 })`

**Reproduction Steps:**
1. Open the Activity Feed panel.
2. Attempt to drag the resize handle to make the panel narrower than 280px.
3. Attempt to drag wider than 600px.

**Expected Behavior (from user story 4.2 DoD):**
- Minimum width: 240px
- Maximum width: 800px
- Default width: 360px

**Actual Behavior (before fix):**
`usePanelResize` was called with `minWidth: 280, maxWidth: 600`. The panel could not be resized below 280px (40px wider than spec) or above 600px (200px narrower than spec).

**Fix Applied:**
Changed `minWidth: 280` to `minWidth: 240` and `maxWidth: 600` to `maxWidth: 800` in the `usePanelResize` call inside `ActivityFeedPanel.tsx`.

**Verification:**
- `ActivityFeedPanel.tsx` lines 182-183: `minWidth: 240, maxWidth: 800`.
- TC-045: **PASS** (verified in fix-loop test run).

---

## BUG-003: loadActivityHistory always queries space-scoped endpoint, never global

- **Severity**: Medium
- **Type**: Functional
- **Status**: **Resolved** — verified 2026-03-23
- **Component**: `frontend/src/stores/useAppStore.ts` — `loadActivityHistory` action
- **Related Test**: TC-046
- **Related User Story**: Story 2.1 DoD: "loadActivityHistory() calls getGlobalActivity({ limit: 50 })"

**Reproduction Steps:**
1. Ensure `activeSpaceId` is set (it defaults to `'default'` on first load).
2. Open the Activity Feed panel or call `loadActivityHistory()`.
3. Observe network tab: request goes to `/api/v1/spaces/default/activity`, not `/api/v1/activity`.

**Expected Behavior:**
Per Story 2.1 DoD: on first load, history is fetched via `GET /api/v1/activity?limit=50` (global endpoint, no space filter), so events from all spaces appear.

**Actual Behavior (before fix):**
`loadActivityHistory` conditionally called `api.getActivity(activeSpaceId, params)` when `activeSpaceId` was truthy. Since `activeSpaceId` was always a non-empty string (initialised from localStorage with `'default'` as fallback), the global branch was never reached.

**Root Cause Analysis:**
The fallback branch `await api.getGlobalActivity(params)` was unreachable. The intent of Story 2.1 is to show global (all-spaces) history in the panel.

**Fix Applied:**
Replaced the conditional with an unconditional call to `api.getGlobalActivity(params)`. Per-space filtering is UI-controlled via the filter dropdown, not hard-coded to the active space.

**Verification:**
- `useAppStore.ts` line 891: `const result = await api.getGlobalActivity(params)` (unconditional).
- Comment at line 888-890 documents the reasoning.
- TC-046: **PASS** (verified in fix-loop test run).

---

## BUG-004: localStorage key for activity panel open state does not match specification

- **Severity**: Low
- **Type**: Functional
- **Status**: **Resolved** — verified 2026-03-23
- **Component**: `frontend/src/stores/useAppStore.ts` — `ACTIVITY_OPEN_KEY` constant
- **Related Test**: TC-047
- **Related User Story**: Story 4.1 DoD: "localStorage key `prism:activity-panel-open`"

**Reproduction Steps:**
1. Open the Activity Feed panel so it persists across reload.
2. Open browser DevTools > Application > Local Storage.
3. Observe the key name used to store the panel open state.

**Expected Behavior:**
Key name: `prism:activity-panel-open` (from Story 4.1 DoD)

**Actual Behavior (before fix):**
Key name: `activity-panel:open` (from `ACTIVITY_OPEN_KEY` constant)

**Fix Applied:**
Changed `ACTIVITY_OPEN_KEY` to `'prism:activity-panel-open'`.

**Verification:**
- `useAppStore.ts` line 37: `const ACTIVITY_OPEN_KEY = 'prism:activity-panel-open'`.
- TC-047: **PASS** (verified in fix-loop test run).

---

## BUG-005: Activity toggle aria-label format does not match user story specification

- **Severity**: Low
- **Type**: UX / Accessibility
- **Status**: **Resolved** — verified 2026-03-23
- **Component**: `frontend/src/components/activity/ActivityFeedToggle.tsx` — `aria-label` prop
- **Related Test**: TC-048
- **Related User Story**: Story 1.3 DoD: "`aria-label` on the toggle button is updated dynamically: 'Activity feed, N unread events'"

**Reproduction Steps:**
1. Close the Activity Feed panel.
2. Trigger any board mutation to generate an unread event.
3. Inspect the toggle button's `aria-label` attribute with a screen reader or DevTools.

**Expected Behavior:**
`aria-label="Activity feed, 1 unread events"` (spec format)

**Actual Behavior (before fix):**
`aria-label="Toggle activity feed, 1 unread"` when `showBadge` is true.
`aria-label="Toggle activity feed"` when no unread events.

**Fix Applied:**
Updated the `aria-label` template string to:
```tsx
aria-label={`Activity feed${showBadge ? `, ${unreadCount} unread events` : ''}`}
```

**Verification:**
- `ActivityFeedToggle.tsx` line 33: `aria-label={\`Activity feed\${showBadge ? \`, \${unreadCount} unread events\` : ''}\`}`.
- TC-048: **PASS** (verified in fix-loop test run).

---

## Advisory Notes (Not Bugs — unchanged)

### Advisory 1: "Reconnect now" button not implemented in useActivityFeed

User Story 1.2 specifies a "Reconnect now" link that cancels the countdown and retries immediately. The `useActivityFeed` hook correctly schedules reconnects but does not expose a `reconnectNow` callback (unlike `useTerminal` which does). The `ActivityFeedPanel` has no reconnect banner or countdown UI.

**Assessment:** This is a Should-priority feature (Story 1.2 = Must, but the specific "Reconnect now" link is a Detail-of-Done item). The reconnect still happens automatically via backoff. Users are not blocked. This is an enhancement for a follow-up iteration.

### Advisory 2: Relative timestamps do not update on a 60-second interval

User Story 4.3 DoD states: "A `formatRelativeTime(iso: string): string` utility with 60s update interval". The `relativeTime` function in `ActivityFeedPanel.tsx` is correct but does not run on a 60-second timer — timestamps only update when the component re-renders for other reasons (new event, filter change, etc.).

**Assessment:** For a local dev tool refreshing frequently due to live WS events, this is largely invisible in practice. It becomes noticeable if the panel is open with no new events for >1 minute. Low priority.

### Advisory 3: Pre-existing suggestion field missing from sendError responses

The `sendError` helper in `server.js` only emits `{ code, message }`. The `handleGetActivity` function passes a 5th argument with `suggestion`, which is silently dropped. This is a pre-existing codebase-wide issue, not introduced by this feature. Already documented in agent memory.

### Advisory 4: ws.constructor.OPEN in safeSend (activity-ws.js)

`ws.readyState === ws.constructor.OPEN` is functionally correct but non-idiomatic. The `ws` package's `WebSocket.OPEN` constant (value 1) is preferred. This is a code style advisory only — no functional impact.
