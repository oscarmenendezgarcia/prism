# Changelog

All notable changes to Prism are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased] — 2026-03-23

### Added — Activity Feed real-time (ADR-1)

#### Backend

- **`src/activityStore.js`** — JSONL-based activity event persistence layer.
  - Day-partitioned files in `data/activity/YYYY-MM-DD.jsonl` (append-only, one JSON object per line).
  - `query({ spaceId, type, from, to, limit, cursor })` reads newest-first across day files; skips malformed lines with a console warning.
  - `cleanup()` deletes `.jsonl` files older than 30 days; runs at startup and every 24 h via `setInterval().unref()`.
  - Opaque base64-encoded cursor `{ date, offset }` for efficient cursor-based pagination.

- **`src/activityLogger.js`** — Fire-and-forget event capture facade.
  - `createActivityLogger({ store, broadcast })` — validates deps at construction time.
  - `log(type, spaceId, payload)` constructs a full `ActivityEvent` (UUID id, ISO timestamp, `'system'` actor), calls `store.append()` and `broadcast()` in sequence; errors in either are caught and `console.error`'d, never re-thrown.

- **`activity-ws.js`** — WebSocket endpoint at `/ws/activity`.
  - Uses `ws` npm package in `noServer` mode, same as `terminal.js`.
  - Upgrade handler: **passes through** non-`/ws/activity` paths (does not destroy the socket) so multiple WS handlers coexist.
  - Localhost origin check (`LOCALHOST_ORIGINS` set: ports 3000 and 5173), max 10 concurrent connections (HTTP 429 on overflow), `maxPayload` 8192 bytes.
  - Sends `{ type: 'connected', timestamp }` on open; replies `{ type: 'pong' }` to client ping frames.
  - `broadcast(event)` wraps each client send in a per-client try/catch.

- **`terminal.js`** — Fixed upgrade handler: changed `socket.destroy()` to `return` for non-`/ws/terminal` paths, enabling multi-WS coexistence on the same HTTP server.

- **`server.js`** — Activity Feed integration:
  - `createApp(dataDir, { logger, spaceId })` — `logger` and `spaceId` injected as options; all mutation handlers call `logger.log()` after `sendJSON()` (fire-and-forget, zero latency impact).
  - Events emitted: `task.created`, `task.moved`, `task.updated`, `task.deleted`, `board.cleared`, `space.created`, `space.renamed`, `space.deleted`.
  - New REST routes: `GET /api/v1/activity` (global) and `GET /api/v1/spaces/:spaceId/activity` (space-scoped); query params: `type`, `from`, `to`, `limit` (default 50, max 200), `cursor`.
  - Bootstrap wires the lazy broadcast wrapper to solve the logger ↔ WebSocket chicken-and-egg ordering.

- **`mcp/kanban-client.js`** — Added `listActivity(params)` export.
- **`mcp/mcp-server.js`** — Registered `kanban_list_activity` tool (spaceId, type, limit, from, to, cursor params).

#### Frontend (`frontend/`)

- **Types** — `src/types/index.ts`: `ActivityEventType` (8-value union), `ActivityEvent`, `ActivityEventPayload`, `ActivityFilter`, `ActivityQueryResponse`, `ActivityStatus`.
- **API client** — `src/api/client.ts`: `getActivity(spaceId, params)` and `getGlobalActivity(params)` calling the new REST endpoints with typed query string construction.
- **Zustand store** — `src/stores/useAppStore.ts`: activity feed slice added:
  - `activityPanelOpen` (persisted to localStorage key `activity-panel:open`).
  - `activityEvents` array (max 500 in memory, oldest dropped).
  - `activityUnreadCount` — incremented by `addActivityEvent` when panel is closed; cleared by `toggleActivityPanel`/`setActivityPanelOpen`.
  - `activityFilter`, `activityLoading`, `loadActivityHistory(cursor?)`.
  - Selector hooks: `useActivityPanelOpen`, `useActivityEvents`, `useActivityUnreadCount`, `useActivityFilter`, `useActivityLoading`.
- **`src/hooks/useActivityFeed.ts`** — WebSocket lifecycle hook.
  - Connects to `/ws/activity` relative to `window.location.host`; works in both production (port 3000) and through the existing Vite `/ws` prefix proxy (port 5173).
  - Exponential backoff reconnect: 1 → 2 → 4 → 8 → 16 → 30 s cap; resets on successful open.
  - Sends a ping every 30 s when connected; cleans up socket + timers on unmount.
  - Parses `activity` frames and calls `addActivityEvent` in store; silently skips malformed JSON.
- **`src/components/activity/ActivityFeedPanel.tsx`** — Resizable sidebar panel (drag handle via `usePanelResize`; default 360 px, 280–600 px range).
  - Header: "Activity" title, connection status dot + label (Live / Connecting… / Disconnected), close button.
  - Filter dropdown with all 8 event types plus "All events".
  - Scrollable event list: per-event icon (Material Symbols), human-readable description, relative timestamp.
  - Empty state with contextual hint when filter is active.
  - "Load more" button (disabled + spinner while `activityLoading` is true) for paginated history.
- **`src/components/activity/ActivityFeedToggle.tsx`** — Header icon button (`notifications` icon) with unread count badge (capped at 99+); badge hidden when panel is open or count is 0.
- **`src/components/layout/Header.tsx`** — `ActivityFeedToggle` inserted between `ConfigToggle` and `TerminalToggle`.
- **`src/App.tsx`** — `useActivityFeed()` mounted in `AppContent` (always active); `ActivityFeedPanel` conditionally rendered in the flex layout row when `activityPanelOpen`.

#### Tests

- **`tests/activity.test.js`** — 9 backend integration tests (node:test): task.created / task.moved / task.deleted / board.cleared / space events appear in REST response; type filter; cursor pagination; WebSocket broadcast within 500 ms of mutation.
- **`tests/activity-store.test.js`** — 13 unit tests: 30-day retention (deletes old, keeps recent, boundary, idempotent); cleanup return value; non-.jsonl files untouched; append + query smoke tests including malformed-line resilience.
- **`frontend/__tests__/components/ActivityFeedPanel.test.tsx`** — 18 Vitest + RTL tests: header, status labels, close button, event list rendering, type filter, empty state, filter dropdown, load more.
- **`frontend/__tests__/components/ActivityFeedToggle.test.tsx`** — 11 Vitest + RTL tests: rendering, badge visibility, count capping, aria-pressed, toggle interaction.
- **`frontend/__tests__/hooks/useActivityFeed.test.ts`** — 16 Vitest tests: connect on mount, status transitions, event parsing (activity / connected / pong / malformed), exponential backoff reconnect (1 s / 2 s / reset), ping every 30 s, cleanup on unmount.

---

## [Unreleased] — 2026-03-17

### Added — React + TypeScript frontend migration (ADR-002)

#### Frontend (`frontend/`)

- **Scaffolding** — Vite 5 + React 19 + TypeScript project with `frontend/package.json`, `vite.config.ts` (proxies `/api/v1/*` and `/ws/*` to backend on :3000), `tsconfig.json`, `postcss.config.js`, `index.html`.
- **Design tokens** — `tailwind.config.js` maps all 80+ CSS custom properties from `public/style.css` into Tailwind theme extensions: colors, borderRadius, boxShadow, fontFamily, layout sizes.
- **Types** — `src/types/index.ts`: `Task`, `Space`, `Column`, `Attachment`, `AttachmentContent`, `CreateTaskPayload`, `MoveTaskResponse`, `ToastState`, `TerminalStatus`.
- **API client** — `src/api/client.ts`: typed `apiFetch<T>` wrapper + 9 named methods (`getSpaces`, `createSpace`, `renameSpace`, `deleteSpace`, `getTasks`, `createTask`, `moveTask`, `deleteTask`, `getAttachmentContent`). Matches legacy `api` object contract exactly.
- **Zustand store** — `src/stores/useAppStore.ts`: centralized state for spaces, tasks, `activeSpaceId`, `isMutating`, all modal states, toast, and `terminalOpen`. Persists active space and terminal state to localStorage.
- **Hooks** — `usePolling` (3-second board refresh with `isMutating` guard), `useTerminal` (WebSocket + xterm.js lifecycle, exponential backoff reconnect), `useLocalStorage` (generic localStorage sync).
- **Shared components** — `Button` (5 variants: primary, secondary, ghost, danger, icon), `Badge` (task/research/done), `Modal` (portal, backdrop, Escape, focus trap), `Toast` (portal, success/error), `ContextMenu` (portal, positioned).
- **Board components** — `Board`, `Column`, `TaskCard` (move arrows, delete, attachment buttons), `EmptyState`.
- **Modal components** — `CreateTaskModal` (title counter, type select, assigned, description, validation), `AttachmentModal` (loading/content/file/error states matching Stitch S-02–S-05), `SpaceModal` (create + rename modes), `DeleteSpaceDialog` (task count, danger styling).
- **Terminal components** — `TerminalPanel` (xterm.js mount, status dot, reconnect bar), `TerminalToggle` (header button with active state).
- **Layout components** — `Header` (brand + actions), `SpaceTabs` (per-space tabs, active highlight, kebab context menu, add button).
- **App.tsx** — top-level composition: Header, SpaceTabs, Board, TerminalPanel (conditional), all modals, Toast, React Error Boundary.
- **Utils** — `formatTimestamp.ts`: TypeScript port of `formatTimestamp()` from `app.js`.
- **Tests** — 142 Vitest + React Testing Library tests covering: API client (12), Zustand store (23), `usePolling` (5), `useLocalStorage` (5), `formatTimestamp` (7), and all components (90). All pass.

#### Backend

- **`server.js`** — Updated `PUBLIC_DIR` from `path.join(__dirname, 'public')` to `path.join(__dirname, 'dist')`. This is the only backend change (ADR-002 §Backend impact).

---

## [Unreleased] — 2026-03-16

### Added — Spaces feature (ADR-1)

#### Backend

- **`src/migrator.js`** — Startup migrator that handles three scenarios:
  1. Already migrated (`spaces.json` exists) — no-op.
  2. Legacy flat-file layout (`todo.json` at data root) — copies column files into
     `data/spaces/default/`, writes `spaces.json` manifest, removes originals.
  3. Fresh install — creates default space directory and empty column files.

- **`src/spaceManager.js`** — `createSpaceManager(dataDir)` factory providing:
  - `listSpaces()` — read all spaces from `spaces.json`.
  - `getSpace(id)` — lookup by ID with typed error result.
  - `createSpace(name)` — UUID generation, directory scaffold, atomic manifest write.
  - `renameSpace(id, newName)` — updates name + `updatedAt`, case-insensitive duplicate guard.
  - `deleteSpace(id)` — last-space guard, removes directory, updates manifest.
  - `ensureAllSpaces()` — self-healing: recreates any missing space dirs or column files.

- **`server.js`** — Integrated migrator and SpaceManager into startup sequence:
  - `migrate(dataDir)` and `ensureAllSpaces()` called before `server.listen()`.
  - New REST routes added to `mainRouter`:
    - `GET    /api/v1/spaces` — list spaces.
    - `POST   /api/v1/spaces` — create space.
    - `GET    /api/v1/spaces/:id` — get single space.
    - `PUT    /api/v1/spaces/:id` — rename space.
    - `DELETE /api/v1/spaces/:id` — delete space and all its tasks.
    - `GET|POST|PUT|DELETE /api/v1/spaces/:spaceId/tasks/*` — space-scoped task routes
      (delegates to cached `createApp()` instance).
  - `Map`-based `appCache` caches per-space `createApp()` instances; evicted on space deletion.
  - Legacy shim: `GET|POST|PUT|DELETE /api/v1/tasks/*` transparently rewrites to `default` space.

#### Frontend

- **`public/spaces.js`** — IIFE module (`SpaceTabs`) managing the space tabs UI:
  - Renders tab strip with active-space highlighting.
  - Kebab context menu per tab for rename and delete actions.
  - Create Space modal (POST) and Rename Space modal (PUT).
  - Delete Space confirmation dialog with task-count warning.
  - Active space persisted in `localStorage` key `prism-active-space`.
  - Falls back to first available space if persisted ID is deleted.

- **`public/app.js`** — Updated to be space-aware:
  - `activeSpaceId` state variable, `setActiveSpace()` setter.
  - All API calls (`getTasks`, `createTask`, `moveTask`, `deleteTask`, `getAttachmentContent`)
    now include the active `spaceId` in the request path.
  - New `api` methods: `getSpaces()`, `createSpace()`, `renameSpace()`, `deleteSpace()`.

- **`public/index.html`** — Added:
  - `<nav class="space-tabs">` tab bar between the header and the board.
  - Space create/rename modal (`#space-modal-overlay`).
  - Space delete confirmation dialog (`#space-delete-overlay`).
  - Context menu (`#space-context-menu`).
  - `<script src="spaces.js">` loaded after `app.js`.

- **`public/style.css`** — Added Space Tabs component styles using only MD3 tokens:
  - `.space-tabs`, `.space-tabs-list`, `.space-tab`, `.space-tab--active`.
  - `.space-tab-kebab`, `.space-tab-add`.
  - `.space-context-menu`, `.space-context-menu-item`, `.space-context-menu-item--danger`.
  - `.space-modal-overlay`, `.space-modal`, `.space-modal-header`, `.space-modal-body`,
    `.space-modal-footer`.
  - `.space-delete-overlay`, `.space-delete-dialog`, `.space-delete-info`,
    `.space-delete-actions`.
  - `@keyframes fadeIn` for context menu entrance animation.

#### MCP

- **`mcp/kanban-client.js`** — Updated all task functions to accept optional `spaceId`:
  - `listTasks`, `getTask`, `createTask`, `updateTask`, `moveTask`, `deleteTask`,
    `updateAttachments`, `clearBoard` — route to `/spaces/:spaceId/tasks/*` when provided,
    fall back to legacy `/tasks/*` shim when omitted.
  - New exports: `listSpaces()`, `createSpace(name)`, `renameSpace(id, name)`, `deleteSpace(id)`.

- **`mcp/mcp-server.js`** — Updated to version `2.0.0`:
  - All 7 existing tools (`kanban_list_tasks`, `kanban_get_task`, `kanban_create_task`,
    `kanban_update_task`, `kanban_move_task`, `kanban_delete_task`, `kanban_clear_board`)
    gain an optional `spaceId` Zod parameter.
  - 4 new tools registered:
    - `kanban_list_spaces` — list all spaces.
    - `kanban_create_space` — create a new space by name.
    - `kanban_rename_space` — rename a space by ID.
    - `kanban_delete_space` — delete a space and all its tasks.

### Tests

- **`tests/migrator.test.js`** — 14 unit tests covering all three migration scenarios:
  already-migrated no-op, legacy-format migration (data integrity, file cleanup), fresh install.

- **`tests/spaceManager.test.js`** — 26 unit tests across 6 suites:
  `listSpaces`, `getSpace`, `createSpace` (validation, duplicate detection, boundary),
  `renameSpace` (persistence, same-name self-rename, duplicate guard), `deleteSpace`
  (last-space guard, cascade, not-found), `ensureAllSpaces` (self-healing).

- **`tests/spaces.test.js`** — 36 integration tests using isolated temp dirs and per-test
  HTTP servers (no shared state):
  - Space CRUD over HTTP (list, create, get, rename, delete).
  - Space-scoped task routes (create, move, delete, 404 on unknown space).
  - Task isolation between spaces.
  - Space deletion cascade (tasks unreachable after delete).
  - `DELETE /api/v1/spaces/:id/tasks` clears only the target space.
  - Legacy shim (`/api/v1/tasks/*`) correctly proxies to default space.
  - Regression: existing task endpoints on default space unchanged.

### Coverage summary

| File                    | Estimated coverage |
|-------------------------|--------------------|
| `src/migrator.js`       | >95%               |
| `src/spaceManager.js`   | >95%               |
| `server.js` (new paths) | >90%               |
| `mcp/kanban-client.js`  | >90%               |
| `mcp/mcp-server.js`     | >90%               |
