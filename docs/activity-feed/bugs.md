# Bug Report: Activity Feed Real-Time

**QA Cycle:** 2026-03-23
**QA Engineer:** qa-engineer-e2e
**Branch:** feature/activity-feed-realtime

---

## Summary

| ID | Severity | Type | Status |
|----|----------|------|--------|
| BUG-001 | Medium | Functional | Open |
| BUG-002 | Medium | Functional | Open |
| BUG-003 | Medium | Functional | Open |
| BUG-004 | Low | Functional | Open |
| BUG-005 | Low | UX | Open |

**Merge gate:** Zero unresolved Critical or High bugs required. No Critical or High bugs were found. The feature is **merge-eligible** once the team decides whether Medium/Low bugs should be addressed before shipping.

---

## BUG-001: "Load more" pagination is broken — nextCursor is never stored or used

- **Severity**: Medium
- **Type**: Functional
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

**Actual Behavior:**
`loadActivityHistory` receives the `result` from `api.getActivity()` and merges `result.events` into the store, but `result.nextCursor` is silently discarded. The Zustand store has no field for `nextCursor`. The "Load more" button always calls `loadActivityHistory()` with no cursor argument. Every click re-fetches page 1 and deduplication via `existingIds` means nothing new is appended after the first load.

**Root Cause Analysis:**
In `useAppStore.ts` line 894, after merging events:
```
set({ activityEvents: merged });
```
There is no `set({ activityNextCursor: result.nextCursor })`. The interface definition in `AppState` has no `activityNextCursor` field. The `ActivityFeedPanel` "Load more" button calls `loadActivityHistory()` with no argument, confirming the cursor is never threaded through.

**Proposed Fix:**
1. Add `activityNextCursor: string | null` to the `AppState` interface and initialise to `null`.
2. In `loadActivityHistory`, after merging, call `set({ activityEvents: merged, activityNextCursor: result.nextCursor })`.
3. In `ActivityFeedPanel`, retrieve `activityNextCursor` from the store and pass it to `loadActivityHistory(activityNextCursor ?? undefined)` on the "Load more" click.
4. Hide the "Load more" button (or show "No more events") when `activityNextCursor === null`.

---

## BUG-002: Panel resize min/max width deviates from user story specification

- **Severity**: Medium
- **Type**: Functional
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

**Actual Behavior:**
`usePanelResize` is called with `minWidth: 280, maxWidth: 600`. The panel cannot be resized below 280px (40px wider than spec) or above 600px (200px narrower than spec).

**Root Cause Analysis:**
In `ActivityFeedPanel.tsx` lines 178–183:
```tsx
const { width, handleMouseDown, minWidth, maxWidth } = usePanelResize({
  storageKey:   'prism:panel-width:activity',
  defaultWidth: 360,
  minWidth:     280,   // spec: 240
  maxWidth:     600,   // spec: 800
});
```
The `defaultWidth: 360` is correct. Only `minWidth` and `maxWidth` deviate.

**Proposed Fix:**
Change `minWidth: 280` to `minWidth: 240` and `maxWidth: 600` to `maxWidth: 800` in the `usePanelResize` call inside `ActivityFeedPanel.tsx`.

---

## BUG-003: loadActivityHistory always queries space-scoped endpoint, never global

- **Severity**: Medium
- **Type**: Functional
- **Component**: `frontend/src/stores/useAppStore.ts` — `loadActivityHistory` action
- **Related Test**: TC-046
- **Related User Story**: Story 2.1 DoD: "loadActivityHistory() calls getGlobalActivity({ limit: 50 })"

**Reproduction Steps:**
1. Ensure `activeSpaceId` is set (it defaults to `'default'` on first load).
2. Open the Activity Feed panel or call `loadActivityHistory()`.
3. Observe network tab: request goes to `/api/v1/spaces/default/activity`, not `/api/v1/activity`.

**Expected Behavior:**
Per Story 2.1 DoD: on first load, history is fetched via `GET /api/v1/activity?limit=50` (global endpoint, no space filter), so events from all spaces appear.

**Actual Behavior:**
`loadActivityHistory` in `useAppStore.ts` lines 886–888:
```ts
const result = activeSpaceId
  ? await api.getActivity(activeSpaceId, params)
  : await api.getGlobalActivity(params);
```
Because `activeSpaceId` is always a non-empty string (initialised from `localStorage.getItem(ACTIVE_SPACE_KEY) || 'default'`), the ternary always evaluates the truthy branch. `getGlobalActivity` is never called.

**Root Cause Analysis:**
The fallback branch `await api.getGlobalActivity(params)` is unreachable. The intent of Story 2.1 is to show global (all-spaces) history in the panel. If users want space-scoped history they would use the date-range filter chips described in Story 3.2. The current implementation permanently scopes history to the active space, which contradicts the spec.

**Proposed Fix:**
Replace the conditional with an unconditional call to `getGlobalActivity`. If per-space filtering is desired in a future iteration, it should be a UI-controlled filter, not hard-coded to the active space. Alternatively, add an explicit `useGlobalActivity: boolean` flag to the filter to make the intent clear.

---

## BUG-004: localStorage key for activity panel open state does not match specification

- **Severity**: Low
- **Type**: Functional
- **Component**: `frontend/src/stores/useAppStore.ts` — `ACTIVITY_OPEN_KEY` constant
- **Related Test**: TC-047
- **Related User Story**: Story 4.1 DoD: "localStorage key `prism:activity-panel-open`"

**Reproduction Steps:**
1. Open the Activity Feed panel so it persists across reload.
2. Open browser DevTools > Application > Local Storage.
3. Observe the key name used to store the panel open state.

**Expected Behavior:**
Key name: `prism:activity-panel-open` (from Story 4.1 DoD)

**Actual Behavior:**
Key name: `activity-panel:open` (from `ACTIVITY_OPEN_KEY` constant at line 37 of `useAppStore.ts`)

**Root Cause Analysis:**
The constant at line 37:
```ts
const ACTIVITY_OPEN_KEY = 'activity-panel:open';
```
does not match the user story specification. This is a copy-paste pattern from the existing `CONFIG_OPEN_KEY = 'config-panel:open'`, which also uses the inverted key format. The Prism project uses `prism:` prefix for some keys (e.g., `prism:panel-width:activity`) but not others (e.g., `terminal:open`). The mismatch means existing persisted state (if any) would be silently ignored if the key is corrected mid-deployment.

**Proposed Fix:**
Change `ACTIVITY_OPEN_KEY` to `'prism:activity-panel-open'`. Note: if users have already loaded the app with the incorrect key, their panel preference will be lost on the next load (one-time migration). For a local dev tool this is acceptable.

---

## BUG-005: Activity toggle aria-label format does not match user story specification

- **Severity**: Low
- **Type**: UX / Accessibility
- **Component**: `frontend/src/components/activity/ActivityFeedToggle.tsx` — `aria-label` prop
- **Related Test**: TC-048
- **Related User Story**: Story 1.3 DoD: "`aria-label` on the toggle button is updated dynamically: 'Activity feed, N unread events'"

**Reproduction Steps:**
1. Close the Activity Feed panel.
2. Trigger any board mutation to generate an unread event.
3. Inspect the toggle button's `aria-label` attribute with a screen reader or DevTools.

**Expected Behavior:**
`aria-label="Activity feed, 1 unread events"` (spec format)

**Actual Behavior:**
`aria-label="Toggle activity feed, 1 unread"` — when `showBadge` is true.
`aria-label="Toggle activity feed"` — when no unread events.

**Root Cause Analysis:**
In `ActivityFeedToggle.tsx` line 33:
```tsx
aria-label={`Toggle activity feed${showBadge ? `, ${unreadCount} unread` : ''}`}
```
The label uses "Toggle activity feed" prefix instead of "Activity feed", and appends "N unread" instead of "N unread events". Additionally, when `showBadge` is false, no unread count is included at all (the spec implies the base label should always be "Activity feed").

**Proposed Fix:**
Update the `aria-label` template string to:
```tsx
aria-label={`Activity feed${showBadge ? `, ${unreadCount} unread events` : ''}`}
```
This matches the spec format exactly and provides a cleaner accessible name.

---

## Advisory Notes (Not Bugs)

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
