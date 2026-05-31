'use strict';

/**
 * Folio — Backend Router (T-004 — folio-backend-selection)
 *
 * The router is the public `store.folio.binding` — it dispatches every binding
 * call to the correct backend (SQLite or file) per space, without the callers
 * needing to know which backend is active.
 *
 * Responsibilities:
 *  1. Read space.folioBackend from the store on each call.
 *  2. Delegate SQLite-backend spaces to the unchanged SQLite binding.
 *  3. For file-backend spaces: resolve the per-<wd>/.folio/ FolioService from
 *     an internal Map cache; do a mtime-gated reindex when markdown is newer than
 *     the last hydrate; then delegate to a per-space FileBinding adapter.
 *  4. Scaffold <wd>/.folio/ (mkdir + folio.json + .gitignore[cache.db]) on the
 *     createIfMissing:true activation path before opening the service.
 *  5. Expose the additive `resolveRefs(spaceId, text)` method that removes the
 *     only direct `store.folio.core.resolveRefs` reach-in in pipelineManager.js.
 *  6. Emit [folio.router] structured logs for all significant operations.
 *  7. close() closes every cached file service — no open-handle leak.
 *
 * Usage:
 *   const router = createFolioRouter({ db, sqliteBinding, getSpace, makeFileService });
 *   store.folio.binding = router;
 */

const fs   = require('fs');
const path = require('path');

const { maxMarkdownMtime, openFileBackend, reindexFileBackend } = require('./folio/backend');
const { createFolioService }                                    = require('./folio/index');
const { createFileBinding }                                     = require('./folioFileBinding');

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.db              - Prism's shared SQLite DB.
 * @param {object}                            opts.sqliteBinding   - The original SQLite binding (unchanged).
 * @param {Function}                          opts.getSpace        - `(spaceId) => Space | null`
 * @param {Function}                          [opts.makeFileService] - `(root) => FolioService` (injectable for tests).
 * @returns {FolioRouter}
 */
function createFolioRouter({ db, sqliteBinding, getSpace, makeFileService }) {

  // Default: open a file-backed service at the given .folio/ root.
  const _makeFileService = makeFileService || ((root) => {
    return createFolioService(openFileBackend({ root }));
  });

  // ── File service cache ────────────────────────────────────────────────────
  // One entry per .folio/ root.

  /**
   * @type {Map<string, { service: FolioService, lastHydratedAt: number }>}
   */
  const serviceCache = new Map();

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Resolve the .folio/ root for a space's working directory.
   * Returns `<wd>/.folio` (does not check existence).
   *
   * @param {string} wd
   * @returns {string}
   */
  function folioRoot(wd) {
    return path.join(wd, '.folio');
  }

  /**
   * Scaffold <wd>/.folio/ with folio.json + .gitignore on the activation path.
   *
   * @param {string} root    - Absolute path to <wd>/.folio/
   * @param {string} [name]  - Folio name (defaults to "Knowledge Base")
   */
  function scaffoldFolioDir(root, name = 'Knowledge Base') {
    fs.mkdirSync(root, { recursive: true });

    const manifestPath = path.join(root, 'folio.json');
    if (!fs.existsSync(manifestPath)) {
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({ name, formatVersion: '1.0' }, null, 2) + '\n',
        'utf8',
      );
    }

    const gitignorePath = path.join(root, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, 'cache.db\n', 'utf8');
    }

    console.log(`[folio.router] op=scaffold root=${root} outcome=ok`);
  }

  /**
   * Resolve (or open) a cached FolioService for the given .folio/ root.
   * Performs an mtime-gated reindex when markdown is newer than the last hydrate.
   * Returns null when .folio/ does not exist AND createIfMissing is false.
   *
   * @param {string}  root
   * @param {boolean} createIfMissing
   * @param {string}  [folioName]
   * @returns {FolioService | null}
   */
  function resolveFileService(root, createIfMissing, folioName) {
    const exists = (() => {
      try { return fs.statSync(root).isDirectory(); }
      catch (_) { return false; }
    })();

    if (!exists) {
      if (!createIfMissing) {
        console.log(`[folio.router] op=resolve root=${root} outcome=empty reason=no-folio-dir`);
        return null;
      }
      scaffoldFolioDir(root, folioName);
    }

    const cached = serviceCache.get(root);

    if (cached) {
      // mtime-gated reindex: rebuild when markdown is newer than last hydrate.
      const maxMtime = maxMarkdownMtime(root);
      if (maxMtime > cached.lastHydratedAt) {
        const t0 = performance.now ? performance.now() : Date.now();
        reindexFileBackend(cached.service.backend);
        const durationMs = Math.round((performance.now ? performance.now() : Date.now()) - t0);
        cached.lastHydratedAt = maxMtime;
        console.log(`[folio.router] op=reindex root=${root} reason=mtime-stale durationMs=${durationMs}`);
      }
      console.log(`[folio.router] op=resolve root=${root} kind=file outcome=ok folioId=${cached.service.backend.folioId}`);
      return cached.service;
    }

    // Cache miss — open a new service.
    const service = _makeFileService(root);
    const lastHydratedAt = maxMarkdownMtime(root);
    serviceCache.set(root, { service, lastHydratedAt });
    console.log(`[folio.router] op=open root=${root} folioId=${service.backend.folioId}`);
    console.log(`[folio.router] op=resolve root=${root} kind=file outcome=ok folioId=${service.backend.folioId}`);
    return service;
  }

  /**
   * Determine whether this space uses the file backend and has a working dir.
   * Returns `{ useFile: true, wd, root }` or `{ useFile: false }`.
   *
   * @param {string} spaceId
   * @returns {{ useFile: boolean, wd?: string, root?: string }}
   */
  function resolveBackend(spaceId) {
    const space = getSpace(spaceId);
    if (!space) return { useFile: false };
    if (space.folioBackend !== 'file' || !space.workingDirectory) {
      console.log(`[folio.router] op=resolve spaceId=${spaceId} kind=sqlite outcome=ok`);
      return { useFile: false };
    }
    const root = folioRoot(space.workingDirectory);
    return { useFile: true, wd: space.workingDirectory, root };
  }

  /**
   * Build a per-space FileBinding adapter that wraps a `getService` closure.
   * The closure forwards createIfMissing to the cache resolver.
   *
   * @param {string} spaceId
   * @param {string} root
   * @returns {FolioFileBinding}
   */
  function getFileBinding(spaceId, root) {
    return createFileBinding({
      db,
      spaceId,
      getService: (opts = {}) => {
        const { createIfMissing = false, folioName } = opts;
        return resolveFileService(root, createIfMissing, folioName);
      },
    });
  }

  // ── Public interface (superset of the SQLite binding) ────────────────────

  function getFolioIdForSpace(spaceId) {
    const { useFile, root } = resolveBackend(spaceId);
    if (!useFile) return sqliteBinding.getFolioIdForSpace(spaceId);
    const svc = resolveFileService(root, false);
    if (!svc) return null;
    const folioId = svc.backend && svc.backend.folioId;
    if (!folioId) return null;
    const pages = svc.listPages(folioId);
    return pages.length > 0 ? folioId : null;
  }

  function hasFolio(spaceId) {
    const { useFile, root } = resolveBackend(spaceId);
    if (!useFile) return sqliteBinding.hasFolio(spaceId);
    return getFileBinding(spaceId, root).hasFolio(spaceId);
  }

  function createPage(spaceId, slug, content, opts = {}) {
    const { useFile, root } = resolveBackend(spaceId);
    if (!useFile) return sqliteBinding.createPage(spaceId, slug, content, opts);
    return getFileBinding(spaceId, root).createPage(spaceId, slug, content, opts);
  }

  function upsertPageFromAgent(spaceId, slug, content, opts = {}) {
    const { useFile, root } = resolveBackend(spaceId);
    if (!useFile) return sqliteBinding.upsertPageFromAgent(spaceId, slug, content, opts);
    return getFileBinding(spaceId, root).upsertPageFromAgent(spaceId, slug, content, opts);
  }

  function listChapters(spaceId) {
    const { useFile, root } = resolveBackend(spaceId);
    if (!useFile) return sqliteBinding.listChapters(spaceId);
    return getFileBinding(spaceId, root).listChapters(spaceId);
  }

  function listPages(spaceId, chapterSlug) {
    const { useFile, root } = resolveBackend(spaceId);
    if (!useFile) return sqliteBinding.listPages(spaceId, chapterSlug);
    return getFileBinding(spaceId, root).listPages(spaceId, chapterSlug);
  }

  function getPageBySlug(spaceId, chapterSlug, pageSlug) {
    const { useFile, root } = resolveBackend(spaceId);
    if (!useFile) return sqliteBinding.getPageBySlug(spaceId, chapterSlug, pageSlug);
    return getFileBinding(spaceId, root).getPageBySlug(spaceId, chapterSlug, pageSlug);
  }

  function searchPages(spaceId, query, searchOpts) {
    const { useFile, root } = resolveBackend(spaceId);
    if (!useFile) return sqliteBinding.searchPages(spaceId, query, searchOpts);
    return getFileBinding(spaceId, root).searchPages(spaceId, query, searchOpts);
  }

  function listPageSections(spaceId, chapterSlug, pageSlug) {
    const { useFile, root } = resolveBackend(spaceId);
    if (!useFile) return sqliteBinding.listPageSections(spaceId, chapterSlug, pageSlug);
    return getFileBinding(spaceId, root).listPageSections(spaceId, chapterSlug, pageSlug);
  }

  function buildInjectionContext(spaceId, query, opts) {
    const { useFile, root } = resolveBackend(spaceId);
    if (!useFile) return sqliteBinding.buildInjectionContext(spaceId, query, opts);
    return getFileBinding(spaceId, root).buildInjectionContext(spaceId, query, opts);
  }

  function getBootstrapState(spaceId) {
    const { useFile, root } = resolveBackend(spaceId);
    if (!useFile) return sqliteBinding.getBootstrapState(spaceId);
    return getFileBinding(spaceId, root).getBootstrapState(spaceId);
  }

  function setBootstrappedAt(spaceId, ts) {
    const { useFile, root } = resolveBackend(spaceId);
    if (!useFile) return sqliteBinding.setBootstrappedAt(spaceId, ts);
    return getFileBinding(spaceId, root).setBootstrappedAt(spaceId, ts);
  }

  /**
   * Additive method: resolves [[chapter/page]] refs using the space's backend.
   * Removes the only direct `store.folio.core.resolveRefs(text, folioId)` call
   * in pipelineManager.js — now callers use `binding.resolveRefs(spaceId, text)`.
   *
   * @param {string} spaceId
   * @param {string} text
   * @returns {string}
   */
  function resolveRefs(spaceId, text) {
    const { useFile, root } = resolveBackend(spaceId);
    if (!useFile) {
      // SQLite path: resolve via the shared core.
      const folioId = sqliteBinding.getFolioIdForSpace(spaceId);
      if (!folioId) return text;
      // The SQLite binding doesn't expose resolveRefs directly — delegate to core via service.
      // The router receives the core service as a dependency for this.
      if (_sqliteCore) {
        return _sqliteCore.resolveRefs(text, folioId);
      }
      return text;
    }
    return getFileBinding(spaceId, root).resolveRefs(spaceId, text);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Close all cached file services.
   * Called by store.close() to prevent open-handle leaks.
   */
  function close() {
    for (const [root, cached] of serviceCache.entries()) {
      try {
        cached.service.close();
        console.log(`[folio.router] op=close root=${root}`);
      } catch (err) {
        console.warn(`[folio.router] op=close root=${root} error=${err.message}`);
      }
    }
    serviceCache.clear();
  }

  // Internal reference to the SQLite core (injected post-construction for resolveRefs).
  let _sqliteCore = null;

  /**
   * Inject the SQLite FolioService for use in resolveRefs on the SQLite path.
   * Called once by store.js after construction.
   *
   * @param {FolioService} core
   */
  function setSqliteCore(core) {
    _sqliteCore = core;
  }

  return {
    // Standard binding surface (same as folioBinding.js)
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
    // Additive
    resolveRefs,
    // Lifecycle
    close,
    // Internal — for store.js wiring only
    setSqliteCore,
  };
}

module.exports = { createFolioRouter };
