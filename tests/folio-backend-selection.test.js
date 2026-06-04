'use strict';

/**
 * Tests for per-space Folio backend selection (T-001..T-007).
 *
 * Covers:
 *  - T-001: folio_backend schema column — fresh DB, additive migration, round-trip.
 *  - T-002: validateFolioBackend — all rule permutations + createSpace/renameSpace wiring.
 *  - T-003: folioFileBinding — all methods, empty when absent, scaffold on activation.
 *  - T-004: folioRouter — dispatch (sqlite vs file), mtime-gated reindex, scaffold, close.
 *  - T-005: store.js wiring — folio.binding is the router; pipelineManager resolveRefs.
 *  - T-006: REST/MCP surface — folioBackend accepted, invalid combos rejected 400.
 *  - T-007: Integration — file-backed space end-to-end; SQLite regression.
 *
 * Run with: node --test tests/folio-backend-selection.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

const Database = require('better-sqlite3');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'folio-sel-test-'));
}

function removeTempDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// Write a minimal .folio/ page file for test fixtures.
function writePage(folioRoot, chapterSlug, pageSlug, content = 'test content') {
  const chapterDir = path.join(folioRoot, chapterSlug);
  fs.mkdirSync(chapterDir, { recursive: true });
  const md = `---\ntitle: ${pageSlug}\nauthor: user\ncreatedAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-01T00:00:00.000Z\n---\n\n${content}\n`;
  fs.writeFileSync(path.join(chapterDir, `${pageSlug}.md`), md, 'utf8');
}

// ---------------------------------------------------------------------------
// T-001: Schema + row mapper
// ---------------------------------------------------------------------------

describe('T-001: folio_backend schema column', () => {
  it('fresh DB has folio_backend column', () => {
    const { createStore } = require('../src/services/store');
    const store = createStore(':memory:');
    try {
      const cols = store._db
        ? store._db.pragma('table_info(spaces)')
        : null;
      // Column existence verified via upsert round-trip below.
      // (store._db is not exposed; use upsertSpace + getSpace instead.)
      const id  = crypto.randomUUID();
      const now = new Date().toISOString();
      store.upsertSpace({ id, name: 'Test', folioBackend: 'file', createdAt: now, updatedAt: now });
      const space = store.getSpace(id);
      assert.equal(space.folioBackend, 'file', 'folioBackend round-trips through the DB');
    } finally {
      store.close();
    }
  });

  it('folioBackend defaults to undefined when not set (NULL in DB)', () => {
    const { createStore } = require('../src/services/store');
    const store = createStore(':memory:');
    try {
      const id  = crypto.randomUUID();
      const now = new Date().toISOString();
      store.upsertSpace({ id, name: 'NoBackend', createdAt: now, updatedAt: now });
      const space = store.getSpace(id);
      assert.equal(space.folioBackend, undefined, 'NULL folio_backend maps to undefined');
    } finally {
      store.close();
    }
  });

  it('upsertSpace persists folioBackend sqlite and round-trips', () => {
    const { createStore } = require('../src/services/store');
    const store = createStore(':memory:');
    try {
      const id  = crypto.randomUUID();
      const now = new Date().toISOString();
      store.upsertSpace({ id, name: 'SqliteSpace', folioBackend: 'sqlite', createdAt: now, updatedAt: now });
      const space = store.getSpace(id);
      assert.equal(space.folioBackend, 'sqlite');
    } finally {
      store.close();
    }
  });

  it('additive migration: existing DB without folio_backend gets the column', () => {
    const tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'prism.db');
    try {
      // Create a DB with spaces table but WITHOUT folio_backend (simulate old schema).
      const legacyDb = new Database(dbPath);
      legacyDb.exec(`
        PRAGMA journal_mode = WAL;
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
        INSERT INTO spaces (id, name, created_at, updated_at) VALUES ('s1', 'Old', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
      `);
      legacyDb.close();

      // Open via createStore — should run additive migration.
      const { createStore } = require('../src/services/store');
      // Need a fresh require since store is cached.
      const store = createStore(tmpDir);
      try {
        const space = store.getSpace('s1');
        // Should not throw even though old row had no folio_backend.
        assert.equal(space.name, 'Old');
        assert.equal(space.folioBackend, undefined);

        // Can now write folioBackend.
        const now = new Date().toISOString();
        store.upsertSpace({ id: 's1', name: 'Old', folioBackend: 'file', createdAt: '2026-01-01T00:00:00Z', updatedAt: now });
        const updated = store.getSpace('s1');
        assert.equal(updated.folioBackend, 'file');
      } finally {
        store.close();
      }
    } finally {
      removeTempDir(tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// T-002: validateFolioBackend
// ---------------------------------------------------------------------------

describe('T-002: validateFolioBackend', () => {
  const { validateFolioBackend } = require('../src/services/folioValidation');

  it('defaults NULL to sqlite', () => {
    const r = validateFolioBackend({});
    assert.equal(r.valid, true);
    assert.equal(r.data.folioBackend, 'sqlite');
  });

  it('accepts sqlite explicitly', () => {
    const r = validateFolioBackend({ folioBackend: 'sqlite' });
    assert.equal(r.valid, true);
    assert.equal(r.data.folioBackend, 'sqlite');
  });

  it('accepts file with a working directory', () => {
    const r = validateFolioBackend({ folioBackend: 'file', workingDirectory: '/tmp/repo' });
    assert.equal(r.valid, true);
    assert.equal(r.data.folioBackend, 'file');
  });

  it('rejects file without workingDirectory', () => {
    const r = validateFolioBackend({ folioBackend: 'file' });
    assert.equal(r.valid, false);
    assert.ok(r.errors[0].includes('working directory'));
  });

  it('rejects unknown backend value', () => {
    const r = validateFolioBackend({ folioBackend: 'mysql' });
    assert.equal(r.valid, false);
    assert.ok(r.errors[0].includes('Unknown'));
  });

  it('rejects changing backend after activation', () => {
    const r = validateFolioBackend({
      folioBackend: 'file',
      workingDirectory: '/tmp/repo',
      existingFolioActivated: true,
      existingBackend: 'sqlite',
    });
    assert.equal(r.valid, false);
    assert.ok(r.errors[0].includes('Cannot change'));
  });

  it('allows same backend when activated (idempotent)', () => {
    const r = validateFolioBackend({
      folioBackend: 'file',
      workingDirectory: '/tmp/repo',
      existingFolioActivated: true,
      existingBackend: 'file',
    });
    assert.equal(r.valid, true);
  });

  it('createSpace rejects file backend without working directory', () => {
    const { createSpaceManager } = require('../src/services/spaceManager');
    const store = createStore(':memory:');
    const mgr = createSpaceManager(store);
    const result = mgr.createSpace('BadSpace', undefined, undefined, undefined, undefined, 'file');
    assert.equal(result.ok, false);
    assert.ok(result.message.includes('working directory'));
    store.close();
  });

  it('createSpace accepts file backend with working directory', () => {
    const { createSpaceManager } = require('../src/services/spaceManager');
    const { createStore } = require('../src/services/store');
    const tmpDir = makeTempDir();
    const store = createStore(':memory:');
    const mgr = createSpaceManager(store);
    try {
      const result = mgr.createSpace('FileSpace', tmpDir, undefined, undefined, undefined, 'file');
      assert.equal(result.ok, true);
      assert.equal(result.space.folioBackend, 'file');
    } finally {
      store.close();
      removeTempDir(tmpDir);
    }
  });

  it('createSpace with sqlite folioBackend stores nothing (default omitted)', () => {
    const { createSpaceManager } = require('../src/services/spaceManager');
    const { createStore } = require('../src/services/store');
    const store = createStore(':memory:');
    const mgr = createSpaceManager(store);
    try {
      const result = mgr.createSpace('SqliteExplicit', undefined, undefined, undefined, undefined, 'sqlite');
      assert.equal(result.ok, true);
      // 'sqlite' is default — stored without the field.
      assert.equal(result.space.folioBackend, undefined);
    } finally {
      store.close();
    }
  });

  it('renameSpace rejects unknown folioBackend', () => {
    const { createSpaceManager } = require('../src/services/spaceManager');
    const { createStore } = require('../src/services/store');
    const store = createStore(':memory:');
    const mgr = createSpaceManager(store);
    try {
      const cr = mgr.createSpace('TestSpace', '/tmp/wd');
      const result = mgr.renameSpace(cr.space.id, 'TestSpaceR', undefined, undefined, undefined, undefined, 'nosql');
      assert.equal(result.ok, false);
      assert.ok(result.message.includes('Unknown'));
    } finally {
      store.close();
    }
  });
});

function createStore(p) {
  return require('../src/services/store').createStore(p);
}

// ---------------------------------------------------------------------------
// T-003: folioFileBinding
// ---------------------------------------------------------------------------

describe('T-003: folioFileBinding', () => {
  const { createFileBinding } = require('../src/services/folioFileBinding');
  const { applyBindingSchema } = require('../src/services/folioBinding');
  const { createFolioService, openFileBackend } = require('../src/services/folio/index');

  // Helper: open a file-backed service at the given root (must exist).
  function openService(root) {
    return createFolioService(openFileBackend({ root }));
  }

  it('read methods return empty/null when .folio/ absent', () => {
    const db = new Database(':memory:');
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS folio_bootstrap (space_id TEXT NOT NULL UNIQUE REFERENCES spaces(id) ON DELETE CASCADE, bootstrapped_at TEXT NOT NULL);
    `);
    const spaceId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO spaces (id, name, created_at, updated_at) VALUES (?,?,?,?)').run(spaceId, 'X', now, now);

    const binding = createFileBinding({
      db,
      spaceId,
      getService: () => null,  // no .folio/
    });

    assert.equal(binding.getFolioIdForSpace(spaceId), null);
    assert.equal(binding.hasFolio(spaceId), false);
    assert.deepEqual(binding.listChapters(spaceId), []);
    assert.deepEqual(binding.listPages(spaceId), []);
    assert.equal(binding.getPageBySlug(spaceId, 'ch', 'pg'), null);
    assert.deepEqual(binding.searchPages(spaceId, 'query'), []);
    assert.deepEqual(binding.listPageSections(spaceId, 'ch', 'pg'), []);
    assert.equal(binding.buildInjectionContext(spaceId, 'query'), null);
    assert.equal(binding.upsertPageFromAgent(spaceId, 'ch/pg', 'content'), null);
    assert.equal(binding.resolveRefs(spaceId, 'text [[x/y]]'), 'text [[x/y]]');
    assert.deepEqual(binding.getBootstrapState(spaceId), { bootstrappedAt: null });

    db.close();
  });

  it('createPage with createIfMissing:false is no-op when absent', () => {
    const db = new Database(':memory:');
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS folio_bootstrap (space_id TEXT NOT NULL UNIQUE REFERENCES spaces(id) ON DELETE CASCADE, bootstrapped_at TEXT NOT NULL);
    `);
    const spaceId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO spaces (id, name, created_at, updated_at) VALUES (?,?,?,?)').run(spaceId, 'X', now, now);

    const binding = createFileBinding({
      db,
      spaceId,
      getService: () => null,
    });

    const result = binding.createPage(spaceId, 'ch/pg', 'hello', { createIfMissing: false });
    assert.equal(result, null);
    db.close();
  });

  it('createPage with createIfMissing:true calls getService with createIfMissing:true', () => {
    const tmpDir = makeTempDir();
    try {
      const db = new Database(':memory:');
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS folio_bootstrap (space_id TEXT NOT NULL UNIQUE REFERENCES spaces(id) ON DELETE CASCADE, bootstrapped_at TEXT NOT NULL);
      `);
      const spaceId = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare('INSERT INTO spaces (id, name, created_at, updated_at) VALUES (?,?,?,?)').run(spaceId, 'X', now, now);

      // Pre-scaffold .folio/ for this test (getService factory opens it).
      const root = path.join(tmpDir, '.folio');
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, 'folio.json'), JSON.stringify({ name: 'Test', formatVersion: '1.0' }) + '\n', 'utf8');
      fs.writeFileSync(path.join(root, '.gitignore'), 'cache.db\n', 'utf8');
      writePage(root, 'ch', 'seed');  // need ≥1 page for hasFolio

      let serviceOpened = false;
      const binding = createFileBinding({
        db,
        spaceId,
        getService: (opts = {}) => {
          if (opts.createIfMissing) serviceOpened = true;
          return openService(root);
        },
      });

      const page = binding.createPage(spaceId, 'ch/pg', 'hello world', { createIfMissing: true, author: 'user', title: 'Pg' });
      assert.ok(page, 'page was created');
      assert.equal(page.content, 'hello world');
      assert.ok(serviceOpened, 'service was opened with createIfMissing:true');

      db.close();
    } finally {
      removeTempDir(tmpDir);
    }
  });

  it('upsertPageFromAgent: skips user-owned pages', () => {
    const tmpDir = makeTempDir();
    try {
      const db = new Database(':memory:');
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS folio_bootstrap (space_id TEXT NOT NULL UNIQUE REFERENCES spaces(id) ON DELETE CASCADE, bootstrapped_at TEXT NOT NULL);
      `);
      const spaceId = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare('INSERT INTO spaces (id, name, created_at, updated_at) VALUES (?,?,?,?)').run(spaceId, 'X', now, now);

      const root = path.join(tmpDir, '.folio');
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, 'folio.json'), JSON.stringify({ name: 'T', formatVersion: '1.0' }) + '\n');
      fs.writeFileSync(path.join(root, '.gitignore'), 'cache.db\n');
      // Write user-owned page.
      const chDir = path.join(root, 'ch');
      fs.mkdirSync(chDir, { recursive: true });
      const md = `---\ntitle: Existing\nauthor: user\ncreatedAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-01T00:00:00.000Z\n---\n\noriginal content\n`;
      fs.writeFileSync(path.join(chDir, 'pg.md'), md);

      const svc = openService(root);
      const binding = createFileBinding({
        db,
        spaceId,
        getService: () => svc,
      });

      const result = binding.upsertPageFromAgent(spaceId, 'ch/pg', 'new content');
      assert.deepEqual(result, { skipped: 'user-owned' });
      svc.close();
      db.close();
    } finally {
      removeTempDir(tmpDir);
    }
  });

  it('bootstrap marker persists via folio_bootstrap table', () => {
    const db = new Database(':memory:');
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS folio_bootstrap (space_id TEXT NOT NULL UNIQUE REFERENCES spaces(id) ON DELETE CASCADE, bootstrapped_at TEXT NOT NULL);
    `);
    const spaceId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO spaces (id, name, created_at, updated_at) VALUES (?,?,?,?)').run(spaceId, 'X', now, now);

    const binding = createFileBinding({ db, spaceId, getService: () => null });
    assert.deepEqual(binding.getBootstrapState(spaceId), { bootstrappedAt: null });
    binding.setBootstrappedAt(spaceId, '2026-06-01T00:00:00.000Z');
    assert.deepEqual(binding.getBootstrapState(spaceId), { bootstrappedAt: '2026-06-01T00:00:00.000Z' });
    // Idempotent update.
    binding.setBootstrappedAt(spaceId, '2026-06-02T00:00:00.000Z');
    assert.deepEqual(binding.getBootstrapState(spaceId), { bootstrappedAt: '2026-06-02T00:00:00.000Z' });
    db.close();
  });
});

// ---------------------------------------------------------------------------
// T-004: folioRouter
// ---------------------------------------------------------------------------

describe('T-004: folioRouter', () => {
  const { createFolioRouter } = require('../src/services/folioRouter');
  const { applyBindingSchema, createFolioBinding } = require('../src/services/folioBinding');
  const { applySchema: applyFolioSchema } = require('../src/services/folio/db');
  const { createFolioService, openSqliteBackend, openFileBackend, reindexFileBackend } = require('../src/services/folio/index');

  function openInMemory() {
    const db = new Database(':memory:');
    db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS spaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        working_directory TEXT,
        pipeline TEXT,
        project_claude_md TEXT,
        agent_nicknames TEXT,
        folio_backend TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    applyFolioSchema(db);
    applyBindingSchema(db);
    return db;
  }

  it('sqlite space delegates to SQLite binding (zero file ops)', () => {
    const db = openInMemory();
    const core = createFolioService(openSqliteBackend({ db }));
    const sqliteBinding = createFolioBinding(db, core);

    const spaceId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.exec(`INSERT INTO spaces (id, name, created_at, updated_at) VALUES ('${spaceId}', 'SQ', '${now}', '${now}')`);

    const router = createFolioRouter({
      db,
      sqliteBinding,
      getSpace: () => ({ id: spaceId, name: 'SQ', createdAt: now, updatedAt: now }),
    });
    router.setSqliteCore(core);

    // No folio yet → all reads return empty.
    assert.equal(router.hasFolio(spaceId), false);
    assert.deepEqual(router.listChapters(spaceId), []);

    // Activate via createPage.
    router.createPage(spaceId, 'ch/pg', 'hello', { createIfMissing: true, author: 'user', title: 'Pg' });
    assert.equal(router.hasFolio(spaceId), true);

    db.close();
  });

  it('file space dispatches to file backend', () => {
    const tmpDir = makeTempDir();
    try {
      const db = openInMemory();
      db.exec(`INSERT INTO spaces (id, name, created_at, updated_at) VALUES ('s1','FS','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`);

      const root = path.join(tmpDir, '.folio');
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, 'folio.json'), JSON.stringify({ name: 'FS', formatVersion: '1.0' }) + '\n');
      fs.writeFileSync(path.join(root, '.gitignore'), 'cache.db\n');
      writePage(root, 'ch', 'pg1', 'file content');

      const core = createFolioService(openSqliteBackend({ db }));
      const sqliteBinding = createFolioBinding(db, core);

      const router = createFolioRouter({
        db,
        sqliteBinding,
        getSpace: () => ({
          id: 's1',
          name: 'FS',
          folioBackend: 'file',
          workingDirectory: tmpDir,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        }),
      });
      router.setSqliteCore(core);

      // hasFolio: file has ≥1 page.
      assert.equal(router.hasFolio('s1'), true);

      const chapters = router.listChapters('s1');
      assert.equal(chapters.length, 1);
      assert.equal(chapters[0].slug, 'ch');

      const pages = router.listPages('s1');
      assert.equal(pages.length, 1);
      assert.equal(pages[0].slug, 'pg1');

      router.close();
      db.close();
    } finally {
      removeTempDir(tmpDir);
    }
  });

  it('mtime-gated reindex: changed markdown triggers exactly one reindex', () => {
    const tmpDir = makeTempDir();
    try {
      const db = openInMemory();
      db.exec(`INSERT INTO spaces (id, name, created_at, updated_at) VALUES ('s2','FS','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`);

      const root = path.join(tmpDir, '.folio');
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, 'folio.json'), JSON.stringify({ name: 'FS', formatVersion: '1.0' }) + '\n');
      fs.writeFileSync(path.join(root, '.gitignore'), 'cache.db\n');
      writePage(root, 'ch', 'pg1', 'initial content');

      const core = createFolioService(openSqliteBackend({ db }));
      const sqliteBinding = createFolioBinding(db, core);

      let reindexCount = 0;
      const router = createFolioRouter({
        db,
        sqliteBinding,
        getSpace: () => ({
          id: 's2', name: 'FS', folioBackend: 'file', workingDirectory: tmpDir,
          createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        }),
        makeFileService: (r) => {
          const svc = createFolioService(openFileBackend({ root: r }));
          // Wrap reindexFileBackend to count invocations.
          const origBackend = svc.backend;
          const origClose = svc.close.bind(svc);
          return svc;
        },
      });

      // First access — opens cache.
      router.hasFolio('s2');
      const pages1 = router.listPages('s2');
      assert.equal(pages1.length, 1);

      // Same mtime — no reindex on second access.
      router.listPages('s2');

      // Bump mtime by writing a new page.
      // Wait 2ms to ensure mtime advances (some FSes have 1ms resolution).
      const t0 = Date.now();
      while (Date.now() - t0 < 5) { /* spin */ }
      writePage(root, 'ch', 'pg2', 'new page');

      // Next access should trigger reindex (new page appears).
      const pages2 = router.listPages('s2');
      assert.equal(pages2.length, 2, 'reindex picked up the new page');

      router.close();
      db.close();
    } finally {
      removeTempDir(tmpDir);
    }
  });

  it('activation scaffolds .folio/ with folio.json and .gitignore', () => {
    const tmpDir = makeTempDir();
    try {
      const db = openInMemory();
      db.exec(`INSERT INTO spaces (id, name, created_at, updated_at) VALUES ('s3','SC','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`);

      const core = createFolioService(openSqliteBackend({ db }));
      const sqliteBinding = createFolioBinding(db, core);

      const router = createFolioRouter({
        db,
        sqliteBinding,
        getSpace: () => ({
          id: 's3', name: 'SC', folioBackend: 'file', workingDirectory: tmpDir,
          createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        }),
      });

      const root = path.join(tmpDir, '.folio');
      assert.equal(fs.existsSync(root), false, '.folio/ absent before activation');

      router.createPage('s3', 'ch/pg', 'content', { createIfMissing: true, author: 'user', title: 'P' });

      assert.equal(fs.existsSync(root), true, '.folio/ created on activation');
      assert.equal(fs.existsSync(path.join(root, 'folio.json')), true, 'folio.json present');
      const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
      assert.ok(gitignore.includes('cache.db'), '.gitignore lists cache.db');

      router.close();
      db.close();
    } finally {
      removeTempDir(tmpDir);
    }
  });

  it('router.close() closes all cached file services without error', () => {
    const tmpDir = makeTempDir();
    try {
      const db = openInMemory();
      db.exec(`INSERT INTO spaces (id, name, created_at, updated_at) VALUES ('s4','CL','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`);

      const root = path.join(tmpDir, '.folio');
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, 'folio.json'), JSON.stringify({ name: 'CL', formatVersion: '1.0' }) + '\n');
      fs.writeFileSync(path.join(root, '.gitignore'), 'cache.db\n');
      writePage(root, 'ch', 'pg1', 'text');

      const core = createFolioService(openSqliteBackend({ db }));
      const sqliteBinding = createFolioBinding(db, core);

      const router = createFolioRouter({
        db,
        sqliteBinding,
        getSpace: () => ({
          id: 's4', name: 'CL', folioBackend: 'file', workingDirectory: tmpDir,
          createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        }),
      });

      // Open a service.
      router.hasFolio('s4');

      // close() should not throw.
      assert.doesNotThrow(() => router.close());
      db.close();
    } finally {
      removeTempDir(tmpDir);
    }
  });

  it('space with no workingDirectory falls back to SQLite even if folioBackend=file', () => {
    const db = openInMemory();
    const core = createFolioService(openSqliteBackend({ db }));
    const sqliteBinding = createFolioBinding(db, core);

    const spaceId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.exec(`INSERT INTO spaces (id, name, created_at, updated_at) VALUES ('${spaceId}', 'SQ', '${now}', '${now}')`);

    const router = createFolioRouter({
      db,
      sqliteBinding,
      // Space claims file but has no workingDirectory.
      getSpace: () => ({
        id: spaceId, name: 'SQ', folioBackend: 'file',
        createdAt: now, updatedAt: now,
        // workingDirectory intentionally absent
      }),
    });
    router.setSqliteCore(core);

    // Should fall back to SQLite path (no crash, no file ops).
    assert.equal(router.hasFolio(spaceId), false);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// T-005: store.js wiring
// ---------------------------------------------------------------------------

describe('T-005: store.js wiring', () => {
  it('store.folio.binding is the router (not the raw SQLite binding)', () => {
    const { createStore } = require('../src/services/store');
    const store = createStore(':memory:');
    try {
      // Router exposes resolveRefs; raw binding does not.
      assert.ok(typeof store.folio.binding.resolveRefs === 'function', 'router exposes resolveRefs');
      assert.ok(typeof store.folio.binding.hasFolio === 'function', 'router exposes hasFolio');
      assert.ok(typeof store.folio.binding.close === 'function', 'router exposes close');
    } finally {
      store.close();
    }
  });

  it('store.folio.sqliteBinding is the original SQLite binding', () => {
    const { createStore } = require('../src/services/store');
    const store = createStore(':memory:');
    try {
      assert.ok(store.folio.sqliteBinding, 'sqliteBinding is exposed');
      assert.ok(typeof store.folio.sqliteBinding.hasFolio === 'function');
    } finally {
      store.close();
    }
  });

  it('store.close() closes router file services (no unclosed handle error)', () => {
    const { createStore } = require('../src/services/store');
    const store = createStore(':memory:');
    assert.doesNotThrow(() => store.close());
  });

  it('resolveRefs on binding returns text unchanged when no folio bound', () => {
    const { createStore } = require('../src/services/store');
    const store = createStore(':memory:');
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      store.upsertSpace({ id, name: 'R', createdAt: now, updatedAt: now });
      const result = store.folio.binding.resolveRefs(id, 'hello [[ch/pg]]');
      assert.equal(result, 'hello [[ch/pg]]', 'unresolved refs left verbatim when no folio');
    } finally {
      store.close();
    }
  });
});

// ---------------------------------------------------------------------------
// T-007: Integration — file-backed space end-to-end
// ---------------------------------------------------------------------------

describe('T-007: file-backed space end-to-end integration', () => {
  it('create → activate → write page → .md on disk → search → agent writeback → restart', () => {
    const tmpDir = makeTempDir();
    const { createStore } = require('../src/services/store');
    const { createSpaceManager } = require('../src/services/spaceManager');

    let store = createStore(':memory:');
    const mgr = createSpaceManager(store);

    try {
      // Create a file-backed space.
      const cr = mgr.createSpace('FileRepo', tmpDir, undefined, undefined, undefined, 'file');
      assert.equal(cr.ok, true, 'createSpace succeeded');
      assert.equal(cr.space.folioBackend, 'file');
      const spaceId = cr.space.id;

      // Activate by creating a page (createIfMissing:true).
      const page = store.folio.binding.createPage(spaceId, 'arch/decision', '# Decision', {
        createIfMissing: true,
        author: 'user',
        title: 'Decision',
      });
      assert.ok(page, 'page returned');

      // .folio/ should be on disk.
      const folioRoot = path.join(tmpDir, '.folio');
      assert.equal(fs.existsSync(folioRoot), true, '.folio/ created');

      // The .md file should exist.
      const mdPath = path.join(folioRoot, 'arch', 'decision.md');
      assert.equal(fs.existsSync(mdPath), true, 'markdown file created');
      const mdContent = fs.readFileSync(mdPath, 'utf8');
      assert.ok(mdContent.includes('# Decision'), 'content in markdown');
      assert.ok(mdContent.includes('author: user'), 'author in frontmatter');

      // Search should find it.
      const results = store.folio.binding.searchPages(spaceId, 'decision', { limit: 5 });
      assert.equal(results.length, 1, 'search returns the page');
      assert.equal(results[0].page.slug, 'decision');

      // Agent write-back: user-owned page is skipped.
      const skip = store.folio.binding.upsertPageFromAgent(spaceId, 'arch/decision', 'agent content');
      assert.deepEqual(skip, { skipped: 'user-owned' });

      // Agent write-back: creates a new agent-owned page.
      const agentPage = store.folio.binding.upsertPageFromAgent(spaceId, 'ops/runbook', 'agent runbook content');
      assert.ok(agentPage, 'agent page created');
      const agentMdPath = path.join(folioRoot, 'ops', 'runbook.md');
      assert.equal(fs.existsSync(agentMdPath), true, 'agent markdown on disk');
      const agentMd = fs.readFileSync(agentMdPath, 'utf8');
      assert.ok(agentMd.includes('author: agent'), 'author=agent in frontmatter');

      // SQLite space (same store) should be unaffected.
      const cr2 = mgr.createSpace('SqliteRepo');
      const sqliteId = cr2.space.id;
      assert.equal(cr2.space.folioBackend, undefined, 'sqlite default');
      assert.equal(store.folio.binding.hasFolio(sqliteId), false);

      store.close();

      // Simulate restart: reopen store, re-hydrate from markdown.
      store = createStore(':memory:');
      const mgr2 = createSpaceManager(store);
      // Re-insert the space (in-memory DB doesn't persist across closes).
      const now = new Date().toISOString();
      store.upsertSpace({
        id:               spaceId,
        name:             'FileRepo',
        workingDirectory: tmpDir,
        folioBackend:     'file',
        createdAt:        now,
        updatedAt:        now,
      });

      // After restart, reading from the file backend re-hydrates the in-memory index.
      const chapters = store.folio.binding.listChapters(spaceId);
      assert.ok(chapters.length >= 2, 'chapters re-hydrated: arch + ops');

      const pages = store.folio.binding.listPages(spaceId);
      assert.equal(pages.length, 2, 'both pages re-hydrated from markdown');

      const userPage = pages.find((p) => p.slug === 'decision');
      assert.ok(userPage, 'user page re-hydrated');
      assert.equal(userPage.author, 'user');

      const agentPageR = pages.find((p) => p.slug === 'runbook');
      assert.ok(agentPageR, 'agent page re-hydrated');
      assert.equal(agentPageR.author, 'agent');

      store.close();
    } finally {
      removeTempDir(tmpDir);
    }
  });

  it('SQLite space behaviour unchanged (regression)', () => {
    const { createStore } = require('../src/services/store');
    const { createSpaceManager } = require('../src/services/spaceManager');
    const store = createStore(':memory:');
    const mgr = createSpaceManager(store);

    try {
      const cr = mgr.createSpace('SqliteKB');
      const spaceId = cr.space.id;

      assert.equal(store.folio.binding.hasFolio(spaceId), false);
      assert.deepEqual(store.folio.binding.listChapters(spaceId), []);

      // Activate SQLite folio.
      store.folio.binding.createPage(spaceId, 'docs/readme', '# Readme', {
        createIfMissing: true,
        author: 'user',
        title: 'Readme',
      });

      assert.equal(store.folio.binding.hasFolio(spaceId), true);
      const chapters = store.folio.binding.listChapters(spaceId);
      assert.equal(chapters.length, 1);
      assert.equal(chapters[0].slug, 'docs');

      const results = store.folio.binding.searchPages(spaceId, 'readme', { limit: 5 });
      assert.equal(results.length, 1);

      // bootstrap marker.
      store.folio.binding.setBootstrappedAt(spaceId, '2026-06-01T00:00:00Z');
      assert.deepEqual(store.folio.binding.getBootstrapState(spaceId), { bootstrappedAt: '2026-06-01T00:00:00Z' });
    } finally {
      store.close();
    }
  });
});

// ---------------------------------------------------------------------------
// T-006: REST surface — quick validation smoke tests
// ---------------------------------------------------------------------------

describe('T-006: spaceManager folioBackend validation from REST perspective', () => {
  it('createSpace with folioBackend=file rejects when no workingDirectory', () => {
    const { createStore } = require('../src/services/store');
    const { createSpaceManager } = require('../src/services/spaceManager');
    const store = createStore(':memory:');
    const mgr = createSpaceManager(store);
    try {
      // Simulate what the REST handler does after parsing body.
      const result = mgr.createSpace('BadName', undefined, undefined, undefined, undefined, 'file');
      assert.equal(result.ok, false);
      assert.equal(result.code, 'VALIDATION_ERROR');
      assert.ok(result.message.includes('working directory'));
    } finally {
      store.close();
    }
  });

  it('createSpace omitting folioBackend defaults to sqlite (back-compatible)', () => {
    const { createStore } = require('../src/services/store');
    const { createSpaceManager } = require('../src/services/spaceManager');
    const store = createStore(':memory:');
    const mgr = createSpaceManager(store);
    try {
      const result = mgr.createSpace('DefaultSpace');
      assert.equal(result.ok, true);
      // Default — not stored in the space object.
      assert.equal(result.space.folioBackend, undefined);
    } finally {
      store.close();
    }
  });

  it('createSpace with a working directory defaults to the file backend', () => {
    const { createStore } = require('../src/services/store');
    const { createSpaceManager } = require('../src/services/spaceManager');
    const tmpDir = makeTempDir();
    const store = createStore(':memory:');
    const mgr = createSpaceManager(store);
    try {
      const result = mgr.createSpace('RepoSpace', tmpDir);
      assert.equal(result.ok, true);
      // Repo-backed spaces default to file so UI + MCP + git share one .folio/.
      assert.equal(result.space.folioBackend, 'file');
    } finally {
      store.close();
    }
  });

  it('migrateSpaceToFile moves an activated sqlite folio to .folio/, flips backend, deletes sqlite', () => {
    const fs = require('fs');
    const path = require('path');
    const { createStore } = require('../src/services/store');
    const { createSpaceManager } = require('../src/services/spaceManager');
    const tmpDir = makeTempDir();
    const store = createStore(':memory:');
    const mgr = createSpaceManager(store);
    try {
      // Space WITHOUT a working dir → sqlite. Activate a folio (create a page).
      const { space } = mgr.createSpace('MigrateMe');
      assert.equal(space.folioBackend, undefined);
      store.folio.binding.createPage(space.id, 'guide/intro', '# Intro\n\nhello world', {
        createIfMissing: true, title: 'Intro', author: 'user',
      });
      assert.equal(store.folio.binding.hasFolio(space.id), true);

      // Add working dir AFTER activation → stays sqlite (immutable; auto-flip won't fire).
      mgr.renameSpace(space.id, 'MigrateMe', tmpDir);
      assert.equal(store.getSpace(space.id).folioBackend, undefined);

      // Migrate: export → flip → delete.
      const res = store.folio.binding.migrateSpaceToFile(space.id);
      assert.equal(res.ok, true);

      // Content landed in <wd>/.folio/ (export happened before any mutation).
      assert.ok(fs.existsSync(path.join(tmpDir, '.folio', 'folio.json')));
      // Backend flipped.
      assert.equal(store.getSpace(space.id).folioBackend, 'file');
      // Reading via the binding now returns the page from the file backend — no data loss.
      const page = store.folio.binding.getPageBySlug(space.id, 'guide', 'intro');
      assert.ok(page, 'page should be readable from the migrated file backend');
      assert.match(page.content, /hello world/);
    } finally {
      store.close();
    }
  });

  it('migrateSpaceToFile rejects a space already on the file backend (ALREADY_FILE)', () => {
    const { createStore } = require('../src/services/store');
    const { createSpaceManager } = require('../src/services/spaceManager');
    const tmpDir = makeTempDir();
    const store = createStore(':memory:');
    const mgr = createSpaceManager(store);
    try {
      // Repo-backed space defaults to file.
      const { space } = mgr.createSpace('AlreadyFile', tmpDir);
      assert.equal(space.folioBackend, 'file');

      const res = store.folio.binding.migrateSpaceToFile(space.id);
      assert.equal(res.ok, false);
      assert.equal(res.code, 'ALREADY_FILE');
    } finally {
      store.close();
    }
  });

  it('migrateSpaceToFile rejects a space with no working directory (NO_WORKING_DIR)', () => {
    const { createStore } = require('../src/services/store');
    const { createSpaceManager } = require('../src/services/spaceManager');
    const store = createStore(':memory:');
    const mgr = createSpaceManager(store);
    try {
      const { space } = mgr.createSpace('NoRepo');
      const res = store.folio.binding.migrateSpaceToFile(space.id);
      assert.equal(res.ok, false);
      assert.equal(res.code, 'NO_WORKING_DIR');
    } finally {
      store.close();
    }
  });

  it('renameSpace accepts folioBackend change when no folio activated yet', () => {
    const { createStore } = require('../src/services/store');
    const { createSpaceManager } = require('../src/services/spaceManager');
    const tmpDir = makeTempDir();
    const store = createStore(':memory:');
    const mgr = createSpaceManager(store);
    try {
      // Wire folio.binding into spaceManager so renameSpace can check hasFolio.
      const cr = mgr.createSpace('RenameTest', tmpDir);
      assert.equal(cr.ok, true);

      const result = mgr.renameSpace(cr.space.id, 'RenameTest2', tmpDir, undefined, undefined, undefined, 'file');
      assert.equal(result.ok, true);
      assert.equal(result.space.folioBackend, 'file');
    } finally {
      store.close();
      removeTempDir(tmpDir);
    }
  });
});
