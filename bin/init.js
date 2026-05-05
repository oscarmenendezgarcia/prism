#!/usr/bin/env node
'use strict';

/**
 * bin/init.js — `prism init` implementation
 *
 * Idempotently prepares the Prism data directory:
 *   1. Resolves the data directory (--data-dir flag > DATA_DIR env > resolveDataDir)
 *   2. Creates the directory tree (recursive mkdir)
 *   3. Writes a default settings.json if absent (or when --force is passed)
 *
 * Exit codes:
 *   0 — success
 *   1 — runtime error
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const { resolveDataDir } = require(path.join(__dirname, '..', 'src', 'utils', 'dataDir.js'));

// ---------------------------------------------------------------------------
// Default settings template
// ---------------------------------------------------------------------------

function defaultSettings() {
  return {
    pipeline: {
      agentsDir:  path.join(os.homedir(), '.claude', 'agents'),
      timeout:    600000,
      maxConcurrent: 5,
    },
    ui: {
      theme: 'dark',
    },
  };
}

// ---------------------------------------------------------------------------
// run() — callable from cli.js or directly as a script
// ---------------------------------------------------------------------------

/**
 * @param {object}  flags
 * @param {string}  [flags.dataDir]  - override from --data-dir
 * @param {boolean} [flags.force]    - overwrite existing settings.json
 * @param {boolean} [flags.silent]   - suppress output
 */
function run(flags = {}) {
  // Resolve data dir
  let dataDir, mode;

  if (flags.dataDir) {
    dataDir = flags.dataDir;
    mode    = 'env';
  } else {
    const resolved = resolveDataDir({
      env:         process.env,
      packageRoot: path.resolve(__dirname, '..'),
      homedir:     os.homedir(),
    });
    dataDir = resolved.path;
    mode    = resolved.mode;
  }

  // Ensure directory tree exists
  fs.mkdirSync(dataDir, { recursive: true });

  const settingsPath = path.join(dataDir, 'settings.json');
  const exists = fs.existsSync(settingsPath);

  let action;
  if (!exists || flags.force) {
    const settings = defaultSettings();
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    action = flags.force && exists ? 'overwritten' : 'created';
  } else {
    action = 'already exists — skipped';
  }

  if (!flags.silent) {
    console.log(`[init] data dir   : ${dataDir} (mode=${mode})`);
    console.log(`[init] settings   : ${settingsPath} (${action})`);
    console.log('[init] Done.');
  }
}

module.exports = { run };

// ---------------------------------------------------------------------------
// Direct invocation
// ---------------------------------------------------------------------------

if (require.main === module) {
  run({});
}
