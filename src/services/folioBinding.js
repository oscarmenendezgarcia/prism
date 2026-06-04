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

-- Bootstrap one-shot marker (T-001: folio-bootstrap feature).
-- Lives binding-side so the core (src/services/folio/) stays space-agnostic.
-- ON DELETE CASCADE ensures the row is pruned when its space is removed.
CREATE TABLE IF NOT EXISTS folio_bootstrap (
  space_id        TEXT NOT NULL UNIQUE REFERENCES spaces(id) ON DELETE CASCADE,
  bootstrapped_at TEXT NOT NULL
);
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
    // Bootstrap one-shot marker statements (T-002: folio-bootstrap).
    getBootstrapState: db.prepare(
      'SELECT bootstrapped_at FROM folio_bootstrap WHERE space_id = ?',
    ),
    upsertBootstrappedAt: db.prepare(
      `INSERT INTO folio_bootstrap (space_id, bootstrapped_at) VALUES (?, ?)
       ON CONFLICT (space_id) DO UPDATE SET bootstrapped_at = excluded.bootstrapped_at`,
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

  // ── Agent write-back ─────────────────────────────────────────────────────

  /**
   * The ONLY guarded write-back path for agent consolidation.
   *
   * Invariants (all structural — never trust the caller):
   *   - Returns null immediately if no folio is bound to the space (opt-in / createIfMissing:false).
   *   - Returns { skipped: 'user-owned' } if the slug already exists with author='user'.
   *   - author is hard-coded to 'agent' — the caller cannot override it.
   *   - On create: delegates to core.createPage with author='agent'.
   *   - On update: replaces content wholesale and bumps updated_at (last-write-wins).
   *   - slug must match ^[a-z0-9-]+\/[a-z0-9-]+$ — throws before any write otherwise.
   *
   * @param {string} spaceId
   * @param {string} slug             - "chapter/page" (e.g. "decisiones/auth-redesign")
   * @param {string} content          - markdown
   * @param {{ title?: string, pinned?: boolean }} [opts]
   * @returns {Page | null | { skipped: 'user-owned' }}
   */
  function upsertPageFromAgent(spaceId, slug, content, opts = {}) {
    const SLUG_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/;
    if (!SLUG_RE.test(slug)) {
      throw new TypeError(`upsertPageFromAgent: invalid slug "${slug}" — must match ^[a-z0-9-]+/[a-z0-9-]+$`);
    }

    const folioId = getFolioIdForSpace(spaceId);
    if (!folioId) {
      console.warn(`[folio.binding] op=writeback spaceId=${spaceId} slug=${slug} outcome=noop reason=no-folio`);
      return null; // opt-in not activated
    }

    const [chapterSlug, pageSlug] = slug.split('/');

    return db.transaction(() => {
      const existing = core.getPageBySlug(folioId, chapterSlug, pageSlug);

      if (existing) {
        if (existing.author === 'user') {
          console.warn(`[folio.binding] op=writeback spaceId=${spaceId} slug=${slug} outcome=skipped reason=user-owned`);
          return { skipped: 'user-owned' };
        }
        // agent-owned page — update content (last-write-wins)
        const updated = core.updatePage(folioId, existing.id, {
          content,
          ...(opts.title !== undefined && { title: opts.title }),
          ...(opts.pinned !== undefined && { pinned: opts.pinned }),
        });
        // updatePage does not set author — it preserves the existing value.
        // For agent write-back the existing page is already author='agent' (guard above).
        console.warn(`[folio.binding] op=writeback spaceId=${spaceId} slug=${slug} outcome=updated`);
        return updated;
      }

      // No existing page — create with author='agent' (hard-coded, caller cannot pass author).
      const page = core.createPage(folioId, slug, content, {
        author: 'agent',
        title:  opts.title,
        pinned: opts.pinned,
      });
      console.warn(`[folio.binding] op=writeback spaceId=${spaceId} slug=${slug} outcome=created`);
      return page;
    })();
  }

  // ── Mutation methods (T-001: folio-index-ui) ─────────────────────────────

  /**
   * Update a page, identified by slug. Preserves author (core invariant).
   * Returns null when no folio is bound or the page does not exist.
   *
   * @param {string} spaceId
   * @param {string} chapterSlug
   * @param {string} pageSlug
   * @param {{ content?: string, title?: string, pinned?: boolean }} updates
   * @returns {Page | null}
   */
  function updatePage(spaceId, chapterSlug, pageSlug, updates) {
    const folioId = getFolioIdForSpace(spaceId);
    if (!folioId) {
      console.warn(`[folio.binding] op=updatePage spaceId=${spaceId} slug=${chapterSlug}/${pageSlug} outcome=noop reason=no-folio`);
      return null;
    }
    const page = core.getPageBySlug(folioId, chapterSlug, pageSlug);
    if (!page) {
      console.warn(`[folio.binding] op=updatePage spaceId=${spaceId} slug=${chapterSlug}/${pageSlug} outcome=noop reason=page-not-found`);
      return null;
    }
    const updated = core.updatePage(folioId, page.id, updates);
    console.log(`[folio.binding] op=updatePage spaceId=${spaceId} slug=${chapterSlug}/${pageSlug} outcome=ok`);
    return updated;
  }

  /**
   * Delete a page, identified by slug.
   * Returns false when no folio is bound or the page does not exist.
   *
   * @param {string} spaceId
   * @param {string} chapterSlug
   * @param {string} pageSlug
   * @returns {boolean}
   */
  function deletePage(spaceId, chapterSlug, pageSlug) {
    const folioId = getFolioIdForSpace(spaceId);
    if (!folioId) {
      console.warn(`[folio.binding] op=deletePage spaceId=${spaceId} slug=${chapterSlug}/${pageSlug} outcome=noop reason=no-folio`);
      return false;
    }
    const page = core.getPageBySlug(folioId, chapterSlug, pageSlug);
    if (!page) {
      console.warn(`[folio.binding] op=deletePage spaceId=${spaceId} slug=${chapterSlug}/${pageSlug} outcome=noop reason=page-not-found`);
      return false;
    }
    const deleted = core.deletePage(folioId, page.id);
    console.log(`[folio.binding] op=deletePage spaceId=${spaceId} slug=${chapterSlug}/${pageSlug} outcome=${deleted ? 'ok' : 'noop'}`);
    return deleted;
  }

  // ── Bootstrap one-shot marker (T-002: folio-bootstrap) ──────────────────

  /**
   * Return the bootstrap marker for a space.
   * Returns { bootstrappedAt: null } when the space has not yet been bootstrapped.
   * Never throws.
   *
   * @param {string} spaceId
   * @returns {{ bootstrappedAt: string | null }}
   */
  function getBootstrapState(spaceId) {
    try {
      const row = stmts.getBootstrapState.get(spaceId);
      return { bootstrappedAt: row ? row.bootstrapped_at : null };
    } catch {
      return { bootstrappedAt: null };
    }
  }

  /**
   * Mark a space as bootstrapped.  Idempotent: a second call updates the timestamp
   * but does not insert a duplicate row (ON CONFLICT DO UPDATE).
   * Never throws.
   *
   * @param {string} spaceId
   * @param {string} ts - ISO 8601 timestamp.
   */
  function setBootstrappedAt(spaceId, ts) {
    try {
      stmts.upsertBootstrappedAt.run(spaceId, ts);
    } catch (err) {
      console.warn(`[folio.binding] op=setBootstrappedAt spaceId=${spaceId} error=${err.message}`);
    }
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
    upsertPageFromAgent,
    updatePage,
    deletePage,
    listChapters,
    listPages,
    getPageBySlug,
    searchPages,
    listPageSections,
    buildInjectionContext,
    getBootstrapState,
    setBootstrappedAt,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { applyBindingSchema, createFolioBinding };
