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
    '_EXIT=$?',
    ...(preDoneLine ? [preDoneLine] : []),
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

  /**
   * Build direct spawn args for one-shot headless use (autoTask / launcher).
   * claude takes the prompt on stdin and the system prompt via --system-prompt.
   *
   * @returns {{ args: string[], stdin: string|null, cleanup?: string[] }}
   */
  buildArgs({ model, systemPrompt, prompt }) {
    const args = [
      '--print',
      '--system-prompt', systemPrompt,
      '--model', model,
      '--dangerously-skip-permissions',
      '--no-session-persistence',
    ];
    return { args, stdin: prompt };
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
   * Build direct spawn args for one-shot headless use (autoTask / launcher).
   * opencode needs the merged system+task prompt as a file (`--file`); the
   * caller must clean up the temp file listed in `cleanup`.
   *
   * @returns {{ args: string[], stdin: string|null, cleanup?: string[] }}
   */
  buildArgs({ model, systemPrompt, prompt, tmpDir }) {
    const merged = cliSpawn.buildMergedPrompt({ systemPrompt }, prompt);
    const tmpFile = path.join(tmpDir, `oc-autotask-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, merged, 'utf8');
    return {
      args: [
        'run',
        '--model', model,
        '--dangerously-skip-permissions',
        '--format', 'default',
        'Proceed.',
        '--file', tmpFile,
      ],
      stdin: null,
      cleanup: [tmpFile],
    };
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
    // Preserve the pre-refactor telemetry event (was emitted by buildOpencodePromptFile).
    process.stderr.write(`[PIPELINE] ${JSON.stringify({ event: 'stage.opencode_prompt_written', stageIndex, mergedPromptPath: outPath, bytes: Buffer.byteLength(merged, 'utf8'), ts: new Date().toISOString() })}\n`);
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
// Shared prompt-file writer (used by needsPromptFile harnesses)
// ---------------------------------------------------------------------------

/**
 * Write the merged prompt file (systemPrompt + task prompt) for a harness whose
 * needsPromptFile is true. Shared by the pi and hermes adapters — opencode keeps
 * its own copy because it additionally emits a telemetry event.
 *
 * @param {object} opts
 * @param {object|null} opts.agentSpec      - Parsed agent spec (for system prompt).
 * @param {string}      opts.taskPromptPath - Path to the task prompt file.
 * @param {string}      opts.runDirPath     - Directory to write the prompt into.
 * @param {number}      opts.stageIndex     - Pipeline stage index (default file name).
 * @param {string}      [opts.fileName]     - Explicit prompt file name (overrides default).
 * @param {string}      [opts.defaultName]  - Default file name when fileName is absent.
 * @returns {string|null} Absolute path to the written file, or null if the task
 *                        prompt file cannot be read.
 */
function writeMergedPromptFile({ agentSpec, taskPromptPath, runDirPath, stageIndex, fileName, defaultName }) {
  const taskPromptContent = fs.readFileSync(taskPromptPath, 'utf8');
  const merged = cliSpawn.buildMergedPrompt(agentSpec, taskPromptContent);
  const name = fileName || defaultName || `stage-${stageIndex}-prompt.md`;
  const outPath = path.join(runDirPath, name);
  fs.writeFileSync(outPath, merged, 'utf8');
  return outPath;
}

// ---------------------------------------------------------------------------
// pi adapter (MODEL-3)
// ---------------------------------------------------------------------------

const piAdapter = {
  name:            'pi',
  needsPromptFile: true,

  // `pi -p` is non-interactive: it processes the whole prompt and writes its
  // output only when it finishes. Nothing reaches the stage log in between, so
  // the manager's stall watchdog — which treats an un-growing log as a dead
  // stage — would kill every pi stage at the 15-minute mark no matter how well
  // it was doing. Opting out means such a stage is bounded by the stage timeout
  // and the done sentinel alone. Verified 2026-08-27, run f0163a12: killed as
  // 'stall' with the fix and 99 lines of tests already committed and pushed.
  streamsProgress: false,

  resolveBinary() {
    return cliSpawn.resolveCliBinary('pi');
  },

  /**
   * Build direct spawn args for one-shot headless use (autoTask / launcher).
   * pi reads the prompt from stdin; the system+task prompt is merged on stdin.
   *
   * @returns {{ args: string[], stdin: string|null }}
   */
  buildArgs({ model, systemPrompt, prompt }) {
    const merged = cliSpawn.buildMergedPrompt({ systemPrompt }, prompt);
    return { args: ['-p', '--model', model], stdin: merged };
  },

  /**
   * Write the merged prompt file for a pi stage (systemPrompt + task prompt).
   * pi reads it from stdin, so the merged content is redirected via `<`.
   */
  buildPromptFile(opts) {
    return writeMergedPromptFile({ ...opts, defaultName: `stage-${opts.stageIndex}-pi-prompt.md` });
  },

  buildUnixCommand({ binary, model, mergedPromptPath, logPath, doneFile, preDoneLine }) {
    const cliLine = cliSpawn.piCliLine({ binary, model, mergedPromptPath, logPath, platform: 'unix' });
    return wrapUnixSentinel(cliLine, doneFile, preDoneLine);
  },

  buildWindowsCommand({ binary, model, mergedPromptPath, logPath, doneFile }) {
    const cliLine = cliSpawn.piCliLine({ binary, model, mergedPromptPath, logPath, platform: 'win32' });
    return wrapWindowsSentinel(cliLine, doneFile);
  },

  metaSource() {
    return 'plain';
  },
};

// ---------------------------------------------------------------------------
// hermes adapter (MODEL-3)
// ---------------------------------------------------------------------------

const hermesAdapter = {
  name:            'hermes',
  needsPromptFile: true,

  resolveBinary() {
    return cliSpawn.resolveCliBinary('hermes');
  },

  /**
   * Build direct spawn args for one-shot headless use (autoTask / launcher).
   * hermes takes the prompt via `-q` (flag); the merged system+task prompt is
   * passed inline. Auto-task prompts are small, so ARG_MAX is not a concern here.
   *
   * @returns {{ args: string[], stdin: string|null }}
   */
  buildArgs({ model, systemPrompt, prompt }) {
    const merged = cliSpawn.buildMergedPrompt({ systemPrompt }, prompt);
    const args = ['chat', '-q', merged, '--cli', '-Q'];
    if (model) args.push('-m', model);
    return { args, stdin: null };
  },

  /**
   * Write the merged prompt file for a hermes stage (systemPrompt + task prompt).
   * hermes reads it via `-q "$(cat file)"` (no stdin prompt channel).
   */
  buildPromptFile(opts) {
    return writeMergedPromptFile({ ...opts, defaultName: `stage-${opts.stageIndex}-hermes-prompt.md` });
  },

  buildUnixCommand({ binary, model, mergedPromptPath, logPath, doneFile, preDoneLine }) {
    const cliLine = cliSpawn.hermesCliLine({ binary, model, mergedPromptPath, logPath, platform: 'unix' });
    return wrapUnixSentinel(cliLine, doneFile, preDoneLine);
  },

  buildWindowsCommand({ binary, model, mergedPromptPath, logPath, doneFile }) {
    const cliLine = cliSpawn.hermesCliLine({ binary, model, mergedPromptPath, logPath, platform: 'win32' });
    return wrapWindowsSentinel(cliLine, doneFile);
  },

  metaSource() {
    return 'plain';
  },
};

// ---------------------------------------------------------------------------
// custom adapter (MODEL-3)
//
// A user-supplied arbitrary command template. The template is the full
// executable command (the user writes the binary themselves) and may reference
// the placeholders {model}, {prompt}, {log}, {done}. Placeholders are
// substituted raw at spawn time (no shell-escaping — custom is intentionally
// arbitrary shell, so the user must quote {model} and any path that may
// contain spaces). The expanded command is wrapped in the standard done-sentinel
// scaffold.
// ---------------------------------------------------------------------------

/**
 * Expand {placeholder}s in a custom command template.
 * Unknown braces are left as-is (validation happens in modelConfigResolver).
 *
 * @param {string} command
 * @param {{ model?: string, prompt?: string, log?: string, done?: string }} values
 * @returns {string}
 */
function expandCustomCommand(command, values) {
  const map = {
    '{model}':  values.model  || '',
    '{prompt}': values.prompt || '',
    '{log}':    values.log    || '',
    '{done}':   values.done   || '',
  };
  return String(command).replace(/\{[a-zA-Z_]+\}/g, (m) => (m in map ? map[m] : m));
}

const customAdapter = {
  name:            'custom',
  needsPromptFile: false,

  /** No single binary — the command template is the executable. */
  resolveBinary() {
    return null;
  },

  buildPromptFile() {
    return null;
  },

  buildUnixCommand({ command, model, promptPath, logPath, doneFile, preDoneLine }) {
    const expanded = expandCustomCommand(command, {
      model, prompt: promptPath, log: logPath, done: doneFile,
    });
    return wrapUnixSentinel(expanded, doneFile, preDoneLine);
  },

  buildWindowsCommand({ command, model, promptPath, logPath, doneFile }) {
    const expanded = expandCustomCommand(command, {
      model, prompt: promptPath, log: logPath, done: doneFile,
    });
    return wrapWindowsSentinel(expanded, doneFile);
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
  pi:       piAdapter,
  hermes:   hermesAdapter,
  custom:   customAdapter,
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

/**
 * Build the one-shot Launcher preview command for a harness (MODEL-3).
 * Delegates to the harness adapter so the Launcher preview matches the pipeline
 * routing (claude/opencode/pi/hermes). The command is shown to the user, not
 * spawned here, so no done-sentinel is attached.
 *
 * @param {{ cliTool: string, binary: string, model?: string, promptPath: string, fileInputMethod?: string }} opts
 * @returns {string}
 */
function buildLauncherCommand({ cliTool, binary, model, promptPath, fileInputMethod = 'cat-subshell' }) {
  // pi and hermes have a fixed prompt channel independent of fileInputMethod:
  // pi reads the prompt from stdin (`< file`), hermes via `-q "$(cat file)"`.
  if (cliTool === 'pi') {
    return `${binary} -p ${model ? `--model ${model} ` : ''}< "${promptPath}"`;
  }
  if (cliTool === 'hermes') {
    return `${binary} chat -q "$(cat ${promptPath})" --cli -Q${model ? ` -m ${model}` : ''}`;
  }

  let promptRef;
  if (fileInputMethod === 'stdin-redirect') {
    promptRef = `< "${promptPath}"`;
  } else if (fileInputMethod === 'flag-file') {
    promptRef = `--file "${promptPath}"`;
  } else {
    promptRef = `"$(cat ${promptPath})"`;
  }

  if (cliTool === 'opencode') {
    return `${binary} run ${promptRef}`;
  }
  // claude (default)
  return `${binary} ${promptRef}`;
}

module.exports = {
  ADAPTERS,
  getAdapter,
  registerAdapter,
  wrapUnixSentinel,
  wrapWindowsSentinel,
  expandCustomCommand,
  buildLauncherCommand,
};
