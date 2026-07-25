'use strict';

/**
 * streamJsonNormalizer.js — Pure normalizer for pipeline stage logs.
 *
 * Pipeline stages produce logs in two formats:
 *
 *   • `stream-json` — one JSON object per line, emitted by Anthropic's
 *     `claude` CLI (`--output-format stream-json`). Contains `system.init`,
 *     `assistant` blocks (`thinking` / `text` / `tool_use`),
 *     `user.tool_result`, `rate_limit_event`, `result` (final summary), etc.
 *
 *   • `plain-text` — already-legible text (e.g. `opencode` CLI), possibly
 *     ANSI-colored.
 *
 * The normalizer detects the format from the first non-empty line and returns
 * a single readable text blob suitable for agent consumption. It is
 * intentionally lossy: `thinking` blocks and tool inputs/results are
 * truncated to keep payloads bounded.
 *
 * Contract:
 *   normalize(text, opts) → {
 *     format:    'stream-json' | 'plain-text',
 *     content:   string,        // normalized text (or raw when opts.raw)
 *     bytesIn:   number,        // input byte length
 *     linesOut:  number,        // \n-split lines in `content`
 *     truncated: boolean,       // set when the 256 KB cap or `tail` cut lines
 *   }
 *
 * Options:
 *   opts.tail?:     integer   → keep the last N `\n`-split lines of the
 *                               normalized text (applied AFTER assembly, so
 *                               it counts readable lines — not raw JSON
 *                               events).
 *   opts.raw?:      boolean   → skip normalization: return the input text
 *                               verbatim with the detected format.
 *   opts.maxBytes?: integer   → per-stage byte cap. Default 262144 (256 KB).
 *                               When the normalized content exceeds this,
 *                               the leading portion is dropped and a marker
 *                               line is prepended.
 */

const DEFAULT_MAX_BYTES = 262144; // 256 KB
const THINKING_TRUNCATE = 500;
const TOOL_ARGS_TRUNCATE = 200;
const TOOL_RESULT_TRUNCATE = 200;
const RESULT_FINAL_TRUNCATE = 500;

// Recognised stream-json event types. If a line's parsed `type` is in this
// set, we treat the whole file as stream-json.
const STREAM_JSON_TYPES = new Set([
  'system',
  'assistant',
  'user',
  'rate_limit_event',
  'tool_use',
  'tool_result',
  'result',
]);

const ANSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]/g;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalize a raw log blob.
 *
 * @param {string} text
 * @param {{ tail?: number, raw?: boolean, maxBytes?: number }} [opts]
 * @returns {{ format: string, content: string, bytesIn: number, linesOut: number, truncated: boolean }}
 */
function normalize(text, opts = {}) {
  const input     = typeof text === 'string' ? text : '';
  const bytesIn   = Buffer.byteLength(input, 'utf8');
  const maxBytes  = Number.isInteger(opts.maxBytes) && opts.maxBytes > 0
    ? opts.maxBytes
    : DEFAULT_MAX_BYTES;
  const format    = detectFormat(input);

  // Raw escape hatch: return input untouched but with the detected format.
  // Still apply the byte cap so consumers cannot be flooded by a 100 MB file.
  if (opts.raw) {
    const capped = applyByteCap(input, maxBytes);
    return {
      format,
      content:   capped.content,
      bytesIn,
      linesOut:  countLines(capped.content),
      truncated: capped.truncated,
    };
  }

  let normalized;
  if (format === 'stream-json') {
    normalized = normalizeStreamJson(input);
  } else {
    normalized = normalizePlainText(input);
  }

  let truncatedByTail = false;
  if (Number.isInteger(opts.tail) && opts.tail > 0) {
    const lines = normalized.split('\n');
    if (lines.length > opts.tail) {
      normalized = lines.slice(lines.length - opts.tail).join('\n');
      truncatedByTail = true;
    }
  }

  const capped = applyByteCap(normalized, maxBytes);

  return {
    format,
    content:   capped.content,
    bytesIn,
    linesOut:  countLines(capped.content),
    truncated: capped.truncated || truncatedByTail,
  };
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

function detectFormat(text) {
  // Find the first non-empty line.
  const nl = text.indexOf('\n');
  let firstLine;
  if (nl === -1) {
    firstLine = text.trim();
  } else {
    // Scan lines lazily; skip blanks.
    let idx = 0;
    while (idx < text.length) {
      const next = text.indexOf('\n', idx);
      const end  = next === -1 ? text.length : next;
      const line = text.slice(idx, end).trim();
      if (line.length > 0) {
        firstLine = line;
        break;
      }
      idx = end + 1;
    }
  }
  if (!firstLine) return 'plain-text';
  if (firstLine[0] !== '{') return 'plain-text';

  try {
    const obj = JSON.parse(firstLine);
    if (obj && typeof obj === 'object' && typeof obj.type === 'string' && STREAM_JSON_TYPES.has(obj.type)) {
      return 'stream-json';
    }
  } catch {
    // fall through
  }
  return 'plain-text';
}

// ---------------------------------------------------------------------------
// Plain-text branch
// ---------------------------------------------------------------------------

function normalizePlainText(text) {
  // Strip ANSI escape sequences and trim a trailing newline for tidiness.
  return text.replace(ANSI_REGEX, '').replace(/\n+$/, '');
}

// ---------------------------------------------------------------------------
// Stream-JSON branch
// ---------------------------------------------------------------------------

function normalizeStreamJson(text) {
  const out = [];
  const lines = text.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      out.push(`[?] ${rawLine}`);
      continue;
    }

    if (!evt || typeof evt !== 'object') {
      out.push(`[?] ${rawLine}`);
      continue;
    }

    const rendered = renderEvent(evt);
    if (rendered !== null) out.push(rendered);
  }
  return out.join('\n');
}

function renderEvent(evt) {
  switch (evt.type) {
    case 'system':
      return renderSystem(evt);
    case 'assistant':
      return renderAssistant(evt);
    case 'user':
      return renderUser(evt);
    case 'result':
      return renderResultFinal(evt);
    case 'rate_limit_event':
      return null; // skip
    default:
      return `[?${evt.type}]`;
  }
}

function renderSystem(evt) {
  if (evt.subtype !== 'init') return null; // skip non-init system events
  const session = typeof evt.session_id === 'string'
    ? evt.session_id.slice(0, 8)
    : '?';
  const model = typeof evt.model === 'string' ? evt.model : '?';
  return `[system] session=${session} model=${model}`;
}

function renderAssistant(evt) {
  const content = evt.message && Array.isArray(evt.message.content)
    ? evt.message.content
    : [];
  const lines = [];
  for (const block of content) {
    const rendered = renderAssistantBlock(block);
    if (rendered !== null) lines.push(rendered);
  }
  return lines.length ? lines.join('\n') : null;
}

function renderAssistantBlock(block) {
  if (!block || typeof block !== 'object') return null;
  switch (block.type) {
    case 'thinking': {
      const t = typeof block.thinking === 'string' ? block.thinking : '';
      return `[thinking] ${truncate(t, THINKING_TRUNCATE)}`;
    }
    case 'text': {
      return typeof block.text === 'string' ? block.text : '';
    }
    case 'tool_use': {
      const name = typeof block.name === 'string' ? block.name : '?';
      let args = '';
      try { args = JSON.stringify(block.input ?? {}); } catch { args = String(block.input); }
      return `[tool] ${name}(${truncate(args, TOOL_ARGS_TRUNCATE)})`;
    }
    default:
      return `[block:${block.type}]`;
  }
}

function renderUser(evt) {
  const content = evt.message && Array.isArray(evt.message.content)
    ? evt.message.content
    : [];
  const lines = [];
  for (const block of content) {
    const rendered = renderUserBlock(block);
    if (rendered !== null) lines.push(rendered);
  }
  return lines.length ? lines.join('\n') : null;
}

function renderUserBlock(block) {
  if (!block || typeof block !== 'object') return null;
  switch (block.type) {
    case 'tool_result': {
      const preview = extractToolResultPreview(block.content);
      return `[result] ${truncate(preview, TOOL_RESULT_TRUNCATE)}`;
    }
    case 'text': {
      return typeof block.text === 'string' ? block.text : '';
    }
    default:
      return `[block:${block.type}]`;
  }
}

function extractToolResultPreview(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const c of content) {
    if (!c || typeof c !== 'object') continue;
    if (c.type === 'text' && typeof c.text === 'string') parts.push(c.text);
  }
  return parts.join('\n');
}

function renderResultFinal(evt) {
  const text = typeof evt.result === 'string' ? evt.result : '';
  return `[result-final] ${truncate(text, RESULT_FINAL_TRUNCATE)}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(str, max) {
  const s = String(str ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… (truncated)`;
}

function applyByteCap(text, maxBytes) {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= maxBytes) return { content: text, truncated: false };

  // Drop leading bytes; UTF-8 safe fallback: slice by chars but shrink until
  // it fits. Simpler: convert to Buffer, slice, then convert back replacing
  // stray partial code points.
  const buf   = Buffer.from(text, 'utf8');
  const kept  = buf.slice(buf.length - maxBytes);
  const marker = `… (truncated: ${bytes - maxBytes} bytes removed) …\n`;
  return {
    content:   marker + kept.toString('utf8'),
    truncated: true,
  };
}

function countLines(text) {
  if (!text) return 0;
  // Count `\n` separators + 1 for the trailing segment.
  let n = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}

module.exports = {
  normalize,
  // exposed for tests
  _internal: {
    detectFormat,
    normalizePlainText,
    normalizeStreamJson,
    applyByteCap,
    truncate,
    DEFAULT_MAX_BYTES,
  },
};
