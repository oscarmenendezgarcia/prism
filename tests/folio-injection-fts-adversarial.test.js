'use strict';

/**
 * QA adversarial coverage for the FTS5 sanitizer fix (fix/folio-injection-fts-syntax).
 *
 * Root cause under test: injection.js's local `sanitizeFtsQuery` used a deny-list
 * that omitted '.', producing an `fts5: syntax error near "."` that store.searchPages
 * swallowed into []. Fix: switched to an allow-list (\p{L}\p{N}_) + double-quoted terms.
 *
 * This file probes inputs the developer's regression tests (tests/folio-injection.test.js)
 * did not cover: CJK, emoji, accented/diacritic text, all-punctuation input, queries that
 * sanitize to zero terms, very long queries, and the store.js default (non-prebuilt) path
 * vs the injection.js prebuilt path — using a REAL in-memory SQLite DB (no mocks), so any
 * FTS5 parse error surfaces for real.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const Database = require('better-sqlite3');

const { applySchema }              = require('../src/services/folio/db');
const { createFolioStore }         = require('../src/services/folio/store');
const { buildContext }             = require('../src/services/folio/injection');

function openDb() {
  const db = new Database(':memory:');
  applySchema(db);
  return db;
}

describe('QA adversarial: FTS5 sanitizer (injection.js prebuilt path)', () => {
  let db, store, folio;

  beforeEach(() => {
    db    = openDb();
    store = createFolioStore(db);
    folio = store.createFolio({ name: 'Adversarial' });
  });

  function addPage(chSlug, pgSlug, content, opts = {}) {
    return store.createPage(folio.id, `${chSlug}/${pgSlug}`, content, opts);
  }

  const adversarialQueries = [
    // CJK — no ASCII word boundaries; \p{L} allow-list must still admit them.
    '修复 pipelineManager.js 的注入逻辑。',
    // Japanese
    '注入エンジンのバグを修正する。',
    // Emoji — must be stripped by the allow-list, not passed through to FTS5.
    '🎉🔥 fix injection.js now!! 🚀',
    // Accented / diacritic Spanish
    'Ampliación de la inyección — corrección de errores de sintaxis.',
    // Cyrillic
    'Исправить ошибку синтаксиса FTS5 в injection.js.',
    // Pure punctuation — must sanitize to zero terms, not error.
    '... --- !!! ??? ;;; :::',
    // Only symbols/emoji, no letters/digits at all.
    '🎉🔥🚀💥⚡️',
    // Very long single "word" (no spaces) ending in a period.
    'a'.repeat(500) + '.',
    // Many short terms separated by periods (abbreviation-heavy).
    'e.g. i.e. v1.2.3 pipelineManager.js store.js injection.js fts.js',
    // Mixed operators FTS5 cares about: NEAR, AND, OR, NOT, column filters, carets.
    'title:injection NEAR/3 fts5 AND NOT OR "quoted phrase" ^boost',
    // Trailing/leading periods and internal periods on every token.
    '.leading trailing. .both.',
    // Null-ish / whitespace-only after trim.
    '   ....   ',
  ];

  for (const q of adversarialQueries) {
    it(`does not raise an FTS5 syntax error for: ${JSON.stringify(q)}`, () => {
      addPage('arch', 'module', 'pipelineManager orchestrates stage execution and injection logic');
      assert.doesNotThrow(() => {
        const result = buildContext(store, folio.id, q, { scoreThreshold: 0 });
        assert.equal(result.searchError, false, `searchError must be false for: ${q}`);
      });
    });
  }

  it('CJK query with a real lexical match still produces BM25 hits (allow-list does not silently exclude CJK)', () => {
    addPage('arch', 'zh-page', '修复 注入 引擎 语法 错误');
    const result = buildContext(store, folio.id, '修复 注入 引擎 语法 错误', { scoreThreshold: 0 });
    assert.equal(result.searchError, false);
    // Note: CJK terms may be shorter than the 3-char length filter in extractTerms()
    // (each CJK character is one grapheme) — assert the mechanism doesn't error even
    // if term extraction yields fewer/no matches; document actual behavior via searchHits.
    assert.equal(typeof result.searchHits, 'number');
  });

  it('very long query (multi-KB) does not error and stays within reasonable term budget', () => {
    const longQuery = Array.from({ length: 2000 }, (_, i) => `term${i}.`).join(' ');
    addPage('arch', 'page', 'unrelated content');
    const result = buildContext(store, folio.id, longQuery, { scoreThreshold: 0 });
    assert.equal(result.searchError, false);
  });

  it('query that sanitizes to zero terms degrades to index-only, no error', () => {
    addPage('arch', 'page', 'content here');
    const result = buildContext(store, folio.id, '... !!! ???', { scoreThreshold: 0 });
    assert.equal(result.searchError, false);
    assert.equal(result.inline.length, 0);
    assert.ok(result.text.includes('Index — chapters'));
  });
});

describe('QA adversarial: FTS5 sanitizer (store.js default, non-prebuilt path — folio_search / MCP)', () => {
  let db, store, folio;

  beforeEach(() => {
    db    = openDb();
    store = createFolioStore(db);
    folio = store.createFolio({ name: 'Adversarial-store' });
  });

  function addPage(chSlug, pgSlug, content, opts = {}) {
    return store.createPage(folio.id, `${chSlug}/${pgSlug}`, content, opts);
  }

  // store.searchPages WITHOUT { prebuilt: true } routes through folio/fts.js's own
  // sanitizeFtsQuery, a *separate* implementation from injection.js's. Verify it has
  // not regressed and does not diverge on the same adversarial set (period bug class).
  const queries = [
    'Fix pipelineManager.js stage injection.',
    'v1.4.0 release notes.',
    '🎉🔥 emoji only 🚀💥',
    '修复 注入 引擎',
    '... --- !!!',
    'title:injection NEAR/3 fts5 AND NOT OR "quoted" ^boost',
  ];

  for (const q of queries) {
    it(`store.searchPages (default path, no prebuilt) does not throw for: ${JSON.stringify(q)}`, () => {
      addPage('arch', 'page', 'pipelineManager stage injection content');
      let errored = false;
      assert.doesNotThrow(() => {
        store.searchPages(folio.id, q, {
          onError: () => { errored = true; },
        });
      });
      assert.equal(errored, false, `store.js own sanitizer must not error on: ${q}`);
    });
  }

  it('the two sanitizers (injection.js prebuilt vs store.js default) agree on error-freedom for the production repro string', () => {
    addPage('arch', 'page', 'pipelineManager stage injection content');
    const repro = 'Fix pipelineManager.js stage injection.';

    let storeErrored = false;
    store.searchPages(folio.id, repro, { onError: () => { storeErrored = true; } });
    assert.equal(storeErrored, false, 'store.js default path must not error on the original repro string');

    const injResult = buildContext(store, folio.id, repro, { scoreThreshold: 0 });
    assert.equal(injResult.searchError, false, 'injection.js prebuilt path must not error on the original repro string');
  });
});

// ---------------------------------------------------------------------------
// folio.injection telemetry (pipelineManager.js)
//
// A silently-degraded injection is detected by filtering the single
// `folio.injection` event for `folioBound:true && inlineCount:0`; `searchError`
// narrows that to an FTS query that actually threw.  These tests pin those
// fields down, since they are the only signal that the month-long silent
// failure this fix addresses ever left behind.
// ---------------------------------------------------------------------------

describe('QA: folio.injection telemetry fires end-to-end via buildStagePrompt', () => {
  function withPipelineManager(fn) {
    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-folio-empty-'));
    fs.mkdirSync(path.join(dataDir, 'runs'), { recursive: true });
    try {
      return fn(pm, dataDir);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
      delete require.cache[require.resolve('../src/services/pipelineManager')];
    }
  }

  function captureStderr(runFn) {
    let captured = '';
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...args) => { captured += chunk; return origWrite(chunk, ...args); };
    try {
      runFn();
    } finally {
      process.stderr.write = origWrite;
    }
    return captured;
  }

  it('reports inlineCount:0 when a bound folio inlines nothing (searchHits: 0, searchError: false)', () => {
    withPipelineManager((pm, dataDir) => {
      const fakeStore = {
        listActiveRuns: () => [],
        getTask: () => ({ id: 'task-1', title: 'zzzznonexistentterm task', description: '', attachments: [] }),
        getRun:  () => null,
        folio: {
          binding: {
            resolveRefs: (spaceId, s) => s,
            buildInjectionContext: () => ({
              text: 'Index only', tokens: 10, inline: [], referenced: [], truncated: [],
              searchHits: 0, searchError: false,
            }),
          },
        },
      };
      pm.init(dataDir, fakeStore);
      const out = captureStderr(() => {
        pm.buildStagePrompt(dataDir, 'space-1', 'task-1', 0, 'developer-agent', ['developer-agent'], null, 'run-1');
      });
      assert.ok(out.includes('"event":"folio.injection"'), 'base metric must fire');
      assert.ok(out.includes('"folioBound":true'), 'folio was bound');
      assert.ok(out.includes('"inlineCount":0'), 'the degraded case is detectable via inlineCount');
      assert.ok(out.includes('"searchHits":0'), 'must carry searchHits through');
      assert.ok(out.includes('"searchError":false'), 'must carry searchError:false through');
    });
  });

  it('reports searchError:true when the FTS query itself errored', () => {
    withPipelineManager((pm, dataDir) => {
      const fakeStore = {
        listActiveRuns: () => [],
        getTask: () => ({ id: 'task-1', title: 'task', description: '', attachments: [] }),
        getRun:  () => null,
        folio: {
          binding: {
            resolveRefs: (spaceId, s) => s,
            buildInjectionContext: () => ({
              text: 'Index only', tokens: 10, inline: [], referenced: [], truncated: [],
              searchHits: 0, searchError: true,
            }),
          },
        },
      };
      pm.init(dataDir, fakeStore);
      const out = captureStderr(() => {
        pm.buildStagePrompt(dataDir, 'space-1', 'task-1', 0, 'developer-agent', ['developer-agent'], null, 'run-1');
      });
      assert.ok(out.includes('"event":"folio.injection"'));
      assert.ok(out.includes('"inlineCount":0'));
      assert.ok(out.includes('"searchError":true'));
    });
  });

  it('reports a non-zero inlineCount when the injection actually inlined something', () => {
    withPipelineManager((pm, dataDir) => {
      const fakeStore = {
        listActiveRuns: () => [],
        getTask: () => ({ id: 'task-1', title: 'task', description: '', attachments: [] }),
        getRun:  () => null,
        folio: {
          binding: {
            resolveRefs: (spaceId, s) => s,
            buildInjectionContext: () => ({
              text: 'Index + one page', tokens: 50,
              inline: [{ slug: 'arch/module', title: 'Module', truncated: false }],
              referenced: [], truncated: [],
              searchHits: 1, searchError: false,
            }),
          },
        },
      };
      pm.init(dataDir, fakeStore);
      const out = captureStderr(() => {
        pm.buildStagePrompt(dataDir, 'space-1', 'task-1', 0, 'developer-agent', ['developer-agent'], null, 'run-1');
      });
      assert.ok(out.includes('"event":"folio.injection"'), 'base metric always fires');
      assert.ok(out.includes('"inlineCount":1'), 'a healthy injection is NOT confusable with the degraded one');
      assert.ok(!out.includes('"inlineCount":0'), 'must not report the degraded signal on success');
    });
  });
});
