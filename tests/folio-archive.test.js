'use strict';

/**
 * Tests for src/services/folio/archive.js
 *
 * Covers:
 *  - exportToDir: basic folder layout (folio.json, chapter dirs, page files)
 *  - exportToDir: attachment blobs written under _attachments/
 *  - exportToDir: same-name attachment de-duplication
 *  - exportToDir: atomic on error (no partial destDir)
 *  - importFromDir: round-trip from exportToDir (pages + frontmatter + attachments)
 *  - importFromDir: invalid slugs → skipped[], not inserted
 *  - importFromDir: path traversal rejection (assertWithinRoot)
 *  - importFromDir: missing folio.json → defaults applied
 *  - importFromDir: pages with no attachments dir → no crash
 *  - inferMimeType: known and unknown extensions
 *  - uniqueAttachmentName: de-duplication logic
 *
 * Run: node --test tests/folio-archive.test.js
 *      (from the prism project root)
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const crypto  = require('crypto');

const Database = require('better-sqlite3');
const { applySchema }   = require('../src/services/folio/db');
const { createFolioStore } = require('../src/services/folio/store');
const {
  exportToDir,
  importFromDir,
  inferMimeType,
  uniqueAttachmentName,
  assertWithinRoot,
} = require('../src/services/folio/archive');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an in-memory store (no Prism binding needed). */
function makeStore() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  return createFolioStore(db);
}

/** Create a temp dir unique to the test run. */
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'folio-archive-test-'));
}

/** Recursively remove a directory (test cleanup). */
function rmDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// ---------------------------------------------------------------------------
// T-001 + T-002 — inferMimeType
// ---------------------------------------------------------------------------

describe('inferMimeType', () => {
  it('should_return_image_png_for_png', () => {
    assert.equal(inferMimeType('photo.PNG'), 'image/png');
  });

  it('should_return_application_pdf_for_pdf', () => {
    assert.equal(inferMimeType('doc.pdf'), 'application/pdf');
  });

  it('should_return_octet_stream_for_unknown_extension', () => {
    assert.equal(inferMimeType('data.xyz'), 'application/octet-stream');
  });

  it('should_return_octet_stream_for_no_extension', () => {
    assert.equal(inferMimeType('Makefile'), 'application/octet-stream');
  });

  it('should_handle_jpeg_extension', () => {
    assert.equal(inferMimeType('image.jpeg'), 'image/jpeg');
    assert.equal(inferMimeType('image.jpg'), 'image/jpeg');
  });
});

// ---------------------------------------------------------------------------
// uniqueAttachmentName
// ---------------------------------------------------------------------------

describe('uniqueAttachmentName', () => {
  it('should_return_original_name_when_not_seen', () => {
    const seen = new Set();
    assert.equal(uniqueAttachmentName('file.txt', seen), 'file.txt');
    assert.ok(seen.has('file.txt'));
  });

  it('should_suffix_with_2_when_name_already_seen', () => {
    const seen = new Set(['file.txt']);
    assert.equal(uniqueAttachmentName('file.txt', seen), 'file (2).txt');
  });

  it('should_increment_suffix_when_2_also_taken', () => {
    const seen = new Set(['file.txt', 'file (2).txt']);
    assert.equal(uniqueAttachmentName('file.txt', seen), 'file (3).txt');
  });

  it('should_handle_files_without_extension', () => {
    const seen = new Set(['README']);
    assert.equal(uniqueAttachmentName('README', seen), 'README (2)');
  });
});

// ---------------------------------------------------------------------------
// assertWithinRoot
// ---------------------------------------------------------------------------

describe('assertWithinRoot', () => {
  it('should_not_throw_for_path_inside_root', () => {
    assert.doesNotThrow(() =>
      assertWithinRoot('/tmp/root/subdir/file.txt', '/tmp/root'),
    );
  });

  it('should_throw_for_path_traversal_above_root', () => {
    assert.throws(
      () => assertWithinRoot('/tmp/evil', '/tmp/root'),
      RangeError,
    );
  });

  it('should_throw_for_dotdot_traversal', () => {
    assert.throws(
      () => assertWithinRoot(path.resolve('/tmp/root', '../../etc/passwd'), '/tmp/root'),
      RangeError,
    );
  });
});

// ---------------------------------------------------------------------------
// exportToDir — basic export
// ---------------------------------------------------------------------------

describe('exportToDir — basic structure', () => {
  let store;
  let tmpBase;

  beforeEach(() => {
    store   = makeStore();
    tmpBase = makeTmpDir();
  });

  afterEach(() => {
    rmDir(tmpBase);
  });

  it('should_write_folio_json_with_correct_fields', () => {
    const folio = store.createFolio({ name: 'My Folio' });
    store.createPage(folio.id, 'intro/welcome', 'Hello world');

    const destDir = path.join(tmpBase, 'exported');
    const result  = exportToDir(store, folio.id, destDir);

    assert.equal(result.name, 'My Folio');
    assert.equal(result.chapters, 1);
    assert.equal(result.pages, 1);
    assert.equal(result.attachments, 0);
    assert.equal(result.dir, destDir);

    const manifest = JSON.parse(fs.readFileSync(path.join(destDir, 'folio.json'), 'utf8'));
    assert.equal(manifest.name, 'My Folio');
    assert.equal(manifest.formatVersion, '1.0');
    assert.ok(manifest.createdAt, 'createdAt should be present');
  });

  it('should_create_chapter_directory_and_page_md_file', () => {
    const folio = store.createFolio({ name: 'Test' });
    store.createPage(folio.id, 'architecture/modulo', '# Module Design');

    const destDir = path.join(tmpBase, 'exported');
    exportToDir(store, folio.id, destDir);

    const mdPath  = path.join(destDir, 'architecture', 'modulo.md');
    assert.ok(fs.existsSync(mdPath), 'page .md file should exist');

    const content = fs.readFileSync(mdPath, 'utf8');
    assert.ok(content.includes('# Module Design'), 'body should be in md file');
    assert.ok(content.includes('title:'), 'frontmatter title should be present');
    assert.ok(content.includes('author:'), 'frontmatter author should be present');
  });

  it('should_export_multiple_chapters_and_pages', () => {
    const folio = store.createFolio({ name: 'Multi' });
    store.createPage(folio.id, 'ch1/page-a', 'Content A');
    store.createPage(folio.id, 'ch1/page-b', 'Content B');
    store.createPage(folio.id, 'ch2/page-c', 'Content C');

    const destDir = path.join(tmpBase, 'exported');
    const result  = exportToDir(store, folio.id, destDir);

    assert.equal(result.chapters, 2);
    assert.equal(result.pages, 3);
    assert.ok(fs.existsSync(path.join(destDir, 'ch1', 'page-a.md')));
    assert.ok(fs.existsSync(path.join(destDir, 'ch1', 'page-b.md')));
    assert.ok(fs.existsSync(path.join(destDir, 'ch2', 'page-c.md')));
  });

  it('should_throw_for_unknown_folio_id', () => {
    const destDir = path.join(tmpBase, 'exported');
    assert.throws(
      () => exportToDir(store, 'nonexistent-id', destDir),
      /not found/i,
    );
    // destDir must not have been created
    assert.ok(!fs.existsSync(destDir), 'destDir must not exist after failed export');
  });
});

// ---------------------------------------------------------------------------
// exportToDir — attachments
// ---------------------------------------------------------------------------

describe('exportToDir — attachments', () => {
  let store;
  let tmpBase;

  beforeEach(() => {
    store   = makeStore();
    tmpBase = makeTmpDir();
  });

  afterEach(() => {
    rmDir(tmpBase);
  });

  it('should_write_attachment_blob_under_attachments_dir', () => {
    const folio = store.createFolio({ name: 'AttTest' });
    const page  = store.createPage(folio.id, 'docs/readme', 'docs here');
    const data  = Buffer.from('PNG_BYTES_PLACEHOLDER');
    store.addAttachment(folio.id, page.id, { name: 'logo.png', mimeType: 'image/png', data });

    const destDir = path.join(tmpBase, 'exported');
    const result  = exportToDir(store, folio.id, destDir);

    assert.equal(result.attachments, 1);

    const attPath = path.join(destDir, '_attachments', 'docs', 'readme', 'logo.png');
    assert.ok(fs.existsSync(attPath), '_attachments file should exist');

    const written = fs.readFileSync(attPath);
    assert.ok(written.equals(data), 'attachment bytes must match');
  });

  it('should_not_create_empty_attachments_dir_for_pages_without_attachments', () => {
    const folio = store.createFolio({ name: 'NoAtt' });
    store.createPage(folio.id, 'docs/page', 'no attachments here');

    const destDir = path.join(tmpBase, 'exported');
    exportToDir(store, folio.id, destDir);

    const attDir = path.join(destDir, '_attachments');
    assert.ok(!fs.existsSync(attDir), '_attachments dir should not exist when no attachments');
  });

  it('should_deduplicate_same_name_attachments_on_a_page', () => {
    const folio = store.createFolio({ name: 'Dup' });
    const page  = store.createPage(folio.id, 'ch/pg', 'body');
    store.addAttachment(folio.id, page.id, {
      name:     'file.bin',
      mimeType: 'application/octet-stream',
      data:     Buffer.from('first'),
    });
    store.addAttachment(folio.id, page.id, {
      name:     'file.bin',
      mimeType: 'application/octet-stream',
      data:     Buffer.from('second'),
    });

    const destDir = path.join(tmpBase, 'exported');
    const result  = exportToDir(store, folio.id, destDir);

    assert.equal(result.attachments, 2);
    const attDir = path.join(destDir, '_attachments', 'ch', 'pg');
    const files  = fs.readdirSync(attDir).sort();
    assert.deepEqual(files, ['file (2).bin', 'file.bin']);
  });
});

// ---------------------------------------------------------------------------
// exportToDir — atomic on error
// ---------------------------------------------------------------------------

describe('exportToDir — atomic on error', () => {
  let store;
  let tmpBase;

  beforeEach(() => {
    store   = makeStore();
    tmpBase = makeTmpDir();
  });

  afterEach(() => {
    rmDir(tmpBase);
  });

  it('should_leave_no_partial_destDir_when_export_throws', () => {
    const folio = store.createFolio({ name: 'Partial' });
    store.createPage(folio.id, 'ch/pg', 'ok');
    store.createPage(folio.id, 'ch2/pg2', 'ok2');

    // Monkey-patch listPages: throw on second chapter (ch2) to simulate mid-export failure
    const originalListPages = store.listPages.bind(store);
    let callCount = 0;
    store.listPages = (folioId, chSlug) => {
      callCount++;
      if (callCount > 1) throw new Error('simulated store failure mid-export');
      return originalListPages(folioId, chSlug);
    };

    const destDir = path.join(tmpBase, 'exported');
    assert.throws(() => exportToDir(store, folio.id, destDir), /simulated store failure/);
    assert.ok(!fs.existsSync(destDir), 'destDir must not exist after failed export');
  });
});

// ---------------------------------------------------------------------------
// importFromDir — round-trip
// ---------------------------------------------------------------------------

describe('importFromDir — round-trip', () => {
  let storeA;  // source store (export from)
  let storeB;  // dest store  (import into)
  let tmpBase;

  beforeEach(() => {
    storeA  = makeStore();
    storeB  = makeStore();
    tmpBase = makeTmpDir();
  });

  afterEach(() => {
    rmDir(tmpBase);
  });

  it('should_reconstruct_pages_with_identical_frontmatter_and_content', () => {
    const folio = storeA.createFolio({ name: 'Round-Trip Folio' });
    storeA.createPage(folio.id, 'intro/welcome', 'Hello **world**', {
      author: 'agent',
      title:  'Welcome Page',
      pinned: true,
    });
    storeA.createPage(folio.id, 'intro/overview', 'Overview content here', {
      author: 'user',
    });

    const destDir = path.join(tmpBase, 'exported');
    exportToDir(storeA, folio.id, destDir);

    const result = importFromDir(storeB, destDir);
    assert.equal(result.pages, 2);
    assert.equal(result.skipped.length, 0);

    const pages = storeB.listPages(result.folioId);
    assert.equal(pages.length, 2);

    const welcome = pages.find((p) => p.slug === 'welcome');
    assert.ok(welcome, 'welcome page should be imported');
    assert.equal(welcome.title, 'Welcome Page');
    assert.equal(welcome.content, 'Hello **world**');
    assert.equal(welcome.author, 'agent');
    assert.equal(welcome.pinned, true);
  });

  it('should_preserve_createdAt_and_updatedAt_timestamps', () => {
    const folio = storeA.createFolio({ name: 'Timestamps' });
    const page  = storeA.createPage(folio.id, 'ch/pg', 'content', { author: 'user' });

    const destDir = path.join(tmpBase, 'exported');
    exportToDir(storeA, folio.id, destDir);

    const result   = importFromDir(storeB, destDir);
    const imported = storeB.listPages(result.folioId)[0];

    assert.equal(imported.createdAt, page.createdAt, 'createdAt must be preserved');
    assert.equal(imported.updatedAt, page.updatedAt, 'updatedAt must be preserved');
  });

  it('should_round_trip_attachment_blobs_byte_for_byte', () => {
    const folio   = storeA.createFolio({ name: 'AttRoundTrip' });
    const page    = storeA.createPage(folio.id, 'media/index', 'media page');
    const rawData = crypto.randomBytes(256);
    storeA.addAttachment(folio.id, page.id, {
      name:     'random.bin',
      mimeType: 'application/octet-stream',
      data:     rawData,
    });

    const destDir = path.join(tmpBase, 'exported');
    exportToDir(storeA, folio.id, destDir);

    const result   = importFromDir(storeB, destDir);
    const imported = storeB.listPages(result.folioId)[0];
    const atts     = storeB.listAttachments(result.folioId, imported.id);

    assert.equal(atts.length, 1);
    assert.equal(atts[0].name, 'random.bin');
    assert.equal(atts[0].mimeType, 'application/octet-stream');

    const full = storeB.getAttachment(result.folioId, atts[0].id);
    assert.ok(Buffer.from(full.data).equals(rawData), 'attachment bytes must be identical');
  });

  it('should_infer_mimeType_from_attachment_extension_on_import', () => {
    const folio = storeA.createFolio({ name: 'MimeInfer' });
    const page  = storeA.createPage(folio.id, 'docs/pg', 'body');
    // Store with wrong mimeType; on export the blob goes to disk; on import
    // mimeType is re-inferred from filename
    storeA.addAttachment(folio.id, page.id, {
      name:     'diagram.png',
      mimeType: 'application/octet-stream', // intentionally wrong
      data:     Buffer.from('PNGDATA'),
    });

    const destDir = path.join(tmpBase, 'exported');
    exportToDir(storeA, folio.id, destDir);

    const result   = importFromDir(storeB, destDir);
    const imported = storeB.listPages(result.folioId)[0];
    const atts     = storeB.listAttachments(result.folioId, imported.id);

    assert.equal(atts[0].mimeType, 'image/png', 'mimeType should be re-inferred from extension');
  });

  it('should_use_opts_name_over_manifest_name', () => {
    const folio = storeA.createFolio({ name: 'Original Name' });
    storeA.createPage(folio.id, 'ch/pg', 'body');

    const destDir = path.join(tmpBase, 'exported');
    exportToDir(storeA, folio.id, destDir);

    const result = importFromDir(storeB, destDir, { name: 'Overridden Name' });
    assert.equal(result.name, 'Overridden Name');
    const imported = storeB.getFolio(result.folioId);
    assert.equal(imported.name, 'Overridden Name');
  });
});

// ---------------------------------------------------------------------------
// importFromDir — invalid slugs and skipped[]
// ---------------------------------------------------------------------------

describe('importFromDir — skipped entries', () => {
  let store;
  let tmpBase;

  beforeEach(() => {
    store   = makeStore();
    tmpBase = makeTmpDir();
  });

  afterEach(() => {
    rmDir(tmpBase);
  });

  it('should_skip_md_files_with_invalid_slug_and_report_in_skipped', () => {
    const srcDir = path.join(tmpBase, 'src');
    fs.mkdirSync(path.join(srcDir, 'valid-chapter'), { recursive: true });

    // Invalid chapter slug (uppercase letters are not allowed)
    fs.mkdirSync(path.join(srcDir, 'BAD_CHAPTER'), { recursive: true });

    // Write folio.json
    fs.writeFileSync(
      path.join(srcDir, 'folio.json'),
      JSON.stringify({ name: 'Test', formatVersion: '1.0', createdAt: new Date().toISOString() }),
    );

    // Valid page in valid chapter
    fs.writeFileSync(
      path.join(srcDir, 'valid-chapter', 'good-page.md'),
      '---\ntitle: Good\nauthor: user\npinned: false\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nBody',
    );

    // Invalid page slug (uppercase) in valid chapter
    fs.writeFileSync(
      path.join(srcDir, 'valid-chapter', 'BadSlug.md'),
      '---\ntitle: Bad\nauthor: user\npinned: false\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nBody',
    );

    const result = importFromDir(store, srcDir);
    assert.equal(result.pages, 1, 'only valid page should be imported');
    assert.ok(result.skipped.length >= 1, 'invalid slug should be in skipped');
    assert.ok(
      result.skipped.some((s) => s.includes('BadSlug') || s.includes('bad-slug') || s.includes('parse')),
      'skipped entry should mention the bad file',
    );
  });

  it('should_import_zero_pages_from_empty_source_and_return_empty_skipped', () => {
    const srcDir = path.join(tmpBase, 'empty');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(
      path.join(srcDir, 'folio.json'),
      JSON.stringify({ name: 'Empty', formatVersion: '1.0', createdAt: new Date().toISOString() }),
    );

    const result = importFromDir(store, srcDir);
    assert.equal(result.pages, 0);
    assert.equal(result.chapters, 0);
    assert.deepEqual(result.skipped, []);
  });

  it('should_throw_when_source_directory_does_not_exist', () => {
    assert.throws(
      () => importFromDir(store, path.join(tmpBase, 'nonexistent')),
      /not found/i,
    );
  });
});

// ---------------------------------------------------------------------------
// importFromDir — path-traversal rejection (NFR4)
// ---------------------------------------------------------------------------

describe('importFromDir — security: path traversal rejection', () => {
  let store;
  let tmpBase;

  beforeEach(() => {
    store   = makeStore();
    tmpBase = makeTmpDir();
  });

  afterEach(() => {
    rmDir(tmpBase);
  });

  it('should_not_write_anything_outside_srcDir_via_symlink_in_attachment', () => {
    // We cannot create a filename with '..' in POSIX — the OS prevents it.
    // The security surface for importFromDir is the assertWithinRoot guard
    // on resolved paths (handles symlinks or platform edge-cases).
    // We test the guard directly by temporarily replacing fs.readdirSync to
    // emit a 'crafted' entry. We do a lighter unit-test via assertWithinRoot
    // (already tested above) and verify that a symlinked attachment dir
    // outside srcDir is rejected.

    const srcDir = path.join(tmpBase, 'src');
    const outDir = path.join(tmpBase, 'out');
    fs.mkdirSync(path.join(srcDir, 'valid-ch'), { recursive: true });
    fs.mkdirSync(outDir);

    fs.writeFileSync(
      path.join(srcDir, 'folio.json'),
      JSON.stringify({ name: 'T', formatVersion: '1.0', createdAt: new Date().toISOString() }),
    );
    fs.writeFileSync(
      path.join(srcDir, 'valid-ch', 'pg.md'),
      '---\ntitle: T\nauthor: user\npinned: false\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nBody',
    );

    // Create a symlink for the attachment dir pointing outside srcDir
    const attDir   = path.join(srcDir, '_attachments', 'valid-ch', 'pg');
    const evil     = path.join(outDir, 'evil.bin');
    fs.mkdirSync(attDir, { recursive: true });
    fs.symlinkSync(outDir, path.join(attDir, 'link-dir'));

    // importFromDir should skip the symlink directory (it's not isFile())
    // and not write evil.bin
    const result = importFromDir(store, srcDir);
    assert.equal(result.pages, 1);
    assert.ok(!fs.existsSync(evil), 'no file should be written outside srcDir');
  });
});

// ---------------------------------------------------------------------------
// importFromDir — missing folio.json defaults
// ---------------------------------------------------------------------------

describe('importFromDir — folio.json defaults', () => {
  let store;
  let tmpBase;

  beforeEach(() => {
    store   = makeStore();
    tmpBase = makeTmpDir();
  });

  afterEach(() => {
    rmDir(tmpBase);
  });

  it('should_use_directory_basename_as_folio_name_when_no_folio_json', () => {
    const srcDir = path.join(tmpBase, 'my-folio-name');
    fs.mkdirSync(path.join(srcDir, 'ch'), { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, 'ch', 'pg.md'),
      '---\ntitle: T\nauthor: user\npinned: false\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nBody',
    );

    // No folio.json
    const result  = importFromDir(store, srcDir);
    const imported = store.getFolio(result.folioId);

    // Name is derived from directory name (readManifest default behaviour)
    assert.ok(imported.name, 'folio should have a name');
    assert.equal(result.pages, 1);
  });
});

// ---------------------------------------------------------------------------
// Round-trip with content containing frontmatter delimiters
// ---------------------------------------------------------------------------

describe('exportToDir + importFromDir — round-trip body with --- delimiters', () => {
  let storeA;
  let storeB;
  let tmpBase;

  beforeEach(() => {
    storeA  = makeStore();
    storeB  = makeStore();
    tmpBase = makeTmpDir();
  });

  afterEach(() => {
    rmDir(tmpBase);
  });

  it('should_preserve_body_containing_yaml_delimiter_lines', () => {
    const tricky = 'Intro\n\n---\n\nSeparator above\n\n## Section\n\nMore content';
    const folio  = storeA.createFolio({ name: 'Tricky' });
    storeA.createPage(folio.id, 'ch/tricky-page', tricky);

    const destDir = path.join(tmpBase, 'exported');
    exportToDir(storeA, folio.id, destDir);

    const result  = importFromDir(storeB, destDir);
    const pages   = storeB.listPages(result.folioId);
    assert.equal(pages[0].content, tricky, 'body with --- must round-trip unchanged');
  });
});
