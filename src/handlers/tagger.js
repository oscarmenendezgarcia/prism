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
 *   TAGGER_MODEL — Model override (default: 'haiku').
 *
 * Error codes:
 *   404 SPACE_NOT_FOUND         — spaceId does not exist
 *   400 VALIDATION_ERROR        — invalid column or malformed body
 *   409 TAGGER_ALREADY_RUNNING  — concurrent run for same spaceId
 *   502 TAGGER_CLI_ERROR        — CLI spawn failed, non-zero exit, or invalid JSON response
 */

const { sendJSON, sendError, parseBody } = require('../utils/http');
const { COLUMNS }                        = require('../constants');
const { readSettings }                   = require('./settings');

// ---------------------------------------------------------------------------
// Format-only system prompt — defines output schema, NOT classification rules.
// Classification behavior is driven by the user-provided prompt at runtime.
// ---------------------------------------------------------------------------

const FORMAT_SYSTEM_PROMPT = `Respond ONLY with a JSON object matching this exact schema — no prose, no markdown fences:
{
  "suggestions": [
    {
      "id": "<string>",
      "inferredType": "feature" | "bug" | "tech-debt" | "chore",
      "confidence": "high" | "medium" | "low",
      "description": "<string, only present when improve_descriptions=true>"
    }
  ],
  "skipped": ["<id>", ...]
}
Rules:
- Include ALL cards in either suggestions or skipped — do not silently drop any.
- Set confidence to "high" if obvious, "medium" if ambiguous, "low" if guessing.
- If you cannot classify a card, add its id to "skipped".
- Be deterministic — same input always produces same output.`;

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
 * Read all tasks for a given space (one or all columns) via the Store.
 *
 * @param {import('../services/store').Store} store
 * @param {string} spaceId
 * @param {string|null} column  - Column filter or null to read all columns.
 * @returns {{ id: string, title: string, description?: string, type: string, _col: string }[]}
 */
function readSpaceTasks(store, spaceId, column) {
  const columns = column ? [column] : COLUMNS;
  const tasks   = [];

  for (const col of columns) {
    for (const task of store.getTasksByColumn(spaceId, col)) {
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
 * @param {string} userPrompt - Classification instructions from the user
 * @param {string} cli        - CLI binary resolved from settings
 * @param {string} model      - Model override
 * @returns {Promise<{ suggestions: object[], skipped: string[], model: string, usage: object }>}
 * @throws {Error} on spawn failure, non-zero exit, or invalid JSON response
 */
function callClaude(cards, improveDescriptions, userPrompt, cli, model) {

  const cardsJson = JSON.stringify(
    cards.map(({ id, title, description }) => ({ id, title, description })),
    null, 2
  );

  const improveNote = improveDescriptions
    ? '\n\nAlso rewrite each description to be clear, specific, and actionable in ≤ 2 sentences (set improve_descriptions=true in response).'
    : '';

  const userMessage = `${userPrompt}${improveNote}\n\nCards to classify:\n${cardsJson}`;

  return new Promise((resolve, reject) => {
    // Lazy require so child_process can be mocked in tests before server loads.
    //
    // Flags (verified against `claude --help`):
    //   --print                    headless/pipe mode; user message comes from stdin
    //   --system-prompt <text>     classification instructions
    //   --model <model>            model selection
    //   --dangerously-skip-permissions  skip confirmation prompts in server context
    //   --no-session-persistence   don't save this call to Claude's session history
    //                              (keeps the tagger prompt isolated from other sessions)
    // Output format defaults to "text" — no --output-format or --verbose needed.
    const child = require('child_process').spawn(
      cli,
      ['--print',
        '--system-prompt', FORMAT_SYSTEM_PROMPT,
        '--model', model,
        '--dangerously-skip-permissions',
        '--no-session-persistence'],
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
 * @param {import('../services/store').Store} store
 * @param {string}                         dataDir      - root data dir (for reading settings)
 */
async function handleTaggerRun(req, res, spaceId, store, dataDir) {
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

  const rawBody             = body || {};
  const improveDescriptions = coerceBoolean(rawBody.improveDescriptions);
  const column              = rawBody.column != null ? String(rawBody.column) : null;
  const userPrompt          = rawBody.prompt != null
    ? String(rawBody.prompt).trim()
    : 'Classify each task as exactly one of: feature, bug, tech-debt, or chore.\n- feature: new capability or user-facing functionality\n- bug: defect, error, or unexpected behaviour\n- tech-debt: refactor, upgrade, or code quality improvement\n- chore: operational task, dependency update, docs, config';

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

  // 5. Resolve CLI binary and model from settings (TAGGER_CLI env var overrides settings for compat)
  const settings = readSettings(dataDir);
  const cli      = process.env.TAGGER_CLI || settings.cli.binary || settings.cli.tool || 'claude';
  const model    = process.env.TAGGER_MODEL || 'haiku';

  try {
    // 6. Read tasks via store
    const allTasks = readSpaceTasks(store, spaceId, column);

    // 7. Handle empty board
    if (allTasks.length === 0) {
      const durationMs = Date.now() - startMs;
      console.log(JSON.stringify({
        event:               'tagger.run.complete',
        spaceId,
        model,
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
        model,
        inputTokens:  0,
        outputTokens: 0,
      });
    }

    // 8. Call AI CLI
    let claudeResult;
    try {
      claudeResult = await callClaude(allTasks, improveDescriptions, userPrompt, cli, model);
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
