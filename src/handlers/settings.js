'use strict';

/**
 * Settings handlers — ADR-1 §3.4
 *
 * Persistence: data/settings.json with atomic write (.tmp + renameSync) and deep merge.
 *
 * NOTE: SETTINGS_FILE is NOT a module-level constant — it is computed dynamically
 * from dataDir inside readSettings/writeSettings so that test isolation via
 * startServer({ dataDir }) works correctly.
 */

const fs   = require('fs');
const path = require('path');

const { sendJSON, sendError, parseBody } = require('../utils/http');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  cli: {
    tool:            'claude',
    binary:          'claude',
    flags:           ['-p'],
    promptFlag:      '-p',
    fileInputMethod: 'cat-subshell',
  },
  pipeline: {
    autoAdvance:          true,
    confirmBetweenStages: true,
    stages: ['senior-architect', 'ux-api-designer', 'developer-agent', 'qa-engineer-e2e'],
    agentsDir:            '',
  },
  prompts: {
    includeKanbanBlock: true,
    includeGitBlock:    true,
    workingDirectory:   '',
  },
};

const VALID_CLI_TOOLS    = ['claude', 'opencode', 'custom'];
const VALID_FILE_METHODS = ['cat-subshell', 'stdin-redirect', 'flag-file'];

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/**
 * Deep-merge two plain objects (one level deep for known setting groups).
 * Immutable — returns a new object.
 */
function deepMergeSettings(base, partial) {
  const result = { ...base };
  for (const key of Object.keys(partial)) {
    if (
      partial[key] !== null &&
      typeof partial[key] === 'object' &&
      !Array.isArray(partial[key]) &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      result[key] = { ...base[key], ...partial[key] };
    } else {
      result[key] = partial[key];
    }
  }
  return result;
}

/**
 * Read settings from disk (or return defaults if file absent/corrupt).
 * Never throws — falls back to defaults on any error.
 *
 * @param {string} dataDir - Root data directory for this server instance.
 * @returns {object}
 */
function readSettings(dataDir) {
  const settingsFile = path.join(dataDir, 'settings.json');
  if (!fs.existsSync(settingsFile)) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw    = fs.readFileSync(settingsFile, 'utf8');
    const parsed = JSON.parse(raw);
    return deepMergeSettings(DEFAULT_SETTINGS, parsed);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Atomically write settings using .tmp + rename pattern.
 * Ensures data dir exists first.
 *
 * @param {string} dataDir   - Root data directory for this server instance.
 * @param {object} settings  - Full settings object to persist.
 */
function writeSettings(dataDir, settings) {
  const settingsFile = path.join(dataDir, 'settings.json');
  const dir          = path.dirname(settingsFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = settingsFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(tmp, settingsFile);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/settings
 */
function handleGetSettings(req, res, dataDir) {
  try {
    const settings = readSettings(dataDir);
    sendJSON(res, 200, settings);
  } catch (err) {
    console.error('[settings] ERROR reading settings:', err.message);
    sendError(res, 500, 'SETTINGS_READ_ERROR', 'Could not read the settings file.', {
      suggestion: 'Check that data/settings.json is readable and contains valid JSON.',
    });
  }
}

/**
 * PUT /api/v1/settings
 * Deep-merge partial body into current settings and persist atomically.
 */
async function handlePutSettings(req, res, dataDir) {
  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'The request body is empty or not valid JSON.', {
      suggestion: 'Send a partial settings object. Example: { "cli": { "tool": "opencode" } }',
    });
  }

  if (!body || typeof body !== 'object') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'The request body is empty or not valid JSON.', {
      suggestion: 'Send a partial settings object. Example: { "cli": { "tool": "opencode" } }',
    });
  }

  if (body.cli && body.cli.tool !== undefined && !VALID_CLI_TOOLS.includes(body.cli.tool)) {
    return sendError(res, 400, 'VALIDATION_ERROR', `The value '${body.cli.tool}' is not a valid CLI tool.`, {
      suggestion: "Use one of: 'claude', 'opencode', 'custom'.",
      field: 'cli.tool',
    });
  }

  if (body.cli && body.cli.fileInputMethod !== undefined && !VALID_FILE_METHODS.includes(body.cli.fileInputMethod)) {
    return sendError(res, 400, 'VALIDATION_ERROR', `The value '${body.cli.fileInputMethod}' is not a valid prompt delivery method.`, {
      suggestion: "Use one of: 'cat-subshell', 'stdin-redirect', 'flag-file'.",
      field: 'cli.fileInputMethod',
    });
  }

  try {
    const current  = readSettings(dataDir);
    const merged   = deepMergeSettings(current, body);
    writeSettings(dataDir, merged);
    console.log('[settings] Settings updated');
    sendJSON(res, 200, merged);
  } catch (err) {
    console.error('[settings] ERROR writing settings:', err.message);
    sendError(res, 500, 'SETTINGS_WRITE_ERROR', 'Could not save the settings file.', {
      suggestion: 'Check that the data/ directory is writable.',
    });
  }
}

module.exports = {
  DEFAULT_SETTINGS,
  readSettings,
  writeSettings,
  deepMergeSettings,
  handleGetSettings,
  handlePutSettings,
};
