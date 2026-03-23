# ADR-1: Real-Time Activity Feed via WebSocket + JSONL Persistence

## Status

Accepted

## Context

Prism is a local kanban dev tool. Users want visibility into what happened on their board -- task moves, creations, deletions, space changes -- presented as a live feed. Today, board state is refreshed via polling (`usePolling.ts` at 1-3s intervals), but there is no event history and no way to see *what changed* versus just *current state*.

The feature must:
- Push events to all connected browsers in real time (< 200 ms).
- Persist history for at least 30 days.
- Support filtering by space, event type, and date range.
- Integrate into the existing single-process Node.js server without adding databases or message brokers.

Three key trade-offs were evaluated:

### Trade-off 1: Push Mechanism -- WebSocket vs Server-Sent Events (SSE) vs Enhanced Polling

**Option A: WebSocket (dedicated /ws/activity endpoint)**
- Pros: True bidirectional channel (future-proof for client commands like "mark read"), sub-50ms delivery, `ws` npm package already installed and proven in terminal.js, consistent infrastructure pattern.
- Cons: One more upgrade handler on port 3000; requires fixing terminal.js to not destroy unknown upgrade paths.

**Option B: Server-Sent Events (SSE)**
- Pros: Simpler protocol (HTTP-based, no upgrade), built-in browser reconnect, no extra npm dependency.
- Cons: Unidirectional (server-to-client only), no existing SSE infrastructure in Prism, would be a second real-time pattern alongside WS (inconsistency), potential issues with HTTP/1.1 connection limits in some browsers.

**Option C: Enhanced polling (piggyback events on loadBoard response)**
- Pros: Zero new infrastructure; events returned alongside task data.
- Cons: Latency tied to poll interval (1-3s), increased response payload size, cannot work when panel is open but board is not polling, inelegant coupling.

**Recommendation: Option A (WebSocket).** The `ws` package is already a dependency, the `noServer` + upgrade-handler pattern is proven in `terminal.js`, and consistency across real-time features reduces cognitive load. The terminal.js fix is a one-line change.

### Trade-off 2: Persistence Format -- JSONL (append-only) vs SQLite vs In-Memory with Snapshot

**Option A: JSONL files (one per day)**
- Pros: Append-only writes (no read-modify-write), trivial retention (delete old files), zero new dependencies, human-readable, consistent with Prism's JSON flat-file philosophy.
- Cons: Queries require reading and parsing files line by line (acceptable for local tool scale), no indexing.

**Option B: SQLite**
- Pros: Indexed queries, SQL filtering, proven embedded database, single-file storage.
- Cons: New native dependency (`better-sqlite3`), breaks the KISS/no-database constraint, build complexity (native addon like node-pty), overkill for a local tool with < 1000 events/day.

**Option C: In-memory ring buffer with periodic snapshot**
- Pros: Fastest queries (array scan in memory), simple implementation.
- Cons: Data lost on server restart unless snapshot is loaded, memory growth concerns over 30 days, snapshot format becomes another file to manage.

**Recommendation: Option A (JSONL).** Aligns with Prism's flat-file persistence model. Day-partitioned files make retention trivial (`rm` files > 30 days old). Query performance is adequate -- even 10,000 lines/day parses in < 50 ms on modern hardware. No new dependencies.

### Trade-off 3: UI Placement -- Sidebar Panel vs Dedicated Page vs Inline Notifications

**Option A: Sidebar panel (like TerminalPanel / ConfigPanel)**
- Pros: Consistent with existing panel pattern (terminal, config editor, agent settings), can be open alongside the board, toggle button in header.
- Cons: Screen real estate shared with other panels; only one panel should be open at a time for usability.

**Option B: Dedicated route/page**
- Pros: Full screen for activity history, no real estate conflict.
- Cons: Prism has no client-side routing today (single-page, no React Router), would require adding routing infrastructure, context-switches user away from the board.

**Option C: Inline notifications (toast-like popups)**
- Pros: Non-intrusive, no panel needed.
- Cons: Ephemeral -- cannot browse history, no filtering, toasts already used for mutation confirmations (collision).

**Recommendation: Option A (Sidebar panel).** Matches the established panel pattern (TerminalPanel, ConfigPanel, AgentSettingsPanel). Uses `usePanelResize` hook for drag-resize. Toggle via header icon button with unread badge. Panel can coexist with board view. Mutually exclusive with other panels is not required -- the flex layout already handles multiple open panels gracefully.

## Decision

Implement the Activity Feed as:
1. A **WebSocket endpoint** at `/ws/activity` using the existing `ws` npm package in `noServer` mode, following the same pattern as `terminal.js`.
2. **JSONL flat-file persistence** partitioned by day in `data/activity/`, with 30-day automatic retention.
3. A **REST endpoint** `GET /api/v1/spaces/:spaceId/activity` (and `GET /api/v1/activity` global) for paginated historical queries.
4. An **ActivityLogger** module injected into mutation handlers via dependency injection (parameter to `createApp`), called after the HTTP response is sent (fire-and-forget).
5. A **sidebar panel** (`ActivityFeedPanel`) toggled from the header, with type/date filters and live-updating event list.
6. Fix `terminal.js` upgrade handler to pass through non-terminal upgrade paths instead of destroying them.

## Rationale

- **Consistency:** WebSocket + `ws` noServer pattern is already proven. Sidebar panel matches existing UI patterns.
- **KISS:** No new runtime dependencies. JSONL is the simplest append-only format. Day-partitioned files make retention a file-delete operation.
- **Decoupled:** ActivityLogger is fire-and-forget -- mutation handlers do not wait for logging. If logging fails, the mutation still succeeds.
- **Future-proof:** WebSocket is bidirectional, enabling future features like "mark as read" or "subscribe to specific spaces" without protocol changes.

## Consequences

### Positive
- Users gain full visibility into board changes across all spaces.
- Real-time push eliminates the need to rely solely on polling for change detection.
- 30-day history enables post-hoc debugging of "who moved my task."
- No new dependencies -- ships with existing `ws` package.
- Fire-and-forget logging means zero latency impact on existing mutation APIs.

### Negative / Risks
- **Disk usage:** Mitigated by 30-day retention and small event size (< 1 KB each). Even at 1000 events/day, 30 days = ~30 MB.
- **JSONL query performance:** No indexes. Mitigated by day-partitioning (only read relevant files) and reasonable limits (max 200 per query). For a local tool, this is acceptable.
- **terminal.js change:** Modifying the upgrade handler to pass-through instead of destroy is a behavioral change. Risk: if a third WS path is added later, handlers must be careful about ordering. Mitigation: each handler checks its own path and ignores others.
- **No per-connection filtering on WS:** All events are broadcast to all clients. Client-side filtering means bandwidth is not optimized. Acceptable for localhost (negligible network cost).

## Alternatives Considered

- **SSE (Server-Sent Events):** Discarded because it introduces a second real-time transport pattern alongside WebSocket, and lacks bidirectional capability for future features.
- **SQLite persistence:** Discarded because it adds a native dependency and breaks the no-database constraint. Overkill for local-tool event volumes.
- **Enhanced polling:** Discarded because it cannot deliver sub-second updates and couples event delivery to the board refresh cycle.
- **Dedicated page with React Router:** Discarded because Prism has no routing infrastructure and the sidebar panel pattern is already established.

## Review

Suggested review date: 2026-09-23
