# User Stories: Activity Feed Real-Time — Prism Kanban

## Personas

**Developer / Solo operator:** The only user of this local kanban tool. Technical profile. Uses Prism to track tasks across personal projects and agent pipeline stages. Pain point: "I don't know what changed while I was away from the board." Comfort with technical labels (task.moved, in-progress) — no need to hide them.

---

## Epics

### Epic 1 — Real-Time Event Streaming

#### Story 1.1 — Live event delivery
As a developer, I want new board events to appear in the Activity Feed panel within 1 second of the mutation, so that I have instant confidence that my actions registered.

**Acceptance Criteria:**
- Creating a task produces a `task.created` event card in the panel within 200 ms (p95)
- Moving a task produces a `task.moved` event card with the correct `from` and `to` columns
- Updating a task produces a `task.updated` event card listing the changed fields
- Deleting a task produces a `task.deleted` event card with the task title
- Clearing the board produces a `board.cleared` event card showing the deleted count
- Creating, renaming, or deleting a space produces the corresponding `space.*` event card
- Events arrive via WebSocket (`/ws/activity`) without requiring a page reload
- Event cards appear at the top of the list (newest-first)

**Definition of Done:**
- `useActivityFeed` hook successfully connects to `/ws/activity`
- Incoming `activity` WS messages are parsed and dispatched via `addActivityEvent`
- `ActivityFeedPanel` re-renders to show the new card within the browser repaint cycle
- Integration test confirms WS broadcast within 500 ms of mutation

**Priority:** Must
**Story Points:** 8 (covers T-003, T-005, T-012, T-016)

---

#### Story 1.2 — Automatic WebSocket reconnection
As a developer, I want the Activity Feed to automatically reconnect if the WebSocket drops, so that I don't have to reload the page to resume receiving events.

**Acceptance Criteria:**
- On WS disconnect, status dot turns red and label reads "Disconnected"
- A reconnect bar appears with countdown: "Reconnecting in Ns..."
- A "Reconnect now" link cancels the countdown and retries immediately
- Reconnect backoff sequence: 1s → 2s → 4s → 8s → 16s → 30s (cap)
- On successful reconnect, status dot turns green, reconnect bar disappears, event list restores to 100% opacity
- Backoff counter resets to 1s after each successful connection
- During reconnect, event list is shown at 60% opacity with "Events may be outdated" amber banner
- Filters remain applied across reconnects (no filter reset)

**Definition of Done:**
- `useActivityFeed` implements backoff with `useRef`-based timer
- "Reconnect now" exposed as a callback, wired to the reconnect bar button
- Unit tests verify: disconnect → backoff states → reconnect → reset

**Priority:** Must
**Story Points:** 5 (covers T-012)

---

#### Story 1.3 — Unread event badge
As a developer, I want to see how many new events arrived while the Activity Feed panel was closed, so that I know whether to open the panel without having to open it first.

**Acceptance Criteria:**
- A red badge on the notifications icon in the header shows the unread count
- Badge is hidden when `activityUnreadCount === 0`
- Badge is hidden when the panel is open (opening the panel implicitly acknowledges events)
- Badge shows "99+" when the count exceeds 99
- Opening the panel calls `clearActivityUnread()`, resetting the count to 0
- `activityUnreadCount` increments only while the panel is closed
- `aria-label` on the toggle button is updated dynamically: "Activity feed, N unread events"

**Definition of Done:**
- `addActivityEvent` in Zustand store increments `activityUnreadCount` only when `activityPanelOpen === false`
- `setActivityPanelOpen(true)` calls `clearActivityUnread()`
- Badge renders with `min-width: 14px`, `height: 14px`, `font-size: 10px`, positioned top-right of button
- Badge caps display at "99+"

**Priority:** Must
**Story Points:** 3 (covers T-011, T-015)

---

### Epic 2 — Historical Event Browsing

#### Story 2.1 — View recent event history on panel open
As a developer, I want the Activity Feed panel to load recent events when I first open it, so that I can see what happened before I connected this session.

**Acceptance Criteria:**
- On panel open, if `activityEvents` is empty, `loadActivityHistory()` is called automatically
- A loading skeleton state (4 shimmer cards) is shown while the API request is in flight
- History is fetched via `GET /api/v1/activity?limit=50` (global, no space filter)
- API errors show a non-blocking inline error message with a "Retry" button
- Loaded history events are prepended by live WS events as they arrive (no duplicates)
- If `activityEvents` already has items (from a previous open), no re-fetch occurs

**Definition of Done:**
- `loadActivityHistory()` calls `getGlobalActivity({ limit: 50 })`
- `activityLoading` state drives the skeleton cards render
- Deduplication: events are keyed by `id`; duplicates are silently dropped
- Test: panel opens → loading state → events appear → no duplicate IDs

**Priority:** Must
**Story Points:** 5 (covers T-010, T-011, T-014)

---

#### Story 2.2 — Paginate through older events
As a developer, I want to load older activity events beyond the initial 50, so that I can investigate what happened earlier in the day or week.

**Acceptance Criteria:**
- A "Load more" button is shown at the bottom of the event list when `nextCursor !== null`
- Clicking "Load more" appends older events below the current list
- During load, the button shows "Loading..." and is disabled (no double-click)
- When all events are loaded, "Load more" is replaced with "No more events" (muted text)
- The in-memory event buffer caps at 500 events; oldest are dropped from the top when exceeded

**Definition of Done:**
- `loadActivityHistory(cursor)` accepts an optional cursor and merges results into the store
- `nextCursor` from the API response is stored and passed on the next call
- "Load more" button `aria-busy="true"` while fetching
- Store enforces 500-event max via splice

**Priority:** Should
**Story Points:** 3 (covers T-010, T-011, T-014)

---

### Epic 3 — Filtering

#### Story 3.1 — Filter by event type
As a developer, I want to filter the Activity Feed by event type (e.g., show only `task.moved`), so that I can focus on a specific category of changes.

**Acceptance Criteria:**
- A "Type" dropdown shows all 8 event types plus "All types" (default)
- Selecting a type filters the displayed list client-side (no API call for type filtering)
- An active filter is visually indicated: select has a blue ring (`ring-1 ring-primary`)
- A clear `[×]` button appears next to the select when a type is active
- Clicking `[×]` resets the type filter to "All types"
- A filter banner appears: "N of M events — filters active" (amber tint)
- The type filter is case-insensitive and exact-match

**Definition of Done:**
- `activityFilter.type` in Zustand store drives the rendered list via selector
- Filter is applied in the component, not in the API call (client-side filtering as per blueprint)
- "All types" selection sets `activityFilter.type` to `undefined`
- Test: select type → list shows only matching events → clear → all events return

**Priority:** Must
**Story Points:** 3 (covers T-011, T-014)

---

#### Story 3.2 — Filter by date range
As a developer, I want to filter the Activity Feed to a specific time window (Today / 7 days / 30 days), so that I can narrow down events to a relevant period.

**Acceptance Criteria:**
- Three date range chips: "Today", "7d", "30d"
- Default selection: "30d" (matches the default API `from` parameter)
- Active chip has solid blue background + white text; inactive chips are ghost/outlined
- Selecting a chip sets `activityFilter.from` and triggers `loadActivityHistory()` to fetch matching history
- Changing the date range clears the current event list and re-fetches from the API (not client-side filtering of in-memory events)
- The active chip is persisted across panel close/open within the same session

**Definition of Done:**
- Date chip click calls `setActivityFilter({ from: <computed ISO date> })` and then `loadActivityHistory()`
- Previous events are cleared from store before new fetch to avoid stale mixing
- Test: click "Today" → events reload → only today's events shown

**Priority:** Should
**Story Points:** 3 (covers T-011, T-014)

---

### Epic 4 — Panel UI & Integration

#### Story 4.1 — Open and close the Activity Feed panel
As a developer, I want to open and close the Activity Feed panel with a single click on the header icon, so that I can toggle visibility without disrupting my board view.

**Acceptance Criteria:**
- Clicking the notifications icon in the header toggles `activityPanelOpen`
- The panel opens as a right-side sidebar (`<aside>`) in the flex layout
- The board area shrinks to accommodate the panel (no overlap)
- The panel can be closed via the close button inside the panel header
- The panel's open/closed state is persisted in localStorage (`prism:activity-panel-open`)
- The notifications icon uses `notifications` (outlined) when panel is closed, and a visually active/filled state when open
- Opening and closing the panel does not disconnect the WebSocket

**Definition of Done:**
- `activityPanelOpen` drives conditional render in `App.tsx`
- WS hook (`useActivityFeed`) is mounted in `AppContent`, not inside the panel, so it stays alive regardless of panel visibility
- Panel renders in the flex row after `ConfigPanel` / `AgentSettingsPanel`
- localStorage key `prism:activity-panel-open` initialized on first load

**Priority:** Must
**Story Points:** 3 (covers T-015, T-016)

---

#### Story 4.2 — Resizable panel width
As a developer, I want to drag the left edge of the Activity Feed panel to adjust its width, so that I can balance screen space between the board and the feed.

**Acceptance Criteria:**
- A 4px drag handle is visible on the left edge of the panel (`cursor: col-resize`)
- Dragging resizes the panel between 240px (min) and 800px (max)
- Width is persisted in localStorage (`prism:panel-width:activity`)
- Default width: 360px
- Drag handle has correct ARIA attributes: `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`

**Definition of Done:**
- `usePanelResize({ storageKey: 'prism:panel-width:activity', defaultWidth: 360, minWidth: 240, maxWidth: 800 })` used in `ActivityFeedPanel`
- Panel `aside` uses `style={{ '--panel-w': width + 'px' }}` + `w-[var(--panel-w)]` class (matching TerminalPanel pattern)
- Resize does not cause layout jank (no full re-render of the board during drag)

**Priority:** Should
**Story Points:** 2 (covers T-014)

---

#### Story 4.3 — Human-readable event descriptions
As a developer, I want each activity event to display a clear, human-readable description with relevant context, so that I can understand what happened at a glance without decoding internal data structures.

**Acceptance Criteria:**
- `task.created`: "**{taskTitle}** created in {column}"
- `task.moved`: "**{taskTitle}** moved {from} → {to}"
- `task.updated`: "**{taskTitle}** updated" (+ badge listing fields if `payload.fields` present)
- `task.deleted`: "**{taskTitle}** deleted"
- `space.created`: "Space **{spaceName}** created"
- `space.renamed`: "Space renamed to **{spaceName}**"
- `space.deleted`: "Space **{spaceName}** deleted"
- `board.cleared`: "Board cleared ({deletedCount} tasks removed)"
- Each card shows: icon (per type), description, space name, and relative timestamp ("2m ago", "1h ago", "2d ago")
- Relative timestamps update every 60 seconds without re-fetching

**Definition of Done:**
- A pure `formatEventDescription(event: ActivityEvent): string` utility function
- A `formatRelativeTime(iso: string): string` utility with 60s update interval
- Each event type has a corresponding icon + color (per icon mapping in wireframes)
- Test: utility function covers all 8 event types with correct output

**Priority:** Must
**Story Points:** 3 (covers T-014)

---

### Epic 5 — Backend Infrastructure

#### Story 5.1 — Persist all mutation events to JSONL
As a developer, I want every board mutation to be automatically logged to disk, so that the history is available after a page reload or server restart.

**Acceptance Criteria:**
- Every task create/move/update/delete triggers a JSONL append in `data/activity/YYYY-MM-DD.jsonl`
- Every space create/rename/delete triggers a JSONL append
- Every board clear triggers a JSONL append with the deleted count
- The append is fire-and-forget: mutations still succeed even if logging fails
- Malformed JSONL lines are skipped during queries (no crash)
- `data/activity/` directory is created automatically on server start

**Definition of Done:**
- `ActivityStore.append(event)` writes one line to the correct day file
- `ActivityLogger.log()` wraps append + broadcast in a try/catch; errors are `console.warn`-ed
- `createApp()` accepts `{ logger }` parameter; all mutation handlers call `logger.log()` after `sendJSON()`
- Existing API response shapes unchanged (verified by existing test suite passing)

**Priority:** Must
**Story Points:** 9 (covers T-001, T-002, T-005, T-006)

---

#### Story 5.2 — 30-day automatic log retention
As a developer, I want old activity logs to be automatically deleted after 30 days, so that disk usage does not grow unboundedly.

**Acceptance Criteria:**
- At server startup, JSONL files older than 30 days in `data/activity/` are deleted
- The cleanup runs again every 24 hours via `setInterval`
- File date is derived from the filename (`YYYY-MM-DD.jsonl`), not file metadata
- Number of files deleted is logged as structured JSON
- If no files need deletion, no error is thrown

**Definition of Done:**
- `ActivityStore.cleanup()` implements the retention logic
- Test: create files dated 35 days ago and 10 days ago → cleanup → 35-day file deleted, 10-day file retained

**Priority:** Must
**Story Points:** 2 (covers T-001, T-019)

---

#### Story 5.3 — MCP tool for querying activity history
As an agent (programmatic consumer), I want a `kanban_list_activity` MCP tool, so that I can query the activity log from automation scripts without using the HTTP API directly.

**Acceptance Criteria:**
- Tool name: `kanban_list_activity`
- Parameters: `spaceId` (optional string), `type` (optional, one of the 8 event types), `limit` (optional integer, default 20)
- When `spaceId` is provided, calls `GET /api/v1/spaces/{spaceId}/activity`
- When `spaceId` is omitted, calls `GET /api/v1/activity`
- Returns a formatted list of events (id, type, timestamp, description)
- Tool description matches naming conventions of existing tools (`kanban_list_tasks`, `kanban_move_task`, etc.)

**Definition of Done:**
- Tool registered in `mcp/mcp-server.js`
- Tool description accurate and complete
- Manual test via MCP client confirms tool returns events

**Priority:** Could
**Story Points:** 2 (covers T-008)

---

## Design Assumptions

| ID   | Assumption | Impact if wrong |
|------|-----------|-----------------|
| A-13 | Activity Feed shows global events (all spaces) by default; no per-space panel scoping | If per-space is required, filter bar needs a "Space" selector; API call changes to space-scoped endpoint |
| A-14 | Event cards are read-only in Phase 1; clicking a card does nothing | If "click to navigate to task" is needed, requires board focus API (out of scope for Phase 1) |
| A-15 | Unread count resets on page reload (not persisted) | If persistence is required, need localStorage cursor or server-side "last-seen" timestamp |
| A-16 | Date range filter chips trigger a new API fetch (not client-side filter of in-memory events) | If client-side filtering is preferred, the in-memory buffer must hold the full 30-day history (too large) |
| A-17 | Filter state resets on page reload | If persistence is required, save to localStorage |
