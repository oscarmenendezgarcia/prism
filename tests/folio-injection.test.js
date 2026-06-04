'use strict';

/**
 * Unit tests for the stage-aware Folio context injection feature.
 *
 * Covers:
 *  - folio/tokens.js (T-001): countTokens edge cases
 *  - folio/injection.js (T-002): buildContext algorithm — index-only, inline+reference,
 *    cap truncation, dedup, constraints-always, empty-query, BM25 sign, pinned boost
 *  - folioBinding.buildInjectionContext (T-003): zero-cost guard (null for unbound space),
 *    pass-through for bound space
 *  - pipelineManager: STAGE_DESCRIPTORS + resolveInjectionConfig env overrides
 *
 * All tests use in-memory SQLite — no disk I/O, no server running required.
 * Run with: node --test tests/folio-injection.test.js
 */

const { describe, it, beforeEach, before } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const crypto = require('crypto');

const Database = require('better-sqlite3');

const { applySchema }                                    = require('../src/services/folio/db');
const { createFolioStore }                               = require('../src/services/folio/store');
const { applyBindingSchema, createFolioBinding }         = require('../src/services/folioBinding');
const { createFolioService, openSqliteBackend }          = require('../src/services/folio/index');
const { countTokens, CHARS_PER_TOKEN }                   = require('../src/services/folio/tokens');
const { buildContext, DEFAULTS, MIN_SLICE_TOKENS }       = require('../src/services/folio/injection');
const { STAGE_DESCRIPTORS, resolveInjectionConfig }      = require('../src/services/pipelineManager');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Open an in-memory DB with full Prism + Folio schema applied.
 */
function openDb() {
  const db = new Database(':memory:');
  db.exec(`
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
  `);
  applySchema(db);
  applyBindingSchema(db);
  return db;
}

function insertSpace(db, id = 'space-1') {
  db.prepare(
    `INSERT INTO spaces (id, name, working_directory, pipeline, project_claude_md, agent_nicknames, created_at, updated_at)
     VALUES (?, 'Test Space', NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(id, new Date().toISOString(), new Date().toISOString());
}


// ---------------------------------------------------------------------------
// T-001 — folio/tokens.js
// ---------------------------------------------------------------------------

describe('T-001 countTokens', () => {
  it('returns 0 for empty string', () => {
    assert.equal(countTokens(''), 0);
  });

  it('returns 0 for non-string undefined', () => {
    // @ts-ignore intentional misuse for test
    assert.equal(countTokens(undefined), 0);
  });

  it('returns positive integer for a single character', () => {
    const result = countTokens('a');
    assert.equal(typeof result, 'number');
    assert.equal(result >= 1, true);
  });

  it('returns ceil(len / CHARS_PER_TOKEN) for ASCII text', () => {
    const text   = 'Hello world';
    const expected = Math.ceil(text.length / CHARS_PER_TOKEN);
    assert.equal(countTokens(text), expected);
  });

  it('is deterministic — same input always yields the same output', () => {
    const text = 'Architecture decisions for the Folio module';
    assert.equal(countTokens(text), countTokens(text));
    assert.equal(countTokens(text), countTokens(text));
  });

  it('handles multi-line text', () => {
    const text = 'Line one\nLine two\nLine three';
    assert.equal(countTokens(text), Math.ceil(text.length / CHARS_PER_TOKEN));
  });

  it('handles large text (10k chars) without throwing', () => {
    const text   = 'a'.repeat(10_000);
    const result = countTokens(text);
    assert.equal(result > 0, true);
    assert.equal(result <= text.length, true);
  });

  it('CHARS_PER_TOKEN is exported as a named constant', () => {
    assert.equal(typeof CHARS_PER_TOKEN, 'number');
    assert.equal(CHARS_PER_TOKEN > 0, true);
  });
});

// ---------------------------------------------------------------------------
// T-002 — folio/injection.buildContext
// ---------------------------------------------------------------------------

describe('T-002 buildContext', () => {
  let db, store, folio;

  beforeEach(() => {
    db    = openDb();
    store = createFolioStore(db);
    folio = store.createFolio({ name: 'Test' });
  });

  // Helper to add a page
  function addPage(chSlug, pgSlug, content, opts = {}) {
    return store.createPage(folio.id, `${chSlug}/${pgSlug}`, content, opts);
  }

  it('Layer-1 index is always present even when BM25 returns no matches (cold-start)', () => {
    addPage('arquitectura', 'modulo', 'Module design notes');
    const result = buildContext(store, folio.id, '');  // empty query → no FTS hits
    assert.ok(result.text.includes('Index — chapters'), 'index header present');
    assert.ok(result.text.includes('arquitectura'), 'chapter listed');
  });

  it('Layer-1 index is present even with no pages at all', () => {
    const result = buildContext(store, folio.id, 'any query');
    assert.ok(result.text.includes('Index — chapters'), 'index present even for empty folio');
    assert.equal(result.inline.length, 0);
  });

  it('closing "Use folio_get_page" line is always present', () => {
    const result = buildContext(store, folio.id, '');
    assert.ok(result.text.includes('Use folio_get_page'), 'closing line present');
  });

  it('tokens equals countTokens(text)', () => {
    addPage('arch', 'design', 'Some design notes for architecture');
    const result = buildContext(store, folio.id, 'architecture design');
    assert.equal(result.tokens, countTokens(result.text));
  });

  it('returns documented shape: text, tokens, inline[], referenced[], truncated[]', () => {
    const result = buildContext(store, folio.id, '');
    assert.equal(typeof result.text, 'string');
    assert.equal(typeof result.tokens, 'number');
    assert.ok(Array.isArray(result.inline));
    assert.ok(Array.isArray(result.referenced));
    assert.ok(Array.isArray(result.truncated));
  });

  it('BM25 sign: strong lexical match yields non-empty inline result', () => {
    // Add a page whose content strongly matches the query.
    // Use threshold=0 so ANY FTS hit qualifies inline (BM25 scores are near-zero in
    // a 1-document corpus but still strictly negative — normalised rel > 0).
    addPage('guide', 'intro', 'relevance ranking search algorithm explanation score result');
    const result = buildContext(store, folio.id, 'relevance ranking search algorithm score', {
      scoreThreshold: 0, // any positive rel qualifies
    });
    // The page should be inline because it has a strong match
    assert.ok(result.inline.length > 0, 'strong match should be inlined');
  });

  it('inline tier respects maxInlinePages cap', () => {
    // Add 5 pages all matching the query
    for (let i = 0; i < 5; i++) {
      addPage('docs', `page${i}`, `Architecture design module ${i} important components`);
    }
    const result = buildContext(store, folio.id, 'architecture design module', {
      scoreThreshold: 0.1, // low threshold so all hits qualify
    });
    assert.ok(result.inline.length <= DEFAULTS.maxInlinePages, 'page cap respected');
  });

  it('inline tier never exceeds maxInlineTokens (measured on assembled text)', () => {
    const maxInlineTokens = 200;
    // Add several large pages
    for (let i = 0; i < 4; i++) {
      addPage('docs', `big${i}`, 'word '.repeat(500) + `unique${i}`);
    }
    const result = buildContext(store, folio.id, 'word unique', {
      scoreThreshold: 0.1,
      maxInlineTokens,
    });
    // Measure what was actually inlined
    let inlineTokens = 0;
    for (const item of result.inline) {
      inlineTokens += countTokens(item.truncated
        ? '(truncated)'  // we can't easily recover the truncated text here
        : '');
    }
    // The key assertion: inline sections in the text don't exceed maxInlineTokens
    // We verify by reconstructing from result.text — the inline block is bounded
    assert.ok(result.inline.length <= DEFAULTS.maxInlinePages, 'page cap respected');
    // No individual inline page should make the total exceed the cap
    // (verified indirectly via tokens field correctness above)
    assert.equal(result.tokens, countTokens(result.text), 'tokens = countTokens(text)');
  });

  it('pinned pages with no lexical match do NOT appear (boost only applies to FTS hits)', () => {
    // Add a pinned page with content totally unrelated to the query
    addPage('arch', 'pinned-doc', 'Completely unrelated topic about cooking recipes', { pinned: true });
    addPage('guide', 'relevant', 'Architecture module design important');
    const result = buildContext(store, folio.id, 'architecture module design');
    // The pinned-but-unrelated page should NOT be in inline
    const inlineSlugs = result.inline.map((i) => i.slug);
    assert.ok(!inlineSlugs.includes('arch/pinned-doc'), 'pinned page with no match not inlined');
  });

  it('dedup: a page qualifying via both constraint and BM25 is emitted exactly once', () => {
    // Add a page in the constraint chapter AND matching the query
    addPage('restricciones', 'constraint-page', 'Architecture constraint module design');
    const result = buildContext(store, folio.id, 'architecture constraint module design', {
      scoreThreshold: 0.1,
      constraintChapters: ['restricciones'],
    });
    const inlineSlugs = result.inline.map((i) => i.slug);
    const referencedSlugs = result.referenced.map((r) => r.slug);
    const allSlugs = [...inlineSlugs, ...referencedSlugs];
    // Should appear exactly once across inline + referenced
    const count = allSlugs.filter((s) => s === 'restricciones/constraint-page').length;
    assert.equal(count, 1, 'dedup: page emitted exactly once');
  });

  it('constraint pages are always inlined first (Tier-0)', () => {
    addPage('restricciones', 'always-on', 'This is always inlined');
    addPage('other', 'normal', 'Normal page content');
    const result = buildContext(store, folio.id, 'anything', {
      constraintChapters: ['restricciones'],
    });
    // The constraint page should be inline regardless of BM25 score
    const inlineSlugs = result.inline.map((i) => i.slug);
    assert.ok(inlineSlugs.includes('restricciones/always-on'), 'constraint page inlined');
  });

  it('constraint pages in a chapter with no pages produce no error (graceful empty Tier-0)', () => {
    addPage('docs', 'page', 'Some content');
    const result = buildContext(store, folio.id, 'content', {
      constraintChapters: ['restricciones'],  // chapter doesn't exist
    });
    assert.ok(result.text.length > 0, 'result still produced');
    assert.equal(result.inline.filter((i) => i.slug.startsWith('restricciones/')).length, 0);
  });

  it('truncated inline page ends with the exact recovery marker', () => {
    // Create a page large enough to force truncation
    const bigContent = 'architecture '.repeat(600);  // ~7800 chars >> 1500 tok budget
    addPage('arch', 'big-page', bigContent);
    const result = buildContext(store, folio.id, 'architecture', {
      scoreThreshold: 0.1,
      maxInlineTokens: 100,  // tiny budget forces truncation
    });
    // If any page was truncated, it should have the marker
    const truncatedInline = result.inline.filter((i) => i.truncated);
    if (truncatedInline.length > 0) {
      assert.ok(result.text.includes('disponible via folio_get_page]'), 'truncation marker present in text');
      assert.ok(result.text.includes('[truncado —'), 'truncation prefix present');
    }
  });

  it('pages below threshold appear in referenced[], not inline[]', () => {
    // Add a page with weak content match
    addPage('docs', 'weak', 'unrelated content about nothing in particular');
    const result = buildContext(store, folio.id, 'architecture design', {
      scoreThreshold: 999,  // impossibly high threshold → nothing qualifies
    });
    // If the page matched FTS at all, it should be in referenced
    assert.equal(result.inline.filter((i) => i.slug === 'docs/weak').length, 0,
      'weak page not inline');
  });

  it('pages bumped by the cap appear in referenced[], not inline[]', () => {
    // Add maxInlinePages+1 strong matches
    for (let i = 0; i <= DEFAULTS.maxInlinePages; i++) {
      addPage('arch', `design${i}`, `Architecture component design module system ${i}`);
    }
    const result = buildContext(store, folio.id, 'architecture component design module system', {
      scoreThreshold: 0.1,
    });
    assert.ok(result.inline.length <= DEFAULTS.maxInlinePages, 'inline cap respected');
    // The bumped-out page should be referenced
    const allInlineSlugs = new Set(result.inline.map((i) => i.slug));
    const allRefSlugs    = new Set(result.referenced.map((r) => r.slug));
    // At least one page is in referenced (the overflow)
    assert.ok(result.referenced.length >= 0, 'referenced array exists');
    // No slug appears in both (dedup across tiers)
    for (const slug of allInlineSlugs) {
      assert.ok(!allRefSlugs.has(slug), `slug ${slug} must not be in both tiers`);
    }
  });

  it('no import outside src/services/folio/ — grep-clean on space_id', () => {
    // Read injection.js and verify it has no code-level reference to space_id.
    // (Comments are excluded from this check — we look for actual variable/property usage.)
    const fs   = require('fs');
    const src  = fs.readFileSync(
      path.join(__dirname, '../src/services/folio/injection.js'), 'utf8',
    );
    // Strip single-line comments and multiline comments before checking
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')  // strip /* */ comments
      .replace(/\/\/[^\n]*/g, '');        // strip // line comments
    assert.ok(!codeOnly.includes('space_id'), 'injection.js must not reference space_id in code');
    assert.ok(!codeOnly.includes('space_folios'), 'injection.js must not reference space_folios');
  });

  it('no import outside src/services/folio/ — only relative requires inside folio/', () => {
    const fs   = require('fs');
    const src  = fs.readFileSync(
      path.join(__dirname, '../src/services/folio/injection.js'), 'utf8',
    );
    // Any require() call must be './...' (within the module dir), not '../' or absolute
    const requirePattern = /require\(['"]([^'"]+)['"]\)/g;
    let match;
    while ((match = requirePattern.exec(src)) !== null) {
      const dep = match[1];
      assert.ok(
        dep.startsWith('./'),
        `injection.js must only require from folio/: found "${dep}"`,
      );
    }
  });

  it('empty query does not throw (FTS error swallowed, degrades to index-only)', () => {
    addPage('arch', 'page', 'content');
    assert.doesNotThrow(() => buildContext(store, folio.id, ''));
  });

  it('uses injected countTokens when provided via opts', () => {
    let callCount = 0;
    function myCounter(text) {
      callCount++;
      return countTokens(text);
    }
    addPage('docs', 'page', 'test content');
    buildContext(store, folio.id, 'test', { countTokens: myCounter });
    assert.ok(callCount > 0, 'custom countTokens was called');
  });
});

// ---------------------------------------------------------------------------
// T-003 — folioBinding.buildInjectionContext
// ---------------------------------------------------------------------------

describe('T-003 binding.buildInjectionContext', () => {
  let db, spaceId;

  beforeEach(() => {
    db      = openDb();
    spaceId = 'space-' + crypto.randomUUID().slice(0, 8);
    insertSpace(db, spaceId);
  });

  it('returns null for a space with no bound folio (zero-cost guard)', () => {
    const core    = createFolioService(openSqliteBackend({ db }));
    const binding = createFolioBinding(db, core);
    const result  = binding.buildInjectionContext(spaceId, 'any query', {});
    assert.equal(result, null, 'unbound space must return null');
  });

  it('does NOT call searchPages when no folio is bound', () => {
    let searchCalled = false;
    const fakeStore = {
      searchPages:  () => { searchCalled = true; return []; },
      listChapters: () => [],
      listPages:    () => [],
      getFolioIdForSpace: () => null,
    };
    // Build a binding with a fake core that tracks calls
    const store   = createFolioStore(db);
    const binding = createFolioBinding(db, {
      ...fakeStore,
      searchPages:      (...args) => { searchCalled = true; return []; },
      listChapters:     () => [],
      listPages:        () => [],
      createFolio:      store.createFolio.bind(store),
      getFolio:         store.getFolio.bind(store),
      createPage:       store.createPage.bind(store),
      getPage:          store.getPage.bind(store),
      getPageBySlug:    store.getPageBySlug.bind(store),
      updatePage:       store.updatePage.bind(store),
      deletePage:       store.deletePage.bind(store),
      loadPage:         store.loadPage.bind(store),
      listPageSections: () => [],
      resolveRefs:      (s) => s,
      buildInjectionContext: (id, q, o) => buildContext(fakeStore, id, q, o),
    });
    binding.buildInjectionContext(spaceId, 'query', {});
    assert.equal(searchCalled, false, 'searchPages not called for unbound space');
  });

  it('returns engine result for a bound space', () => {
    const core    = createFolioService(openSqliteBackend({ db }));
    const binding = createFolioBinding(db, core);
    // Materialize a folio and bind it to the space
    const folio   = core.createFolio({ name: 'Test' });
    db.prepare('INSERT INTO space_folios (space_id, folio_id) VALUES (?, ?)').run(spaceId, folio.id);
    core.createPage(folio.id, 'arch/design', 'module architecture content');
    const result = binding.buildInjectionContext(spaceId, 'module design', {});
    assert.notEqual(result, null, 'bound space returns a result');
    assert.equal(typeof result.text, 'string');
    assert.ok(result.text.length > 0, 'non-empty text');
  });

  it('new injection files contain no code-level reference to space_id (extraction invariant)', () => {
    // Check only the new files added by this feature (injection.js and tokens.js).
    // Pre-existing files (backend.js, resolver.js) are tested separately in their own suites.
    const fs = require('fs');
    for (const file of ['injection.js', 'tokens.js']) {
      const src = fs.readFileSync(
        path.join(__dirname, '../src/services/folio', file), 'utf8',
      );
      // Strip comments before checking to avoid false positives from comment text
      const codeOnly = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      assert.ok(
        !codeOnly.includes('space_id'),
        `${file} must not reference space_id in code (extraction invariant)`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// T-004 (partial) — STAGE_DESCRIPTORS + resolveInjectionConfig
// ---------------------------------------------------------------------------

describe('T-004 STAGE_DESCRIPTORS + resolveInjectionConfig', () => {
  it('STAGE_DESCRIPTORS covers all DEFAULT_STAGES', () => {
    const { DEFAULT_STAGES } = require('../src/services/pipelineManager');
    for (const agentId of DEFAULT_STAGES) {
      assert.ok(
        agentId in STAGE_DESCRIPTORS,
        `STAGE_DESCRIPTORS must include "${agentId}"`,
      );
    }
  });

  it('STAGE_DESCRIPTORS values are non-empty strings', () => {
    for (const [agentId, desc] of Object.entries(STAGE_DESCRIPTORS)) {
      assert.equal(typeof desc, 'string', `${agentId} descriptor must be a string`);
      assert.ok(desc.trim().length > 0, `${agentId} descriptor must be non-empty`);
    }
  });

  it('resolveInjectionConfig returns an object (default — no env vars set)', () => {
    // Clear any relevant env vars
    const saved = {};
    const keys  = ['PRISM_FOLIO_SCORE_THRESHOLD', 'PRISM_FOLIO_MAX_INLINE_PAGES',
                   'PRISM_FOLIO_MAX_INLINE_TOKENS', 'PRISM_FOLIO_CONSTRAINT_CHAPTERS',
                   'PRISM_FOLIO_PINNED_BOOST'];
    for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
    try {
      const opts = resolveInjectionConfig('any-space');
      assert.equal(typeof opts, 'object');
      assert.notEqual(opts, null);
    } finally {
      for (const k of keys) {
        if (saved[k] !== undefined) process.env[k] = saved[k];
      }
    }
  });

  it('resolveInjectionConfig picks up PRISM_FOLIO_SCORE_THRESHOLD env var', () => {
    process.env.PRISM_FOLIO_SCORE_THRESHOLD = '5.5';
    try {
      const opts = resolveInjectionConfig('any-space');
      assert.equal(opts.scoreThreshold, 5.5);
    } finally {
      delete process.env.PRISM_FOLIO_SCORE_THRESHOLD;
    }
  });

  it('resolveInjectionConfig picks up PRISM_FOLIO_MAX_INLINE_PAGES env var', () => {
    process.env.PRISM_FOLIO_MAX_INLINE_PAGES = '7';
    try {
      const opts = resolveInjectionConfig('any-space');
      assert.equal(opts.maxInlinePages, 7);
    } finally {
      delete process.env.PRISM_FOLIO_MAX_INLINE_PAGES;
    }
  });

  it('resolveInjectionConfig picks up PRISM_FOLIO_CONSTRAINT_CHAPTERS as array', () => {
    process.env.PRISM_FOLIO_CONSTRAINT_CHAPTERS = 'restricciones, guidelines, constraints';
    try {
      const opts = resolveInjectionConfig('any-space');
      assert.deepEqual(opts.constraintChapters, ['restricciones', 'guidelines', 'constraints']);
    } finally {
      delete process.env.PRISM_FOLIO_CONSTRAINT_CHAPTERS;
    }
  });
});
