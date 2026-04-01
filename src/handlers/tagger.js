'use strict';

/**
 * Tagger handler — POST /api/v1/spaces/:spaceId/tagger/run
 *
 * ADR-1 (Tagger Agent): backend-triggered Claude API call via @anthropic-ai/sdk.
 * Returns classification suggestions for user review before any mutation.
 *
 * Error codes:
 *   503 ANTHROPIC_KEY_MISSING   — ANTHROPIC_API_KEY env var not set
 *   404 SPACE_NOT_FOUND         — spaceId does not exist
 *   400 VALIDATION_ERROR        — invalid column or malformed body
 *   409 TAGGER_ALREADY_RUNNING  — concurrent run for same spaceId
 *   502 ANTHROPIC_API_ERROR     — upstream Claude API error or invalid JSON response
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
 * Call the Anthropic messages API and return parsed suggestion payload.
 *
 * @param {Array<{ id: string, title: string, description: string }>} cards
 * @param {boolean} improveDescriptions
 * @returns {Promise<{ suggestions: object[], skipped: string[], usage: object }>}
 * @throws {Error} on API error or invalid JSON response
 */
async function callClaude(cards, improveDescriptions) {
  // Lazy-require so the import is deferred until the first real call.
  // This avoids crashing the server if ANTHROPIC_API_KEY is absent at startup.
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic.default();

  const userMessage = JSON.stringify({
    improveDescriptions,
    cards: cards.map(({ id, title, description }) => ({ id, title, description })),
  });

  const model = process.env.TAGGER_MODEL || 'claude-3-5-sonnet-20241022';

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const rawText = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Claude returned non-JSON response: ${rawText.slice(0, 200)}`);
  }

  if (!parsed || !Array.isArray(parsed.suggestions) || !Array.isArray(parsed.skipped)) {
    throw new Error(`Claude response missing required fields: ${rawText.slice(0, 200)}`);
  }

  return {
    suggestions: parsed.suggestions,
    skipped:     parsed.skipped,
    model,
    usage:       response.usage,
  };
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

  // 1. Check API key presence first (fast-fail before any disk I/O)
  if (!process.env.ANTHROPIC_API_KEY) {
    return sendError(res, 503, 'ANTHROPIC_KEY_MISSING',
      'ANTHROPIC_API_KEY environment variable is not set. The tagger feature is unavailable.');
  }

  // 2. Parse body
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
        errorCode:  'ANTHROPIC_API_ERROR',
        message:    err.message,
        durationMs,
      }));
      return sendError(res, 502, 'ANTHROPIC_API_ERROR',
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
