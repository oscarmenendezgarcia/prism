'use strict';

/**
 * Auto-task handler — POST /api/v1/spaces/:spaceId/autotask/generate
 *
 * Accepts a natural-language prompt and generates Kanban tasks via the
 * configured AI CLI (`TAGGER_CLI`, default: `claude`), then persists them
 * directly to the target column JSON file.
 *
 * Request body:
 *   { prompt: string, column?: string }
 *   - column defaults to "todo"
 *
 * Response:
 *   { tasksCreated: number, tasks: Task[] }
 *
 * Error codes:
 *   400 VALIDATION_ERROR     — missing/invalid prompt or column
 *   404 SPACE_NOT_FOUND      — spaceId does not exist (checked by caller)
 *   409 AUTOTASK_RUNNING     — concurrent run for same spaceId
 *   502 AUTOTASK_CLI_ERROR   — CLI spawn failed or returned invalid JSON
 */

const fs   = require('fs');
const path = require('path');

const { sendJSON, sendError, parseBody } = require('../utils/http');
const { COLUMNS }                        = require('../constants');

// ---------------------------------------------------------------------------
// System prompt (loaded once at module init)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '../prompts/autotask-system.txt'),
  'utf8'
);

// ---------------------------------------------------------------------------
// Concurrency guard — one in-flight call per spaceId
// ---------------------------------------------------------------------------

/** @type {Set<string>} */
const runningSpaces = new Set();

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_COLUMNS = new Set(COLUMNS);
const DEFAULT_COLUMN = 'todo';

/**
 * Generate a simple time-based ID for new tasks.
 * Uses the same pattern as the task handler.
 *
 * @returns {string}
 */
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// AI call
// ---------------------------------------------------------------------------

/**
 * Call the configured AI CLI with the user's prompt and return parsed tasks.
 *
 * @param {string} prompt  — user's natural-language description
 * @returns {Promise<Array<{ title: string, type: string, description: string }>>}
 * @throws {Error} on spawn failure, non-zero exit, or invalid JSON response
 */
function callCLI(prompt) {
  const cli   = process.env.TAGGER_CLI   || 'claude';
  const model = process.env.TAGGER_MODEL || 'haiku';

  return new Promise((resolve, reject) => {
    const child = require('child_process').spawn(
      cli,
      [
        '--print',
        '--system-prompt', SYSTEM_PROMPT,
        '--model', model,
        '--dangerously-skip-permissions',
        '--no-session-persistence',
      ],
      { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn '${cli}': ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`'${cli}' exited with code ${code}: ${stderr.slice(0, 300)}`));
        return;
      }

      // Handle stream-json output (claude CLI default) and plain text fallback.
      let text = '';
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            text += event.delta.text;
          }
        } catch { /* ignore non-JSON lines */ }
      }

      const rawOutput = text || stdout;

      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        reject(new Error(`No JSON found in CLI output: ${rawOutput.slice(0, 200)}`));
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        reject(new Error(`CLI returned non-JSON: ${rawOutput.slice(0, 200)}`));
        return;
      }

      if (!parsed || !Array.isArray(parsed.tasks)) {
        reject(new Error(`CLI response missing "tasks" array: ${rawOutput.slice(0, 200)}`));
        return;
      }

      resolve(parsed.tasks);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Disk helpers
// ---------------------------------------------------------------------------

/**
 * Append tasks to a column JSON file atomically (.tmp → rename).
 *
 * @param {string} spaceDataDir
 * @param {string} column
 * @param {Array<object>} newTasks
 */
function appendTasksToColumn(spaceDataDir, column, newTasks) {
  const filePath = path.join(spaceDataDir, `${column}.json`);

  let existing = [];
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      existing = JSON.parse(raw);
      if (!Array.isArray(existing)) existing = [];
    } catch {
      console.warn(`[autotask] Failed to parse ${filePath} — starting fresh`);
      existing = [];
    }
  }

  const updated = [...existing, ...newTasks];
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/spaces/:spaceId/autotask/generate
 *
 * When `preview: true` — generates tasks via AI but does NOT persist them.
 * When `preview` is absent or false — generates AND persists (legacy behaviour).
 *
 * Request body:
 *   { prompt: string, column?: string, preview?: boolean }
 *
 * Response:
 *   { tasksCreated: number, tasks: Task[], preview: boolean }
 */
async function handleAutoTaskGenerate(req, res, spaceId, spaceDataDir) {
  const startMs = Date.now();

  // 1. Parse body
  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    if (err.message === 'PAYLOAD_TOO_LARGE') {
      return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 512 KB limit');
    }
    return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  if (body !== null && typeof body !== 'object') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
  }

  const rawBody  = body || {};
  const prompt   = rawBody.prompt != null ? String(rawBody.prompt).trim() : null;
  const column   = rawBody.column != null ? String(rawBody.column) : DEFAULT_COLUMN;
  const preview  = rawBody.preview === true;

  // 2. Validate prompt
  if (!prompt || prompt.length === 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', '"prompt" is required and must be a non-empty string');
  }

  if (prompt.length > 2000) {
    return sendError(res, 400, 'VALIDATION_ERROR', '"prompt" must be ≤ 2000 characters');
  }

  // 3. Validate column
  if (!VALID_COLUMNS.has(column)) {
    return sendError(res, 400, 'VALIDATION_ERROR',
      `Invalid column '${column}'. Must be one of: ${COLUMNS.join(', ')}`);
  }

  // 4. Concurrency guard
  if (runningSpaces.has(spaceId)) {
    return sendError(res, 409, 'AUTOTASK_RUNNING',
      `An auto-task run is already in progress for space '${spaceId}'`);
  }

  runningSpaces.add(spaceId);

  try {
    // 5. Call CLI
    let rawTasks;
    try {
      rawTasks = await callCLI(prompt);
    } catch (err) {
      const durationMs = Date.now() - startMs;
      console.error(JSON.stringify({
        event:     'autotask.generate.error',
        spaceId,
        errorCode: 'AUTOTASK_CLI_ERROR',
        message:   err.message,
        durationMs,
      }));
      return sendError(res, 502, 'AUTOTASK_CLI_ERROR', `AI CLI error: ${err.message}`);
    }

    // 6. Build full task objects
    const now = new Date().toISOString();
    const VALID_TYPES = new Set(['feature', 'bug', 'tech-debt', 'chore']);

    const tasks = rawTasks
      .filter((t) => t && typeof t.title === 'string' && t.title.trim().length > 0)
      .map((t) => ({
        id:          generateId(),
        title:       String(t.title).slice(0, 80).trim(),
        type:        VALID_TYPES.has(t.type) ? t.type : 'chore',
        description: t.description ? String(t.description).slice(0, 200).trim() : '',
        createdAt:   now,
        updatedAt:   now,
      }));

    if (tasks.length === 0) {
      return sendError(res, 502, 'AUTOTASK_CLI_ERROR', 'AI returned no valid tasks');
    }

    // 7. Persist only when not a preview
    if (!preview) {
      appendTasksToColumn(spaceDataDir, column, tasks);
    }

    const durationMs = Date.now() - startMs;
    console.log(JSON.stringify({
      event:        preview ? 'autotask.preview.complete' : 'autotask.generate.complete',
      spaceId,
      column,
      tasksCreated: tasks.length,
      preview,
      durationMs,
    }));

    return sendJSON(res, 200, { tasksCreated: tasks.length, tasks, preview });

  } finally {
    runningSpaces.delete(spaceId);
  }
}

/**
 * POST /api/v1/spaces/:spaceId/autotask/confirm
 *
 * Persists a user-reviewed subset of previously generated tasks.
 *
 * Request body:
 *   { tasks: Task[], column?: string }
 *
 * Response:
 *   { tasksCreated: number, tasks: Task[] }
 */
async function handleAutoTaskConfirm(req, res, spaceId, spaceDataDir) {
  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    if (err.message === 'PAYLOAD_TOO_LARGE') {
      return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 512 KB limit');
    }
    return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  if (!body || typeof body !== 'object') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
  }

  const tasks  = Array.isArray(body.tasks) ? body.tasks : null;
  const column = body.column != null ? String(body.column) : DEFAULT_COLUMN;

  if (!tasks || tasks.length === 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', '"tasks" must be a non-empty array');
  }

  if (!VALID_COLUMNS.has(column)) {
    return sendError(res, 400, 'VALIDATION_ERROR',
      `Invalid column '${column}'. Must be one of: ${COLUMNS.join(', ')}`);
  }

  // Re-validate each task to prevent arbitrary data injection
  const VALID_TYPES = new Set(['feature', 'bug', 'tech-debt', 'chore']);
  const now = new Date().toISOString();
  const sanitized = tasks
    .filter((t) => t && typeof t.title === 'string' && t.title.trim().length > 0)
    .map((t) => ({
      id:          t.id || generateId(),
      title:       String(t.title).slice(0, 80).trim(),
      type:        VALID_TYPES.has(t.type) ? t.type : 'chore',
      description: t.description ? String(t.description).slice(0, 200).trim() : '',
      createdAt:   t.createdAt || now,
      updatedAt:   now,
    }));

  if (sanitized.length === 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'No valid tasks to create');
  }

  appendTasksToColumn(spaceDataDir, column, sanitized);

  console.log(JSON.stringify({
    event:        'autotask.confirm.complete',
    spaceId,
    column,
    tasksCreated: sanitized.length,
  }));

  return sendJSON(res, 200, { tasksCreated: sanitized.length, tasks: sanitized });
}

module.exports = { handleAutoTaskGenerate, handleAutoTaskConfirm };
