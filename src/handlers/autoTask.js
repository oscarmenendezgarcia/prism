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
const os   = require('os');

const { sendJSON, sendError, parseBody } = require('../utils/http');
const { COLUMNS }                        = require('../constants');
const { validatePipelineField }          = require('./tasks');
const { readSettings }                   = require('./settings');

// ---------------------------------------------------------------------------
// System prompt (loaded once at module init)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT_TEMPLATE = fs.readFileSync(
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
// Agent ID soft-validation helper (T-006)
//
// Reads the agents directory and returns the set of known agent IDs.
// Falls back to an empty Set when the directory is missing (no-op strip).
// ---------------------------------------------------------------------------

/**
 * Return the set of known agent IDs by scanning agent directories in order:
 *   1. <workingDirectory>/.claude/agents/  (space-level, if workingDirectory is set)
 *   2. PIPELINE_AGENTS_DIR or ~/.claude/agents/  (global)
 *
 * Each file named <agentId>.md contributes agentId to the set.
 *
 * @param {string} [workingDirectory]  — space's working directory (optional)
 * @returns {Set<string>}
 */
function resolveKnownAgentIds(workingDirectory) {
  const globalRaw = process.env.PIPELINE_AGENTS_DIR;
  const globalDir = globalRaw
    ? (globalRaw.startsWith('~') ? globalRaw.replace('~', os.homedir()) : globalRaw)
    : path.join(os.homedir(), '.claude', 'agents');

  const dirs = [];
  if (workingDirectory) {
    dirs.push(path.join(workingDirectory, '.claude', 'agents'));
  }
  dirs.push(globalDir);

  const known = new Set();
  for (const dir of dirs) {
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry.endsWith('.md')) {
          known.add(entry.slice(0, -3));
        }
      }
    } catch { /* directory missing — skip */ }
  }
  return known;
}

// ---------------------------------------------------------------------------
// AI call
// ---------------------------------------------------------------------------

/**
 * Build the system prompt with known agent IDs injected.
 *
 * @param {Set<string>} knownAgents
 * @returns {string}
 */
function buildSystemPrompt(knownAgents) {
  const ids = knownAgents.size > 0
    ? [...knownAgents].sort().join(', ')
    : 'senior-architect, ux-api-designer, developer-agent, code-reviewer, qa-engineer-e2e';
  return SYSTEM_PROMPT_TEMPLATE.replace('{{KNOWN_AGENT_IDS}}', ids);
}

/**
 * Call the configured AI CLI with the user's prompt and return parsed tasks.
 *
 * @param {string} prompt       — user's natural-language description
 * @param {string} systemPrompt — fully resolved system prompt
 * @returns {Promise<Array<{ title: string, type: string, description: string }>>}
 * @throws {Error} on spawn failure, non-zero exit, or invalid JSON response
 */
function callCLI(prompt, systemPrompt, cli, model) {

  return new Promise((resolve, reject) => {
    const child = require('child_process').spawn(
      cli,
      [
        '--print',
        '--system-prompt', systemPrompt,
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
async function handleAutoTaskGenerate(req, res, spaceId, spaceDataDir, workingDirectory, dataDir) {
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

  // 5. Resolve CLI binary and model from settings (TAGGER_CLI env var overrides for compat)
  const settings = readSettings(dataDir);
  const cli      = process.env.TAGGER_CLI || settings.cli.binary || settings.cli.tool || 'claude';
  const model    = process.env.TAGGER_MODEL || 'haiku';

  try {
    // 6. Call CLI (inject known agent IDs into system prompt)
    const knownAgents  = resolveKnownAgentIds(workingDirectory);
    const systemPrompt = buildSystemPrompt(knownAgents);
    let rawTasks;
    try {
      rawTasks = await callCLI(prompt, systemPrompt, cli, model);
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

    // 6. Build full task objects (T-006: include optional pipeline field)
    const now          = new Date().toISOString();
    const VALID_TYPES  = new Set(['feature', 'bug', 'tech-debt', 'chore']);

    const tasks = rawTasks
      .filter((t) => t && typeof t.title === 'string' && t.title.trim().length > 0)
      .map((t) => {
        const taskId = generateId();
        const base = {
          id:          taskId,
          title:       String(t.title).slice(0, 80).trim(),
          type:        VALID_TYPES.has(t.type) ? t.type : 'chore',
          description: t.description ? String(t.description).slice(0, 200).trim() : '',
          createdAt:   now,
          updatedAt:   now,
        };

        // T-006: soft-validate and store pipeline when present
        if (t.pipeline !== undefined) {
          const pipelineResult = validatePipelineField(t.pipeline);
          if (!pipelineResult.valid) {
            console.warn(JSON.stringify({
              event: 'autotask.pipeline_field_stripped',
              taskId, reason: pipelineResult.error,
            }));
          } else if (pipelineResult.data !== undefined) {
            // Strip elements whose agent file does not exist on disk
            const filtered = knownAgents.size > 0
              ? pipelineResult.data.filter((id) => knownAgents.has(id))
              : pipelineResult.data;

            if (filtered.length < pipelineResult.data.length) {
              console.warn(JSON.stringify({
                event: 'autotask.pipeline_unknown_agents_stripped',
                taskId,
                original: pipelineResult.data,
                retained: filtered,
              }));
            }

            if (filtered.length > 0) {
              base.pipeline = filtered;
              process.stderr.write(JSON.stringify({
                event: 'autotask.pipeline_field_set',
                taskId, stages: filtered,
              }) + '\n');
            }
          }
        }

        return base;
      });

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
    .map((t) => {
      const base = {
        id:          t.id || generateId(),
        title:       String(t.title).slice(0, 80).trim(),
        type:        VALID_TYPES.has(t.type) ? t.type : 'chore',
        description: t.description ? String(t.description).slice(0, 200).trim() : '',
        createdAt:   t.createdAt || now,
        updatedAt:   now,
      };
      // T-006: preserve pipeline field if present and valid on confirmed tasks
      if (t.pipeline !== undefined) {
        const pipelineResult = validatePipelineField(t.pipeline);
        if (pipelineResult.valid && pipelineResult.data !== undefined) {
          base.pipeline = pipelineResult.data;
        }
      }
      return base;
    });

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
