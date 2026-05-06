'use strict';

/**
 * Integration tests: pipeline run persistence after server restart.
 *
 * Covers:
 *   - A run persisted with store.upsertRun() survives a store close+reopen.
 *   - Phase 3 migration: run.json files are imported on first boot and renamed
 *     to .migrated; a second boot is a no-op.
 *   - init() marks a 'running' run with a dead PID as 'interrupted' (SQLite path).
 *   - init() re-attaches to a run whose done-sentinel was written while the
 *     server was down (exitCode 0 → completed).
 *
 * Uses PIPELINE_NO_SPAWN=1 to prevent real claude spawning.
 *
 * Run with: node --test tests/pipeline-sqlite-restart.test.js
 */

const { test, describe, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const crypto  = require('crypto');

const { createStore } = require('../src/services/store');
const { migrate }     = require('../src/services/migrator');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-restart-test-'));
}

function makeRun(overrides = {}) {
  const now = new Date().toISOString();
  return {
    runId:        overrides.runId    ?? crypto.randomUUID(),
    spaceId:      overrides.spaceId  ?? 'space-test',
    taskId:       overrides.taskId   ?? `task-${Math.random().toString(36).slice(2, 8)}`,
    stages:       ['developer-agent', 'qa-engineer-e2e'],
    currentStage: 0,
    status:       overrides.status   ?? 'pending',
    stageStatuses: [
      { index: 0, agentId: 'developer-agent', status: 'pending', exitCode: null, startedAt: null, finishedAt: null },
      { index: 1, agentId: 'qa-engineer-e2e', status: 'pending', exitCode: null, startedAt: null, finishedAt: null },
    ],
    createdAt: now,
    updatedAt: now,
    dangerouslySkipPermissions: false,
    checkpoints: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// T-006 §1: Store close + reopen preserves runs
// ---------------------------------------------------------------------------

describe('SQLite persistence — store reopen', () => {
  test('a run written to one store instance is visible after closing and reopening', () => {
    const dataDir = tmpDir();
    try {
      const store1 = createStore(dataDir);
      const run    = makeRun({ runId: 'r-persist', status: 'running' });
      run.stageStatuses[0].status = 'running';
      run.stageStatuses[0].pid    = 99999;
      store1.upsertRun(run);
      store1.close();

      // Reopen the same DB file.
      const store2 = createStore(dataDir);
      const retrieved = store2.getRun('r-persist');
      assert.ok(retrieved !== null, 'run should survive store reopen');
      assert.equal(retrieved.runId,            'r-persist');
      assert.equal(retrieved.status,           'running');
      assert.equal(retrieved.stageStatuses[0].pid, 99999);
      store2.close();
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('multiple runs persist and are all returned by listRuns after reopen', () => {
    const dataDir = tmpDir();
    try {
      const store1 = createStore(dataDir);
      const ids    = ['rA', 'rB', 'rC'];
      for (const id of ids) {
        store1.upsertRun(makeRun({ runId: id }));
      }
      store1.close();

      const store2 = createStore(dataDir);
      const list   = store2.listRuns();
      const runIds = list.map((r) => r.runId);
      for (const id of ids) {
        assert.ok(runIds.includes(id), `${id} should be in listRuns`);
      }
      store2.close();
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// T-006 §2: Phase 3 migration — run.json → SQLite
// ---------------------------------------------------------------------------

describe('Phase 3 migration — run.json import', () => {
  test('run.json files are imported into SQLite on first migrate()', () => {
    const dataDir = tmpDir();
    try {
      // Simulate pre-migration state: write run.json files directly.
      const run1 = makeRun({ runId: 'mig-001', status: 'completed' });
      const run2 = makeRun({ runId: 'mig-002', status: 'failed' });

      for (const run of [run1, run2]) {
        const runDirPath = path.join(dataDir, 'runs', run.runId);
        fs.mkdirSync(runDirPath, { recursive: true });
        fs.writeFileSync(path.join(runDirPath, 'run.json'), JSON.stringify(run), 'utf8');
      }

      // Write a legacy runs.json registry.
      fs.writeFileSync(
        path.join(dataDir, 'runs', 'runs.json'),
        JSON.stringify([run1, run2].map((r) => ({ runId: r.runId, status: r.status }))),
        'utf8'
      );

      const store = migrate(dataDir);

      // Both runs should now be in SQLite.
      const r1 = store.getRun('mig-001');
      const r2 = store.getRun('mig-002');
      assert.ok(r1 !== null, 'mig-001 should be in SQLite after Phase 3');
      assert.ok(r2 !== null, 'mig-002 should be in SQLite after Phase 3');
      assert.equal(r1.status, 'completed');
      assert.equal(r2.status, 'failed');

      // run.json files should be renamed to .migrated.
      assert.ok(
        !fs.existsSync(path.join(dataDir, 'runs', 'mig-001', 'run.json')),
        'run.json should be renamed after migration'
      );
      assert.ok(
        fs.existsSync(path.join(dataDir, 'runs', 'mig-001', 'run.json.migrated')),
        'run.json.migrated should exist'
      );

      // runs.json should be renamed.
      assert.ok(
        !fs.existsSync(path.join(dataDir, 'runs', 'runs.json')),
        'runs.json should be renamed after migration'
      );
      assert.ok(
        fs.existsSync(path.join(dataDir, 'runs', 'runs.json.migrated')),
        'runs.json.migrated should exist'
      );

      store.close();
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('Phase 3 is idempotent — second migrate() does not duplicate rows', () => {
    const dataDir = tmpDir();
    try {
      const run = makeRun({ runId: 'mig-idem', status: 'completed' });
      const runDirPath = path.join(dataDir, 'runs', run.runId);
      fs.mkdirSync(runDirPath, { recursive: true });
      fs.writeFileSync(path.join(runDirPath, 'run.json'), JSON.stringify(run), 'utf8');

      // First migrate — imports run.json, renames it.
      const store1 = migrate(dataDir);
      store1.close();

      // Second migrate — run.json.migrated exists, no new run.json → nothing to import.
      const store2 = migrate(dataDir);
      const list   = store2.listRuns();
      assert.equal(list.length, 1, 'should have exactly 1 run after two migrates');
      store2.close();
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('corrupt run.json is skipped and renamed, others continue', () => {
    const dataDir = tmpDir();
    try {
      // Good run.
      const good = makeRun({ runId: 'mig-good', status: 'completed' });
      const goodDirPath = path.join(dataDir, 'runs', good.runId);
      fs.mkdirSync(goodDirPath, { recursive: true });
      fs.writeFileSync(path.join(goodDirPath, 'run.json'), JSON.stringify(good), 'utf8');

      // Corrupt run.
      const corruptDir = path.join(dataDir, 'runs', 'bad-entry');
      fs.mkdirSync(corruptDir, { recursive: true });
      fs.writeFileSync(path.join(corruptDir, 'run.json'), '{ invalid json !!!', 'utf8');

      const store = migrate(dataDir);
      const goodRow = store.getRun('mig-good');
      assert.ok(goodRow !== null, 'good run should be imported');
      assert.equal(store.listRuns().length, 1, 'corrupt run should not appear in SQLite');
      store.close();
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// T-006 §3: init() marks dead-PID 'running' runs as 'interrupted' (store path)
// ---------------------------------------------------------------------------

describe('init() — interrupted detection with store', () => {
  test('init() marks a running run with a dead PID as interrupted', async () => {
    const dataDir  = tmpDir();
    const runsBase = path.join(dataDir, 'runs');
    fs.mkdirSync(runsBase, { recursive: true });

    // Explicitly set env so pipelineManager uses our tmp dir.
    const savedRunsDir   = process.env.PIPELINE_RUNS_DIR;
    const savedAgentsDir = process.env.PIPELINE_AGENTS_DIR;
    const savedNoSpawn   = process.env.PIPELINE_NO_SPAWN;
    process.env.PIPELINE_RUNS_DIR   = runsBase;
    process.env.PIPELINE_AGENTS_DIR = path.join(dataDir, 'agents');
    process.env.PIPELINE_NO_SPAWN   = '1';

    try {
      const store = createStore(dataDir);

      const run = makeRun({
        runId:  'r-dead-pid',
        status: 'running',
        stageStatuses: [
          {
            index:     0,
            agentId:   'developer-agent',
            status:    'running',
            pid:       999999999,   // definitely dead PID
            exitCode:  null,
            startedAt: new Date(Date.now() - 60_000).toISOString(),
            finishedAt: null,
          },
          { index: 1, agentId: 'qa-engineer-e2e', status: 'pending', exitCode: null, startedAt: null, finishedAt: null },
        ],
      });
      store.upsertRun(run);

      // Create run directory for sentinel check.
      fs.mkdirSync(path.join(runsBase, run.runId), { recursive: true });

      // Clear module cache and get fresh pipelineManager.
      delete require.cache[require.resolve('../src/services/pipelineManager')];
      const pm = require('../src/services/pipelineManager');
      pm.init(dataDir, store);

      // init() should have marked the run as interrupted.
      const recovered = store.getRun('r-dead-pid');
      assert.ok(recovered !== null, 'run should still exist in SQLite');
      assert.equal(recovered.status, 'interrupted', 'run should be interrupted');

      store.close();
    } finally {
      process.env.PIPELINE_RUNS_DIR   = savedRunsDir   ?? '';
      process.env.PIPELINE_AGENTS_DIR = savedAgentsDir ?? '';
      process.env.PIPELINE_NO_SPAWN   = savedNoSpawn   ?? '';
      if (!savedRunsDir)   delete process.env.PIPELINE_RUNS_DIR;
      if (!savedAgentsDir) delete process.env.PIPELINE_AGENTS_DIR;
      if (!savedNoSpawn)   delete process.env.PIPELINE_NO_SPAWN;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('init() re-attaches to a run whose done-sentinel was written (exitCode 0 → completed)', async () => {
    const dataDir  = tmpDir();
    const runsBase = path.join(dataDir, 'runs');
    fs.mkdirSync(runsBase, { recursive: true });

    const savedRunsDir   = process.env.PIPELINE_RUNS_DIR;
    const savedAgentsDir = process.env.PIPELINE_AGENTS_DIR;
    const savedNoSpawn   = process.env.PIPELINE_NO_SPAWN;
    const savedKanban    = process.env.KANBAN_API_URL;
    process.env.PIPELINE_RUNS_DIR   = runsBase;
    process.env.PIPELINE_AGENTS_DIR = path.join(dataDir, 'agents');
    process.env.PIPELINE_NO_SPAWN   = '1';
    process.env.KANBAN_API_URL      = 'http://localhost:19999/api/v1';  // dead port

    try {
      const store = createStore(dataDir);

      // Single-stage run: when stage 0 completes the entire run completes immediately,
      // without spawning a next stage (which would use the 2 s poll interval and time out).
      const run = {
        runId:        'r-sentinel',
        spaceId:      'space-test',
        taskId:       'task-sentinel',
        stages:       ['developer-agent'],
        currentStage: 0,
        status:       'running',
        stageStatuses: [
          {
            index:     0,
            agentId:   'developer-agent',
            status:    'running',
            pid:       null,   // null PID — treat as dead
            exitCode:  null,
            startedAt: new Date(Date.now() - 60_000).toISOString(),
            finishedAt: null,
          },
        ],
        createdAt:   new Date().toISOString(),
        updatedAt:   new Date().toISOString(),
        dangerouslySkipPermissions: false,
        checkpoints: [],
      };
      store.upsertRun(run);

      // Create run directory and write the done-sentinel.
      const runDirPath = path.join(runsBase, run.runId);
      fs.mkdirSync(runDirPath, { recursive: true });
      fs.writeFileSync(path.join(runDirPath, 'stage-0.done'), '0', 'utf8');

      delete require.cache[require.resolve('../src/services/pipelineManager')];
      const pm = require('../src/services/pipelineManager');
      pm.init(dataDir, store);

      // Wait for async handleStageClose to complete.
      await new Promise((r) => setTimeout(r, 400));

      const recovered = store.getRun('r-sentinel');
      assert.ok(recovered !== null, 'run should still exist in SQLite');
      assert.equal(recovered.status, 'completed', 'run should be completed after sentinel with exitCode=0');
      assert.equal(recovered.stageStatuses[0].status, 'completed', 'stage 0 should be completed');

      store.close();
    } finally {
      process.env.PIPELINE_RUNS_DIR   = savedRunsDir   ?? '';
      process.env.PIPELINE_AGENTS_DIR = savedAgentsDir ?? '';
      process.env.PIPELINE_NO_SPAWN   = savedNoSpawn   ?? '';
      process.env.KANBAN_API_URL      = savedKanban    ?? '';
      if (!savedRunsDir)   delete process.env.PIPELINE_RUNS_DIR;
      if (!savedAgentsDir) delete process.env.PIPELINE_AGENTS_DIR;
      if (!savedNoSpawn)   delete process.env.PIPELINE_NO_SPAWN;
      if (!savedKanban)    delete process.env.KANBAN_API_URL;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
