'use strict';

/**
 * Folio — File-backed Binding Adapter (T-003 — folio-backend-selection)
 *
 * Exposes the SAME method surface as `folioBinding.js` but delegates to a
 * single file-backed FolioService for one space's <workingDir>/.folio/.
 *
 * Key differences from the SQLite binding:
 *  - No `space_folios` table — identity is directory presence (<wd>/.folio/ + ≥1 page).
 *  - getFolioIdForSpace() inspects the service's backend.folioId when a service is open.
 *  - createPage with createIfMissing:false → no-op when no .folio/ present.
 *  - Bootstrap marker still uses the binding-side `folio_bootstrap` table (keyed by space_id,
 *    references only spaces(id)) — no FK conflict with the file backend.
 *
 * This module is used exclusively by the router (folioRouter.js) which owns
 * service lifecycle and caching.  It does NOT open or close the FolioService —
 * it only calls methods on an already-open service passed in.
 *
 * Invariant: no import from src/services/folio/ that references space_id.
 */

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a file-backed binding for ONE space.
 *
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.db       - Prism's shared SQLite DB (for bootstrap marker).
 * @param {Function}                          opts.getService  - `() => FolioService | null` — resolve the open service; null when .folio/ absent.
 * @param {Function}                          opts.spaceId     - The space ID this binding is tied to.
 * @returns {FolioFileBinding}
 */
function createFileBinding({ db, getService, spaceId }) {

  // ── Prepared statements (bootstrap marker only — uses the shared prism.db) ─

  const stmts = {
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
   * Return the folioId when .folio/ exists with ≥1 page; null otherwise.
   * Never opens or scaffolds — read-only check.
   *
   * @returns {string | null}
   */
  function getFolioIdForSpace() {
    const svc = getService();
    if (!svc) return null;
    // The service's backend exposes the folioId from the in-memory index.
    const folioId = svc.backend && svc.backend.folioId;
    if (!folioId) return null;
    // Confirm ≥1 page exists (in-memory index may be empty for a brand-new .folio/).
    const pages = svc.listPages(folioId);
    return pages.length > 0 ? folioId : null;
  }

  /**
   * @returns {boolean}
   */
  function hasFolio() {
    return getFolioIdForSpace() !== null;
  }

  // ── Activation contract ───────────────────────────────────────────────────

  /**
   * Write a page scoped to this file-backed space.
   *
   * createIfMissing: true  → scaffold + open service if .folio/ absent, then write.
   * createIfMissing: false → no-op when service unavailable (agent write-back).
   *
   * @param {string} _spaceId  - Ignored (this binding is already space-scoped).
   * @param {string} slug      - "chapter/page"
   * @param {string} content   - markdown
   * @param {{ createIfMissing: boolean, author?: string, title?: string, pinned?: boolean, folioName?: string }} opts
   * @returns {Page | null}
   */
  function createPage(_spaceId, slug, content, opts = {}) {
    const { createIfMissing, author, title, pinned, folioName } = opts;

    const svc = getService({ createIfMissing: !!createIfMissing, folioName });
    if (!svc) {
      if (!createIfMissing) {
        console.warn(`[folio.fileBinding] op=createPage spaceId=${spaceId} slug=${slug} outcome=noop reason=no-folio`);
      }
      return null;
    }

    const folioId = svc.backend.folioId;
    return svc.createPage(folioId, slug, content, { author, title, pinned });
  }

  // ── Read pass-throughs ────────────────────────────────────────────────────
  // All return empty ([], null) when no service is available — never throw.

  /**
   * @returns {Chapter[]}
   */
  function listChapters() {
    const svc = getService();
    if (!svc) return [];
    return svc.listChapters(svc.backend.folioId);
  }

  /**
   * @param {string} _spaceId  - Ignored.
   * @param {string} [chapterSlug]
   * @returns {Page[]}
   */
  function listPages(_spaceId, chapterSlug) {
    const svc = getService();
    if (!svc) return [];
    return svc.listPages(svc.backend.folioId, chapterSlug);
  }

  /**
   * @param {string} _spaceId
   * @param {string} chapterSlug
   * @param {string} pageSlug
   * @returns {Page | null}
   */
  function getPageBySlug(_spaceId, chapterSlug, pageSlug) {
    const svc = getService();
    if (!svc) return null;
    return svc.getPageBySlug(svc.backend.folioId, chapterSlug, pageSlug);
  }

  /**
   * @param {string} _spaceId
   * @param {string} query
   * @param {{ limit?: number }} [searchOpts]
   * @returns {Array<{ page: Page, score: number }>}
   */
  function searchPages(_spaceId, query, searchOpts) {
    const svc = getService();
    if (!svc) return [];
    return svc.searchPages(svc.backend.folioId, query, searchOpts);
  }

  /**
   * @param {string} _spaceId
   * @param {string} chapterSlug
   * @param {string} pageSlug
   * @returns {Array<{ title: string, slug: string }>}
   */
  function listPageSections(_spaceId, chapterSlug, pageSlug) {
    const svc = getService();
    if (!svc) return [];
    return svc.listPageSections(svc.backend.folioId, chapterSlug, pageSlug);
  }

  // ── Agent write-back ─────────────────────────────────────────────────────

  /**
   * Guarded agent write-back — same invariants as the SQLite binding.
   *
   * @param {string} _spaceId
   * @param {string} slug      - "chapter/page"
   * @param {string} content   - markdown
   * @param {{ title?: string, pinned?: boolean }} [opts]
   * @returns {Page | null | { skipped: 'user-owned' }}
   */
  function upsertPageFromAgent(_spaceId, slug, content, opts = {}) {
    const SLUG_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/;
    if (!SLUG_RE.test(slug)) {
      throw new TypeError(`upsertPageFromAgent: invalid slug "${slug}" — must match ^[a-z0-9-]+/[a-z0-9-]+$`);
    }

    // No-op when .folio/ is absent (createIfMissing: false).
    const svc = getService({ createIfMissing: false });
    if (!svc) {
      console.warn(`[folio.fileBinding] op=writeback spaceId=${spaceId} slug=${slug} outcome=noop reason=no-folio`);
      return null;
    }

    const folioId = svc.backend.folioId;
    const [chapterSlug, pageSlug] = slug.split('/');

    const existing = svc.getPageBySlug(folioId, chapterSlug, pageSlug);

    if (existing) {
      if (existing.author === 'user') {
        console.warn(`[folio.fileBinding] op=writeback spaceId=${spaceId} slug=${slug} outcome=skipped reason=user-owned`);
        return { skipped: 'user-owned' };
      }
      // Agent-owned page — update content (last-write-wins).
      const updated = svc.updatePage(folioId, existing.id, {
        content,
        ...(opts.title  !== undefined && { title:  opts.title  }),
        ...(opts.pinned !== undefined && { pinned: opts.pinned }),
      });
      console.warn(`[folio.fileBinding] op=writeback spaceId=${spaceId} slug=${slug} outcome=updated`);
      return updated;
    }

    // No existing page — create with author='agent' (hard-coded).
    const page = svc.createPage(folioId, slug, content, {
      author: 'agent',
      title:  opts.title,
      pinned: opts.pinned,
    });
    console.warn(`[folio.fileBinding] op=writeback spaceId=${spaceId} slug=${slug} outcome=created`);
    return page;
  }

  // ── Bootstrap one-shot marker ─────────────────────────────────────────────

  /**
   * @param {string} _spaceId
   * @returns {{ bootstrappedAt: string | null }}
   */
  function getBootstrapState(_spaceId) {
    try {
      const row = stmts.getBootstrapState.get(spaceId);
      return { bootstrappedAt: row ? row.bootstrapped_at : null };
    } catch {
      return { bootstrappedAt: null };
    }
  }

  /**
   * @param {string} _spaceId
   * @param {string} ts
   */
  function setBootstrappedAt(_spaceId, ts) {
    try {
      stmts.upsertBootstrappedAt.run(spaceId, ts);
    } catch (err) {
      console.warn(`[folio.fileBinding] op=setBootstrappedAt spaceId=${spaceId} error=${err.message}`);
    }
  }

  // ── Injection context ─────────────────────────────────────────────────────

  /**
   * @param {string} _spaceId
   * @param {string} query
   * @param {object} [opts]
   * @returns {{ text, tokens, inline, referenced, truncated } | null}
   */
  function buildInjectionContext(_spaceId, query, opts) {
    const svc = getService();
    if (!svc) return null;
    return svc.buildInjectionContext(svc.backend.folioId, query, opts);
  }

  // ── Reference resolver ────────────────────────────────────────────────────

  /**
   * Resolve [[chapter/page]] references using the file-backed index.
   *
   * @param {string} _spaceId
   * @param {string} text
   * @returns {string}
   */
  function resolveRefs(_spaceId, text) {
    const svc = getService();
    if (!svc) return text; // no folio — return text unchanged
    return svc.resolveRefs(text, svc.backend.folioId);
  }

  // ── Public interface ──────────────────────────────────────────────────────

  return {
    getFolioIdForSpace,
    hasFolio,
    createPage,
    upsertPageFromAgent,
    listChapters,
    listPages,
    getPageBySlug,
    searchPages,
    listPageSections,
    buildInjectionContext,
    getBootstrapState,
    setBootstrappedAt,
    resolveRefs,
  };
}

module.exports = { createFileBinding };
