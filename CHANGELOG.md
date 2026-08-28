# Changelog

## [1.7.1] — 2026-08-28

### Fixed
- **The published package shipped `mcp/node_modules`** — 3,486 of its 3,594 files, 17.4 MB
  unpacked. It was not an oversight: `@modelcontextprotocol/sdk` was declared only in
  `mcp/package.json`, which npm never installs, so bundling the folder was what kept the MCP
  server working for installed users. The dependency moves to the root `package.json`, where npm
  manages it, and `mcp/node_modules` is excluded. **108 files, 2.6 MB installed.** Beyond the
  weight: the bundled copy was frozen, so a security patch in that chain could never reach a
  user who upgraded Prism. Verified by installing the tarball into a clean directory and
  completing an `initialize` + `tools/list` handshake against the packaged server.

## [1.7.0] — 2026-08-28

Headline: **Work that stops being lost.** Three things a run could silently drop — a review
verdict, a human answer, and the fact that a card is not actually done — now have a mechanism
behind them instead of prose in a prompt. Plus the local-harness stages you can finally watch
while they run.

### Added
- **Manager-driven feedback gate.** A gate agent emits a `prism-gate` verdict block inside its
  own artifact and the *manager* parses it and decides the back-edge, replacing the
  `stage-<N>.inject` signal file the agent had to write by hand — into a path it built relative
  to a throwaway worktree, which is why verdicts were being lost in silence. Any stage can be a
  gate by declaring `gate:` frontmatter. Ambiguity (two disagreeing blocks, an unbalanced fence,
  a block truncated by a nested one, a missing `pass:`) collapses to "no verdict" and fails the
  run loudly rather than guessing. (#197)
- **Merge gate.** The pipeline stops moving a card to `done` when the run produced a PR URL.
  Three cards had been sitting in `done` for weeks with ~2,400 lines of tested code stranded in
  unmerged branches. (#198)
- **Answer a blocking question from the UI**, and **re-injection of the agent that asked.**
  Previously the only action was "resolve", which unblocked the run *without delivering the
  answer* — and by then the stage process had already exited, so nobody was listening anyway.
  The manager now re-runs the asking agent with the answer in its prompt. (#206, #209)
- **Task dependencies.** `dependsOn` with DFS cycle detection, derived `blocked` state, and a
  409 on starting a run against a blocked task — the board used to promise those were skipped
  while nothing enforced it. (#200, #202, #203, #207)
- **JSON Schema 2020-12 in the MCP tool schemas** — `$ref` reuse, an `anyOf` filter object on
  `kanban_list_tasks`, `oneOf` attachment items. Legacy flat params still work. (#204)
- **Live stage logs for opencode and pi.** Both switch to their structured output mode and the
  normalizer learns both formats. A `pi` stage used to write nothing until it exited: its log
  sat at 0 bytes for the whole run. (#210)

### Changed
- `stage-<N>.inject` is **retired**. The artifact verdict block is the only channel. (#197)
- Agent run discipline: commit as you go rather than at the end, skip the PR step on a
  remote-less repo, and QA no longer patches production code to make a build pass. (#201)

### Fixed
- **The stall watchdog killed harnesses that do not stream.** It read an un-growing stage log as
  a dead stage, which is only true for a harness that streams; `pi` buffers until exit, so every
  pi stage died at the 15-minute mark by construction — one of them with its work already
  committed and pushed. (#208)
- **Consolidation was borrowing the comment resolver's 5-minute budget.** Measured at 6m00s for
  a real run: it was completing correctly and being killed for being 60 seconds late. It has its
  own timeout now, and the harness label it reports is the adapter's rather than a hand-rolled
  copy. (#205)
- `ws` floor raised to `^8.21.0` (installed: 8.21.3). The declared range still allowed a clean
  install elsewhere to resolve below the patched line. `npm audit` on the backend is clean; the
  9 findings that exist are all in the frontend **dev** toolchain, which `prism-kanban` does not
  ship — tracked separately.
- A blocking question was invisible until you reloaded the page — the poller and the run
  indicator disagreed about which statuses count as active. (#199)

## [1.6.0] — 2026-08-09

Headline: **Bring your own harness.** The Agents & Routing stack lets every agent in the
pipeline run on its own CLI + model — Claude Code, **opencode**, **pi**, **hermes**, or an
arbitrary **custom** command — resolved per stage with a per-agent **fallback** harness that
activates when the primary CLI is missing or a stage fails at runtime, plus in-UI **harness
discovery** that surfaces install links for CLIs not yet on the machine.

### Added
- **Pluggable CLI-harness adapter registry.** A stage's `cliTool` is resolved through a
  registered adapter instead of a hard-coded branch, so new harnesses plug in without touching
  the pipeline core. (#188)
- **`pi` and `hermes` CLI harnesses.** Beyond Claude Code and opencode, agents can now route to
  the `pi` and `hermes` CLIs (both `provider/model` style), each with its own spawn adapter. (#189)
- **`custom` cliTool — arbitrary command template.** Route a stage to any executable/command
  string with its own model, for harnesses or wrappers without a first-class adapter. (#190)
- **Per-agent fallback harness (advanced).** The *Agents & Routing* UI now has a collapsed
  *Fallback (advanced)* section per agent: pick a secondary CLI + model used when the primary
  harness can't run — the binary isn't installed, or a stage fails and is retried once on the
  fallback. (#191, #194)
- **Runtime fallback retry.** A stage that fails at runtime (non-zero exit) is re-spawned once
  on its fallback harness before the pipeline marks it failed. (#191)
- **Harness discovery — `GET /api/v1/harnesses`.** The backend reports which CLIs
  (`claude`, `opencode`, `pi`, `hermes`) are installed, with install links for the ones that
  aren't; the UI renders unavailable harnesses as install links instead of dead options. (#194)
- **Harness identity in the UI.** The *Agents & Routing* panel renames **Model → Harness** to
  reflect that the setting is a CLI harness + model pair, and shows harness names in mono. (#194)

### Changed
- **`autoTask` and the Launcher now use adapter routing** — the same `cliTool`/model resolution
  the pipeline uses, closing gaps where those entry points previously hard-coded Claude. (#192)
- **Design hardening** of the Agents & Routing panel (a11y, tokens, contrast) from an
  independent Opus design review. (#195)

### Fixed
- Harness adapters, fallback, and health-check correctness across the routing stack. (#188, #189, #190, #191, #192, #194)

## [1.5.0] — 2026-08-04

Headline: **Pipeline runs become legible to agents** — a canonical `kanban_*_run`
tool family plus `kanban_get_run_logs`, so an agent CLI can read what a run
actually did instead of only knowing whether it finished. Alongside it, a set of
fixes for runs that reported success while silently dropping work.

### Added
- **`kanban_get_run_logs` MCP tool** — returns the per-stage logs of a pipeline
  run in agent-readable form, resolvable by full run id or unique prefix. An
  agent can now diagnose a failed or looping run without shelling into
  `data/runs/`. (#181)
- **Canonical `kanban_start_run` / `kanban_stop_run` / `kanban_resume_run`.**
  The previous `kanban_*_pipeline` names remain registered as `[DEPRECATED]`
  aliases delegating to the same handlers, with identical schemas and return
  shapes — no breaking change for existing clients. Each alias call emits a
  single `deprecated_tool_call` WARN line. (#179)

### Changed
- Docs and the Folio lesson pages now reference the canonical run-verb tool
  names. (#179)

### Fixed
- **`kanban_get_run_logs` could not read any run on a live install.** The run
  resolver destructured a non-existent `openStore` export, threw, and fell back
  to `data/runs/<runId>/run.json` — a file that stopped existing once runs moved
  to SQLite. Every real run resolved to `RUN_NOT_FOUND` even though
  `kanban_get_run_status` found the same id. (#186)
- **Loop-injection signals were silently dropped at the last pipeline stage.**
  An agent writing `stage-<N+1>.inject` instead of `stage-<N>.inject` self-healed
  mid-pipeline but was permanently orphaned at the final stage — a QA agent
  requesting a developer re-run after a Critical bug got no re-run, and the
  pipeline reported success anyway. The last stage now falls back to the
  off-by-one filename, and consumed inject files are deleted so a reindexed
  stage can't re-read a stale signal. (#181)
- **Resumed runs stayed stuck as ACTIVE in the Runs panel.** (#182)
- **Folio stage injection was silently disabled by an FTS5 syntax error** —
  the search query threw, was swallowed, and stages ran with no injected
  context. (#183)
- **Tooltip descriptions overflowed the bubble on long text** — the description
  paragraph no longer carries `whitespace-nowrap` and wraps within the bubble's
  max width. (#184)
- Demo GIF: fixed a lingering icon-font race and raised capture quality
  (760 → 900px, less lossy). (#178)

## [1.4.0] — 2026-07-16

Headline: **Polish pass** — a batch of accessibility, consistency, and tech-debt
fixes across the board, plus a consolidated Preferences tab that removes a
redundant, partially-broken settings surface.

### Added
- **Keyboard-accessible in-column task reorder** — task cards are now focusable
  (`Tab`/`Shift+Tab`) with a visible focus ring, and a focused card responds to
  **`Alt+↑` / `Alt+↓`** to move one slot up or down within its column. The same
  action is available as discoverable **Move up / Move down** buttons in the
  card's action toolbar (also serving mouse users who prefer clicks to drag).
  Each reorder — and each boundary hit — is announced via a shared visually-
  hidden `aria-live` region for screen-reader users. Respects the active arc
  filter and, when arc grouping is on, stays within the card's arc group.
  Closes WCAG 2.2 AA gaps 2.1.1 (Keyboard), 2.4.7 (Focus Visible),
  2.5.7 (Dragging Movements), and 4.1.3 (Status Messages) for the board.
  Reuses the existing rank persistence (`reorderTask` +
  `PATCH /api/v1/tasks/:id/rank`) — no backend or API change.

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

- **Preferences tab in Config panel** — theme, prompt delivery method, pipeline
  defaults, agent-prompt defaults, and custom instructions now live in a single
  "Preferences" tab alongside "Agents & Routing" and "Files". (#176)
- **Touch-friendly in-column reorder** — ↑ / ↓ buttons in the card action menu
  work as a drag-and-drop alternative on touch devices, where the previous
  HTML5 drag handle never fired. (#175)
- Task rank is now included in the `POST /tasks` response body, so a newly
  created card appears in its correct position without a reload. (#175)

### Changed
- **Removed the standalone "Agent Settings" panel and its header button.**
  Its own copy claimed to govern Generate Tasks/Auto-tag, but those already
  routed through Agents & Routing's per-agent resolver — the panel only
  ever affected the ad-hoc prompt Launcher. (#176)
- **Removed the redundant global "AI Provider" (CLI tool) picker.** The
  Launcher now resolves each agent's CLI/model via the same per-agent
  resolver as the pipeline, Generate Tasks, and Auto-tag — one source of
  truth instead of two overlapping settings surfaces. Custom-binary support
  is dropped for now; it returns as a routing option in Agents & Routing.
  (#176)
- `isMutating` is now scoped to the specific task being moved/deleted
  instead of freezing every card on the board during a single mutation.
  (#175)
- Deduplicated column-label constants that were declared separately in
  6+ frontend files into a single `constants/columns.ts` module. (#175)
- Deleted the dead `RunHistoryPanel` component subtree (superseded by
  `RunsPanel`) and its orphaned task-filter UI. (#175)
- Extracted shared field-length validation between task create and update
  in `tasks.js`, replacing two near-duplicate implementations. (#175)
- Bumped dependencies within semver range: `better-sqlite3`, `ws` (root);
  `react`, `react-dom`, `zustand`, `tailwindcss`, `@tailwindcss/vite`,
  `@tanstack/react-virtual`, `fuse.js`, and related `@types/*` packages
  (frontend). Major-version bumps (`vite` 5→8, `vitest` 2→4, `typescript`
  5→7, `@xterm/xterm` 5→6, `@dnd-kit/sortable` 8→10) are deferred to a
  dedicated migration — left as `npm outdated`.

### Fixed
- Atomic batch rank rebalance for drag-to-reorder (and, in a follow-up fix,
  for the keyboard/button reorder path too) — a mid-batch failure could
  previously leave a column with a mix of old and new ranks. (#175)
- Stale drag-over indicator no longer stays pinned to the last card when
  dropping in the empty space below all cards in a column. (#175)
- Spanish copy leaking into the otherwise English-only header/search UI.
  (#175)
- Arc-strip banner (the coloured storyline label at the top of a card) now
  bleeds flush to both edges — it previously left a gap on the left side
  because it only compensated for the card's symmetric padding, not the
  extra left padding reserved for the drag handle.
- Drag-handle icon is now centred within its own gutter and on the card
  body's height (excluding the arc-strip banner), instead of centring on
  the whole card and nearly overlapping the title text.

## [1.3.0] — 2026-07-08

Headline: **Per-stage model & CLI routing** — every pipeline agent can now run on a
different model and CLI, including **opencode** against any OpenAI-compatible endpoint
(local, self-hosted, or third-party), not just Claude.

### Added
- **Agents & Routing panel** — configure each agent's CLI tool + model from the UI, with
  resolved source shown (global / space / task) and inline editing. (#155)
- **opencode support** — a second, model-agnostic CLI alongside Claude Code. Routing
  resolves per stage: task override → space override → global setting → the agent's own
  frontmatter default. (#155)
- Isolated pipeline stages get the worktree as their actual process `cwd`, not just a
  prompt instruction — fixes a stage on a non-Claude CLI silently operating on the base
  checkout instead of its isolated branch. (#155)
- Pipeline stage logs now render real content for non-Claude ("plain" source) stages
  instead of an empty summary card, and update live instead of freezing at the first
  poll. (#155)

### Changed
- `resolveAgent` now searches a project's `.claude/agents/` before falling back to the
  global directory, so a project can override an agent definition without touching the
  user's global config. (#159)
- README rewritten to document per-stage routing and opencode setup — it previously
  assumed Claude Code as the only CLI. (#160)

## [1.2.0] — 2026-06-22

Headline: **Arc** — narrative grouping for tasks, plus space pinning, per-run worktree
isolation, and a working-directory file browser.

### Added
- **Arc field** — an optional narrative grouping label on tasks, independent of type.
  - Per-arc tinted **strip** at the top of each card, coloured deterministically so
    same-arc cards read as a group at a glance.
  - **Arc bar** above the board to filter by arc or **Organize** (group cards by arc in
    each column); filtering and grouping are mutually exclusive.
  - Editable in the create modal and task detail via a combobox that suggests existing
    arcs (derived client-side) and accepts free-text new labels.
  - Inferable by the tagger; exposed on the REST API and `kanban_create_task` /
    `kanban_update_task` MCP tools. (#146)
- **Space pinning + responsive tab bar** — pin spaces, redesigned overflow, and tab-bar
  actions (+N / +) anchored to the right edge. (#137, #151)
- **Search pill in the header** — a visible ⌘K entry point for global search. (#142)
- **Working-directory file browser** — inline file tree to pick a space's working
  directory; `DirectoryPicker` gains file/directory modes. (#132, #136)
- **Per-run worktree isolation** — every pipeline run executes in its own git worktree. (#140)

### Changed
- Pipeline PRs target the run's **base branch** instead of always `main`. (#141)
- Pipeline prompt-block alignment + continuous folio compaction. (#133)
- Test setup sweeps stale `prism-test-config-*` fixtures. (#148)
- README: Folio demo GIF + layout redesign. (#134)

### Fixed
- Blank screen on mobile caused by `crypto.randomUUID` throwing outside secure contexts. (#138)
- Docker build failing on npm package lifecycle hooks. (#135)

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
