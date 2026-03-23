# CHANGELOG — mcp-start-pipeline

Feature branch: `feature/mcp-start-pipeline`

---

## [T-001] Crear src/agentResolver.js

**Commit:** `[dev] T-001: Crear src/agentResolver.js`

**New file:** `src/agentResolver.js`

- Pure module that reads `~/.claude/agents/<agentId>.md` from disk.
- Parses YAML-style frontmatter with a regex — no YAML library required.
- Extracts `model:` field; defaults to `'sonnet'` if absent.
- Builds `spawnArgs` based on `PIPELINE_AGENT_MODE`:
  - `subagent` (default): `['--agent', agentId, '--print', '--no-auto-approve']`
  - `headless`: `['-p', systemPrompt, '--model', model, '--no-auto-approve']`
- Throws `AgentNotFoundError` (`.code = 'AGENT_NOT_FOUND'`) when the file does not exist.
- Exports: `resolveAgent`, `AgentNotFoundError`, `parseFrontmatter`.

---

## [T-002] Crear src/pipelineManager.js — registro y ciclo de vida de runs

**Commit:** `[dev] T-002: Crear src/pipelineManager.js — registro y ciclo de vida de runs`

**New file:** `src/pipelineManager.js`

- Manages the full pipeline run lifecycle: creation → stage execution → completion/failure.
- Run state persisted atomically to `data/runs/<runId>/run.json` (.tmp + rename).
- Global registry persisted to `data/runs/runs.json` for fast listing.
- Per-stage output streamed to `data/runs/<runId>/stage-<N>.log` via `createWriteStream`.
- `init(dataDir)`: scans runs directory on startup; marks any `status:'running'` run as `'interrupted'`.
- `createRun(params)`: validates task column, concurrency limit, and agent file existence; returns the run immediately (fire-and-forget).
- `executeNextStage` / `spawnStage`: advance pipeline stage by stage; emit structured JSON log lines to stderr.
- Timeout enforcement via `setTimeout` + `SIGTERM` (configurable via `PIPELINE_STAGE_TIMEOUT_MS`).
- `deleteRun`: sends `SIGTERM` to active process, removes run directory, removes registry entry.
- Exports: `init`, `createRun`, `getRun`, `listRuns`, `deleteRun`, `runsDir`, `runDir`, `stageLogPath`, `DEFAULT_STAGES`.

---

## [T-003] Añadir 4 endpoints REST en server.js

**Commit:** `[dev] T-003: Añadir 4 endpoints REST en server.js`

**Modified:** `server.js`, `.gitignore`
**New file:** `data/runs/.gitkeep`

- Imported `pipelineManager` at top of `server.js`.
- Added `pipelineManager.init(dataDir)` call after `spaceManager.ensureAllSpaces()`.
- Added 4 route handler functions:
  - `handleCreateRun` — `POST /api/v1/runs` → 201 run object
  - `handleGetRun` — `GET /api/v1/runs/:runId` → 200 or 404
  - `handleGetStageLog` — `GET /api/v1/runs/:runId/stages/:N/log?tail=N` → 200 text/plain or 404
  - `handleDeleteRun` — `DELETE /api/v1/runs/:runId` → 200 `{ deleted: true }` or 404
- Added regex route patterns `PIPELINE_RUNS_LOG_ROUTE`, `PIPELINE_RUNS_LIST_ROUTE`, `PIPELINE_RUNS_SINGLE_ROUTE`.
- Routes inserted in `mainRouter` before the legacy tasks shim; log route tested before single route.
- `.gitignore` updated to preserve `data/runs/.gitkeep`.
- Error codes handled: `TASK_NOT_FOUND` → 404, `TASK_NOT_IN_TODO` → 422, `MAX_CONCURRENT_REACHED` → 409, `AGENT_NOT_FOUND` → 422.

---

## [T-004] Extender mcp/kanban-client.js con startPipeline y getRunStatus

**Commit:** `[dev] T-004: Extender mcp/kanban-client.js con startPipeline y getRunStatus`

**Modified:** `mcp/kanban-client.js`

- Added `startPipeline({ spaceId, taskId, stages })` — calls `POST /runs`.
- Added `getRunStatus(runId)` — calls `GET /runs/:runId`.
- Both functions use the existing `request()` helper (same 5-second timeout, same error shape).
- Exported as named ESM exports following existing pattern.

---

## [T-005] Registrar kanban_start_pipeline y kanban_get_run_status en mcp-server.js

**Commit:** `[dev] T-005: Registrar kanban_start_pipeline y kanban_get_run_status en mcp-server.js`

**Modified:** `mcp/mcp-server.js`

- Imported `startPipeline` and `getRunStatus` from `kanban-client.js`.
- Registered `kanban_start_pipeline` tool with Zod schema: `spaceId` (string), `taskId` (string), `stages` (optional string array).
- Registered `kanban_get_run_status` tool with Zod schema: `runId` (string).
- Both tools use the existing `withTiming` wrapper for timing instrumentation.
- Updated startup log line to include the 2 new tool names (total: 14 tools).

---

## [T-006 + T-007] Tests unitarios e integración — pipelineManager y agentResolver

**Commit:** `[dev] T-006: Tests unitarios — pipelineManager y agentResolver`

**New file:** `tests/pipeline.test.js`

28 tests across 5 describe suites:

**agentResolver (6 tests):**
- `resolveAgent` in subagent mode returns correct `spawnArgs`
- `resolveAgent` in headless mode returns `-p` args with model
- `AgentNotFoundError` thrown for non-existent agent file
- `parseFrontmatter` extracts model and body
- `parseFrontmatter` uses default model when none specified
- `parseFrontmatter` handles file with no frontmatter

**pipelineManager — createRun validations (5 tests):**
- `TASK_NOT_FOUND` when task does not exist in space
- `TASK_NOT_IN_TODO` when task is in wrong column
- `MAX_CONCURRENT_REACHED` when concurrency limit reached
- `AGENT_NOT_FOUND` when stage agent file is missing
- Happy path: returns run with `status:'pending'` and persists to disk

**pipelineManager — getRun, deleteRun, listRuns (3 tests):**
- `getRun` returns null for unknown runId
- `deleteRun` removes run directory and registry entry
- `listRuns` returns all registered runs

**pipelineManager — init() startup recovery (3 tests):**
- `init` marks `running` runs as `interrupted`
- `init` does not modify `completed` runs
- `init` creates runs directory if it does not exist

**REST integration — pipeline endpoints (11 tests):**
- `POST /api/v1/runs` → 201 for task in todo
- `POST /api/v1/runs` → 422 for task not in todo
- `POST /api/v1/runs` → 404 for unknown taskId
- `POST /api/v1/runs` → 400 for missing spaceId
- `GET /api/v1/runs/:runId` → 200 with run object
- `GET /api/v1/runs/:runId` → 404 for unknown runId
- `GET /api/v1/runs/:runId/stages/1/log` → 404 LOG_NOT_AVAILABLE (stage not yet started)
- `DELETE /api/v1/runs/:runId` → 200 `{ deleted: true }`
- `DELETE /api/v1/runs/:runId` → 404 for unknown runId
- `GET /api/v1/runs/:runId/stages/99/log` → 404 STAGE_NOT_FOUND
- `GET /api/v1/runs/:runId/stages/0/log` → 200 text/plain (with manually written log)

---

## [T-008] Documentar variables de entorno en CLAUDE.md

**Modified:** `CLAUDE.md`

- Added "Pipeline configuration" section with table of all 5 environment variables.
- Added REST endpoints list to Stack section.
- Added MCP usage example for `kanban_start_pipeline` and `kanban_get_run_status`.
