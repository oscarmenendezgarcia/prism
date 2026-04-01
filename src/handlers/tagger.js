'use strict';

/**
 * Tagger handler — POST /api/v1/spaces/:spaceId/tagger/run
 *
 * ADR-1 (Tagger Agent): backend-triggered AI classification via configurable CLI
 * (default: `claude`). No API key required — uses the CLI's own auth.
 * Returns classification suggestions for user review before any mutation.
 *
 * Config env vars:
 *   TAGGER_CLI   — CLI binary to use (default: 'claude'). Any tool supporting
 *                  `<cmd> -p <systemPrompt>` with cards JSON on stdin works.
 *                  Examples: 'claude', 'opencode', 'aider'.
 *   TAGGER_MODEL — Model override (default: 'claude-3-5-sonnet-20241022').
 *
 * Error codes:
 *   404 SPACE_NOT_FOUND         — spaceId does not exist
 *   400 VALIDATION_ERROR        — invalid column or malformed body
 *   409 TAGGER_ALREADY_RUNNING  — concurrent run for same spaceId
 *   502 TAGGER_CLI_ERROR        — CLI spawn failed, non-zero exit, or invalid JSON response
 */

const fs   = require('fs');
const path = require('path');

const { sendJSON, sendError, parseBody } = require('../utils/http');
const { COLUMNS }                        = require('../constants');

// ---------------------------------------------------------------------------
// System prompt (loaded once at module init)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '../prompts/tagger-system.txt'),
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

/**
 * Coerce a value to boolean. Accepts true/false, "true"/"false".
 * Returns false if value is undefined/null.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function coerceBoolean(value) {
  if (value === true || value === 'true') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Disk helpers
// ---------------------------------------------------------------------------

/**
 * Read all tasks for a given space directory (one or all columns).
 *
 * @param {string} spaceDataDir - Absolute path to the space's data directory.
 * @param {string|null} column  - Column filter or null to read all columns.
 * @returns {{ id: string, title: string, description?: string, type: string, _col: string }[]}
 */
function readSpaceTasks(spaceDataDir, column) {
  const columns = column ? [column] : COLUMNS;
  const tasks   = [];

  for (const col of columns) {
    const filePath = path.join(spaceDataDir, `${col}.json`);
    if (!fs.existsSync(filePath)) continue;

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      console.warn(`[tagger] Failed to parse ${filePath} — skipping column`);
      continue;
    }

    if (!Array.isArray(parsed)) continue;

    for (const task of parsed) {
      tasks.push({
        id:          task.id,
        title:       task.title,
        description: task.description || '',
        type:        task.type,
        _col:        col,
      });
    }
  }

  return tasks;
}

// ---------------------------------------------------------------------------
// Claude API call
// ---------------------------------------------------------------------------

/**
 * Call the configured AI CLI and return parsed suggestion payload.
 *
 * Uses `TAGGER_CLI` (default: 'claude') with:
 *   -p <systemPrompt>   — classification instructions
 *   --model <model>     — model selection
 *   stdin               — cards JSON ({ improveDescriptions, cards: [...] })
 *
 * @param {Array<{ id: string, title: string, description: string }>} cards
 * @param {boolean} improveDescriptions
 * @returns {Promise<{ suggestions: object[], skipped: string[], model: string, usage: object }>}
 * @throws {Error} on spawn failure, non-zero exit, or invalid JSON response
 */
function callClaude(cards, improveDescriptions) {
  const cli   = process.env.TAGGER_CLI   || 'claude';
  const model = process.env.TAGGER_MODEL || 'claude-3-5-sonnet-20241022';

  const userMessage = JSON.stringify({
    improveDescriptions,
    cards: cards.map(({ id, title, description }) => ({ id, title, description })),
  });

  return new Promise((resolve, reject) => {
    // Lazy require so child_process can be mocked in tests before server loads.
    //
    // Correct claude CLI flags (verified against `claude --help`):
    //   --print (-p)                  headless/pipe mode — user message comes from stdin
    //   --system-prompt <text>        sets the system prompt
    //   --output-format stream-json   non-interactive streaming JSON output
    //   --dangerously-skip-permissions skip confirmation prompts (needed for server context)
    //   --model <model>               model selection
    const child = require('child_process').spawn(
      cli,
      ['--print',
        '--system-prompt', SYSTEM_PROMPT,
        '--model', model,
        '--output-format', 'stream-json',
        '--dangerously-skip-permissions'],
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

      // stream-json emits one JSON object per line. Extract the assistant's text
      // by concatenating all text_delta events, then parse our JSON payload from it.
      let text = '';
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            text += event.delta.text;
          }
        } catch { /* ignore non-JSON lines (e.g. verbose headers) */ }
      }

      // Fall back to raw stdout if no stream-json deltas found (e.g. opencode -p plain output).
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

      if (!parsed || !Array.isArray(parsed.suggestions) || !Array.isArray(parsed.skipped)) {
        reject(new Error(`CLI response missing required fields: ${stdout.slice(0, 200)}`));
        return;
      }

      resolve({
        suggestions: parsed.suggestions,
        skipped:     parsed.skipped,
        model,
        // Token counts not available from CLI — set to 0.
        usage: { input_tokens: 0, output_tokens: 0 },
      });
    });

    child.stdin.write(userMessage);
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/spaces/:spaceId/tagger/run
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {string}                         spaceId
 * @param {string}                         spaceDataDir - absolute path to space data dir
 */
async function handleTaggerRun(req, res, spaceId, spaceDataDir) {
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

  const rawBody            = body || {};
  const improveDescriptions = coerceBoolean(rawBody.improveDescriptions);
  const column             = rawBody.column != null ? String(rawBody.column) : null;

  // 3. Validate column filter
  if (column !== null && !VALID_COLUMNS.has(column)) {
    return sendError(res, 400, 'VALIDATION_ERROR',
      `Invalid column '${column}'. Must be one of: ${COLUMNS.join(', ')}`);
  }

  // 4. Concurrency guard
  if (runningSpaces.has(spaceId)) {
    return sendError(res, 409, 'TAGGER_ALREADY_RUNNING',
      `A tagger run is already in progress for space '${spaceId}'`);
  }

  runningSpaces.add(spaceId);

  try {
    // 5. Read tasks from disk
    const allTasks = readSpaceTasks(spaceDataDir, column);

    // 6. Handle empty board
    if (allTasks.length === 0) {
      const durationMs = Date.now() - startMs;
      console.log(JSON.stringify({
        event:               'tagger.run.complete',
        spaceId,
        model:               process.env.TAGGER_MODEL || 'claude-3-5-sonnet-20241022',
        cardsProcessed:      0,
        suggestionsCount:    0,
        skippedCount:        0,
        inputTokens:         0,
        outputTokens:        0,
        durationMs,
        improveDescriptions,
      }));
      return sendJSON(res, 200, {
        suggestions:  [],
        skipped:      [],
        model:        process.env.TAGGER_MODEL || 'claude-3-5-sonnet-20241022',
        inputTokens:  0,
        outputTokens: 0,
      });
    }

    // 7. Call Claude
    let claudeResult;
    try {
      claudeResult = await callClaude(allTasks, improveDescriptions);
    } catch (err) {
      const durationMs = Date.now() - startMs;
      console.error(JSON.stringify({
        event:      'tagger.run.error',
        spaceId,
        errorCode:  'TAGGER_CLI_ERROR',
        message:    err.message,
        durationMs,
      }));
      return sendError(res, 502, 'TAGGER_CLI_ERROR',
        `Claude API error: ${err.message}`);
    }

    // 8. Build response — include full suggestion objects with currentType merged in
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));

    const enrichedSuggestions = claudeResult.suggestions
      .filter((s) => s && typeof s.id === 'string')
      .map((s) => {
        const original = taskMap.get(s.id);
        return {
          id:           s.id,
          title:        original ? original.title : s.id,
          currentType:  original ? original.type  : 'unknown',
          inferredType: s.inferredType,
          confidence:   s.confidence,
          ...(improveDescriptions && s.description !== undefined
            ? { description: s.description }
            : {}),
        };
      });

    const durationMs = Date.now() - startMs;

    console.log(JSON.stringify({
      event:               'tagger.run.complete',
      spaceId,
      model:               claudeResult.model,
      cardsProcessed:      allTasks.length,
      suggestionsCount:    enrichedSuggestions.length,
      skippedCount:        claudeResult.skipped.length,
      inputTokens:         claudeResult.usage.input_tokens,
      outputTokens:        claudeResult.usage.output_tokens,
      durationMs,
      improveDescriptions,
    }));

    return sendJSON(res, 200, {
      suggestions:  enrichedSuggestions,
      skipped:      claudeResult.skipped,
      model:        claudeResult.model,
      inputTokens:  claudeResult.usage.input_tokens,
      outputTokens: claudeResult.usage.output_tokens,
    });

  } finally {
    runningSpaces.delete(spaceId);
  }
}

module.exports = { handleTaggerRun };
