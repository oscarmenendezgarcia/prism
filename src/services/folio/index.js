'use strict';

/**
 * Folio — Public Module Facade (index.js)
 *
 * `createFolioService(backend)` is the single programmatic entry point for
 * all Folio consumers: the Prism host (store.js), the MCP adapter
 * (mcp/folio-tools.js), and future CLI/HTTP wrappers.
 *
 * Responsibilities:
 *  1. Wire `createFolioStore(backend.db)` into a ready store.
 *  2. For `kind='file'` backends: intercept createPage/updatePage/deletePage
 *     and mirror mutations to markdown (backend.persistPage / removePage).
 *     For `kind='sqlite'` backends: write-through is a no-op (persistPage
 *     and removePage are already no-ops in the SQLite backend).
 *  3. Attach the reference resolver and expose `resolveRefs`.
 *  4. Delegate `close` / `flush` to the backend.
 *
 * Re-exports:
 *   `openSqliteBackend`, `openFileBackend` — so callers have one import.
 *
 * Method compatibility:
 *   The returned FolioService is a superset of the core store surface, so
 *   `folioBinding.js` can consume it unchanged (it only calls the core methods).
 *
 * Invariants:
 *  - No import outside src/services/folio/.
 *  - No reference to space_id.
 */

const { createFolioStore, FolioConflictError } = require('./store');
const { createResolver }                        = require('./resolver');
const { openSqliteBackend, openFileBackend, reindexFileBackend } = require('./backend');

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a FolioService from an already-open Backend handle.
 *
 * @param {Backend} backend
 * @returns {FolioService}
 */
function createFolioService(backend) {

  const store    = createFolioStore(backend.db);
  const resolver = createResolver({
    getPageBySlug: (folioId, chapterSlug, pageSlug) =>
      store.getPageBySlug(folioId, chapterSlug, pageSlug),
  });

  const isFile = backend.kind === 'file';

  // ── Mutation pass-throughs with optional write-through ───────────────────

  /**
   * Create a page.  For file backends, mirrors the new `.md` atomically.
   */
  function createPage(folioId, slug, content, opts) {
    const page = store.createPage(folioId, slug, content, opts);
    if (isFile) backend.persistPage(page);
    return page;
  }

  /**
   * Update a page.  For file backends, rewrites the `.md` atomically.
   */
  function updatePage(folioId, pageId, updates) {
    const page = store.updatePage(folioId, pageId, updates);
    if (isFile) backend.persistPage(page);
    return page;
  }

  /**
   * Delete a page.  For file backends, unlinks the `.md`.
   */
  function deletePage(folioId, pageId) {
    // Snapshot the page before deletion so we can pass slug info to removePage
    const pageSnapshot = isFile ? store.getPage(folioId, pageId) : null;
    const deleted      = store.deletePage(folioId, pageId);
    if (isFile && pageSnapshot) backend.removePage(pageSnapshot);
    return deleted;
  }

  // ── Resolver ─────────────────────────────────────────────────────────────

  /**
   * Resolve `[[chapter/page]]` / `[[chapter/page#section]]` references in text.
   *
   * @param {string} text
   * @param {string} folioId
   * @returns {string}
   */
  function resolveRefs(text, folioId) {
    return resolver.resolveRefs(text, folioId);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  function flush() { backend.flush(); }
  function close() { backend.close(); }

  // ── Public interface ──────────────────────────────────────────────────────

  // ── Folio-level management (additive — file-backend write-through is out of v1 scope) ──
  //
  // NOTE: `deleteFolio` and `listFolios` call through to the store directly.
  // For the file backend, folio-level lifecycle (manifest / dir) is the CLI's
  // responsibility (`folio init` / manual removal).  Write-through for these
  // operations is intentionally NOT implemented in v1 — the store cascade
  // removes all SQLite rows; the .folio/ directory on disk is untouched.

  /**
   * List all folios in the backend DB.
   * Space-scoping (when wired into Prism's shared DB) is a binding concern.
   * @returns {Folio[]}
   */
  function listFolios() {
    return store.listFolios();
  }

  /**
   * Delete a folio and cascade-remove all its data from the store.
   * For the file backend the .folio/ directory is NOT removed (v1 out of scope).
   *
   * @param {string} folioId
   * @returns {boolean}
   */
  function deleteFolio(folioId) {
    return store.deleteFolio(folioId);
  }

  return {
    // Folios
    createFolio:      store.createFolio.bind(store),
    getFolio:         store.getFolio.bind(store),
    listFolios,
    deleteFolio,
    // Pages (mutations have optional write-through)
    createPage,
    getPage:          store.getPage.bind(store),
    getPageBySlug:    store.getPageBySlug.bind(store),
    updatePage,
    deletePage,
    loadPage:         store.loadPage.bind(store),
    // Chapters
    listChapters:     store.listChapters.bind(store),
    listPages:        store.listPages.bind(store),
    // Search
    searchPages:      store.searchPages.bind(store),
    // Attachments (blobs stored in SQLite in both backends for v1)
    addAttachment:    store.addAttachment.bind(store),
    getAttachment:    store.getAttachment.bind(store),
    listAttachments:  store.listAttachments.bind(store),
    deleteAttachment: store.deleteAttachment.bind(store),
    // Resolver
    resolveRefs,
    // Lifecycle
    flush,
    close,
    // Backend metadata (for callers that need to know the active backend kind)
    backend,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  createFolioService,
  FolioConflictError,
  // Re-export backend factories so callers have one import
  openSqliteBackend,
  openFileBackend,
  reindexFileBackend,
};
