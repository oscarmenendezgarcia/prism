'use strict';

/**
 * cliAdapters — pluggable CLI-harness adapter registry (MODEL-3 base).
 *
 * One adapter per supported cliTool ('claude', 'opencode', …). Each adapter
 * owns everything a harness needs to be spawned headlessly by the pipeline:
 *
 *   - resolveBinary()            → absolute path to the CLI binary
 *   - needsPromptFile            → whether the harness takes its prompt as a
 *                                  merged system-prompt+task file (opencode, pi)
 *                                  vs stdin/argv (claude)
 *   - buildPromptFile(opts)      → write the merged prompt file (when needed)
 *   - buildUnixCommand(opts)     → full `sh -c` command incl. done-sentinel trap
 *   - buildWindowsCommand(opts)  → full `cmd.exe /C` command incl. sentinel
 *   - metaSource(agentMode)      → the `source` label for stage meta.json
 *
 * This is the single extension point: to add a new harness (e.g. `pi`, `custom`)
 * you add one entry to ADAPTERS — no pipelineManager.js changes required.
 *
 * The shell-command builders and sentinel wrappers live here (moved out of
 * pipelineManager.js) so every harness reuses the same EXIT-trap / cmd.exe
 * scaffolding.
 */

const fs   = require('fs');
const path = require('path');

const cliSpawn = require('./cliSpawn');

// ---------------------------------------------------------------------------
// Done-sentinel scaffolding (shared by all harnesses)
// ---------------------------------------------------------------------------

/**
 * Wrap a CLI invocation line in the Unix sh done-sentinel scaffold. An EXIT trap
 * guarantees the sentinel is written even if the wrapper receives SIGTERM while
 * the CLI is shutting down. Idempotent — skips the write if the polling loop
 * already wrote it.
 */
function wrapUnixSentinel(cliLine, doneFile, preDoneLine) {
  return [
    `_DONE=${cliSpawn.shellEscape(doneFile)}`,
    '_EXIT=1',
    "trap '[ -e \"$_DONE\" ] || echo $_EXIT > \"$_DONE\"' EXIT",
    cliLine,
    ...(preDoneLine ? [preDoneLine] : []),
    '_EXIT=$?',
  ].join('; ');
}

/**
 * Wrap a CLI invocation line in the Windows cmd.exe done-sentinel scaffold (no
 * trap available; the sentinel is written before exit).
 */
function wrapWindowsSentinel(cliLine, doneFile) {
  return [
    cliLine,
    'set _EXIT=!ERRORLEVEL!',
    `if not exist ${cliSpawn.cmdEscape(doneFile)} echo !_EXIT! > ${cliSpawn.cmdEscape(doneFile)}`,
    'exit /B 0',
  ].join(' & ');
}

// ---------------------------------------------------------------------------
// claude adapter
// ---------------------------------------------------------------------------

const claudeAdapter = {
  name:            'claude',
  needsPromptFile: false,

  resolveBinary() {
    return cliSpawn.resolveCliBinary('claude');
  },

  /** claude reads the task prompt from stdin; no merged file is needed. */
  buildPromptFile() {
    return null;
  },

  buildUnixCommand({ binary, finalArgs, promptPath, logPath, doneFile, preDoneLine }) {
    const escapedArgs = finalArgs.map(cliSpawn.shellEscape).join(' ');
    const cliLine = `${binary} ${escapedArgs} < ${cliSpawn.shellEscape(promptPath)} >> ${cliSpawn.shellEscape(logPath)} 2>&1`;
    return wrapUnixSentinel(cliLine, doneFile, preDoneLine);
  },

  buildWindowsCommand({ binary, finalArgs, promptPath, logPath, doneFile }) {
    const escapedArgs = finalArgs.map(cliSpawn.cmdEscape).join(' ');
    const cliLine = `${cliSpawn.cmdEscape(binary)} ${escapedArgs} < ${cliSpawn.cmdEscape(promptPath)} >> ${cliSpawn.cmdEscape(logPath)} 2>&1`;
    return wrapWindowsSentinel(cliLine, doneFile);
  },

  metaSource(agentMode) {
    return agentMode === 'subagent' ? 'claude-code' : 'plain';
  },
};

// ---------------------------------------------------------------------------
// opencode adapter
// ---------------------------------------------------------------------------

const opencodeAdapter = {
  name:            'opencode',
  needsPromptFile: true,

  resolveBinary() {
    return cliSpawn.resolveCliBinary('opencode');
  },

  /**
   * Write the merged prompt file for an opencode stage.
   * Content = agentSpec.systemPrompt + "\n\n---\n\n" + taskPromptContent.
   * If agentSpec is absent/empty, writes only the task prompt (graceful fallback).
   *
   * @returns {string|null} Absolute path to the written prompt file, or null if
   *                        the task prompt file cannot be read.
   */
  buildPromptFile({ agentSpec, taskPromptPath, runDirPath, stageIndex, fileName }) {
    const taskPromptContent = fs.readFileSync(taskPromptPath, 'utf8');
    const merged = cliSpawn.buildMergedPrompt(agentSpec, taskPromptContent);
    const name = fileName || `stage-${stageIndex}-oc-prompt.md`;
    const outPath = path.join(runDirPath, name);
    fs.writeFileSync(outPath, merged, 'utf8');
    return outPath;
  },

  buildUnixCommand({ binary, model, mergedPromptPath, logPath, doneFile, preDoneLine }) {
    const cliLine = cliSpawn.opencodeCliLine({ binary, model, mergedPromptPath, logPath, platform: 'unix' });
    return wrapUnixSentinel(cliLine, doneFile, preDoneLine);
  },

  buildWindowsCommand({ binary, model, mergedPromptPath, logPath, doneFile }) {
    const cliLine = cliSpawn.opencodeCliLine({ binary, model, mergedPromptPath, logPath, platform: 'win32' });
    return wrapWindowsSentinel(cliLine, doneFile);
  },

  metaSource() {
    return 'plain';
  },
};

// ---------------------------------------------------------------------------
// Registry + lookup
// ---------------------------------------------------------------------------

/** Registered CLI-harness adapters, keyed by cliTool name. */
const ADAPTERS = {
  claude:   claudeAdapter,
  opencode: opencodeAdapter,
};

/**
 * Resolve the adapter for a cliTool name. Unknown cliTools throw so the caller
 * fails fast (binary resolution also throws for unknown tools).
 *
 * @param {string} [cliTool]  - cliTool name ('claude' | 'opencode' | …). Defaults to 'claude'.
 * @returns {object}  The adapter.
 * @throws {Error} 'CLI_ADAPTER_NOT_FOUND:<cliTool>' for unknown cliTool.
 */
function getAdapter(cliTool) {
  const name = cliTool || 'claude';
  const adapter = ADAPTERS[name];
  if (!adapter) throw new Error(`CLI_ADAPTER_NOT_FOUND:${name}`);
  return adapter;
}

/** Register (or override) an adapter, e.g. for tests or dynamic harnesses. */
function registerAdapter(name, adapter) {
  if (!name || typeof name !== 'string') throw new Error('adapter name must be a non-empty string');
  if (!adapter || typeof adapter !== 'object') throw new Error('adapter must be an object');
  ADAPTERS[name] = adapter;
}

module.exports = {
  ADAPTERS,
  getAdapter,
  registerAdapter,
  wrapUnixSentinel,
  wrapWindowsSentinel,
};
