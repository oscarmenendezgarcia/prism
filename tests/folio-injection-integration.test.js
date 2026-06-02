'use strict';

/**
 * Folio injection — integration tests.
 *
 * Deliberately split into two layers so the design docs can evolve freely:
 *
 *  1. FROZEN FIXTURE (tests/fixtures/folio-sample/) — stable content with known
 *     chapters (architecture/, decisions/, ux/, data-model/) and vocabulary.
 *     ALL content-coupled assertions live here: per-stage relevance (architect
 *     vs UX surface different pages), specific chapters surfacing. This fixture
 *     never changes, so these assertions are deterministic.
 *
 *  2. LIVE .folio/ (repo root) — a GENERIC SMOKE TEST only. Asserts invariants
 *     that hold for ANY folio: it loads, produces a non-null context with an
 *     index, every stage stays within caps, and an unbound space returns null.
 *     It makes NO assumptions about chapter names or BM25 ranking, so editing
 *     the design documentation never breaks it.
 *
 * Why the split: the root .folio/ is the project's living design doc. Coupling
 * relevance assertions to its exact content made the test brittle — a docs edit
 * (e.g. the Spanish→English translation) broke it. The fixture decouples them.
 *
 * Run with: node --test tests/folio-injection-integration.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

const { applyBindingSchema, createFolioBinding } = require('../src/services/folioBinding');
const { createFolioService, openFileBackend }    = require('../src/services/folio/index');
const { countTokens }                            = require('../src/services/folio/tokens');
const { STAGE_DESCRIPTORS, DEFAULT_STAGES }      = require('../src/services/pipelineManager');

// Calibrated on the FROZEN fixture (not the live docs), so it cannot drift.
const SCORE_THRESHOLD = 1.3;
const PINNED_BOOST    = 1.0;

/**
 * Load a `.folio/` directory into an in-memory folio bound to a fresh space.
 * Returns { binding, spaceId } or null when the directory is absent / empty.
 */
function loadFolio(root, spaceId) {
  if (!fs.existsSync(root)) return null;

  const fileBackend = openFileBackend({ root });
  const service     = createFolioService(fileBackend);
  const db          = fileBackend.db;  // share the backend's hydrated in-memory DB

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
  applyBindingSchema(db);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO spaces (id, name, created_at, updated_at) VALUES (?, 'Test Space', ?, ?)`,
  ).run(spaceId, now, now);

  const folios = service.listFolios();
  if (!folios.length) return null;
  db.prepare('INSERT INTO space_folios (space_id, folio_id) VALUES (?, ?)').run(spaceId, folios[0].id);

  return { binding: createFolioBinding(db, service), spaceId };
}

// A neutral task base; the per-stage DESCRIPTOR is what drives differentiation.
const BASE = 'Implement the feature end to end with full context';
const archQuery = `${BASE} ${STAGE_DESCRIPTORS['senior-architect']}`;
const uxQuery   = `${BASE} ${STAGE_DESCRIPTORS['ux-api-designer']}`;
const OPTS = { scoreThreshold: SCORE_THRESHOLD, pinnedBoost: PINNED_BOOST };

// ===========================================================================
// 1. Frozen fixture — content-coupled relevance assertions
// ===========================================================================

describe('folio injection — frozen fixture (content-coupled relevance)', () => {
  let ctx;

  before(() => {
    ctx = loadFolio(path.join(__dirname, 'fixtures', 'folio-sample'), 'fixture-space');
    assert.ok(ctx, 'frozen fixture must load (tests/fixtures/folio-sample/)');
  });

  it('architect query surfaces architecture/decisions pages', () => {
    const r = ctx.binding.buildInjectionContext(ctx.spaceId, archQuery, OPTS);
    assert.notEqual(r, null);
    assert.ok(r.inline.length >= 1,
      `architect should inline >=1 page; got ${JSON.stringify(r.inline.map((i) => i.slug))}`);
    const slugs = [...r.inline, ...r.referenced].map((x) => x.slug);
    const arch  = slugs.filter((s) => s.startsWith('architecture/') || s.startsWith('decisions/'));
    assert.ok(arch.length >= 1, `architecture/decisions expected; got ${JSON.stringify(slugs)}`);
  });

  it('UX query surfaces ux/ pages', () => {
    const r = ctx.binding.buildInjectionContext(ctx.spaceId, uxQuery, OPTS);
    assert.notEqual(r, null);
    const slugs = [...r.inline, ...r.referenced].map((x) => x.slug);
    assert.ok(slugs.some((s) => s.startsWith('ux/')), `ux/ pages expected; got ${JSON.stringify(slugs)}`);
  });

  it('architect and UX queries surface DIFFERENT inline pages (per-stage relevance)', () => {
    const a = ctx.binding.buildInjectionContext(ctx.spaceId, archQuery, OPTS);
    const u = ctx.binding.buildInjectionContext(ctx.spaceId, uxQuery, OPTS);
    assert.ok(a.inline.length > 0 && u.inline.length > 0, 'both stages should inline something');
    const aSlugs = a.inline.map((i) => i.slug).sort().join(',');
    const uSlugs = u.inline.map((i) => i.slug).sort().join(',');
    assert.notEqual(aSlugs, uSlugs, 'architect and UX must surface different inline pages');
  });

  it('respects maxInlinePages and tokens accounting', () => {
    const r = ctx.binding.buildInjectionContext(ctx.spaceId, archQuery,
      { ...OPTS, maxInlinePages: 3, maxInlineTokens: 1500 });
    assert.ok(r.inline.length <= 3, 'inline cap (3) respected');
    assert.equal(r.tokens, countTokens(r.text), 'tokens field equals countTokens(text)');
  });
});

// ===========================================================================
// 2. Live repo-root .folio/ — generic smoke test (no content assumptions)
// ===========================================================================

describe('folio injection — live .folio/ smoke (generic invariants only)', () => {
  let ctx;

  before(() => {
    ctx = loadFolio(path.join(__dirname, '..', '.folio'), 'live-space');
  });

  function guard(t) { if (!ctx) t.skip('.folio/ fixture missing'); }

  it('loads the design folio and produces a non-null context with an index', (t) => {
    guard(t);
    const r = ctx.binding.buildInjectionContext(ctx.spaceId, 'architecture design schema decisions storage', OPTS);
    assert.notEqual(r, null, 'a bound space returns a context');
    assert.ok(r.text.includes('Index'), 'Layer-1 index present');
  });

  it('every default stage stays within caps over the live folio', (t) => {
    guard(t);
    for (const agentId of DEFAULT_STAGES) {
      const r = ctx.binding.buildInjectionContext(ctx.spaceId, STAGE_DESCRIPTORS[agentId] ?? agentId,
        { ...OPTS, maxInlinePages: 3, maxInlineTokens: 1500 });
      assert.ok(r.inline.length <= 3, `${agentId}: inline <= 3`);
      assert.equal(r.tokens, countTokens(r.text), `${agentId}: tokens accurate`);
    }
  });

  it('zero-cost: an unbound space produces no FOLIO block (null)', (t) => {
    guard(t);
    const r = ctx.binding.buildInjectionContext('unbound-' + crypto.randomUUID().slice(0, 8), 'any query', OPTS);
    assert.equal(r, null, 'unbound space returns null');
  });
});
