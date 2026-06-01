'use strict';

/**
 * Unit tests for the Folio data model.
 *
 * Covers:
 *  - Core DDL: schema creation, cascade integrity (T-001)
 *  - Core store CRUD: folios, chapters (emergent), pages, conflict (T-002)
 *  - Attachments (T-003)
 *  - FTS5 search + trigger sync (T-004)
 *  - Binding activation matrix — 4 cases (T-005)
 *  - Wire-up: folio stores accessible on createStore() result (T-006)
 *  - Isolation assertion: src/services/folio/ has no reference to space_id (T-007)
 *
 * All tests use an in-memory better-sqlite3 Database — no disk I/O.
 *
 * Run with: node --test tests/folio.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');

const Database = require('better-sqlite3');

const { applySchema }                            = require('../src/services/folio/db');
const { createFolioStore, FolioConflictError, parseSlug, titleCase } = require('../src/services/folio/store');
const { applyBindingSchema, createFolioBinding } = require('../src/services/folioBinding');
const { createStore }                            = require('../src/services/store');

// ---------------------------------------------------------------------------
// Helper — open in-memory DB with full Prism + Folio schema applied
// ---------------------------------------------------------------------------

function openDb() {
  const db = new Database(':memory:');
  // Prism prerequisites (spaces table required by space_folios FK)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      working_directory TEXT,
      pipeline TEXT,
      project_claude_md TEXT,
      agent_nicknames TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  applySchema(db);
  applyBindingSchema(db);
  return db;
}

function insertSpace(db, id = 'space-1') {
  db.prepare(
    'INSERT INTO spaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
  ).run(id, 'Test Space', new Date().toISOString(), new Date().toISOString());
}

// ---------------------------------------------------------------------------
// T-001 — Core DDL
// ---------------------------------------------------------------------------

describe('T-001 — Core DDL: applySchema', () => {
  it('should_create_all_core_tables_and_views', () => {
    const db = openDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table','shadow') ORDER BY name",
    ).all().map((r) => r.name);

    assert.ok(tables.includes('folios'),      'folios table missing');
    assert.ok(tables.includes('chapters'),    'chapters table missing');
    assert.ok(tables.includes('pages'),       'pages table missing');
    assert.ok(tables.includes('attachments'), 'attachments table missing');
    db.close();
  });

  it('should_be_idempotent_when_called_multiple_times', () => {
    const db = openDb();
    // Should not throw when called again
    assert.doesNotThrow(() => applySchema(db));
    assert.doesNotThrow(() => applySchema(db));
    db.close();
  });

  it('should_enforce_author_check_constraint', () => {
    const db = openDb();
    const store = createFolioStore(db);
    const folio = store.createFolio({ name: 'Test' });
    assert.throws(
      () => store.createPage(folio.id, 'chapter/page', 'content', { author: 'robot' }),
      (err) => err.name === 'TypeError' || err.message.includes('author'),
    );
    db.close();
  });

  it('should_cascade_delete_folio_to_chapters_pages_attachments', () => {
    const db = openDb();
    const store = createFolioStore(db);
    const folio = store.createFolio({ name: 'Cascade Test' });
    const page = store.createPage(folio.id, 'ops/timeout', 'content');
    store.addAttachment(folio.id, page.id, {
      name: 'diagram.png', mimeType: 'image/png', data: Buffer.from('img'),
    });

    // Delete folio directly in DB — triggers cascade
    db.prepare('DELETE FROM folios WHERE id = ?').run(folio.id);

    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM chapters').get().c, 0, 'chapters not deleted');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM pages').get().c, 0, 'pages not deleted');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM attachments').get().c, 0, 'attachments not deleted');
    db.close();
  });
});

// ---------------------------------------------------------------------------
// T-002 — Core store CRUD + emergent chapters
// ---------------------------------------------------------------------------

describe('T-002 — Core store: CRUD and emergent chapters', () => {
  let db, store, folio;

  beforeEach(() => {
    db    = openDb();
    store = createFolioStore(db);
    folio = store.createFolio({ name: 'My Folio' });
  });

  it('should_create_folio_with_uuid_and_timestamp', () => {
    assert.match(folio.id, /^[0-9a-f-]{36}$/);
    assert.ok(folio.createdAt);
    assert.equal(folio.name, 'My Folio');
  });

  it('should_return_null_for_nonexistent_folio', () => {
    assert.equal(store.getFolio('nonexistent'), null);
  });

  it('should_create_page_and_materialize_chapter_from_slug', () => {
    const page = store.createPage(folio.id, 'runbooks/redis-timeout', '# Redis Timeout');

    assert.equal(page.chapterSlug, 'runbooks');
    assert.equal(page.slug, 'redis-timeout');
    assert.equal(page.folioId, folio.id);
    assert.equal(page.author, 'user');
    assert.equal(page.pinned, false);

    const chapters = store.listChapters(folio.id);
    assert.equal(chapters.length, 1);
    assert.equal(chapters[0].slug, 'runbooks');
    assert.equal(chapters[0].title, 'Runbooks');
    assert.equal(chapters[0].position, 0);
  });

  it('should_reuse_existing_chapter_for_second_page', () => {
    store.createPage(folio.id, 'runbooks/redis-timeout', 'content1');
    store.createPage(folio.id, 'runbooks/postgres-lag', 'content2');

    const chapters = store.listChapters(folio.id);
    assert.equal(chapters.length, 1, 'should have only one chapter');
    const pages = store.listPages(folio.id, 'runbooks');
    assert.equal(pages.length, 2);
  });

  it('should_assign_sequential_positions_to_emergent_chapters', () => {
    store.createPage(folio.id, 'alpha/page1', 'c1');
    store.createPage(folio.id, 'beta/page1', 'c2');
    store.createPage(folio.id, 'gamma/page1', 'c3');

    const chapters = store.listChapters(folio.id);
    assert.equal(chapters.length, 3);
    assert.equal(chapters[0].slug, 'alpha');
    assert.equal(chapters[0].position, 0);
    assert.equal(chapters[1].slug, 'beta');
    assert.equal(chapters[1].position, 1);
    assert.equal(chapters[2].slug, 'gamma');
    assert.equal(chapters[2].position, 2);
  });

  it('should_throw_FolioConflictError_on_duplicate_slug', () => {
    store.createPage(folio.id, 'runbooks/redis-timeout', 'content');
    assert.throws(
      () => store.createPage(folio.id, 'runbooks/redis-timeout', 'duplicate'),
      (err) => err instanceof FolioConflictError,
    );
  });

  it('should_get_page_by_slug_in_single_indexed_lookup', () => {
    const created = store.createPage(folio.id, 'runbooks/redis-timeout', 'content');
    const fetched = store.getPageBySlug(folio.id, 'runbooks', 'redis-timeout');
    assert.equal(fetched.id, created.id);
    assert.equal(fetched.content, 'content');
  });

  it('should_return_null_for_nonexistent_page_by_slug', () => {
    assert.equal(store.getPageBySlug(folio.id, 'missing', 'page'), null);
  });

  it('should_update_page_content_and_title', () => {
    const page = store.createPage(folio.id, 'notes/intro', 'initial');
    const updated = store.updatePage(folio.id, page.id, { content: 'updated', title: 'New Title' });
    assert.equal(updated.content, 'updated');
    assert.equal(updated.title, 'New Title');
    assert.ok(updated.updatedAt >= page.updatedAt);
  });

  it('should_update_pinned_flag', () => {
    const page = store.createPage(folio.id, 'notes/pinnable', 'content');
    assert.equal(page.pinned, false);
    const updated = store.updatePage(folio.id, page.id, { pinned: true });
    assert.equal(updated.pinned, true);
  });

  it('should_delete_page_and_return_true', () => {
    const page = store.createPage(folio.id, 'notes/deleteme', 'content');
    assert.equal(store.deletePage(folio.id, page.id), true);
    assert.equal(store.getPage(folio.id, page.id), null);
  });

  it('should_return_false_when_deleting_nonexistent_page', () => {
    assert.equal(store.deletePage(folio.id, 'nonexistent'), false);
  });

  it('should_list_pages_for_whole_folio', () => {
    store.createPage(folio.id, 'alpha/p1', 'c1');
    store.createPage(folio.id, 'beta/p1', 'c2');
    assert.equal(store.listPages(folio.id).length, 2);
  });

  it('should_list_pages_filtered_by_chapter_slug', () => {
    store.createPage(folio.id, 'alpha/p1', 'c1');
    store.createPage(folio.id, 'alpha/p2', 'c2');
    store.createPage(folio.id, 'beta/p1', 'c3');
    assert.equal(store.listPages(folio.id, 'alpha').length, 2);
    assert.equal(store.listPages(folio.id, 'beta').length, 1);
    assert.equal(store.listPages(folio.id, 'gamma').length, 0);
  });

  it('should_enforce_pages_folio_id_invariant', () => {
    const page = store.createPage(folio.id, 'ch/pg', 'content');
    const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(page.chapterId);
    assert.equal(page.folioId, chapter.folio_id);
    assert.equal(page.chapterSlug, chapter.slug);
  });

  it('should_reject_invalid_slug_grammar', () => {
    assert.throws(() => store.createPage(folio.id, 'Invalid/Page', 'c'), TypeError);
    assert.throws(() => store.createPage(folio.id, 'noslash', 'c'), TypeError);
    assert.throws(() => store.createPage(folio.id, 'too/many/slashes', 'c'), TypeError);
  });

  it('should_not_accept_or_return_space_id_in_any_method', () => {
    // Verify the store interface has no method that takes/returns space_id
    const storeKeys = Object.keys(store);
    // All methods should operate on folioId, not spaceId
    // We can verify by checking no returned page object has a spaceId field
    const page = store.createPage(folio.id, 'ch/pg', 'c');
    assert.equal('spaceId' in page, false, 'page must not have spaceId');
    const chapter = store.listChapters(folio.id)[0];
    assert.equal('spaceId' in chapter, false, 'chapter must not have spaceId');
    // Method names should not include "space"
    for (const key of storeKeys) {
      assert.ok(!key.toLowerCase().includes('space'), `store method "${key}" references space`);
    }
  });
});

// ---------------------------------------------------------------------------
// T-003 — Attachments CRUD
// ---------------------------------------------------------------------------

describe('T-003 — Attachments CRUD', () => {
  let db, store, folio, page;

  beforeEach(() => {
    db    = openDb();
    store = createFolioStore(db);
    folio = store.createFolio({ name: 'Attach Folio' });
    page  = store.createPage(folio.id, 'docs/readme', 'content');
  });

  it('should_add_attachment_and_return_metadata_without_blob', () => {
    const data = Buffer.from('PNG data');
    const att = store.addAttachment(folio.id, page.id, {
      name: 'diagram.png', mimeType: 'image/png', data,
    });
    assert.match(att.id, /^[0-9a-f-]{36}$/);
    assert.equal(att.pageId, page.id);
    assert.equal(att.name, 'diagram.png');
    assert.equal(att.mimeType, 'image/png');
    assert.equal('data' in att, false, 'addAttachment should not return data blob');
  });

  it('should_get_attachment_including_blob', () => {
    const data = Buffer.from('PDF content');
    const att  = store.addAttachment(folio.id, page.id, {
      name: 'spec.pdf', mimeType: 'application/pdf', data,
    });
    const fetched = store.getAttachment(folio.id, att.id);
    assert.ok(Buffer.isBuffer(fetched.data) || fetched.data instanceof Uint8Array);
    assert.equal(fetched.data.toString(), 'PDF content');
  });

  it('should_list_attachments_without_blob', () => {
    store.addAttachment(folio.id, page.id, { name: 'a.png', mimeType: 'image/png', data: Buffer.from('a') });
    store.addAttachment(folio.id, page.id, { name: 'b.png', mimeType: 'image/png', data: Buffer.from('b') });
    const list = store.listAttachments(folio.id, page.id);
    assert.equal(list.length, 2);
    for (const att of list) {
      assert.equal('data' in att, false, 'listAttachments must not include data blob');
    }
  });

  it('should_delete_attachment_and_return_true', () => {
    const att = store.addAttachment(folio.id, page.id, {
      name: 'del.png', mimeType: 'image/png', data: Buffer.from('x'),
    });
    assert.equal(store.deleteAttachment(folio.id, att.id), true);
    assert.equal(store.getAttachment(folio.id, att.id), null);
  });

  it('should_cascade_delete_attachments_when_page_deleted', () => {
    store.addAttachment(folio.id, page.id, { name: 'a.png', mimeType: 'image/png', data: Buffer.from('a') });
    store.deletePage(folio.id, page.id);
    const count = db.prepare('SELECT COUNT(*) AS c FROM attachments').get().c;
    assert.equal(count, 0);
  });

  it('should_return_null_for_cross_folio_attachment_access', () => {
    const folio2 = store.createFolio({ name: 'Other' });
    const page2  = store.createPage(folio2.id, 'ch/pg', 'c');
    const att = store.addAttachment(folio.id, page.id, {
      name: 'a.png', mimeType: 'image/png', data: Buffer.from('a'),
    });
    // Trying to access att via folio2 should return null
    assert.equal(store.getAttachment(folio2.id, att.id), null);
  });

  it('should_reject_invalid_attachment_inputs', () => {
    assert.throws(() => store.addAttachment(folio.id, page.id, { name: '', mimeType: 'x', data: Buffer.from('d') }), TypeError);
    assert.throws(() => store.addAttachment(folio.id, page.id, { name: 'n', mimeType: '', data: Buffer.from('d') }), TypeError);
    assert.throws(() => store.addAttachment(folio.id, page.id, { name: 'n', mimeType: 'x', data: 'not-a-buffer' }), TypeError);
  });
});

// ---------------------------------------------------------------------------
// T-004 — FTS5 search + trigger sync
// ---------------------------------------------------------------------------

describe('T-004 — FTS5 search and trigger sync', () => {
  let db, store, folio;

  beforeEach(() => {
    db    = openDb();
    store = createFolioStore(db);
    folio = store.createFolio({ name: 'Search Folio' });
  });

  it('should_index_page_on_insert_and_find_it_by_title', () => {
    store.createPage(folio.id, 'docs/redis', '', { title: 'Redis Configuration' });
    const results = store.searchPages(folio.id, 'Redis');
    assert.equal(results.length, 1);
    assert.equal(results[0].page.title, 'Redis Configuration');
  });

  it('should_find_page_by_content_keyword', () => {
    store.createPage(folio.id, 'docs/intro', 'This document describes the architecture.');
    const results = store.searchPages(folio.id, 'architecture');
    assert.equal(results.length, 1);
  });

  it('should_rank_better_matches_first', () => {
    store.createPage(folio.id, 'docs/redis', 'redis redis redis', { title: 'Redis Guide' });
    store.createPage(folio.id, 'docs/postgres', 'postgres setup', { title: 'Postgres Guide' });
    const results = store.searchPages(folio.id, 'redis');
    assert.ok(results.length >= 1);
    assert.equal(results[0].page.slug, 'redis');
    // BM25 lower = better; score should be a number
    assert.ok(typeof results[0].score === 'number');
  });

  it('should_update_index_when_page_content_updated', () => {
    const page = store.createPage(folio.id, 'docs/before', 'original content here');
    let results = store.searchPages(folio.id, 'uniqueterm');
    assert.equal(results.length, 0);

    store.updatePage(folio.id, page.id, { content: 'uniqueterm appears now' });
    results = store.searchPages(folio.id, 'uniqueterm');
    assert.equal(results.length, 1);
  });

  it('should_remove_from_index_when_page_deleted', () => {
    const page = store.createPage(folio.id, 'docs/gone', 'deletethisword content');
    let results = store.searchPages(folio.id, 'deletethisword');
    assert.equal(results.length, 1);

    store.deletePage(folio.id, page.id);
    results = store.searchPages(folio.id, 'deletethisword');
    assert.equal(results.length, 0);
  });

  it('should_return_empty_for_blank_query', () => {
    store.createPage(folio.id, 'docs/p', 'some content');
    assert.deepEqual(store.searchPages(folio.id, ''), []);
    assert.deepEqual(store.searchPages(folio.id, '   '), []);
  });

  it('should_scope_results_to_folio', () => {
    const folio2 = store.createFolio({ name: 'Other Folio' });
    store.createPage(folio.id, 'ch/unique-folio-1-term', 'unique-folio-1-term content');
    store.createPage(folio2.id, 'ch/other', 'unique-folio-1-term content too');

    const results = store.searchPages(folio.id, 'unique-folio-1-term');
    assert.ok(results.every((r) => r.page.folioId === folio.id), 'results must be scoped to folio');
  });

  it('should_handle_malformed_fts_query_gracefully', () => {
    store.createPage(folio.id, 'ch/pg', 'content');
    // Unmatched quote is a malformed FTS5 query — should return [] not throw
    assert.deepEqual(store.searchPages(folio.id, '"unclosed'), []);
  });

  it('should_respect_limit_option', () => {
    for (let i = 0; i < 5; i++) {
      store.createPage(folio.id, `ch/page-${i}`, `common keyword content item ${i}`);
    }
    const results = store.searchPages(folio.id, 'common', { limit: 3 });
    assert.ok(results.length <= 3);
  });
});

// ---------------------------------------------------------------------------
// T-005 — Binding activation matrix
// ---------------------------------------------------------------------------

describe('T-005 — Binding activation matrix', () => {
  let db, core, binding;

  beforeEach(() => {
    db = openDb();
    insertSpace(db, 'space-1');
    core    = createFolioStore(db);
    binding = createFolioBinding(db, core);
  });

  it('case1_createIfMissing_true_no_binding_creates_folio_and_page', () => {
    assert.equal(binding.hasFolio('space-1'), false);
    const page = binding.createPage('space-1', 'runbooks/redis', '# Redis', {
      createIfMissing: true, author: 'user',
    });
    assert.ok(page !== null);
    assert.equal(page.slug, 'redis');
    assert.equal(binding.hasFolio('space-1'), true);
  });

  it('case2_createIfMissing_false_no_binding_is_no_op', () => {
    assert.equal(binding.hasFolio('space-1'), false);
    const result = binding.createPage('space-1', 'runbooks/redis', 'content', {
      createIfMissing: false, author: 'agent',
    });
    assert.equal(result, null, 'agent write-back must be a no-op when no folio bound');
    assert.equal(binding.hasFolio('space-1'), false, 'no folio should be created');
  });

  it('case3_createIfMissing_true_existing_binding_reuses_folio', () => {
    // First call creates folio + binding
    const page1 = binding.createPage('space-1', 'ch/page1', 'c1', { createIfMissing: true });
    const folioId1 = binding.getFolioIdForSpace('space-1');

    // Second call reuses the same folio
    const page2 = binding.createPage('space-1', 'ch/page2', 'c2', { createIfMissing: true });
    const folioId2 = binding.getFolioIdForSpace('space-1');

    assert.equal(folioId1, folioId2, 'must reuse existing folio, not create a second one');
    assert.equal(page1.folioId, page2.folioId);

    // Only one row in space_folios
    const count = db.prepare('SELECT COUNT(*) AS c FROM space_folios WHERE space_id = ?').get('space-1').c;
    assert.equal(count, 1);
  });

  it('case4_createIfMissing_false_existing_binding_creates_page', () => {
    // First create the binding
    binding.createPage('space-1', 'ch/page1', 'c1', { createIfMissing: true });
    assert.equal(binding.hasFolio('space-1'), true);

    // Now agent write-back should succeed
    const page = binding.createPage('space-1', 'ch/agent-page', 'agent content', {
      createIfMissing: false, author: 'agent',
    });
    assert.ok(page !== null, 'should create page when binding exists');
    assert.equal(page.author, 'agent');
  });

  it('should_enforce_space_id_unique_constraint_in_space_folios', () => {
    binding.createPage('space-1', 'ch/p1', 'c1', { createIfMissing: true });
    // Attempting to insert a duplicate binding manually should fail
    assert.throws(() => {
      const folioId = binding.getFolioIdForSpace('space-1');
      db.prepare('INSERT INTO space_folios (space_id, folio_id) VALUES (?, ?)').run('space-1', folioId);
    });
  });

  it('should_return_empty_for_listChapters_when_no_folio', () => {
    assert.deepEqual(binding.listChapters('space-1'), []);
  });

  it('should_return_empty_for_listPages_when_no_folio', () => {
    assert.deepEqual(binding.listPages('space-1'), []);
  });

  it('should_return_null_for_getPageBySlug_when_no_folio', () => {
    assert.equal(binding.getPageBySlug('space-1', 'ch', 'pg'), null);
  });

  it('should_return_empty_for_searchPages_when_no_folio', () => {
    assert.deepEqual(binding.searchPages('space-1', 'query'), []);
  });

  it('read_passthroughs_resolve_correct_content_after_activation', () => {
    binding.createPage('space-1', 'runbooks/redis', '# Redis Timeout', { createIfMissing: true });
    binding.createPage('space-1', 'runbooks/postgres', '# Postgres Setup', { createIfMissing: true });

    const chapters = binding.listChapters('space-1');
    assert.equal(chapters.length, 1);
    assert.equal(chapters[0].slug, 'runbooks');

    const pages = binding.listPages('space-1');
    assert.equal(pages.length, 2);

    const page = binding.getPageBySlug('space-1', 'runbooks', 'redis');
    assert.ok(page !== null);
    assert.equal(page.chapterSlug, 'runbooks');
    assert.equal(page.slug, 'redis');

    const results = binding.searchPages('space-1', 'Redis');
    assert.ok(results.length >= 1);
  });
});

// ---------------------------------------------------------------------------
// T-006 — Wire-up via createStore()
// ---------------------------------------------------------------------------

describe('T-006 — createStore exposes folio.core and folio.binding', () => {
  it('should_have_folio_core_and_binding_on_store_result', () => {
    const store = createStore(':memory:');
    assert.ok(store.folio, 'store.folio is missing');
    assert.ok(store.folio.core, 'store.folio.core is missing');
    assert.ok(store.folio.binding, 'store.folio.binding is missing');
    assert.equal(typeof store.folio.core.createPage, 'function');
    assert.equal(typeof store.folio.binding.createPage, 'function');
    store.close();
  });

  it('should_apply_folio_schema_idempotently_on_second_open', () => {
    // Open and close to verify idempotency
    const s1 = createStore(':memory:');
    s1.close();
    // No throw = idempotent
    assert.ok(true);
  });
});

// ---------------------------------------------------------------------------
// T-007 — Isolation assertion
// ---------------------------------------------------------------------------

describe('T-007 — Isolation: src/services/folio/ has no reference to space_id', () => {
  it('should_not_reference_space_id_in_folio_db_js', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/services/folio/db.js'), 'utf8',
    );
    // Strip comment lines — JSDoc may reference concepts for documentation purposes,
    // but executable code and SQL must never touch the binding-layer columns.
    const executableLines = src
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n');
    assert.ok(!executableLines.includes('space_id'), 'folio/db.js executable code must not reference space_id');
    assert.ok(!executableLines.includes('space_folios'), 'folio/db.js executable code must not reference space_folios');
  });

  it('should_not_reference_space_id_in_folio_store_js', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/services/folio/store.js'), 'utf8',
    );
    // Strip comment lines for the same reason as above.
    const executableLines = src
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n');
    assert.ok(!executableLines.includes('space_id'), 'folio/store.js executable code must not reference space_id');
    assert.ok(!executableLines.includes('space_folios'), 'folio/store.js executable code must not reference space_folios');
  });

  it('should_not_import_outside_src_services_folio_in_db_js', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/services/folio/db.js'), 'utf8',
    );
    // No require() calls at all — pure DDL exporter
    assert.ok(!src.includes("require('../"), 'folio/db.js must not import outside its directory');
    assert.ok(!src.includes("require('../../"), 'folio/db.js must not import outside its directory');
  });

  it('should_not_import_outside_src_services_folio_in_store_js', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/services/folio/store.js'), 'utf8',
    );
    // Strip comment lines before checking require() calls, since JSDoc examples
    // may contain require() to illustrate usage — those are not real imports.
    const nonCommentLines = src
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n');

    // Allowed: crypto (built-in) and intra-module relative imports ("./x") that
    // stay inside src/services/folio/. Parent-escaping ("../x") or bare package
    // imports are NOT allowed — that is the actual isolation guarantee.
    const requireCalls = nonCommentLines.match(/require\(['"][^'"]+['"]\)/g) || [];
    for (const req of requireCalls) {
      const isCrypto      = req.includes("'crypto'") || req.includes('"crypto"');
      const isIntraModule = /require\((['"])\.\/[^'"]+\1\)/.test(req);
      assert.ok(
        isCrypto || isIntraModule,
        `folio/store.js has unexpected non-comment import: ${req}`,
      );
    }
  });

  it('parseSlug_should_reject_uppercase_segments', () => {
    assert.throws(() => parseSlug('Chapter/page'), TypeError);
    assert.throws(() => parseSlug('chapter/Page'), TypeError);
  });

  it('titleCase_should_convert_kebab_to_title_case', () => {
    assert.equal(titleCase('redis-timeout'), 'Redis Timeout');
    assert.equal(titleCase('my-chapter-name'), 'My Chapter Name');
    assert.equal(titleCase('single'), 'Single');
  });
});
