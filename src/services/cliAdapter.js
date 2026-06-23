'use strict';

/**
 * MODEL-1 — CliAdapter
 *
 * Encapsulates binary resolution and shell command building for pipeline stage
 * spawning. Extracted from pipelineManager.js so that multi-tool support
 * (claude / opencode / custom) can be added here without touching the manager.
 */

const fs        = require('fs');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Shell escaping (mirrors the functions in pipelineManager.js)
// ---------------------------------------------------------------------------

/** POSIX single-quote escaping for shell arguments. */
function shellEscape(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/** Windows cmd.exe path quoting. */
function cmdEscape(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the claude binary path (same logic as pipelineManager.js CLAUDE_BIN).
 *
 * @returns {string}
 */
function resolveClaudeBinary() {
  let bin = 'claude';
  const home = process.env.HOME ?? '';
  const candidates = [
    () => execSync('which claude 2>/dev/null', { encoding: 'utf8', env: process.env }).trim(),
    () => `${home}/.local/bin/claude`,
    () => '/usr/local/bin/claude',
    () => '/opt/homebrew/bin/claude',
  ];
  for (const candidate of candidates) {
    try {
      const p = candidate();
      if (p && fs.existsSync(p)) { bin = p; break; }
    } catch { /* try next */ }
  }
  return bin;
}

/**
 * Resolve the opencode binary path.
 *
 * @returns {string}
 * @throws {Error} when opencode is not found.
 */
function resolveOpencodeBinary() {
  const home = process.env.HOME ?? '';
  const candidates = [
    () => execSync('which opencode 2>/dev/null', { encoding: 'utf8', env: process.env }).trim(),
    () => `${home}/.local/bin/opencode`,
    () => '/usr/local/bin/opencode',
  ];
  for (const candidate of candidates) {
    try {
      const p = candidate();
      if (p && fs.existsSync(p)) return p;
    } catch { /* try next */ }
  }
  throw new Error('opencode binary not found. Install opencode or configure a custom binary.');
}

/**
 * Resolve the binary path for a given CLI tool.
 *
 * @param {'claude'|'opencode'|'custom'} cliTool
 * @param {string} [customBinary] - Required when cliTool === 'custom'.
 * @returns {string}
 */
function resolveCliBinary(cliTool, customBinary) {
  switch (cliTool) {
    case 'claude':   return resolveClaudeBinary();
    case 'opencode': return resolveOpencodeBinary();
    case 'custom': {
      if (!customBinary || customBinary.trim().length === 0) {
        throw new Error('cliTool is "custom" but no customBinary was provided.');
      }
      return customBinary.trim();
    }
    default:
      throw new Error(`Unknown cliTool '${cliTool}'.`);
  }
}

/**
 * Return the default claude binary (for backward-compat with pipelineManager).
 *
 * @returns {string}
 */
function getDefaultBinary() {
  return resolveClaudeBinary();
}

// ---------------------------------------------------------------------------
// Shell command builders
// ---------------------------------------------------------------------------

/**
 * Build the Unix sh command that runs the CLI, captures its exit code, and
 * writes the done-sentinel. Mirrors the exact pattern used in pipelineManager.
 *
 * @param {{ binary: string, finalArgs: string[], promptPath: string, logPath: string, doneFile: string }} opts
 * @returns {string}
 */
function buildUnixShellCommand({ binary, finalArgs, promptPath, logPath, doneFile }) {
  const escapedArgs = finalArgs.map(shellEscape).join(' ');
  return [
    `_DONE=${shellEscape(doneFile)}`,
    '_EXIT=1',
    "trap '[ -e \"$_DONE\" ] || echo $_EXIT > \"$_DONE\"' EXIT",
    `${binary} ${escapedArgs} < ${shellEscape(promptPath)} >> ${shellEscape(logPath)} 2>&1`,
    '_EXIT=$?',
  ].join('; ');
}

/**
 * Build the Windows cmd.exe command that runs the CLI, captures its exit code,
 * and writes the done-sentinel.
 *
 * @param {{ binary: string, finalArgs: string[], promptPath: string, logPath: string, doneFile: string }} opts
 * @returns {string}
 */
function buildWindowsShellCommand({ binary, finalArgs, promptPath, logPath, doneFile }) {
  const escapedArgs = finalArgs.map(cmdEscape).join(' ');
  return [
    `${cmdEscape(binary)} ${escapedArgs} < ${cmdEscape(promptPath)} >> ${cmdEscape(logPath)} 2>&1`,
    'set _EXIT=!ERRORLEVEL!',
    `if not exist ${cmdEscape(doneFile)} echo !_EXIT! > ${cmdEscape(doneFile)}`,
    'exit /B 0',
  ].join(' & ');
}

module.exports = {
  shellEscape,
  cmdEscape,
  resolveCliBinary,
  getDefaultBinary,
  buildUnixShellCommand,
  buildWindowsShellCommand,
};
