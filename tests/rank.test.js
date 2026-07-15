'use strict';

/**
 * Tests for the QOL-1 rank + drag-to-reorder feature.
 *
 * Covers:
 *   - Store: reorderTask, getTasksByColumn ordering, insertTask tail rank,
 *     moveTask tail rank in destination, null on missing task, migration seeding.
 *   - HTTP: PATCH /spaces/:spaceId/tasks/:taskId/rank (200, 400s, 404).
 *
 * Run with: node tests/rank.test.js
 */

const http = require('http');
const { startTestServer } = require('./helpers/server');
const { createStore } = require('../src/services/store');

// ---------------------------------------------------------------------------
// Minimal test runner
// ---------------------------------------------------------------------------

let passed   = 0;
let failed   = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

function suite(name) {
  console.log(`\n${name}`);
}

// ---------------------------------------------------------------------------
// HTTP helper (port-aware)
// ---------------------------------------------------------------------------

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const options = {
      hostname: 'localhost',
      port,
      path:     urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const get   = (port, path)       => request(port, 'GET',   path);
const post  = (port, path, body) => request(port, 'POST',  path, body);
const patch = (port, path, body) => request(port, 'PATCH', path, body);

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------

function makeSpace(overrides = {}) {
  return {
    id:        overrides.id        ?? 'space-1',
    name:      overrides.name      ?? 'Test Space',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

let _taskCounter = 0;
function makeTask(overrides = {}) {
  _taskCounter++;
  return {
    id:        overrides.id        ?? `task-${_taskCounter}`,
    title:     overrides.title     ?? 'Test Task',
    type:      overrides.type      ?? 'feature',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

async function runTests() {

  // =========================================================================
  // Store: reorderTask updates rank
  // =========================================================================

  suite('Store — reorderTask updates rank');

  await test('reorderTask changes the rank of the specified task', async () => {
    const store = createStore(':memory:');
    store.upsertSpace(makeSpace());

    const t1 = makeTask({ id: 'task-a', createdAt: '2026-01-01T00:00:00.000Z' });
    const t2 = makeTask({ id: 'task-b', createdAt: '2026-01-01T00:01:00.000Z' });
    store.insertTask(t1, 'space-1', 'todo');
    store.insertTask(t2, 'space-1', 'todo');

    // task-a gets rank 1000, task-b gets rank 2000 (tail)
    const result = store.reorderTask('space-1', 'task-a', 2500);
    assert(result !== null, 'reorderTask should return the updated task');
    assert(result.rank === 2500, `Expected rank 2500, got ${result.rank}`);
    store.close();
  });

  // =========================================================================
  // Store: getTasksByColumn returns tasks in rank order
  // =========================================================================

  suite('Store — getTasksByColumn returns tasks in rank order');

  await test('tasks are returned in rank ASC order after reordering', async () => {
    const store = createStore(':memory:');
    store.upsertSpace(makeSpace());

    const t1 = makeTask({ id: 'task-1', createdAt: '2026-01-01T00:00:00.000Z' });
    const t2 = makeTask({ id: 'task-2', createdAt: '2026-01-01T00:01:00.000Z' });
    const t3 = makeTask({ id: 'task-3', createdAt: '2026-01-01T00:02:00.000Z' });
    store.insertTask(t1, 'space-1', 'todo');
    store.insertTask(t2, 'space-1', 'todo');
    store.insertTask(t3, 'space-1', 'todo');

    // Ranks: 1000, 2000, 3000 by default
    // Move task-1 to the end (rank 4000)
    store.reorderTask('space-1', 'task-1', 4000);

    const tasks = store.getTasksByColumn('space-1', 'todo');
    assert(tasks.length === 3, `Expected 3 tasks, got ${tasks.length}`);
    assert(tasks[0].id === 'task-2', `Expected task-2 first, got ${tasks[0].id}`);
    assert(tasks[1].id === 'task-3', `Expected task-3 second, got ${tasks[1].id}`);
    assert(tasks[2].id === 'task-1', `Expected task-1 last, got ${tasks[2].id}`);
    store.close();
  });

  // =========================================================================
  // Store: insertTask assigns tail rank
  // =========================================================================

  suite('Store — insertTask assigns tail rank');

  await test('new task gets MAX(existing rank) + 1000', async () => {
    const store = createStore(':memory:');
    store.upsertSpace(makeSpace());

    const t1 = makeTask({ id: 'task-x', createdAt: '2026-01-01T00:00:00.000Z' });
    store.insertTask(t1, 'space-1', 'todo');
    // t1 rank = 1000 (first task, 0 + 1000)

    const t2 = makeTask({ id: 'task-y', createdAt: '2026-01-01T00:01:00.000Z' });
    store.insertTask(t2, 'space-1', 'todo');
    // t2 rank should be 2000 (1000 + 1000)

    const tasks = store.getTasksByColumn('space-1', 'todo');
    assert(tasks.length === 2, `Expected 2 tasks, got ${tasks.length}`);
    assert(tasks[0].rank === 1000, `Expected rank 1000, got ${tasks[0].rank}`);
    assert(tasks[1].rank === 2000, `Expected rank 2000, got ${tasks[1].rank}`);
    store.close();
  });

  // =========================================================================
  // Store: moveTask assigns tail rank in destination
  // =========================================================================

  suite('Store — moveTask assigns tail rank in destination column');

  await test('moved task gets MAX(dest rank) + 1000', async () => {
    const store = createStore(':memory:');
    store.upsertSpace(makeSpace());

    // Create two tasks in 'in-progress'
    const t1 = makeTask({ id: 'ip-1', createdAt: '2026-01-01T00:00:00.000Z' });
    const t2 = makeTask({ id: 'ip-2', createdAt: '2026-01-01T00:01:00.000Z' });
    store.insertTask(t1, 'space-1', 'in-progress');
    store.insertTask(t2, 'space-1', 'in-progress');
    // ranks: 1000, 2000

    // Create a task in todo
    const todo = makeTask({ id: 'todo-1', createdAt: '2026-01-01T00:02:00.000Z' });
    store.insertTask(todo, 'space-1', 'todo');

    // Move todo task to in-progress — should get rank 3000
    const moved = store.moveTask('space-1', 'todo-1', 'in-progress');
    assert(moved !== null, 'moveTask should return the updated task');
    assert(moved.rank === 3000, `Expected rank 3000, got ${moved.rank}`);

    // Verify ordering in in-progress
    const tasks = store.getTasksByColumn('space-1', 'in-progress');
    assert(tasks.length === 3, `Expected 3 tasks, got ${tasks.length}`);
    assert(tasks[2].id === 'todo-1', `Expected todo-1 last, got ${tasks[2].id}`);
    store.close();
  });

  // =========================================================================
  // Store: reorderTask returns null for missing task
  // =========================================================================

  suite('Store — reorderTask returns null when task not found');

  await test('reorderTask returns null for a non-existent task', async () => {
    const store = createStore(':memory:');
    store.upsertSpace(makeSpace());

    const result = store.reorderTask('space-1', 'does-not-exist', 1000);
    assert(result === null, `Expected null, got ${JSON.stringify(result)}`);
    store.close();
  });

  // =========================================================================
  // Store: migration seeds ranks from created_at order
  // =========================================================================

  suite('Store — migration seeds ranks from created_at order');

  await test('tasks inserted in created_at order get ranks 1000, 2000, 3000', async () => {
    const store = createStore(':memory:');
    store.upsertSpace({ id: 'space-m', name: 'M', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });

    // Insert tasks with explicit createdAt ordering
    const tA = makeTask({ id: 'mk-a', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    const tB = makeTask({ id: 'mk-b', createdAt: '2026-01-01T01:00:00.000Z', updatedAt: '2026-01-01T01:00:00.000Z' });
    const tC = makeTask({ id: 'mk-c', createdAt: '2026-01-01T02:00:00.000Z', updatedAt: '2026-01-01T02:00:00.000Z' });
    store.insertTask(tA, 'space-m', 'todo');
    store.insertTask(tB, 'space-m', 'todo');
    store.insertTask(tC, 'space-m', 'todo');

    const tasks = store.getTasksByColumn('space-m', 'todo');
    assert(tasks[0].id === 'mk-a' && tasks[0].rank === 1000, `Expected mk-a rank 1000, got ${tasks[0].id} ${tasks[0].rank}`);
    assert(tasks[1].id === 'mk-b' && tasks[1].rank === 2000, `Expected mk-b rank 2000, got ${tasks[1].id} ${tasks[1].rank}`);
    assert(tasks[2].id === 'mk-c' && tasks[2].rank === 3000, `Expected mk-c rank 3000, got ${tasks[2].id} ${tasks[2].rank}`);
    store.close();
  });

  // =========================================================================
  // HTTP: PATCH /rank 200 success
  // =========================================================================

  suite('PATCH /spaces/:spaceId/tasks/:taskId/rank — 200 success');

  await test('returns 200 and updates task rank', async () => {
    const { port, close } = await startTestServer();
    try {
      // Create a task
      const createRes = await post(port, '/api/v1/spaces/default/tasks', {
        title: 'Rank test task',
        type:  'chore',
      });
      assert(createRes.status === 201, `Expected 201, got ${createRes.status}`);
      const taskId = createRes.body.id;

      // Reorder it
      const rankRes = await patch(port, `/api/v1/spaces/default/tasks/${taskId}/rank`, { rank: 5000 });
      assert(rankRes.status === 200, `Expected 200, got ${rankRes.status}: ${JSON.stringify(rankRes.body)}`);
      assert(rankRes.body.id === taskId, 'Response should include task id');
      assert(rankRes.body.rank === 5000, `Expected rank 5000, got ${rankRes.body.rank}`);
    } finally {
      await close();
    }
  });

  // =========================================================================
  // HTTP: PATCH /rank 400 missing rank
  // =========================================================================

  suite('PATCH /rank — 400 missing rank field');

  await test('returns 400 when rank is missing from body', async () => {
    const { port, close } = await startTestServer();
    try {
      const createRes = await post(port, '/api/v1/spaces/default/tasks', {
        title: 'Rank validation task',
        type:  'chore',
      });
      const taskId = createRes.body.id;

      const res = await patch(port, `/api/v1/spaces/default/tasks/${taskId}/rank`, {});
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', `Expected VALIDATION_ERROR, got ${res.body.error.code}`);
    } finally {
      await close();
    }
  });

  // =========================================================================
  // HTTP: PATCH /rank 400 non-numeric rank
  // =========================================================================

  suite('PATCH /rank — 400 non-numeric rank');

  await test('returns 400 when rank is a non-numeric string', async () => {
    const { port, close } = await startTestServer();
    try {
      const createRes = await post(port, '/api/v1/spaces/default/tasks', {
        title: 'Rank NaN task',
        type:  'chore',
      });
      const taskId = createRes.body.id;

      const res = await patch(port, `/api/v1/spaces/default/tasks/${taskId}/rank`, { rank: 'not-a-number' });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', `Expected VALIDATION_ERROR, got ${res.body.error.code}`);
    } finally {
      await close();
    }
  });

  // =========================================================================
  // HTTP: PATCH /rank 404 unknown task
  // =========================================================================

  suite('PATCH /rank — 404 unknown task');

  await test('returns 404 when task does not exist', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await patch(port, '/api/v1/spaces/default/tasks/non-existent-id/rank', { rank: 1000 });
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(res.body.error.code === 'TASK_NOT_FOUND', `Expected TASK_NOT_FOUND, got ${res.body.error.code}`);
    } finally {
      await close();
    }
  });

  // =========================================================================
  // Store: reorderTasks (batch, atomic)
  // =========================================================================

  suite('Store — reorderTasks batches updates atomically');

  await test('applies all updates in one transaction', async () => {
    const store = createStore(':memory:');
    store.upsertSpace(makeSpace());
    store.insertTask(makeTask({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }), 'space-1', 'todo');
    store.insertTask(makeTask({ id: 'b', createdAt: '2026-01-01T00:01:00.000Z' }), 'space-1', 'todo');
    store.insertTask(makeTask({ id: 'c', createdAt: '2026-01-01T00:02:00.000Z' }), 'space-1', 'todo');

    const updated = store.reorderTasks('space-1', [
      { id: 'a', rank: 3000 },
      { id: 'b', rank: 1000 },
      { id: 'c', rank: 2000 },
    ]);
    assert(Array.isArray(updated) && updated.length === 3, 'reorderTasks should return updated tasks');
    const tasks = store.getTasksByColumn('space-1', 'todo');
    assert(tasks[0].id === 'b' && tasks[0].rank === 1000, 'b first at 1000');
    assert(tasks[1].id === 'c' && tasks[1].rank === 2000, 'c second at 2000');
    assert(tasks[2].id === 'a' && tasks[2].rank === 3000, 'a last at 3000');
    store.close();
  });

  await test('rolls back all updates when any task id is missing (atomicity)', async () => {
    const store = createStore(':memory:');
    store.upsertSpace(makeSpace());
    store.insertTask(makeTask({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }), 'space-1', 'todo');
    store.insertTask(makeTask({ id: 'b', createdAt: '2026-01-01T00:01:00.000Z' }), 'space-1', 'todo');
    // Original ranks: a=1000, b=2000

    let threw = null;
    try {
      store.reorderTasks('space-1', [
        { id: 'a', rank: 9000 },
        { id: 'ghost', rank: 9500 },
        { id: 'b', rank: 9999 },
      ]);
    } catch (err) {
      threw = err;
    }
    assert(threw && threw.code === 'TASK_NOT_FOUND', 'should throw TASK_NOT_FOUND');
    const tasks = store.getTasksByColumn('space-1', 'todo');
    assert(tasks[0].id === 'a' && tasks[0].rank === 1000, `a rank rolled back, got ${tasks[0].rank}`);
    assert(tasks[1].id === 'b' && tasks[1].rank === 2000, `b rank rolled back, got ${tasks[1].rank}`);
    store.close();
  });

  // =========================================================================
  // HTTP: PATCH /tasks/rank batch
  // =========================================================================

  suite('PATCH /spaces/:spaceId/tasks/rank — batch');

  await test('200 applies all rank updates atomically', async () => {
    const { port, close } = await startTestServer();
    try {
      const t1 = (await post(port, '/api/v1/spaces/default/tasks', { title: 'A', type: 'chore' })).body;
      const t2 = (await post(port, '/api/v1/spaces/default/tasks', { title: 'B', type: 'chore' })).body;
      const t3 = (await post(port, '/api/v1/spaces/default/tasks', { title: 'C', type: 'chore' })).body;

      const res = await patch(port, '/api/v1/spaces/default/tasks/rank', {
        updates: [
          { id: t1.id, rank: 3000 },
          { id: t2.id, rank: 1000 },
          { id: t3.id, rank: 2000 },
        ],
      });
      assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert(Array.isArray(res.body.tasks) && res.body.tasks.length === 3, 'response.tasks[3]');

      const listRes = await get(port, '/api/v1/spaces/default/tasks');
      const todo = listRes.body.todo;
      assert(todo[0].id === t2.id, `first should be t2, got ${todo[0].id}`);
      assert(todo[1].id === t3.id, `second should be t3, got ${todo[1].id}`);
      assert(todo[2].id === t1.id, `third should be t1, got ${todo[2].id}`);
    } finally {
      await close();
    }
  });

  await test('404 and full rollback when any id is unknown', async () => {
    const { port, close } = await startTestServer();
    try {
      const t1 = (await post(port, '/api/v1/spaces/default/tasks', { title: 'A', type: 'chore' })).body;
      const t2 = (await post(port, '/api/v1/spaces/default/tasks', { title: 'B', type: 'chore' })).body;
      // originals: t1 rank 1000, t2 rank 2000

      const res = await patch(port, '/api/v1/spaces/default/tasks/rank', {
        updates: [
          { id: t1.id, rank: 9000 },
          { id: 'does-not-exist', rank: 9500 },
          { id: t2.id, rank: 9999 },
        ],
      });
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(res.body.error.code === 'TASK_NOT_FOUND', `Expected TASK_NOT_FOUND, got ${res.body.error.code}`);

      const listRes = await get(port, '/api/v1/spaces/default/tasks');
      const todo = listRes.body.todo;
      const gotT1 = todo.find((t) => t.id === t1.id);
      const gotT2 = todo.find((t) => t.id === t2.id);
      assert(gotT1.rank === 1000, `t1 rank rolled back to 1000, got ${gotT1.rank}`);
      assert(gotT2.rank === 2000, `t2 rank rolled back to 2000, got ${gotT2.rank}`);
    } finally {
      await close();
    }
  });

  await test('400 when body has no updates array', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await patch(port, '/api/v1/spaces/default/tasks/rank', {});
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', `Expected VALIDATION_ERROR, got ${res.body.error.code}`);
    } finally {
      await close();
    }
  });

  await test('400 when an update item has non-numeric rank', async () => {
    const { port, close } = await startTestServer();
    try {
      const t1 = (await post(port, '/api/v1/spaces/default/tasks', { title: 'A', type: 'chore' })).body;
      const res = await patch(port, '/api/v1/spaces/default/tasks/rank', {
        updates: [{ id: t1.id, rank: 'nope' }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', `Expected VALIDATION_ERROR, got ${res.body.error.code}`);
    } finally {
      await close();
    }
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failures.length > 0) {
    console.error('Failures:');
    for (const f of failures) {
      console.error(`  ${f.name}: ${f.error}`);
    }
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
