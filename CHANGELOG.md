# Changelog

## [Unreleased]

### Added
- **Agent auto-sync on startup** — Prism now automatically syncs agent definition files
  (`agents/*.md`) to the runtime directory (`~/.claude/agents/` or `PIPELINE_AGENTS_DIR`)
  on every server startup. After `npm install -g prism-kanban@latest`, the updated agents
  are available immediately on the next restart — no `prism init` required.

  **Safe-sync guarantee:** A SHA-256 manifest (`.prism-manifest.json` inside the agents
  directory) records the hash of every file as last written by Prism. On sync, the
  destination file's current hash is compared against the manifest:
  - **Hash matches manifest** → Prism owns it → update if source has changed.
  - **Hash diverges from manifest** → user has edited the file → skip, never overwrite.

  **One-time migration note:** On the first restart after upgrading from a pre-manifest
  Prism version (≤ 1.1.0), all existing agent files are updated to the latest shipped
  version (migration-bias). This is a one-time event; the manifest is then written and
  protects user customisations on all subsequent syncs. Each updated file is logged with
  the `[agent-sync]` prefix.

  **`prism init`** still handles initial setup (fresh install). It now also writes the
  manifest after copying files, so the first auto-sync immediately operates in safe mode
  (Case 2) rather than migration mode (Case 3).

  **Observability:** All sync activity is logged under the `[agent-sync]` prefix:
  ```
  [agent-sync] installed: developer-agent.md
  [agent-sync] updated: senior-architect.md (prism v1.1.0 → v1.2.0)
  [agent-sync] skipped (user-modified): ux-api-designer.md
  [agent-sync] first-sync updated: qa-engineer-e2e.md (no prior baseline)
  [agent-sync] synced 3, skipped (user-modified) 1
  ```

## [1.1.0] — 2026-06-07

Headline: **Folio** — a navigable, augmentable knowledge base shared between you and your agents.

### Added
- **Folio v1** — a per-space knowledge base so agents stop starting every task from zero.
  - **Folio → Chapter → Page** structure stored as human-readable markdown with YAML
    frontmatter; the index is browsable and editable in the UI.
  - **Co-authored** — both you and agents write pages; every agent write is tagged
    `author='agent'` so it can be filtered and pruned.
  - **`[[chapter/page]]` and `[[chapter/page#section]]` references** between pages.
  - **FTS5/BM25 full-text search** over all pages.
  - **Stage-aware injection** — relevant pages are pulled into each pipeline stage by
    keying the BM25 query on the task description + the stage's role (no `stage→chapters`
    table to maintain).
  - **Agent write-back** — a single conservative consolidation step at the end of a run
    records a decision, a lesson, and/or a state update — only high-signal knowledge.
  - **Bootstrap from repo** — on the first pipeline run in a git-backed space, the folio is
    materialized automatically from the repo; opt-in and lazy everywhere else.
  - **Folio MCP server** (`mcp/folio-mcp-server.js`) exposing `folio_search`,
    `folio_get_page`, `folio_list_chapters`, `folio_create_page`, `folio_update_page`,
    `folio_list`, `folio_create`, attachments, and export/import.
  - **Pluggable storage backend** — file backend (markdown on disk) or SQLite, sharing the
    same FTS5 index.
- **Responsive space tab bar** — tabs collapse into an overflow dropdown when they no longer
  fit, with clearer active-tab emphasis.
- **Ko-fi support button** in the README.

## [1.0.0] — 2026-05-29

First stable release.

### Added
- **`prism doctor` subcommand** — runs a checklist of offline environment/dependency assertions
  and prints pass/fail per item. Exit 0 if all pass, 1 if any fail.
  - `node-version`: Node.js major ≥ 20
  - `spawn-helper`: `node-pty` spawn-helper has executable bit (reuses `bin/postinstall.js` logic)
  - `better-sqlite3`: native module loads and can open an in-memory database
  - `claude-cli`: `claude --version` exits 0 within 2 s (`spawnSync`, `shell: false`)
  - `data-dir-writable`: data directory exists and is writable
  - `server-status`: PID file absent ("stopped") or pointing to a live process (stale = fail)
- **`--json` flag** for `prism doctor` — machine-readable `{ ok, checks: [...] }` output for CI
  pipelines and automated installers (`prism doctor --json | jq`).
- `src/utils/doctor/checks.js` — six pure check functions with `ctx.deps` injection for unit
  testing; no network calls.
- `bin/doctor.js` — runner and text/JSON formatters; ANSI colors disabled when `!isTTY` or
  `NO_COLOR` is set.

### Changed
- `PUT /api/v1/spaces/:spaceId/tasks/:id/attachments` (and `kanban_update_task` MCP tool): default
  attachment-update semantics changed from **replace** to **merge-by-name**. Incoming items are
  upserted in place; unlisted existing attachments are retained. Pass `mode: "replace"` to restore
  the previous replace behaviour (including empty array to clear all attachments).
- `mcp/kanban-client.js` `updateAttachments`: accepts new optional `mode` parameter forwarded to the
  REST endpoint.
- `mcp/mcp-server.js` `kanban_update_task`: exposes optional `mode` parameter; description updated
  to document the new default.
- `docs/endpoints.md` and `docs/mcp-server.md`: document the new `mode` field, merge semantics,
  and `ATTACHMENT_LIMIT_EXCEEDED` error response.

Replaces JSON file persistence with a single SQLite database (`data/prism.db`).
All read/write operations are now atomic and serialised at the DB level —
eliminating the race conditions inherent in the previous read-file / write-file
pattern.  See `agent-docs/sqlite-migration/ADR-1.md` for the full rationale.

### Added
- `src/services/store.js`: SQLite Store (28 unit tests in `tests/store.test.js`)
  — WAL mode, foreign keys, prepared statements for all CRUD operations.
- `src/services/migrator.js` (rewrite): idempotent migration runner; imports
  existing JSON files into SQLite on first startup, then becomes a no-op.
- `scripts/migrate-to-sqlite.js`: standalone migration helper for manual runs.
- `tests/concurrency.test.js`: 3 regression tests that fire 20 concurrent
  PUT /tasks/:id/move requests and assert zero lost updates.
- `better-sqlite3` dependency (native, compiled via node-gyp).

### Changed
- `src/services/spaceManager.js`: all space CRUD now delegates to Store.
  Accepts `Store | string` for backward compatibility with existing tests.
- `src/handlers/tasks.js`: createApp now receives a Store instance instead of
  reading/writing column JSON files directly.
- `src/handlers/comments.js`: reads and writes comments via `store.updateTask`
  instead of column files.
- `src/handlers/autoTask.js`: `appendTasksToColumn` delegates to `store.insertTask`.
- `src/handlers/tagger.js`: `readSpaceTasks` reads via `store.getTasksByColumn`.
- `src/routes/index.js`: router factory accepts and threads the `store` instance.
- `server.js`: initialises Store via `migrate(dataDir)` at startup; calls
  `store.close()` in graceful shutdown handler.
- `Dockerfile`: updated builder-stage comment to document that `python3 make g++`
  are required for both `node-pty` and `better-sqlite3` native compilation.
- `tests/spaceManager.test.js`: 5 filesystem-based assertions updated to verify
  SQLite store state instead of directory/file existence.

---

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
