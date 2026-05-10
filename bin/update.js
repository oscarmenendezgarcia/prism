'use strict';

/**
 * bin/update.js — `prism update` subcommand handler
 *
 * Fetches the latest version from npm, prompts for confirmation (TTY),
 * then runs `npm install -g prism-kanban@latest` via spawnSync.
 *
 * Exit codes:
 *   0 — already up to date, updated successfully, or user cancelled
 *   1 — network error or npm install failure
 */

const path      = require('path');
const readline  = require('readline');
const { spawnSync } = require('child_process');

const { fetchLatestVersion } = require(path.join(__dirname, 'update-check.js'));
const { version: installedVersion } = require(path.join(__dirname, '..', 'package.json'));

// ---------------------------------------------------------------------------
// Helpers (injectable for tests)
// ---------------------------------------------------------------------------

/**
 * Prompt the user for input via stdin.
 * Returns a Promise that resolves with the trimmed line.
 *
 * @param {string} question
 * @param {NodeJS.ReadableStream} [inputStream=process.stdin]
 * @returns {Promise<string>}
 */
function promptUser(question, inputStream = process.stdin) {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input:  inputStream,
      output: process.stdout,
      terminal: false,
    });

    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ---------------------------------------------------------------------------
// Main run function
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   silent?:       boolean,
 *   _fetchFn?:     Function,
 *   _spawnSync?:   Function,
 *   _isTTY?:       boolean,
 *   _inputStream?: NodeJS.ReadableStream,
 *   _exit?:        Function,
 * }} [flags]
 */
async function run(flags = {}) {
  const fetchFn    = flags._fetchFn    || globalThis.fetch;
  const spawnSyncFn = flags._spawnSync || spawnSync;
  const exitFn     = flags._exit       || (code => process.exit(code));
  const isTTY      = flags._isTTY !== undefined ? flags._isTTY : Boolean(process.stdout.isTTY);
  const inputStream = flags._inputStream || process.stdin;

  // 1. Fetch latest version (longer timeout for interactive command)
  let latestVersion;
  try {
    latestVersion = await fetchLatestVersion(5000, fetchFn);
  } catch {
    process.stderr.write('Error: could not fetch version from npm. Check your connection.\n');
    return exitFn(1);
  }

  // 2. Already up to date?
  if (latestVersion === installedVersion) {
    process.stdout.write(`prism is already on the latest version (v${installedVersion})\n`);
    return exitFn(0);
  }

  // 3. Prompt for confirmation
  process.stdout.write(`Update prism-kanban v${installedVersion} → v${latestVersion}? [y/N] `);

  let answer;
  if (!isTTY) {
    // Non-TTY (CI) — auto-confirm
    process.stdout.write('y\n'); // echo for visibility in CI logs
    answer = 'y';
  } else {
    answer = await promptUser('', inputStream);
  }

  const confirmed = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';

  if (!confirmed) {
    process.stdout.write('Cancelled.\n');
    return exitFn(0);
  }

  // 4. Run npm install -g prism-kanban@latest
  const result = spawnSyncFn('npm', ['install', '-g', 'prism-kanban@latest'], {
    stdio: 'inherit',
    shell: false,
  });

  if (result.status !== 0) {
    const code = result.status !== null ? result.status : 'unknown';
    process.stderr.write(`Error: npm install failed (exit code ${code})\n`);
    return exitFn(1);
  }

  // 5. Success
  process.stdout.write(`✓ Updated to v${latestVersion}\n`);
  return exitFn(0);
}

module.exports = { run };
