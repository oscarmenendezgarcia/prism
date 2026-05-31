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
const { createResolver, extractHeadings }       = require('./resolver');
const { openSqliteBackend, openFileBackend, reindexFileBackend } = require('./backend');
const { buildContext }                           = require('./injection');
const { exportToDir, importFromDir }             = require('./archive');
const { packDir, unpackBuffer }                  = require('./zip');

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

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

  // ── Injection context ─────────────────────────────────────────────────────

  /**
   * Assemble a stage-relevant Folio context block.
   * Thin pass-through to the injection engine (folio/injection.js).
   * Space-agnostic: keyed on folioId only — the binding layer owns space_id.
   *
   * @param {string} folioId
   * @param {string} query   - BM25 query string (task title + description + stage descriptor).
   * @param {object} [opts]  - Engine configuration overrides.
   * @returns {{ text: string, tokens: number, inline: Array, referenced: Array, truncated: Array }}
   */
  function buildInjectionContext(folioId, query, opts) {
    return buildContext(store, folioId, query, opts);
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

  // ── Headings ──────────────────────────────────────────────────────────────

  /**
   * Return the H2 sections (as { title, slug } pairs) for a specific page.
   * Returns [] when the page does not exist.
   *
   * @param {string} folioId
   * @param {string} chapterSlug
   * @param {string} pageSlug
   * @returns {Array<{ title: string, slug: string }>}
   */
  function listPageSections(folioId, chapterSlug, pageSlug) {
    const page = store.getPageBySlug(folioId, chapterSlug, pageSlug);
    if (!page) return [];
    return extractHeadings(page.content);
  }

  // ── Export / Import (Phase 1) + Pack / Unpack (Phase 2) ─────────────────

  /**
   * Export a folio to a canonical markdown folder.
   * Atomic: builds into a temp dir then renames into place.
   *
   * @param {string} folioId
   * @param {string} destDir   — target directory
   * @returns {{ dir: string, name: string, chapters: number, pages: number, attachments: number }}
   */
  function exportFolio(folioId, destDir) {
    return exportToDir(store, folioId, destDir);
  }

  /**
   * Import a canonical markdown folder (or a previously exported folder) into
   * a new folio in the store.
   *
   * @param {string} srcDir
   * @param {{ name?: string }} [opts]
   * @returns {{ folioId: string, name: string, chapters: number, pages: number, attachments: number, skipped: string[] }}
   */
  function importFolder(srcDir, opts = {}) {
    return importFromDir(store, srcDir, opts);
  }

  /**
   * Export a folio to a `.folio` zip archive (Phase 2).
   * Steps:
   *   1. exportFolio → tmpDir
   *   2. Write archive-level manifest.json to tmpDir
   *   3. packDir(tmpDir) → Buffer → write to destFile
   *   4. Remove tmpDir
   *
   * @param {string} folioId
   * @param {string} destFile   — output path (e.g. "my-folio.folio")
   * @returns {{ file: string, name: string, chapters: number, pages: number, attachments: number }}
   */
  function packFolio(folioId, destFile) {
    const resolvedDest = path.resolve(destFile);
    const tmpDir       = `${resolvedDest}.export-${crypto.randomBytes(6).toString('hex')}`;

    let exportResult;
    try {
      exportResult = exportToDir(store, folioId, tmpDir);

      // Write archive-level manifest.json (top-level inside the zip)
      const archiveManifest = {
        format:         'folio',
        archiveVersion: '1.0',
        formatVersion:  '1.0',
        tool:           'prism-folio',
        exportedAt:     new Date().toISOString(),
        pageCount:      exportResult.pages,
      };
      fs.writeFileSync(
        path.join(tmpDir, 'manifest.json'),
        JSON.stringify(archiveManifest, null, 2) + '\n',
        'utf8',
      );

      // Pack and write
      const zipBuf = packDir(tmpDir);

      // Write output atomically
      const outTmp = `${resolvedDest}.tmp`;
      fs.mkdirSync(path.dirname(resolvedDest), { recursive: true });
      fs.writeFileSync(outTmp, zipBuf);
      fs.renameSync(outTmp, resolvedDest);

    } finally {
      // Always remove the intermediate export dir
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }

    console.warn(
      `[folio.index] op=pack folioId=${folioId}` +
      ` pages=${exportResult.pages} file=${resolvedDest} outcome=ok`,
    );

    // Return file (archive path) + counts — exclude dir (temp, already removed)
    return {
      file:        resolvedDest,
      name:        exportResult.name,
      chapters:    exportResult.chapters,
      pages:       exportResult.pages,
      attachments: exportResult.attachments,
    };
  }

  /**
   * Unpack a `.folio` zip archive and import it into a new folio (Phase 2).
   * Steps:
   *   1. Read zip file → Buffer
   *   2. unpackBuffer → tmpDir
   *   3. importFromDir(tmpDir) → ImportResult
   *   4. Remove tmpDir
   *
   * @param {string} srcFile   — path to a .folio zip archive
   * @param {{ name?: string }} [opts]
   * @returns {{ folioId: string, name: string, chapters: number, pages: number, attachments: number, skipped: string[] }}
   */
  function unpackFolio(srcFile, opts = {}) {
    const resolvedSrc = path.resolve(srcFile);
    if (!fs.existsSync(resolvedSrc)) {
      throw new Error(`Folio archive not found: "${srcFile}"`);
    }

    const tmpDir = `${resolvedSrc}.unpack-${crypto.randomBytes(6).toString('hex')}`;
    let importResult;

    try {
      const zipBuf = fs.readFileSync(resolvedSrc);
      unpackBuffer(zipBuf, tmpDir);
      importResult = importFromDir(store, tmpDir, opts);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }

    console.warn(
      `[folio.index] op=unpack file=${resolvedSrc}` +
      ` folioId=${importResult.folioId} pages=${importResult.pages} outcome=ok`,
    );

    return importResult;
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
    // Headings (for autocomplete second level)
    listPageSections,
    // Attachments (blobs stored in SQLite in both backends for v1)
    addAttachment:    store.addAttachment.bind(store),
    getAttachment:    store.getAttachment.bind(store),
    listAttachments:  store.listAttachments.bind(store),
    deleteAttachment: store.deleteAttachment.bind(store),
    // Resolver
    resolveRefs,
    // Injection context (stage-aware; see folio/injection.js)
    buildInjectionContext,
    // Export / Import (Phase 1) — folder round-trip
    exportFolio,
    importFolder,
    // Pack / Unpack (Phase 2) — .folio zip wrapper
    packFolio,
    unpackFolio,
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
