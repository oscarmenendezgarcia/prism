#!/usr/bin/env node
'use strict';

/**
 * bin/doctor.js — `prism doctor` runner and output formatters.
 *
 * Builds the check context, runs every check in CHECKS, then formats
 * output as human-readable text (default) or machine-readable JSON (--json).
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed (or uncaught internal error)
 */

const path = require('path');
const os   = require('os');

const { resolveDataDir } = require(path.join(__dirname, '..', 'src', 'utils', 'dataDir.js'));
const { CHECKS }         = require(path.join(__dirname, '..', 'src', 'utils', 'doctor', 'checks.js'));

const PACKAGE_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------

const ANSI_GREEN = '\x1b[32m';
const ANSI_RED   = '\x1b[31m';
const ANSI_RESET = '\x1b[0m';

/**
 * Returns true when the process stdout is a real TTY and NO_COLOR is unset.
 * Called lazily so tests can override process.stdout.isTTY before invocation.
 */
function shouldColorize() {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function green(str) { return shouldColorize() ? `${ANSI_GREEN}${str}${ANSI_RESET}` : str; }
function red(str)   { return shouldColorize() ? `${ANSI_RED}${str}${ANSI_RESET}`   : str; }

// ---------------------------------------------------------------------------
// Text formatter
// ---------------------------------------------------------------------------

// Width of the check name column (pad right so messages align)
const NAME_COL_WIDTH = 26;

/**
 * Format an array of check results as human-readable text.
 *
 * @param {{ name: string, status: 'pass'|'fail', message: string }[]} results
 * @returns {string}
 */
function formatText(results) {
  const lines = ['prism doctor — environment check', ''];

  for (const r of results) {
    const icon    = r.status === 'pass' ? green('✓') : red('✗');
    const padded  = r.name.padEnd(NAME_COL_WIDTH);
    lines.push(`  ${icon} ${padded} ${r.message}`);
  }

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.length - passed;

  lines.push('');
  if (failed === 0) {
    lines.push(`${passed}/${results.length} checks passed.`);
  } else {
    lines.push(`${passed}/${results.length} checks passed — ${failed} failed.`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// JSON formatter
// ---------------------------------------------------------------------------

/**
 * Serialize results to the documented JSON schema.
 *
 * @param {boolean} ok
 * @param {{ name: string, status: string, message: string, details?: object }[]} results
 * @returns {string}
 */
function formatJson(ok, results) {
  return JSON.stringify({ ok, checks: results });
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run all doctor checks and print results.
 *
 * @param {object}  flags
 * @param {boolean} [flags.json]    — machine-readable output
 * @param {string}  [flags.dataDir] — explicit data directory override
 */
function run(flags = {}) {
  try {
    // ── Resolve data directory ────────────────────────────────────────────────
    let dataDir;
    if (flags.dataDir) {
      dataDir = flags.dataDir;
    } else {
      const resolved = resolveDataDir({
        env:         process.env,
        packageRoot: PACKAGE_ROOT,
        homedir:     os.homedir(),
      });
      dataDir = resolved.path;
    }

    // ── Build context ─────────────────────────────────────────────────────────
    const ctx = {
      env:         process.env,
      packageRoot: PACKAGE_ROOT,
      dataDir,
    };

    // ── Run checks ────────────────────────────────────────────────────────────
    const results = CHECKS.map(fn => fn(ctx));
    const ok      = results.every(r => r.status === 'pass');

    // ── Format and output ─────────────────────────────────────────────────────
    if (flags.json) {
      process.stdout.write(formatJson(ok, results) + '\n');
    } else {
      process.stdout.write(formatText(results) + '\n');
    }

    process.exit(ok ? 0 : 1);
  } catch (err) {
    process.stderr.write(`[doctor] FATAL: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}

module.exports = { run, formatText, formatJson };

// ---------------------------------------------------------------------------
// Direct invocation
// ---------------------------------------------------------------------------

if (require.main === module) {
  run({});
}
