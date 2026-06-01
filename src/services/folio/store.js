'use strict';

/**
 * Folio — Core Store
 *
 * Space-agnostic CRUD keyed on folio_id. Every method takes an explicit
 * folioId; the Prism-side binding translates between the two domains.
 * This module is kept fully space-agnostic so it can be extracted as-is.
 *
 * Invariants:
 *  - All public methods are keyed on folioId — no binding-layer identifiers.
 *  - No import outside src/services/folio/.
 *  - Chapters emerge from the page slug — clients never create chapters directly.
 *  - pages.folio_id and pages.chapter_slug always match the parent chapter (set
 *    at insert inside a transaction; never updated in v1).
 *  - FTS index is kept in sync by DDL triggers — no manual index writes here.
 *
 * Usage:
 *   const { createFolioStore } = require('./folio/store');
 *   const store = createFolioStore(db);
 */

const crypto = require('crypto');
const { sanitizeFtsQuery } = require('./fts');

// ---------------------------------------------------------------------------
// Slug validation
// ---------------------------------------------------------------------------

/**
 * Slug segment grammar: [a-z0-9]+(-[a-z0-9]+)*
 * Full page slug: "chapter/page" — exactly one forward slash.
 */
const SLUG_SEGMENT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_CONTENT_BYTES = 1 * 1024 * 1024; // 1 MB soft cap

/**
 * Validate a single slug segment (chapter or page).
 * @param {string} segment
 * @returns {boolean}
 */
function isValidSlugSegment(segment) {
  return typeof segment === 'string' && SLUG_SEGMENT_RE.test(segment);
}

/**
 * Parse a full "chapter/page" slug into its two segments.
 * Throws TypeError on invalid input.
 *
 * @param {string} slug
 * @returns {{ chapterSlug: string, pageSlug: string }}
 */
function parseSlug(slug) {
  if (typeof slug !== 'string') {
    throw new TypeError('Slug must be a string');
  }
  const parts = slug.split('/');
  if (parts.length !== 2) {
    throw new TypeError(
      `Invalid slug "${slug}": must be "chapter/page" with exactly one "/"`,
    );
  }
  const [chapterSlug, pageSlug] = parts;
  if (!isValidSlugSegment(chapterSlug)) {
    throw new TypeError(
      `Invalid chapter slug "${chapterSlug}": must match [a-z0-9]+(-[a-z0-9]+)*`,
    );
  }
  if (!isValidSlugSegment(pageSlug)) {
    throw new TypeError(
      `Invalid page slug "${pageSlug}": must match [a-z0-9]+(-[a-z0-9]+)*`,
    );
  }
  return { chapterSlug, pageSlug };
}

// ---------------------------------------------------------------------------
// titleCase helper
// ---------------------------------------------------------------------------

/**
 * Convert a kebab-case slug segment to Title Case.
 * "redis-timeout" → "Redis Timeout"
 *
 * @param {string} slug
 * @returns {string}
 */
function titleCase(slug) {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------

class FolioConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FolioConflictError';
    this.code = 'FOLIO_CONFLICT';
  }
}

// ---------------------------------------------------------------------------
// Row mappers (DB columns → camelCase entity shapes)
// ---------------------------------------------------------------------------

function rowToFolio(row) {
  if (!row) return null;
  return {
    id:        row.id,
    name:      row.name,
    createdAt: row.created_at,
  };
}

function rowToChapter(row) {
  if (!row) return null;
  return {
    id:        row.id,
    folioId:   row.folio_id,
    title:     row.title,
    slug:      row.slug,
    position:  row.position,
    createdAt: row.created_at,
  };
}

function rowToPage(row) {
  if (!row) return null;
  return {
    id:          row.id,
    chapterId:   row.chapter_id,
    folioId:     row.folio_id,
    chapterSlug: row.chapter_slug,
    title:       row.title,
    slug:        row.slug,
    content:     row.content,
    author:      row.author,
    pinned:      row.pinned === 1,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

function rowToAttachment(row, includeData = false) {
  if (!row) return null;
  const att = {
    id:        row.id,
    pageId:    row.page_id,
    name:      row.name,
    mimeType:  row.mime_type,
    createdAt: row.created_at,
  };
  if (includeData) {
    att.data = row.data;
  }
  return att;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Folio core store bound to an already-open better-sqlite3 Database.
 * The caller is responsible for calling applySchema(db) first.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {FolioStore}
 */
function createFolioStore(db) {

  // ── Prepared statements ───────────────────────────────────────────────────

  const stmts = {
    // folios
    insertFolio: db.prepare(
      'INSERT INTO folios (id, name, created_at) VALUES (?, ?, ?)',
    ),
    getFolio:    db.prepare('SELECT * FROM folios WHERE id = ?'),
    listFolios:  db.prepare('SELECT id, name, created_at FROM folios ORDER BY created_at ASC'),
    // deleteFolio cascade: attachments → pages → chapters → folios
    // FTS rows are removed by the existing page_delete trigger in applySchema
    deleteAttachmentsByFolio: db.prepare(
      `DELETE FROM attachments
        WHERE page_id IN (SELECT id FROM pages WHERE folio_id = ?)`,
    ),
    deletePagesByFolio:    db.prepare('DELETE FROM pages    WHERE folio_id = ?'),
    deleteChaptersByFolio: db.prepare('DELETE FROM chapters WHERE folio_id = ?'),
    deleteFolioById:       db.prepare('DELETE FROM folios   WHERE id = ?'),

    // chapters
    getChapterByFolioAndSlug: db.prepare(
      'SELECT * FROM chapters WHERE folio_id = ? AND slug = ?',
    ),
    getMaxChapterPosition: db.prepare(
      'SELECT COALESCE(MAX(position), -1) AS max_pos FROM chapters WHERE folio_id = ?',
    ),
    insertChapter: db.prepare(
      'INSERT INTO chapters (id, folio_id, title, slug, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    listChapters: db.prepare(
      'SELECT * FROM chapters WHERE folio_id = ? ORDER BY position ASC',
    ),

    // pages
    insertPage: db.prepare(
      `INSERT INTO pages
         (id, chapter_id, folio_id, chapter_slug, title, slug, content, author, pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    getPage: db.prepare(
      'SELECT * FROM pages WHERE folio_id = ? AND id = ?',
    ),
    getPageBySlug: db.prepare(
      'SELECT * FROM pages WHERE folio_id = ? AND chapter_slug = ? AND slug = ?',
    ),
    updatePage: db.prepare(
      `UPDATE pages
          SET content    = COALESCE(?, content),
              title      = COALESCE(?, title),
              pinned     = COALESCE(?, pinned),
              updated_at = ?
        WHERE folio_id = ? AND id = ?`,
    ),
    deletePage: db.prepare(
      'DELETE FROM pages WHERE folio_id = ? AND id = ?',
    ),
    listPagesByFolio: db.prepare(
      'SELECT * FROM pages WHERE folio_id = ? ORDER BY created_at ASC',
    ),
    listPagesByChapter: db.prepare(
      'SELECT * FROM pages WHERE folio_id = ? AND chapter_slug = ? ORDER BY created_at ASC',
    ),

    // FTS search — title weighted 10× content so a page whose *title* matches
    // (e.g. "MCP Tools" for `[[MCP`) outranks long pages that merely mention the
    // term in their body. bm25() returns negative scores (lower = better match);
    // the heavier title weight pushes title hits further negative → to the top.
    searchPages: db.prepare(`
      SELECT p.*, bm25(pages_fts, 10.0, 1.0) AS _score
        FROM pages_fts
        JOIN pages p ON p.rowid = pages_fts.rowid
       WHERE pages_fts MATCH ?
         AND p.folio_id = ?
       ORDER BY bm25(pages_fts, 10.0, 1.0)
       LIMIT ?
    `),

    // attachments
    insertAttachment: db.prepare(
      'INSERT INTO attachments (id, page_id, name, mime_type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    getAttachment: db.prepare(
      `SELECT a.*
         FROM attachments a
         JOIN pages p ON p.id = a.page_id
        WHERE a.id = ? AND p.folio_id = ?`,
    ),
    listAttachments: db.prepare(
      `SELECT a.id, a.page_id, a.name, a.mime_type, a.created_at
         FROM attachments a
         JOIN pages p ON p.id = a.page_id
        WHERE a.page_id = ? AND p.folio_id = ?
        ORDER BY a.created_at ASC`,
    ),
    deleteAttachment: db.prepare(
      `DELETE FROM attachments
        WHERE id = ? AND page_id IN (
          SELECT id FROM pages WHERE folio_id = ?
        )`,
    ),
  };

  // ── Folios ────────────────────────────────────────────────────────────────

  /**
   * Create a new Folio.
   * @param {{ name: string }} opts
   * @returns {Folio}
   */
  function createFolio({ name }) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new TypeError('Folio name must be a non-empty string');
    }
    const id        = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    stmts.insertFolio.run(id, name.trim(), createdAt);
    return { id, name: name.trim(), createdAt };
  }

  /**
   * @param {string} folioId
   * @returns {Folio | null}
   */
  function getFolio(folioId) {
    return rowToFolio(stmts.getFolio.get(folioId));
  }

  /**
   * List all folios ordered by creation date (oldest first).
   *
   * @returns {Folio[]}
   */
  function listFolios() {
    return stmts.listFolios.all().map(rowToFolio);
  }

  /**
   * Delete a folio and cascade-remove all its chapters, pages, attachments
   * and FTS rows (FTS rows are removed by the page_delete trigger already
   * present in applySchema; attachment rows are removed explicitly first to
   * avoid FK issues in strict mode).
   *
   * @param {string} folioId
   * @returns {boolean}  true if the folio existed and was deleted
   */
  function deleteFolio(folioId) {
    const deleteFolioTx = db.transaction(() => {
      stmts.deleteAttachmentsByFolio.run(folioId);
      stmts.deletePagesByFolio.run(folioId);
      stmts.deleteChaptersByFolio.run(folioId);
      const info = stmts.deleteFolioById.run(folioId);
      return info.changes > 0;
    });
    return deleteFolioTx();
  }

  // ── Pages (chapters emerge from slug) ────────────────────────────────────

  /**
   * Create a page. If the chapter segment of the slug does not exist it is
   * materialized automatically (chapter emergence).
   *
   * @param {string} folioId
   * @param {string} slug        - "chapter/page"
   * @param {string} content     - markdown
   * @param {{ author?: 'user'|'agent', title?: string, pinned?: boolean }} [opts]
   * @returns {Page}
   * @throws {FolioConflictError} if (folioId, chapterSlug, pageSlug) already exists
   * @throws {TypeError}           on invalid slug or content too large
   */
  function createPage(folioId, slug, content, opts = {}) {
    const { chapterSlug, pageSlug } = parseSlug(slug);

    if (typeof content !== 'string') {
      throw new TypeError('Page content must be a string');
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
      throw new RangeError(
        `Page content exceeds 1 MB limit (${Buffer.byteLength(content, 'utf8')} bytes)`,
      );
    }

    const author = opts.author ?? 'user';
    if (author !== 'user' && author !== 'agent') {
      throw new TypeError('author must be "user" or "agent"');
    }
    const pinned = opts.pinned ? 1 : 0;
    const now    = new Date().toISOString();

    const createPageTx = db.transaction(() => {
      // 1. Ensure the chapter exists (or create it).
      let chapter = stmts.getChapterByFolioAndSlug.get(folioId, chapterSlug);
      if (!chapter) {
        const { max_pos } = stmts.getMaxChapterPosition.get(folioId);
        const position    = max_pos + 1;
        const chapterId   = crypto.randomUUID();
        const chapterTitle = titleCase(chapterSlug);
        stmts.insertChapter.run(chapterId, folioId, chapterTitle, chapterSlug, position, now);
        chapter = { id: chapterId, folio_id: folioId, title: chapterTitle, slug: chapterSlug, position, created_at: now };
      }

      // 2. Insert the page (UNIQUE constraint enforced by DB).
      const pageId    = crypto.randomUUID();
      const pageTitle = opts.title ?? titleCase(pageSlug);

      try {
        stmts.insertPage.run(
          pageId,
          chapter.id,
          folioId,
          chapterSlug,
          pageTitle,
          pageSlug,
          content,
          author,
          pinned,
          now,
          now,
        );
      } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
          throw new FolioConflictError(
            `Page "${slug}" already exists in folio "${folioId}"`,
          );
        }
        throw err;
      }

      return stmts.getPage.get(folioId, pageId);
    });

    return rowToPage(createPageTx());
  }

  /**
   * @param {string} folioId
   * @param {string} pageId
   * @returns {Page | null}
   */
  function getPage(folioId, pageId) {
    return rowToPage(stmts.getPage.get(folioId, pageId));
  }

  /**
   * Single indexed lookup used by the [[chapter/page]] resolver.
   *
   * @param {string} folioId
   * @param {string} chapterSlug
   * @param {string} pageSlug
   * @returns {Page | null}
   */
  function getPageBySlug(folioId, chapterSlug, pageSlug) {
    return rowToPage(stmts.getPageBySlug.get(folioId, chapterSlug, pageSlug));
  }

  /**
   * @param {string} folioId
   * @param {string} pageId
   * @param {{ content?: string, title?: string, pinned?: boolean }} updates
   * @returns {Page}
   * @throws if page not found
   */
  function updatePage(folioId, pageId, updates) {
    if (updates.content !== undefined) {
      if (typeof updates.content !== 'string') {
        throw new TypeError('content must be a string');
      }
      if (Buffer.byteLength(updates.content, 'utf8') > MAX_CONTENT_BYTES) {
        throw new RangeError('Page content exceeds 1 MB limit');
      }
    }

    const updatedAt = new Date().toISOString();
    const pinnedVal = updates.pinned !== undefined ? (updates.pinned ? 1 : 0) : null;

    stmts.updatePage.run(
      updates.content ?? null,
      updates.title   ?? null,
      pinnedVal,
      updatedAt,
      folioId,
      pageId,
    );

    const page = getPage(folioId, pageId);
    if (!page) {
      throw new Error(`Page "${pageId}" not found in folio "${folioId}"`);
    }
    return page;
  }

  /**
   * @param {string} folioId
   * @param {string} pageId
   * @returns {boolean}
   */
  function deletePage(folioId, pageId) {
    const info = stmts.deletePage.run(folioId, pageId);
    return info.changes > 0;
  }

  // ── Chapters (read-only; created implicitly via createPage) ──────────────

  /**
   * @param {string} folioId
   * @returns {Chapter[]} ordered by position ASC
   */
  function listChapters(folioId) {
    return stmts.listChapters.all(folioId).map(rowToChapter);
  }

  /**
   * @param {string} folioId
   * @param {string} [chapterSlug]  - if provided, restrict to that chapter
   * @returns {Page[]}
   */
  function listPages(folioId, chapterSlug) {
    if (chapterSlug !== undefined) {
      return stmts.listPagesByChapter.all(folioId, chapterSlug).map(rowToPage);
    }
    return stmts.listPagesByFolio.all(folioId).map(rowToPage);
  }

  // ── FTS search ────────────────────────────────────────────────────────────

  /**
   * Full-text search over page title + content with BM25 ranking.
   * Lower BM25 score = better match (SQLite convention; negated in results).
   *
   * @param {string} folioId
   * @param {string} query
   * @param {{ limit?: number }} [opts]
   * @returns {Array<{ page: Page, score: number }>}
   */
  function searchPages(folioId, query, opts = {}) {
    if (typeof query !== 'string' || !query.trim()) {
      return [];
    }
    const limit = opts.limit ?? 20;

    // Sanitize to an OR-of-quoted-terms MATCH expression: multi-word queries
    // rank by term overlap (not strict AND → 0 hits), and quoting makes each
    // term a literal token (immune to FTS5 operator/column-qualifier parse errors).
    // opts.prebuilt → the caller already produced a valid MATCH expression
    // (e.g. the injection engine's stage-aware sanitizer); use it verbatim.
    const match = opts.prebuilt ? query.trim() : sanitizeFtsQuery(query);
    if (!match) return [];

    let rows;
    try {
      rows = stmts.searchPages.all(match, folioId, limit);
    } catch (err) {
      // FTS MATCH syntax error — return empty rather than crashing
      console.warn('[folio.store] searchPages: FTS query error —', err.message);
      return [];
    }

    return rows.map((row) => {
      const score = row._score;
      // Strip the synthetic _score column before building the page entity
      const { _score, ...pageRow } = row;
      return { page: rowToPage(pageRow), score };
    });
  }

  // ── Attachments ───────────────────────────────────────────────────────────

  /**
   * Store a binary attachment on a page.
   * `data` must be a Buffer or Uint8Array.
   *
   * @param {string} folioId
   * @param {string} pageId
   * @param {{ name: string, mimeType: string, data: Buffer }} att
   * @returns {Attachment}  (metadata only — no BLOB)
   */
  function addAttachment(folioId, pageId, att) {
    if (!att.name || typeof att.name !== 'string') {
      throw new TypeError('Attachment name must be a non-empty string');
    }
    if (!att.mimeType || typeof att.mimeType !== 'string') {
      throw new TypeError('Attachment mimeType must be a non-empty string');
    }
    if (!Buffer.isBuffer(att.data) && !(att.data instanceof Uint8Array)) {
      throw new TypeError('Attachment data must be a Buffer or Uint8Array');
    }

    // Verify the page belongs to this folio
    const page = getPage(folioId, pageId);
    if (!page) {
      throw new Error(`Page "${pageId}" not found in folio "${folioId}"`);
    }

    const id        = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    stmts.insertAttachment.run(id, pageId, att.name, att.mimeType, att.data, createdAt);
    return { id, pageId, name: att.name, mimeType: att.mimeType, createdAt };
  }

  /**
   * Retrieve an attachment including its BLOB data.
   * Returns null if the attachment does not exist or belongs to a different folio.
   *
   * @param {string} folioId
   * @param {string} attachmentId
   * @returns {Attachment | null}  (includes data BLOB)
   */
  function getAttachment(folioId, attachmentId) {
    return rowToAttachment(stmts.getAttachment.get(attachmentId, folioId), true);
  }

  /**
   * List attachments for a page — metadata only (no BLOB).
   *
   * @param {string} folioId
   * @param {string} pageId
   * @returns {Attachment[]}
   */
  function listAttachments(folioId, pageId) {
    return stmts.listAttachments.all(pageId, folioId).map((r) => rowToAttachment(r, false));
  }

  /**
   * Delete an attachment.
   * Returns false if the attachment did not exist or belonged to a different folio.
   *
   * @param {string} folioId
   * @param {string} attachmentId
   * @returns {boolean}
   */
  function deleteAttachment(folioId, attachmentId) {
    const info = stmts.deleteAttachment.run(attachmentId, folioId);
    return info.changes > 0;
  }

  // ── File-backend hydration helper ─────────────────────────────────────────

  /**
   * Insert a fully-specified page (and emerge its chapter if absent) WITHOUT
   * generating new ids or timestamps.  Used exclusively by file-backend
   * hydration to reconstruct the FTS index from markdown faithfully.
   *
   * This is the single, additive, backward-compatible extension to the audited
   * core.  It must NOT be called outside the backend hydration path.
   *
   * FTS triggers fire normally so the page is searchable immediately.
   *
   * @param {string} folioId
   * @param {{ id: string, chapterSlug: string, pageSlug: string, title?: string,
   *           content?: string, author?: 'user'|'agent', pinned?: boolean,
   *           createdAt: string, updatedAt?: string }} record
   * @returns {Page}
   */
  function loadPage(folioId, {
    id, chapterSlug, pageSlug, title, content, author, pinned, createdAt, updatedAt,
  }) {
    const loadTx = db.transaction(() => {
      // 1. Emerge chapter if absent (identical logic to createPage)
      let chapter = stmts.getChapterByFolioAndSlug.get(folioId, chapterSlug);
      if (!chapter) {
        const { max_pos } = stmts.getMaxChapterPosition.get(folioId);
        const position     = max_pos + 1;
        const chapterId    = crypto.randomUUID();
        const chapterTitle = titleCase(chapterSlug);
        stmts.insertChapter.run(chapterId, folioId, chapterTitle, chapterSlug, position, createdAt);
        chapter = {
          id: chapterId, folio_id: folioId, title: chapterTitle,
          slug: chapterSlug, position, created_at: createdAt,
        };
      }

      // 2. Insert with the caller-supplied id and timestamps
      const pageTitle  = title ?? titleCase(pageSlug);
      const pinnedVal  = pinned ? 1 : 0;
      const resolvedAt = updatedAt ?? createdAt;

      stmts.insertPage.run(
        id,
        chapter.id,
        folioId,
        chapterSlug,
        pageTitle,
        pageSlug,
        content ?? '',
        author  ?? 'user',
        pinnedVal,
        createdAt,
        resolvedAt,
      );

      return rowToPage(stmts.getPage.get(folioId, id));
    });

    return loadTx();
  }

  // ── Public interface ──────────────────────────────────────────────────────

  return {
    // folios
    createFolio,
    getFolio,
    listFolios,
    deleteFolio,
    // pages
    createPage,
    getPage,
    getPageBySlug,
    updatePage,
    deletePage,
    loadPage,
    // chapters
    listChapters,
    listPages,
    // search
    searchPages,
    // attachments
    addAttachment,
    getAttachment,
    listAttachments,
    deleteAttachment,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { createFolioStore, FolioConflictError, parseSlug, titleCase };
