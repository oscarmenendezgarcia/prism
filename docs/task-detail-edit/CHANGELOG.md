# Changelog: task-detail-edit

## Stage 3 — Developer (2026-03-24)

### feat
- `frontend/src/types/index.ts`: Added `UpdateTaskPayload` interface (optional fields: title, type, description, assigned) for partial task updates via PUT endpoint.
- `frontend/src/api/client.ts`: Added `updateTask(spaceId, taskId, patch)` client function wrapping `PUT /api/v1/spaces/:spaceId/tasks/:taskId`.
- `frontend/src/stores/useAppStore.ts`: Extended store with:
  - `detailTask: Task | null` — currently open task (null = panel closed).
  - `openDetailPanel(task)` — sets detailTask.
  - `closeDetailPanel()` — clears detailTask.
  - `updateTask(taskId, patch)` — optimistic board update + API call + rollback on error.
- `frontend/src/components/board/TaskDetailPanel.tsx`: New slide-in panel component:
  - Reads `detailTask` from store; renders null when panel is closed.
  - Editable fields: title (auto-save on blur), type segmented control (auto-save on change), assigned (auto-save on blur), description (explicit save via button).
  - Semi-transparent backdrop; close via button, Escape key, or backdrop click.
  - ARIA `role="dialog"`, `aria-modal="true"`, `aria-label="Task detail"`.
  - Focus trap inside panel; focus returns to trigger element on close.
  - All inputs disabled while `isMutating` or active agent run on this task.
  - Active run warning banner shown when agent pipeline is running.
  - Responsive: `w-full` on mobile, `w-[380px]` on sm+ breakpoint.
  - Read-only footer: createdAt and updatedAt timestamps.
- `frontend/tailwind.config.js`: Added `slide-in-right` keyframe + animation (200 ms, NFR-1).
- `frontend/src/components/board/TaskCard.tsx`: Title wrapped in a button (`cursor-pointer hover:text-primary`) that calls `openDetailPanel(task)`. Added expand icon button (`open_in_full`, `aria-label="Open task detail"`) in card header alongside the Badge.
- `frontend/src/App.tsx`: Mounted `<TaskDetailPanel />` at App root level, above board and below existing modals (z-50).

### test
- `frontend/__tests__/components/TaskDetailPanel.test.tsx`: 29 tests covering:
  - Render state (null when closed, pre-populated fields, header metadata, footer timestamps).
  - Close actions (close button, backdrop click, Escape key).
  - Auto-save on blur: title (changed, no-change, empty revert).
  - Auto-save on blur: assigned (changed, cleared to empty string).
  - Auto-save on change: type (changed, no-op on same type click).
  - Explicit save: description via "Save description" button.
  - Disabled state during `isMutating` (all inputs + type radios + save button).
  - Read-only state during active agent run (inputs disabled, warning banner visible).
  - ARIA attributes (role, aria-modal, aria-label, close button label).
- `frontend/__tests__/stores/useAppStoreDetailPanel.test.ts`: 17 tests covering:
  - `openDetailPanel`: sets detailTask, replaces existing open task.
  - `closeDetailPanel`: sets detailTask to null, no-op when already closed.
  - `updateTask` success path: API called with correct args, board updated in all columns, detailTask refreshed, success toast shown, isMutating false after.
  - `updateTask` error path: board and detailTask rolled back, error toast shown, isMutating false after.
  - `updateTask` isMutating: true during call, false after.
  - Optimistic update applied before API resolves.

### Total tests
- 730 tests passing (previously 684 + 46 new).
- 0 failures.

## Commits
- `bbeede7` `[dev] T-001: Add UpdateTaskPayload type and updateTask API client function`
- `a5dfc96` `[dev] T-002: Extend useAppStore with detailTask state and panel actions`
- `41900f3` `[dev] T-003: Implement TaskDetailPanel component`
- `ad50220` `[dev] T-004: Add expand trigger to TaskCard`
- `37a053f` `[dev] T-005: Mount TaskDetailPanel in App`
- `a672345` `[dev] T-006/T-007: Unit tests for TaskDetailPanel and store updateTask action`

## Open Questions / Risks
- **Stitch screens**: The UX stage noted that `mcp__stitch__generate_screen_from_text` returned empty output on two attempts. ASCII wireframes in `wireframes.md` were used as the authoritative spec. Visual design follows the existing dark-theme token vocabulary exactly.
- **Panel persistence across card navigation**: When a second card is opened while one panel is already open, the panel updates in-place (same instance, new detailTask). This matches the simplest UX behavior but was flagged as a stakeholder question in the wireframes. No deviation from spec — the blueprint does not prescribe close-and-reopen behavior.
- **Concurrent edit race**: Addressed via optimistic update + rollback. Server-authoritative timestamps are applied after API resolve. Board polling (existing) will eventually reconcile any external changes.
