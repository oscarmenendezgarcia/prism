# Changelog

## [Unreleased] — run-indicator

### Added
- `frontend/src/components/agent-launcher/RunIndicator.tsx`: componente unificado que reemplaza `AgentRunIndicator` + `PipelineProgressBar`. Lee exclusivamente de `pipelineState`. Bifurcación null | SingleAgentDot | StepNodes | PausedBanner. STAGE_DISPLAY incluye `code-reviewer`.
- `frontend/__tests__/components/RunIndicator.test.tsx`: 42 tests (null, single-agent, multi-stage, paused, timer, accessibility).

### Changed
- `src/pipelineManager.js`: `spawnStage` usa `detached: true`; `deleteRun` y timeout handler usan `process.kill(-child.pid, 'SIGTERM')` + log con pid/pgid.
- `frontend/src/components/layout/Header.tsx`: centro del header usa un único `<RunIndicator />` en vez de `<AgentRunIndicator /> + <PipelineProgressBar />`.

### Removed
- `frontend/src/components/agent-launcher/AgentRunIndicator.tsx` (git rm)
- `frontend/src/components/agent-launcher/PipelineProgressBar.tsx` (git rm)
- `frontend/__tests__/components/AgentRunIndicator.test.tsx` (git rm)
- `frontend/__tests__/components/PipelineProgressBar.test.tsx` (git rm)

---

## [pipeline-field-per-card]

### T-001 — Extract validatePipelineField helper
- feat: `validatePipelineField(value)` exported from `src/handlers/tasks.js`
- Validates `pipeline` is `string[] | undefined`, max 20 elements, each ≤ 50 chars
- Empty array → `{ valid: true, data: undefined }` (clear semantics)
- Reused by create, update, and auto-task paths

### T-002 — Extend handleCreateTask with pipeline field
- feat: `POST /spaces/:id/tasks` now accepts optional `pipeline: string[]`
- Stored inline on task object when non-empty; omitted when absent or empty
- Structured log: `task.pipeline_field_set` emitted on every set

### T-003 — Extend handleUpdateTask with pipeline field
- feat: `pipeline` added to `UPDATABLE_FIELDS` in `handleUpdateTask`
- Non-empty array → replaces field; empty array → deletes key; absent → no change
- Structured log: `task.pipeline_field_set` emitted on every update

### T-004 — Extend handleCreateRun resolution chain
- feat: `handleCreateRun` now resolves `task.pipeline` between explicit stages and `space.pipeline`
- Resolution chain: explicit `stages` > `task.pipeline` > `space.pipeline` > `DEFAULT_STAGES`
- `resolvedFrom: 'task' | 'space' | 'default'` included in 201 response (MCP path)
- Structured log: `run.pipeline_resolved` emitted on every run creation

### T-005 — Extend auto-task system prompt
- feat: `src/prompts/autotask-system.txt` extended with rule 5 and optional `pipeline` field in schema
- Known agent IDs documented to prevent hallucination; "omit when uncertain" explicit

### T-006 — Extend handleAutoTaskGenerate
- feat: AI-generated pipeline fields validated with soft-strip semantics
- Unknown agent IDs (not in `PIPELINE_AGENTS_DIR`) stripped silently
- Invalid type stripped and logged; task still created
- `handleAutoTaskConfirm` preserves valid pipeline fields through the confirm flow

### T-007 — Extend MCP kanban_update_task
- feat: `pipeline: z.array(z.string()).optional()` added to `kanban_update_task` schema
- Empty array = clear semantics documented in tool description

### T-008 — Extend Task type + openPipelineConfirm resolver
- feat: `Task.pipeline?: string[]` added to `frontend/src/types/index.ts`
- `UpdateTaskPayload.pipeline?: string[]` added
- `openPipelineConfirm` resolver updated: task.pipeline > space.pipeline > agentSettings > DEFAULT_STAGES

### T-009 — Add pipeline field editor to TaskDetailPanel
- feat: `PipelineFieldEditor` inline component in `TaskDetailPanel.tsx`
- Collapsed (absent): "(space default)" label + Configure button
- Collapsed (set): agent chain "a → b → c" + Edit + Clear buttons
- Edit mode: ordered list with ↑/↓/✕ per stage + add-stage select + Save/Cancel
- No inline styles; Tailwind tokens only; no auto-save

### T-010 — Backend tests
- test: 27 tests in `tests/pipeline-field.test.js`
- Covers: validatePipelineField (8 branches), create (5), update (5), resolution chain (4), soft-validation (5)

### T-011 — Frontend tests
- test: 11 new tests added to `frontend/__tests__/components/TaskDetailPanel.test.tsx`
- Covers: collapsed (absent), collapsed (set), Clear, Configure, Edit, Save, Cancel, remove stage, Save empty, disabled state

---

## [redesign-cards]

### Added
- `frontend/src/components/board/CardActionMenu.tsx`: extracted action toolbar (move-left, move-right, run agent, delete) into a standalone component. Renders 28×28px icon buttons using Material Symbols Outlined. Composes AgentLauncherMenu for the todo column only.
- `frontend/__tests__/components/CardActionMenu.test.tsx`: 19 tests — move-left/right column guards, delete disabled states, AgentLauncherMenu presence, aria-labels.
- `frontend/__tests__/components/TaskCard.test.tsx`: 41 tests — full rewrite for new design.

### Changed
- `frontend/src/components/board/TaskCard.tsx`:
  - Zone A: Badge + title (flex-1, line-clamp-2) + optional active-run dot (6px pulsing blue) + more_vert menu button. Active-run dot calls `openPanelForTask`.
  - Zone B: assigned avatar + name, attachment count pill (clickable), description preview (line-clamp-1). Zone B absent when all three conditions are false.
  - Hover overlay: CardActionMenu at top-2 right-2, opacity-0 group-hover:opacity-100; `[@media(pointer:coarse)]:opacity-100` for touch.
  - Padding reduced p-4 → p-3; gap reduced gap-2.5 → gap-2; added `group` and `relative` on article.
  - Timestamps and individual attachment chips removed from resting card.

---

## [redesign-bugfix]

### Fixed
- **BUG-001** [CRITICAL] Modal does not close after successful task creation — `frontend/src/components/shared/Modal.tsx`: added `else` branch to `useEffect([open])`; when `open` transitions to `false` externally, sets `isClosing=true`, waits 180ms, then sets `isVisible=false`. Test added in `Modal.test.tsx`.
- **BUG-002** [MEDIUM] Tab bar scroll-snap broken — `frontend/src/components/board/ColumnTabBar.tsx`: `scroll-snap-x-mandatory` → `snap-x snap-mandatory`; `scroll-snap-align-start` → `snap-start`.
- **BUG-003** [MEDIUM] Active tab pill fully saturated — `ColumnTabBar.tsx`: active tab classes → `bg-primary/15 text-primary font-semibold border-b-2 border-primary`; count badge → `bg-primary/20 text-primary`.
- **BUG-004** [MEDIUM] Last card hidden under FAB on mobile — `frontend/src/components/board/Column.tsx`: card list container now has `pb-20 sm:pb-3`.
- **BUG-005** [LOW] FAB aria-label incorrect — `frontend/src/components/board/Board.tsx`: `aria-label="New task"` → `aria-label="Create new task"`.
- **BUG-006** [LOW] Error toasts use wrong ARIA role — `frontend/src/components/shared/Toast.tsx`: error toasts use `role="alert"` + `aria-live="assertive"`; success keeps `role="status"` + `aria-live="polite"`. `Toast.test.tsx` updated.
- **BUG-007** [LOW] Column header background missing blur — `frontend/src/components/board/Column.tsx`: sticky header `bg-background` → `bg-background/80 backdrop-blur-md`.

---

## [pipeline-templates] — T-8

### Added
- `src/templateManager.js`: factory `createTemplateManager(dataDir)`. Persists templates to `data/pipeline-templates.json` with atomic `.tmp`+`renameSync` writes. Validation: name (required, max 100, case-insensitive unique), stages (non-empty string[]), checkpoints (boolean[], auto-padded/truncated), useOrchestratorMode (boolean). CRUD: listTemplates, getTemplate, createTemplate, updateTemplate (partial), deleteTemplate.
- REST routes in `server.js`: `PIPELINE_TEMPLATES_LIST_ROUTE`, `PIPELINE_TEMPLATES_SINGLE_ROUTE`; handlers wired before legacy shim. Error code → HTTP status: VALIDATION_ERROR=400, DUPLICATE_NAME=409, TEMPLATE_NOT_FOUND=404.
- `frontend/src/types/index.ts`: `PipelineTemplate`, `CreateTemplatePayload`, `UpdateTemplatePayload`.
- `frontend/src/api/client.ts`: `getTemplates`, `createTemplate`, `updateTemplate`, `deleteTemplate`.
- Zustand store: `templates: PipelineTemplate[]`, `loadTemplates`, `saveTemplate`, `deleteTemplate` added to `useAppStore`. `loadTemplates` called in `App.tsx` useEffect.
- `PipelineConfirmModal`: template load dropdown (populate stages, checkpoints, useOrchestratorMode) + Save as template form. All UI uses Tailwind-only tokens.
- `tests/pipeline-templates.test.js`: 19 tests (6 unit, 13 integration) — all pass. Covers list empty, create, 400/409 validation, checkpoints auto-pad, PUT partial update, PUT 404, stages reconcile, DELETE 200/404, persistence across restart.

---

## [modularize-server]

`server.js` was a monolithic 2636-line file. Split into 10 focused modules under `src/handlers/` and `src/utils/`, reducing `server.js` to 411 lines.

### Added
- `src/utils/http.js`: `sendJSON`, `sendError`, `parseBody`, `parseBodyWithLimit`.
- `src/constants.js`: `COLUMNS` (the three Kanban column identifiers).
- `src/handlers/tasks.js`: `createApp(dataDir)` — isolated task router per space. All task CRUD, move, attachment, and board-clear handlers.
- `src/handlers/static.js`: static file serving with SPA fallback (`dist/index.html` for extension-less routes).
- `src/handlers/settings.js`: `GET/PUT /api/v1/settings`, `readSettings`, `writeSettings`, `deepMergeSettings`. `readSettings` also consumed by the prompt handler.
- `src/handlers/config.js`: `buildConfigRegistry`, list/read/save handlers for `/api/v1/config/files[/:fileId]`.
- `src/handlers/agents.js`: agent file listing/reading for `/api/v1/agents[/:id]`. Exports `AGENTS_DIR` and `AGENT_ID_RE`.
- `src/handlers/prompt.js`: `POST /api/v1/agent/prompt`, CLI command builder, prompt text assembler, `cleanupOldPromptFiles()`.
- `src/handlers/agentRuns.js`: agent run history JSONL persistence and `GET/POST /api/v1/agent-runs` + `PATCH /api/v1/agent-runs/:runId`.
- `src/handlers/pipeline.js`: `POST/GET/DELETE /api/v1/runs[/:id]` and `GET /api/v1/runs/:runId/stages/:N/log`.

### Changed
- `server.js`: now contains only imports, route regex patterns, `startServer()` delegating to extracted handlers, and direct-invocation bootstrap. Pure refactor — no behavioral changes.

---

## [public-legacy-cleanup] — T-08

### Changed
- `docs/github-readiness.md`: T-08 status updated from `⏳ Pendiente` to `✅ Hecho`. Documented that `public/` was removed during the React migration and that `src/handlers/static.js` already serves from `dist/`.

### Notes
- `public/` did not exist on disk — already cleaned up prior to this task.
- `src/handlers/static.js` correctly sets `PUBLIC_DIR` to `dist/`; contains inline comment confirming removal.

---

## [Previous]

### Added
- Added `projectClaudeMdPath` field to space metadata
  - Spaces can now configure a path to their project CLAUDE.md file
  - Field is optional and defaults to undefined if not set
  - Supports relative paths from the space's data directory
  - Empty string clears the field (sets to undefined)

### Changed
- `buildPromptText()` now includes project CLAUDE.md content when configured
  - Reads the file from the configured path relative to data directory
  - Includes content in a new `## PROJECT CLAUDE.MD` section
  - Handles missing files gracefully with a warning log
- `createSpace()` and `renameSpace()` now accept optional `projectClaudeMdPath` parameter
- New API endpoint: `GET /api/v1/project/claude-md?spaceId={id}`
  - Returns project CLAUDE.md content with metadata (path, size, modifiedAt, content)
  - Returns 404 if no path configured or file doesn't exist
- New MCP tool: `kanban_get_project_claude_md`
  - Retrieve project CLAUDE.md content via space ID

### Security
- Path resolution is sandboxed to the space's data directory
- No path traversal attacks possible (uses path.resolve with dataDir as base)
- File path validation ensures absolute paths can't escape data directory
