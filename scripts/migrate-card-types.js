'use strict';

/**
 * migrate-card-types.js — v1.2.0 data migration
 *
 * Migrates all existing task records from the legacy type enum
 * ['task', 'research'] to the new enum ['feature', 'bug', 'tech-debt', 'chore'].
 *
 * Rules (per wireframes.md § Script de migración de datos):
 *   type === 'task'     → 'chore'
 *   type === 'research' → 'chore'
 *   any other unknown   → 'chore'  (defensive fallback)
 *   already valid types → unchanged
 *
 * Idempotent: re-running produces no further changes.
 * Atomic write: tmp file → renameSync (consistent with server.js pattern).
 *
 * Usage: node scripts/migrate-card-types.js
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR    = path.join(__dirname, '..', 'data');
const SPACES_DIR  = path.join(DATA_DIR, 'spaces');
const COLUMNS     = ['todo', 'in-progress', 'done'];
const VALID_TYPES = new Set(['feature', 'bug', 'tech-debt', 'chore']);

/**
 * Migrate a single task's type field in-place.
 * @param {object} task
 * @returns {{ task: object, changed: boolean }}
 */
function migrateTaskType(task) {
  if (VALID_TYPES.has(task.type)) {
    return { task, changed: false };
  }
  return {
    task: { ...task, type: 'chore', updatedAt: new Date().toISOString() },
    changed: true,
  };
}

/**
 * Read, migrate, and atomically write a column JSON file.
 * @param {string} filePath  Absolute path to the column file.
 * @returns {{ migrated: number, total: number }}
 */
function migrateColumnFile(filePath) {
  if (!fs.existsSync(filePath)) return { migrated: 0, total: 0 };

  const raw = fs.readFileSync(filePath, 'utf8');
  const tasks = JSON.parse(raw);

  if (!Array.isArray(tasks)) {
    console.warn(`  [skip] ${filePath} — not an array`);
    return { migrated: 0, total: 0 };
  }

  let migrated = 0;
  const updated = tasks.map((task) => {
    const { task: t, changed } = migrateTaskType(task);
    if (changed) migrated++;
    return t;
  });

  if (migrated > 0) {
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(updated, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  return { migrated, total: tasks.length };
}

function run() {
  if (!fs.existsSync(SPACES_DIR)) {
    console.log(`[migrate] data/spaces/ directory not found at ${SPACES_DIR} — nothing to migrate.`);
    return;
  }

  const spacesFile = path.join(DATA_DIR, 'spaces.json');
  if (!fs.existsSync(spacesFile)) {
    console.log('[migrate] spaces.json not found — no spaces to migrate.');
    return;
  }

  const spaces = JSON.parse(fs.readFileSync(spacesFile, 'utf8'));
  if (!Array.isArray(spaces) || spaces.length === 0) {
    console.log('[migrate] No spaces found — nothing to migrate.');
    return;
  }

  let totalMigrated = 0;
  let totalTasks    = 0;

  for (const space of spaces) {
    const spaceDir = path.join(SPACES_DIR, space.id);
    if (!fs.existsSync(spaceDir)) continue;

    console.log(`[migrate] Space: ${space.name} (${space.id})`);
    for (const column of COLUMNS) {
      const file = path.join(spaceDir, `${column}.json`);
      const { migrated, total } = migrateColumnFile(file);
      totalMigrated += migrated;
      totalTasks    += total;
      if (total > 0) {
        console.log(`  ${column}: ${total} tasks, ${migrated} migrated`);
      }
    }
  }

  console.log(`\n[migrate] Done. ${totalMigrated}/${totalTasks} tasks migrated to 'chore'.`);
}

run();
