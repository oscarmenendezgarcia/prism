'use strict';

/**
 * Tests for the Folio Pages CRUD feature (folio-index-ui).
 *
 * Covers:
 *  T-001 — updatePage / deletePage binding (SQLite binding layer)
 *    - updatePage returns updated page with preserved author
 *    - updatePage returns null when no folio bound
 *    - updatePage returns null when page not found
 *    - deletePage returns true on success
 *    - deletePage returns false when no folio bound
 *    - deletePage returns false when page not found
 *
 *  T-002 — HTTP CRUD endpoints (integration via startTestServer)
 *    - GET /folio → { active: false, chapters: [] } when no folio
 *    - GET /folio → { active: true, chapters: [...] } when folio exists
 *    - GET /folio/chapters/:slug/pages → { pages: [] } when no folio
 *    - GET /folio/pages/:c/:p → 200 full page
 *    - GET /folio/pages/:c/:p → 404 PAGE_NOT_FOUND when missing
 *    - POST /folio/pages → 201 with author:'user', activates folio
 *    - POST /folio/pages → 409 PAGE_EXISTS on duplicate
 *    - POST /folio/pages → 400 INVALID_SLUG on bad slug
 *    - PUT /folio/pages/:c/:p → 200 updated page (author preserved)
 *    - PUT /folio/pages/:c/:p → 404 when missing
 *    - PUT /folio/pages/:c/:p → 400 INVALID_BODY on empty body
 *    - DELETE /folio/pages/:c/:p → 204 on success
 *    - DELETE /folio/pages/:c/:p → 404 when missing
 *    - 404 SPACE_NOT_FOUND on all routes for unknown space
 *
 * Run with: node --test tests/folio-pages-crud.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert   = require('node:assert/strict');
const Database = require('better-sqlite3');
const http     = require('http');

const { applySchema }                            = require('../src/services/folio/db');
const { createFolioStore, FolioConflictError }   = require('../src/services/folio/store');
const { applyBindingSchema, createFolioBinding } = require('../src/services/folioBinding');
const { startTestServer }                        = require('./helpers/server');

// ---------------------------------------------------------------------------
// In-memory helpers
// ---------------------------------------------------------------------------

function openDb() {
  const db = new Database(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
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
  db.prepare('INSERT INTO spaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, 'Test Space', new Date().toISOString(), new Date().toISOString());
}

// ---------------------------------------------------------------------------
// HTTP helpers (mirrors folio-refs.test.js pattern)
// ---------------------------------------------------------------------------

function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: 'localhost', port, path: urlPath, method: 'GET',
        headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function httpPost(port, urlPath, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: 'localhost', port, path: urlPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function httpPut(port, urlPath, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: 'localhost', port, path: urlPath, method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function httpDelete(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: 'localhost', port, path: urlPath, method: 'DELETE',
        headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// T-001 — SQLite binding: updatePage / deletePage
// ---------------------------------------------------------------------------

describe('T-001 — SQLite binding: updatePage / deletePage', () => {
  let db, binding;

  before(() => {
    db = openDb();
    insertSpace(db);
    const { createFolioService, openSqliteBackend } = require('../src/services/folio/index');
    const svc = createFolioService(openSqliteBackend({ db }));
    binding = createFolioBinding(db, svc);
  });

  after(() => db.close());

  it('updatePage_returns_null_when_no_folio_bound', () => {
    const result = binding.updatePage('space-1', 'arch', 'intro', { title: 'New' });
    assert.strictEqual(result, null);
  });

  it('deletePage_returns_false_when_no_folio_bound', () => {
    const result = binding.deletePage('space-1', 'arch', 'intro');
    assert.strictEqual(result, false);
  });

  describe('after activation', () => {
    before(() => {
      // Activate the folio by creating a page.
      const created = binding.createPage('space-1', 'arch/intro', '# Intro', {
        createIfMissing: true,
        author: 'user',
      });
      assert.ok(created, 'page should be created');
    });

    it('updatePage_returns_null_when_page_not_found', () => {
      const result = binding.updatePage('space-1', 'arch', 'nonexistent', { title: 'X' });
      assert.strictEqual(result, null);
    });

    it('deletePage_returns_false_when_page_not_found', () => {
      const result = binding.deletePage('space-1', 'arch', 'nonexistent');
      assert.strictEqual(result, false);
    });

    it('updatePage_returns_updated_page_with_preserved_author', () => {
      const updated = binding.updatePage('space-1', 'arch', 'intro', {
        title:   'Architecture Introduction',
        content: '# Architecture Introduction\n\nUpdated content.',
      });
      assert.ok(updated, 'should return updated page');
      assert.strictEqual(updated.title,       'Architecture Introduction');
      assert.strictEqual(updated.content,     '# Architecture Introduction\n\nUpdated content.');
      // Author MUST be preserved — core invariant.
      assert.strictEqual(updated.author,      'user');
      assert.strictEqual(updated.slug,        'intro');
      assert.strictEqual(updated.chapterSlug, 'arch');
    });

    it('deletePage_returns_true_on_success', () => {
      // Create a throwaway page to delete.
      binding.createPage('space-1', 'arch/todelete', '', {
        createIfMissing: true,
        author: 'agent',
      });
      const result = binding.deletePage('space-1', 'arch', 'todelete');
      assert.strictEqual(result, true);
      // Verify it's gone.
      const gone = binding.getPageBySlug('space-1', 'arch', 'todelete');
      assert.strictEqual(gone, null);
    });
  });
});

// ---------------------------------------------------------------------------
// T-002 — HTTP CRUD endpoints (integration via startTestServer)
// ---------------------------------------------------------------------------

describe('T-002 — HTTP CRUD endpoints', () => {
  let serverHandle;
  let spaceId;

  before(async () => {
    serverHandle = await startTestServer();
    // Create a dedicated test space for folio CRUD tests.
    const r = await httpPost(serverHandle.port, '/api/v1/spaces', { name: 'FolioCrudTest' });
    assert.strictEqual(r.status, 201, `space creation failed: ${JSON.stringify(r.body)}`);
    spaceId = r.body.id;
  });

  after(async () => {
    await serverHandle.close();
  });

  // ── GET /folio — empty state ─────────────────────────────────────────────

  it('GET_folio_returns_active_false_when_no_folio_bound', async () => {
    const r = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.active, false);
    assert.deepStrictEqual(r.body.chapters, []);
  });

  it('GET_folio_returns_404_SPACE_NOT_FOUND_for_unknown_space', async () => {
    const r = await httpGet(serverHandle.port, '/api/v1/spaces/no-such-space/folio');
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.body.error.code, 'SPACE_NOT_FOUND');
  });

  it('GET_chapter_pages_returns_empty_when_no_folio', async () => {
    const r = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/chapters/arch/pages`);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.pages, []);
  });

  it('GET_page_returns_404_when_page_does_not_exist', async () => {
    const r = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/pages/arch/intro`);
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.body.error.code, 'PAGE_NOT_FOUND');
  });

  // ── POST /folio/pages — validation ───────────────────────────────────────

  it('POST_folio_pages_400_on_invalid_slug', async () => {
    const r = await httpPost(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/pages`, {
      slug: 'INVALID SLUG!',
    });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, 'INVALID_SLUG');
  });

  it('POST_folio_pages_400_on_missing_slash_in_slug', async () => {
    const r = await httpPost(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/pages`, {
      slug: 'just-chapter',
    });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, 'INVALID_SLUG');
  });

  // ── POST /folio/pages — create + activation ──────────────────────────────

  it('POST_folio_pages_201_creates_page_with_author_user_and_activates_folio', async () => {
    const r = await httpPost(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/pages`, {
      slug:    'arch/intro',
      title:   'Architecture Introduction',
      content: '# Arch\n\nHello folio.',
    });
    assert.strictEqual(r.status, 201);
    const page = r.body;
    assert.strictEqual(page.slug,        'intro');
    assert.strictEqual(page.chapterSlug, 'arch');
    assert.strictEqual(page.title,       'Architecture Introduction');
    assert.strictEqual(page.author,      'user');
    assert.ok(page.id,        'should have id');
    assert.ok(page.createdAt, 'should have createdAt');
    assert.ok(page.updatedAt, 'should have updatedAt');
    assert.strictEqual(typeof page.pinned, 'boolean');
  });

  it('GET_folio_returns_active_true_with_arch_chapter_after_first_page_created', async () => {
    const r = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.active, true);
    assert.ok(Array.isArray(r.body.chapters));
    assert.ok(r.body.chapters.length > 0);
    const arch = r.body.chapters.find((c) => c.slug === 'arch');
    assert.ok(arch, 'arch chapter should exist');
    assert.strictEqual(arch.pageCount, 1);
    assert.ok(typeof arch.position === 'number');
  });

  it('POST_folio_pages_409_PAGE_EXISTS_on_duplicate_slug', async () => {
    const r = await httpPost(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/pages`, {
      slug: 'arch/intro',
    });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.error.code, 'PAGE_EXISTS');
  });

  it('POST_second_page_increments_chapter_page_count', async () => {
    const r = await httpPost(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/pages`, {
      slug:    'arch/decisions',
      title:   'Architecture Decisions',
      content: '## Decisions',
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.author, 'user');

    // Verify chapter page count updated.
    const idx = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio`);
    const arch = idx.body.chapters.find((c) => c.slug === 'arch');
    assert.ok(arch, 'arch chapter must exist');
    assert.strictEqual(arch.pageCount, 2);
  });

  it('GET_chapter_pages_returns_metadata_for_all_pages_no_content', async () => {
    const r = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/chapters/arch/pages`);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.pages));
    assert.strictEqual(r.body.pages.length, 2);
    for (const page of r.body.pages) {
      assert.ok(page.id);
      assert.ok(page.slug);
      assert.ok(page.chapterSlug);
      assert.ok(page.title);
      assert.ok(['user', 'agent'].includes(page.author));
      assert.ok(page.createdAt);
      assert.ok(page.updatedAt);
      // PageMeta must NOT include content.
      assert.strictEqual(page.content, undefined, 'PageMeta must not have content');
    }
  });

  // ── GET single page ───────────────────────────────────────────────────────

  it('GET_folio_page_returns_full_page_with_content', async () => {
    const r = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/pages/arch/intro`);
    assert.strictEqual(r.status, 200);
    const page = r.body;
    assert.strictEqual(page.slug,        'intro');
    assert.strictEqual(page.chapterSlug, 'arch');
    assert.strictEqual(page.title,       'Architecture Introduction');
    assert.strictEqual(page.content,     '# Arch\n\nHello folio.');
    assert.strictEqual(page.author,      'user');
  });

  it('GET_folio_page_404_when_page_does_not_exist', async () => {
    const r = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/pages/arch/ghost`);
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.body.error.code, 'PAGE_NOT_FOUND');
  });

  // ── PUT — update ──────────────────────────────────────────────────────────

  it('PUT_folio_page_400_INVALID_BODY_when_no_updates_provided', async () => {
    const r = await httpPut(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/pages/arch/intro`, {});
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, 'INVALID_BODY');
  });

  it('PUT_folio_page_200_updates_content_and_preserves_author', async () => {
    const newContent = '# Architecture\n\nUpdated by user.';
    const r = await httpPut(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/pages/arch/intro`, {
      content: newContent,
      title:   'Architecture Updated',
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.content, newContent);
    assert.strictEqual(r.body.title,   'Architecture Updated');
    // Author MUST be preserved — core invariant.
    assert.strictEqual(r.body.author,  'user');
  });

  it('PUT_folio_page_404_when_page_does_not_exist', async () => {
    const r = await httpPut(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/pages/arch/ghost`, {
      content: 'hello',
    });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.body.error.code, 'PAGE_NOT_FOUND');
  });

  // ── DELETE ────────────────────────────────────────────────────────────────

  it('DELETE_folio_page_204_on_success', async () => {
    // Create a throwaway page.
    await httpPost(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/pages`, {
      slug: 'arch/todelete',
    });

    const r = await httpDelete(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/pages/arch/todelete`);
    assert.strictEqual(r.status, 204);

    // Verify it's gone.
    const check = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/pages/arch/todelete`);
    assert.strictEqual(check.status, 404);
  });

  it('DELETE_folio_page_404_when_page_does_not_exist', async () => {
    const r = await httpDelete(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/pages/arch/ghost`);
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.body.error.code, 'PAGE_NOT_FOUND');
  });

  it('DELETE_folio_page_returns_404_SPACE_NOT_FOUND_for_unknown_space', async () => {
    const r = await httpDelete(serverHandle.port, '/api/v1/spaces/no-such/folio/pages/a/b');
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.body.error.code, 'SPACE_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Auto-migration — adding a working directory moves an activated sqlite folio
// into the repo's .folio/ on save (export → flip → delete). Invariant: a space
// with a repo keeps its folio in the repo.
// ---------------------------------------------------------------------------

describe('Auto-migrate sqlite → file when a working directory is added', () => {
  const fs   = require('fs');
  const os   = require('os');
  const path = require('path');

  let serverHandle;
  let spaceId;
  let workDir;

  before(async () => {
    serverHandle = await startTestServer();
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-migrate-'));
    // Space WITHOUT a working dir → sqlite folio backend.
    const r = await httpPost(serverHandle.port, '/api/v1/spaces', { name: 'MigrateOnSave' });
    assert.strictEqual(r.status, 201, `space creation failed: ${JSON.stringify(r.body)}`);
    spaceId = r.body.id;
  });

  after(async () => {
    await serverHandle.close();
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('activates a sqlite folio (no working dir yet → stays in the app database)', async () => {
    const r = await httpPost(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/pages`, {
      slug:    'guide/intro',
      title:   'Intro',
      content: '# Intro\n\nhello migration',
    });
    assert.strictEqual(r.status, 201);
  });

  it('PUT adding a working dir migrates the folio into .folio/ and flips the backend to file', async () => {
    const r = await httpPut(serverHandle.port, `/api/v1/spaces/${spaceId}`, {
      name: 'MigrateOnSave',
      workingDirectory: workDir,
    });
    assert.strictEqual(r.status, 200, `PUT failed: ${JSON.stringify(r.body)}`);
    // The response reflects the flipped backend (re-read after migration).
    assert.strictEqual(r.body.folioBackend, 'file');
    // Content was exported to <wd>/.folio/ before the sqlite rows were dropped.
    assert.ok(fs.existsSync(path.join(workDir, '.folio', 'folio.json')), '.folio/folio.json should exist');
  });

  it('the migrated page is still readable — no data loss', async () => {
    const idx = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio`);
    assert.strictEqual(idx.status, 200);
    assert.strictEqual(idx.body.active, true);
    assert.ok(idx.body.chapters.some((c) => c.slug === 'guide'), 'guide chapter survives migration');

    const page = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/pages/guide/intro`);
    assert.strictEqual(page.status, 200);
    assert.match(page.body.content, /hello migration/);
  });
});
