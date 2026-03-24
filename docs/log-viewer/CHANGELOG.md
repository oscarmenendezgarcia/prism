# Changelog — Pipeline Log Viewer

**Feature:** log-viewer
**Branch:** feature/task-detail-edit
**Date:** 2026-03-24
**ADR:** docs/log-viewer/ADR-1.md

---

## Summary

Implemented a Pipeline Log Viewer panel for the Prism frontend. Users can now view
the output of each pipeline stage directly in the UI without opening a terminal.
The panel polls the existing `GET /api/v1/runs/:runId/stages/:N/log` endpoint every
2 seconds while a run is active, and shows static logs for completed runs.

---

## Changes

### feat: T-001 — Extend PipelineState type with optional runId

- Added `runId?: string` to the `PipelineState` interface in `frontend/src/types/index.ts`.
- Added `BackendStageStatus` interface and extended `BackendRun` with optional
  `stageStatuses`, `updatedAt`, and `currentStage` fields.

### feat: T-002 — Create usePipelineLogStore Zustand store

- New file: `frontend/src/stores/usePipelineLogStore.ts`
- State: `logPanelOpen`, `selectedStageIndex`, `stageLogs`, `stageLoading`, `stageErrors`
- Actions: `setLogPanelOpen`, `setSelectedStageIndex`, `setStageLog`, `setStageLoading`,
  `setStageError`, `clearStageLogs`
- Follows the same pattern as `useRunHistoryStore` (isolated Zustand store, SRP).

### feat: T-003 — Add getStageLog and LogNotAvailableError to api/client.ts

- New export: `getStageLog(runId, stageIndex, tail?)` — fetches `GET /api/v1/runs/:runId/stages/:N/log?tail=N`
- New export: `LogNotAvailableError` — sentinel error for 404/LOG_NOT_AVAILABLE (stage not started yet)
- Returns raw text on 200; throws typed errors on 4xx/5xx.

### feat: T-004 — Create usePipelineLogPolling hook

- New file: `frontend/src/hooks/usePipelineLogPolling.ts`
- Accepts `{ runId, stageIndex, isRunActive }`.
- Fetches immediately on mount and on `stageIndex` change.
- Polls every 2000ms when `isRunActive=true`; single fetch only when `isRunActive=false`.
- `LogNotAvailableError` → sets empty log string, no error (stage not started yet).
- Generic errors → sets `stageErrors[stageIndex]`.
- Cleans up interval on unmount (no memory leak).

### feat: T-005 — Create LogViewer component

- New file: `frontend/src/components/pipeline-log/LogViewer.tsx`
- Renders log content in a `<pre>` with `font-mono text-xs` classes.
- Auto-scroll to bottom on content update when `isAtBottom=true`.
- Auto-scroll disabled when user scrolls up (within AT_BOTTOM_THRESHOLD=8px).
- "Scroll to bottom" button appears when detached; scrolls and re-pins on click.
- Empty states: pending ("Stage not started yet."), running ("Waiting for output..."),
  completed/no-output ("No output for this stage."), error (shows message in error color).

### feat: T-006 — Create StageTabBar component

- New file: `frontend/src/components/pipeline-log/StageTabBar.tsx`
- One `role="tab"` button per stage.
- Short label map: senior-architect→Architect, ux-api-designer→UX, developer-agent→Dev, qa-engineer-e2e→QA.
- Status icons (Material Symbols): check (completed), progress_activity+animate-spin (running),
  close (failed/timeout), hourglass_empty (pending).
- Active tab: `bg-primary/10 text-primary border-b-2 border-primary`.

### feat: T-007 — Create PipelineLogPanel container

- New file: `frontend/src/components/pipeline-log/PipelineLogPanel.tsx`
- Reads `pipelineState` (for runId, stages, status) from `useAppStore`.
- Reads stage log state from `usePipelineLogStore`.
- Mounts `usePipelineLogPolling` for the selected stage.
- Polls `getBackendRun` every 3s to refresh `stageStatuses` for icon accuracy.
- Derives fallback stage statuses from `pipelineState` when backend run is unavailable.
- Resizable via `usePanelResize` (storageKey: `prism:panel-width:pipeline-log`, default 480px).
- Shows pulsing dot in header when run is active.

### feat: T-008 — Add PipelineLogToggle to Header

- Modified `frontend/src/components/layout/Header.tsx`.
- Added inline `PipelineLogToggle` component using `article` Material Symbol icon.
- Visible only when `pipelineState !== null`; toggles `logPanelOpen` in the store.
- Follows the exact pattern of `RunHistoryToggle` and `TerminalToggle`.

### feat: T-009 — Mount PipelineLogPanel in App.tsx

- Modified `frontend/src/App.tsx`.
- `PipelineLogPanel` is conditionally rendered when `logPanelOpen && pipelineState !== null`.
- Placed in the flex panel row alongside `TerminalPanel`, `RunHistoryPanel`, `ConfigPanel`.

### test: T-010 — Unit and integration tests (814 passing)

- `frontend/__tests__/stores/usePipelineLogStore.test.ts` — 22 assertions covering all state and actions.
- `frontend/__tests__/hooks/usePipelineLogPolling.test.ts` — 15 assertions: initial fetch, polling cadence,
  cleanup, stageIndex change, LogNotAvailableError path, generic error path, loading flag.
- `frontend/__tests__/components/LogViewer.test.tsx` — 16 assertions: error state, pending/running/no-output
  empty states, content rendering, auto-scroll, scroll-to-bottom button.
- `frontend/__tests__/components/StageTabBar.test.tsx` — 16 assertions: tab count, labels, aria-selected,
  active styling, onSelect callback, all 5 status icons.
- `frontend/__tests__/components/PipelineLogPanel.test.tsx` — 11 assertions: structural render, close button,
  stage selection, no-runId state, log content routing.
- `frontend/__tests__/components/PipelineLogToggle.test.tsx` — 5 assertions: visibility, click toggle,
  aria-pressed state, icon.

---

## Open Questions / Risks

- `pipelineState.runId` is only set when the pipeline is launched via backend spawn (`startRun`).
  PTY-mode pipelines (terminal open) do not call `startRun`, so `runId` will be undefined and
  the panel will show "No active pipeline run." This is consistent with the ADR (backend-only flow).
  Future work: expose a runId from PTY-mode runs if needed.

- `deriveStageStatus` uses the frontend `pipelineState.currentStageIndex` as a fallback when
  `stageStatuses` from the backend are not yet loaded. This can briefly show the wrong icon.
  The 3s `getBackendRun` poll corrects it promptly.

- `BackendRun.stageStatuses` is optional (`?`) because the existing `startRun` mock in tests
  does not include it. Real backend responses include it per the API spec.
