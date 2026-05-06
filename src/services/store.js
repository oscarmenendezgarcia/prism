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

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS spaces (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  working_directory TEXT,
  pipeline          TEXT,
  project_claude_md TEXT,
  agent_nicknames   TEXT,
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

  console.log(`[store] open — WAL mode confirmed, schema ready (${dbPath})`);

  // ---------------------------------------------------------------------------
  // Prepared statements (compiled once, reused for every call)
  // ---------------------------------------------------------------------------

  const stmts = {
    listSpaces:    db.prepare('SELECT * FROM spaces ORDER BY created_at ASC'),
    getSpace:      db.prepare('SELECT * FROM spaces WHERE id = ?'),
    upsertSpace:   db.prepare(`
      INSERT OR REPLACE INTO spaces
        (id, name, working_directory, pipeline, project_claude_md, agent_nicknames, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)
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
        (id, space_id, column, title, type, description, assigned, pipeline, attachments, comments, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    upsertTask: db.prepare(`
      INSERT OR IGNORE INTO tasks
        (id, space_id, column, title, type, description, assigned, pipeline, attachments, comments, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateTask: db.prepare(`
      UPDATE tasks
         SET title = ?, type = ?, description = ?, assigned = ?,
             pipeline = ?, attachments = ?, comments = ?, updated_at = ?
       WHERE space_id = ? AND id = ?
    `),
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
   * Used by migrator and SpaceManager.
   */
  function upsertSpace(space) {
    stmts.upsertSpace.run(
      space.id,
      space.name,
      space.workingDirectory !== undefined ? JSON.stringify(space.workingDirectory) : null,
      space.pipeline          !== undefined ? JSON.stringify(space.pipeline)         : null,
      space.projectClaudeMdPath !== undefined ? JSON.stringify(space.projectClaudeMdPath) : null,
      space.agentNicknames    !== undefined ? JSON.stringify(space.agentNicknames)  : null,
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
    stmts.insertTask.run(
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
    );
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

    stmts.updateTask.run(
      merged.title,
      merged.type,
      merged.description !== undefined ? JSON.stringify(merged.description) : null,
      merged.assigned    !== undefined ? JSON.stringify(merged.assigned)    : null,
      merged.pipeline    !== undefined ? JSON.stringify(merged.pipeline)    : null,
      merged.attachments !== undefined ? JSON.stringify(merged.attachments) : null,
      merged.comments    !== undefined ? JSON.stringify(merged.comments)    : null,
      merged.updatedAt,
      spaceId,
      taskId,
    );

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

  function deleteTask(spaceId, taskId) {
    const info = stmts.deleteTask.run(spaceId, taskId);
    return info.changes > 0;
  }

  /**
   * Delete all tasks for a space. Returns the number of deleted rows.
   */
  function clearSpace(spaceId) {
    const info = stmts.clearSpace.run(spaceId);
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
      const rows = stmts.searchTasks.all(trimmedQuery, spaceId, limit);
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
      const rows = stmts.searchAllTasks.all(trimmedQuery, limit);
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
  function listRuns({ limit, offset } = {}) {
    if (limit !== undefined) {
      return stmts.listRunsLimitOffset.all(limit, offset ?? 0).map(rowToRun);
    }
    return stmts.listRuns.all().map(rowToRun);
  }

  /**
   * Return runs whose status is active (pending/running/blocked/paused).
   * @returns {object[]}
   */
  function listActiveRuns() {
    return stmts.listActiveRuns.all().map(rowToRun);
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
    // Pipeline runs
    getRun,
    upsertRun,
    listRuns,
    listActiveRuns,
    findActiveRunByTaskId,
    deleteRun: deleteRun,
    // Lifecycle
    close,
  };
}

module.exports = { createStore };
