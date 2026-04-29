#!/usr/bin/env node
'use strict';

/**
 * Prism — Standalone SQLite Migration Script
 *
 * Usage:
 *   node scripts/migrate-to-sqlite.js [--data-dir <path>]
 *
 * Defaults to ./data relative to the project root.
 *
 * Behaviour:
 *   1. Opens (or creates) <dataDir>/prism.db via createStore(dataDir).
 *   2. Reads <dataDir>/spaces.json (if present and not yet migrated).
 *   3. For each space, inserts via store.upsertSpace() (INSERT OR REPLACE).
 *   4. For each column JSON file of each space, inserts tasks via
 *      store.upsertTask() (INSERT OR IGNORE — idempotent).
 *   5. Renames processed JSON files to <file>.migrated.
 *   6. Prints a summary and exits 0 on success, 1 on error.
 *
 * Idempotency: safe to re-run on a partially or fully migrated data dir.
 * Rollback:    stop the server, delete prism.db, restore original module
 *              files — the server will read JSON files again.
 */

const path = require('path');
const fs   = require('fs');

const projectRoot = path.resolve(__dirname, '..');

// Parse --data-dir argument
let dataDir = path.join(projectRoot, 'data');
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--data-dir' && process.argv[i + 1]) {
    dataDir = path.resolve(process.argv[i + 1]);
    i++;
  }
}

if (!fs.existsSync(dataDir)) {
  console.error(`[migrate-to-sqlite] data directory not found: ${dataDir}`);
  process.exit(1);
}

const { createStore } = require('../src/services/store');

const COLUMN_NAMES = ['todo', 'in-progress', 'done'];

async function main() {
  console.log(`[migrate-to-sqlite] dataDir: ${dataDir}`);

  const store = createStore(dataDir);

  const manifestPath = path.join(dataDir, 'spaces.json');
  if (!fs.existsSync(manifestPath)) {
    console.log('[migrate-to-sqlite] No spaces.json found — nothing to migrate (already done or fresh install).');
    store.close();
    return;
  }

  let spaces = [];
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    spaces = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[migrate-to-sqlite] ERROR reading spaces.json:', err.message);
    store.close();
    process.exit(1);
  }

  let totalSpaces = 0;
  let totalTasks  = 0;
  let errors      = 0;

  for (const space of spaces) {
    try {
      store.upsertSpace(space);
      console.log(`  space: ${space.id} (${space.name})`);
    } catch (err) {
      console.error(`  ERROR upserting space ${space.id}:`, err.message);
      errors++;
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
        console.error(`  ERROR reading ${colFile}:`, err.message);
        errors++;
        continue;
      }

      for (const task of tasks) {
        try {
          store.upsertTask(task, space.id, col);
          totalTasks++;
        } catch (err) {
          console.error(`  ERROR upserting task ${task.id}:`, err.message);
          errors++;
        }
      }

      try {
        fs.renameSync(colFile, colFile + '.migrated');
        console.log(`    ${col}: ${tasks.length} task(s) → migrated`);
      } catch (err) {
        console.error(`  ERROR renaming ${colFile}:`, err.message);
        errors++;
      }
    }

    totalSpaces++;
  }

  try {
    fs.renameSync(manifestPath, manifestPath + '.migrated');
    console.log('  spaces.json → spaces.json.migrated');
  } catch (err) {
    console.error('  ERROR renaming spaces.json:', err.message);
    errors++;
  }

  store.close();

  console.log(`\n[migrate-to-sqlite] Migrated ${totalSpaces} spaces, ${totalTasks} tasks.`);
  if (errors > 0) {
    console.error(`[migrate-to-sqlite] ${errors} error(s) encountered.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[migrate-to-sqlite] Fatal error:', err);
  process.exit(1);
});
