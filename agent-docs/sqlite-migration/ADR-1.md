# ADR-1: Migrate Prism persistence from JSON flat-files to SQLite (better-sqlite3)

## Status
Accepted

## Context

Prism stores all Kanban data in JSON flat-files:

- `data/spaces.json` — space manifest (all spaces, metadata, nicknames, pipelines)
- `data/spaces/<spaceId>/{todo,in-progress,done}.json` — per-space column arrays
- `data/agent-runs.jsonl` — agent run history (JSONL, max 500 entries)
- `data/settings.json` — server settings
- Pipeline run state in `data/runs/<runId>/run.json`

Every mutating handler reads the full file, merges the in-memory array, serialises the entire array, writes to `.tmp`, then renames to the target path. This "write the world for every write" pattern is correct for single-process single-request workloads but breaks down when multiple pipeline sub-processes run concurrently against the same space:

1. Two parallel pipeline agents that update different tasks in the same space both read the full column array, mutate their own task in memory, then write the whole array back. The second write silently clobbers the first, losing its task update.
2. The `.tmp` → rename trick is atomic at the filesystem level but only within a single process; two separate processes racing to write the same file can still collide.
3. There is no retry / back-off on EBUSY (macOS HFS+), so corruption is silent under high concurrency.

The parallel-worktrees feature (ADR, 2025) deliberately runs up to five concurrent pipeline stages, each operating in an isolated worktree but sharing the same `dataDir`. Concurrent writes to the same column JSON file are therefore guaranteed under normal usage.

## Decision

Replace the JSON flat-file storage layer for tasks, spaces, and comments with a single SQLite database (`prism.db`) managed via the `better-sqlite3` synchronous driver. All other data that is already isolated by nature (pipeline run files, agent-runs JSONL, settings, config files, worktree checkouts) is left on the filesystem.

The new storage layer is encapsulated in a single module — `src/services/store.js` — that exposes the same logical interface used today by `tasks.js`, `spaceManager.js`, and `comments.js`. HTTP handlers require only cosmetic changes (swap `readColumn`/`writeColumn` calls for Store method calls); no route logic, validation, or middleware changes.

## Rationale

**Why SQLite?**

- `better-sqlite3` is a synchronous, process-local driver. It fits Prism's single-threaded Node.js model perfectly: no async complexity, no event-loop impact, no connection pool.
- SQLite uses Write-Ahead Logging (WAL mode) which allows concurrent readers + one writer without blocking reads. All writes from the same process are serialised by the driver itself — exactly what is needed.
- SQLite's `BEGIN IMMEDIATE` transactions turn the current read-modify-write pattern for move/update/clear into an atomic unit, eliminating the TOCTOU race entirely.
- `better-sqlite3` has zero native dependencies that aren't already present on macOS / Linux and runs with Node's prebuilt binaries on supported platforms.
- The DB is a single file, which is as easy to back up, inspect, and version as the JSON files it replaces.

**Why not keep the JSON files?**

The atomic rename trick (`.tmp → target`) is POSIX-atomic for a single writer. With multiple concurrent processes, the race window is between the `readFileSync` and `renameSync` calls in the second writer. Mutexes or file-locking at the process level would solve the single-machine case but add complexity and do not generalise to the Docker deployment path.

**Why not Postgres / another DB?**

Prism is a local-first developer tool. Its deployment story is `node server.js` or `docker compose up`. A separate database process would break that simplicity. SQLite with WAL mode is the canonical solution for this exact class of problem.

## Schema

```sql
-- Spaces: replaces data/spaces.json
CREATE TABLE spaces (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  working_directory   TEXT,
  pipeline            TEXT,          -- JSON array of agent IDs, nullable
  project_claude_md   TEXT,
  agent_nicknames     TEXT,          -- JSON object, nullable
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- Tasks: replaces data/spaces/<id>/{todo,in-progress,done}.json
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  space_id    TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  column      TEXT NOT NULL CHECK(column IN ('todo','in-progress','done')),
  title       TEXT NOT NULL,
  type        TEXT NOT NULL,
  description TEXT,
  assigned    TEXT,
  pipeline    TEXT,          -- JSON array, nullable
  attachments TEXT,          -- JSON array, nullable
  comments    TEXT,          -- JSON array, nullable
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_tasks_space_column ON tasks(space_id, column);
CREATE INDEX idx_tasks_space_assigned ON tasks(space_id, assigned);
CREATE INDEX idx_tasks_updated ON tasks(updated_at);
```

All JSON columns (`pipeline`, `attachments`, `comments`, `agent_nicknames`) are stored as serialised JSON strings. The Store module serialises on write and parses on read, keeping the JSON schema identical to the current flat-file format so callers see no change.

`agent-runs.jsonl`, `settings.json`, pipeline run files (`data/runs/`), worktree state, and config files are **not** migrated — they are append-only, isolated per run, or tiny single-object files where the JSON model is correct.

## Consequences

**Positive**
- Concurrent writes are safe: SQLite WAL + `BEGIN IMMEDIATE` prevents all TOCTOU races.
- Read performance improves for filtered queries (column filter, assigned filter) via index scans instead of full-array loads.
- The Store module boundary makes future schema changes (e.g. adding a `priority` column) trivially isolated.
- A single `prism.db` file is simpler to back up and inspect than dozens of JSON files.
- Existing tests need zero changes to their start-up path: `startServer({ dataDir: tmpDir })` now opens `<tmpDir>/prism.db` instead of creating JSON files.

**Negative / Risks**
- `better-sqlite3` is a native addon. It must be rebuilt for each Node.js version / OS combination. Mitigated by: prebuilt binaries are available for all LTS Node versions on macOS, Linux x64, and arm64; the Dockerfile pins the Node version; `npm install` fetches the correct binary automatically.
- SQLite is not suitable if Prism is ever deployed as a multi-node cluster (horizontal scale). Mitigated by: Prism is explicitly a single-node local-first tool; this constraint is already documented.
- Developers who inspect data directly via `cat data/spaces/<id>/todo.json` will need to use `sqlite3 prism.db` instead. Mitigated by: the migration script and documentation describe this.

**Rollback strategy**
JSON files are preserved until the operator explicitly deletes them. The migration script is idempotent: if run again on a DB that already has the data, it skips records by `INSERT OR IGNORE`. To roll back: stop the server, delete `prism.db`, remove `better-sqlite3` from `package.json`, restore the original `src/services/store.js` and handler files from git, restart. The original JSON files are untouched and will be read normally.

## Alternatives Considered

- **File-level mutex (proper-lockfile)**: serialises concurrent writers at the process level but not across Docker replicas; adds async complexity; does not fix the TOCTOU window on Linux ext4 (no mandatory locking).
- **In-process write queue (async queue per space)**: solves the single-process case but requires all pipeline agent processes to share the same Node process — incompatible with the spawn-based `pipelineManager` design.
- **Postgres / MySQL**: correct for the concurrency problem but requires an external process; breaks the `node server.js` deployment model that is a core Prism design constraint.
- **LevelDB / LMDB**: no meaningful advantage over SQLite for this workload; less tooling and worse ergonomics for ad-hoc inspection.

## Alternatives Considered (migration approach)

- **In-place migration at startup**: run migration inside `server.js` before accepting connections. Risk: if migration fails mid-way, server does not start. Mitigated by making migration transactional (single SQLite `BEGIN` wrapping all inserts). Chosen approach.
- **Dual-write transitional period**: write to both JSON and SQLite for N releases. Adds complexity and does not eliminate the race. Rejected.
- **Background migration**: server starts serving from JSON while migrating to SQLite in the background. Dangerous: concurrent readers would see stale data. Rejected.

## Review
Suggested review date: 2026-10-29
