'use strict';

/**
 * cliSpawn — shared CLI-tool resolution for agent spawns (MODEL-2).
 *
 * Single source of truth for "given a resolved cliTool, which binary do I run
 * and what is the opencode invocation line?". Used by every spawn site so the
 * model-routing choice (claude vs opencode) is honoured consistently:
 *   - pipelineManager.js  — normal pipeline stages, folio-consolidator, cross-agent resolution
 *   - folioBootstrap.js   — the activation-time folio-bootstrapper (outside the pipeline)
 *
 * Before this module, only the normal pipeline stage consulted the resolver;
 * the three auxiliary spawn sites hardcoded the claude binary, so setting an
 * agent to opencode had no effect on them.
 *
 * Self-contained: depends only on fs/child_process (+ modelConfigResolver). It
 * MUST NOT require pipelineManager (that would be circular).
 */

const fs = require('fs');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Shell escaping (identical to pipelineManager's — kept here as the shared copy)
// ---------------------------------------------------------------------------

function shellEscape(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function cmdEscape(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

let CLAUDE_BIN = null;
let OPENCODE_BIN = null;

/** Resolve (and cache) the claude binary path, falling back through common locations. */
function claudeBinary() {
  if (CLAUDE_BIN) return CLAUDE_BIN;
  CLAUDE_BIN = 'claude';
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
      if (p && fs.existsSync(p)) { CLAUDE_BIN = p; break; }
    } catch { /* try next */ }
  }
  return CLAUDE_BIN;
}

/**
 * Resolve the absolute binary path for a cliTool.
 * Mirrors pipelineManager.resolveCliBinary exactly.
 *
 * @param {'claude'|'opencode'|'custom'|undefined} cliTool
 * @returns {string}
 * @throws {Error} 'BINARY_NOT_FOUND:<cliTool>' when the binary cannot be located.
 */
function resolveCliBinary(cliTool) {
  if (!cliTool || cliTool === 'claude') return claudeBinary();

  if (cliTool === 'opencode') {
    if (OPENCODE_BIN !== null) return OPENCODE_BIN;
    const home = process.env.HOME ?? '';
    const candidates = [
      () => execSync('which opencode 2>/dev/null', { encoding: 'utf8', env: process.env }).trim(),
      () => `${home}/.opencode/bin/opencode`,
    ];
    for (const candidate of candidates) {
      try {
        const p = candidate();
        if (p && fs.existsSync(p)) { OPENCODE_BIN = p; return OPENCODE_BIN; }
      } catch { /* try next */ }
    }
    throw new Error('BINARY_NOT_FOUND:opencode');
  }

  // 'custom' has no binary-resolution strategy yet (parity with pipelineManager).
  throw new Error(`BINARY_NOT_FOUND:${cliTool}`);
}

// ---------------------------------------------------------------------------
// Prompt + command construction
// ---------------------------------------------------------------------------

/**
 * Merge an agent's system prompt (the .md body) with a task/stage prompt for the
 * opencode `--file` flag (opencode has no separate system-prompt channel). When
 * the spec has no systemPrompt, the task prompt is returned unchanged.
 *
 * @param {{ systemPrompt?: string }|null} agentSpec
 * @param {string} taskPromptContent
 * @returns {string}
 */
function buildMergedPrompt(agentSpec, taskPromptContent) {
  const systemPrompt = agentSpec && agentSpec.systemPrompt ? agentSpec.systemPrompt.trim() : '';
  return systemPrompt ? `${systemPrompt}\n\n---\n\n${taskPromptContent}` : taskPromptContent;
}

/**
 * Build the opencode CLI invocation line (tool + flags + redirects), WITHOUT the
 * done-sentinel scaffold — callers wrap it with their own sentinel/cleanup.
 *
 * @param {{ binary: string, model: string, mergedPromptPath: string, logPath: string, platform?: string }} opts
 * @returns {string}
 */
function opencodeCliLine({ binary, model, mergedPromptPath, logPath, platform }) {
  const esc = platform === 'win32' ? cmdEscape : shellEscape;
  const proceed = platform === 'win32' ? '"Proceed."' : "'Proceed.'";
  return `${esc(binary)} run --model ${esc(model)} --dangerously-skip-permissions --format default --file ${esc(mergedPromptPath)} ${proceed} >> ${esc(logPath)} 2>&1`;
}

module.exports = {
  shellEscape,
  cmdEscape,
  resolveCliBinary,
  buildMergedPrompt,
  opencodeCliLine,
};
