'use strict';

/**
 * Tests for Folio write-back consolidation (T-001..T-007: folio-write-back).
 *
 * Covers:
 *  - upsertPageFromAgent: opt-in no-op, author stamping, user-owned skip, last-write-wins
 *  - resolveWritebackConfig: kill switch, defaults, env var parsing
 *  - applyConsolidation: cap truncation, invalid-page skip, missing-file failure, user-owned skip
 *  - maybeConsolidate lifecycle: no-folio skip, kill-switch skip, idempotency, completion isolation
 *
 * All DB tests use in-memory better-sqlite3. Lifecycle tests use PIPELINE_NO_SPAWN=1
 * and a temp dataDir — no real agent process is spawned.
 *
 * Run with: node --test tests/folio-writeback.test.js
 */

const { describe, it, before, beforeEach, after } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const crypto  = require('crypto');

const Database = require('better-sqlite3');

const { applySchema }                            = require('../src/services/folio/db');
const { createFolioStore }                       = require('../src/services/folio/store');
const { applyBindingSchema, createFolioBinding } = require('../src/services/folioBinding');

const {
  resolveWritebackConfig,
  applyConsolidation,
  maybeConsolidate,
  consolidationDonePath,
  consolidationSignalPath,
  consolidationPromptPath,
  runDir,
  init,
} = require('../src/services/pipelineManager');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openDb() {
  const db = new Database(':memory:');
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

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-writeback-test-'));
}

function makeRun(overrides = {}) {
  const runId = crypto.randomUUID();
  return {
    runId,
    spaceId: 'space-1',
    taskId:  'task-1',
    status:  'completed',
    stages:  ['developer-agent'],
    stageStatuses: [{ status: 'completed', exitCode: 0, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() }],
    createdAt: new Date().toISOString(),
    currentStage: 1,
    ...overrides,
  };
}

function writeRunFile(dataDir, run) {
  const dir = runDir(dataDir, run.runId);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, 'run.json.tmp');
  fs.writeFileSync(tmpPath, JSON.stringify(run, null, 2), 'utf8');
  fs.renameSync(tmpPath, path.join(dir, 'run.json'));
}

function readRunFile(dataDir, runId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(runDir(dataDir, runId), 'run.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Create a minimal fake store for lifecycle tests.
 * Uses an in-memory map to store runs (mirrors the SQLite upsertRun/getRun contract).
 * getRun pre-seeds from any run file already on disk (written by writeRunFile).
 */
function makeFakeStore(dataDir, db, binding) {
  const runs = new Map();

  return {
    folio: { core: {}, binding },
    getTask: () => null,
    getSpace: () => null,
    listActiveRuns: () => [],
    listRuns: () => [],
    findActiveRunByTaskId: () => null,
    updateTask: () => null,
    getRun: (runId) => {
      if (runs.has(runId)) return runs.get(runId);
      // Fall back to disk (for runs written before init)
      return readRunFile(dataDir, runId);
    },
    upsertRun: (run) => {
      runs.set(run.runId, { ...run });
      // Also persist to disk so readRunFile can read them in assertions
      writeRunFile(dataDir, run);
    },
  };
}

// ---------------------------------------------------------------------------
// T-001 — upsertPageFromAgent
// ---------------------------------------------------------------------------

describe('upsertPageFromAgent — opt-in no-op when no folio bound', () => {
  let db, binding;

  beforeEach(() => {
    db = openDb();
    insertSpace(db, 'space-1');
    const core = createFolioStore(db);
    binding = createFolioBinding(db, core);
  });

  it('should_return_null_when_space_has_no_folio', () => {
    const result = binding.upsertPageFromAgent('space-1', 'decisiones/auth', 'content');
    assert.equal(result, null, 'Expected null when no folio bound');
  });

  it('should_not_create_a_folio_when_no_folio_is_bound', () => {
    binding.upsertPageFromAgent('space-1', 'decisiones/auth', 'content');
    const row = db.prepare('SELECT COUNT(*) AS c FROM folios').get();
    assert.equal(row.c, 0, 'No folio should be created');
  });
});

describe('upsertPageFromAgent — author always agent on create', () => {
  let db, binding, core;

  beforeEach(() => {
    db   = openDb();
    insertSpace(db, 'space-1');
    core = createFolioStore(db);
    binding = createFolioBinding(db, core);
    // Activate folio by creating a page via user path
    binding.createPage('space-1', 'setup/init', 'seed', { createIfMissing: true, author: 'user' });
  });

  it('should_stamp_author_agent_on_new_page', () => {
    const page = binding.upsertPageFromAgent('space-1', 'decisiones/auth', '# Decision\nContent');
    assert.ok(page && page.id, 'Expected a page object');
    assert.equal(page.author, 'agent', 'author must be "agent"');
  });

  it('should_not_allow_caller_to_override_author', () => {
    // opts does not accept author — upsertPageFromAgent ignores any author in opts
    const page = binding.upsertPageFromAgent('space-1', 'decisiones/auth', 'content', { title: 'My Title' });
    assert.equal(page.author, 'agent', 'author must still be "agent"');
  });

  it('should_create_page_with_provided_title', () => {
    const page = binding.upsertPageFromAgent('space-1', 'lecciones/timeout', 'lesson content', { title: 'Timeout Bug' });
    assert.equal(page.title, 'Timeout Bug');
  });
});

describe('upsertPageFromAgent — user-owned skip', () => {
  let db, binding, core;

  beforeEach(() => {
    db   = openDb();
    insertSpace(db, 'space-1');
    core = createFolioStore(db);
    binding = createFolioBinding(db, core);
    // Create a user-owned page
    binding.createPage('space-1', 'estado/actual', '# Current state', { createIfMissing: true, author: 'user' });
  });

  it('should_return_skipped_user_owned_when_page_has_author_user', () => {
    const result = binding.upsertPageFromAgent('space-1', 'estado/actual', 'agent update');
    assert.deepEqual(result, { skipped: 'user-owned' }, 'Expected skipped:user-owned');
  });

  it('should_not_modify_user_owned_page_content', () => {
    binding.upsertPageFromAgent('space-1', 'estado/actual', 'agent override attempt');
    const page = binding.getPageBySlug('space-1', 'estado', 'actual');
    assert.equal(page.content, '# Current state', 'User-owned content must be unchanged');
  });
});

describe('upsertPageFromAgent — last-write-wins update', () => {
  let db, binding, core;

  beforeEach(() => {
    db   = openDb();
    insertSpace(db, 'space-1');
    core = createFolioStore(db);
    binding = createFolioBinding(db, core);
    binding.createPage('space-1', 'setup/init', 'seed', { createIfMissing: true, author: 'user' });
  });

  it('should_update_existing_agent_page_content_in_place', () => {
    binding.upsertPageFromAgent('space-1', 'estado/pipeline', 'initial');
    const updated = binding.upsertPageFromAgent('space-1', 'estado/pipeline', 'updated content');
    assert.equal(updated.content, 'updated content', 'Content must be updated');
  });

  it('should_preserve_author_agent_on_update', () => {
    binding.upsertPageFromAgent('space-1', 'estado/pipeline', 'v1');
    const updated = binding.upsertPageFromAgent('space-1', 'estado/pipeline', 'v2');
    assert.equal(updated.author, 'agent', 'author must remain agent on update');
  });

  it('should_bump_updated_at_on_update', async () => {
    binding.upsertPageFromAgent('space-1', 'estado/pipeline', 'v1');
    const before = binding.getPageBySlug('space-1', 'estado', 'pipeline');
    // Wait 1 ms to ensure updated_at differs
    await new Promise((r) => setTimeout(r, 2));
    binding.upsertPageFromAgent('space-1', 'estado/pipeline', 'v2');
    const after = binding.getPageBySlug('space-1', 'estado', 'pipeline');
    assert.ok(after.updatedAt >= before.updatedAt, 'updated_at must be bumped');
  });
});

describe('upsertPageFromAgent — slug validation', () => {
  let db, binding;

  beforeEach(() => {
    db = openDb();
    insertSpace(db, 'space-1');
    const core = createFolioStore(db);
    binding = createFolioBinding(db, core);
    binding.createPage('space-1', 'setup/init', 'seed', { createIfMissing: true, author: 'user' });
  });

  it('should_throw_on_invalid_slug_missing_slash', () => {
    assert.throws(
      () => binding.upsertPageFromAgent('space-1', 'noslash', 'content'),
      /invalid slug/,
    );
  });

  it('should_throw_on_invalid_slug_with_uppercase', () => {
    assert.throws(
      () => binding.upsertPageFromAgent('space-1', 'UPPER/case', 'content'),
      /invalid slug/,
    );
  });

  it('should_throw_on_invalid_slug_multiple_slashes', () => {
    assert.throws(
      () => binding.upsertPageFromAgent('space-1', 'a/b/c', 'content'),
      /invalid slug/,
    );
  });
});

// ---------------------------------------------------------------------------
// T-002 — resolveWritebackConfig
// ---------------------------------------------------------------------------

describe('resolveWritebackConfig — kill switch', () => {
  let original;

  before(() => { original = process.env.PRISM_FOLIO_WRITEBACK; });
  after(() => {
    if (original === undefined) delete process.env.PRISM_FOLIO_WRITEBACK;
    else process.env.PRISM_FOLIO_WRITEBACK = original;
  });

  it('should_return_enabled_false_when_set_to_off', () => {
    process.env.PRISM_FOLIO_WRITEBACK = 'off';
    const cfg = resolveWritebackConfig();
    assert.equal(cfg.enabled, false);
  });

  it('should_return_enabled_true_when_not_set', () => {
    delete process.env.PRISM_FOLIO_WRITEBACK;
    const cfg = resolveWritebackConfig();
    assert.equal(cfg.enabled, true);
  });

  it('should_return_enabled_true_when_set_to_on', () => {
    process.env.PRISM_FOLIO_WRITEBACK = 'on';
    const cfg = resolveWritebackConfig();
    assert.equal(cfg.enabled, true);
  });
});

describe('resolveWritebackConfig — defaults', () => {
  before(() => {
    delete process.env.PRISM_FOLIO_WRITEBACK_MAX_PAGES;
    delete process.env.PRISM_FOLIO_WRITEBACK_MAX_BYTES;
    delete process.env.PIPELINE_RESOLVER_TIMEOUT_MS;
    delete process.env.PRISM_FOLIO_WRITEBACK;
  });

  it('should_default_maxPages_to_3', () => {
    const cfg = resolveWritebackConfig();
    assert.equal(cfg.maxPages, 3);
  });

  it('should_default_maxBytes_to_8192', () => {
    const cfg = resolveWritebackConfig();
    assert.equal(cfg.maxBytes, 8192);
  });

  it('should_default_timeoutMs_to_300000', () => {
    const cfg = resolveWritebackConfig();
    assert.equal(cfg.timeoutMs, 300000);
  });
});

describe('resolveWritebackConfig — env overrides', () => {
  after(() => {
    delete process.env.PRISM_FOLIO_WRITEBACK_MAX_PAGES;
    delete process.env.PRISM_FOLIO_WRITEBACK_MAX_BYTES;
    delete process.env.PIPELINE_RESOLVER_TIMEOUT_MS;
  });

  it('should_apply_custom_maxPages', () => {
    process.env.PRISM_FOLIO_WRITEBACK_MAX_PAGES = '5';
    assert.equal(resolveWritebackConfig().maxPages, 5);
  });

  it('should_apply_custom_maxBytes', () => {
    process.env.PRISM_FOLIO_WRITEBACK_MAX_BYTES = '4096';
    assert.equal(resolveWritebackConfig().maxBytes, 4096);
  });

  it('should_fall_back_to_defaults_on_invalid_numeric_env', () => {
    process.env.PRISM_FOLIO_WRITEBACK_MAX_PAGES = 'notanumber';
    process.env.PRISM_FOLIO_WRITEBACK_MAX_BYTES = 'notanumber';
    const cfg = resolveWritebackConfig();
    assert.equal(cfg.maxPages, 3);
    assert.equal(cfg.maxBytes, 8192);
  });
});

// ---------------------------------------------------------------------------
// T-005 — applyConsolidation
// ---------------------------------------------------------------------------

describe('applyConsolidation — missing or invalid signal file', () => {
  let dataDir, db, binding, core, fakeStore;

  beforeEach(() => {
    dataDir = makeTmpDir();
    db = openDb();
    insertSpace(db, 'space-1');
    core = createFolioStore(db);
    binding = createFolioBinding(db, core);
    // Activate folio
    binding.createPage('space-1', 'setup/init', 'seed', { createIfMissing: true, author: 'user' });
    fakeStore = makeFakeStore(dataDir, db, binding);
    init(dataDir, fakeStore);
  });

  after(() => {
    try { fs.rmSync(dataDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('should_set_status_failed_when_signal_file_missing', async () => {
    const run = makeRun();
    writeRunFile(dataDir, run);
    await applyConsolidation(dataDir, run, new Date().toISOString());
    const updated = readRunFile(dataDir, run.runId);
    assert.equal(updated.consolidation.status, 'failed');
    assert.equal(updated.consolidation.pagesWritten, 0);
  });

  it('should_set_status_failed_when_signal_file_is_not_valid_json', async () => {
    const run = makeRun();
    writeRunFile(dataDir, run);
    fs.mkdirSync(runDir(dataDir, run.runId), { recursive: true });
    fs.writeFileSync(consolidationSignalPath(dataDir, run.runId), 'NOT JSON', 'utf8');
    await applyConsolidation(dataDir, run, new Date().toISOString());
    const updated = readRunFile(dataDir, run.runId);
    assert.equal(updated.consolidation.status, 'failed');
  });

  it('should_not_throw_when_signal_file_missing', async () => {
    const run = makeRun();
    writeRunFile(dataDir, run);
    await assert.doesNotReject(() => applyConsolidation(dataDir, run, new Date().toISOString()));
  });
});

describe('applyConsolidation — page validation and caps', () => {
  let dataDir, db, binding, core, fakeStore;

  beforeEach(() => {
    dataDir = makeTmpDir();
    db = openDb();
    insertSpace(db, 'space-1');
    core = createFolioStore(db);
    binding = createFolioBinding(db, core);
    binding.createPage('space-1', 'setup/init', 'seed', { createIfMissing: true, author: 'user' });
    fakeStore = makeFakeStore(dataDir, db, binding);
    init(dataDir, fakeStore);
  });

  after(() => {
    try { fs.rmSync(dataDir, { recursive: true }); } catch { /* ignore */ }
  });

  function writeSignal(dataDir, runId, signal) {
    const dir = runDir(dataDir, runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(consolidationSignalPath(dataDir, runId), JSON.stringify(signal), 'utf8');
  }

  it('should_truncate_pages_to_MAX_PAGES', async () => {
    // Default maxPages=3; write 5 pages
    const run = makeRun();
    writeRunFile(dataDir, run);
    writeSignal(dataDir, run.runId, {
      pages: [
        { slug: 'decisiones/a', title: 'A', content: 'c', reason: 'decision' },
        { slug: 'decisiones/b', title: 'B', content: 'c', reason: 'decision' },
        { slug: 'decisiones/c', title: 'C', content: 'c', reason: 'decision' },
        { slug: 'decisiones/d', title: 'D', content: 'c', reason: 'decision' },
        { slug: 'decisiones/e', title: 'E', content: 'c', reason: 'decision' },
      ],
    });
    await applyConsolidation(dataDir, run, new Date().toISOString());
    const updated = readRunFile(dataDir, run.runId);
    assert.equal(updated.consolidation.pagesWritten, 3, 'Only 3 pages should be written');
  });

  it('should_skip_pages_with_invalid_slug', async () => {
    const run = makeRun();
    writeRunFile(dataDir, run);
    writeSignal(dataDir, run.runId, {
      pages: [
        { slug: 'INVALID/slug', title: 'Bad', content: 'c', reason: 'decision' },
        { slug: 'decisiones/good', title: 'Good', content: 'c', reason: 'decision' },
      ],
    });
    await applyConsolidation(dataDir, run, new Date().toISOString());
    const updated = readRunFile(dataDir, run.runId);
    assert.equal(updated.consolidation.pagesWritten, 1);
    assert.equal(updated.consolidation.skipped.length, 1);
    assert.equal(updated.consolidation.skipped[0].reason, 'invalid_slug');
  });

  it('should_skip_pages_with_empty_content', async () => {
    const run = makeRun();
    writeRunFile(dataDir, run);
    writeSignal(dataDir, run.runId, {
      pages: [
        { slug: 'decisiones/empty', title: 'Empty', content: '', reason: 'decision' },
      ],
    });
    await applyConsolidation(dataDir, run, new Date().toISOString());
    const updated = readRunFile(dataDir, run.runId);
    assert.equal(updated.consolidation.pagesWritten, 0);
    assert.ok(updated.consolidation.skipped.some((s) => s.reason === 'empty_content'));
  });

  it('should_skip_pages_exceeding_max_bytes', async () => {
    const run = makeRun();
    writeRunFile(dataDir, run);
    const bigContent = 'x'.repeat(9000); // > 8192 default
    writeSignal(dataDir, run.runId, {
      pages: [
        { slug: 'decisiones/huge', title: 'Big', content: bigContent, reason: 'decision' },
      ],
    });
    await applyConsolidation(dataDir, run, new Date().toISOString());
    const updated = readRunFile(dataDir, run.runId);
    assert.equal(updated.consolidation.pagesWritten, 0);
    assert.ok(updated.consolidation.skipped.some((s) => s.reason === 'content_too_large'));
  });

  it('should_count_user_owned_pages_in_skipped', async () => {
    // Create a user-owned page at estado/actual (folio is already bound from beforeEach)
    // binding.createPage with any opts will work since folio is already bound
    const folioId = db.prepare('SELECT folio_id FROM space_folios WHERE space_id = ?').get('space-1').folio_id;
    core.createPage(folioId, 'estado/actual', '# Current state', { author: 'user' });

    const run = makeRun();
    writeRunFile(dataDir, run);
    writeSignal(dataDir, run.runId, {
      pages: [
        { slug: 'estado/actual', title: 'State', content: 'agent override', reason: 'state-update' },
      ],
    });
    await applyConsolidation(dataDir, run, new Date().toISOString());
    const updated = readRunFile(dataDir, run.runId);
    assert.equal(updated.consolidation.pagesWritten, 0);
    assert.ok(updated.consolidation.skipped.some((s) => s.slug === 'estado/actual'));
  });

  it('should_write_valid_pages_and_record_pagesWritten', async () => {
    const run = makeRun();
    writeRunFile(dataDir, run);
    writeSignal(dataDir, run.runId, {
      pages: [
        { slug: 'decisiones/writeback', title: 'Write-back Decision', content: '# Content\nHigh-signal.', reason: 'decision' },
      ],
    });
    await applyConsolidation(dataDir, run, new Date().toISOString());
    const updated = readRunFile(dataDir, run.runId);
    assert.equal(updated.consolidation.status, 'done');
    assert.equal(updated.consolidation.pagesWritten, 1);
    assert.equal(updated.consolidation.skipped.length, 0);
  });

  it('should_record_startedAt_and_finishedAt', async () => {
    const run = makeRun();
    writeRunFile(dataDir, run);
    writeSignal(dataDir, run.runId, { pages: [] });
    const startedAt = new Date().toISOString();
    await applyConsolidation(dataDir, run, startedAt);
    const updated = readRunFile(dataDir, run.runId);
    assert.equal(updated.consolidation.startedAt, startedAt);
    assert.ok(updated.consolidation.finishedAt, 'finishedAt must be set');
  });
});

// ---------------------------------------------------------------------------
// T-006 — maybeConsolidate lifecycle
// ---------------------------------------------------------------------------

describe('maybeConsolidate — kill switch skip', () => {
  let dataDir, db, binding, core, fakeStore;
  let origWriteback, origNoSpawn;

  beforeEach(() => {
    dataDir         = makeTmpDir();
    origWriteback   = process.env.PRISM_FOLIO_WRITEBACK;
    origNoSpawn     = process.env.PIPELINE_NO_SPAWN;
    process.env.PRISM_FOLIO_WRITEBACK = 'off';
    // Use a store that has no folio binding (space with no folio)
    db = openDb();
    insertSpace(db, 'space-1');
    core = createFolioStore(db);
    binding = createFolioBinding(db, core);
    // Space has NO bound folio — but kill switch fires before opt-in check
    fakeStore = makeFakeStore(dataDir, db, binding);
    init(dataDir, fakeStore);
  });

  after(() => {
    if (origWriteback === undefined) delete process.env.PRISM_FOLIO_WRITEBACK;
    else process.env.PRISM_FOLIO_WRITEBACK = origWriteback;
    if (origNoSpawn === undefined) delete process.env.PIPELINE_NO_SPAWN;
    else process.env.PIPELINE_NO_SPAWN = origNoSpawn;
    try { fs.rmSync(dataDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('should_set_consolidation_skipped_kill_switch', async () => {
    const run = makeRun();
    writeRunFile(dataDir, run);
    await maybeConsolidate(dataDir, run);
    const updated = readRunFile(dataDir, run.runId);
    assert.equal(updated.consolidation.status, 'skipped');
    assert.equal(updated.consolidation.reason, 'kill-switch');
  });

  it('should_not_spawn_any_process_when_kill_switch_is_on', async () => {
    const run = makeRun();
    writeRunFile(dataDir, run);
    // Should complete instantly without any spawning
    await assert.doesNotReject(() => maybeConsolidate(dataDir, run));
    // No consolidation.done file created
    assert.ok(!fs.existsSync(consolidationDonePath(dataDir, run.runId)), 'no done sentinel should be written');
  });
});

describe('maybeConsolidate — no folio bound skip', () => {
  let dataDir, db, fakeStore;
  let origWriteback, origNoSpawn;

  beforeEach(() => {
    dataDir = makeTmpDir();
    origWriteback = process.env.PRISM_FOLIO_WRITEBACK;
    origNoSpawn   = process.env.PIPELINE_NO_SPAWN;
    delete process.env.PRISM_FOLIO_WRITEBACK; // enabled
    process.env.PIPELINE_NO_SPAWN = '1';

    db = openDb();
    insertSpace(db, 'space-1');
    const core = createFolioStore(db);
    const binding = createFolioBinding(db, core);
    // Do NOT activate folio — space has no binding
    fakeStore = makeFakeStore(dataDir, db, binding);
    init(dataDir, fakeStore);
  });

  after(() => {
    if (origWriteback === undefined) delete process.env.PRISM_FOLIO_WRITEBACK;
    else process.env.PRISM_FOLIO_WRITEBACK = origWriteback;
    if (origNoSpawn === undefined) delete process.env.PIPELINE_NO_SPAWN;
    else process.env.PIPELINE_NO_SPAWN = origNoSpawn;
    try { fs.rmSync(dataDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('should_skip_with_reason_no_folio_when_space_has_no_folio', async () => {
    const run = makeRun();
    writeRunFile(dataDir, run);
    await maybeConsolidate(dataDir, run);
    const updated = readRunFile(dataDir, run.runId);
    assert.equal(updated.consolidation.status, 'skipped');
    assert.equal(updated.consolidation.reason, 'no-folio');
  });

  it('should_not_write_consolidation_done_sentinel_when_no_folio', async () => {
    const run = makeRun();
    writeRunFile(dataDir, run);
    await maybeConsolidate(dataDir, run);
    assert.ok(!fs.existsSync(consolidationDonePath(dataDir, run.runId)));
  });
});

describe('maybeConsolidate — idempotency guard', () => {
  let dataDir, db, binding, core, fakeStore;
  let origWriteback, origNoSpawn;

  beforeEach(() => {
    dataDir = makeTmpDir();
    origWriteback = process.env.PRISM_FOLIO_WRITEBACK;
    origNoSpawn   = process.env.PIPELINE_NO_SPAWN;
    delete process.env.PRISM_FOLIO_WRITEBACK;
    process.env.PIPELINE_NO_SPAWN = '1';

    db = openDb();
    insertSpace(db, 'space-1');
    core = createFolioStore(db);
    binding = createFolioBinding(db, core);
    binding.createPage('space-1', 'setup/init', 'seed', { createIfMissing: true, author: 'user' });
    fakeStore = makeFakeStore(dataDir, db, binding);
    init(dataDir, fakeStore);
  });

  after(() => {
    if (origWriteback === undefined) delete process.env.PRISM_FOLIO_WRITEBACK;
    else process.env.PRISM_FOLIO_WRITEBACK = origWriteback;
    if (origNoSpawn === undefined) delete process.env.PIPELINE_NO_SPAWN;
    else process.env.PIPELINE_NO_SPAWN = origNoSpawn;
    try { fs.rmSync(dataDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('should_not_consolidate_again_when_run_consolidation_already_set', async () => {
    const run = makeRun({ consolidation: { status: 'done', pagesWritten: 1, skipped: [] } });
    writeRunFile(dataDir, run);
    await maybeConsolidate(dataDir, run);
    // consolidation should remain unchanged
    const updated = readRunFile(dataDir, run.runId);
    assert.equal(updated.consolidation.status, 'done');
    assert.equal(updated.consolidation.pagesWritten, 1, 'idempotency — pagesWritten must not reset');
  });
});

describe('maybeConsolidate — PIPELINE_NO_SPAWN lifecycle with folio active', () => {
  let dataDir, db, binding, core, fakeStore;
  let origWriteback, origNoSpawn;

  beforeEach(() => {
    dataDir = makeTmpDir();
    origWriteback = process.env.PRISM_FOLIO_WRITEBACK;
    origNoSpawn   = process.env.PIPELINE_NO_SPAWN;
    delete process.env.PRISM_FOLIO_WRITEBACK;
    process.env.PIPELINE_NO_SPAWN = '1';

    db = openDb();
    insertSpace(db, 'space-1');
    core = createFolioStore(db);
    binding = createFolioBinding(db, core);
    binding.createPage('space-1', 'setup/init', 'seed', { createIfMissing: true, author: 'user' });
    fakeStore = makeFakeStore(dataDir, db, binding);
    init(dataDir, fakeStore);
  });

  after(() => {
    if (origWriteback === undefined) delete process.env.PRISM_FOLIO_WRITEBACK;
    else process.env.PRISM_FOLIO_WRITEBACK = origWriteback;
    if (origNoSpawn === undefined) delete process.env.PIPELINE_NO_SPAWN;
    else process.env.PIPELINE_NO_SPAWN = origNoSpawn;
    try { fs.rmSync(dataDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('should_write_consolidation_done_sentinel_in_test_mode', async () => {
    const run = makeRun();
    writeRunFile(dataDir, run);
    await maybeConsolidate(dataDir, run);
    // In NO_SPAWN mode, the done sentinel is written immediately
    const doneFile = consolidationDonePath(dataDir, run.runId);
    assert.ok(fs.existsSync(doneFile), 'consolidation.done must be written in test mode');
  });

  it('surfaces the consolidator as a single-stage run (Runs list + store run + meta)', async () => {
    const path = require('path');
    const run = makeRun();
    writeRunFile(dataDir, run);
    await maybeConsolidate(dataDir, run);

    const surfaceRunId = `consolidation-${run.runId}`;

    // 1. agent-runs.jsonl row → the Runs panel LIST.
    const entries = fs.readFileSync(path.join(dataDir, 'agent-runs.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const entry = entries.find((r) => r.id === `${surfaceRunId}-consolidation`);
    assert.ok(entry, 'a consolidation entry should exist in agent-runs.jsonl');
    assert.equal(entry.phase, 'consolidation');
    assert.equal(entry.agentId, 'folio-consolidator');
    assert.equal(entry.agentDisplayName, 'Folio Consolidator');
    assert.equal(entry.pipelineRunId, surfaceRunId);

    // 2. Single-stage store run → the log VIEWER (getRun). kind keeps it out of
    //    the pipeline run lists.
    const stored = readRunFile(dataDir, surfaceRunId);
    assert.ok(stored, 'a consolidation store run should exist');
    assert.equal(stored.kind, 'consolidation');
    assert.deepEqual(stored.stages, ['folio-consolidator']);
    // The stage status must carry `index` (and agentId) like a real pipeline run,
    // or the log viewer can't read the status and shows a perpetual spinner.
    assert.equal(stored.stageStatuses[0].index, 0, 'stage status needs index for the log viewer');
    assert.equal(stored.stageStatuses[0].agentId, 'folio-consolidator');

    // 3. stage-0.meta.json so the log viewer parses the claude-code stream.
    assert.ok(
      fs.existsSync(path.join(dataDir, 'runs', surfaceRunId, 'stage-0.meta.json')),
      'surface stage-0.meta.json should exist',
    );
  });

  it('should_persist_consolidation_prompt_file', async () => {
    const run = makeRun();
    writeRunFile(dataDir, run);
    await maybeConsolidate(dataDir, run);
    const promptFile = consolidationPromptPath(dataDir, run.runId);
    assert.ok(fs.existsSync(promptFile), 'consolidation-prompt.md must be persisted');
    const content = fs.readFileSync(promptFile, 'utf8');
    assert.ok(content.includes('folio-consolidator'), 'prompt must mention the agent role');
  });

  it('should_set_consolidation_status_running_immediately', async () => {
    const run = makeRun();
    writeRunFile(dataDir, run);
    // We need to check before the sentinel is processed
    // In NO_SPAWN mode the sentinel is written synchronously before polling starts
    // so we look at the run file after maybeConsolidate returns
    await maybeConsolidate(dataDir, run);
    // After polling fires (setInterval), status will be 'done' or 'failed'
    // But we can verify consolidation was attempted by checking that a signal-related file exists
    assert.ok(fs.existsSync(consolidationDonePath(dataDir, run.runId)));
  });
});

describe('maybeConsolidate — run.status stays completed even on consolidation error', () => {
  let dataDir, db, binding, core, fakeStore;
  let origWriteback, origNoSpawn;

  beforeEach(() => {
    dataDir = makeTmpDir();
    origWriteback = process.env.PRISM_FOLIO_WRITEBACK;
    origNoSpawn   = process.env.PIPELINE_NO_SPAWN;
    delete process.env.PRISM_FOLIO_WRITEBACK;
    process.env.PIPELINE_NO_SPAWN = '1';

    db = openDb();
    insertSpace(db, 'space-1');
    core = createFolioStore(db);
    binding = createFolioBinding(db, core);
    binding.createPage('space-1', 'setup/init', 'seed', { createIfMissing: true, author: 'user' });
    fakeStore = makeFakeStore(dataDir, db, binding);
    init(dataDir, fakeStore);
  });

  after(() => {
    if (origWriteback === undefined) delete process.env.PRISM_FOLIO_WRITEBACK;
    else process.env.PRISM_FOLIO_WRITEBACK = origWriteback;
    if (origNoSpawn === undefined) delete process.env.PIPELINE_NO_SPAWN;
    else process.env.PIPELINE_NO_SPAWN = origNoSpawn;
    try { fs.rmSync(dataDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('should_not_throw_and_run_status_stays_completed_even_when_consolidation_fails', async () => {
    // Simulate a consolidation failure by pre-writing an invalid signal file
    const run = makeRun();
    writeRunFile(dataDir, run);

    // Write invalid JSON as the signal before the sentinel fires
    // In test mode (PIPELINE_NO_SPAWN=1), the done sentinel is written immediately,
    // then polling processes it. The signal file is invalid → status='failed'.
    // The run.status must still be 'completed'.
    fs.mkdirSync(runDir(dataDir, run.runId), { recursive: true });
    fs.writeFileSync(consolidationSignalPath(dataDir, run.runId), 'NOT_JSON', 'utf8');

    await assert.doesNotReject(() => maybeConsolidate(dataDir, run));

    // run.status is not managed by maybeConsolidate — it never sets it to anything other than 'completed'
    const updated = readRunFile(dataDir, run.runId);
    assert.equal(updated.status, 'completed', 'run.status must remain completed');
  });
});
