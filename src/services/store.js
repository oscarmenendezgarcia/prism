'use strict';

/**
 * Prism — SQLite Store
 *
 * Single source of truth for all SQLite DDL and CRUD operations for spaces
 * and tasks. Uses better-sqlite3 (synchronous) to match the existing
 * synchronous handler patterns throughout the codebase.
 *
 * Usage:
 *   const { createStore } = require('./store');
 *   const store = createStore(dataDir);       // opens/creates data/prism.db
 *   const store = createStore(':memory:');    // in-memory DB for unit tests
 */

const path = require('path');
const Database = require('better-sqlite3');

const { applySchema: applyFolioSchema }              = require('./folio/db');
const { createFolioService, openSqliteBackend }      = require('./folio/index');
const { applyBindingSchema, createFolioBinding }     = require('./folioBinding');
const { createFolioRouter }                          = require('./folioRouter');

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
-- Wait up to 5s for a write lock instead of throwing SQLITE_BUSY immediately.
-- WAL serialises concurrent writers (e.g. an HTTP request + the bootstrap apply
-- transaction); without this they collide and the loser throws. See the Folio
-- bootstrap transient-failure post-mortem (decision 16 in .folio/decisions/log).
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS spaces (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  working_directory TEXT,
  pipeline          TEXT,
  project_claude_md TEXT,
  agent_nicknames   TEXT,
  folio_backend     TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  space_id    TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  column      TEXT NOT NULL CHECK(column IN ('todo','in-progress','done')),
  title       TEXT NOT NULL,
  type        TEXT NOT NULL,
  description TEXT,
  assigned    TEXT,
  pipeline    TEXT,
  attachments TEXT,
  comments    TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_space_column   ON tasks(space_id, column);
CREATE INDEX IF NOT EXISTS idx_tasks_space_assigned ON tasks(space_id, assigned);
CREATE INDEX IF NOT EXISTS idx_tasks_updated        ON tasks(updated_at);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  run_id      TEXT PRIMARY KEY,
  space_id    TEXT NOT NULL,
  task_id     TEXT NOT NULL,
  status      TEXT NOT NULL,
  data        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_status      ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_task        ON pipeline_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_runs_space       ON pipeline_runs(space_id);
CREATE INDEX IF NOT EXISTS idx_runs_updated     ON pipeline_runs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_task_status ON pipeline_runs(task_id, status);

-- Full-text search virtual table (content-table mode keeps storage small).
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
  title,
  description,
  content='tasks',
  content_rowid='rowid'
);

-- Triggers to keep tasks_fts in sync with the tasks table.
CREATE TRIGGER IF NOT EXISTS tasks_fts_insert AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, title, description)
    VALUES (new.rowid, new.title, COALESCE(new.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_delete AFTER DELETE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description)
    VALUES ('delete', old.rowid, old.title, COALESCE(old.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_update AFTER UPDATE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description)
    VALUES ('delete', old.rowid, old.title, COALESCE(old.description, ''));
  INSERT INTO tasks_fts(rowid, title, description)
    VALUES (new.rowid, new.title, COALESCE(new.description, ''));
END;
`;

// ---------------------------------------------------------------------------
// JSON column helpers
// ---------------------------------------------------------------------------

/** Serialise a JS value to JSON or NULL. */
function toJson(value) {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

/** Parse a TEXT column value. Returns undefined when the DB value is null. */
function fromJson(value) {
  if (value === null || value === undefined) return undefined;
  return JSON.parse(value);
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToSpace(row) {
  if (!row) return null;
  const space = {
    id:        row.id,
    name:      row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const wd = fromJson(row.working_directory);
  if (wd !== undefined) space.workingDirectory = wd;
  const pl = fromJson(row.pipeline);
  if (pl !== undefined) space.pipeline = pl;
  const pcm = fromJson(row.project_claude_md);
  if (pcm !== undefined) space.projectClaudeMdPath = pcm;
  const an = fromJson(row.agent_nicknames);
  if (an !== undefined) space.agentNicknames = an;
  // folio_backend is a plain TEXT column (not JSON) — treat NULL as undefined.
  if (row.folio_backend != null) space.folioBackend = row.folio_backend;
  return space;
}

/**
 * Deserialise a pipeline_runs row into a run object.
 * The full run state is stored in the JSON blob `data`; the indexed columns
 * (space_id, task_id, status, created_at, updated_at) duplicate those fields
 * for query performance but the blob is the authoritative copy.
 */
function rowToRun(row) {
  if (!row) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    // Corrupt blob — reconstruct minimal object from indexed columns.
    return {
      runId:     row.run_id,
      spaceId:   row.space_id,
      taskId:    row.task_id,
      status:    row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function rowToTask(row) {
  if (!row) return null;
  const task = {
    id:        row.id,
    title:     row.title,
    type:      row.type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const desc = fromJson(row.description);
  if (desc !== undefined) task.description = desc;
  const asgn = fromJson(row.assigned);
  if (asgn !== undefined) task.assigned = asgn;
  const pl = fromJson(row.pipeline);
  if (pl !== undefined) task.pipeline = pl;
  const att = fromJson(row.attachments);
  if (att !== undefined) task.attachments = att;
  const cmt = fromJson(row.comments);
  if (cmt !== undefined) task.comments = cmt;
  const deps = fromJson(row.depends_on);
  if (deps !== undefined) task.dependsOn = deps;
  return task;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Store bound to the given data directory (or ':memory:' for tests).
 *
 * @param {string} dataDir - Absolute path to the data directory, or ':memory:'.
 * @returns {Store}
 */
function createStore(dataDir) {
  const dbPath = dataDir === ':memory:'
    ? ':memory:'
    : path.join(dataDir, 'prism.db');

  const db = new Database(dbPath);

  // Apply schema (idempotent — uses IF NOT EXISTS).
  // exec() runs multi-statement SQL; also applies the PRAGMAs.
  db.exec(SCHEMA_SQL);

  // Additive migration: folio_backend column (T-001 — folio backend selection).
  // Guarded by PRAGMA table_info so it runs once and is idempotent on existing DBs.
  {
    const cols = db.pragma('table_info(spaces)');
    if (!cols.some((c) => c.name === 'folio_backend')) {
      db.exec('ALTER TABLE spaces ADD COLUMN folio_backend TEXT');
      console.log('[store] migration: added folio_backend column to spaces');
    }
  }

  // Additive migration: depends_on column (QOL-3 — task dependencies).
  {
    const cols = db.pragma('table_info(tasks)');
    if (!cols.some((c) => c.name === 'depends_on')) {
      db.exec('ALTER TABLE tasks ADD COLUMN depends_on TEXT');
      console.log('[store] migration: added depends_on column to tasks');
    }
  }

  // Apply Folio core schema (space-agnostic) and Prism binding schema.
  applyFolioSchema(db);
  applyBindingSchema(db);

  console.log(`[store] open — WAL mode confirmed, schema ready (${dbPath})`);

  // Create Folio facade (SQLite backend = Prism's prism.db) and Prism-side binding.
  // The facade is a superset of the core store surface; folioBinding consumes it unchanged.
  const folioCore    = createFolioService(openSqliteBackend({ db }));
  const folioBinding = createFolioBinding(db, folioCore);

  // Build the backend router (T-004/T-005 — folio-backend-selection).
  // The router becomes store.folio.binding; sqliteBinding is kept as store.folio.sqliteBinding.
  const folioRouter = createFolioRouter({
    db,
    sqliteBinding: folioBinding,
    getSpace: (spaceId) => {
      // Inline getter that reads directly from the store (avoids circular require).
      return rowToSpace(stmts.getSpace.get(spaceId));
    },
  });
  // Inject the SQLite core so resolveRefs on the SQLite path works.
  folioRouter.setSqliteCore(folioCore);

  // ---------------------------------------------------------------------------
  // Prepared statements (compiled once, reused for every call)
  // ---------------------------------------------------------------------------

  const stmts = {
    listSpaces:    db.prepare('SELECT * FROM spaces ORDER BY created_at ASC'),
    getSpace:      db.prepare('SELECT * FROM spaces WHERE id = ?'),
    upsertSpace:   db.prepare(`
      INSERT INTO spaces
        (id, name, working_directory, pipeline, project_claude_md, agent_nicknames, folio_backend, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name              = excluded.name,
        working_directory = excluded.working_directory,
        pipeline          = excluded.pipeline,
        project_claude_md = excluded.project_claude_md,
        agent_nicknames   = excluded.agent_nicknames,
        folio_backend     = excluded.folio_backend,
        updated_at        = excluded.updated_at
    `),
    deleteSpace:   db.prepare('DELETE FROM spaces WHERE id = ?'),

    getTasksByColumn: db.prepare(
      'SELECT * FROM tasks WHERE space_id = ? AND column = ? ORDER BY created_at ASC'
    ),
    getAllTasksForSpace: db.prepare(
      'SELECT * FROM tasks WHERE space_id = ? ORDER BY created_at ASC'
    ),
    getTask: db.prepare(
      'SELECT * FROM tasks WHERE space_id = ? AND id = ?'
    ),
    getTaskById: db.prepare(
      'SELECT *, space_id AS _space_id, column AS _column FROM tasks WHERE id = ? LIMIT 1'
    ),
    insertTask: db.prepare(`
      INSERT INTO tasks
        (id, space_id, column, title, type, description, assigned, pipeline, attachments, comments, created_at, updated_at, depends_on)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    upsertTask: db.prepare(`
      INSERT OR IGNORE INTO tasks
        (id, space_id, column, title, type, description, assigned, pipeline, attachments, comments, created_at, updated_at, depends_on)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateTask: db.prepare(`
      UPDATE tasks
         SET title = ?, type = ?, description = ?, assigned = ?,
             pipeline = ?, attachments = ?, comments = ?, depends_on = ?, updated_at = ?
       WHERE space_id = ? AND id = ?
    `),
    updateTaskDependsOn: db.prepare(`
      UPDATE tasks SET depends_on = ?, updated_at = ? WHERE space_id = ? AND id = ?
    `),
    getTasksWithDepsInSpace: db.prepare(
      `SELECT id, depends_on FROM tasks WHERE space_id = ? AND depends_on IS NOT NULL`
    ),
    moveTask: db.prepare(`
      UPDATE tasks
         SET column = ?, updated_at = ?
       WHERE space_id = ? AND id = ?
    `),
    deleteTask:  db.prepare('DELETE FROM tasks WHERE space_id = ? AND id = ?'),
    clearSpace:  db.prepare('DELETE FROM tasks WHERE space_id = ?'),
    searchTasks: db.prepare(`
      SELECT t.*
        FROM tasks_fts
        JOIN tasks t ON t.rowid = tasks_fts.rowid
       WHERE tasks_fts MATCH ?
         AND t.space_id = ?
       ORDER BY rank
       LIMIT ?
    `),
    searchAllTasks: db.prepare(`
      SELECT t.*, t.space_id AS _space_id, t.column AS _column
        FROM tasks_fts
        JOIN tasks t ON t.rowid = tasks_fts.rowid
       WHERE tasks_fts MATCH ?
       ORDER BY rank
       LIMIT ?
    `),

    // ── pipeline_runs ────────────────────────────────────────────────────────
    getRun: db.prepare(
      'SELECT * FROM pipeline_runs WHERE run_id = ?'
    ),
    upsertRun: db.prepare(`
      INSERT OR REPLACE INTO pipeline_runs
        (run_id, space_id, task_id, status, data, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
    `),
    listRuns: db.prepare(
      'SELECT * FROM pipeline_runs ORDER BY updated_at DESC'
    ),
    listRunsLimitOffset: db.prepare(
      'SELECT * FROM pipeline_runs ORDER BY updated_at DESC LIMIT ? OFFSET ?'
    ),
    listActiveRuns: db.prepare(`
      SELECT * FROM pipeline_runs
       WHERE status IN ('pending', 'running', 'blocked', 'paused')
       ORDER BY updated_at DESC
    `),
    findActiveRunByTaskId: db.prepare(`
      SELECT * FROM pipeline_runs
       WHERE task_id = ?
         AND status IN ('pending', 'running', 'blocked', 'paused')
       ORDER BY updated_at DESC
       LIMIT 1
    `),
    deleteRun: db.prepare(
      'DELETE FROM pipeline_runs WHERE run_id = ?'
    ),
  };

  // ---------------------------------------------------------------------------
  // Space operations
  // ---------------------------------------------------------------------------

  function listSpaces() {
    return stmts.listSpaces.all().map(rowToSpace);
  }

  function getSpace(id) {
    return rowToSpace(stmts.getSpace.get(id));
  }

  /**
   * Insert or replace a space row.
   * Used by SpaceManager and tests.
   */
  function upsertSpace(space) {
    stmts.upsertSpace.run(
      space.id,
      space.name,
      space.workingDirectory !== undefined ? JSON.stringify(space.workingDirectory) : null,
      space.pipeline          !== undefined ? JSON.stringify(space.pipeline)         : null,
      space.projectClaudeMdPath !== undefined ? JSON.stringify(space.projectClaudeMdPath) : null,
      space.agentNicknames    !== undefined ? JSON.stringify(space.agentNicknames)  : null,
      // folio_backend is a plain TEXT column — store as-is or NULL.
      space.folioBackend !== undefined ? space.folioBackend : null,
      space.createdAt,
      space.updatedAt,
    );
  }

  function deleteSpace(id) {
    stmts.deleteSpace.run(id);
  }

  // ---------------------------------------------------------------------------
  // Task operations
  // ---------------------------------------------------------------------------

  function getTasksByColumn(spaceId, column) {
    return stmts.getTasksByColumn.all(spaceId, column).map(rowToTask);
  }

  function getAllTasksForSpace(spaceId) {
    return stmts.getAllTasksForSpace.all(spaceId).map(rowToTask);
  }

  function getTask(spaceId, taskId) {
    return rowToTask(stmts.getTask.get(spaceId, taskId));
  }

  function getTaskWithColumn(spaceId, taskId) {
    const row = stmts.getTask.get(spaceId, taskId);
    if (!row) return null;
    return { task: rowToTask(row), column: row.column };
  }

  /**
   * Look up a task by ID across ALL spaces (no spaceId required).
   * Returns { task, spaceId, column } or null when not found.
   * Uses a direct primary-key scan — O(1), does not go through FTS5.
   *
   * @param {string} taskId
   * @returns {{ task: object, spaceId: string, column: string } | null}
   */
  function getTaskById(taskId) {
    const row = stmts.getTaskById.get(taskId);
    if (!row) return null;
    return {
      task:    rowToTask(row),
      spaceId: row._space_id,
      column:  row._column,
    };
  }

  function insertTask(task, spaceId, column) {
    withFtsRecovery(() => stmts.insertTask.run(
      task.id,
      spaceId,
      column,
      task.title,
      task.type,
      task.description !== undefined ? JSON.stringify(task.description) : null,
      task.assigned    !== undefined ? JSON.stringify(task.assigned)    : null,
      task.pipeline    !== undefined ? JSON.stringify(task.pipeline)    : null,
      task.attachments !== undefined ? JSON.stringify(task.attachments) : null,
      task.comments    !== undefined ? JSON.stringify(task.comments)    : null,
      task.createdAt,
      task.updatedAt,
      task.dependsOn   !== undefined ? JSON.stringify(task.dependsOn)  : null,
    ));
  }

  /**
   * Insert a task row if it does not already exist (idempotent, for migration).
   */
  function upsertTask(task, spaceId, column) {
    const info = stmts.upsertTask.run(
      task.id,
      spaceId,
      column,
      task.title,
      task.type,
      task.description !== undefined ? JSON.stringify(task.description) : null,
      task.assigned    !== undefined ? JSON.stringify(task.assigned)    : null,
      task.pipeline    !== undefined ? JSON.stringify(task.pipeline)    : null,
      task.attachments !== undefined ? JSON.stringify(task.attachments) : null,
      task.comments    !== undefined ? JSON.stringify(task.comments)    : null,
      task.createdAt,
      task.updatedAt,
      task.dependsOn   !== undefined ? JSON.stringify(task.dependsOn)  : null,
    );
    if (info.changes === 0) {
      console.warn(`[store] WARN: upsertTask INSERT OR IGNORE skipped existing id=${task.id}`);
    }
    return info;
  }

  /**
   * Apply a patch object to an existing task row and return the updated task.
   * Patch keys mirror the task's JS shape (camelCase).
   * Returns null when the task is not found.
   */
  function updateTask(spaceId, taskId, patch) {
    const existing = getTask(spaceId, taskId);
    if (!existing) return null;

    const merged = { ...existing, ...patch };

    withFtsRecovery(() => stmts.updateTask.run(
      merged.title,
      merged.type,
      merged.description !== undefined ? JSON.stringify(merged.description) : null,
      merged.assigned    !== undefined ? JSON.stringify(merged.assigned)    : null,
      merged.pipeline    !== undefined ? JSON.stringify(merged.pipeline)    : null,
      merged.attachments !== undefined ? JSON.stringify(merged.attachments) : null,
      merged.comments    !== undefined ? JSON.stringify(merged.comments)    : null,
      merged.dependsOn   !== undefined ? JSON.stringify(merged.dependsOn)  : null,
      merged.updatedAt,
      spaceId,
      taskId,
    ));

    return merged;
  }

  /**
   * Move a task to a different column atomically (single UPDATE, no read-modify-write).
   * Returns the updated task object, or null if not found.
   */
  function moveTask(spaceId, taskId, toColumn) {
    const now = new Date().toISOString();

    const move = db.transaction(() => {
      const info = stmts.moveTask.run(toColumn, now, spaceId, taskId);
      if (info.changes === 0) return null;
      return getTask(spaceId, taskId);
    });

    return move();
  }

  function rebuildFts() {
    db.exec("INSERT INTO tasks_fts(tasks_fts) VALUES('rebuild')");
    console.warn('[store] FTS index rebuilt after SQLITE_CORRUPT_VTAB');
  }

  function withFtsRecovery(fn) {
    try {
      return fn();
    } catch (err) {
      if (err.code === 'SQLITE_CORRUPT_VTAB') {
        rebuildFts();
        return fn();
      }
      throw err;
    }
  }

  /**
   * Detect whether adding newDepIds as dependencies from fromId would create a cycle.
   * Uses DFS from each new dep; if fromId is reachable, a cycle exists.
   *
   * @param {Array} allTasks - All tasks in the space (each with id and dependsOn).
   * @param {string} fromId  - The task that will gain the new deps.
   * @param {string[]} newDepIds - The proposed dependency IDs.
   * @returns {boolean} true if a cycle would be created.
   */
  function detectCycle(allTasks, fromId, newDepIds) {
    // Build adjacency map: taskId → dependsOn[]
    const adj = {};
    for (const t of allTasks) {
      adj[t.id] = t.dependsOn ?? [];
    }
    // Tentatively apply new edges
    adj[fromId] = newDepIds;

    // DFS from each new dep — if fromId is reachable, cycle exists
    for (const startId of newDepIds) {
      const visited = new Set();
      const stack = [startId];
      while (stack.length > 0) {
        const curr = stack.pop();
        if (curr === fromId) return true;
        if (visited.has(curr)) continue;
        visited.add(curr);
        for (const next of (adj[curr] ?? [])) {
          stack.push(next);
        }
      }
    }
    return false;
  }

  /**
   * Set the dependsOn array for a task, validating existence and cycles.
   * @param {string} spaceId
   * @param {string} taskId
   * @param {string[]} depIds
   * @returns {{ task: object } | { error: string, code: string }}
   */
  function setTaskDependencies(spaceId, taskId, depIds) {
    // Validate taskId exists
    const taskRow = stmts.getTask.get(spaceId, taskId);
    if (!taskRow) return { error: 'Task not found', code: 'TASK_NOT_FOUND' };

    // Load all tasks for cycle detection + existence check
    const allTasks = stmts.getAllTasksForSpace.all(spaceId).map(rowToTask);
    const taskIdSet = new Set(allTasks.map(t => t.id));

    // Validate each depId exists in same space
    for (const depId of depIds) {
      if (!taskIdSet.has(depId)) {
        console.log(`[store] dependency not found: ${depId} in space ${spaceId}`);
        return { error: `Dependency task not found: ${depId}`, code: 'DEPENDENCY_NOT_FOUND' };
      }
    }

    // Detect cycle
    if (detectCycle(allTasks, taskId, depIds)) {
      console.log(`[store] cycle detected: ${taskId} → ${JSON.stringify(depIds)}`);
      return { error: 'Cycle detected in task dependencies', code: 'CYCLE_DETECTED' };
    }

    // Persist
    const now = new Date().toISOString();
    const depsJson = depIds.length > 0 ? JSON.stringify(depIds) : null;
    stmts.updateTaskDependsOn.run(depsJson, now, spaceId, taskId);

    const updated = getTask(spaceId, taskId);
    return { task: updated };
  }

  /**
   * Derive isBlocked / blockedByCount for each task based on its dependsOn and
   * the set of done task IDs.
   *
   * @param {Array} tasks - Tasks with _col field (from getAllTasksForSpaceWithStatus).
   * @returns {Array} Same tasks with isBlocked / blockedByCount added where applicable.
   */
  function deriveBlockedStatus(tasks) {
    const doneIds = new Set(
      tasks.filter(t => t._col === 'done').map(t => t.id)
    );
    return tasks.map(t => {
      const deps = t.dependsOn ?? [];
      if (deps.length === 0) return t;
      const blockedByCount = deps.filter(id => !doneIds.has(id)).length;
      return {
        ...t,
        isBlocked: blockedByCount > 0,
        blockedByCount,
      };
    });
  }

  /**
   * Get all tasks for a space with derived isBlocked / blockedByCount fields.
   * Each task has a _col field indicating its column.
   *
   * @param {string} spaceId
   * @returns {Array}
   */
  function getAllTasksForSpaceWithStatus(spaceId) {
    const rows = stmts.getAllTasksForSpace.all(spaceId);
    const tasks = rows.map(row => ({ ...rowToTask(row), _col: row.column }));
    return deriveBlockedStatus(tasks);
  }

  function deleteTask(spaceId, taskId) {
    const doDelete = db.transaction(() => {
      const info = withFtsRecovery(() => stmts.deleteTask.run(spaceId, taskId));
      if (info.changes === 0) return false;

      // Clean up reverse references in other tasks' dependsOn arrays
      const rows = stmts.getTasksWithDepsInSpace.all(spaceId);
      let cleanedCount = 0;
      const now = new Date().toISOString();
      for (const row of rows) {
        const deps = JSON.parse(row.depends_on);
        if (!deps.includes(taskId)) continue;
        const newDeps = deps.filter(id => id !== taskId);
        stmts.updateTaskDependsOn.run(
          newDeps.length > 0 ? JSON.stringify(newDeps) : null,
          now, spaceId, row.id
        );
        cleanedCount++;
      }
      if (cleanedCount > 0) {
        console.log(`[store] deleteTask: cleaned dependsOn refs in ${cleanedCount} tasks`);
      }
      return true;
    });
    return doDelete();
  }

  /**
   * Delete all tasks for a space. Returns the number of deleted rows.
   */
  function clearSpace(spaceId) {
    const info = withFtsRecovery(() => stmts.clearSpace.run(spaceId));
    return info.changes;
  }

  /**
   * Full-text search over task title and description within a single space.
   *
   * Uses FTS5 MATCH operator; results are ordered by relevance (rank).
   * Returns an empty array when query is blank or contains only whitespace.
   *
   * @param {string} spaceId
   * @param {string} query   - User-supplied search string (FTS5 query syntax).
   * @param {object} [opts]
   * @param {number} [opts.limit=20] - Maximum number of results to return.
   * @returns {Array<object>} Array of task objects in the same shape as getTask().
   */
  function searchTasks(spaceId, query, { limit = 20 } = {}) {
    if (!query || query.trim().length === 0) return [];

    const trimmedQuery = query.trim();

    // FTS5 MATCH with rank ordering via bm25() implicit score column.
    // The content-table join ensures we only touch tasks for the given space.
    // Uses the pre-compiled stmts.searchTasks statement (compiled once at startup).
    try {
      const rows = withFtsRecovery(() => stmts.searchTasks.all(trimmedQuery, spaceId, limit));
      return rows.map(rowToTask);
    } catch (err) {
      // FTS5 MATCH throws on malformed query strings (e.g. unmatched quotes).
      // Return an empty result rather than crashing the handler.
      console.error(`[store] searchTasks FTS5 error — query="${trimmedQuery}":`, err.message);
      return [];
    }
  }

  /**
   * Full-text search over task title and description across ALL spaces.
   *
   * Uses FTS5 MATCH operator; results are ordered by relevance (BM25 rank).
   * Returns an empty array when query is blank or contains only whitespace.
   *
   * @param {string} query           - User-supplied search string (FTS5 query syntax).
   * @param {object} [opts]
   * @param {number} [opts.limit=20] - Maximum number of results to return.
   * @returns {Array<{ task: object, spaceId: string, column: string }>}
   */
  function searchAllTasks(query, { limit = 20 } = {}) {
    if (!query || query.trim().length === 0) return [];

    const trimmedQuery = query.trim();

    try {
      const rows = withFtsRecovery(() => stmts.searchAllTasks.all(trimmedQuery, limit));
      return rows.map((row) => ({
        task:    rowToTask(row),
        spaceId: row._space_id,
        column:  row._column,
      }));
    } catch (err) {
      // FTS5 MATCH throws on malformed query strings (e.g. unmatched quotes).
      // Return an empty result rather than crashing the handler.
      console.error(`[store] searchAllTasks FTS5 error — query="${trimmedQuery}":`, err.message);
      return [];
    }
  }


  // ---------------------------------------------------------------------------
  // Pipeline run operations
  // ---------------------------------------------------------------------------

  /**
   * Read a run by ID.
   * @param {string} runId
   * @returns {object|null}
   */
  function getRun(runId) {
    return rowToRun(stmts.getRun.get(runId));
  }

  /**
   * Insert or replace a run row (atomic — single statement).
   * The full run object is stored in the `data` JSON blob; indexed columns are
   * extracted for query performance.
   *
   * @param {object} run - Must include runId, spaceId, taskId, status, createdAt, updatedAt.
   */
  function upsertRun(run) {
    stmts.upsertRun.run(
      run.runId,
      run.spaceId,
      run.taskId,
      run.status,
      JSON.stringify(run),
      run.createdAt,
      run.updatedAt,
    );
  }

  /**
   * List all runs ordered by updated_at DESC.
   *
   * @param {object} [opts]
   * @param {number} [opts.limit]  - Cap on result count.
   * @param {number} [opts.offset] - Skip this many rows (for pagination).
   * @returns {object[]}
   */
  // Folio side-agent runs (bootstrap, consolidation) are stored as single-stage
  // runs so their logs are viewable through the normal run log viewer, but they
  // are NOT pipeline runs — exclude them from the pipeline run lists / active-run
  // indicator. getRun() still returns them (the log viewer looks one up by id).
  const FOLIO_SURFACE_KINDS = new Set(['bootstrap', 'consolidation']);
  const notFolioSurface = (r) => r && !FOLIO_SURFACE_KINDS.has(r.kind);

  function listRuns({ limit, offset } = {}) {
    if (limit !== undefined) {
      return stmts.listRunsLimitOffset.all(limit, offset ?? 0).map(rowToRun).filter(notFolioSurface);
    }
    return stmts.listRuns.all().map(rowToRun).filter(notFolioSurface);
  }

  /**
   * Return runs whose status is active (pending/running/blocked/paused).
   * @returns {object[]}
   */
  function listActiveRuns() {
    return stmts.listActiveRuns.all().map(rowToRun).filter(notFolioSurface);
  }

  /**
   * Return the most-recently-updated active run for a given taskId, or null.
   * @param {string} taskId
   * @returns {object|null}
   */
  function findActiveRunByTaskId(taskId) {
    return rowToRun(stmts.findActiveRunByTaskId.get(taskId));
  }

  /**
   * Delete a run row.
   * @param {string} runId
   * @returns {boolean} true if a row was deleted.
   */
  function deleteRun(runId) {
    const info = stmts.deleteRun.run(runId);
    return info.changes > 0;
  }

  // ---------------------------------------------------------------------------
  // FTS maintenance
  // ---------------------------------------------------------------------------

  /**
   * Rebuild the FTS5 index from scratch using the content-table (tasks).
   *
   * Useful after bulk inserts (e.g. migration) where individual INSERT OR IGNORE
   * statements may not fire triggers for rows that already existed.
   */
  function rebuildFts() {
    db.exec("INSERT INTO tasks_fts(tasks_fts) VALUES ('rebuild')");
    console.log('[store] FTS5 index rebuilt');
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  function close() {
    // Close all cached file-backed FolioServices first (prevents open-handle leak).
    try { folioRouter.close(); } catch (_) {}
    db.close();
  }

  return {
    // Space
    listSpaces,
    getSpace,
    upsertSpace,
    deleteSpace,
    // Task
    getTasksByColumn,
    getAllTasksForSpace,
    getAllTasksForSpaceWithStatus,
    getTask,
    getTaskWithColumn,
    getTaskById,
    insertTask,
    upsertTask,
    updateTask,
    moveTask,
    deleteTask,
    clearSpace,
    searchTasks,
    searchAllTasks,
    rebuildFts,
    setTaskDependencies,
    // Pipeline runs
    getRun,
    upsertRun,
    listRuns,
    listActiveRuns,
    findActiveRunByTaskId,
    deleteRun: deleteRun,
    // Lifecycle
    close,
    // Folio — core (folio_id-keyed), backend-aware router (binding), and original SQLite binding.
    // Downstream consumers (MCP tools, resolver, injection) use `store.folio.binding` (the router).
    folio: {
      core:          folioCore,     // SQLite core — kept for back-compat; use binding for space ops.
      binding:       folioRouter,   // NEW: backend-aware router (same surface as before + resolveRefs).
      sqliteBinding: folioBinding,  // The original SQLite binding (router delegates to it for sqlite spaces).
    },
  };
}

module.exports = { createStore };
