'use strict';

/**
 * Claude Code stream-json adapter — Layer A
 *
 * Reads a stage log file emitted by `claude -p --output-format=stream-json`
 * (JSONL: one JSON object per line) and emits NormalizedEvent objects.
 *
 * Event type mapping:
 *   system            → session_start (first occurrence with subtype 'init')
 *   assistant         → tool_call (for tool_use content blocks)
 *   user              → tool_result (for tool_result content blocks)
 *   result            → final_result
 *   rate_limit_event  → rate_limit
 *   anything else     → unknown
 *
 * Tool call ↔ tool_result pairs are matched by tool_use_id. The adapter emits
 * them in document order; the aggregator pairs them by id.
 */

const readline = require('readline');
const fs       = require('fs');

const ADAPTER_NAME = 'claude-code';

/**
 * Detect whether this adapter can handle the given log.
 *
 * @param {string}      firstLine - First non-empty line from the log file.
 * @param {object|null} header    - Contents of stage-N.meta.json, or null.
 * @returns {boolean}
 */
function detect(firstLine, header) {
  if (header && header.source) {
    return header.source === ADAPTER_NAME;
  }
  try {
    const obj = JSON.parse(firstLine);
    const knownTypes = new Set(['system', 'assistant', 'user', 'result', 'rate_limit_event']);
    return obj && typeof obj === 'object' && knownTypes.has(obj.type);
  } catch {
    return false;
  }
}

/**
 * Parse the stream-json log and yield NormalizedEvent objects.
 *
 * @param {AsyncIterable<string>} stream - Line-by-line async iterable of the log file.
 * @returns {AsyncIterable<import('../types').NormalizedEvent>}
 */
async function* parse(stream) {
  let lineIndex = 0;

  for await (const line of stream) {
    const t = lineIndex++;
    const trimmed = line.trim();
    if (!trimmed) continue;

    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      yield { kind: 'unknown', t, raw: trimmed.slice(0, 200) };
      continue;
    }

    if (!obj || typeof obj !== 'object') {
      yield { kind: 'unknown', t, raw: trimmed.slice(0, 200) };
      continue;
    }

    const type = obj.type;

    if (type === 'system') {
      if (obj.subtype === 'init') {
        yield {
          kind:      'session_start',
          t,
          model:     obj.model ?? null,
          sessionId: obj.session_id ?? null,
        };
      }
      // Other system subtypes (hook_started, hook_response, etc.) are silently skipped —
      // they carry no metrics-relevant info.
      continue;
    }

    if (type === 'assistant') {
      const content = obj.message?.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (!block || typeof block !== 'object') continue;

        if (block.type === 'tool_use') {
          yield {
            kind:  'tool_call',
            t,
            id:    block.id    ?? `unknown-${t}`,
            name:  block.name  ?? 'unknown',
            input: block.input ?? null,
          };
        }
        // text blocks from assistant are not individually tracked — only
        // the final result.result summary is captured as the stage summary.
      }
      continue;
    }

    if (type === 'user') {
      const content = obj.message?.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (!block || typeof block !== 'object') continue;

        if (block.type === 'tool_result') {
          const contentArr = Array.isArray(block.content) ? block.content : [];
          const bytes = contentArr.reduce((acc, c) => {
            if (typeof c?.text === 'string') return acc + Buffer.byteLength(c.text, 'utf8');
            return acc;
          }, 0);

          yield {
            kind:    'tool_result',
            t,
            id:      block.tool_use_id ?? `unknown-${t}`,
            isError: block.is_error === true,
            bytes,
          };
        }
      }
      continue;
    }

    if (type === 'result') {
      const usage      = obj.usage      ?? {};
      const modelUsage = obj.modelUsage ?? {};

      // Normalise modelUsage: { modelName: { inputTokens, outputTokens, ... } }
      const perModel = Object.entries(modelUsage).map(([model, mu]) => ({
        model,
        inputTokens:              mu.inputTokens              ?? 0,
        outputTokens:             mu.outputTokens             ?? 0,
        cacheReadInputTokens:     mu.cacheReadInputTokens     ?? null,
        cacheCreationInputTokens: mu.cacheCreationInputTokens ?? null,
        costUsd:                  mu.costUSD                  ?? 0,
      }));

      yield {
        kind:               'final_result',
        t,
        durationMs:         obj.duration_ms      ?? null,
        durationApiMs:      obj.duration_api_ms  ?? null,
        numTurns:           obj.num_turns         ?? null,
        costUsd:            obj.total_cost_usd    ?? null,
        usage:              {
          inputTokens:  usage.input_tokens  ?? 0,
          outputTokens: usage.output_tokens ?? 0,
        },
        modelUsage:         perModel,
        stopReason:         obj.stop_reason       ?? null,
        terminalReason:     obj.terminal_reason   ?? null,
        permissionDenials:  Array.isArray(obj.permission_denials)
          ? obj.permission_denials.length
          : 0,
        summary:            typeof obj.result === 'string' ? obj.result : null,
      };
      continue;
    }

    if (type === 'rate_limit_event') {
      const info = obj.rate_limit_info ?? {};
      yield {
        kind:   'rate_limit',
        t,
        status: info.status       ?? 'unknown',
        type:   info.rateLimitType ?? 'unknown',
      };
      continue;
    }

    // Unknown top-level type — record but never throw.
    yield { kind: 'unknown', t, raw: trimmed.slice(0, 200) };
  }
}

/**
 * Create a line-by-line async iterable from a file path using readline.
 * Preferred over fs.readFileSync for large files (stream, not slurp).
 *
 * @param {string} filePath
 * @returns {AsyncIterable<string>}
 */
function createLineStream(filePath) {
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  return readline.createInterface({ input: fileStream, crlfDelay: Infinity });
}

module.exports = {
  name: ADAPTER_NAME,
  detect,
  parse,
  createLineStream,
};
