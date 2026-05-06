'use strict';

/**
 * Aggregator — Layer B
 *
 * Consumes NormalizedEvent[] (produced by an adapter) and builds a StageMetrics
 * document per the schema defined in blueprint §2.2.
 *
 * Ground-truth values (duration, turns, cost) come from the `final_result` event
 * when present. When absent (interrupted run), those fields are null and
 * parser.warnings records the omission.
 */

const PARSER_VERSION = '1.0.0';
const SCHEMA_VERSION = 1;

const SUMMARY_MAX_BYTES = 10 * 1024; // 10 KB cap

// Tools whose `input.file_path` or `input.path` indicate a file modification.
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// Tools whose `input.file_path` or `input.path` indicate a read.
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);

const FILES_MODIFIED_CAP = 500;
const FILES_READ_CAP     = 200;
const ERROR_SAMPLES_CAP  = 5;

/**
 * Extract a file path from a tool_use input, handling the various parameter
 * names used across Claude Code tools.
 *
 * @param {object|null} input
 * @returns {string|null}
 */
function extractFilePath(input) {
  if (!input || typeof input !== 'object') return null;
  return input.file_path ?? input.path ?? input.notebook_path ?? null;
}

/**
 * Cap a string at maxBytes (UTF-8). Returns the trimmed string or null if
 * the input is null/undefined.
 *
 * @param {string|null|undefined} text
 * @param {number} maxBytes
 * @returns {string|null}
 */
function capBytes(text, maxBytes) {
  if (text == null) return null;
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  return buf.slice(0, maxBytes).toString('utf8');
}

/**
 * Add a value to a Set-backed deduplicated array, respecting a cap.
 *
 * @param {Set<string>} seen
 * @param {string[]}    arr
 * @param {string}      value
 * @param {number}      cap
 */
function addDeduped(seen, arr, value, cap) {
  if (arr.length >= cap) return;
  if (seen.has(value)) return;
  seen.add(value);
  arr.push(value);
}

/**
 * Consume a NormalizedEvent async iterable and produce a StageMetrics object.
 *
 * @param {AsyncIterable<import('./types').NormalizedEvent>} events
 * @param {object} meta - Contextual metadata injected by parseStageLog.
 * @param {string}  meta.runId
 * @param {number}  meta.stageIndex
 * @param {string}  meta.source       - Adapter name.
 * @param {string}  meta.agentId
 * @param {string|null} meta.startedAt - ISO timestamp from meta.json, if available.
 * @returns {Promise<import('./types').StageMetrics>}
 */
async function aggregate(events, meta) {
  const { runId, stageIndex, source, agentId, startedAt } = meta;

  // --- Accumulators ---
  let model        = null;
  let sessionId    = null;
  let lineCount    = 0;
  let unknownCount = 0;
  let rateLimits   = 0;

  // tool_call map: id → { name, t }
  const toolCalls    = new Map();
  // tool stats: name → { calls, errors }
  const toolStats    = new Map();

  const filesModifiedSet = new Set();
  const filesReadSet     = new Set();
  const filesModified    = [];
  const filesRead        = [];

  const errorSamples  = [];
  let   permDenials   = 0;

  /** @type {import('./types').NormalizedEvent|null} */
  let finalResult = null;

  const warnings = [];

  for await (const ev of events) {
    lineCount++;

    switch (ev.kind) {
      case 'session_start':
        if (ev.model && !model) model = ev.model;
        if (ev.sessionId && !sessionId) sessionId = ev.sessionId;
        break;

      case 'tool_call': {
        toolCalls.set(ev.id, { name: ev.name, t: ev.t, input: ev.input });

        if (!toolStats.has(ev.name)) {
          toolStats.set(ev.name, { calls: 0, errors: 0 });
        }
        toolStats.get(ev.name).calls++;

        // Track file reads/writes from tool input.
        const filePath = extractFilePath(ev.input);
        if (filePath && typeof filePath === 'string') {
          if (WRITE_TOOLS.has(ev.name)) {
            addDeduped(filesModifiedSet, filesModified, filePath, FILES_MODIFIED_CAP);
          } else if (READ_TOOLS.has(ev.name)) {
            addDeduped(filesReadSet, filesRead, filePath, FILES_READ_CAP);
          }
        }
        break;
      }

      case 'tool_result': {
        const call = toolCalls.get(ev.id);
        if (ev.isError && call) {
          toolStats.get(call.name).errors++;

          if (errorSamples.length < ERROR_SAMPLES_CAP) {
            const contentText = ev.bytes > 0 ? `(${ev.bytes} bytes)` : '';
            errorSamples.push({
              tool:    call.name,
              message: `Tool call failed${contentText ? ' — output: ' + contentText : ''}`,
              preview: null,
            });
          }
        }
        break;
      }

      case 'rate_limit':
        rateLimits++;
        break;

      case 'final_result':
        finalResult    = ev;
        permDenials    = ev.permissionDenials ?? 0;
        break;

      case 'unknown':
        unknownCount++;
        break;

      default:
        unknownCount++;
    }
  }

  // --- Validate ---
  if (!finalResult) {
    warnings.push('No final_result event found — run may have been interrupted; duration/cost/turns are null.');
  }

  // --- Build duration ---
  let wallMs   = finalResult?.durationMs   ?? null;
  let apiMs    = finalResult?.durationApiMs ?? null;
  let endedAt  = null;

  if (wallMs !== null && startedAt) {
    endedAt = new Date(new Date(startedAt).getTime() + wallMs).toISOString();
  }

  const duration = {
    wallMs:    wallMs,
    apiMs:     apiMs,
    startedAt: startedAt ?? null,
    endedAt:   endedAt,
  };

  // --- Build cost ---
  let cost = null;
  if (finalResult && finalResult.costUsd !== null) {
    cost = {
      totalUsd: finalResult.costUsd,
      perModel: finalResult.modelUsage ?? [],
    };
  }

  // --- Build tools ---
  const totalErrors = Array.from(toolStats.values()).reduce((s, v) => s + v.errors, 0);
  const byName = Array.from(toolStats.entries())
    .map(([name, st]) => ({ name, calls: st.calls, errors: st.errors }))
    .sort((a, b) => b.calls - a.calls);

  const tools = {
    totalCalls: Array.from(toolStats.values()).reduce((s, v) => s + v.calls, 0),
    errors:     totalErrors,
    byName,
  };

  // --- Build errors ---
  const errors = {
    rateLimitEvents:  rateLimits,
    permissionDenials: permDenials,
    toolErrors:       totalErrors,
    samples:          errorSamples,
  };

  // --- Summary ---
  const summary = finalResult?.summary
    ? capBytes(finalResult.summary, SUMMARY_MAX_BYTES)
    : null;

  // --- Assemble ---
  /** @type {import('./types').StageMetrics} */
  const metrics = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    stageIndex,
    source,
    agentId,
    model,
    duration,
    turns:          finalResult?.numTurns    ?? null,
    stopReason:     finalResult?.stopReason  ?? null,
    terminalReason: finalResult?.terminalReason ?? null,
    cost,
    tools,
    files: { modified: filesModified, read: filesRead },
    errors,
    summary,
    parser: {
      parsedAt:      new Date().toISOString(),
      parserVersion: PARSER_VERSION,
      lineCount,
      unknownEvents: unknownCount,
      warnings,
    },
  };

  return metrics;
}

module.exports = { aggregate };
