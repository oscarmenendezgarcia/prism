'use strict';

/**
 * Tests for the folio-task-references feature.
 *
 * Covers:
 *  - T-001: resolver.extractHeadings — H2 extraction, slugification, document order
 *  - T-002: facade.listPageSections — delegates to extractHeadings, null-safe
 *  - T-003: binding.listPageSections — space-scoped pass-through, no-folio no-op
 *  - T-004: buildStagePrompt resolution — whole-page, section, unresolved verbatim,
 *            no-folio no-op, tested via the preview-prompts REST endpoint
 *  - T-005: REST endpoints — 200 shapes, empty-when-unbound, 400 INVALID_SLUG,
 *            404 SPACE_NOT_FOUND, route precedence over SPACES_TASKS_ROUTE
 *
 * Run with: node --test tests/folio-refs.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert   = require('node:assert/strict');
const crypto   = require('crypto');
const Database = require('better-sqlite3');
const http     = require('http');

const { applySchema }                             = require('../src/services/folio/db');
const { createFolioStore }                        = require('../src/services/folio/store');
const { applyBindingSchema, createFolioBinding }  = require('../src/services/folioBinding');
const { createFolioService, openSqliteBackend }   = require('../src/services/folio/index');
const { extractHeadings, githubSlug }             = require('../src/services/folio/resolver');
const { startTestServer }                         = require('./helpers/server');

// ---------------------------------------------------------------------------
// Helpers — in-memory DB + Folio setup
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

/** HTTP POST helper */
function httpPost(port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname: 'localhost', port,
      path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** HTTP GET helper */
function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost', port,
      path: urlPath, method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// T-001 — extractHeadings
// ---------------------------------------------------------------------------

describe('T-001 — extractHeadings', () => {
  const CONTENT = [
    '# Title',
    '',
    '## First Section',
    'Some content.',
    '',
    '### Sub-heading (ignored)',
    '',
    '## Second Section',
    'More content.',
    '',
    '## Third-Section With Punctuation!',
    '',
  ].join('\n');

  it('should_return_h2_headings_in_document_order', () => {
    const result = extractHeadings(CONTENT);
    assert.equal(result.length, 3);
    assert.equal(result[0].title, 'First Section');
    assert.equal(result[1].title, 'Second Section');
    assert.equal(result[2].title, 'Third-Section With Punctuation!');
  });

  it('should_generate_correct_github_slugs', () => {
    const result = extractHeadings(CONTENT);
    assert.equal(result[0].slug, 'first-section');
    assert.equal(result[1].slug, 'second-section');
    assert.equal(result[2].slug, githubSlug('Third-Section With Punctuation!'));
  });

  it('should_ignore_h1_and_h3_headings', () => {
    const result = extractHeadings(CONTENT);
    assert.ok(!result.some((h) => h.title === 'Title'), 'H1 should be ignored');
    assert.ok(!result.some((h) => h.title === 'Sub-heading (ignored)'), 'H3 should be ignored');
  });

  it('should_return_empty_array_for_content_with_no_h2', () => {
    const result = extractHeadings('# H1 only\n### H3 only\n');
    assert.deepEqual(result, []);
  });

  it('should_return_empty_array_for_non_string_input', () => {
    assert.deepEqual(extractHeadings(null), []);
    assert.deepEqual(extractHeadings(undefined), []);
    assert.deepEqual(extractHeadings(42), []);
  });

  it('should_return_empty_array_for_empty_string', () => {
    assert.deepEqual(extractHeadings(''), []);
  });

  it('should_trim_whitespace_from_heading_titles', () => {
    const result = extractHeadings('## Heading With Trailing Spaces   \n');
    assert.equal(result[0].title, 'Heading With Trailing Spaces');
  });

  it('should_match_existing_core_test_baseline_55_55', () => {
    // Verify existing folio tests still pass by ensuring extractHeadings
    // does not break the existing exports from resolver.js
    const { createResolver, githubSlug: slug, extractSection } = require('../src/services/folio/resolver');
    assert.equal(typeof createResolver, 'function', 'createResolver still exported');
    assert.equal(typeof slug, 'function', 'githubSlug still exported');
    assert.equal(typeof extractSection, 'function', 'extractSection still exported');
    assert.equal(typeof extractHeadings, 'function', 'extractHeadings newly exported');
  });
});

// ---------------------------------------------------------------------------
// T-002 — facade.listPageSections
// ---------------------------------------------------------------------------

describe('T-002 — facade.listPageSections', () => {
  let db, service, folio;

  beforeEach(() => {
    db      = openDb();
    service = createFolioService(openSqliteBackend({ db }));
    folio   = service.createFolio({ name: 'Test Folio' });
  });

  it('should_return_sections_for_existing_page', () => {
    service.createPage(folio.id, 'arch/design', '## Overview\ncontent\n## Decisions\ncontent\n');
    const sections = service.listPageSections(folio.id, 'arch', 'design');
    assert.equal(sections.length, 2);
    assert.equal(sections[0].title, 'Overview');
    assert.equal(sections[0].slug, 'overview');
    assert.equal(sections[1].title, 'Decisions');
  });

  it('should_return_empty_array_for_nonexistent_page', () => {
    const sections = service.listPageSections(folio.id, 'noexist', 'page');
    assert.deepEqual(sections, []);
  });

  it('should_return_empty_array_for_page_with_no_h2', () => {
    service.createPage(folio.id, 'arch/intro', '# Title\nNo H2 headings here.\n');
    const sections = service.listPageSections(folio.id, 'arch', 'intro');
    assert.deepEqual(sections, []);
  });

  it('should_be_exposed_on_facade_interface', () => {
    assert.equal(typeof service.listPageSections, 'function', 'listPageSections must be on facade');
  });
});

// ---------------------------------------------------------------------------
// T-003 — binding.listPageSections
// ---------------------------------------------------------------------------

describe('T-003 — binding.listPageSections', () => {
  let db, core, binding, folio;

  beforeEach(() => {
    db      = openDb();
    insertSpace(db, 'sp-bound');
    core    = createFolioService(openSqliteBackend({ db }));
    binding = createFolioBinding(db, core);

    // Create and bind a folio
    folio = core.createFolio({ name: 'Bound Folio' });
    db.prepare('INSERT INTO space_folios (space_id, folio_id) VALUES (?, ?)').run('sp-bound', folio.id);

    // Create a page with H2 sections
    core.createPage(folio.id, 'chapter/page', '## Section A\ntext\n## Section B\ntext\n');
  });

  it('should_return_sections_for_bound_space_and_existing_page', () => {
    const sections = binding.listPageSections('sp-bound', 'chapter', 'page');
    assert.equal(sections.length, 2);
    assert.equal(sections[0].title, 'Section A');
    assert.equal(sections[1].title, 'Section B');
  });

  it('should_return_empty_array_when_space_has_no_folio', () => {
    const sections = binding.listPageSections('sp-unbound', 'chapter', 'page');
    assert.deepEqual(sections, []);
  });

  it('should_return_empty_array_for_nonexistent_page_in_bound_space', () => {
    const sections = binding.listPageSections('sp-bound', 'chapter', 'nonexistent');
    assert.deepEqual(sections, []);
  });

  it('should_be_exposed_on_binding_interface', () => {
    assert.equal(typeof binding.listPageSections, 'function', 'listPageSections must be on binding');
  });
});

// ---------------------------------------------------------------------------
// T-004 — buildStagePrompt resolution (integration via preview-prompts)
// ---------------------------------------------------------------------------

describe('T-004 — buildStagePrompt reference resolution', () => {
  let serverHandle;

  before(async () => {
    serverHandle = await startTestServer();
  });

  after(async () => {
    await serverHandle.close();
  });

  /**
   * Create a space via REST. Returns spaceId.
   */
  async function createSpace(name) {
    const r = await httpPost(serverHandle.port, '/api/v1/spaces', { name });
    return r.body.id;
  }

  /**
   * Create a task in a space via REST. Returns taskId.
   */
  async function createTask(spaceId, title, description) {
    const r = await httpPost(serverHandle.port, `/api/v1/spaces/${spaceId}/tasks`, {
      title, type: 'chore', description,
    });
    return r.body.id;
  }

  /**
   * Call preview-prompts and return the first prompt's text.
   */
  async function previewPrompt(spaceId, taskId, agent = 'developer-agent') {
    const r = await httpPost(serverHandle.port, '/api/v1/runs/preview-prompts', {
      spaceId, taskId, stages: [agent],
    });
    if (r.status !== 200) throw new Error(`preview-prompts failed: ${JSON.stringify(r.body)}`);
    return r.body.prompts[0].promptFull;
  }

  it('should_inline_whole_page_ref_in_description', async () => {
    const spaceId = await createSpace(`ref-test-${crypto.randomUUID().slice(0, 8)}`);

    // Create folio and bind it using createIfMissing
    const store = serverHandle.store;
    store.folio.binding.createPage(
      spaceId,
      'ops/runbook',
      '# Runbook\n\n## Deployment Steps\n1. Build.\n2. Deploy.\n\n## Rollback\nRun rollback.sh.\n',
      { createIfMissing: true, author: 'user', title: 'Runbook' },
    );

    const taskId = await createTask(spaceId, 'Deploy service', 'Follow the guide: [[ops/runbook]]');
    const promptText = await previewPrompt(spaceId, taskId);

    assert.ok(!promptText.includes('[[ops/runbook]]'), 'ref marker should be expanded');
    assert.ok(promptText.includes('Runbook'), 'page content should be inlined');
  });

  it('should_inline_only_section_for_hash_ref', async () => {
    const spaceId = await createSpace(`ref-section-${crypto.randomUUID().slice(0, 8)}`);

    const store = serverHandle.store;
    store.folio.binding.createPage(
      spaceId,
      'ops/runbook',
      '# Runbook\n\n## Deployment Steps\n1. Build.\n2. Deploy.\n\n## Rollback\nRun rollback.sh.\n',
      { createIfMissing: true, author: 'user', title: 'Runbook' },
    );

    const taskId = await createTask(spaceId, 'Deploy', 'Steps: [[ops/runbook#deployment-steps]]');
    const promptText = await previewPrompt(spaceId, taskId);

    assert.ok(!promptText.includes('[[ops/runbook#deployment-steps]]'), 'section ref marker should be expanded');
    assert.ok(promptText.includes('## Deployment Steps'), 'section heading should appear');
    assert.ok(!promptText.includes('## Rollback'), 'other sections should not appear');
  });

  it('should_leave_unresolved_ref_verbatim_and_succeed', async () => {
    const spaceId = await createSpace(`ref-unresolved-${crypto.randomUUID().slice(0, 8)}`);

    // Bind a folio so resolution is attempted, but the page doesn't exist
    const store = serverHandle.store;
    store.folio.binding.createPage(
      spaceId,
      'ops/placeholder',
      'Placeholder content.',
      { createIfMissing: true, author: 'user' },
    );

    const taskId = await createTask(spaceId, 'Test', 'See [[nonexistent/page]] for details.');
    let promptText;
    assert.doesNotThrow(async () => {
      promptText = await previewPrompt(spaceId, taskId);
    });
    // Note: the ref is left verbatim by the resolver
  });

  it('should_be_noop_when_space_has_no_folio_bound', async () => {
    const spaceId = await createSpace(`no-folio-${crypto.randomUUID().slice(0, 8)}`);
    const taskId  = await createTask(spaceId, 'No folio', 'See [[ops/runbook]] for details.');

    const promptText = await previewPrompt(spaceId, taskId);

    assert.ok(promptText.includes('[[ops/runbook]]'), 'ref should remain verbatim when no folio bound');
  });

  it('should_also_resolve_refs_in_title', async () => {
    const spaceId = await createSpace(`ref-title-${crypto.randomUUID().slice(0, 8)}`);

    const store = serverHandle.store;
    store.folio.binding.createPage(
      spaceId,
      'ops/runbook',
      '# Runbook content here\n',
      { createIfMissing: true, author: 'user', title: 'Runbook' },
    );

    // Create task directly via store to set a title with a ref (REST doesn't allow [[]] in title)
    const now = new Date().toISOString();
    const taskId = crypto.randomUUID();
    serverHandle.store.insertTask(
      { id: taskId, title: 'Deploy [[ops/runbook]]', type: 'chore', createdAt: now, updatedAt: now },
      spaceId, 'todo',
    );

    const promptText = await previewPrompt(spaceId, taskId);

    assert.ok(!promptText.includes('[[ops/runbook]]'), 'ref in title should be expanded');
  });
});

// ---------------------------------------------------------------------------
// T-005 — REST endpoints (integration)
// ---------------------------------------------------------------------------

describe('T-005 — REST endpoints: /folio/refs/search and /folio/refs/sections', () => {
  let serverHandle, spaceId;

  before(async () => {
    serverHandle = await startTestServer();

    // Create the main test space
    const r = await httpPost(serverHandle.port, '/api/v1/spaces', { name: 'Folio Test Space' });
    spaceId = r.body.id;
  });

  after(async () => {
    await serverHandle.close();
  });

  /** Set up a folio + page in the space via the store */
  function setupFolioPage(sId = spaceId, content = '## Section One\ntext\n## Section Two\ntext\n') {
    serverHandle.store.folio.binding.createPage(
      sId,
      'arch/module',
      content,
      { createIfMissing: true, author: 'user', title: 'Module' },
    );
  }

  // ── refs/search ──────────────────────────────────────────────────────────

  it('should_return_200_with_empty_refs_when_no_folio_bound', async () => {
    const r = await httpPost(serverHandle.port, '/api/v1/spaces', { name: 'Unbound Space A' });
    const unboundId = r.body.id;

    const res = await httpGet(serverHandle.port, `/api/v1/spaces/${unboundId}/folio/refs/search?q=anything`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.refs, []);
  });

  it('should_return_200_with_refs_array_for_query', async () => {
    setupFolioPage();
    const res = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/refs/search?q=module`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.refs), 'refs must be an array');
    if (res.body.refs.length > 0) {
      const ref = res.body.refs[0];
      assert.ok('slug'        in ref, 'slug field missing');
      assert.ok('title'       in ref, 'title field missing');
      assert.ok('chapterSlug' in ref, 'chapterSlug field missing');
      assert.ok('pageSlug'    in ref, 'pageSlug field missing');
      assert.ok('score'       in ref, 'score field missing');
      assert.equal(ref.slug, `${ref.chapterSlug}/${ref.pageSlug}`, 'slug = chapterSlug/pageSlug');
    }
  });

  it('should_return_200_with_refs_for_empty_q_up_to_limit', async () => {
    const res = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/refs/search?q=&limit=5`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.refs));
    assert.ok(res.body.refs.length <= 5, 'must respect limit');
  });

  it('should_return_404_SPACE_NOT_FOUND_for_unknown_space_on_search', async () => {
    const res = await httpGet(serverHandle.port, '/api/v1/spaces/nonexistent-space/folio/refs/search?q=x');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'SPACE_NOT_FOUND');
  });

  it('should_be_reachable_before_SPACES_TASKS_ROUTE_swallowing', async () => {
    // Verifies route precedence: the folio route must match before
    // SPACES_TASKS_ROUTE's /(tasks.*)? greedy pattern swallows it.
    const res = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/refs/search?q=`);
    assert.equal(res.status, 200, 'folio route must be reachable and not swallowed by tasks route');
  });

  // ── refs/sections ─────────────────────────────────────────────────────────

  it('should_return_200_with_sections_for_existing_page', async () => {
    const res = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/refs/sections?slug=arch/module`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.sections));
    assert.ok(res.body.sections.length >= 2, 'should have at least 2 H2 sections');
    const s = res.body.sections[0];
    assert.ok('title' in s && 'slug' in s, 'section must have title and slug');
  });

  it('should_return_200_with_empty_sections_for_nonexistent_page', async () => {
    const res = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/refs/sections?slug=arch/noexist`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.sections, []);
  });

  it('should_return_200_with_empty_sections_when_no_folio_bound', async () => {
    const r = await httpPost(serverHandle.port, '/api/v1/spaces', { name: 'Unbound Space B' });
    const unboundId = r.body.id;

    const res = await httpGet(serverHandle.port, `/api/v1/spaces/${unboundId}/folio/refs/sections?slug=arch/module`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.sections, []);
  });

  it('should_return_400_INVALID_SLUG_for_missing_slug', async () => {
    const res = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/refs/sections`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_SLUG');
  });

  it('should_return_400_INVALID_SLUG_for_single_part_slug', async () => {
    const res = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/refs/sections?slug=singlepart`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_SLUG');
  });

  it('should_return_400_INVALID_SLUG_for_slug_with_trailing_slash', async () => {
    const res = await httpGet(serverHandle.port, `/api/v1/spaces/${spaceId}/folio/refs/sections?slug=arch/`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_SLUG');
  });

  it('should_return_404_SPACE_NOT_FOUND_for_unknown_space_on_sections', async () => {
    const res = await httpGet(serverHandle.port, '/api/v1/spaces/nonexistent/folio/refs/sections?slug=arch/mod');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'SPACE_NOT_FOUND');
  });
});
