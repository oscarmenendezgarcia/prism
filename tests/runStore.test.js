'use strict';

/**
 * Unit tests for the pipeline_runs CRUD methods in src/services/store.js.
 *
 * All tests use an in-memory ':memory:' SQLite database so no file I/O is
 * needed and tests are completely isolated from each other.
 *
 * Run with: node --test tests/runStore.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createStore } = require('../src/services/store');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides = {}) {
  const now = new Date().toISOString();
  return {
    runId:        overrides.runId    ?? `run-${Math.random().toString(36).slice(2, 10)}`,
    spaceId:      overrides.spaceId  ?? 'space-test',
    taskId:       overrides.taskId   ?? 'task-test',
    stages:       overrides.stages   ?? ['developer-agent', 'qa-engineer-e2e'],
    currentStage: overrides.currentStage ?? 0,
    status:       overrides.status   ?? 'running',
    stageStatuses: overrides.stageStatuses ?? [
      { index: 0, agentId: 'developer-agent', status: 'running',  exitCode: null, startedAt: now, finishedAt: null },
      { index: 1, agentId: 'qa-engineer-e2e',  status: 'pending', exitCode: null, startedAt: null, finishedAt: null },
    ],
    createdAt:    overrides.createdAt ?? now,
    updatedAt:    overrides.updatedAt ?? now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runStore — basic CRUD', () => {
  test('createStore(:memory:) exposes all run methods', () => {
    const store = createStore(':memory:');
    assert.equal(typeof store.getRun,                'function');
    assert.equal(typeof store.upsertRun,             'function');
    assert.equal(typeof store.listRuns,              'function');
    assert.equal(typeof store.listActiveRuns,        'function');
    assert.equal(typeof store.findActiveRunByTaskId, 'function');
    assert.equal(typeof store.deleteRun,             'function');
    store.close();
  });

  test('getRun returns null for unknown runId', () => {
    const store = createStore(':memory:');
    const result = store.getRun('nonexistent');
    assert.equal(result, null);
    store.close();
  });

  test('upsertRun inserts a run and getRun returns it', () => {
    const store = createStore(':memory:');
    const run   = makeRun({ runId: 'r-001' });
    store.upsertRun(run);

    const retrieved = store.getRun('r-001');
    assert.ok(retrieved !== null, 'should find inserted run');
    assert.equal(retrieved.runId,   'r-001');
    assert.equal(retrieved.spaceId, 'space-test');
    assert.equal(retrieved.taskId,  'task-test');
    assert.equal(retrieved.status,  'running');
    store.close();
  });

  test('upsertRun replaces an existing row (idempotent update)', () => {
    const store = createStore(':memory:');
    const run   = makeRun({ runId: 'r-replace', status: 'running' });
    store.upsertRun(run);

    const updated = { ...run, status: 'completed', updatedAt: new Date().toISOString() };
    store.upsertRun(updated);

    const retrieved = store.getRun('r-replace');
    assert.equal(retrieved.status, 'completed');
    store.close();
  });

  test('deleteRun returns true when row existed and false otherwise', () => {
    const store = createStore(':memory:');
    const run   = makeRun({ runId: 'r-del' });
    store.upsertRun(run);

    assert.equal(store.deleteRun('r-del'), true);
    assert.equal(store.deleteRun('r-del'), false);  // already gone
    assert.equal(store.getRun('r-del'), null);
    store.close();
  });
});

describe('runStore — listRuns', () => {
  test('listRuns returns all rows ordered by updated_at DESC', () => {
    const store = createStore(':memory:');
    const t1 = '2026-01-01T10:00:00.000Z';
    const t2 = '2026-01-01T11:00:00.000Z';
    const t3 = '2026-01-01T12:00:00.000Z';

    store.upsertRun(makeRun({ runId: 'r-a', updatedAt: t1 }));
    store.upsertRun(makeRun({ runId: 'r-b', updatedAt: t3 }));
    store.upsertRun(makeRun({ runId: 'r-c', updatedAt: t2 }));

    const list = store.listRuns();
    assert.equal(list.length, 3);
    assert.equal(list[0].runId, 'r-b');   // most recent first
    assert.equal(list[1].runId, 'r-c');
    assert.equal(list[2].runId, 'r-a');
    store.close();
  });

  test('listRuns respects limit and offset', () => {
    const store = createStore(':memory:');
    for (let i = 0; i < 5; i++) {
      store.upsertRun(makeRun({ runId: `r-pg-${i}`, updatedAt: `2026-01-01T0${i}:00:00.000Z` }));
    }

    const page = store.listRuns({ limit: 2, offset: 1 });
    assert.equal(page.length, 2);
    store.close();
  });

  test('listRuns returns empty array when no runs exist', () => {
    const store = createStore(':memory:');
    assert.deepEqual(store.listRuns(), []);
    store.close();
  });
});

describe('runStore — listActiveRuns', () => {
  test('listActiveRuns returns only active statuses', () => {
    const store = createStore(':memory:');
    const ACTIVE   = ['pending', 'running', 'blocked', 'paused'];
    const TERMINAL = ['completed', 'failed', 'interrupted', 'aborted'];

    for (const status of [...ACTIVE, ...TERMINAL]) {
      store.upsertRun(makeRun({ runId: `r-${status}`, status }));
    }

    const active = store.listActiveRuns();
    const activeIds = new Set(active.map((r) => r.runId));
    for (const s of ACTIVE) {
      assert.ok(activeIds.has(`r-${s}`), `r-${s} should be in active list`);
    }
    for (const s of TERMINAL) {
      assert.ok(!activeIds.has(`r-${s}`), `r-${s} should NOT be in active list`);
    }
    store.close();
  });

  test('listActiveRuns returns empty array when no active runs', () => {
    const store = createStore(':memory:');
    store.upsertRun(makeRun({ runId: 'r-done', status: 'completed' }));
    assert.deepEqual(store.listActiveRuns(), []);
    store.close();
  });
});

describe('runStore — findActiveRunByTaskId', () => {
  test('returns run object when a matching active run exists', () => {
    const store = createStore(':memory:');
    const run   = makeRun({ runId: 'r-find', taskId: 'task-find', status: 'blocked' });
    store.upsertRun(run);

    const found = store.findActiveRunByTaskId('task-find');
    assert.ok(found !== null, 'should find the run');
    assert.equal(found.runId,   'r-find');
    assert.equal(found.status,  'blocked');
    store.close();
  });

  test('returns null for completed/failed/interrupted/aborted runs', () => {
    const store = createStore(':memory:');
    for (const status of ['completed', 'failed', 'interrupted', 'aborted']) {
      store.upsertRun(makeRun({ runId: `r-term-${status}`, taskId: 'task-term', status }));
    }

    assert.equal(store.findActiveRunByTaskId('task-term'), null);
    store.close();
  });

  test('returns null when no run exists for taskId', () => {
    const store = createStore(':memory:');
    assert.equal(store.findActiveRunByTaskId('no-such-task'), null);
    store.close();
  });

  test('returns the most-recently-updated active run when multiple exist', () => {
    const store = createStore(':memory:');
    const t1 = '2026-01-01T09:00:00.000Z';
    const t2 = '2026-01-01T10:00:00.000Z';

    store.upsertRun(makeRun({ runId: 'r-older',  taskId: 'task-multi', status: 'running', updatedAt: t1 }));
    store.upsertRun(makeRun({ runId: 'r-newer',  taskId: 'task-multi', status: 'running', updatedAt: t2 }));
    store.upsertRun(makeRun({ runId: 'r-done',   taskId: 'task-multi', status: 'completed' }));

    const found = store.findActiveRunByTaskId('task-multi');
    assert.ok(found !== null);
    assert.equal(found.runId, 'r-newer');   // most recent active
    store.close();
  });
});

describe('runStore — nested field round-trip', () => {
  test('upsertRun preserves nested fields: stageStatuses, worktree, blockedReason', () => {
    const store = createStore(':memory:');
    const now   = new Date().toISOString();

    const run = makeRun({
      runId:  'r-nested',
      status: 'blocked',
      stageStatuses: [
        { index: 0, agentId: 'developer-agent', status: 'completed', exitCode: 0,  startedAt: now, finishedAt: now, pid: 12345 },
        { index: 1, agentId: 'qa-engineer-e2e', status: 'pending',   exitCode: null, startedAt: null, finishedAt: null },
      ],
      worktree: {
        path:   '/tmp/worktree-test',
        branch: 'pipeline/run-abc',
        baseBranch: 'main',
      },
      blockedReason: {
        commentId:  'c-123',
        taskId:     'task-test',
        author:     'developer-agent',
        text:       'Which approach should I use?',
        blockedAt:  now,
      },
      loopCounts:    { 'developer-agent': 2 },
      dangerouslySkipPermissions: true,
      checkpoints: [1, 2],
    });

    store.upsertRun(run);
    const retrieved = store.getRun('r-nested');

    assert.ok(retrieved !== null);
    assert.equal(retrieved.runId, 'r-nested');
    assert.equal(retrieved.stageStatuses.length, 2);
    assert.equal(retrieved.stageStatuses[0].pid, 12345);
    assert.equal(retrieved.stageStatuses[0].status, 'completed');
    assert.deepEqual(retrieved.worktree, run.worktree);
    assert.deepEqual(retrieved.blockedReason, run.blockedReason);
    assert.deepEqual(retrieved.loopCounts, { 'developer-agent': 2 });
    assert.equal(retrieved.dangerouslySkipPermissions, true);
    assert.deepEqual(retrieved.checkpoints, [1, 2]);
    store.close();
  });

  test('updating a run preserves the new nested state', () => {
    const store = createStore(':memory:');
    const run   = makeRun({ runId: 'r-update-nested', status: 'running' });
    store.upsertRun(run);

    const updated = {
      ...run,
      status: 'blocked',
      blockedReason: { commentId: 'c-xyz', text: 'Question', blockedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    };
    store.upsertRun(updated);

    const retrieved = store.getRun('r-update-nested');
    assert.equal(retrieved.status, 'blocked');
    assert.ok(retrieved.blockedReason != null);
    assert.equal(retrieved.blockedReason.commentId, 'c-xyz');
    store.close();
  });
});
