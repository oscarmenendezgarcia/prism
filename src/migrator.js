/**
 * Prism — Data Migrator
 *
 * ADR-1 (Spaces) §D1: Migrates legacy flat-file data (todo.json, in-progress.json,
 * done.json at the root of dataDir) into the directory-per-space model at
 * dataDir/spaces/default/.
 *
 * Safe to run multiple times — migration is idempotent. Once the legacy files
 * are migrated they are renamed to *.migrated so re-runs do not clobber data.
 *
 * Called once at server startup before spaceManager is initialised.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const COLUMN_NAMES = ['todo', 'in-progress', 'done'];

/**
 * Run the startup migration.
 * If legacy column files exist at the root of dataDir, move their contents
 * to the default space directory and rename the originals.
 *
 * @param {string} dataDir - Absolute path to the root data directory.
 */
function migrate(dataDir) {
  const defaultSpaceDir = path.join(dataDir, 'spaces', 'default');

  // Check whether any legacy column files exist at root level.
  const legacyFiles = COLUMN_NAMES.map((col) => ({
    col,
    src: path.join(dataDir, `${col}.json`),
    dst: path.join(defaultSpaceDir, `${col}.json`),
  })).filter(({ src }) => fs.existsSync(src));

  if (legacyFiles.length === 0) {
    // Nothing to migrate — either already migrated or a fresh install.
    return;
  }

  console.log(`[migrator] Found ${legacyFiles.length} legacy column file(s) — migrating to spaces/default/`);

  // Ensure the default space directory exists.
  if (!fs.existsSync(defaultSpaceDir)) {
    fs.mkdirSync(defaultSpaceDir, { recursive: true });
  }

  for (const { col, src, dst } of legacyFiles) {
    try {
      // If destination already exists, merge arrays rather than overwriting.
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

      // Merge: destination tasks take precedence (dedup by id).
      const dstIds = new Set(dstData.map((t) => t.id));
      const merged = [...dstData, ...srcData.filter((t) => !dstIds.has(t.id))];

      // Write merged data to destination (atomic).
      const tmp = dst + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8');
      fs.renameSync(tmp, dst);

      // Rename source so it is not processed again.
      fs.renameSync(src, src.replace('.json', '.migrated'));

      console.log(`[migrator] Migrated ${col}: ${srcData.length} task(s) → spaces/default/${col}.json`);
    } catch (err) {
      console.error(`[migrator] ERROR migrating ${col}:`, err.message);
      // Do not abort — continue with other columns.
    }
  }

  console.log('[migrator] Migration complete');
}

module.exports = { migrate };
