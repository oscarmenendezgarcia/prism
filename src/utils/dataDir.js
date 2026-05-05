'use strict';

/**
 * dataDir.js — Pure data-directory resolver for prism-kanban.
 *
 * Precedence (highest → lowest):
 *   1. env.DATA_DIR   — explicit override (escape hatch for scripts/CI)
 *   2. .git presence  — dev checkout: use <packageRoot>/data
 *   3. XDG_DATA_HOME  — XDG-compliant: $XDG_DATA_HOME/prism
 *   4. Home fallback  — ~/.local/share/prism
 *
 * The function is side-effect-free except for the single fs.existsSync call
 * used to detect .git (no I/O to the chosen path itself — callers must mkdir).
 */

const path = require('path');
const fs   = require('fs');

/**
 * Resolve the Prism data directory.
 *
 * @param {object} inputs
 * @param {NodeJS.ProcessEnv} inputs.env         - process.env (or stub for tests)
 * @param {string}            inputs.packageRoot  - absolute path of the package root
 *                                                  (pass __dirname of server.js or bin/cli.js)
 * @param {string}            inputs.homedir      - os.homedir() (injectable for tests)
 * @returns {{ path: string, mode: 'env' | 'dev' | 'xdg' | 'home' }}
 */
function resolveDataDir({ env, packageRoot, homedir }) {
  // Branch 1 — explicit DATA_DIR env var
  if (env.DATA_DIR) {
    return { path: env.DATA_DIR, mode: 'env' };
  }

  // Branch 2 — .git presence → development checkout
  const gitDir = path.join(packageRoot, '.git');
  if (fs.existsSync(gitDir)) {
    return { path: path.join(packageRoot, 'data'), mode: 'dev' };
  }

  // Branch 3 — XDG_DATA_HOME
  if (env.XDG_DATA_HOME) {
    return { path: path.join(env.XDG_DATA_HOME, 'prism'), mode: 'xdg' };
  }

  // Branch 4 — home fallback
  return { path: path.join(homedir, '.local', 'share', 'prism'), mode: 'home' };
}

module.exports = { resolveDataDir };
