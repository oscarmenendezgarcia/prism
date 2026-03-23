/**
 * activityStore.js — JSONL-based Activity Event Persistence
 *
 * ADR-1 (Activity Feed) §Trade-off 2: JSONL flat-file persistence, day-partitioned,
 * append-only writes, 30-day automatic retention.
 *
 * Storage layout:
 *   data/activity/
 *     2026-03-23.jsonl   ← one file per UTC day, one JSON object per line
 *     2026-03-22.jsonl
 *     ...
 *
 * Write pattern: fs.appendFileSync — atomic for writes < PIPE_BUF (4096 bytes on macOS/Linux).
 * Query pattern: read relevant day files newest-first, parse line-by-line, skip malformed lines.
 * Cursor: base64-encoded JSON { date: "YYYY-MM-DD", offset: N } (0-based line offset from start).
 *
 * Usage:
 *   const store = createActivityStore('/absolute/path/to/data/activity');
 *   store.append(event);
 *   const { events, nextCursor } = store.query({ type: 'task.moved', limit: 50 });
 *   store.cleanup();
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of events returned per query. Hard ceiling. */
const MAX_QUERY_LIMIT = 200;

/** Default events per query when caller omits limit. */
const DEFAULT_LIMIT = 50;

/** Number of days to retain JSONL files. Files older than this are deleted. */
const RETENTION_DAYS = 30;

/** Valid activity event type strings. */
const VALID_EVENT_TYPES = new Set([
  'task.created',
  'task.moved',
  'task.updated',
  'task.deleted',
  'space.created',
  'space.renamed',
  'space.deleted',
  'board.cleared',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a Date as a YYYY-MM-DD string in UTC.
 * @param {Date} date
 * @returns {string}
 */
function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Parse a base64-encoded cursor string.
 * Returns null if the cursor is missing, malformed, or refers to a future date.
 *
 * @param {string|undefined} cursorStr
 * @returns {{ date: string, offset: number } | null}
 */
function decodeCursor(cursorStr) {
  if (!cursorStr) return null;
  try {
    const json   = Buffer.from(cursorStr, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (
      typeof parsed.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ||
      typeof parsed.offset !== 'number' ||
      !Number.isInteger(parsed.offset) ||
      parsed.offset < 0
    ) {
      return null;
    }
    return { date: parsed.date, offset: parsed.offset };
  } catch {
    return null;
  }
}

/**
 * Encode a cursor object as a base64 string.
 * @param {{ date: string, offset: number }} cursor
 * @returns {string}
 */
function encodeCursor(cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64');
}

/**
 * Return an array of YYYY-MM-DD date strings (UTC) spanning the inclusive range
 * [fromDate, toDate], sorted newest-first.
 *
 * @param {Date} fromDate
 * @param {Date} toDate
 * @returns {string[]}
 */
function dateRange(fromDate, toDate) {
  const dates = [];
  const cursor = new Date(toDate);
  cursor.setUTCHours(0, 0, 0, 0);
  const start = new Date(fromDate);
  start.setUTCHours(0, 0, 0, 0);

  while (cursor >= start) {
    dates.push(toDateString(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an ActivityStore instance bound to the given directory.
 *
 * @param {string} activityDir - Absolute path to the data/activity/ directory.
 * @returns {{
 *   append: (event: object) => void,
 *   query: (params: object) => { events: object[], nextCursor: string|null },
 *   cleanup: () => void
 * }}
 */
function createActivityStore(activityDir) {
  // Ensure the directory exists on construction.
  if (!fs.existsSync(activityDir)) {
    fs.mkdirSync(activityDir, { recursive: true });
  }

  // -------------------------------------------------------------------------
  // append(event)
  // -------------------------------------------------------------------------

  /**
   * Append a single activity event to today's JSONL file.
   * Creates the day file if it does not exist.
   *
   * Fire-and-forget from the caller's perspective — throws on disk errors so
   * callers (ActivityLogger) can catch and log without crashing.
   *
   * @param {object} event - A fully constructed ActivityEvent object.
   */
  function append(event) {
    const dayFile = path.join(activityDir, `${toDateString(new Date())}.jsonl`);
    const line    = JSON.stringify(event) + '\n';
    fs.appendFileSync(dayFile, line, 'utf8');
  }

  // -------------------------------------------------------------------------
  // query(params)
  // -------------------------------------------------------------------------

  /**
   * Query historical activity events.
   *
   * Events are returned newest-first (descending timestamp order).
   * Reads only day files that overlap with the requested date range.
   * Malformed JSONL lines are skipped with a warning, never thrown.
   *
   * @param {object} params
   * @param {string} [params.spaceId]  - Filter to a specific spaceId. Omit for all spaces.
   * @param {string} [params.type]     - Filter to a specific event type.
   * @param {Date}   [params.from]     - Start of date range (inclusive). Default: 30 days ago.
   * @param {Date}   [params.to]       - End of date range (inclusive). Default: now.
   * @param {number} [params.limit]    - Max events to return. Default: 50, max: 200.
   * @param {string} [params.cursor]   - Opaque pagination cursor from a previous response.
   * @returns {{ events: object[], nextCursor: string|null }}
   */
  function query({
    spaceId,
    type,
    from,
    to,
    limit   = DEFAULT_LIMIT,
    cursor: cursorStr,
  } = {}) {
    const clampedLimit = Math.min(Math.max(1, limit), MAX_QUERY_LIMIT);

    const now         = new Date();
    const thirtyAgo   = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const fromDate    = from instanceof Date ? from : thirtyAgo;
    const toDate      = to   instanceof Date ? to   : now;

    // Decode cursor — tells us which day file + line offset to resume from.
    const cursor = decodeCursor(cursorStr);

    // Build list of day strings in the range, newest-first.
    const days = dateRange(fromDate, toDate);

    const events        = [];
    let   nextCursor    = null;
    let   resumeDay     = cursor ? cursor.date   : null;
    let   resumeOffset  = cursor ? cursor.offset : 0;
    let   inResume      = cursor !== null;

    outerLoop:
    for (const day of days) {
      // Skip days before the cursor's day (cursor = resume from that day).
      if (inResume) {
        if (day > resumeDay) continue; // days are newest-first, so > means older in list order but newer in time
        inResume = false;
      }

      const dayFile = path.join(activityDir, `${day}.jsonl`);
      if (!fs.existsSync(dayFile)) continue;

      // Read all lines in the day file.
      let rawLines;
      try {
        rawLines = fs.readFileSync(dayFile, 'utf8').split('\n').filter((l) => l.length > 0);
      } catch (err) {
        console.warn(JSON.stringify({
          timestamp: new Date().toISOString(),
          level:     'warn',
          component: 'activity-store',
          event:     'day_file_read_error',
          day,
          error:     err.message,
        }));
        continue;
      }

      // Parse lines, newest-first (reverse the array).
      const lines = [...rawLines].reverse();

      // Determine starting line index for this day (cursor support).
      // cursor.offset is a 0-based index from the END of the file (newest = 0).
      const startIdx = (cursor && day === cursor.date) ? cursor.offset : 0;

      for (let i = startIdx; i < lines.length; i++) {
        let parsed;
        try {
          parsed = JSON.parse(lines[i]);
        } catch {
          console.warn(JSON.stringify({
            timestamp: new Date().toISOString(),
            level:     'warn',
            component: 'activity-store',
            event:     'malformed_jsonl_line',
            day,
            lineIndex: i,
          }));
          continue;
        }

        // Apply timestamp range filter.
        if (parsed.timestamp) {
          const ts = new Date(parsed.timestamp);
          if (ts < fromDate || ts > toDate) continue;
        }

        // Apply spaceId filter.
        if (spaceId && parsed.spaceId !== spaceId) continue;

        // Apply event type filter.
        if (type && parsed.type !== type) continue;

        events.push(parsed);

        if (events.length >= clampedLimit) {
          // Compute next cursor: same day, next line index.
          const nextIdx = i + 1;
          if (nextIdx < lines.length) {
            nextCursor = encodeCursor({ date: day, offset: nextIdx });
          } else {
            // Move to the next day (older day in the list — days are newest-first).
            const nextDayIdx = days.indexOf(day) + 1;
            if (nextDayIdx < days.length) {
              nextCursor = encodeCursor({ date: days[nextDayIdx], offset: 0 });
            }
          }
          break outerLoop;
        }
      }
    }

    return { events, nextCursor };
  }

  // -------------------------------------------------------------------------
  // cleanup()
  // -------------------------------------------------------------------------

  /**
   * Delete JSONL files older than RETENTION_DAYS from the activity directory.
   * Best-effort: individual file errors are logged but do not abort cleanup.
   *
   * @returns {number} Number of files deleted.
   */
  function cleanup() {
    let entries;
    try {
      entries = fs.readdirSync(activityDir);
    } catch (err) {
      console.warn(JSON.stringify({
        timestamp: new Date().toISOString(),
        level:     'warn',
        component: 'activity-store',
        event:     'retention_cleanup_read_error',
        error:     err.message,
      }));
      return 0;
    }

    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
    const cutoffStr = toDateString(cutoff);

    let deleted = 0;
    for (const filename of entries) {
      if (!filename.endsWith('.jsonl')) continue;
      const dateStr = filename.slice(0, -6); // strip ".jsonl"
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
      if (dateStr < cutoffStr) {
        const filePath = path.join(activityDir, filename);
        try {
          fs.unlinkSync(filePath);
          deleted++;
        } catch (err) {
          console.warn(JSON.stringify({
            timestamp: new Date().toISOString(),
            level:     'warn',
            component: 'activity-store',
            event:     'retention_cleanup_delete_error',
            filename,
            error:     err.message,
          }));
        }
      }
    }

    if (deleted > 0) {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level:     'info',
        component: 'activity-store',
        event:     'retention_cleanup',
        filesDeleted: deleted,
      }));
    }

    return deleted;
  }

  return { append, query, cleanup };
}

module.exports = { createActivityStore, VALID_EVENT_TYPES };
