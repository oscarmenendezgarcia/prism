'use strict';

/**
 * Folio CRUD HTTP handlers (T-002: folio-index-ui)
 *
 * Six endpoints, all space-scoped, delegating through store.folio.binding:
 *
 *   GET    /folio                                  → FolioIndex
 *   GET    /folio/chapters/:chapterSlug/pages      → { pages: PageMeta[] }
 *   GET    /folio/pages/:chapterSlug/:pageSlug     → FolioPage
 *   POST   /folio/pages                            → 201 FolioPage (activation gesture)
 *   PUT    /folio/pages/:chapterSlug/:pageSlug     → 200 FolioPage
 *   DELETE /folio/pages/:chapterSlug/:pageSlug     → 204
 *
 * Slug grammar: [a-z0-9]+([-][a-z0-9]+)* — enforced client-side and validated
 * here via SLUG_SEGMENT_RE before touching any storage.
 *
 * Graceful degradation: a space with no folio bound always returns active:false /
 * empty arrays — never throws.
 */

const { sendJSON, sendError, parseBody } = require('../utils/http');
const { FolioConflictError }             = require('../services/folio/store');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Slug segment grammar: one or more lowercase-alphanum groups separated by hyphens. */
const SLUG_SEGMENT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Full page slug: "chapter/page" — exactly two segments. */
const FULL_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} segment
 * @returns {boolean}
 */
function isValidSlugSegment(segment) {
  return typeof segment === 'string' && SLUG_SEGMENT_RE.test(segment);
}

/**
 * Resolve the binding from the store, or null when not configured.
 *
 * @param {object} store
 * @returns {object | null}
 */
function getBinding(store) {
  return store?.folio?.binding ?? null;
}

// ---------------------------------------------------------------------------
// GET /folio — Folio index (chapters + page counts)
// ---------------------------------------------------------------------------

/**
 * Return a FolioIndex for the space.
 *
 *   active: true  → space has ≥1 chapter
 *   active: false → folio not yet activated (graceful empty state)
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {string} spaceId
 * @param {object} store
 */
function handleGetFolioIndex(req, res, spaceId, store) {
  const binding = getBinding(store);
  if (!binding) {
    return sendJSON(res, 200, { active: false, chapters: [] });
  }

  const chapters = binding.listChapters(spaceId);
  if (!chapters || chapters.length === 0) {
    return sendJSON(res, 200, { active: false, chapters: [] });
  }

  // Attach page count to each chapter.
  const chaptersWithCounts = chapters.map((chapter) => {
    const pages = binding.listPages(spaceId, chapter.slug);
    return {
      slug:      chapter.slug,
      title:     chapter.title,
      position:  chapter.position,
      pageCount: pages.length,
    };
  });

  console.log(`[folio.pages] op=getIndex spaceId=${spaceId} chapterCount=${chaptersWithCounts.length}`);
  return sendJSON(res, 200, { active: true, chapters: chaptersWithCounts });
}

// ---------------------------------------------------------------------------
// GET /folio/chapters/:chapterSlug/pages — list pages in a chapter
// ---------------------------------------------------------------------------

/**
 * Return lightweight page metadata for all pages in a chapter.
 * Returns { pages: [] } when the chapter is empty or no folio is bound.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {string} spaceId
 * @param {string} chapterSlug
 * @param {object} store
 */
function handleGetChapterPages(req, res, spaceId, chapterSlug, store) {
  if (!isValidSlugSegment(chapterSlug)) {
    return sendError(res, 400, 'INVALID_SLUG',
      `Invalid chapter slug "${chapterSlug}": must match [a-z0-9]+(-[a-z0-9]+)*`);
  }

  const binding = getBinding(store);
  if (!binding) {
    return sendJSON(res, 200, { pages: [] });
  }

  const pages = binding.listPages(spaceId, chapterSlug);
  const metas = pages.map((p) => ({
    id:          p.id,
    slug:        p.slug,
    chapterSlug: p.chapterSlug,
    title:       p.title,
    author:      p.author,
    createdAt:   p.createdAt,
    updatedAt:   p.updatedAt,
  }));

  console.log(`[folio.pages] op=getChapterPages spaceId=${spaceId} chapter=${chapterSlug} count=${metas.length}`);
  return sendJSON(res, 200, { pages: metas });
}

// ---------------------------------------------------------------------------
// GET /folio/pages/:chapterSlug/:pageSlug — get a single page
// ---------------------------------------------------------------------------

/**
 * Return the full FolioPage including content.
 * 404 when the page does not exist.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {string} spaceId
 * @param {string} chapterSlug
 * @param {string} pageSlug
 * @param {object} store
 */
function handleGetFolioPage(req, res, spaceId, chapterSlug, pageSlug, store) {
  if (!isValidSlugSegment(chapterSlug) || !isValidSlugSegment(pageSlug)) {
    return sendError(res, 400, 'INVALID_SLUG',
      `Invalid slug "${chapterSlug}/${pageSlug}": each segment must match [a-z0-9]+(-[a-z0-9]+)*`);
  }

  const binding = getBinding(store);
  if (!binding) {
    return sendError(res, 404, 'PAGE_NOT_FOUND',
      `Page "${chapterSlug}/${pageSlug}" not found`);
  }

  const page = binding.getPageBySlug(spaceId, chapterSlug, pageSlug);
  if (!page) {
    return sendError(res, 404, 'PAGE_NOT_FOUND',
      `Page "${chapterSlug}/${pageSlug}" not found`);
  }

  console.log(`[folio.pages] op=getPage spaceId=${spaceId} slug=${chapterSlug}/${pageSlug}`);
  return sendJSON(res, 200, {
    id:          page.id,
    slug:        page.slug,
    chapterSlug: page.chapterSlug,
    title:       page.title,
    content:     page.content,
    author:      page.author,
    pinned:      page.pinned,
    createdAt:   page.createdAt,
    updatedAt:   page.updatedAt,
  });
}

// ---------------------------------------------------------------------------
// POST /folio/pages — create a page (activation gesture)
// ---------------------------------------------------------------------------

/**
 * Create a new page.  This is the primary opt-in activation gesture:
 * if no folio is bound to the space, it materializes one and marks it active.
 *
 * Request body: { slug: "chapter/page", title?: string, content?: string }
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {string} spaceId
 * @param {object} store
 */
async function handleCreateFolioPage(req, res, spaceId, store) {
  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    return sendError(res, 400, 'INVALID_BODY', 'Request body must be valid JSON');
  }

  const slug    = body && typeof body.slug    === 'string' ? body.slug.trim()    : '';
  const title   = body && typeof body.title   === 'string' ? body.title.trim()   : undefined;
  const content = body && typeof body.content === 'string' ? body.content        : '';

  if (!slug || !FULL_SLUG_RE.test(slug)) {
    return sendError(res, 400, 'INVALID_SLUG',
      `Invalid slug "${slug}": must be "chapter/page" matching [a-z0-9]+(-[a-z0-9]+)*/[a-z0-9]+(-[a-z0-9]+)*`);
  }

  const binding = getBinding(store);
  if (!binding) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Folio service is not available');
  }

  let page;
  try {
    page = binding.createPage(spaceId, slug, content, {
      createIfMissing: true,
      author: 'user',
      ...(title !== undefined && { title }),
    });
  } catch (err) {
    if (err instanceof FolioConflictError || err.code === 'FOLIO_CONFLICT') {
      return sendError(res, 409, 'PAGE_EXISTS', `Page "${slug}" already exists`);
    }
    if (err instanceof TypeError && err.message.includes('slug')) {
      return sendError(res, 400, 'INVALID_SLUG', err.message);
    }
    console.error(`[folio.pages] op=createPage spaceId=${spaceId} slug=${slug} error=${err.message}`);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create page');
  }

  if (!page) {
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create page');
  }

  console.log(`[folio.pages] op=createPage spaceId=${spaceId} slug=${slug} author=user outcome=created`);
  return sendJSON(res, 201, {
    id:          page.id,
    slug:        page.slug,
    chapterSlug: page.chapterSlug,
    title:       page.title,
    content:     page.content,
    author:      page.author,
    pinned:      page.pinned,
    createdAt:   page.createdAt,
    updatedAt:   page.updatedAt,
  });
}

// ---------------------------------------------------------------------------
// PUT /folio/pages/:chapterSlug/:pageSlug — update a page
// ---------------------------------------------------------------------------

/**
 * Update a page's content, title, or pinned flag.
 * Author is preserved (not modified — core invariant).
 * 404 when the page does not exist.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {string} spaceId
 * @param {string} chapterSlug
 * @param {string} pageSlug
 * @param {object} store
 */
async function handleUpdateFolioPage(req, res, spaceId, chapterSlug, pageSlug, store) {
  if (!isValidSlugSegment(chapterSlug) || !isValidSlugSegment(pageSlug)) {
    return sendError(res, 400, 'INVALID_SLUG',
      `Invalid slug "${chapterSlug}/${pageSlug}": each segment must match [a-z0-9]+(-[a-z0-9]+)*`);
  }

  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    return sendError(res, 400, 'INVALID_BODY', 'Request body must be valid JSON');
  }

  if (!body || typeof body !== 'object') {
    return sendError(res, 400, 'INVALID_BODY', 'Request body must be a JSON object');
  }

  const updates = {};
  if (body.content !== undefined) {
    if (typeof body.content !== 'string') {
      return sendError(res, 400, 'INVALID_BODY', '"content" must be a string');
    }
    updates.content = body.content;
  }
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return sendError(res, 400, 'INVALID_BODY', '"title" must be a non-empty string');
    }
    updates.title = body.title.trim();
  }
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== 'boolean') {
      return sendError(res, 400, 'INVALID_BODY', '"pinned" must be a boolean');
    }
    updates.pinned = body.pinned;
  }

  if (Object.keys(updates).length === 0) {
    return sendError(res, 400, 'INVALID_BODY',
      'At least one of "content", "title", or "pinned" is required');
  }

  const binding = getBinding(store);
  if (!binding) {
    return sendError(res, 404, 'PAGE_NOT_FOUND',
      `Page "${chapterSlug}/${pageSlug}" not found`);
  }

  let page;
  try {
    page = binding.updatePage(spaceId, chapterSlug, pageSlug, updates);
  } catch (err) {
    console.error(`[folio.pages] op=updatePage spaceId=${spaceId} slug=${chapterSlug}/${pageSlug} error=${err.message}`);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to update page');
  }

  if (!page) {
    return sendError(res, 404, 'PAGE_NOT_FOUND',
      `Page "${chapterSlug}/${pageSlug}" not found`);
  }

  console.log(`[folio.pages] op=updatePage spaceId=${spaceId} slug=${chapterSlug}/${pageSlug} outcome=ok`);
  return sendJSON(res, 200, {
    id:          page.id,
    slug:        page.slug,
    chapterSlug: page.chapterSlug,
    title:       page.title,
    content:     page.content,
    author:      page.author,
    pinned:      page.pinned,
    createdAt:   page.createdAt,
    updatedAt:   page.updatedAt,
  });
}

// ---------------------------------------------------------------------------
// DELETE /folio/pages/:chapterSlug/:pageSlug — delete a page
// ---------------------------------------------------------------------------

/**
 * Delete a page.  Returns 204 No Content on success.
 * 404 when the page does not exist.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {string} spaceId
 * @param {string} chapterSlug
 * @param {string} pageSlug
 * @param {object} store
 */
function handleDeleteFolioPage(req, res, spaceId, chapterSlug, pageSlug, store) {
  if (!isValidSlugSegment(chapterSlug) || !isValidSlugSegment(pageSlug)) {
    return sendError(res, 400, 'INVALID_SLUG',
      `Invalid slug "${chapterSlug}/${pageSlug}": each segment must match [a-z0-9]+(-[a-z0-9]+)*`);
  }

  const binding = getBinding(store);
  if (!binding) {
    return sendError(res, 404, 'PAGE_NOT_FOUND',
      `Page "${chapterSlug}/${pageSlug}" not found`);
  }

  let deleted;
  try {
    deleted = binding.deletePage(spaceId, chapterSlug, pageSlug);
  } catch (err) {
    console.error(`[folio.pages] op=deletePage spaceId=${spaceId} slug=${chapterSlug}/${pageSlug} error=${err.message}`);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to delete page');
  }

  if (!deleted) {
    return sendError(res, 404, 'PAGE_NOT_FOUND',
      `Page "${chapterSlug}/${pageSlug}" not found`);
  }

  console.log(`[folio.pages] op=deletePage spaceId=${spaceId} slug=${chapterSlug}/${pageSlug} outcome=ok`);
  res.writeHead(204);
  res.end();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  handleGetFolioIndex,
  handleGetChapterPages,
  handleGetFolioPage,
  handleCreateFolioPage,
  handleUpdateFolioPage,
  handleDeleteFolioPage,
};
