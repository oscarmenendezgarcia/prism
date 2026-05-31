'use strict';

/**
 * Folio — Pluggable Storage Backend (backend.js)
 *
 * Two factories produce the Backend handle consumed by the facade (index.js):
 *
 *   openSqliteBackend({ db })
 *     Wraps an existing better-sqlite3 handle (Prism's prism.db).
 *     SQLite is *both* source of truth and index.
 *     persistPage / removePage are no-ops.
 *
 *   openFileBackend({ cwd, cache? })
 *     Discovers a `.folio/` directory by walking up from `cwd` (like `git`
 *     finds `.git`).  Markdown files are the source of truth.
 *     Derives an in-memory SQLite index from those markdown files.
 *     With `cache: true`, uses `.folio/cache.db` instead and skips rebuild
 *     when the cache is fresh (max mtime of *.md ≤ mtime of cache.db).
 *     persistPage writes `.md` files atomically (tmp + rename).
 *     removePage unlinks the `.md` file.
 *
 * Backend contract:
 *   {
 *     db,           // better-sqlite3 Database (schema applied, hydrated)
 *     kind,         // 'sqlite' | 'file'
 *     root,         // .folio/ absolute path (file mode) | null (sqlite)
 *     folioId,      // active folio UUID in the db (file mode) | null (sqlite)
 *     persistPage(page),  // file: atomic .md write; sqlite: no-op
 *     removePage(page),   // file: unlink .md; sqlite: no-op
 *     flush(),            // file+cache: checkpoint WAL; else no-op
 *     close()             // close db handle
 *   }
 *
 * Invariants:
 *  - No import outside src/services/folio/.
 *  - No reference to space_id.
 *  - Atomic writes: tmp file → fs.renameSync → never corrupt an existing page.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const Database = require('better-sqlite3');

const { applySchema }          = require('./db');
const { createFolioStore }     = require('./store');
const { renderPage, parsePage, readManifest, writeManifest } = require('./markdown');

// ---------------------------------------------------------------------------
// SQLite backend
// ---------------------------------------------------------------------------

/**
 * Wrap an already-open better-sqlite3 Database (Prism's prism.db).
 * The schema must already be applied (Prism calls applySchema on startup).
 *
 * @param {{ db: import('better-sqlite3').Database }} opts
 * @returns {Backend}
 */
function openSqliteBackend({ db }) {
  return {
    db,
    kind:    'sqlite',
    root:    null,
    folioId: null,
    persistPage() {},  // no-op: db is truth
    removePage()  {},  // no-op: db is truth
    flush()       {},  // no-op
    close()       { db.close(); },
  };
}

// ---------------------------------------------------------------------------
// File backend helpers
// ---------------------------------------------------------------------------

/**
 * Walk up from `startDir` looking for a `.folio/` directory (just like
 * `git` finds `.git`).  Returns the absolute path to `.folio/` or null.
 *
 * @param {string} startDir
 * @returns {string | null}
 */
function findFolioRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, '.folio');
    try {
      const stat = fs.statSync(candidate);
      if (stat.isDirectory()) return candidate;
    } catch (_) {
      // candidate does not exist or is inaccessible — continue walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;  // reached filesystem root
    dir = parent;
  }
}

/**
 * Return the maximum mtime (in ms) across all `*.md` files under `root`
 * (one level of chapter subdirectories) and `folio.json`.
 * Returns 0 if there are no markdown files.
 *
 * @param {string} root  — .folio/ absolute path
 * @returns {number}
 */
function maxMarkdownMtime(root) {
  let maxMs = 0;

  // folio.json contributes to staleness
  try {
    const st = fs.statSync(path.join(root, 'folio.json'));
    if (st.mtimeMs > maxMs) maxMs = st.mtimeMs;
  } catch (_) { /* absent — skip */ }

  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return maxMs;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === '_attachments') continue;

    const chapterDir = path.join(root, entry.name);
    let mdFiles;
    try {
      mdFiles = fs.readdirSync(chapterDir);
    } catch (_) {
      continue;
    }

    for (const file of mdFiles) {
      if (!file.endsWith('.md')) continue;
      try {
        const st = fs.statSync(path.join(chapterDir, file));
        if (st.mtimeMs > maxMs) maxMs = st.mtimeMs;
      } catch (_) { /* skip unreadable */ }
    }
  }

  return maxMs;
}

/**
 * Hydrate a SQLite db from the markdown files in `root`.
 * Creates a single folio record, then loadPage()s every `.md` file.
 * Returns the UUID of the created folio.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} root
 * @returns {string}  folioId
 */
function hydrateFromMarkdown(db, root) {
  const store = createFolioStore(db);

  // Read (or default) the manifest
  const manifestPath = path.join(root, 'folio.json');
  const manifest     = readManifest(manifestPath);

  // Create the single folio for this .folio/ directory
  const folio   = store.createFolio({ name: manifest.name });
  const folioId = folio.id;

  // Walk chapter directories
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    console.warn('[folio.backend] hydrateFromMarkdown: cannot read root —', err.message);
    return folioId;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === '_attachments') continue;

    const chapterSlug = entry.name;
    const chapterDir  = path.join(root, chapterSlug);

    let mdFiles;
    try {
      mdFiles = fs.readdirSync(chapterDir);
    } catch (err) {
      console.warn(`[folio.backend] cannot read chapter dir "${chapterDir}" —`, err.message);
      continue;
    }

    for (const file of mdFiles) {
      if (!file.endsWith('.md')) continue;

      const pageSlug = file.slice(0, -3);  // strip .md
      const filePath = path.join(chapterDir, file);

      let raw;
      try {
        raw = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        console.warn(`[folio.backend] cannot read "${filePath}" —`, err.message);
        continue;
      }

      let parsed;
      try {
        parsed = parsePage({ chapterSlug, pageSlug, raw });
      } catch (err) {
        console.warn(`[folio.backend] skipping "${filePath}" — parse error:`, err.message);
        continue;
      }

      try {
        store.loadPage(folioId, {
          id:          crypto.randomUUID(),
          chapterSlug,
          pageSlug,
          title:       parsed.title,
          content:     parsed.content,
          author:      parsed.author,
          pinned:      parsed.pinned,
          createdAt:   parsed.createdAt,
          updatedAt:   parsed.updatedAt,
        });
      } catch (err) {
        console.warn(`[folio.backend] skipping "${filePath}" — loadPage error:`, err.message);
      }
    }
  }

  return folioId;
}

/**
 * Compute the absolute path for a page's `.md` file.
 *
 * @param {string} root
 * @param {string} chapterSlug
 * @param {string} pageSlug
 * @returns {string}
 */
function pageMdPath(root, chapterSlug, pageSlug) {
  return path.join(root, chapterSlug, `${pageSlug}.md`);
}

// ---------------------------------------------------------------------------
// File backend
// ---------------------------------------------------------------------------

/**
 * Open a file-backed Folio backend.
 *
 * Discovers the `.folio/` directory by walking up from `cwd`.
 * With `cache: false` (default): hydrates a fresh in-memory SQLite db every
 *   invocation — zero staleness risk.
 * With `cache: true`: uses `.folio/cache.db` and rebuilds only when
 *   `max(mtime *.md) > mtime(cache.db)` or when `cache.db` is absent.
 *
 * @param {{ cwd?: string, cache?: boolean, root?: string }} opts
 *   `root` may be provided directly (test helper; skips discovery walk-up).
 * @returns {Backend}
 */
function openFileBackend({ cwd = process.cwd(), cache = false, root: explicitRoot } = {}) {
  // 1. Discover .folio/ root
  const root = explicitRoot ?? findFolioRoot(cwd);
  if (!root) {
    throw new Error(
      `[folio.backend] No .folio/ directory found (walked up from "${cwd}")`,
    );
  }

  // Validate that the root exists and is a directory
  try {
    const st = fs.statSync(root);
    if (!st.isDirectory()) {
      throw new Error(`[folio.backend] No .folio/ directory found: "${root}" is not a directory`);
    }
  } catch (err) {
    if (err.code === 'ENOENT' || err.message.includes('No .folio')) {
      throw new Error(`[folio.backend] No .folio/ directory found: "${root}" does not exist`);
    }
    throw err;
  }

  // 2. Decide on db path and whether to hydrate
  let db;
  let needsHydrate;

  if (cache) {
    const cacheDbPath = path.join(root, 'cache.db');
    let cacheExists = false;
    try {
      const st = fs.statSync(cacheDbPath);
      cacheExists = st.isFile();
    } catch (_) { /* absent */ }

    if (cacheExists) {
      const maxMd      = maxMarkdownMtime(root);
      const cacheMtime = fs.statSync(cacheDbPath).mtimeMs;
      needsHydrate     = maxMd > cacheMtime;
    } else {
      needsHydrate = true;
    }

    db = new Database(cacheDbPath);
  } else {
    db           = new Database(':memory:');
    needsHydrate = true;
  }

  // 3. Apply schema (idempotent)
  applySchema(db);

  // 4. Hydrate from markdown if needed
  let folioId;
  if (needsHydrate) {
    // For cache mode: clear any existing data before re-hydrating
    if (cache) {
      try {
        db.exec(`
          DELETE FROM attachments;
          DELETE FROM pages;
          DELETE FROM chapters;
          DELETE FROM folios;
        `);
      } catch (_) { /* fresh db — tables may be empty */ }
    }
    folioId = hydrateFromMarkdown(db, root);
  } else {
    // Re-use existing cache: read the folio record
    const row = db.prepare('SELECT id FROM folios LIMIT 1').get();
    folioId   = row ? row.id : hydrateFromMarkdown(db, root);
  }

  // 5. Build and return the backend handle
  return {
    db,
    kind:    'file',
    root,
    folioId,

    /**
     * Write a page's markdown file atomically (tmp + rename).
     * Creates the chapter directory if absent.
     *
     * @param {{ chapterSlug: string, slug: string, title: string, author: string,
     *           pinned: boolean, createdAt: string, updatedAt: string,
     *           content: string, tags?: string[] }} page
     */
    persistPage(page) {
      const chapterDir = path.join(root, page.chapterSlug);
      fs.mkdirSync(chapterDir, { recursive: true });

      const mdPath  = pageMdPath(root, page.chapterSlug, page.slug);
      const tmpPath = `${mdPath}.tmp`;
      const md      = renderPage(page);

      fs.writeFileSync(tmpPath, md, 'utf8');
      fs.renameSync(tmpPath, mdPath);
    },

    /**
     * Remove a page's markdown file.
     * Silently ignores ENOENT (already absent).
     *
     * @param {{ chapterSlug: string, slug: string }} page
     */
    removePage(page) {
      const mdPath = pageMdPath(root, page.chapterSlug, page.slug);
      try {
        fs.unlinkSync(mdPath);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    },

    /**
     * Flush (only meaningful when cache: true — runs a WAL checkpoint).
     */
    flush() {
      if (cache) {
        try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) { /* ok */ }
      }
    },

    close() {
      db.close();
    },
  };
}

/**
 * Force a reindex on a file-backed backend (rebuild the SQLite index from
 * markdown unconditionally, regardless of mtime).  Useful for `folio reindex`.
 *
 * @param {Backend} backend  — must be kind='file'
 */
function reindexFileBackend(backend) {
  if (backend.kind !== 'file') {
    throw new Error('[folio.backend] reindex only available on file backends');
  }

  const { db, root } = backend;

  // Clear the derived index
  try {
    db.exec(`
      DELETE FROM attachments;
      DELETE FROM pages;
      DELETE FROM chapters;
      DELETE FROM folios;
    `);
  } catch (_) { /* ignore */ }

  const newFolioId = hydrateFromMarkdown(db, root);
  // Update folioId on the backend handle
  backend.folioId = newFolioId;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  openSqliteBackend,
  openFileBackend,
  reindexFileBackend,
  // Exported for testing
  findFolioRoot,
  maxMarkdownMtime,
};
