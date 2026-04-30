'use strict';

/**
 * Prism — Data Migrator (SQLite edition)
 *
 * Phase 1 (legacy flat-file → spaces/default/): handled by the old migrator
 * logic, preserved here so a server started against a data dir that still has
 * root-level {todo,in-progress,done}.json files gets them moved into
 * data/spaces/default/ before the SQLite import runs.
 *
 * Phase 2 (JSON files → SQLite):
 *   - Opens (or creates) data/prism.db via createStore(dataDir).
 *   - Reads data/spaces.json (if present and not already .migrated).
 *   - For each space, inserts via store.upsertSpace() (INSERT OR REPLACE —
 *     idempotent: safe to re-run on a partially migrated DB).
 *   - For each column file of each space, inserts tasks via store.upsertTask()
 *     (INSERT OR IGNORE — existing rows are skipped).
 *   - Renames each processed file to <file>.migrated when all rows are stored.
 *
 * Both phases are idempotent. The function is called once at server startup
 * before any connections are accepted.
 *
 * @module migrator
 */

const fs   = require('fs');
const path = require('path');

const { createStore } = require('./store');

const COLUMN_NAMES = ['todo', 'in-progress', 'done'];

// ---------------------------------------------------------------------------
// Phase 1 — legacy root-level column files → spaces/default/
// ---------------------------------------------------------------------------

function migrateLegacyFiles(dataDir) {
  const defaultSpaceDir = path.join(dataDir, 'spaces', 'default');

  const legacyFiles = COLUMN_NAMES.map((col) => ({
    col,
    src: path.join(dataDir, `${col}.json`),
    dst: path.join(defaultSpaceDir, `${col}.json`),
  })).filter(({ src }) => fs.existsSync(src));

  if (legacyFiles.length === 0) return;

  console.log(`[migrator] Found ${legacyFiles.length} legacy column file(s) — migrating to spaces/default/`);

  if (!fs.existsSync(defaultSpaceDir)) {
    fs.mkdirSync(defaultSpaceDir, { recursive: true });
  }

  for (const { col, src, dst } of legacyFiles) {
    try {
      let srcData = [];
      let dstData = [];

      try {
        const raw = fs.readFileSync(src, 'utf8');
        srcData = JSON.parse(raw);
        if (!Array.isArray(srcData)) srcData = [];
      } catch { /* corrupt source — treat as empty */ }

      if (fs.existsSync(dst)) {
        try {
          const raw = fs.readFileSync(dst, 'utf8');
          dstData = JSON.parse(raw);
          if (!Array.isArray(dstData)) dstData = [];
        } catch { /* corrupt dest — treat as empty */ }
      }

      const dstIds = new Set(dstData.map((t) => t.id));
      const merged = [...dstData, ...srcData.filter((t) => !dstIds.has(t.id))];

      const tmp = dst + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8');
      fs.renameSync(tmp, dst);
      fs.renameSync(src, src.replace('.json', '.migrated'));

      console.log(`[migrator] Migrated legacy ${col}: ${srcData.length} task(s) → spaces/default/${col}.json`);
    } catch (err) {
      console.error(`[migrator] ERROR migrating legacy ${col}:`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — JSON files → SQLite
// ---------------------------------------------------------------------------

function migrateJsonToSqlite(dataDir, store) {
  const manifestPath = path.join(dataDir, 'spaces.json');

  if (!fs.existsSync(manifestPath)) {
    // No JSON manifest — either fresh install or already migrated.
    return { spaces: 0, tasks: 0 };
  }

  let spaces = [];
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    spaces = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[migrator] ERROR reading spaces.json:', err.message);
    return { spaces: 0, tasks: 0 };
  }

  const t0 = Date.now();
  let totalTasks = 0;
  let migratedSpaces = 0;

  for (const space of spaces) {
    try {
      store.upsertSpace(space);
    } catch (err) {
      console.error(`[migrator] ERROR upserting space ${space.id}:`, err.message);
      continue;
    }

    const spaceDir = path.join(dataDir, 'spaces', space.id);

    for (const col of COLUMN_NAMES) {
      const colFile = path.join(spaceDir, `${col}.json`);
      if (!fs.existsSync(colFile)) continue;

      let tasks = [];
      try {
        const raw = fs.readFileSync(colFile, 'utf8');
        const parsed = JSON.parse(raw);
        tasks = Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        console.error(`[migrator] ERROR reading ${colFile}:`, err.message);
        continue;
      }

      for (const task of tasks) {
        try {
          store.upsertTask(task, space.id, col);
          totalTasks++;
        } catch (err) {
          console.error(`[migrator] ERROR upserting task ${task.id}:`, err.message);
        }
      }

      // Rename source file so migration is not re-run for this column.
      try {
        fs.renameSync(colFile, colFile + '.migrated');
      } catch (err) {
        console.error(`[migrator] ERROR renaming ${colFile}:`, err.message);
      }
    }

    migratedSpaces++;
  }

  // Rename spaces.json after all spaces are processed.
  try {
    fs.renameSync(manifestPath, manifestPath + '.migrated');
  } catch (err) {
    console.error('[migrator] ERROR renaming spaces.json:', err.message);
  }

  // Rebuild the FTS5 index to cover all tasks just inserted.
  // The triggers only fire for INSERT/UPDATE/DELETE happening after the table
  // was created; INSERT OR IGNORE bypasses them when the table was pre-existing,
  // so a full rebuild ensures the index is coherent after every migration run.
  try {
    store.rebuildFts();
  } catch (err) {
    console.error('[migrator] ERROR rebuilding FTS5 index:', err.message);
  }

  const elapsed = Date.now() - t0;
  console.log(`[migrator] SQLite migration — ${migratedSpaces} spaces, ${totalTasks} tasks imported in ${elapsed}ms`);
  return { spaces: migratedSpaces, tasks: totalTasks };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run the full startup migration (both phases).
 *
 * Called once at server startup before any connections are accepted.
 * Returns the Store instance that the server should use for all subsequent
 * operations. The Store is also created here (not in server.js) so that the
 * DB schema is guaranteed to exist before any handler code runs.
 *
 * @param {string} dataDir - Absolute path to the root data directory.
 * @returns {import('./store').Store} - The open Store instance.
 */
function migrate(dataDir) {
  // Phase 1: Move any root-level column files to spaces/default/.
  migrateLegacyFiles(dataDir);

  // Open (or create) the SQLite DB. Schema is applied inside createStore().
  const store = createStore(dataDir);

  // Phase 2: Import JSON files into SQLite (no-op if already done).
  migrateJsonToSqlite(dataDir, store);

  return store;
}

module.exports = { migrate };
