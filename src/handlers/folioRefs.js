'use strict';

/**
 * Folio reference autocomplete handlers.
 *
 * Both endpoints are read-only and space-scoped. They serve autocomplete data
 * for the two levels of the [[ reference UI:
 *
 *   Level 1 — page search:
 *     GET /api/v1/spaces/:spaceId/folio/refs/search?q=<partial>&limit=<n>
 *
 *   Level 2 — section list:
 *     GET /api/v1/spaces/:spaceId/folio/refs/sections?slug=<chapter/page>
 *
 * Graceful degradation: when no folio is bound to the space both endpoints
 * return 200 with an empty array — they never throw.
 */

const { sendJSON, sendError } = require('../utils/http');

// ---------------------------------------------------------------------------
// handleFolioSearchRefs
// ---------------------------------------------------------------------------

/**
 * Search pages within the space's folio for the autocomplete level-1 dropdown.
 *
 * Query params:
 *   q     — partial text (FTS); empty → return up to `limit` pages by recency
 *   limit — max results (default 20, capped at 100)
 *
 * Response 200:
 *   { refs: [{ slug, title, chapterSlug, pageSlug, score }] }
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {string} spaceId
 * @param {object} store
 */
function handleFolioSearchRefs(req, res, spaceId, store) {
  const url   = new URL(req.url, 'http://x');
  const q     = url.searchParams.get('q') || '';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 100);

  const binding = store?.folio?.binding;
  if (!binding) {
    return sendJSON(res, 200, { refs: [] });
  }

  let refs;

  if (q.trim()) {
    // FTS search — returns [{ page, score }]
    const results = binding.searchPages(spaceId, q.trim(), { limit });
    refs = results.map(({ page, score }) => ({
      slug:        `${page.chapterSlug}/${page.slug}`,
      title:       page.title || page.slug,
      chapterSlug: page.chapterSlug,
      pageSlug:    page.slug,
      score,
    }));
  } else {
    // Empty query — return most-recently created pages, capped by limit
    const pages = binding.listPages(spaceId).slice(0, limit);
    refs = pages.map((page) => ({
      slug:        `${page.chapterSlug}/${page.slug}`,
      title:       page.title || page.slug,
      chapterSlug: page.chapterSlug,
      pageSlug:    page.slug,
      score:       0,
    }));
  }

  return sendJSON(res, 200, { refs });
}

// ---------------------------------------------------------------------------
// handleFolioSections
// ---------------------------------------------------------------------------

// Strict slug grammar: "chapter/page" — two non-empty path segments, no hash.
const VALID_SLUG_RE = /^[^/]+\/[^/]+$/;

/**
 * Return the H2 sections of a specific page for the autocomplete level-2 dropdown.
 *
 * Query params:
 *   slug — required, format "chapter/page"; any other format → 400 INVALID_SLUG
 *
 * Response 200:
 *   { sections: [{ title, slug }] }
 *   Empty array when the page does not exist or no folio is bound.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {string} spaceId
 * @param {object} store
 */
function handleFolioSections(req, res, spaceId, store) {
  const url  = new URL(req.url, 'http://x');
  const slug = url.searchParams.get('slug') || '';

  if (!slug || !VALID_SLUG_RE.test(slug)) {
    return sendError(
      res, 400, 'INVALID_SLUG',
      `Invalid slug format: expected "chapter/page", got "${slug}"`,
    );
  }

  const [chapterSlug, pageSlug] = slug.split('/');

  const binding = store?.folio?.binding;
  if (!binding) {
    return sendJSON(res, 200, { sections: [] });
  }

  const sections = binding.listPageSections(spaceId, chapterSlug, pageSlug);
  return sendJSON(res, 200, { sections });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { handleFolioSearchRefs, handleFolioSections };
