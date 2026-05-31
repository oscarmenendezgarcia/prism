/**
 * Unit tests for mcp/folio-tools.js
 *
 * Drives `registerFolioTools` against a minimal in-memory McpServer test
 * double over an in-memory SQLite FolioService (no transport, no network).
 *
 * Coverage targets:
 *  - folio_search (success, empty results)
 *  - folio_get_page (whole-page, #section, invalid slug, not-found)
 *  - folio_list_chapters (with page counts)
 *  - folio_list_attachments (metadata-only, page-not-found)
 *  - folio_get_attachment (image, non-image, not-found)
 *  - folio_create_page (success, activation guard, conflict)
 *  - folio_update_page (success, not-found)
 *  - folio_delete_page (success, not-found)
 *  - folio_list (empty, populated)
 *  - folio_create (success)
 *  - folio_delete (SQLite backend success; file backend refusal)
 *
 * Run: node --test mcp/tests/folio-tools.test.js
 *      (from the prism project root)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

// CJS modules via createRequire (src/ is CommonJS)
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { applySchema }         = require('../../src/services/folio/db.js');
const { openSqliteBackend }   = require('../../src/services/folio/backend.js');
const { createFolioService }  = require('../../src/services/folio/index.js');

import { registerFolioTools } from '../folio-tools.js';

// ---------------------------------------------------------------------------
// Minimal McpServer test double
// ---------------------------------------------------------------------------

/**
 * A minimal stand-in for McpServer that records tool registrations so tests
 * can invoke handlers directly without any transport overhead.
 */
function makeTestServer() {
  const tools = new Map();
  return {
    tool(name, _description, _schema, handler) {
      tools.set(name, handler);
    },
    /** Invoke a registered tool handler and return its result. */
    async call(name, args = {}) {
      const handler = tools.get(name);
      if (!handler) throw new Error(`Tool "${name}" not registered`);
      return handler(args);
    },
    /** List registered tool names. */
    toolNames() { return [...tools.keys()]; },
  };
}

// ---------------------------------------------------------------------------
// Test service factory — in-memory SQLite
// ---------------------------------------------------------------------------

function makeService() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  const backend = openSqliteBackend({ db });
  return createFolioService(backend);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertOk(result) {
  assert.ok(!result.isError, `Expected ok but got error: ${result.content?.[0]?.text}`);
  assert.ok(Array.isArray(result.content) && result.content.length > 0, 'content must be non-empty');
}

function assertError(result, msgFragment) {
  assert.ok(result.isError, 'Expected isError to be true');
  const text = result.content?.[0]?.text ?? '';
  if (msgFragment) {
    assert.ok(
      text.toLowerCase().includes(msgFragment.toLowerCase()),
      `Expected error message to contain "${msgFragment}"; got: "${text}"`,
    );
  }
}

function parseContent(result) {
  return JSON.parse(result.content[0].text);
}

// ---------------------------------------------------------------------------
// Test suite setup (re-created per suite via beforeEach where needed)
// ---------------------------------------------------------------------------

let server;
let service;
let folioId;
let pageId;

describe('folio-tools registration', () => {
  it('should_register_all_11_tools', () => {
    const srv = makeTestServer();
    const svc = makeService();
    registerFolioTools(srv, svc);
    const names = srv.toolNames();
    const expected = [
      'folio_search', 'folio_get_page', 'folio_list_chapters',
      'folio_list_attachments', 'folio_get_attachment',
      'folio_create_page', 'folio_update_page', 'folio_delete_page',
      'folio_list', 'folio_create', 'folio_delete',
    ];
    for (const name of expected) {
      assert.ok(names.includes(name), `Tool "${name}" not registered`);
    }
    assert.strictEqual(names.length, 11);
  });
});

// ---------------------------------------------------------------------------
// folio_search
// ---------------------------------------------------------------------------

describe('folio_search', () => {
  beforeEach(() => {
    service = makeService();
    server  = makeTestServer();
    registerFolioTools(server, service);
    const folio = service.createFolio({ name: 'Search Test' });
    folioId = folio.id;
    service.createPage(folioId, 'redis/timeout', 'Timeout configuration for Redis clusters.');
    service.createPage(folioId, 'postgres/index', 'Index creation strategies for PostgreSQL.');
  });

  it('should_return_ranked_results_matching_query', async () => {
    const result = await server.call('folio_search', { query: 'Redis', folioId });
    assertOk(result);
    const results = parseContent(result);
    assert.ok(Array.isArray(results));
    assert.ok(results.length >= 1);
    assert.ok(results[0].slug === 'redis/timeout');
    assert.ok(typeof results[0].score === 'number');
    assert.ok(typeof results[0].snippet === 'string');
    assert.ok(results[0].snippet.length <= 200);
  });

  it('should_return_empty_array_when_no_match', async () => {
    const result = await server.call('folio_search', { query: 'mongodb', folioId });
    assertOk(result);
    const results = parseContent(result);
    assert.deepStrictEqual(results, []);
  });

  it('should_respect_limit_parameter', async () => {
    const result = await server.call('folio_search', { query: 'for', folioId, limit: 1 });
    assertOk(result);
    const results = parseContent(result);
    assert.ok(results.length <= 1);
  });
});

// ---------------------------------------------------------------------------
// folio_get_page
// ---------------------------------------------------------------------------

describe('folio_get_page', () => {
  beforeEach(() => {
    service = makeService();
    server  = makeTestServer();
    registerFolioTools(server, service);
    const folio = service.createFolio({ name: 'Get Page Test' });
    folioId = folio.id;
    service.createPage(folioId, 'runbooks/redis', '## Setup\nSetup instructions.\n\n## Tests\nRun with pytest.\n');
  });

  it('should_return_whole_page_by_slug', async () => {
    const result = await server.call('folio_get_page', { slug: 'runbooks/redis', folioId });
    assertOk(result);
    const page = parseContent(result);
    assert.strictEqual(page.slug, 'redis');
    assert.strictEqual(page.chapterSlug, 'runbooks');
  });

  it('should_return_section_for_hash_slug', async () => {
    const result = await server.call('folio_get_page', { slug: 'runbooks/redis#tests', folioId });
    assertOk(result);
    const text = result.content[0].text;
    assert.ok(text.includes('pytest'), `Expected section content; got: ${text}`);
  });

  it('should_return_error_for_unknown_section', async () => {
    const result = await server.call('folio_get_page', { slug: 'runbooks/redis#nonexistent', folioId });
    assertError(result, 'not found');
  });

  it('should_return_error_for_unknown_slug', async () => {
    const result = await server.call('folio_get_page', { slug: 'runbooks/missing', folioId });
    assertError(result, 'not found');
  });

  it('should_return_error_for_invalid_slug_format', async () => {
    const result = await server.call('folio_get_page', { slug: 'badslug', folioId });
    assertError(result, 'chapter/page');
  });
});

// ---------------------------------------------------------------------------
// folio_list_chapters
// ---------------------------------------------------------------------------

describe('folio_list_chapters', () => {
  beforeEach(() => {
    service = makeService();
    server  = makeTestServer();
    registerFolioTools(server, service);
    const folio = service.createFolio({ name: 'Chapter Test' });
    folioId = folio.id;
    service.createPage(folioId, 'arch/overview', 'Overview content.');
    service.createPage(folioId, 'arch/decisions', 'Decision log.');
    service.createPage(folioId, 'ops/runbook', 'Ops runbook.');
  });

  it('should_return_chapters_with_page_counts', async () => {
    const result = await server.call('folio_list_chapters', { folioId });
    assertOk(result);
    const chapters = parseContent(result);
    assert.ok(Array.isArray(chapters));
    assert.strictEqual(chapters.length, 2);
    const arch = chapters.find((c) => c.slug === 'arch');
    const ops  = chapters.find((c) => c.slug === 'ops');
    assert.ok(arch, 'arch chapter missing');
    assert.ok(ops,  'ops chapter missing');
    assert.strictEqual(arch.pages, 2);
    assert.strictEqual(ops.pages, 1);
    assert.ok(typeof arch.position === 'number');
  });

  it('should_return_empty_array_for_folio_with_no_pages', async () => {
    const emptyFolio = service.createFolio({ name: 'Empty' });
    const result = await server.call('folio_list_chapters', { folioId: emptyFolio.id });
    assertOk(result);
    assert.deepStrictEqual(parseContent(result), []);
  });
});

// ---------------------------------------------------------------------------
// folio_list_attachments + folio_get_attachment
// ---------------------------------------------------------------------------

describe('folio_list_attachments', () => {
  beforeEach(() => {
    service = makeService();
    server  = makeTestServer();
    registerFolioTools(server, service);
    const folio = service.createFolio({ name: 'Attachment Test' });
    folioId = folio.id;
    const page  = service.createPage(folioId, 'docs/readme', 'Documentation.');
    pageId      = page.id;
    service.addAttachment(folioId, pageId, {
      name:     'diagram.png',
      mimeType: 'image/png',
      data:     Buffer.from('PNG_BYTES'),
    });
    service.addAttachment(folioId, pageId, {
      name:     'notes.txt',
      mimeType: 'text/plain',
      data:     Buffer.from('plain text notes'),
    });
  });

  it('should_return_metadata_only_no_blob_bytes', async () => {
    const result = await server.call('folio_list_attachments', { slug: 'docs/readme', folioId });
    assertOk(result);
    const attachments = parseContent(result);
    assert.strictEqual(attachments.length, 2);
    for (const a of attachments) {
      assert.ok(a.id, 'id required');
      assert.ok(a.name, 'name required');
      assert.ok(a.mimeType, 'mimeType required');
      assert.strictEqual(a.data, undefined, 'data must not be present');
      assert.strictEqual(a.base64, undefined, 'base64 must not be present');
    }
  });

  it('should_return_error_for_unknown_page', async () => {
    const result = await server.call('folio_list_attachments', { slug: 'docs/missing', folioId });
    assertError(result, 'not found');
  });
});

describe('folio_get_attachment', () => {
  beforeEach(() => {
    service = makeService();
    server  = makeTestServer();
    registerFolioTools(server, service);
    const folio = service.createFolio({ name: 'Get Attachment Test' });
    folioId = folio.id;
    const page  = service.createPage(folioId, 'docs/spec', 'Spec content.');
    pageId      = page.id;
    service.addAttachment(folioId, pageId, {
      name:     'photo.png',
      mimeType: 'image/png',
      data:     Buffer.from('FAKE_PNG_DATA'),
    });
    service.addAttachment(folioId, pageId, {
      name:     'report.pdf',
      mimeType: 'application/pdf',
      data:     Buffer.from('FAKE_PDF_DATA'),
    });
  });

  it('should_return_image_type_content_for_image_mime', async () => {
    const result = await server.call('folio_get_attachment', {
      slug: 'docs/spec', name: 'photo.png', folioId,
    });
    assertOk(result);
    const content = result.content[0];
    assert.strictEqual(content.type, 'image');
    assert.ok(content.data, 'base64 data required');
    assert.strictEqual(content.mimeType, 'image/png');
  });

  it('should_return_text_envelope_for_non_image_mime', async () => {
    const result = await server.call('folio_get_attachment', {
      slug: 'docs/spec', name: 'report.pdf', folioId,
    });
    assertOk(result);
    const content = result.content[0];
    assert.strictEqual(content.type, 'text');
    const parsed = JSON.parse(content.text);
    assert.strictEqual(parsed.name, 'report.pdf');
    assert.strictEqual(parsed.mimeType, 'application/pdf');
    assert.ok(parsed.base64, 'base64 field required');
    assert.strictEqual(
      Buffer.from(parsed.base64, 'base64').toString(),
      'FAKE_PDF_DATA',
    );
  });

  it('should_return_error_for_unknown_attachment_name', async () => {
    const result = await server.call('folio_get_attachment', {
      slug: 'docs/spec', name: 'missing.txt', folioId,
    });
    assertError(result, 'not found');
  });

  it('should_return_error_for_unknown_page', async () => {
    const result = await server.call('folio_get_attachment', {
      slug: 'docs/ghost', name: 'file.txt', folioId,
    });
    assertError(result, 'not found');
  });
});

// ---------------------------------------------------------------------------
// folio_create_page
// ---------------------------------------------------------------------------

describe('folio_create_page', () => {
  beforeEach(() => {
    service = makeService();
    server  = makeTestServer();
    registerFolioTools(server, service);
    const folio = service.createFolio({ name: 'Create Page Test' });
    folioId = folio.id;
  });

  it('should_create_page_and_emerge_chapter', async () => {
    const result = await server.call('folio_create_page', {
      slug: 'arch/adr001', content: '# ADR-001\nDecision.', folioId,
    });
    assertOk(result);
    const page = parseContent(result);
    assert.strictEqual(page.slug, 'adr001');
    assert.strictEqual(page.chapterSlug, 'arch');
    assert.strictEqual(page.author, 'agent');
  });

  it('should_return_error_when_folio_not_active', async () => {
    const result = await server.call('folio_create_page', {
      slug: 'arch/adr001', content: 'Content.', folioId: 'nonexistent-folio-id',
    });
    assertError(result, 'folio not active');
  });

  it('should_return_conflict_error_for_duplicate_slug', async () => {
    await server.call('folio_create_page', {
      slug: 'arch/adr001', content: 'First.', folioId,
    });
    const result = await server.call('folio_create_page', {
      slug: 'arch/adr001', content: 'Second.', folioId,
    });
    assertError(result, 'conflict');
  });

  it('should_use_provided_title', async () => {
    const result = await server.call('folio_create_page', {
      slug: 'guides/intro', content: 'Intro.', folioId, title: 'Introduction Guide',
    });
    assertOk(result);
    assert.strictEqual(parseContent(result).title, 'Introduction Guide');
  });
});

// ---------------------------------------------------------------------------
// folio_update_page
// ---------------------------------------------------------------------------

describe('folio_update_page', () => {
  beforeEach(() => {
    service = makeService();
    server  = makeTestServer();
    registerFolioTools(server, service);
    const folio = service.createFolio({ name: 'Update Test' });
    folioId = folio.id;
    service.createPage(folioId, 'docs/readme', 'Original content.');
  });

  it('should_update_content_of_existing_page', async () => {
    const result = await server.call('folio_update_page', {
      slug: 'docs/readme', content: 'Updated content.', folioId,
    });
    assertOk(result);
    const page = parseContent(result);
    assert.strictEqual(page.content, 'Updated content.');
  });

  it('should_reflect_update_in_subsequent_get', async () => {
    await server.call('folio_update_page', {
      slug: 'docs/readme', content: 'New content.', folioId,
    });
    const getResult = await server.call('folio_get_page', {
      slug: 'docs/readme', folioId,
    });
    assertOk(getResult);
    assert.ok(getResult.content[0].text.includes('New content.'));
  });

  it('should_return_error_for_unknown_slug', async () => {
    const result = await server.call('folio_update_page', {
      slug: 'docs/missing', content: 'x', folioId,
    });
    assertError(result, 'not found');
  });
});

// ---------------------------------------------------------------------------
// folio_delete_page
// ---------------------------------------------------------------------------

describe('folio_delete_page', () => {
  beforeEach(() => {
    service = makeService();
    server  = makeTestServer();
    registerFolioTools(server, service);
    const folio = service.createFolio({ name: 'Delete Page Test' });
    folioId = folio.id;
    service.createPage(folioId, 'temp/scratch', 'Temp content.');
  });

  it('should_return_deleted_true_for_existing_page', async () => {
    const result = await server.call('folio_delete_page', {
      slug: 'temp/scratch', folioId,
    });
    assertOk(result);
    assert.deepStrictEqual(parseContent(result), { deleted: true });
  });

  it('should_return_deleted_false_for_unknown_slug', async () => {
    const result = await server.call('folio_delete_page', {
      slug: 'temp/ghost', folioId,
    });
    assertOk(result);
    assert.deepStrictEqual(parseContent(result), { deleted: false });
  });

  it('should_not_be_searchable_after_delete', async () => {
    await server.call('folio_delete_page', { slug: 'temp/scratch', folioId });
    const searchResult = await server.call('folio_search', {
      query: 'Temp content', folioId,
    });
    assertOk(searchResult);
    assert.deepStrictEqual(parseContent(searchResult), []);
  });
});

// ---------------------------------------------------------------------------
// folio_list
// ---------------------------------------------------------------------------

describe('folio_list', () => {
  it('should_return_empty_array_when_no_folios', async () => {
    const svc = makeService();
    const srv = makeTestServer();
    registerFolioTools(srv, svc);
    const result = await srv.call('folio_list', {});
    assertOk(result);
    assert.deepStrictEqual(parseContent(result), []);
  });

  it('should_return_all_folios', async () => {
    const svc = makeService();
    const srv = makeTestServer();
    registerFolioTools(srv, svc);
    svc.createFolio({ name: 'Alpha' });
    svc.createFolio({ name: 'Beta' });
    const result = await srv.call('folio_list', {});
    assertOk(result);
    const folios = parseContent(result);
    assert.strictEqual(folios.length, 2);
    assert.ok(folios.every((f) => f.id && f.name && f.createdAt));
    const names = folios.map((f) => f.name);
    assert.ok(names.includes('Alpha'));
    assert.ok(names.includes('Beta'));
  });
});

// ---------------------------------------------------------------------------
// folio_create
// ---------------------------------------------------------------------------

describe('folio_create', () => {
  it('should_create_folio_and_return_id_name_createdAt', async () => {
    const svc = makeService();
    const srv = makeTestServer();
    registerFolioTools(srv, svc);
    const result = await srv.call('folio_create', { name: 'My Knowledge Base' });
    assertOk(result);
    const folio = parseContent(result);
    assert.ok(folio.id, 'id required');
    assert.strictEqual(folio.name, 'My Knowledge Base');
    assert.ok(folio.createdAt, 'createdAt required');
  });

  it('should_make_folio_visible_in_folio_list', async () => {
    const svc = makeService();
    const srv = makeTestServer();
    registerFolioTools(srv, svc);
    const createResult = await srv.call('folio_create', { name: 'Listed Folio' });
    const { id }       = parseContent(createResult);
    const listResult   = await srv.call('folio_list', {});
    const folios       = parseContent(listResult);
    assert.ok(folios.some((f) => f.id === id));
  });
});

// ---------------------------------------------------------------------------
// folio_delete
// ---------------------------------------------------------------------------

describe('folio_delete — SQLite backend', () => {
  it('should_return_deleted_true_and_cascade_on_sqlite_backend', async () => {
    const svc = makeService();
    const srv = makeTestServer();
    registerFolioTools(srv, svc);
    const folio = svc.createFolio({ name: 'To Delete' });
    svc.createPage(folio.id, 'ch/pg', 'Some content.');

    const result = await srv.call('folio_delete', { folioId: folio.id });
    assertOk(result);
    assert.deepStrictEqual(parseContent(result), { deleted: true });

    // Folio should no longer appear in list
    const listResult = await srv.call('folio_list', {});
    const folios = parseContent(listResult);
    assert.ok(!folios.some((f) => f.id === folio.id));
  });

  it('should_return_deleted_false_for_unknown_folio', async () => {
    const svc = makeService();
    const srv = makeTestServer();
    registerFolioTools(srv, svc);
    const result = await srv.call('folio_delete', { folioId: 'unknown-id' });
    assertOk(result);
    assert.deepStrictEqual(parseContent(result), { deleted: false });
  });

  it('should_cascade_remove_all_pages_and_make_them_unsearchable', async () => {
    const svc = makeService();
    const srv = makeTestServer();
    registerFolioTools(srv, svc);
    const folio = svc.createFolio({ name: 'Cascade Test' });
    const fid   = folio.id;
    svc.createPage(fid, 'ch/pg1', 'Searchable page one.');
    svc.createPage(fid, 'ch/pg2', 'Searchable page two.');

    await srv.call('folio_delete', { folioId: fid });

    // All searches must return empty after cascade
    const searchResult = await srv.call('folio_search', {
      query: 'searchable', folioId: fid,
    });
    assertOk(searchResult);
    assert.deepStrictEqual(parseContent(searchResult), []);
  });
});

describe('folio_delete — file backend refusal', () => {
  it('should_refuse_deletion_on_file_backend', async () => {
    // Build a fake service with backend.kind = 'file'
    const db      = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    applySchema(db);
    const fakeFileBackend = {
      kind: 'file',
      db,
      persistPage: () => {},
      removePage:  () => {},
      flush:       () => {},
      close:       () => db.close(),
      root:        '/fake/.folio',
    };
    const svc = createFolioService(fakeFileBackend);
    const srv = makeTestServer();
    registerFolioTools(srv, svc);

    const result = await srv.call('folio_delete', { folioId: 'any-id' });
    assertError(result, 'file backend');
  });
});
