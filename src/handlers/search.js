'use strict';

/**
 * Search handler — GET /api/v1/tasks/search
 *
 * Cross-space search. Two modes:
 *   1. UUID lookup — if q matches a UUID pattern, does a direct ID lookup (O(1)).
 *      FTS5 cannot index UUIDs (tokeniser strips hyphens/hex runs), so a text
 *      search on a UUID would always return 0 results.
 *   2. FTS5 full-text search — for all other queries, uses the tasks_fts index
 *      with BM25 relevance ranking.
 *
 * Query parameters:
 *   q     {string}  required  — Search query (1–200 chars, trimmed).
 *   limit {integer} optional  — Max results to return (1–50, default 20).
 *                               Ignored for UUID lookups (result is 0 or 1).
 *
 * Response shape (200):
 *   { query, count, results: [{ task, spaceId, spaceName, column }] }
 *
 * Error codes:
 *   400 INVALID_QUERY — missing/empty q, or q.length > 200 after trim
 *   400 INVALID_LIMIT — non-numeric or out-of-range limit
 *   405 METHOD_NOT_ALLOWED — handled by router before reaching handler
 */

const { sendJSON, sendError } = require('../utils/http');

const MAX_QUERY_LENGTH = 200;
const DEFAULT_LIMIT    = 20;
const MAX_LIMIT        = 50;
const MIN_LIMIT        = 1;

// UUID v4 canonical form: 8-4-4-4-12 hex digits separated by hyphens.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/v1/tasks/search?q=<text>&limit=<n>
 *
 * @param {import('http').IncomingMessage}       req
 * @param {import('http').ServerResponse}        res
 * @param {import('../services/store').Store}    store
 * @param {object}                               spaceManager
 */
function handleSearchTasks(req, res, store, spaceManager) {
  const startMs = Date.now();

  // 1. Parse query parameters from the URL.
  const url    = new URL(req.url, 'http://localhost');
  const rawQ   = url.searchParams.get('q');
  const rawLim = url.searchParams.get('limit');

  // 2. Validate q.
  const trimmedQ = rawQ ? rawQ.trim() : '';
  if (!trimmedQ) {
    return sendError(res, 400, 'INVALID_QUERY', 'Search query is required.', {
      suggestion: 'Enter at least one character to search (1–200 characters).',
    });
  }
  if (trimmedQ.length > MAX_QUERY_LENGTH) {
    return sendError(res, 400, 'INVALID_QUERY', 'Search query is too long.', {
      suggestion: 'Keep your search to 200 characters or fewer.',
    });
  }

  // 3. Validate limit.
  let limit = DEFAULT_LIMIT;
  if (rawLim !== null) {
    const parsed = Number(rawLim);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      return sendError(res, 400, 'INVALID_LIMIT', 'Result limit must be a number.', {
        suggestion: 'Use a numeric value between 1 and 50.',
      });
    }
    if (parsed < MIN_LIMIT || parsed > MAX_LIMIT) {
      return sendError(res, 400, 'INVALID_LIMIT', 'Result limit is out of range.', {
        suggestion: 'Use a value between 1 and 50. Defaults to 20 if omitted.',
      });
    }
    limit = parsed;
  }

  // 4a. UUID shortcut: if q is a full UUID, skip FTS5 and do a direct ID lookup.
  //     FTS5 tokenises on word boundaries and does not index hyphenated hex runs,
  //     so a UUID query against the FTS index always returns 0 results.
  if (UUID_PATTERN.test(trimmedQ)) {
    const found = store.getTaskById(trimmedQ);
    const results = [];
    if (found) {
      const space = spaceManager.getSpace(found.spaceId);
      if (space && space.space) {
        results.push({
          task:      found.task,
          spaceId:   found.spaceId,
          spaceName: space.space.name,
          column:    found.column,
        });
      }
    }
    const elapsedMs = Date.now() - startMs;
    console.log(`[search] uuid-lookup q="${trimmedQ}" results=${results.length} elapsed_ms=${elapsedMs}`);
    return sendJSON(res, 200, { query: trimmedQ, count: results.length, results });
  }

  // 4b. Execute cross-space FTS5 search.
  const rawResults = store.searchAllTasks(trimmedQ, { limit });

  // 5. Enrich each result with the space name (defensive — skip if space not found).
  const results = [];
  for (const { task, spaceId, column } of rawResults) {
    const space = spaceManager.getSpace(spaceId);
    if (!space || !space.space) {
      // Defensive: task's space was deleted (should not happen due to FK CASCADE).
      console.warn(`[search] skipping orphaned task ${task.id} — space ${spaceId} not found`);
      continue;
    }
    results.push({
      task,
      spaceId,
      spaceName: space.space.name,
      column,
    });
  }

  const elapsedMs = Date.now() - startMs;
  console.log(`[search] q="${trimmedQ}" limit=${limit} results=${results.length} elapsed_ms=${elapsedMs}`);

  return sendJSON(res, 200, {
    query:   trimmedQ,
    count:   results.length,
    results,
  });
}

module.exports = { handleSearchTasks };
