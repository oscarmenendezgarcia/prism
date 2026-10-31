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

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { ACCOUNTS_SQL, API_TOKENS_SQL, createAccounts } = require('./accounts');
const { agentFromOldName } = require('../utils/agents');

const DEFAULT_PRIORITY = 'medium';

/** A new space's statuses. Their ids stay when renamed: the API and agents use them. */
const DEFAULT_STATUSES = [
  { id: 'todo',        name: 'To do',       category: 'todo' },
  { id: 'in-progress', name: 'In progress', category: 'in-progress' },
  { id: 'in-review',   name: 'In review',   category: 'in-progress' },
  { id: 'done',        name: 'Done',        category: 'done' },
];

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
-- Wait up to 5s for a write lock instead of throwing SQLITE_BUSY immediately.
-- WAL serialises concurrent writers; without this they collide and the loser throws.
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
  arc         TEXT,
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

/** How many cards a column shows until asked for more, and how much of a description a card gets. */
const BOARD_DEFAULT_LIMIT = 100;
const BOARD_DONE_LIMIT = 50;
const BOARD_DESCRIPTION_CHARS = 400;

const ISSUE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS statuses (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  id       TEXT NOT NULL,
  name     TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('todo','in-progress','done')),
  position INTEGER NOT NULL,
  PRIMARY KEY (space_id, id)
);

-- Every key a space has had: old links keep working, and nobody else can take them.
-- They outlive the space, or a new space would answer to the links of a deleted one.
CREATE TABLE IF NOT EXISTS space_keys (
  key      TEXT PRIMARY KEY,
  space_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author         TEXT NOT NULL,
  text           TEXT NOT NULL,
  type           TEXT NOT NULL,
  parent_id      TEXT,
  resolved       INTEGER NOT NULL DEFAULT 0,
  change_request INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT
);

CREATE TABLE IF NOT EXISTS task_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor      TEXT NOT NULL,
  field      TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_history_task  ON task_history(task_id, id);
CREATE INDEX IF NOT EXISTS idx_tasks_status  ON tasks(space_id, status_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent  ON tasks(parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_number ON tasks(space_id, number);
-- The board reads each column from either end, and counts what hangs from each card.
CREATE INDEX IF NOT EXISTS idx_tasks_board         ON tasks(space_id, status_id, rank, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_progress ON tasks(parent_id, space_id, column);
CREATE INDEX IF NOT EXISTS idx_tasks_epics         ON tasks(space_id) WHERE type = 'epic';
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
  // pinned + pinnedRank (space pinning). Columns default to 0/NULL.
  space.pinned = row.pinned === 1;
  if (row.pinned_rank != null) space.pinnedRank = row.pinned_rank;
  // MODEL-1: per-stage model routing overrides.
  const sm = fromJson(row.stage_models);
  if (sm !== undefined) space.stageModels = sm;
  const hooks = fromJson(row.hooks);
  if (hooks !== undefined) space.hooks = hooks;
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
    ...(row.space_key && row.number != null && { key: `${row.space_key}-${row.number}`, number: row.number }),
    statusId:  row.status_id ?? row.column,
    category:  row.column,
    title:     row.title,
    type:      row.type,
    priority:  row.priority ?? DEFAULT_PRIORITY,
    rank:      row.rank ?? 0,
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
  const labels = fromJson(row.labels);
  if (labels !== undefined) task.labels = labels;
  if (row.parent_id != null) task.parentId = row.parent_id;
  if (row.created_by != null) task.createdBy = row.created_by;
  if (row.due_date != null) task.dueDate = row.due_date;
  if (row.estimate != null) task.estimate = row.estimate;
  // MODEL-1: per-stage model routing overrides.
  const sm = fromJson(row.stage_models);
  if (sm !== undefined) task.stageModels = sm;
  const deps = fromJson(row.depends_on);
  if (deps !== undefined) task.dependsOn = deps;
  return task;
}

function rowToComment(row) {
  return {
    id:       row.id,
    author:   row.author,
    ...(row.author_id != null && { authorId: row.author_id }),
    text:     row.text,
    type:     row.type,
    ...(row.parent_id != null && { parentId: row.parent_id }),
    resolved: row.resolved === 1,
    ...(row.change_request === 1 && { changeRequest: true }),
    createdAt: row.created_at,
    ...(row.updated_at != null && { updatedAt: row.updated_at }),
  };
}

function rowToStatus(row) {
  return { id: row.id, name: row.name, category: row.category };
}

// ---------------------------------------------------------------------------
// Spaces: keys and statuses
// ---------------------------------------------------------------------------

/**
 * A key for a space's issues, from its name: "General" gives GEN, "Web app" gives WA.
 *
 * @param {string} name
 * @param {(key: string) => boolean} isTaken
 * @returns {string}
 */
function suggestKey(name, isTaken) {
  const words = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .split(/[^A-Z0-9]+/).filter(Boolean);
  let base = words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 4) : (words[0] ?? '').slice(0, 3);
  if (!/^[A-Z]/.test(base)) base = `S${base}`.slice(0, 4);
  base = base.padEnd(2, 'P');
  if (!isTaken(base)) return base;
  for (let i = 2; ; i++) {
    if (!isTaken(`${base}${i}`)) return `${base}${i}`;
  }
}

/** An id for a new status. The list response keys tasks by it, next to these two. */
function statusSlug(name, isTaken) {
  const slug = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'status';
  const base = ['total', 'nextcursor'].includes(slug) ? `${slug}-status` : slug;
  if (!isTaken(base)) return base;
  for (let i = 2; ; i++) {
    if (!isTaken(`${base}-${i}`)) return `${base}-${i}`;
  }
}

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------

/**
 * Bumped when a version changes what the data means.
 * 2: pipelines and Folio retired. 3: tasks became issues. 4: accounts. 5: agents as assignees.
 */
const SCHEMA_VERSION = 5;
const ISSUES_SCHEMA_VERSION = 3;

/**
 * Keep a copy of a database from before an upgrade, once, so someone going back has their
 * data as it was. A new database has nothing to keep, and a backup that fails stops the
 * upgrade rather than risk the data.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} dbPath
 */
function backUpBeforeUpgrade(db, dbPath) {
  const version = db.pragma('user_version', { simple: true });
  if (dbPath === ':memory:' || version >= SCHEMA_VERSION) return;

  const hasData = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'spaces'").get();
  if (hasData) {
    const backupPath = `${dbPath}.before-v${Math.max(version + 1, 2)}`;
    // Written aside and renamed, so that what has this name is always a whole copy.
    if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
      const partial = `${backupPath}.partial`;
      fs.rmSync(partial, { force: true });
      db.prepare('VACUUM INTO ?').run(partial);
      fs.chmodSync(partial, 0o600);
      fs.renameSync(partial, backupPath);
      console.log(`[store] upgrade: kept a copy of the database in ${backupPath}`);
    }
  }
}

/**
 * Add what an issue needs: columns, then the tables that hang from them.
 * Safe to run on every start.
 *
 * @param {import('better-sqlite3').Database} db
 */
function addIssueSchema(db) {
  const addColumns = (table, columns) => {
    const existing = new Set(db.pragma(`table_info(${table})`).map((c) => c.name));
    for (const [name, definition] of Object.entries(columns)) {
      if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  };
  addColumns('spaces', { key: 'TEXT', next_number: 'INTEGER NOT NULL DEFAULT 1' });
  addColumns('tasks', {
    number:    'INTEGER',
    status_id: 'TEXT',
    priority:  `TEXT NOT NULL DEFAULT '${DEFAULT_PRIORITY}'`,
    labels:    'TEXT',
    parent_id: 'TEXT',
    due_date:  'TEXT',
    estimate:  'REAL',
  });
  db.exec(ISSUE_SCHEMA_SQL);
}

/** Who created an issue or wrote a comment, for those that have someone to say so. */
function addAccountColumns(db) {
  const has = (table, column) => db.pragma(`table_info(${table})`).some((c) => c.name === column);
  if (!has('tasks', 'created_by')) db.exec('ALTER TABLE tasks ADD COLUMN created_by TEXT');
  if (!has('comments', 'author_id')) db.exec('ALTER TABLE comments ADD COLUMN author_id TEXT');
}

/** Assignees were free text. Those that meant an agent now say which one, the same way. */
function nameAgentsByTheirId(db) {
  const setAssigned = db.prepare('UPDATE tasks SET assigned = ? WHERE assigned = ?');
  for (const { assigned } of db.prepare('SELECT DISTINCT assigned FROM tasks WHERE assigned IS NOT NULL').all()) {
    let name;
    try {
      name = JSON.parse(assigned);
    } catch {
      continue; // Not what this app writes. It stays as it is.
    }
    const agent = agentFromOldName(name);
    if (agent) setAssigned.run(JSON.stringify(agent), assigned);
  }
}

/**
 * Turn tasks into issues: number them by creation order, give each space its statuses,
 * make every arc an epic holding its tasks, and move comments to their own table.
 * All of it commits together, along with the version, so a crash leaves the old data whole.
 *
 * @param {import('better-sqlite3').Database} db
 */
function migrateToIssues(db) {
  const insertStatus  = db.prepare('INSERT OR IGNORE INTO statuses (space_id, id, name, category, position) VALUES (?, ?, ?, ?, ?)');
  const insertKey     = db.prepare('INSERT INTO space_keys (key, space_id) VALUES (?, ?)');
  const setSpace      = db.prepare('UPDATE spaces SET key = ?, next_number = ? WHERE id = ?');
  const setNumber     = db.prepare('UPDATE tasks SET number = ?, status_id = column WHERE id = ?');
  const insertComment = db.prepare(`
    INSERT INTO comments (id, task_id, author, text, type, parent_id, resolved, change_request, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const isKeyTaken = (key) => !!db.prepare('SELECT 1 FROM space_keys WHERE key = ?').get(key);
  const seenComments = new Set();

  db.transaction(() => {
    // These updates go through the search index's triggers, which fail if it is out of step.
    db.exec("INSERT INTO tasks_fts(tasks_fts) VALUES ('rebuild')");

    for (const space of db.prepare('SELECT id, name, key FROM spaces ORDER BY created_at, rowid').all()) {
      const key = space.key ?? suggestKey(space.name, isKeyTaken);
      if (!space.key) insertKey.run(key, space.id);
      DEFAULT_STATUSES.forEach((status, i) => insertStatus.run(space.id, status.id, status.name, status.category, i));

      const tasks = db.prepare('SELECT * FROM tasks WHERE space_id = ? ORDER BY created_at, rowid').all(space.id);
      let number = 0;
      for (const task of tasks) {
        setNumber.run(++number, task.id);

        let comments = [];
        try {
          comments = task.comments ? JSON.parse(task.comments) : [];
        } catch {
          comments = null;
        }
        // Anything but a list of comments stays in the old column, where it can still be read.
        const readable = Array.isArray(comments)
          && comments.every((c) => c && typeof c === 'object' && typeof c.text === 'string');
        if (!readable) {
          console.warn(`[store] upgrade: task ${task.id} has unreadable comments, left as they were`);
          continue;
        }
        for (const comment of comments) {
          const id = comment.id && !seenComments.has(comment.id) ? comment.id : crypto.randomUUID();
          seenComments.add(id);
          insertComment.run(
            id, task.id,
            typeof comment.author === 'string' ? comment.author : 'unknown',
            comment.text,
            typeof comment.type === 'string' ? comment.type : 'note',
            typeof comment.parentId === 'string' ? comment.parentId : null,
            comment.resolved ? 1 : 0, comment.changeRequest ? 1 : 0,
            typeof comment.createdAt === 'string' ? comment.createdAt : task.created_at,
            typeof comment.updatedAt === 'string' ? comment.updatedAt : null,
          );
        }
        db.prepare('UPDATE tasks SET comments = NULL WHERE id = ?').run(task.id);
      }

      // Each arc becomes an epic, after the tasks so that their numbers follow creation order.
      const arcs = new Map();
      for (const task of tasks) {
        const arc = task.arc?.trim();
        if (arc) arcs.set(arc, [...(arcs.get(arc) ?? []), task]);
      }
      for (const [arc, members] of arcs) {
        const columns = members.map((t) => t.column);
        const column = columns.every((c) => c === 'done') ? 'done'
          : columns.every((c) => c === 'todo') ? 'todo' : 'in-progress';
        const { rank } = db.prepare('SELECT COALESCE(MAX(rank), 0) AS rank FROM tasks WHERE space_id = ? AND column = ?').get(space.id, column);
        const id = crypto.randomUUID();
        const createdAt = members[0].created_at;
        db.prepare(`
          INSERT INTO tasks (id, space_id, column, status_id, number, title, type, rank, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'epic', ?, ?, ?)
        `).run(id, space.id, column, column, ++number, arc, rank + 1000, createdAt, createdAt);
        const setParent = db.prepare('UPDATE tasks SET parent_id = ?, arc = NULL WHERE id = ?');
        for (const task of members) setParent.run(id, task.id);
      }

      setSpace.run(key, number + 1, space.id);
    }
    db.pragma(`user_version = ${ISSUES_SCHEMA_VERSION}`);
  })();
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
  // It holds password hashes. SQLite gives its side files the same permissions.
  if (dbPath !== ':memory:') fs.chmodSync(dbPath, 0o600);

  backUpBeforeUpgrade(db, dbPath);

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

  // Additive migration: pinned + pinned_rank columns (space pinning).
  // Guarded by PRAGMA table_info; idempotent on existing DBs with the column.
  {
    const cols = db.pragma('table_info(spaces)');
    if (!cols.some((c) => c.name === 'pinned')) {
      db.exec('ALTER TABLE spaces ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
      db.exec('ALTER TABLE spaces ADD COLUMN pinned_rank INTEGER');
      console.log('[store] migration: added pinned + pinned_rank columns to spaces');
    }
  }

  // Additive migration: arc column (arc field on tasks).
  {
    const cols = db.pragma('table_info(tasks)');
    if (!cols.some((c) => c.name === 'arc')) {
      db.exec('ALTER TABLE tasks ADD COLUMN arc TEXT');
      console.log('[store] migration: added arc column to tasks');
    }
  }

  // Additive migration: stage_models column on spaces (MODEL-1 per-stage model routing).
  {
    const cols = db.pragma('table_info(spaces)');
    if (!cols.some((c) => c.name === 'stage_models')) {
      db.exec('ALTER TABLE spaces ADD COLUMN stage_models TEXT');
      console.log('[store] migration: added stage_models column to spaces');
    }
  }

  // Additive migration: hooks column on spaces (commands to run when an agent finishes).
  {
    const cols = db.pragma('table_info(spaces)');
    if (!cols.some((c) => c.name === 'hooks')) {
      db.exec('ALTER TABLE spaces ADD COLUMN hooks TEXT');
      console.log('[store] migration: added hooks column to spaces');
    }
  }

  // Additive migration: stage_models column on tasks (MODEL-1 per-stage model routing).
  {
    const cols = db.pragma('table_info(tasks)');
    if (!cols.some((c) => c.name === 'stage_models')) {
      db.exec('ALTER TABLE tasks ADD COLUMN stage_models TEXT');
      console.log('[store] migration: added stage_models column to tasks');
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

  // Additive migration: rank column (QOL-1 — manual task ordering).
  {
    const cols = db.pragma('table_info(tasks)');
    if (!cols.some((c) => c.name === 'rank')) {
      db.exec('ALTER TABLE tasks ADD COLUMN rank REAL DEFAULT 0');
      const groups = db.prepare(
        "SELECT DISTINCT space_id, column FROM tasks"
      ).all();
      const getIds = db.prepare(
        "SELECT id FROM tasks WHERE space_id = ? AND column = ? ORDER BY created_at ASC"
      );
      const setRank = db.prepare("UPDATE tasks SET rank = ? WHERE id = ?");
      db.transaction(() => {
        for (const { space_id, column } of groups) {
          const ids = getIds.all(space_id, column);
          ids.forEach((row, i) => setRank.run((i + 1) * 1000.0, row.id));
        }
      })();
      console.log('[store] migration: added rank column, seeded from created_at order');
    }
  }

  addIssueSchema(db);
  if (db.pragma('user_version', { simple: true }) < ISSUES_SCHEMA_VERSION) migrateToIssues(db);

  db.exec(ACCOUNTS_SQL);
  db.exec(API_TOKENS_SQL);
  addAccountColumns(db);
  if (db.pragma('user_version', { simple: true }) < SCHEMA_VERSION) {
    db.transaction(() => {
      nameAgentsByTheirId(db);
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
  }
  const accounts = createAccounts(db);

  console.log(`[store] open — WAL mode confirmed, schema ready (${dbPath})`);

  // ---------------------------------------------------------------------------
  // Prepared statements (compiled once, reused for every call)
  // ---------------------------------------------------------------------------

  const TASK_SELECT = 'SELECT t.*, s.key AS space_key FROM tasks t JOIN spaces s ON s.id = t.space_id';
  // Who shows when the board is filtered to an epic: the epic, its issues, and their sub-tasks.
  const EPIC_MEMBERS = `WITH members(id) AS (
    SELECT @epic
    UNION SELECT id FROM tasks WHERE parent_id = @epic AND type != 'epic'
    UNION SELECT c.id FROM tasks c JOIN tasks p ON c.parent_id = p.id
           WHERE p.parent_id = @epic AND p.type != 'epic' AND c.type != 'epic'
  )`;

  const stmts = {
    listSpaces:    db.prepare('SELECT * FROM spaces ORDER BY pinned DESC, pinned_rank ASC, created_at ASC'),
    getSpace:      db.prepare('SELECT * FROM spaces WHERE id = ?'),
    upsertSpace:   db.prepare(`
      INSERT INTO spaces
        (id, name, working_directory, pipeline, project_claude_md, agent_nicknames, folio_backend, stage_models, hooks, pinned, pinned_rank, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name              = excluded.name,
        working_directory = excluded.working_directory,
        pipeline          = excluded.pipeline,
        project_claude_md = excluded.project_claude_md,
        agent_nicknames   = excluded.agent_nicknames,
        folio_backend     = excluded.folio_backend,
        stage_models      = excluded.stage_models,
        hooks             = excluded.hooks,
        pinned            = excluded.pinned,
        pinned_rank       = excluded.pinned_rank,
        updated_at        = excluded.updated_at
    `),
    deleteSpace:   db.prepare('DELETE FROM spaces WHERE id = ?'),

    getTasksByStatus: db.prepare(
      `${TASK_SELECT} WHERE t.space_id = ? AND t.status_id = ? ORDER BY t.rank ASC, t.created_at ASC`
    ),
    getAllTasksForSpace: db.prepare(
      `${TASK_SELECT} WHERE t.space_id = ? ORDER BY t.rank ASC, t.created_at ASC`
    ),
    getTask: db.prepare(
      `${TASK_SELECT} WHERE t.space_id = ? AND t.id = ?`
    ),
    getTaskById: db.prepare(
      `${TASK_SELECT.replace('t.*,', 't.*, t.space_id AS _space_id, t.column AS _column,')} WHERE t.id = ? LIMIT 1`
    ),
    getTaskByNumber: db.prepare(
      `${TASK_SELECT.replace('t.*,', 't.*, t.space_id AS _space_id, t.column AS _column,')} WHERE t.space_id = ? AND t.number = ?`
    ),
    getChildren: db.prepare(
      `${TASK_SELECT} WHERE t.parent_id = ? ORDER BY t.number ASC`
    ),
    takeNumber: db.prepare(
      'UPDATE spaces SET next_number = next_number + 1 WHERE id = ? RETURNING next_number - 1 AS number'
    ),
    insertTask: db.prepare(`
      INSERT INTO tasks
        (id, space_id, column, status_id, number, title, type, priority, labels, parent_id, due_date, estimate,
         description, assigned, attachments, stage_models, rank, created_at, updated_at, depends_on, created_by)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateTask: db.prepare(`
      UPDATE tasks
         SET title = ?, type = ?, priority = ?, labels = ?, parent_id = ?, due_date = ?, estimate = ?,
             description = ?, assigned = ?, attachments = ?, stage_models = ?, depends_on = ?, updated_at = ?
       WHERE space_id = ? AND id = ?
    `),
    updateTaskDependsOn: db.prepare(`
      UPDATE tasks SET depends_on = ?, updated_at = ? WHERE space_id = ? AND id = ?
    `),
    getTasksWithDepsInSpace: db.prepare(
      `SELECT id, depends_on FROM tasks WHERE space_id = ? AND depends_on IS NOT NULL`
    ),
    moveTaskWithRank: db.prepare(
      'UPDATE tasks SET status_id = ?, column = ?, rank = ?, updated_at = ? WHERE space_id = ? AND id = ?'
    ),
    reorderTask: db.prepare(
      'UPDATE tasks SET rank = ?, updated_at = ? WHERE space_id = ? AND id = ?'
    ),
    maxRankInStatus: db.prepare(
      'SELECT COALESCE(MAX(rank), 0) AS max_rank FROM tasks WHERE space_id = ? AND status_id = ?'
    ),
    deleteTask:  db.prepare('DELETE FROM tasks WHERE space_id = ? AND id = ?'),
    clearSpace:  db.prepare('DELETE FROM tasks WHERE space_id = ?'),
    searchTasks: db.prepare(`
      SELECT t.*, s.key AS space_key
        FROM tasks_fts
        JOIN tasks t ON t.rowid = tasks_fts.rowid
        JOIN spaces s ON s.id = t.space_id
       WHERE tasks_fts MATCH ?
         AND t.space_id = ?
       ORDER BY rank
       LIMIT ?
    `),
    searchAllTasks: db.prepare(`
      SELECT t.*, s.key AS space_key, t.space_id AS _space_id, t.column AS _column
        FROM tasks_fts
        JOIN tasks t ON t.rowid = tasks_fts.rowid
        JOIN spaces s ON s.id = t.space_id
       WHERE tasks_fts MATCH ?
       ORDER BY rank
       LIMIT ?
    `),

    // ── the board ────────────────────────────────────────────────────────────
    boardFirst: db.prepare(
      `${TASK_SELECT} WHERE t.space_id = @space AND t.status_id = @status
       ORDER BY t.rank ASC, t.created_at ASC, t.rowid ASC LIMIT @limit`
    ),
    boardLast: db.prepare(
      `${TASK_SELECT} WHERE t.space_id = @space AND t.status_id = @status
       ORDER BY t.rank DESC, t.created_at DESC, t.rowid DESC LIMIT @limit`
    ),
    boardCounts: db.prepare(
      'SELECT t.status_id AS status_id, COUNT(*) AS n FROM tasks t WHERE t.space_id = @space GROUP BY t.status_id'
    ),
    epicFirst: db.prepare(
      `${EPIC_MEMBERS} ${TASK_SELECT} WHERE t.space_id = @space AND t.status_id = @status AND t.id IN (SELECT id FROM members)
       ORDER BY t.rank ASC, t.created_at ASC, t.rowid ASC LIMIT @limit`
    ),
    epicLast: db.prepare(
      `${EPIC_MEMBERS} ${TASK_SELECT} WHERE t.space_id = @space AND t.status_id = @status AND t.id IN (SELECT id FROM members)
       ORDER BY t.rank DESC, t.created_at DESC, t.rowid DESC LIMIT @limit`
    ),
    epicCounts: db.prepare(
      `${EPIC_MEMBERS} SELECT t.status_id AS status_id, COUNT(*) AS n FROM tasks t
       WHERE t.space_id = @space AND t.id IN (SELECT id FROM members) GROUP BY t.status_id`
    ),
    spaceEpics: db.prepare(
      `${TASK_SELECT} WHERE t.space_id = ? AND t.type = 'epic' ORDER BY t.number ASC, t.rowid ASC`
    ),
    parentsOf: db.prepare(
      'SELECT id, type, title, number, parent_id FROM tasks WHERE space_id = ? AND id IN (SELECT value FROM json_each(?))'
    ),
    progressOf: db.prepare(`
      SELECT parent_id, COUNT(*) AS total, SUM(column = 'done') AS done
        FROM tasks WHERE space_id = ? AND parent_id IN (SELECT value FROM json_each(?)) GROUP BY parent_id
    `),
    doneAmong: db.prepare(
      "SELECT id FROM tasks WHERE space_id = ? AND column = 'done' AND id IN (SELECT value FROM json_each(?))"
    ),
    openQuestionsOf: db.prepare(`
      SELECT task_id, text FROM comments
       WHERE task_id IN (SELECT value FROM json_each(?)) AND type = 'question' AND resolved = 0
       ORDER BY created_at ASC, rowid ASC
    `),
    childrenPage: db.prepare(
      `${TASK_SELECT} WHERE t.space_id = ? AND t.parent_id = ? ORDER BY t.number ASC LIMIT ?`
    ),
    epicMembersAmong: db.prepare(
      `${EPIC_MEMBERS} SELECT id FROM members WHERE id IN (SELECT value FROM json_each(@ids))`
    ),
    tasksByIds: db.prepare(
      `${TASK_SELECT} WHERE t.space_id = ? AND t.id IN (SELECT value FROM json_each(?)) ORDER BY t.number ASC`
    ),

    // ── keys and statuses ────────────────────────────────────────────────────
    getStatuses: db.prepare('SELECT * FROM statuses WHERE space_id = ? ORDER BY position ASC'),
    upsertStatus: db.prepare(`
      INSERT INTO statuses (space_id, id, name, category, position) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(space_id, id) DO UPDATE SET
        name = excluded.name, category = excluded.category, position = excluded.position
    `),
    deleteStatus: db.prepare('DELETE FROM statuses WHERE space_id = ? AND id = ?'),
    setCategoryOfStatus: db.prepare('UPDATE tasks SET column = ? WHERE space_id = ? AND status_id = ?'),
    countInStatus: db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE space_id = ? AND status_id = ?'),
    getKeyOwner: db.prepare('SELECT space_id FROM space_keys WHERE key = ?'),
    addKey: db.prepare('INSERT OR IGNORE INTO space_keys (key, space_id) VALUES (?, ?)'),
    setKey: db.prepare('UPDATE spaces SET key = ? WHERE id = ?'),

    // ── comments and history ─────────────────────────────────────────────────
    getComments: db.prepare('SELECT * FROM comments WHERE task_id = ? ORDER BY created_at ASC, rowid ASC'),
    getSpaceComments: db.prepare(`
      SELECT c.* FROM comments c JOIN tasks t ON t.id = c.task_id
       WHERE t.space_id = ? ORDER BY c.created_at ASC, c.rowid ASC
    `),
    insertComment: db.prepare(`
      INSERT INTO comments (id, task_id, author, text, type, parent_id, resolved, change_request, created_at, updated_at, author_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateComment: db.prepare('UPDATE comments SET text = ?, type = ?, resolved = ?, updated_at = ? WHERE id = ? AND task_id = ?'),
    touchTask: db.prepare('UPDATE tasks SET updated_at = ? WHERE space_id = ? AND id = ?'),
    insertHistory: db.prepare(`
      INSERT INTO task_history (task_id, actor, field, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?)
    `),
    getHistory: db.prepare('SELECT * FROM task_history WHERE task_id = ? ORDER BY id DESC'),
    setParent: db.prepare('UPDATE tasks SET parent_id = ?, updated_at = ? WHERE space_id = ? AND id = ?'),

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
    listRunsBySpace: db.prepare('SELECT * FROM pipeline_runs WHERE space_id = ? ORDER BY created_at DESC'),
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

  /** A space with its key, its statuses and where an agent's finished work lands. */
  function hydrateSpace(row) {
    const space = rowToSpace(row);
    if (!space) return null;
    if (row.key) space.key = row.key;
    space.statuses = stmts.getStatuses.all(space.id).map(rowToStatus);
    space.finishStatusId = finishStatusOf(space);
    return space;
  }

  /**
   * Where an agent's finished work goes: what the space chose, else In review if it still
   * has it, because a person reviews it. A space without it ends in its first done status.
   */
  function finishStatusOf(space) {
    const { statuses, hooks } = space;
    const known = (id) => statuses.some((s) => s.id === id);
    // A status that became a to-do one no longer qualifies.
    if (statuses.some((s) => s.id === hooks?.finishStatus && s.category !== 'todo')) return hooks.finishStatus;
    if (known('in-review')) return 'in-review';
    return statuses.find((s) => s.category === 'done')?.id ?? null;
  }

  function listSpaces() {
    return stmts.listSpaces.all().map(hydrateSpace);
  }

  function getSpace(id) {
    return hydrateSpace(stmts.getSpace.get(id));
  }

  function getStatuses(spaceId) {
    return stmts.getStatuses.all(spaceId).map(rowToStatus);
  }

  /** The first status of a category, in the space's order. Every category has one. */
  function firstStatusOf(spaceId, category) {
    return getStatuses(spaceId).find((s) => s.category === category) ?? null;
  }

  /** The space a key belongs to, old keys included. */
  function getKeyOwner(key) {
    return stmts.getKeyOwner.get(key)?.space_id ?? null;
  }

  /**
   * Change a space's key. Its old key keeps pointing to it.
   *
   * @returns {boolean} false when another space has or had the key.
   */
  function setSpaceKey(spaceId, key) {
    const owner = getKeyOwner(key);
    if (owner && owner !== spaceId) return false;
    db.transaction(() => {
      stmts.addKey.run(key, spaceId);
      stmts.setKey.run(key, spaceId);
    })();
    return true;
  }

  /**
   * Replace a space's statuses, in the order given. Issues in a removed status go where
   * `moves` says, and issues in a status whose category changed follow it.
   *
   * @param {string} spaceId
   * @param {Array<{ id?: string, name: string, category: string }>} statuses
   * @param {Record<string, string>} [moves] - Removed status id → status id that stays.
   * @param {{ actor?: string }} [opts]
   * @returns {Array<{ id: string, name: string, category: string }>}
   */
  function setStatuses(spaceId, statuses, moves = {}, { actor } = {}) {
    return db.transaction(() => {
      const before = getStatuses(spaceId);
      const used = new Set([...before.map((s) => s.id), ...statuses.map((s) => s.id).filter(Boolean)]);
      statuses.forEach((status, position) => {
        let { id } = status;
        if (!id) {
          id = statusSlug(status.name, (candidate) => used.has(candidate));
          used.add(id);
        }
        const previous = before.find((s) => s.id === id);
        if (previous && previous.category !== status.category) {
          for (const row of stmts.getTasksByStatus.all(spaceId, id)) {
            recordHistory(row.id, actor, 'category', previous.category, status.category);
          }
        }
        stmts.upsertStatus.run(spaceId, id, status.name, status.category, position);
        stmts.setCategoryOfStatus.run(status.category, spaceId, id);
      });

      const kept = new Set(statuses.map((s) => s.id).filter(Boolean));
      for (const removed of before.filter((s) => !kept.has(s.id))) {
        for (const row of stmts.getTasksByStatus.all(spaceId, removed.id)) {
          moveTask(spaceId, row.id, moves[removed.id], { actor });
        }
        stmts.deleteStatus.run(spaceId, removed.id);
      }

      // Forget a finish status that is gone, or a later one with its name would inherit the choice.
      const space = getSpace(spaceId);
      if (space.hooks?.finishStatus && !space.statuses.some((s) => s.id === space.hooks.finishStatus)) {
        const { finishStatus: _gone, ...hooks } = space.hooks;
        upsertSpace({ ...space, hooks, updatedAt: new Date().toISOString() });
      }
      return getStatuses(spaceId);
    })();
  }

  function countTasksInStatus(spaceId, statusId) {
    return stmts.countInStatus.get(spaceId, statusId).n;
  }

  /**
   * Insert or replace a space row.
   * Used by SpaceManager and tests.
   */
  function upsertSpace(space) {
    db.transaction(() => {
    stmts.upsertSpace.run(
      space.id,
      space.name,
      space.workingDirectory !== undefined ? JSON.stringify(space.workingDirectory) : null,
      space.pipeline          !== undefined ? JSON.stringify(space.pipeline)         : null,
      space.projectClaudeMdPath !== undefined ? JSON.stringify(space.projectClaudeMdPath) : null,
      space.agentNicknames    !== undefined ? JSON.stringify(space.agentNicknames)  : null,
      // folio_backend is a plain TEXT column — store as-is or NULL.
      space.folioBackend !== undefined ? space.folioBackend : null,
      // MODEL-1: stage_models is a JSON column.
      toJson(space.stageModels ?? null),
      toJson(space.hooks ?? null),
      // pinned: boolean → INTEGER (1/0); default false when absent.
      space.pinned ? 1 : 0,
      // pinned_rank: number or null.
      space.pinnedRank !== undefined ? space.pinnedRank : null,
      space.createdAt,
      space.updatedAt,
    );
    // A new space gets its key and statuses here, so no space can be without them.
    if (!stmts.getSpace.get(space.id).key) {
      const key = space.key ?? suggestKey(space.name, (candidate) => !!getKeyOwner(candidate));
      stmts.addKey.run(key, space.id);
      stmts.setKey.run(key, space.id);
    }
    if (stmts.getStatuses.all(space.id).length === 0) {
      DEFAULT_STATUSES.forEach((status, i) => {
        stmts.upsertStatus.run(space.id, status.id, status.name, status.category, i);
      });
    }
    })();
  }

  function deleteSpace(id) {
    stmts.deleteSpace.run(id);
  }

  // ---------------------------------------------------------------------------
  // Task operations
  // ---------------------------------------------------------------------------

  /** Attach comments to one task. A task without comments has no such field. */
  function withComments(task) {
    if (!task) return task;
    const comments = stmts.getComments.all(task.id).map(rowToComment);
    if (comments.length > 0) task.comments = comments;
    return task;
  }

  /** Attach comments to a space's tasks in one query, for the board. */
  function withSpaceComments(spaceId, tasks) {
    const byTask = new Map();
    for (const row of stmts.getSpaceComments.all(spaceId)) {
      if (!byTask.has(row.task_id)) byTask.set(row.task_id, []);
      byTask.get(row.task_id).push(rowToComment(row));
    }
    for (const task of tasks) {
      const comments = byTask.get(task.id);
      if (comments) task.comments = comments;
    }
    return tasks;
  }

  function getTasksByStatus(spaceId, statusId) {
    return withSpaceComments(spaceId, stmts.getTasksByStatus.all(spaceId, statusId).map(rowToTask));
  }

  function getAllTasksForSpace(spaceId) {
    return withSpaceComments(spaceId, stmts.getAllTasksForSpace.all(spaceId).map(rowToTask));
  }

  function getTask(spaceId, taskId) {
    return withComments(rowToTask(stmts.getTask.get(spaceId, taskId)));
  }

  /** The task and its status category, which is what "done" and "in progress" mean. */
  function getTaskWithColumn(spaceId, taskId) {
    const row = stmts.getTask.get(spaceId, taskId);
    if (!row) return null;
    return { task: withComments(rowToTask(row)), column: row.column };
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
      task:    withComments(rowToTask(row)),
      spaceId: row._space_id,
      column:  row._column,
    };
  }

  /**
   * Look up a task by key, such as WEB-142. Keys a space used to have still work.
   *
   * @param {string} key
   * @returns {{ task: object, spaceId: string, column: string } | null}
   */
  function getTaskByKey(key) {
    const match = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/.exec(String(key).trim());
    if (!match) return null;
    const spaceId = getKeyOwner(match[1].toUpperCase());
    if (!spaceId) return null;
    const row = stmts.getTaskByNumber.get(spaceId, Number(match[2]));
    if (!row) return null;
    return {
      task:    withComments(rowToTask(row)),
      spaceId: row._space_id,
      column:  row._column,
    };
  }

  /** The issues directly under this one: an epic's issues, or an issue's sub-tasks. */
  function getChildren(taskId) {
    return stmts.getChildren.all(taskId).map(rowToTask);
  }

  /**
   * Check where an issue may sit: epic → issue → sub-task, and no deeper.
   *
   * @param {string} spaceId
   * @param {string|null} taskId - null for an issue not created yet.
   * @param {{ type: string, parentId?: string }} issue - The issue as it would become.
   * @returns {string|null} What is wrong, or null.
   */
  function checkHierarchy(spaceId, taskId, { type, parentId }) {
    const children = taskId ? stmts.getChildren.all(taskId) : [];
    if (type === 'epic' && parentId) return 'An epic cannot sit under another issue';
    if (taskId && type !== 'epic' && children.length > 0 && stmts.getTask.get(spaceId, taskId)?.type === 'epic') {
      return 'This epic still has issues. Move them out before changing its type';
    }
    if (!parentId) return null;
    if (parentId === taskId) return 'An issue cannot be its own parent';

    const parent = stmts.getTask.get(spaceId, parentId);
    if (!parent) return `Parent issue not found: ${parentId}`;
    if (parent.type === 'epic') return null;

    // The parent is an ordinary issue, so this one becomes its sub-task.
    if (children.length > 0) return 'An issue with sub-tasks cannot become a sub-task';
    const grandparent = parent.parent_id ? stmts.getTask.get(spaceId, parent.parent_id) : null;
    if (grandparent && grandparent.type !== 'epic') return 'A sub-task cannot have sub-tasks';
    return null;
  }

  /** How a field's value reads in the history. */
  function historyValue(spaceId, field, value) {
    if (value === undefined || value === null) return null;
    const keyOf = (id) => {
      const row = stmts.getTask.get(spaceId, id);
      return row ? rowToTask(row).key ?? id : id;
    };
    if (field === 'parentId') return keyOf(value);
    if (field === 'dependsOn') return value.length > 0 ? value.map(keyOf).join(', ') : null;
    if (field === 'labels') return value.length > 0 ? value.join(', ') : null;
    return String(value);
  }

  function recordHistory(taskId, actor, field, oldValue, newValue) {
    stmts.insertHistory.run(taskId, actor ?? 'Prism', field, oldValue, newValue, new Date().toISOString());
  }

  function getHistory(taskId) {
    return stmts.getHistory.all(taskId).map((row) => ({
      id:        row.id,
      actor:     row.actor,
      field:     row.field,
      oldValue:  row.old_value,
      newValue:  row.new_value,
      createdAt: row.created_at,
    }));
  }

  /**
   * Create an issue with the next number of its space.
   *
   * @param {object} task
   * @param {string} spaceId
   * @param {string} statusId
   * @param {{ actor?: string }} [opts]
   */
  function insertTask(task, spaceId, statusId, { actor, createdBy } = {}) {
    db.transaction(() => {
      const status = getStatuses(spaceId).find((s) => s.id === statusId);
      if (!status) {
        const err = new Error(`Status '${statusId}' not found in space '${spaceId}'`);
        err.code = 'STATUS_NOT_FOUND';
        throw err;
      }
      const effectiveRank = task.rank != null
        ? task.rank
        : stmts.maxRankInStatus.get(spaceId, statusId).max_rank + 1000.0;
      const { number } = stmts.takeNumber.get(spaceId);
      withFtsRecovery(() => stmts.insertTask.run(
        task.id,
        spaceId,
        status.category,
        statusId,
        number,
        task.title,
        task.type,
        task.priority ?? DEFAULT_PRIORITY,
        toJson(task.labels),
        task.parentId ?? null,
        task.dueDate ?? null,
        task.estimate ?? null,
        task.description !== undefined ? JSON.stringify(task.description) : null,
        task.assigned    !== undefined ? JSON.stringify(task.assigned)    : null,
        task.attachments !== undefined ? JSON.stringify(task.attachments) : null,
        // MODEL-1: per-stage model routing overrides.
        toJson(task.stageModels ?? null),
        effectiveRank,
        task.createdAt,
        task.updatedAt,
        task.dependsOn   !== undefined ? JSON.stringify(task.dependsOn)  : null,
        createdBy ?? null,
      ));
      if (createdBy) task.createdBy = createdBy;
      recordHistory(task.id, actor, 'created', null, null);
      // BUG-001 (QOL-1): expose what the database decided on the caller's task object
      // so POST /tasks 201 responses can see it without re-fetching.
      task.rank     = effectiveRank;
      task.number   = number;
      task.key      = `${stmts.getSpace.get(spaceId).key}-${number}`;
      task.statusId = statusId;
      task.category = status.category;
      task.priority = task.priority ?? DEFAULT_PRIORITY;
    })();
  }

  /** Fields whose changes the history keeps. */
  const HISTORY_FIELDS = ['title', 'type', 'priority', 'description', 'assigned', 'labels', 'parentId', 'dueDate', 'estimate'];

  /**
   * Apply a patch object to an existing task row and return the updated task.
   * Patch keys mirror the task's JS shape (camelCase). Comments have their own calls.
   * Returns null when the task is not found.
   */
  function updateTask(spaceId, taskId, patch, { actor } = {}) {
    return db.transaction(() => {
      const existing = getTask(spaceId, taskId);
      if (!existing) return null;

      const merged = { ...existing, ...patch };

      withFtsRecovery(() => stmts.updateTask.run(
        merged.title,
        merged.type,
        merged.priority ?? DEFAULT_PRIORITY,
        toJson(merged.labels),
        merged.parentId ?? null,
        merged.dueDate ?? null,
        merged.estimate ?? null,
        merged.description !== undefined ? JSON.stringify(merged.description) : null,
        merged.assigned    !== undefined ? JSON.stringify(merged.assigned)    : null,
        merged.attachments !== undefined ? JSON.stringify(merged.attachments) : null,
        // MODEL-1: per-stage model routing overrides.
        toJson(merged.stageModels ?? null),
        merged.dependsOn   !== undefined ? JSON.stringify(merged.dependsOn)  : null,
        merged.updatedAt,
        spaceId,
        taskId,
      ));

      for (const field of HISTORY_FIELDS) {
        if (!(field in patch)) continue;
        const before = historyValue(spaceId, field, existing[field]);
        const after  = historyValue(spaceId, field, merged[field]);
        if (before !== after) recordHistory(taskId, actor, field, before, after);
      }

      return merged;
    })();
  }

  /**
   * Move a task to another status, last in it. Moving it where it already is does nothing.
   * Returns the updated task object, or null if not found.
   */
  function moveTask(spaceId, taskId, statusId, { actor } = {}) {
    const move = db.transaction(() => {
      const row = stmts.getTask.get(spaceId, taskId);
      if (!row) return null;
      if (row.status_id === statusId) return getTask(spaceId, taskId);

      const statuses = getStatuses(spaceId);
      const target = statuses.find((s) => s.id === statusId);
      if (!target) {
        const err = new Error(`Status '${statusId}' not found in space '${spaceId}'`);
        err.code = 'STATUS_NOT_FOUND';
        throw err;
      }
      const { max_rank } = stmts.maxRankInStatus.get(spaceId, statusId);
      const now = new Date().toISOString();
      stmts.moveTaskWithRank.run(statusId, target.category, max_rank + 1000.0, now, spaceId, taskId);
      const from = statuses.find((s) => s.id === row.status_id);
      recordHistory(taskId, actor, 'status', from?.name ?? row.status_id, target.name);
      return getTask(spaceId, taskId);
    });
    return move();
  }

  /**
   * Add a comment and mark the task as changed.
   *
   * @param {string} spaceId
   * @param {string} taskId
   * @param {object} comment
   */
  function addComment(spaceId, taskId, comment) {
    db.transaction(() => {
      stmts.insertComment.run(
        comment.id, taskId, comment.author, comment.text, comment.type, comment.parentId ?? null,
        comment.resolved ? 1 : 0, comment.changeRequest ? 1 : 0, comment.createdAt, comment.updatedAt ?? null,
        comment.authorId ?? null,
      );
      stmts.touchTask.run(comment.createdAt, spaceId, taskId);
    })();
  }

  /** Save a changed comment and mark the task as changed. */
  function updateComment(spaceId, taskId, comment) {
    db.transaction(() => {
      stmts.updateComment.run(comment.text, comment.type, comment.resolved ? 1 : 0, comment.updatedAt, comment.id, taskId);
      stmts.touchTask.run(comment.updatedAt, spaceId, taskId);
    })();
  }

  function reorderTask(spaceId, taskId, rank) {
    const now = new Date().toISOString();
    const info = stmts.reorderTask.run(rank, now, spaceId, taskId);
    if (info.changes === 0) return null;
    return getTask(spaceId, taskId);
  }

  /**
   * Atomically re-rank multiple tasks in a single space. All-or-nothing: if any
   * task id is not found in the space, the entire transaction is rolled back
   * and null is returned. On success returns the list of updated tasks (same
   * order as `updates`).
   *
   * @param {string} spaceId
   * @param {Array<{ id: string, rank: number }>} updates
   * @returns {Array<object>|null}
   */
  function reorderTasks(spaceId, updates) {
    const now = new Date().toISOString();
    const apply = db.transaction((items) => {
      for (const { id, rank } of items) {
        const info = stmts.reorderTask.run(rank, now, spaceId, id);
        if (info.changes === 0) {
          // Abort the whole batch — better-sqlite3 rolls back on throw.
          const err = new Error(`Task '${id}' not found in space '${spaceId}'`);
          err.code = 'TASK_NOT_FOUND';
          err.taskId = id;
          throw err;
        }
      }
      return items.map((u) => getTask(spaceId, u.id));
    });
    return apply(updates);
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
   * Error carrying a machine-readable code out of a transaction body.
   * better-sqlite3 only rolls back when the transaction function THROWS, so a
   * validation failure inside one must throw rather than return.
   */
  class TaskWriteError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  /**
   * Apply a field patch and a dependsOn change to a task in ONE transaction.
   *
   * The PUT handler used to do these as two independent writes: a failure or a
   * crash between them left the dependencies changed and the fields not, or the
   * reverse. Both now commit together or neither does.
   *
   * @param {string} spaceId
   * @param {string} taskId
   * @param {{ patch?: object|null, depIds?: string[]|undefined }} changes
   *   `depIds === undefined` leaves dependencies untouched; `[]` clears them.
   * @returns {{ task: object } | { error: string, code: string }}
   */
  function updateTaskWithDependencies(spaceId, taskId, { patch, depIds, actor } = {}) {
    const apply = db.transaction(() => {
      if (depIds !== undefined) {
        const depResult = setTaskDependencies(spaceId, taskId, depIds, { actor });
        if (depResult.error) throw new TaskWriteError(depResult.code, depResult.error);
      }
      if (patch && Object.keys(patch).length > 0) {
        const updated = updateTask(spaceId, taskId, patch, { actor });
        if (!updated) throw new TaskWriteError('TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
      }
      return getTask(spaceId, taskId);
    });

    try {
      return { task: apply() };
    } catch (err) {
      if (err instanceof TaskWriteError) return { error: err.message, code: err.code };
      throw err;
    }
  }

  /**
   * Set the dependsOn array for a task, validating existence and cycles.
   * @param {string} spaceId
   * @param {string} taskId
   * @param {string[]} depIds
   * @returns {{ task: object } | { error: string, code: string }}
   */
  function setTaskDependencies(spaceId, taskId, depIds, { actor } = {}) {
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
    const before = historyValue(spaceId, 'dependsOn', fromJson(taskRow.depends_on) ?? []);
    const after  = historyValue(spaceId, 'dependsOn', depIds);
    stmts.updateTaskDependsOn.run(depsJson, now, spaceId, taskId);
    if (before !== after) recordHistory(taskId, actor, 'dependsOn', before, after);

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
    const tasks = withSpaceComments(spaceId, rows.map(row => ({ ...rowToTask(row), _col: row.column })));
    return deriveBlockedStatus(tasks);
  }

  // ---------------------------------------------------------------------------
  // The board: what is on screen, and no more than that
  // ---------------------------------------------------------------------------

  /** Whether each dependency blocks, by the rule of deriveBlockedStatus, for many issues at once. */
  function doneAmong(spaceId, ids) {
    if (ids.length === 0) return new Set();
    return new Set(stmts.doneAmong.all(spaceId, JSON.stringify(ids)).map((row) => row.id));
  }

  function blockedFields(task, doneIds) {
    const deps = task.dependsOn ?? [];
    if (deps.length === 0) return {};
    const blockedByCount = deps.filter((id) => !doneIds.has(id)).length;
    return { isBlocked: blockedByCount > 0, blockedByCount };
  }

  function rowsById(spaceId, ids) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    return new Map(stmts.parentsOf.all(spaceId, JSON.stringify(unique)).map((row) => [row.id, row]));
  }

  function progressById(spaceId, ids) {
    if (ids.length === 0) return new Map();
    return new Map(stmts.progressOf.all(spaceId, JSON.stringify(ids)).map((row) => [row.parent_id, { done: row.done, total: row.total }]));
  }

  /**
   * What a card shows that is not its own: its epic, its parent, how far along its children
   * are, whether it is blocked, and its open questions. In a few indexed look-ups, whatever the
   * size of the space. Same logic as epicOf and parentIssueOf in frontend/src/utils/issues.ts.
   */
  function withCardFields(spaceId, spaceKey, tasks) {
    const ids = tasks.map((task) => task.id);
    const parents = rowsById(spaceId, tasks.map((task) => task.parentId).filter(Boolean));
    const grandparents = rowsById(
      spaceId,
      [...parents.values()].filter((row) => row.type !== 'epic' && row.parent_id).map((row) => row.parent_id)
    );
    const progress = progressById(spaceId, ids);
    const doneIds = doneAmong(spaceId, [...new Set(tasks.flatMap((task) => task.dependsOn ?? []))]);
    const questions = new Map();
    if (ids.length > 0) {
      for (const row of stmts.openQuestionsOf.all(JSON.stringify(ids))) {
        const seen = questions.get(row.task_id);
        if (seen) seen.count += 1;
        else questions.set(row.task_id, { count: 1, first: row.text });
      }
    }

    return tasks.map((task) => {
      const parent = task.parentId ? parents.get(task.parentId) : undefined;
      const grandparent = parent?.parent_id ? grandparents.get(parent.parent_id) : undefined;
      let epic = null;
      if (task.type !== 'epic' && parent) {
        if (parent.type === 'epic') epic = { id: parent.id, title: parent.title };
        else if (grandparent?.type === 'epic') epic = { id: grandparent.id, title: grandparent.title };
      }
      const question = questions.get(task.id);
      return {
        ...task,
        epic,
        parentKey: parent && parent.type !== 'epic' && spaceKey && parent.number != null ? `${spaceKey}-${parent.number}` : null,
        progress: progress.get(task.id) ?? { done: 0, total: 0 },
        ...blockedFields(task, doneIds),
        pendingQuestions: question?.count ?? 0,
        ...(question && { pendingQuestionText: question.first.slice(0, BOARD_DESCRIPTION_CHARS) }),
      };
    });
  }

  /** A description short enough for a card, which says so when it is not all of it. */
  function withCardDescription(task) {
    const { description } = task;
    if (typeof description !== 'string' || description.length <= BOARD_DESCRIPTION_CHARS) return task;
    // Not through the middle of a character that takes two code units.
    const lastCode = description.charCodeAt(BOARD_DESCRIPTION_CHARS - 1);
    const end = lastCode >= 0xd800 && lastCode <= 0xdbff ? BOARD_DESCRIPTION_CHARS - 1 : BOARD_DESCRIPTION_CHARS;
    return { ...task, description: description.slice(0, end), descriptionTruncated: true };
  }

  /**
   * The cards a board shows and what it takes to show them, without reading the rest of the
   * space. Not-done columns show their first cards, and done ones their most recent, always
   * in rank order.
   *
   * @param {string} spaceId
   * @param {{ limits?: Record<string, number>, epicId?: string|null, include?: string[] }} [options]
   *   limits: how many cards of a status, instead of the default. epicId: only what is in it.
   *   include: cards to bring wherever they are, as long as they would show: what someone just
   *   moved must not vanish past the limit. They are not added to the total.
   * @returns {{ columns: Record<string, { tasks: object[], total: number, rankBefore?: number, rankAfter?: number }>, epics: object[] }}
   *   rankBefore and rankAfter: the ranks of the cards next to what was loaded, when there are
   *   any, so that a card dropped at the end of what is loaded lands there.
   */
  function getBoard(spaceId, { limits = {}, epicId = null, include = [] } = {}) {
    const statuses = stmts.getStatuses.all(spaceId).map(rowToStatus);
    const spaceKey = stmts.getSpace.get(spaceId)?.key ?? null;
    const filtered = epicId !== null;
    // Anything else is not an epic of this space, and nothing is in it.
    const noEpic = filtered && stmts.getTask.get(spaceId, epicId)?.type !== 'epic';
    const params = { space: spaceId, ...(filtered && { epic: epicId }) };

    const counts = new Map();
    if (!noEpic) {
      for (const row of (filtered ? stmts.epicCounts : stmts.boardCounts).all(params)) counts.set(row.status_id, row.n);
    }

    const included = new Map();
    if (include.length > 0 && !noEpic) {
      const ids = JSON.stringify(include);
      const allowed = filtered ? new Set(stmts.epicMembersAmong.all({ epic: epicId, ids }).map((row) => row.id)) : null;
      for (const row of stmts.tasksByIds.all(spaceId, ids)) {
        if (allowed && !allowed.has(row.id)) continue;
        if (!included.has(row.status_id)) included.set(row.status_id, []);
        included.get(row.status_id).push(row);
      }
    }

    // A status is named by its users, and can be called "constructor".
    const columns = Object.create(null);
    const windows = [];
    for (const status of statuses) {
      const total = counts.get(status.id) ?? 0;
      const fromEnd = status.category === 'done';
      const limit = Object.hasOwn(limits, status.id) ? limits[status.id] : (fromEnd ? BOARD_DONE_LIMIT : BOARD_DEFAULT_LIMIT);
      const query = fromEnd ? (filtered ? stmts.epicLast : stmts.boardLast) : (filtered ? stmts.epicFirst : stmts.boardFirst);
      // One more than was asked for says where the next card is.
      const rows = total === 0 ? [] : query.all({ ...params, status: status.id, limit: limit + 1 });
      const beyond = rows.length > limit ? rows.pop() : null;
      if (fromEnd) rows.reverse();
      const loaded = new Set(rows.map((row) => row.id));
      const extras = (included.get(status.id) ?? []).filter((row) => !loaded.has(row.id));
      if (extras.length > 0) {
        rows.push(...extras);
        rows.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
      }
      columns[status.id] = {
        tasks: [],
        total,
        ...(beyond && { [fromEnd ? 'rankBefore' : 'rankAfter']: beyond.rank ?? 0 }),
      };
      windows.push({ statusId: status.id, tasks: rows.map(rowToTask) });
    }

    const cards = withCardFields(spaceId, spaceKey, windows.flatMap((w) => w.tasks));
    let next = 0;
    for (const { statusId, tasks } of windows) {
      columns[statusId].tasks = cards.slice(next, next + tasks.length).map(withCardDescription);
      next += tasks.length;
    }

    const epicRows = stmts.spaceEpics.all(spaceId);
    const epicProgress = progressById(spaceId, epicRows.map((row) => row.id));
    const epics = epicRows.map((row) => ({
      id: row.id,
      key: row.number != null && spaceKey ? `${spaceKey}-${row.number}` : null,
      title: row.title,
      statusId: row.status_id ?? row.column,
      category: row.column,
      ...(epicProgress.get(row.id) ?? { done: 0, total: 0 }),
    }));

    return { columns, epics };
  }

  /** What the detail panel needs of an issue beyond the issue itself. */
  function getTaskForPanel(spaceId, taskId) {
    const task = getTask(spaceId, taskId);
    if (!task) return null;
    const parent = task.parentId ? stmts.getTask.get(spaceId, task.parentId) : null;
    return {
      ...task,
      ...blockedFields(task, doneAmong(spaceId, task.dependsOn ?? [])),
      ...(parent && { parent: { id: parent.id, key: rowToTask(parent).key, title: parent.title, type: parent.type } }),
    };
  }

  /** The issues under this one, in order, and how many there are and are done. */
  function getChildrenPage(spaceId, parentId, limit) {
    const { done, total } = progressById(spaceId, [parentId]).get(parentId) ?? { done: 0, total: 0 };
    return { tasks: stmts.childrenPage.all(spaceId, parentId, limit).map(rowToTask), done, total };
  }

  /** Issues of a space by id, in any column. Those that are not there are left out. */
  function getTasksByIds(spaceId, ids) {
    return stmts.tasksByIds.all(spaceId, JSON.stringify(ids)).map(rowToTask);
  }

  function deleteTask(spaceId, taskId, { actor } = {}) {
    const doDelete = db.transaction(() => {
      if (!stmts.getTask.get(spaceId, taskId)) return false;

      // Its epic's issues and its sub-tasks stay, without a parent.
      const removedKey = historyValue(spaceId, 'parentId', taskId);
      for (const child of stmts.getChildren.all(taskId)) {
        stmts.setParent.run(null, new Date().toISOString(), spaceId, child.id);
        recordHistory(child.id, actor, 'parentId', removedKey, null);
      }

      // Clean up reverse references in other tasks' dependsOn arrays, while keys still read.
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
        recordHistory(
          row.id, actor, 'dependsOn',
          historyValue(spaceId, 'dependsOn', deps), historyValue(spaceId, 'dependsOn', newDeps),
        );
        cleanedCount++;
      }
      if (cleanedCount > 0) {
        console.log(`[store] deleteTask: cleaned dependsOn refs in ${cleanedCount} tasks`);
      }
      withFtsRecovery(() => stmts.deleteTask.run(spaceId, taskId));
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
      return rows.map(rowToTask).map(withComments);
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
        task:    withComments(rowToTask(row)),
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
  // MODEL-1: stage model helpers
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
  function listRunsBySpace(spaceId) {
    return stmts.listRunsBySpace.all(spaceId).map(rowToRun);
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

  /** Everyone issues are assigned to, as written in them. */
  function assignees() {
    return db.prepare('SELECT DISTINCT assigned FROM tasks WHERE assigned IS NOT NULL').all()
      .map((row) => fromJson(row.assigned))
      .filter(Boolean);
  }

  /** Give the issues of an old assignee to someone else. */
  function renameAssignee(from, to) {
    return db.prepare('UPDATE tasks SET assigned = ?, updated_at = ? WHERE assigned = ?')
      .run(JSON.stringify(to), new Date().toISOString(), JSON.stringify(from)).changes;
  }

  function close() {
    db.close();
  }

  return {
    // Space
    listSpaces,
    getSpace,
    upsertSpace,
    deleteSpace,
    getStatuses,
    firstStatusOf,
    setStatuses,
    countTasksInStatus,
    getKeyOwner,
    setSpaceKey,
    // Task
    getTasksByStatus,
    getAllTasksForSpace,
    getAllTasksForSpaceWithStatus,
    getTask,
    getTaskWithColumn,
    getTaskById,
    getTaskByKey,
    getChildren,
    getBoard,
    getTaskForPanel,
    getChildrenPage,
    getTasksByIds,
    checkHierarchy,
    getHistory,
    insertTask,
    updateTask,
    addComment,
    updateComment,
    moveTask,
    reorderTask,
    reorderTasks,
    deleteTask,
    clearSpace,
    searchTasks,
    searchAllTasks,
    rebuildFts,
    setTaskDependencies,
    updateTaskWithDependencies,
    // Pipeline runs
    getRun,
    upsertRun,
    listRuns,
    listRunsBySpace,
    listActiveRuns,
    findActiveRunByTaskId,
    deleteRun: deleteRun,
    // People
    accounts,
    assignees,
    renameAssignee,
    dataDir,
    // Lifecycle
    close,
  };
}

module.exports = { createStore, DEFAULT_PRIORITY };
