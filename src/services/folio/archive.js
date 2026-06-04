'use strict';

/**
 * Folio — Export / Import (archive.js)
 *
 * Pure export/import between a FolioService store and a canonical markdown folder:
 *   - exportToDir(store, folioId, destDir) → ExportResult
 *   - importFromDir(store, srcDir, opts)   → ImportResult
 *
 * Canonical folder layout:
 *   <destDir>/
 *   ├── folio.json                          ← manifest (markdown.writeManifest)
 *   ├── <chapterSlug>/
 *   │   └── <pageSlug>.md                   ← YAML frontmatter + body (markdown.renderPage)
 *   └── _attachments/
 *       └── <chapterSlug>/<pageSlug>/<name> ← binary blobs
 *
 * Invariants:
 *  - No import outside src/services/folio/.
 *  - No reference to space_id.
 *  - Atomic writes: buildinto tmpDir → fs.renameSync → never a partial destDir.
 *  - Security: every path is resolved and asserted within its root (NFR4).
 *
 * Run: this file has no entry-point — import it as a module.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const { renderPage, parsePage, readManifest, writeManifest } = require('./markdown');

// ---------------------------------------------------------------------------
// MIME type inference
// ---------------------------------------------------------------------------

const MIME_MAP = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.pdf':  'application/pdf',
  '.txt':  'text/plain',
  '.md':   'text/markdown',
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm':  'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.xml':  'application/xml',
  '.csv':  'text/csv',
  '.zip':  'application/zip',
  '.mp4':  'video/mp4',
  '.mp3':  'audio/mpeg',
};

/**
 * Infer a MIME type from a file extension.
 * Returns 'application/octet-stream' for unknown extensions.
 *
 * @param {string} filename
 * @returns {string}
 */
function inferMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

/**
 * Assert that `resolvedPath` is within `rootDir`.
 * Throws RangeError on path-traversal attempt.
 *
 * @param {string} resolvedPath  — already path.resolve()'d
 * @param {string} rootDir       — absolute root
 */
function assertWithinRoot(resolvedPath, rootDir) {
  const rel = path.relative(rootDir, resolvedPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new RangeError(
      `Path traversal detected: "${resolvedPath}" is outside root "${rootDir}"`,
    );
  }
}

// ---------------------------------------------------------------------------
// Name de-duplication (same-page attachment collision)
// ---------------------------------------------------------------------------

/**
 * Return a unique filename within the `seen` set, suffixing ' (2)', ' (3)',
 * etc. when the name is already taken.
 *
 * @param {string}      name
 * @param {Set<string>} seen  — mutated in-place
 * @returns {string}
 */
function uniqueAttachmentName(name, seen) {
  if (!seen.has(name)) {
    seen.add(name);
    return name;
  }
  const ext  = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let i = 2;
  for (;;) {
    const candidate = `${base} (${i})${ext}`;
    if (!seen.has(candidate)) {
      seen.add(candidate);
      return candidate;
    }
    i++;
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Export a folio from a store to a canonical markdown folder.
 * Atomic: builds into a temp directory then renames into place.
 * A failure mid-export leaves no partial `destDir`.
 *
 * @param {object} store     — FolioService (or core store) providing:
 *                             getFolio, listChapters, listPages,
 *                             listAttachments, getAttachment
 * @param {string} folioId
 * @param {string} destDir   — target directory (created or replaced atomically)
 * @returns {{ dir: string, name: string, chapters: number, pages: number, attachments: number }}
 */
function exportToDir(store, folioId, destDir) {
  const folio = store.getFolio(folioId);
  if (!folio) {
    throw new Error(`Folio "${folioId}" not found`);
  }

  const resolvedDest = path.resolve(destDir);
  const tmpDir       = `${resolvedDest}.tmp-${crypto.randomBytes(6).toString('hex')}`;

  let chapterCount    = 0;
  let pageCount       = 0;
  let attachmentCount = 0;

  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    // ── folio.json manifest ────────────────────────────────────────────────
    const manifestPath = path.join(tmpDir, 'folio.json');
    writeManifest(manifestPath, {
      name:          folio.name,
      formatVersion: '1.0',
      createdAt:     folio.createdAt,
    });

    // ── Chapters → pages → attachments ────────────────────────────────────
    const chapters = store.listChapters(folioId);

    for (const chapter of chapters) {
      chapterCount++;
      const chapterDir = path.join(tmpDir, chapter.slug);
      fs.mkdirSync(chapterDir, { recursive: true });

      const pages = store.listPages(folioId, chapter.slug);

      for (const page of pages) {
        pageCount++;

        // Write <chapter>/<page>.md atomically
        const mdContent = renderPage(page);
        const mdPath    = path.join(chapterDir, `${page.slug}.md`);
        const mdTmp     = `${mdPath}.tmp`;
        fs.writeFileSync(mdTmp, mdContent, 'utf8');
        fs.renameSync(mdTmp, mdPath);

        // Write _attachments/<chapter>/<page>/<name>
        const attachments = store.listAttachments(folioId, page.id);
        if (attachments.length === 0) continue;

        const attDir = path.join(tmpDir, '_attachments', chapter.slug, page.slug);
        fs.mkdirSync(attDir, { recursive: true });

        const seenNames = new Set();
        for (const attMeta of attachments) {
          const att = store.getAttachment(folioId, attMeta.id);
          if (!att || !att.data) continue;

          const outName = uniqueAttachmentName(attMeta.name, seenNames);
          const attPath = path.join(attDir, outName);
          const attTmp  = `${attPath}.tmp`;
          const dataBuf = Buffer.isBuffer(att.data) ? att.data : Buffer.from(att.data);
          fs.writeFileSync(attTmp, dataBuf);
          fs.renameSync(attTmp, attPath);
          attachmentCount++;
        }
      }
    }

    // ── Atomic rename tmpDir → destDir ────────────────────────────────────
    if (fs.existsSync(resolvedDest)) {
      fs.rmSync(resolvedDest, { recursive: true, force: true });
    }
    fs.renameSync(tmpDir, resolvedDest);

  } catch (err) {
    // Clean up temp dir on any failure — never leave partial destDir
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    throw err;
  }

  console.warn(
    `[folio.archive] op=export folioId=${folioId} chapters=${chapterCount}` +
    ` pages=${pageCount} attachments=${attachmentCount} outcome=ok`,
  );

  return {
    dir:         resolvedDest,
    name:        folio.name,
    chapters:    chapterCount,
    pages:       pageCount,
    attachments: attachmentCount,
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Import a canonical markdown folder into the store, creating a new folio.
 * Security: every materialised path is resolved and asserted within srcDir.
 *
 * @param {object} store   — FolioService (or core store) providing:
 *                           createFolio, loadPage, addAttachment
 * @param {string} srcDir  — directory produced by exportToDir (or hand-crafted)
 * @param {{ name?: string }} [opts]
 * @returns {{ folioId: string, name: string, chapters: number, pages: number, attachments: number, skipped: string[] }}
 */
function importFromDir(store, srcDir, opts = {}) {
  const resolvedSrc = path.resolve(srcDir);

  if (!fs.existsSync(resolvedSrc)) {
    throw new Error(`Import source not found: "${srcDir}"`);
  }

  // ── Read manifest ──────────────────────────────────────────────────────────
  const manifestPath = path.join(resolvedSrc, 'folio.json');
  const manifest     = readManifest(manifestPath);
  const folioName    = (opts.name ?? manifest.name) || 'imported-folio';
  const folio        = store.createFolio({ name: folioName });

  let pageCount       = 0;
  let attachmentCount = 0;
  const chapterSlugs  = new Set();
  const skipped       = [];

  // ── Walk: <chapter>/<page>.md ─────────────────────────────────────────────
  let topEntries;
  try {
    topEntries = fs.readdirSync(resolvedSrc, { withFileTypes: true });
  } catch (e) {
    throw new Error(`Cannot read import directory: ${e.message}`);
  }

  for (const topEntry of topEntries) {
    // Only process chapter directories; skip files and special dirs
    if (!topEntry.isDirectory()) continue;
    if (topEntry.name.startsWith('_')) continue;

    const chapterSlug = topEntry.name;
    const chapterDir  = path.resolve(resolvedSrc, chapterSlug);

    // Security: chapter dir must be within srcDir
    try {
      assertWithinRoot(chapterDir, resolvedSrc);
    } catch (e) {
      skipped.push(`${chapterSlug}/ (traversal)`);
      continue;
    }

    let pageEntries;
    try {
      pageEntries = fs.readdirSync(chapterDir, { withFileTypes: true });
    } catch (e) {
      skipped.push(`${chapterSlug}/ (unreadable: ${e.message})`);
      continue;
    }

    for (const pageEntry of pageEntries) {
      if (!pageEntry.isFile() || !pageEntry.name.endsWith('.md')) continue;

      const pageSlug = pageEntry.name.slice(0, -3); // strip .md
      const mdPath   = path.resolve(chapterDir, pageEntry.name);

      // Security: mdPath must be within srcDir
      try {
        assertWithinRoot(mdPath, resolvedSrc);
      } catch (e) {
        skipped.push(`${chapterSlug}/${pageSlug} (traversal)`);
        continue;
      }

      // Parse page markdown
      let parsed;
      try {
        const raw = fs.readFileSync(mdPath, 'utf8');
        parsed    = parsePage({ chapterSlug, pageSlug, raw });
      } catch (e) {
        skipped.push(`${chapterSlug}/${pageSlug} (parse: ${e.message})`);
        continue;
      }

      // Insert via loadPage (preserves original id-less timestamps)
      let page;
      try {
        page = store.loadPage(folio.id, {
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
      } catch (e) {
        skipped.push(`${chapterSlug}/${pageSlug} (insert: ${e.message})`);
        continue;
      }

      chapterSlugs.add(chapterSlug);
      pageCount++;

      // ── Attachments: _attachments/<chapter>/<page>/* ──────────────────────
      const attDir = path.join(resolvedSrc, '_attachments', chapterSlug, pageSlug);
      if (!fs.existsSync(attDir)) continue;

      let attEntries;
      try {
        attEntries = fs.readdirSync(attDir, { withFileTypes: true });
      } catch (_) {
        continue;
      }

      for (const attEntry of attEntries) {
        if (!attEntry.isFile()) continue;
        const attPath = path.resolve(attDir, attEntry.name);

        // Security
        try {
          assertWithinRoot(attPath, resolvedSrc);
        } catch (e) {
          skipped.push(`_attachments/${chapterSlug}/${pageSlug}/${attEntry.name} (traversal)`);
          continue;
        }

        let data;
        try {
          data = fs.readFileSync(attPath);
        } catch (e) {
          skipped.push(
            `_attachments/${chapterSlug}/${pageSlug}/${attEntry.name} (read: ${e.message})`,
          );
          continue;
        }

        try {
          store.addAttachment(folio.id, page.id, {
            name:     attEntry.name,
            mimeType: inferMimeType(attEntry.name),
            data,
          });
          attachmentCount++;
        } catch (e) {
          skipped.push(
            `_attachments/${chapterSlug}/${pageSlug}/${attEntry.name} (store: ${e.message})`,
          );
        }
      }
    }
  }

  const chapterCount = chapterSlugs.size;

  console.warn(
    `[folio.archive] op=import folioId=${folio.id} chapters=${chapterCount}` +
    ` pages=${pageCount} attachments=${attachmentCount} skipped=${skipped.length}` +
    ` outcome=${skipped.length > 0 ? 'partial' : 'ok'}`,
  );

  return {
    folioId:     folio.id,
    name:        folio.name,
    chapters:    chapterCount,
    pages:       pageCount,
    attachments: attachmentCount,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  exportToDir,
  importFromDir,
  // Exported for testing
  inferMimeType,
  uniqueAttachmentName,
  assertWithinRoot,
};
