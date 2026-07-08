'use strict';

/**
 * events.js — Projects NormalizedEvents (from adapters) to PublicEvent DTOs.
 *
 * Blueprint §2.1: public contract for GET /runs/:runId/stages/:stageIndex/events
 *
 * Rules:
 *   - Each emitted event is assigned a monotonic `idx` (0-based counter).
 *   - Unknown / skipped NormalizedEvent kinds are silently dropped.
 *   - String fields are truncated to their spec caps before emission.
 *   - tool_result durationMs is NOT computed here (client-side from timestamps).
 *
 * Caps:
 *   - inputPreview (tool_call): ≤ 200 bytes
 *   - preview (assistant_text): ≤ 1 000 bytes
 *   - message + preview (error): ≤ 500 bytes each
 */

const INPUT_PREVIEW_CAP   = 200;
const ASSISTANT_PREVIEW_CAP = 1_000;
const ERROR_PREVIEW_CAP   = 500;
const SUMMARY_CAP         = 4_000;
const MAX_EVENTS_PER_PAGE = 1_000;

/**
 * Truncate a string to at most maxBytes UTF-8 bytes.
 *
 * @param {string|null|undefined} text
 * @param {number} maxBytes
 * @returns {string}
 */
function capBytes(text, maxBytes) {
  if (!text) return '';
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  return buf.slice(0, maxBytes).toString('utf8');
}

/**
 * Convert a tool call's input object to a short preview string.
 *
 * @param {object|null} input - The raw tool input object.
 * @returns {string}
 */
function inputToPreview(input) {
  if (!input) return '';
  try {
    return capBytes(JSON.stringify(input), INPUT_PREVIEW_CAP);
  } catch {
    return '';
  }
}

/**
 * Collect PublicEvent DTOs from a NormalizedEvent async iterable.
 *
 * Monotonic `idx` is assigned starting from 0 for the full log.
 * Filtered by `since` before returning (events with idx < since are counted
 * but not emitted, so `nextSince` always reflects the real end of the log).
 *
 * @param {AsyncIterable<import('./types').NormalizedEvent>} normalizedEvents
 * @param {object} opts
 * @param {number}  [opts.since=0]  - Skip events with idx < since.
 * @param {boolean} [opts.livePlainSummary=false] - True when the source is
 *   the plain-text adapter, whose single final_result event always reports
 *   idx 0 and is re-derived (with fresher content) on every parse of a log
 *   that may still be growing — unlike Claude Code's final_result, a true
 *   one-time terminal event read from a JSON line that never changes once
 *   written. Only in this case is that event exempt from the `since` cursor.
 * @returns {Promise<{ events: object[]; nextSince: number; complete: boolean }>}
 */
async function projectEvents(normalizedEvents, { since = 0, livePlainSummary = false } = {}) {
  const result = [];
  let idx = 0;
  let complete = true;
  let cappedAt = -1;

  for await (const ev of normalizedEvents) {
    const currentIdx = idx++;

    // Always skip unknown events.
    if (!ev || ev.kind === 'unknown') continue;

    // Derive time as seconds since start (t is line index → convert to relative seconds).
    // The adapter sets `t` to lineIndex; we expose it as-is for relative ordering.
    // The UI can treat it as an opaque monotonic counter.
    const t = typeof ev.t === 'number' ? ev.t : 0;

    // Project each NormalizedEvent kind to a PublicEvent DTO.
    /** @type {object|null} */
    let pub = null;

    switch (ev.kind) {
      case 'session_start':
        pub = {
          idx:   currentIdx,
          kind:  'session_start',
          t,
          model: ev.model ?? undefined,
        };
        break;

      case 'tool_call':
        pub = {
          idx:          currentIdx,
          kind:         'tool_call',
          t,
          id:           ev.id,
          name:         ev.name ?? 'unknown',
          inputPreview: inputToPreview(ev.input),
        };
        break;

      case 'tool_result':
        pub = {
          idx:     currentIdx,
          kind:    'tool_result',
          t,
          id:      ev.id,
          isError: ev.isError === true,
          bytes:   typeof ev.bytes === 'number' ? ev.bytes : 0,
          // durationMs computed client-side (tool_call.t and tool_result.t are both line indices)
        };
        break;

      case 'assistant_text':
        pub = {
          idx:     currentIdx,
          kind:    'assistant_text',
          t,
          bytes:   typeof ev.bytes === 'number' ? ev.bytes : 0,
          preview: capBytes(ev.preview ?? '', ASSISTANT_PREVIEW_CAP),
        };
        break;

      case 'error':
        pub = {
          idx:     currentIdx,
          kind:    'error',
          t,
          tool:    ev.tool ?? undefined,
          message: capBytes(ev.message ?? '', ERROR_PREVIEW_CAP),
          preview: ev.preview ? capBytes(ev.preview, ERROR_PREVIEW_CAP) : undefined,
        };
        break;

      case 'rate_limit':
        pub = {
          idx:    currentIdx,
          kind:   'rate_limit',
          t,
          status: String(ev.status ?? 'unknown'),
        };
        break;

      case 'final_result':
        pub = {
          idx:        currentIdx,
          kind:       'final_result',
          t,
          durationMs: typeof ev.durationMs === 'number' ? ev.durationMs : 0,
          numTurns:   typeof ev.numTurns === 'number' ? ev.numTurns : 0,
          costUsd:    typeof ev.costUsd === 'number' ? ev.costUsd : 0,
          stopReason: String(ev.stopReason ?? 'unknown'),
          ...(ev.summary ? { summary: capBytes(ev.summary, SUMMARY_CAP) } : {}),
        };
        break;

      default:
        // Drop silently.
        break;
    }

    if (!pub) continue;

    // Skip events before the cursor — except the plain-text adapter's
    // final_result (see livePlainSummary docs above): always include it so
    // the frontend's idx-keyed merge (appendStageEvents) overwrites the same
    // entry with fresh content on every poll instead of freezing at the
    // first fetch. Every other case (including Claude Code's own
    // final_result) stays gated exactly as before.
    const isMutatingSummary = livePlainSummary && pub.kind === 'final_result';
    if (!isMutatingSummary && currentIdx < since) continue;

    // Cap response at MAX_EVENTS_PER_PAGE.
    if (result.length >= MAX_EVENTS_PER_PAGE) {
      complete = false;
      cappedAt = currentIdx;
      // Continue consuming the iterator so idx advances (we need nextSince = total count).
      // But to avoid reading the whole file when deeply paginated, break here.
      // nextSince = cappedAt (the first event we did NOT include).
      break;
    }

    result.push(pub);
  }

  // Drain remaining events to get accurate nextSince when capped.
  // We already broke out of the loop when capped, so nextSince = cappedAt.
  const nextSince = complete ? idx : cappedAt;

  return { events: result, nextSince, complete };
}

module.exports = { projectEvents, MAX_EVENTS_PER_PAGE };
