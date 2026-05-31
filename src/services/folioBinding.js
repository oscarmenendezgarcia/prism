'use strict';

/**
 * Folio — Prism-side Binding Layer
 *
 * This is the ONLY place in the entire codebase where space_id appears in
 * relation to Folio. It owns:
 *
 *  1. The `space_folios` DDL (binding table — NOT in src/services/folio/).
 *  2. The `createIfMissing` activation contract:
 *       true  → materialize folio + binding if absent, then write page
 *       false → no-op (return null) if no binding; agent write-back path
 *  3. Read pass-throughs that resolve space_id → folio_id and return
 *     empty ([], null) when no folio is bound — never throw.
 *
 * Invariant: `src/services/folio/` contains no reference to space_folios or
 * space_id. The core is extracted by copying that directory; this file stays.
 *
 * Usage:
 *   const { createFolioBinding, applyBindingSchema } = require('./folioBinding');
 *   applyBindingSchema(db);
 *   const binding = createFolioBinding(db, coreStore);
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Binding DDL
// ---------------------------------------------------------------------------

const BINDING_SCHEMA_SQL = `
-- ===== BINDING (Prism-side; NOT in src/services/folio/) ====================

CREATE TABLE IF NOT EXISTS space_folios (
  space_id  TEXT NOT NULL UNIQUE REFERENCES spaces(id) ON DELETE CASCADE,
  folio_id  TEXT NOT NULL REFERENCES folios(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_space_folios_folio ON space_folios(folio_id);
`;

/**
 * Apply the Prism-side binding schema to the shared prism.db.
 * Idempotent — safe to call on every startup.
 *
 * @param {import('better-sqlite3').Database} db
 */
function applyBindingSchema(db) {
  db.exec(BINDING_SCHEMA_SQL);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the Folio binding store for Prism.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {ReturnType<import('./folio/store').createFolioStore>} core
 * @returns {FolioBinding}
 */
function createFolioBinding(db, core) {

  // ── Prepared statements ───────────────────────────────────────────────────

  const stmts = {
    getBinding: db.prepare(
      'SELECT folio_id FROM space_folios WHERE space_id = ?',
    ),
    insertBinding: db.prepare(
      'INSERT INTO space_folios (space_id, folio_id) VALUES (?, ?)',
    ),
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Resolve a spaceId to its folio_id, or null if no binding exists.
   *
   * @param {string} spaceId
   * @returns {string | null}
   */
  function getFolioIdForSpace(spaceId) {
    const row = stmts.getBinding.get(spaceId);
    return row ? row.folio_id : null;
  }

  /**
   * @param {string} spaceId
   * @returns {boolean}
   */
  function hasFolio(spaceId) {
    return getFolioIdForSpace(spaceId) !== null;
  }

  // ── Activation contract ───────────────────────────────────────────────────

  /**
   * Write a page scoped to a space, honouring the activation contract:
   *
   *   createIfMissing: true
   *     → if no binding: create a new Folio + space_folios row
   *     → then create the page in the core store
   *
   *   createIfMissing: false  (agent write-back)
   *     → if no binding: NO-OP, return null (folio is never created)
   *     → else create the page in the core store
   *
   * @param {string} spaceId
   * @param {string} slug             - "chapter/page"
   * @param {string} content          - markdown
   * @param {{ createIfMissing: boolean, author?: 'user'|'agent', title?: string, pinned?: boolean }} opts
   * @returns {Page | null}
   */
  function createPage(spaceId, slug, content, opts = {}) {
    const { createIfMissing, author, title, pinned } = opts;

    const activateTx = db.transaction(() => {
      let folioId = getFolioIdForSpace(spaceId);

      if (!folioId) {
        if (!createIfMissing) {
          // Agent write-back path — no-op
          return null;
        }
        // Explicit path — materialize folio + binding
        const folio = core.createFolio({ name: opts.folioName || 'Knowledge Base' });
        stmts.insertBinding.run(spaceId, folio.id);
        folioId = folio.id;
      }

      return core.createPage(folioId, slug, content, { author, title, pinned });
    });

    return activateTx();
  }

  // ── Read pass-throughs ────────────────────────────────────────────────────
  // All return empty ([], null) when no folio is bound — never throw.

  /**
   * @param {string} spaceId
   * @returns {Chapter[]}
   */
  function listChapters(spaceId) {
    const folioId = getFolioIdForSpace(spaceId);
    if (!folioId) return [];
    return core.listChapters(folioId);
  }

  /**
   * @param {string} spaceId
   * @param {string} [chapterSlug]
   * @returns {Page[]}
   */
  function listPages(spaceId, chapterSlug) {
    const folioId = getFolioIdForSpace(spaceId);
    if (!folioId) return [];
    return core.listPages(folioId, chapterSlug);
  }

  /**
   * @param {string} spaceId
   * @param {string} chapterSlug
   * @param {string} pageSlug
   * @returns {Page | null}
   */
  function getPageBySlug(spaceId, chapterSlug, pageSlug) {
    const folioId = getFolioIdForSpace(spaceId);
    if (!folioId) return null;
    return core.getPageBySlug(folioId, chapterSlug, pageSlug);
  }

  /**
   * @param {string} spaceId
   * @param {string} query
   * @param {{ limit?: number }} [searchOpts]
   * @returns {Array<{ page: Page, score: number }>}
   */
  function searchPages(spaceId, query, searchOpts) {
    const folioId = getFolioIdForSpace(spaceId);
    if (!folioId) return [];
    return core.searchPages(folioId, query, searchOpts);
  }

  /**
   * Return the H2 sections of a page, scoped to a space.
   * Returns [] when the space has no folio bound or the page does not exist.
   *
   * @param {string} spaceId
   * @param {string} chapterSlug
   * @param {string} pageSlug
   * @returns {Array<{ title: string, slug: string }>}
   */
  function listPageSections(spaceId, chapterSlug, pageSlug) {
    const folioId = getFolioIdForSpace(spaceId);
    if (!folioId) return [];
    return core.listPageSections(folioId, chapterSlug, pageSlug);
  }

  // ── Injection context (stage-aware) ──────────────────────────────────────

  /**
   * Assemble a stage-relevant Folio context block for the given space.
   *
   * Zero-cost guard: returns null immediately when no folio is bound to the
   * space — no BM25 search, no DB reads, no tokens computed.
   *
   * Delegates to the core injection engine (folio/injection.js) which is
   * space-agnostic and keyed on folioId only.  This is the ONLY place where
   * space_id meets injection.
   *
   * @param {string} spaceId
   * @param {string} query   - BM25 query string (task title + description + stage descriptor).
   * @param {object} [opts]  - Engine configuration overrides (scoreThreshold, caps, etc.).
   * @returns {{ text: string, tokens: number, inline: Array, referenced: Array, truncated: Array } | null}
   */
  function buildInjectionContext(spaceId, query, opts) {
    const folioId = getFolioIdForSpace(spaceId);
    if (!folioId) return null;  // zero cost — no folio bound
    return core.buildInjectionContext(folioId, query, opts);
  }

  // ── Public interface ──────────────────────────────────────────────────────

  return {
    getFolioIdForSpace,
    hasFolio,
    createPage,
    listChapters,
    listPages,
    getPageBySlug,
    searchPages,
    listPageSections,
    buildInjectionContext,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { applyBindingSchema, createFolioBinding };
