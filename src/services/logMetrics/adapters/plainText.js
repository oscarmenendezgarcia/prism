'use strict';

/**
 * Plain-text fallback adapter — Layer A
 *
 * Used when the log is not Claude Code stream-json (e.g. future opencode,
 * manual runs, or any other tool that writes unstructured text).
 *
 * Emits:
 *   - One final_result event with best-effort metrics extracted from plain text.
 *
 * Extracts:
 *   - Line count
 *   - ANSI-stripped last 4 KB as summary
 *   - Basic error detection via regex
 */

const ADAPTER_NAME = 'plain';

// ANSI escape sequence pattern (covers color codes, cursor movement, etc.)
const ANSI_ESCAPE_RE = /\[[0-9;]*[mGKHFABCDJsu]|\][^]*|[^[]/g;

// Common error markers found in CLI output.
const ERROR_MARKER_RE = /\b(error|exception|failed|fatal|traceback|panic)\b/i;

/**
 * Strip ANSI escape sequences from a string.
 *
 * @param {string} text
 * @returns {string}
 */
function stripAnsi(text) {
  return text.replace(ANSI_ESCAPE_RE, '');
}

/**
 * Detect whether this adapter should handle the given log.
 * Plain-text is the fallback — it always returns true when called.
 *
 * @returns {boolean}
 */
function detect(_firstLine, _header) {
  return true;
}

/**
 * Parse a plain-text log line-by-line and emit a single final_result event.
 *
 * @param {AsyncIterable<string>} stream - Line-by-line async iterable.
 * @returns {AsyncIterable<import('../types').NormalizedEvent>}
 */
async function* parse(stream) {
  let lineIndex = 0;
  let lineCount = 0;
  let hasError  = false;

  // Keep a rolling buffer of the last 4 KB (approx) of stripped lines.
  const SUMMARY_BYTES = 4096;
  const summaryLines  = [];
  let   summarySize   = 0;

  for await (const line of stream) {
    const t = lineIndex++;
    lineCount++;

    const stripped = stripAnsi(line);

    if (!hasError && ERROR_MARKER_RE.test(stripped)) {
      hasError = true;
    }

    // Maintain rolling window for summary.
    const lineBytes = Buffer.byteLength(stripped + '\n', 'utf8');
    summaryLines.push(stripped);
    summarySize += lineBytes;

    while (summarySize > SUMMARY_BYTES && summaryLines.length > 1) {
      const removed = summaryLines.shift();
      summarySize -= Buffer.byteLength(removed + '\n', 'utf8');
    }
  }

  const summary = summaryLines.join('\n');

  yield {
    kind:              'final_result',
    t:                 lineCount,
    durationMs:        null,
    durationApiMs:     null,
    numTurns:          null,
    costUsd:           null,
    usage:             { inputTokens: 0, outputTokens: 0 },
    modelUsage:        [],
    stopReason:        null,
    terminalReason:    hasError ? 'error_detected' : null,
    permissionDenials: 0,
    summary,
  };
}

module.exports = {
  name: ADAPTER_NAME,
  detect,
  parse,
  stripAnsi,
};
