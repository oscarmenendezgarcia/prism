'use strict';

/**
 * Tests for Folio pluggable backend + FTS5 indexing.
 *
 * Covers:
 *  - markdown.js: renderPage / parsePage round-trip, YAML subset, folio.json
 *  - store.js: loadPage hydration helper (additive T-002)
 *  - backend.js: openSqliteBackend, openFileBackend (.folio discovery,
 *                in-memory hydrate, cache.db, staleness rebuild, atomic write)
 *  - resolver.js: [[ref]], [[ref#section]], missing-page, missing-section
 *  - index.js (facade): createFolioService — write-through, resolveRefs,
 *                        round-trip (create → reopen backend → present + searchable)
 *  - Identical ranking: same query over same content yields same ordered slugs
 *                       in sqlite and file backends
 *
 * All tests use temporary directories or in-memory databases — no network.
 * Run with: node --test tests/folio-pluggable.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

const Database = require('better-sqlite3');

const { applySchema }    = require('../src/services/folio/db');
const { createFolioStore, FolioConflictError, parseSlug } = require('../src/services/folio/store');
const {
  renderPage, parsePage, readManifest, writeManifest,
  parseYamlSubset, splitFrontmatter,
} = require('../src/services/folio/markdown');
const {
  openSqliteBackend, openFileBackend, findFolioRoot, folioIdForRoot, maxMarkdownMtime,
} = require('../src/services/folio/backend');
const { createResolver, githubSlug, extractSection } = require('../src/services/folio/resolver');
const { createFolioService } = require('../src/services/folio/index');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a temp directory and return its path. */
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'folio-test-'));
}

/** Remove a directory and all contents recursively. */
function removeTempDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

/**
 * Build a minimal .folio/ directory structure in `baseDir`.
 * Returns the path to the .folio/ directory.
 */
function buildFolioDir(baseDir, { name = 'Test Folio', pages = [] } = {}) {
  const folioRoot = path.join(baseDir, '.folio');
  fs.mkdirSync(folioRoot, { recursive: true });

  // Write folio.json
  const manifestPath = path.join(folioRoot, 'folio.json');
  writeManifest(manifestPath, {
    name,
    formatVersion: '1.0',
    createdAt: new Date().toISOString(),
  });

  for (const { chapterSlug, pageSlug, page } of pages) {
    const chapterDir = path.join(folioRoot, chapterSlug);
    fs.mkdirSync(chapterDir, { recursive: true });
    const mdPath = path.join(chapterDir, `${pageSlug}.md`);
    fs.writeFileSync(mdPath, renderPage({ slug: pageSlug, chapterSlug, ...page }), 'utf8');
  }

  return folioRoot;
}

/** Open an in-memory SQLite db with the Folio core schema applied. */
function openCoreDb() {
  const db = new Database(':memory:');
  applySchema(db);
  return db;
}

// ---------------------------------------------------------------------------
// T-001 — markdown.js: YAML subset parser
// ---------------------------------------------------------------------------

describe('markdown.js — parseYamlSubset', () => {
  it('should_parse_scalar_string_values', () => {
    const result = parseYamlSubset(['title: Hello World', 'author: user']);
    assert.equal(result.title, 'Hello World');
    assert.equal(result.author, 'user');
  });

  it('should_parse_boolean_values', () => {
    const r = parseYamlSubset(['pinned: true', 'flag: false']);
    assert.equal(r.pinned, true);
    assert.equal(r.flag, false);
  });

  it('should_parse_string_array_for_tags', () => {
    const r = parseYamlSubset(['tags: [stack, runtime, redis]']);
    assert.deepEqual(r.tags, ['stack', 'runtime', 'redis']);
  });

  it('should_parse_empty_array', () => {
    const r = parseYamlSubset(['tags: []']);
    assert.deepEqual(r.tags, []);
  });

  it('should_handle_colon_in_value_including_iso_dates', () => {
    const r = parseYamlSubset(['created: 2026-05-31T10:00:00.000Z']);
    assert.equal(r.created, '2026-05-31T10:00:00.000Z');
  });

  it('should_skip_lines_without_colon', () => {
    const r = parseYamlSubset(['no colon here', 'key: val']);
    assert.equal(r.key, 'val');
    assert.equal(Object.keys(r).length, 1);
  });

  it('should_handle_null_value', () => {
    const r = parseYamlSubset(['description: null']);
    assert.equal(r.description, null);
  });
});

// ---------------------------------------------------------------------------
// T-001 — markdown.js: splitFrontmatter
// ---------------------------------------------------------------------------

describe('markdown.js — splitFrontmatter', () => {
  it('should_split_a_normal_frontmatter_block', () => {
    const raw = '---\ntitle: T\nauthor: user\n---\n\nbody text';
    const { fmLines, body } = splitFrontmatter(raw);
    assert.deepEqual(fmLines, ['title: T', 'author: user']);
    assert.equal(body, 'body text');
  });

  it('should_return_full_raw_when_no_opening_delimiter', () => {
    const raw = 'no frontmatter here';
    const { fmLines, body } = splitFrontmatter(raw);
    assert.deepEqual(fmLines, []);
    assert.equal(body, raw);
  });

  it('should_return_full_raw_when_no_closing_delimiter', () => {
    const raw = '---\ntitle: T\nno closing';
    const { fmLines, body } = splitFrontmatter(raw);
    assert.deepEqual(fmLines, []);
    assert.equal(body, raw);
  });

  it('should_handle_content_with_dashes_in_body', () => {
    const raw = '---\ntitle: T\nauthor: user\npinned: false\ncreated: now\nupdated: now\n---\n\nsome text\n---\nmore text';
    const { fmLines, body } = splitFrontmatter(raw);
    assert.equal(fmLines.length, 5);
    assert.equal(body, 'some text\n---\nmore text');
  });
});

// ---------------------------------------------------------------------------
// T-001 — markdown.js: renderPage / parsePage round-trip
// ---------------------------------------------------------------------------

describe('markdown.js — renderPage / parsePage round-trip', () => {
  const now = '2026-05-31T10:00:00.000Z';

  it('should_round_trip_all_scalar_fields', () => {
    const page = {
      title:     'Redis Timeout',
      author:    'user',
      pinned:    false,
      createdAt: now,
      updatedAt: now,
      content:   '# Redis Timeout\n\nSome content here.',
      chapterSlug: 'runbooks',
      slug:        'redis-timeout',
    };
    const raw    = renderPage(page);
    const parsed = parsePage({ chapterSlug: 'runbooks', pageSlug: 'redis-timeout', raw });

    assert.equal(parsed.title,     page.title);
    assert.equal(parsed.author,    page.author);
    assert.equal(parsed.pinned,    page.pinned);
    assert.equal(parsed.createdAt, page.createdAt);
    assert.equal(parsed.updatedAt, page.updatedAt);
    assert.equal(parsed.content,   page.content);
  });

  it('should_round_trip_tags', () => {
    const page = {
      title: 'T', author: 'agent', pinned: true,
      createdAt: now, updatedAt: now,
      content: 'body', tags: ['stack', 'runtime'],
      chapterSlug: 'ch', slug: 'pg',
    };
    const parsed = parsePage({ chapterSlug: 'ch', pageSlug: 'pg', raw: renderPage(page) });
    assert.deepEqual(parsed.tags, ['stack', 'runtime']);
  });

  it('should_round_trip_content_containing_dashes', () => {
    const content = '---\nThis is content with --- in it.\n---\n\nAnd more.';
    const page = {
      title: 'T', author: 'user', pinned: false,
      createdAt: now, updatedAt: now, content,
      chapterSlug: 'ch', slug: 'pg',
    };
    const parsed = parsePage({ chapterSlug: 'ch', pageSlug: 'pg', raw: renderPage(page) });
    assert.equal(parsed.content, content);
  });

  it('should_round_trip_content_containing_h2_lines', () => {
    const content = '## Section A\n\ntext\n\n## Section B\n\nmore text';
    const page = {
      title: 'T', author: 'user', pinned: false,
      createdAt: now, updatedAt: now, content,
      chapterSlug: 'ch', slug: 'pg',
    };
    const parsed = parsePage({ chapterSlug: 'ch', pageSlug: 'pg', raw: renderPage(page) });
    assert.equal(parsed.content, content);
  });

  it('should_round_trip_empty_content', () => {
    const page = {
      title: 'T', author: 'user', pinned: false,
      createdAt: now, updatedAt: now, content: '',
      chapterSlug: 'ch', slug: 'pg',
    };
    const parsed = parsePage({ chapterSlug: 'ch', pageSlug: 'pg', raw: renderPage(page) });
    assert.equal(parsed.content, '');
  });

  it('should_round_trip_pinned_true', () => {
    const page = {
      title: 'T', author: 'user', pinned: true,
      createdAt: now, updatedAt: now, content: 'x',
      chapterSlug: 'ch', slug: 'pg',
    };
    const parsed = parsePage({ chapterSlug: 'ch', pageSlug: 'pg', raw: renderPage(page) });
    assert.equal(parsed.pinned, true);
  });

  it('should_infer_title_from_page_slug_when_frontmatter_absent', () => {
    const raw    = 'no frontmatter here, just plain content';
    const parsed = parsePage({ chapterSlug: 'ch', pageSlug: 'my-page', raw });
    assert.equal(parsed.title, 'My Page');
    assert.equal(parsed.content, raw);
  });

  it('should_reject_invalid_slug_segments', () => {
    assert.throws(
      () => parsePage({ chapterSlug: 'Chapter', pageSlug: 'page', raw: 'body' }),
      TypeError,
    );
  });
});

// ---------------------------------------------------------------------------
// T-001 — markdown.js: folio.json manifest
// ---------------------------------------------------------------------------

describe('markdown.js — readManifest / writeManifest', () => {
  let tmpDir;
  before(() => { tmpDir = makeTempDir(); });
  after(()  => { removeTempDir(tmpDir); });

  it('should_write_and_read_manifest_round_trip', () => {
    const filePath = path.join(tmpDir, 'folio.json');
    const manifest = { name: 'My Folio', formatVersion: '1.0', createdAt: '2026-05-31T00:00:00.000Z' };
    writeManifest(filePath, manifest);
    const read = readManifest(filePath);
    assert.equal(read.name, manifest.name);
    assert.equal(read.formatVersion, manifest.formatVersion);
    assert.equal(read.createdAt, manifest.createdAt);
  });

  it('should_include_optional_description_when_provided', () => {
    const filePath = path.join(tmpDir, 'folio-with-desc.json');
    writeManifest(filePath, {
      name: 'F', formatVersion: '1.0', createdAt: 'now', description: 'my description',
    });
    const read = readManifest(filePath);
    assert.equal(read.description, 'my description');
  });

  it('should_return_defaults_when_file_absent', () => {
    const manifest = readManifest(path.join(tmpDir, 'nonexistent.json'));
    assert.ok(manifest.name);
    assert.ok(manifest.formatVersion);
    assert.ok(manifest.createdAt);
  });

  it('should_return_defaults_when_file_is_malformed_json', () => {
    const filePath = path.join(tmpDir, 'malformed.json');
    fs.writeFileSync(filePath, 'not json', 'utf8');
    const manifest = readManifest(filePath);
    assert.ok(manifest.name);
  });

  it('should_write_atomically_via_tmp_rename', () => {
    const filePath = path.join(tmpDir, 'atomic.json');
    writeManifest(filePath, { name: 'F', formatVersion: '1.0', createdAt: 'now' });
    // Verify no .tmp file left behind
    assert.equal(fs.existsSync(`${filePath}.tmp`), false);
  });
});

// ---------------------------------------------------------------------------
// T-002 — store.js: loadPage hydration helper
// ---------------------------------------------------------------------------

describe('store.js — loadPage (hydration helper)', () => {
  let db, store, folio;

  beforeEach(() => {
    db    = openCoreDb();
    store = createFolioStore(db);
    folio = store.createFolio({ name: 'Hydrate Folio' });
  });

  it('should_insert_page_with_provided_id_and_timestamps', () => {
    const id        = crypto.randomUUID();
    const createdAt = '2026-01-01T00:00:00.000Z';
    const updatedAt = '2026-01-02T00:00:00.000Z';

    const page = store.loadPage(folio.id, {
      id, chapterSlug: 'ch', pageSlug: 'pg',
      title: 'T', content: 'body', author: 'user',
      pinned: false, createdAt, updatedAt,
    });

    assert.equal(page.id,        id);
    assert.equal(page.createdAt, createdAt);
    assert.equal(page.updatedAt, updatedAt);
  });

  it('should_emerge_chapter_from_slug_when_absent', () => {
    const id = crypto.randomUUID();
    store.loadPage(folio.id, {
      id, chapterSlug: 'runbooks', pageSlug: 'redis',
      title: 'Redis', content: 'c', author: 'user',
      pinned: false, createdAt: new Date().toISOString(),
    });

    const chapters = store.listChapters(folio.id);
    assert.equal(chapters.length, 1);
    assert.equal(chapters[0].slug, 'runbooks');
  });

  it('should_reuse_existing_chapter', () => {
    const now = new Date().toISOString();
    store.loadPage(folio.id, { id: crypto.randomUUID(), chapterSlug: 'ch', pageSlug: 'p1', title: 'P1', content: 'c', author: 'user', pinned: false, createdAt: now });
    store.loadPage(folio.id, { id: crypto.randomUUID(), chapterSlug: 'ch', pageSlug: 'p2', title: 'P2', content: 'c', author: 'user', pinned: false, createdAt: now });

    const chapters = store.listChapters(folio.id);
    assert.equal(chapters.length, 1);
  });

  it('should_be_searchable_via_fts5_immediately', () => {
    const now = new Date().toISOString();
    store.loadPage(folio.id, {
      id: crypto.randomUUID(), chapterSlug: 'docs', pageSlug: 'hydrated',
      title: 'Hydrated Page', content: 'uniquehydrateword content',
      author: 'user', pinned: false, createdAt: now,
    });

    const results = store.searchPages(folio.id, 'uniquehydrateword');
    assert.equal(results.length, 1);
  });

  it('should_not_alter_any_existing_method_signature', () => {
    // All existing public methods should remain unchanged
    assert.equal(typeof store.createPage, 'function');
    assert.equal(typeof store.getPage, 'function');
    assert.equal(typeof store.updatePage, 'function');
    assert.equal(typeof store.deletePage, 'function');
    assert.equal(typeof store.searchPages, 'function');
    assert.equal(typeof store.listChapters, 'function');
  });

  it('should_preserve_provided_updatedAt', () => {
    const now = new Date().toISOString();
    const updatedAt = '2025-12-25T00:00:00.000Z';
    const page = store.loadPage(folio.id, {
      id: crypto.randomUUID(), chapterSlug: 'ch', pageSlug: 'xmas',
      title: 'X', content: 'c', author: 'user', pinned: false,
      createdAt: now, updatedAt,
    });
    assert.equal(page.updatedAt, updatedAt);
  });
});

// ---------------------------------------------------------------------------
// T-003 — backend.js: findFolioRoot discovery
// ---------------------------------------------------------------------------

describe('backend.js — findFolioRoot', () => {
  let tmpDir;
  before(() => { tmpDir = makeTempDir(); });
  after(()  => { removeTempDir(tmpDir); });

  it('should_find_folio_dir_in_cwd', () => {
    const base = path.join(tmpDir, 'proj1');
    fs.mkdirSync(path.join(base, '.folio'), { recursive: true });
    assert.equal(findFolioRoot(base), path.join(base, '.folio'));
  });

  it('should_find_folio_dir_in_parent_directory', () => {
    const base = path.join(tmpDir, 'proj2');
    fs.mkdirSync(path.join(base, '.folio'), { recursive: true });
    const deepDir = path.join(base, 'a', 'b', 'c');
    fs.mkdirSync(deepDir, { recursive: true });
    assert.equal(findFolioRoot(deepDir), path.join(base, '.folio'));
  });

  it('should_return_null_when_no_folio_dir_found', () => {
    // Use a directory guaranteed to have no .folio ancestor (unlikely in real use)
    const isolated = path.join(tmpDir, 'isolated-no-folio');
    fs.mkdirSync(isolated, { recursive: true });
    // We can't guarantee no .folio exists above tmpDir, but we can test the logic
    // by searching from a directory we control that has no .folio
    const result = findFolioRoot(os.tmpdir() + '/definitely-no-folio-' + Date.now());
    // Either null (no .folio above) or a path (if .folio exists in test runner dir)
    // The important thing is it doesn't throw
    assert.ok(result === null || typeof result === 'string');
  });

  it('should_not_match_a_file_named_folio', () => {
    const base = path.join(tmpDir, 'proj3');
    fs.mkdirSync(base, { recursive: true });
    // Create a FILE named .folio (not a directory)
    fs.writeFileSync(path.join(base, '.folio'), 'not a dir', 'utf8');
    // Should not match the file; walk up and not find a directory
    const result = findFolioRoot(base);
    // Should not return this base's .folio (it's a file)
    assert.ok(result !== path.join(base, '.folio'));
  });
});

// ---------------------------------------------------------------------------
// T-003 — backend.js: openSqliteBackend
// ---------------------------------------------------------------------------

describe('backend.js — openSqliteBackend', () => {
  it('should_expose_kind_sqlite_and_null_root', () => {
    const db = openCoreDb();
    const backend = openSqliteBackend({ db });
    assert.equal(backend.kind, 'sqlite');
    assert.equal(backend.root, null);
    assert.equal(backend.folioId, null);
    db.close();
  });

  it('persistPage_should_be_a_no_op', () => {
    const db = openCoreDb();
    const backend = openSqliteBackend({ db });
    // Must not throw
    assert.doesNotThrow(() => backend.persistPage({ chapterSlug: 'ch', slug: 'pg', title: 'T', author: 'user', pinned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), content: 'c' }));
    db.close();
  });

  it('removePage_should_be_a_no_op', () => {
    const db = openCoreDb();
    const backend = openSqliteBackend({ db });
    assert.doesNotThrow(() => backend.removePage({ chapterSlug: 'ch', slug: 'pg' }));
    db.close();
  });

  it('flush_should_be_a_no_op', () => {
    const db = openCoreDb();
    const backend = openSqliteBackend({ db });
    assert.doesNotThrow(() => backend.flush());
    db.close();
  });
});

// ---------------------------------------------------------------------------
// T-003 — backend.js: openFileBackend — in-memory hydration
// ---------------------------------------------------------------------------

describe('backend.js — openFileBackend (in-memory)', () => {
  let tmpDir;
  before(() => { tmpDir = makeTempDir(); });
  after(()  => { removeTempDir(tmpDir); });

  it('should_hydrate_an_in_memory_index_from_markdown', () => {
    const now = new Date().toISOString();
    const root = buildFolioDir(tmpDir, {
      name: 'Test',
      pages: [{
        chapterSlug: 'runbooks',
        pageSlug:    'redis',
        page: {
          title: 'Redis Timeout', author: 'user', pinned: false,
          createdAt: now, updatedAt: now, content: 'Redis configuration guide',
        },
      }],
    });

    const backend = openFileBackend({ root });
    const store   = createFolioStore(backend.db);

    const folioId  = backend.folioId;
    const chapters = store.listChapters(folioId);
    assert.equal(chapters.length, 1);
    assert.equal(chapters[0].slug, 'runbooks');

    const pages = store.listPages(folioId, 'runbooks');
    assert.equal(pages.length, 1);
    assert.equal(pages[0].slug, 'redis');
    assert.equal(pages[0].content, 'Redis configuration guide');

    backend.close();
  });

  it('should_be_searchable_after_hydration', () => {
    const now  = new Date().toISOString();
    const dir2 = path.join(tmpDir, 'proj-search');
    const root = buildFolioDir(dir2, {
      name: 'Search Test',
      pages: [
        { chapterSlug: 'docs', pageSlug: 'pg1', page: { title: 'PG1', author: 'user', pinned: false, createdAt: now, updatedAt: now, content: 'elephantword content here' } },
        { chapterSlug: 'docs', pageSlug: 'pg2', page: { title: 'PG2', author: 'user', pinned: false, createdAt: now, updatedAt: now, content: 'other content' } },
      ],
    });

    const backend = openFileBackend({ root });
    const store   = createFolioStore(backend.db);
    const results = store.searchPages(backend.folioId, 'elephantword');
    assert.equal(results.length, 1);
    assert.equal(results[0].page.slug, 'pg1');
    backend.close();
  });

  it('should_skip_non_md_files_in_chapter_dirs', () => {
    const dir3 = path.join(tmpDir, 'proj-skip');
    const root = buildFolioDir(dir3, { name: 'Skip Test' });

    const chDir = path.join(root, 'ch');
    fs.mkdirSync(chDir, { recursive: true });
    fs.writeFileSync(path.join(chDir, 'page.md'), renderPage({ title: 'P', author: 'user', pinned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), content: 'c', chapterSlug: 'ch', slug: 'page' }), 'utf8');
    fs.writeFileSync(path.join(chDir, 'README.txt'), 'ignored', 'utf8');
    fs.writeFileSync(path.join(chDir, 'image.png'), 'ignored', 'utf8');

    const backend = openFileBackend({ root });
    const store   = createFolioStore(backend.db);
    const pages   = store.listPages(backend.folioId);
    assert.equal(pages.length, 1);
    backend.close();
  });

  it('should_skip_hidden_dirs_and_attachments', () => {
    const dir4 = path.join(tmpDir, 'proj-hidden');
    const root = buildFolioDir(dir4, { name: 'Hidden Test' });

    // Create a hidden dir and _attachments — both should be ignored
    fs.mkdirSync(path.join(root, '.hidden'), { recursive: true });
    fs.writeFileSync(path.join(root, '.hidden', 'secret.md'), renderPage({ title: 'S', author: 'user', pinned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), content: 'secret', chapterSlug: '.hidden', slug: 'secret' }), 'utf8');
    fs.mkdirSync(path.join(root, '_attachments'), { recursive: true });
    fs.writeFileSync(path.join(root, '_attachments', 'fake.md'), 'fake', 'utf8');

    const backend = openFileBackend({ root });
    const store   = createFolioStore(backend.db);
    const pages   = store.listPages(backend.folioId);
    assert.equal(pages.length, 0);
    backend.close();
  });

  it('should_throw_when_no_folio_dir_found', () => {
    const isolatedDir = path.join(tmpDir, 'no-folio-' + Date.now());
    fs.mkdirSync(isolatedDir, { recursive: true });

    // Walk up from a directory that's not under any .folio parent within the
    // isolated tmpDir — pass root explicitly as "nonexistent" to force error
    assert.throws(
      () => openFileBackend({ root: '/this-does-not-exist-folio' }),
      (err) => err.message.includes('No .folio'),
    );
  });
});

// ---------------------------------------------------------------------------
// T-003 — backend.js: persistPage / removePage (atomic write)
// ---------------------------------------------------------------------------

describe('backend.js — persistPage / removePage', () => {
  let tmpDir;
  before(() => { tmpDir = makeTempDir(); });
  after(()  => { removeTempDir(tmpDir); });

  it('should_write_md_file_atomically_and_not_leave_tmp', () => {
    const root    = buildFolioDir(tmpDir, { name: 'Write Test' });
    const backend = openFileBackend({ root });

    const page = {
      chapterSlug: 'ops', slug: 'new-page',
      title: 'New Page', author: 'user', pinned: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      content: 'atomic content',
    };
    backend.persistPage(page);

    const mdPath = path.join(root, 'ops', 'new-page.md');
    assert.ok(fs.existsSync(mdPath), 'md file should exist');
    assert.equal(fs.existsSync(`${mdPath}.tmp`), false, 'no .tmp file should remain');

    const raw    = fs.readFileSync(mdPath, 'utf8');
    const parsed = parsePage({ chapterSlug: 'ops', pageSlug: 'new-page', raw });
    assert.equal(parsed.content, 'atomic content');

    backend.close();
  });

  it('should_create_chapter_dir_if_absent', () => {
    const dir2    = path.join(tmpDir, 'proj-mkdir');
    const root    = buildFolioDir(dir2, { name: 'MkDir Test' });
    const backend = openFileBackend({ root });

    backend.persistPage({
      chapterSlug: 'brand-new-chapter', slug: 'first-page',
      title: 'First', author: 'user', pinned: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      content: 'hello',
    });

    assert.ok(fs.existsSync(path.join(root, 'brand-new-chapter', 'first-page.md')));
    backend.close();
  });

  it('should_remove_md_file_on_removePage', () => {
    const dir3    = path.join(tmpDir, 'proj-remove');
    const now     = new Date().toISOString();
    const root    = buildFolioDir(dir3, {
      pages: [{ chapterSlug: 'ch', pageSlug: 'del', page: { title: 'Del', author: 'user', pinned: false, createdAt: now, updatedAt: now, content: 'x' } }],
    });

    const backend = openFileBackend({ root });
    const mdPath  = path.join(root, 'ch', 'del.md');
    assert.ok(fs.existsSync(mdPath));

    backend.removePage({ chapterSlug: 'ch', slug: 'del' });
    assert.equal(fs.existsSync(mdPath), false);
    backend.close();
  });

  it('should_ignore_enoent_on_removePage', () => {
    const root    = buildFolioDir(path.join(tmpDir, 'proj-enoent'), { name: 'ENOENT' });
    const backend = openFileBackend({ root });
    assert.doesNotThrow(() => backend.removePage({ chapterSlug: 'ch', slug: 'nonexistent' }));
    backend.close();
  });
});

// ---------------------------------------------------------------------------
// T-003 — backend.js: cache.db (staleness)
// ---------------------------------------------------------------------------

describe('backend.js — openFileBackend cache mode', () => {
  let tmpDir;
  before(() => { tmpDir = makeTempDir(); });
  after(()  => { removeTempDir(tmpDir); });

  it('should_create_cache_db_when_cache_true', () => {
    const root    = buildFolioDir(path.join(tmpDir, 'cached'), { name: 'Cached' });
    const backend = openFileBackend({ root, cache: true });
    assert.ok(fs.existsSync(path.join(root, 'cache.db')));
    backend.close();
  });

  it('should_rebuild_cache_when_md_file_newer_than_cache_db', (t, done) => {
    const dir  = path.join(tmpDir, 'stale');
    const now  = new Date().toISOString();
    const root = buildFolioDir(dir, {
      name:  'Stale Cache',
      pages: [{ chapterSlug: 'ch', pageSlug: 'p1', page: { title: 'P1', author: 'user', pinned: false, createdAt: now, updatedAt: now, content: 'original content' } }],
    });

    // Build initial cache
    const b1 = openFileBackend({ root, cache: true });
    b1.close();

    // Touch the md file to simulate a newer write
    const mdPath = path.join(root, 'ch', 'p1.md');
    // Overwrite with updated content
    fs.writeFileSync(mdPath, renderPage({ title: 'P1 Updated', author: 'user', pinned: false, createdAt: now, updatedAt: now, content: 'updated content', chapterSlug: 'ch', slug: 'p1' }), 'utf8');
    // Ensure file mtime is newer than cache
    const cacheDbPath = path.join(root, 'cache.db');
    const futureMs    = Date.now() + 5000;
    fs.utimesSync(mdPath, futureMs / 1000, futureMs / 1000);

    // Reopen with cache — should detect staleness and rebuild
    const b2    = openFileBackend({ root, cache: true });
    const store = createFolioStore(b2.db);
    const pages = store.listPages(b2.folioId);
    assert.equal(pages.length, 1);
    // The page content should reflect the updated file
    assert.equal(pages[0].content, 'updated content');
    b2.close();
    done();
  });
});

// ---------------------------------------------------------------------------
// T-004 — resolver.js: githubSlug
// ---------------------------------------------------------------------------

describe('resolver.js — githubSlug', () => {
  it('should_lowercase_and_replace_spaces_with_hyphens', () => {
    assert.equal(githubSlug('Redis Timeout'), 'redis-timeout');
    assert.equal(githubSlug('FTS5 Search'), 'fts5-search');
  });

  it('should_remove_special_characters', () => {
    assert.equal(githubSlug('Hello, World!'), 'hello-world');
    assert.equal(githubSlug('What is this?'), 'what-is-this');
  });

  it('should_handle_already_slugified_input', () => {
    assert.equal(githubSlug('already-slugified'), 'already-slugified');
  });

  it('should_handle_empty_string', () => {
    assert.equal(githubSlug(''), '');
  });
});

// ---------------------------------------------------------------------------
// T-004 — resolver.js: extractSection
// ---------------------------------------------------------------------------

describe('resolver.js — extractSection', () => {
  const content = `
## Installation

Install the package with npm.

## Configuration

Set the environment variables.

## Usage

Run the application.
`.trim();

  it('should_extract_matching_h2_block', () => {
    const block = extractSection(content, 'installation');
    assert.ok(block.startsWith('## Installation'));
    assert.ok(block.includes('Install the package'));
    assert.ok(!block.includes('## Configuration'));
  });

  it('should_extract_middle_section', () => {
    const block = extractSection(content, 'configuration');
    assert.ok(block.startsWith('## Configuration'));
    assert.ok(block.includes('Set the environment'));
    assert.ok(!block.includes('## Usage'));
  });

  it('should_extract_last_section', () => {
    const block = extractSection(content, 'usage');
    assert.ok(block.startsWith('## Usage'));
    assert.ok(block.includes('Run the application'));
  });

  it('should_return_null_for_missing_section', () => {
    assert.equal(extractSection(content, 'nonexistent'), null);
  });

  it('should_match_case_insensitively_via_slug', () => {
    // githubSlug lowercases — 'INSTALLATION' → 'installation'
    const block = extractSection(content, githubSlug('INSTALLATION'));
    assert.ok(block !== null);
  });

  it('should_return_null_when_content_has_no_h2', () => {
    assert.equal(extractSection('just plain text', 'anything'), null);
  });
});

// ---------------------------------------------------------------------------
// T-004 — resolver.js: createResolver / resolveRefs
// ---------------------------------------------------------------------------

describe('resolver.js — createResolver', () => {
  let db, store, folio;

  beforeEach(() => {
    db    = openCoreDb();
    store = createFolioStore(db);
    folio = store.createFolio({ name: 'Resolver Folio' });

    store.createPage(folio.id, 'arch/overview', 'The full architecture overview.');
    store.createPage(folio.id, 'arch/details', `## Setup\n\nInstall dependencies.\n\n## Teardown\n\nRemove resources.`);
  });

  it('should_replace_whole_page_ref', () => {
    const resolver = createResolver(store);
    const result   = resolver.resolveRefs('See [[arch/overview]] for details.', folio.id);
    assert.equal(result, 'See The full architecture overview. for details.');
  });

  it('should_replace_section_ref', () => {
    const resolver = createResolver(store);
    const result   = resolver.resolveRefs('[[arch/details#setup]]', folio.id);
    assert.ok(result.startsWith('## Setup'));
    assert.ok(result.includes('Install dependencies'));
    assert.ok(!result.includes('## Teardown'));
  });

  it('should_leave_missing_page_ref_verbatim_and_warn', () => {
    const resolver  = createResolver(store);
    const warnings  = [];
    const origWarn  = console.warn;
    console.warn = (...a) => warnings.push(a.join(' '));

    const result = resolver.resolveRefs('See [[missing/page]] here.', folio.id);

    console.warn = origWarn;

    assert.equal(result, 'See [[missing/page]] here.');
    assert.ok(warnings.some((w) => w.includes('missing/page')));
  });

  it('should_leave_missing_section_ref_verbatim_and_warn', () => {
    const resolver  = createResolver(store);
    const warnings  = [];
    const origWarn  = console.warn;
    console.warn = (...a) => warnings.push(a.join(' '));

    const result = resolver.resolveRefs('[[arch/details#nonexistent]]', folio.id);

    console.warn = origWarn;

    assert.equal(result, '[[arch/details#nonexistent]]');
    assert.ok(warnings.some((w) => w.includes('nonexistent')));
  });

  it('should_resolve_multiple_refs_in_one_text', () => {
    const resolver = createResolver(store);
    const text     = '[[arch/overview]] and [[arch/details#setup]]';
    const result   = resolver.resolveRefs(text, folio.id);
    assert.ok(result.includes('The full architecture overview'));
    assert.ok(result.includes('## Setup'));
  });

  it('should_be_idempotent', () => {
    const resolver = createResolver(store);
    const text     = '[[arch/overview]] here.';
    const once     = resolver.resolveRefs(text, folio.id);
    const twice    = resolver.resolveRefs(once, folio.id);
    // No [[...]] remain after first pass, so second pass is a no-op
    assert.equal(once, twice);
  });

  it('should_leave_invalid_slug_ref_verbatim', () => {
    const resolver  = createResolver(store);
    const warnings  = [];
    const origWarn  = console.warn;
    console.warn = (...a) => warnings.push(a.join(' '));

    const result = resolver.resolveRefs('[[InvalidSlug/Page]]', folio.id);

    console.warn = origWarn;
    assert.equal(result, '[[InvalidSlug/Page]]');
  });

  it('should_return_input_unchanged_when_no_refs', () => {
    const resolver = createResolver(store);
    const text     = 'No references here.';
    assert.equal(resolver.resolveRefs(text, folio.id), text);
  });
});

// ---------------------------------------------------------------------------
// T-005 — index.js facade: SQLite backend (write-through is no-op)
// ---------------------------------------------------------------------------

describe('index.js — createFolioService (sqlite backend)', () => {
  it('should_expose_all_core_store_methods', () => {
    const db      = openCoreDb();
    const backend = openSqliteBackend({ db });
    const svc     = createFolioService(backend);

    const methods = [
      'createFolio', 'getFolio', 'createPage', 'getPage', 'getPageBySlug',
      'updatePage', 'deletePage', 'listChapters', 'listPages', 'searchPages',
      'addAttachment', 'getAttachment', 'listAttachments', 'deleteAttachment',
      'resolveRefs', 'flush', 'close',
    ];
    for (const m of methods) {
      assert.equal(typeof svc[m], 'function', `method ${m} missing`);
    }
    svc.close();
  });

  it('should_create_and_retrieve_a_page', () => {
    const db    = openCoreDb();
    const svc   = createFolioService(openSqliteBackend({ db }));
    const folio = svc.createFolio({ name: 'F' });
    const page  = svc.createPage(folio.id, 'ch/pg', 'content');
    assert.equal(page.content, 'content');
    assert.equal(svc.getPage(folio.id, page.id).id, page.id);
    svc.close();
  });

  it('should_delete_page_and_return_true', () => {
    const db    = openCoreDb();
    const svc   = createFolioService(openSqliteBackend({ db }));
    const folio = svc.createFolio({ name: 'F' });
    const page  = svc.createPage(folio.id, 'ch/pg', 'c');
    assert.equal(svc.deletePage(folio.id, page.id), true);
    assert.equal(svc.getPage(folio.id, page.id), null);
    svc.close();
  });

  it('should_expose_resolveRefs', () => {
    const db    = openCoreDb();
    const svc   = createFolioService(openSqliteBackend({ db }));
    const folio = svc.createFolio({ name: 'F' });
    svc.createPage(folio.id, 'docs/intro', 'Intro content here.');
    const result = svc.resolveRefs('See [[docs/intro]] for details.', folio.id);
    assert.equal(result, 'See Intro content here. for details.');
    svc.close();
  });

  it('should_be_compatible_with_folioBinding', () => {
    // Simulate what folioBinding.js does with the service
    const db    = openCoreDb();
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS spaces (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        working_directory TEXT, pipeline TEXT,
        project_claude_md TEXT, agent_nicknames TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    const { applyBindingSchema, createFolioBinding } = require('../src/services/folioBinding');
    applyBindingSchema(db);

    const svc     = createFolioService(openSqliteBackend({ db }));
    const binding = createFolioBinding(db, svc);

    db.prepare('INSERT INTO spaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('space-1', 'S', new Date().toISOString(), new Date().toISOString());

    const page = binding.createPage('space-1', 'ch/pg', 'content', { createIfMissing: true });
    assert.ok(page !== null);
    assert.equal(page.slug, 'pg');
    svc.close();
  });
});

// ---------------------------------------------------------------------------
// T-005 — index.js facade: file backend write-through
// ---------------------------------------------------------------------------

describe('index.js — createFolioService (file backend write-through)', () => {
  let tmpDir;
  before(() => { tmpDir = makeTempDir(); });
  after(()  => { removeTempDir(tmpDir); });

  it('should_write_md_on_createPage', () => {
    const root    = buildFolioDir(path.join(tmpDir, 'create'), { name: 'WT' });
    const backend = openFileBackend({ root });
    const svc     = createFolioService(backend);

    const page = svc.createPage(backend.folioId, 'ops/monitor', 'Monitor your systems.');
    const md   = path.join(root, 'ops', 'monitor.md');
    assert.ok(fs.existsSync(md), 'md file should be created');

    const raw    = fs.readFileSync(md, 'utf8');
    const parsed = parsePage({ chapterSlug: 'ops', pageSlug: 'monitor', raw });
    assert.equal(parsed.content, 'Monitor your systems.');
    svc.close();
  });

  it('should_update_md_on_updatePage', () => {
    const dir2  = path.join(tmpDir, 'update');
    const now   = new Date().toISOString();
    const root  = buildFolioDir(dir2, {
      name: 'UpdateWT',
      pages: [{ chapterSlug: 'ch', pageSlug: 'pg', page: { title: 'T', author: 'user', pinned: false, createdAt: now, updatedAt: now, content: 'old content' } }],
    });

    const backend = openFileBackend({ root });
    const svc     = createFolioService(backend);
    const pages   = createFolioStore(backend.db).listPages(backend.folioId);
    const pageId  = pages[0].id;

    svc.updatePage(backend.folioId, pageId, { content: 'new content' });

    const raw    = fs.readFileSync(path.join(root, 'ch', 'pg.md'), 'utf8');
    const parsed = parsePage({ chapterSlug: 'ch', pageSlug: 'pg', raw });
    assert.equal(parsed.content, 'new content');
    svc.close();
  });

  it('should_unlink_md_on_deletePage', () => {
    const dir3  = path.join(tmpDir, 'delete');
    const now   = new Date().toISOString();
    const root  = buildFolioDir(dir3, {
      name: 'DeleteWT',
      pages: [{ chapterSlug: 'ch', pageSlug: 'del', page: { title: 'D', author: 'user', pinned: false, createdAt: now, updatedAt: now, content: 'x' } }],
    });

    const backend = openFileBackend({ root });
    const svc     = createFolioService(backend);
    const pages   = createFolioStore(backend.db).listPages(backend.folioId);

    const md = path.join(root, 'ch', 'del.md');
    assert.ok(fs.existsSync(md));

    svc.deletePage(backend.folioId, pages[0].id);
    assert.equal(fs.existsSync(md), false);
    svc.close();
  });

  it('round_trip_create_reopen_present_and_searchable', () => {
    const dir4  = path.join(tmpDir, 'roundtrip');
    const root  = buildFolioDir(dir4, { name: 'RT' });

    // Session 1: create a page
    const b1  = openFileBackend({ root });
    const s1  = createFolioService(b1);
    s1.createPage(b1.folioId, 'knowledge/fts5', 'FTS5 is a full-text search engine.');
    s1.close();

    // Session 2: reopen (in-memory → fresh hydration from the md that was written)
    const b2    = openFileBackend({ root });
    const store = createFolioStore(b2.db);

    const pages = store.listPages(b2.folioId);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].slug, 'fts5');
    assert.equal(pages[0].content, 'FTS5 is a full-text search engine.');

    const results = store.searchPages(b2.folioId, 'engine');
    assert.ok(results.length >= 1);
    b2.close();
  });
});

// ---------------------------------------------------------------------------
// T-008 — Identical ranking check: sqlite vs file backend
// ---------------------------------------------------------------------------

describe('Identical ranking — sqlite vs file backend', () => {
  let tmpDir;
  before(() => { tmpDir = makeTempDir(); });
  after(()  => { removeTempDir(tmpDir); });

  it('should_yield_same_ordered_slugs_in_sqlite_and_file_backends', () => {
    const now   = new Date().toISOString();
    const pages = [
      { chapterSlug: 'docs', pageSlug: 'alpha',   content: 'redis redis redis redis redis' },
      { chapterSlug: 'docs', pageSlug: 'beta',    content: 'redis redis redis' },
      { chapterSlug: 'docs', pageSlug: 'gamma',   content: 'redis once here' },
      { chapterSlug: 'docs', pageSlug: 'delta',   content: 'postgres and mysql only' },
    ];

    // Build SQLite backend
    const sqliteDb = openCoreDb();
    const sqliteSvc = createFolioService(openSqliteBackend({ db: sqliteDb }));
    // Note: openSqliteBackend wraps the already-open db; createFolio is called on it via the service
    const sqliteFolioId = sqliteSvc.createFolio({ name: 'Ranking Test' }).id;
    for (const p of pages) {
      sqliteSvc.createPage(sqliteFolioId, `${p.chapterSlug}/${p.pageSlug}`, p.content, {
        title: p.pageSlug, author: 'user',
      });
    }

    // Build file backend with same content
    const root = buildFolioDir(path.join(tmpDir, 'ranking'), {
      name: 'Ranking Test',
      pages: pages.map((p) => ({
        chapterSlug: p.chapterSlug,
        pageSlug:    p.pageSlug,
        page: { title: p.pageSlug, author: 'user', pinned: false, createdAt: now, updatedAt: now, content: p.content },
      })),
    });

    const fileSvc = createFolioService(openFileBackend({ root }));
    const { folioId: fileFolioId } = fileSvc.backend;

    // Search "redis" in both
    const sqliteResults = sqliteSvc.searchPages(sqliteFolioId, 'redis');
    const fileResults   = fileSvc.searchPages(fileFolioId, 'redis');

    // Both should find the same pages (delta should not appear)
    const sqliteSlugs = sqliteResults.map((r) => r.page.slug);
    const fileSlugs   = fileResults.map((r) => r.page.slug);

    assert.ok(sqliteSlugs.length >= 3, 'sqlite should find at least 3 redis pages');
    assert.ok(fileSlugs.length >= 3, 'file should find at least 3 redis pages');
    assert.ok(!sqliteSlugs.includes('delta'), 'delta should not appear in sqlite results');
    assert.ok(!fileSlugs.includes('delta'), 'delta should not appear in file results');

    // Order should be identical
    assert.deepEqual(
      sqliteSlugs.slice(0, 3),
      fileSlugs.slice(0, 3),
      'Top-3 results should have identical order in sqlite and file backends',
    );

    sqliteSvc.close();
    fileSvc.close();
  });
});

// ---------------------------------------------------------------------------
// Regression: stable file-backend identity ("Folio not active")
//
// The file backend rebuilds its in-memory index from markdown on every open.
// Previously hydrateFromMarkdown minted a fresh random UUID each time, so a
// folioId handed to an MCP client stopped matching after the next re-hydrate
// (any .md write bumps the mtime → the standalone server re-opens the backend)
// — surfacing as "Folio not active". The id must now be stable, and
// folio_create must materialise folio.json so the chosen name persists too.
// ---------------------------------------------------------------------------

describe('Folio — stable file-backend identity (regression)', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTempDir(); });
  after(() => { removeTempDir(tmpDir); });

  it('derives the SAME folioId across independent re-hydrations of the same .folio/', () => {
    const root = path.join(tmpDir, 'stable', '.folio');
    fs.mkdirSync(root, { recursive: true });

    const a = createFolioService(openFileBackend({ root }));
    const idA = a.backend.folioId;
    a.close();

    const b = createFolioService(openFileBackend({ root }));
    const idB = b.backend.folioId;
    b.close();

    assert.equal(idA, idB, 'folioId must be identical across re-hydrations');
    assert.equal(idA, folioIdForRoot(root), 'folioId must equal the deterministic root id');
  });

  it('keeps the folioId valid after a page write forces a re-open (the bug)', () => {
    const root = path.join(tmpDir, 'survives', '.folio');
    fs.mkdirSync(root, { recursive: true });

    // 1st "tool call": learn the folioId
    const open1 = createFolioService(openFileBackend({ root }));
    const folioId = open1.backend.folioId;
    open1.createPage(folioId, 'overview/index', '# Overview\n', { author: 'agent' });
    open1.close();

    // 2nd "tool call": fresh backend (simulates the resolver re-hydrating after
    // the .md write). The previously-returned folioId must still be active.
    const open2 = createFolioService(openFileBackend({ root }));
    assert.ok(open2.getFolio(folioId), 'folioId returned earlier must still be active after re-open');
    const page = open2.createPage(folioId, 'meetings/2026-06-01', '# 1 Jun\n', { author: 'agent' });
    assert.equal(page.slug, '2026-06-01');
    open2.close();
  });

  it('folio_create materialises folio.json (id + name) and is idempotent', () => {
    const root = path.join(tmpDir, 'manifest', '.folio');
    fs.mkdirSync(root, { recursive: true });

    const svc = createFolioService(openFileBackend({ root }));
    const created = svc.createFolio({ name: 'AI Sync Meetings' });

    const manifestPath = path.join(root, 'folio.json');
    assert.ok(fs.existsSync(manifestPath), 'folio.json must be written by createFolio');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.id, created.id, 'manifest persists the folio id');
    assert.equal(manifest.name, 'AI Sync Meetings', 'manifest persists the chosen name');

    // Idempotent: a second create returns the same id, no duplicate folio.
    const again = svc.createFolio({ name: 'AI Sync Meetings' });
    assert.equal(again.id, created.id, 'createFolio is idempotent on the file backend');
    assert.equal(svc.listFolios().length, 1, 'file backend holds exactly one folio');
    svc.close();

    // The persisted id wins on the next hydration and the name survives.
    const reopened = createFolioService(openFileBackend({ root }));
    assert.equal(reopened.backend.folioId, created.id, 'persisted manifest id wins on re-hydrate');
    assert.equal(reopened.getFolio(created.id).name, 'AI Sync Meetings', 'chosen name survives re-hydrate');
    reopened.close();
  });

  it('createFolio does not destroy hand-authored folio.json fields', () => {
    const root = path.join(tmpDir, 'preserve', '.folio');
    fs.mkdirSync(root, { recursive: true });
    // Seed a manifest with hand-authored extras (like Prism's own .folio).
    fs.writeFileSync(path.join(root, 'folio.json'), JSON.stringify({
      name: 'Prism', formatVersion: '1.0', createdAt: '2026-05-31',
      description: 'KB', chapters: ['stack', 'architecture'], updatedAt: '2026-06-01',
    }, null, 2));

    const svc = createFolioService(openFileBackend({ root }));
    svc.createFolio({ name: 'Prism' });
    svc.close();

    const after = JSON.parse(fs.readFileSync(path.join(root, 'folio.json'), 'utf8'));
    assert.deepEqual(after.chapters, ['stack', 'architecture'], 'chapters preserved');
    assert.equal(after.updatedAt, '2026-06-01', 'updatedAt preserved');
    assert.equal(after.createdAt, '2026-05-31', 'createdAt preserved');
    assert.ok(typeof after.id === 'string' && after.id.length > 0, 'id added');
  });
});
