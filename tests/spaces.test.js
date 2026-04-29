/**
 * Integration tests for the Spaces feature.
 *
 * Covers:
 *   - Space CRUD API endpoints (GET/POST/PUT/DELETE /api/v1/spaces)
 *   - Space-scoped task routes (/api/v1/spaces/:spaceId/tasks/*)
 *   - Task isolation between spaces
 *   - Space deletion cascade (tasks removed with space)
 *   - Legacy backward-compatibility shim (/api/v1/tasks/* → default space)
 *   - Clear-board scoped to a single space
 *
 * Each test suite starts its own isolated server on a random port.
 * No shared server state between suites.
 *
 * Run with: node tests/spaces.test.js
 */

'use strict';

const http = require('http');
const { startTestServer } = require('./helpers/server');

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

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

const get  = (port, path)        => request(port, 'GET',    path);
const post = (port, path, body)  => request(port, 'POST',   path, body);
const put  = (port, path, body)  => request(port, 'PUT',    path, body);
const del  = (port, path)        => request(port, 'DELETE', path);

/** Create a task in a space and return its id. */
async function createTask(port, spaceId, payload) {
  const res = await post(port, `/api/v1/spaces/${spaceId}/tasks`, {
    title: 'Test task',
    type:  'chore',
    ...payload,
  });
  assert(res.status === 201, `createTask: expected 201, got ${res.status} — ${JSON.stringify(res.body)}`);
  return res.body.id;
}

/** Count total tasks across all columns for a space. */
async function totalTasksInSpace(port, spaceId) {
  const res = await get(port, `/api/v1/spaces/${spaceId}/tasks`);
  assert(res.status === 200, `totalTasksInSpace: expected 200, got ${res.status}`);
  const b = res.body;
  return (b.todo || []).length + (b['in-progress'] || []).length + (b.done || []).length;
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

async function runTests() {

  // =========================================================================
  // Space CRUD — GET /api/v1/spaces
  // =========================================================================

  suite('GET /api/v1/spaces — list spaces');

  await test('returns 200 with an array containing the default space', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await get(port, '/api/v1/spaces');
      assert(res.status === 200,                     'Expected 200');
      assert(Array.isArray(res.body),                'Body should be an array');
      assert(res.body.length >= 1,                   'Should have at least 1 space');
      assert(res.body.some((s) => s.id === 'default'), 'Default space should be present');
    } finally {
      await close();
    }
  });

  await test('each space has id, name, createdAt, updatedAt', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await get(port, '/api/v1/spaces');
      const space = res.body[0];
      assert(typeof space.id        === 'string', 'id should be a string');
      assert(typeof space.name      === 'string', 'name should be a string');
      assert(typeof space.createdAt === 'string', 'createdAt should be a string');
      assert(typeof space.updatedAt === 'string', 'updatedAt should be a string');
    } finally {
      await close();
    }
  });

  // =========================================================================
  // Space CRUD — POST /api/v1/spaces
  // =========================================================================

  suite('POST /api/v1/spaces — create space');

  await test('returns 201 with created space', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await post(port, '/api/v1/spaces', { name: 'Alpha' });
      assert(res.status === 201,            'Expected 201');
      assert(res.body.name === 'Alpha',     'name should match');
      assert(typeof res.body.id === 'string', 'id should be a string');
      assert(res.body.id !== 'default',     'id should not be "default"');
    } finally {
      await close();
    }
  });

  await test('new space appears in GET /api/v1/spaces', async () => {
    const { port, close } = await startTestServer();
    try {
      await post(port, '/api/v1/spaces', { name: 'Beta' });
      const list = await get(port, '/api/v1/spaces');
      assert(list.body.some((s) => s.name === 'Beta'), 'Beta should appear in list');
    } finally {
      await close();
    }
  });

  await test('returns 400 VALIDATION_ERROR for empty name', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await post(port, '/api/v1/spaces', { name: '' });
      assert(res.status === 400,                         'Expected 400');
      assert(res.body.error.code === 'VALIDATION_ERROR', 'code should be VALIDATION_ERROR');
    } finally {
      await close();
    }
  });

  await test('returns 400 VALIDATION_ERROR for whitespace-only name', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await post(port, '/api/v1/spaces', { name: '   ' });
      assert(res.status === 400, 'Expected 400');
    } finally {
      await close();
    }
  });

  await test('returns 409 DUPLICATE_NAME for duplicate space name (case-insensitive)', async () => {
    const { port, close } = await startTestServer();
    try {
      await post(port, '/api/v1/spaces', { name: 'Gamma' });
      const res = await post(port, '/api/v1/spaces', { name: 'gamma' });
      assert(res.status === 409,                       'Expected 409');
      assert(res.body.error.code === 'DUPLICATE_NAME', 'code should be DUPLICATE_NAME');
    } finally {
      await close();
    }
  });

  // =========================================================================
  // Space CRUD — GET /api/v1/spaces/:spaceId
  // =========================================================================

  suite('GET /api/v1/spaces/:spaceId — get single space');

  await test('returns 200 with the default space', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await get(port, '/api/v1/spaces/default');
      assert(res.status === 200,              'Expected 200');
      assert(res.body.id   === 'default',     'id should be "default"');
      assert(res.body.name === 'General',     'name should be "General"');
    } finally {
      await close();
    }
  });

  await test('returns 404 SPACE_NOT_FOUND for unknown id', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await get(port, '/api/v1/spaces/ghost');
      assert(res.status === 404,                       'Expected 404');
      assert(res.body.error.code === 'SPACE_NOT_FOUND', 'code should be SPACE_NOT_FOUND');
    } finally {
      await close();
    }
  });

  // =========================================================================
  // Space CRUD — PUT /api/v1/spaces/:spaceId (rename)
  // =========================================================================

  suite('PUT /api/v1/spaces/:spaceId — rename space');

  await test('returns 200 with updated space', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await put(port, '/api/v1/spaces/default', { name: 'My Board' });
      assert(res.status === 200,               'Expected 200');
      assert(res.body.name === 'My Board',     'name should be updated');
      assert(res.body.id   === 'default',      'id should be unchanged');
    } finally {
      await close();
    }
  });

  await test('renamed name persists in GET', async () => {
    const { port, close } = await startTestServer();
    try {
      await put(port, '/api/v1/spaces/default', { name: 'Persisted' });
      const res = await get(port, '/api/v1/spaces/default');
      assert(res.body.name === 'Persisted', 'Renamed name should persist');
    } finally {
      await close();
    }
  });

  await test('returns 404 for unknown spaceId', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await put(port, '/api/v1/spaces/no-such', { name: 'X' });
      assert(res.status === 404, 'Expected 404');
    } finally {
      await close();
    }
  });

  await test('returns 409 for duplicate name on rename', async () => {
    const { port, close } = await startTestServer();
    try {
      await post(port, '/api/v1/spaces', { name: 'Existing' });
      const res = await put(port, '/api/v1/spaces/default', { name: 'Existing' });
      assert(res.status === 409, 'Expected 409 for duplicate name');
    } finally {
      await close();
    }
  });

  // =========================================================================
  // Space CRUD — DELETE /api/v1/spaces/:spaceId
  // =========================================================================

  suite('DELETE /api/v1/spaces/:spaceId — delete space');

  await test('returns 200 { deleted: true, id } on success', async () => {
    const { port, close } = await startTestServer();
    try {
      const created = await post(port, '/api/v1/spaces', { name: 'Trash' });
      const id      = created.body.id;
      const res     = await del(port, `/api/v1/spaces/${id}`);
      assert(res.status === 200,       'Expected 200');
      assert(res.body.deleted === true, 'deleted should be true');
      assert(res.body.id === id,        'id should match');
    } finally {
      await close();
    }
  });

  await test('deleted space no longer appears in GET /api/v1/spaces', async () => {
    const { port, close } = await startTestServer();
    try {
      const created = await post(port, '/api/v1/spaces', { name: 'Gone' });
      await del(port, `/api/v1/spaces/${created.body.id}`);
      const list = await get(port, '/api/v1/spaces');
      assert(!list.body.some((s) => s.id === created.body.id), 'Deleted space should not appear in list');
    } finally {
      await close();
    }
  });

  await test('returns 400 LAST_SPACE when deleting the only space', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await del(port, '/api/v1/spaces/default');
      assert(res.status === 400,                   'Expected 400');
      assert(res.body.error.code === 'LAST_SPACE', 'code should be LAST_SPACE');
    } finally {
      await close();
    }
  });

  await test('returns 404 for unknown spaceId', async () => {
    const { port, close } = await startTestServer();
    try {
      await post(port, '/api/v1/spaces', { name: 'Extra' }); // ensure count > 1
      const res = await del(port, '/api/v1/spaces/ghost');
      assert(res.status === 404, 'Expected 404');
    } finally {
      await close();
    }
  });

  // =========================================================================
  // Space-scoped task routes
  // =========================================================================

  suite('Space-scoped task routes — /api/v1/spaces/:spaceId/tasks');

  await test('GET /api/v1/spaces/default/tasks returns columns', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await get(port, '/api/v1/spaces/default/tasks');
      assert(res.status === 200,                         'Expected 200');
      assert(Array.isArray(res.body.todo),               'todo should be an array');
      assert(Array.isArray(res.body['in-progress']),     'in-progress should be an array');
      assert(Array.isArray(res.body.done),               'done should be an array');
    } finally {
      await close();
    }
  });

  await test('POST /api/v1/spaces/:spaceId/tasks creates task in that space', async () => {
    const { port, close } = await startTestServer();
    try {
      const created = await post(port, '/api/v1/spaces', { name: 'MySpace' });
      const spaceId = created.body.id;

      const taskRes = await post(port, `/api/v1/spaces/${spaceId}/tasks`, {
        title: 'Space task',
        type:  'chore',
      });
      assert(taskRes.status === 201,                'Expected 201');
      assert(taskRes.body.title === 'Space task',   'title should match');
    } finally {
      await close();
    }
  });

  await test('returns 404 SPACE_NOT_FOUND for unknown spaceId on task routes', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await get(port, '/api/v1/spaces/no-such-space/tasks');
      assert(res.status === 404,                        'Expected 404');
      assert(res.body.error.code === 'SPACE_NOT_FOUND', 'code should be SPACE_NOT_FOUND');
    } finally {
      await close();
    }
  });

  await test('POST to unknown space returns 404', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await post(port, '/api/v1/spaces/ghost/tasks', { title: 'x', type: 'chore' });
      assert(res.status === 404, 'Expected 404');
    } finally {
      await close();
    }
  });

  // =========================================================================
  // Task isolation between spaces
  // =========================================================================

  suite('Task isolation — tasks in space A are not visible in space B');

  await test('task created in space A is not visible in space B', async () => {
    const { port, close } = await startTestServer();
    try {
      const spaceA = await post(port, '/api/v1/spaces', { name: 'Space A' });
      const spaceB = await post(port, '/api/v1/spaces', { name: 'Space B' });

      await createTask(port, spaceA.body.id, { title: 'Task in A' });

      const countA = await totalTasksInSpace(port, spaceA.body.id);
      const countB = await totalTasksInSpace(port, spaceB.body.id);

      assert(countA === 1, 'Space A should have 1 task');
      assert(countB === 0, 'Space B should have 0 tasks');
    } finally {
      await close();
    }
  });

  await test('default space tasks are isolated from other spaces', async () => {
    const { port, close } = await startTestServer();
    try {
      // Create a task in default space (via legacy route).
      await post(port, '/api/v1/tasks', { title: 'Default task', type: 'chore' });

      // Create a different space and check it is empty.
      const other = await post(port, '/api/v1/spaces', { name: 'Other' });
      const count = await totalTasksInSpace(port, other.body.id);
      assert(count === 0, 'Other space should be empty');
    } finally {
      await close();
    }
  });

  await test('move task within space A does not affect space B', async () => {
    const { port, close } = await startTestServer();
    try {
      const spaceA = await post(port, '/api/v1/spaces', { name: 'SA' });
      const spaceB = await post(port, '/api/v1/spaces', { name: 'SB' });

      await createTask(port, spaceB.body.id, { title: 'B task' });
      const idA = await createTask(port, spaceA.body.id, { title: 'A task' });

      await put(port, `/api/v1/spaces/${spaceA.body.id}/tasks/${idA}/move`, { to: 'done' });

      const boardA = (await get(port, `/api/v1/spaces/${spaceA.body.id}/tasks`)).body;
      const boardB = (await get(port, `/api/v1/spaces/${spaceB.body.id}/tasks`)).body;

      assert(boardA.done.length === 1,          'A done should have 1 task');
      assert(boardB.todo.length === 1,           'B todo should still have 1 task');
      assert(boardB.done.length === 0,           'B done should be empty');
    } finally {
      await close();
    }
  });

  // =========================================================================
  // Space deletion cascade
  // =========================================================================

  suite('Space deletion — tasks are removed with the space');

  await test('tasks in deleted space are not accessible after deletion', async () => {
    const { port, close } = await startTestServer();
    try {
      const created = await post(port, '/api/v1/spaces', { name: 'Doomed' });
      const spaceId = created.body.id;

      await createTask(port, spaceId, { title: 'Doom task' });
      assert((await totalTasksInSpace(port, spaceId)) === 1, 'Should have 1 task before delete');

      await del(port, `/api/v1/spaces/${spaceId}`);

      // The space is gone — GET /tasks should now return 404.
      const res = await get(port, `/api/v1/spaces/${spaceId}/tasks`);
      assert(res.status === 404, 'Tasks route should return 404 after space deletion');
    } finally {
      await close();
    }
  });

  await test('deleting space A does not affect tasks in space B', async () => {
    const { port, close } = await startTestServer();
    try {
      const spaceA = await post(port, '/api/v1/spaces', { name: 'A' });
      const spaceB = await post(port, '/api/v1/spaces', { name: 'B' });

      await createTask(port, spaceA.body.id, { title: 'A task' });
      await createTask(port, spaceB.body.id, { title: 'B task' });

      await del(port, `/api/v1/spaces/${spaceA.body.id}`);

      const countB = await totalTasksInSpace(port, spaceB.body.id);
      assert(countB === 1, 'Space B tasks should be unaffected after A is deleted');
    } finally {
      await close();
    }
  });

  // =========================================================================
  // Clear board scoped to space
  // =========================================================================

  suite('DELETE /api/v1/spaces/:spaceId/tasks — clear board for one space only');

  await test('clears only the target space, leaves other spaces intact', async () => {
    const { port, close } = await startTestServer();
    try {
      const spaceA = await post(port, '/api/v1/spaces', { name: 'ClearA' });
      const spaceB = await post(port, '/api/v1/spaces', { name: 'ClearB' });

      await createTask(port, spaceA.body.id, { title: 'A1' });
      await createTask(port, spaceA.body.id, { title: 'A2' });
      await createTask(port, spaceB.body.id, { title: 'B1' });

      const res = await del(port, `/api/v1/spaces/${spaceA.body.id}/tasks`);
      assert(res.status === 200,       'Expected 200');
      assert(res.body.deleted === 2,   'Should report 2 deleted');

      const countA = await totalTasksInSpace(port, spaceA.body.id);
      const countB = await totalTasksInSpace(port, spaceB.body.id);
      assert(countA === 0, 'Space A should be empty after clear');
      assert(countB === 1, 'Space B should be unaffected');
    } finally {
      await close();
    }
  });

  // =========================================================================
  // Legacy backward-compatibility shim
  // =========================================================================

  suite('Legacy shim — /api/v1/tasks/* proxied to default space');

  await test('GET /api/v1/tasks returns same data as GET /api/v1/spaces/default/tasks', async () => {
    const { port, close } = await startTestServer();
    try {
      // Create a task via legacy route.
      await post(port, '/api/v1/tasks', { title: 'Legacy task', type: 'chore' });

      const legacy  = (await get(port, '/api/v1/tasks')).body;
      const scoped  = (await get(port, '/api/v1/spaces/default/tasks')).body;

      assert(legacy.todo.length  === scoped.todo.length,  'todo counts should match');
      assert(legacy.todo[0].id   === scoped.todo[0].id,   'task ids should match');
    } finally {
      await close();
    }
  });

  await test('POST /api/v1/tasks creates task in default space', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await post(port, '/api/v1/tasks', { title: 'Shim create', type: 'chore' });
      assert(res.status === 201, 'Expected 201');

      const board = (await get(port, '/api/v1/spaces/default/tasks')).body;
      assert(board.todo.some((t) => t.title === 'Shim create'), 'Task should be in default space');
    } finally {
      await close();
    }
  });

  await test('PUT /api/v1/tasks/:id/move moves task in default space', async () => {
    const { port, close } = await startTestServer();
    try {
      const created = await post(port, '/api/v1/tasks', { title: 'Move me', type: 'chore' });
      const id      = created.body.id;

      const res = await put(port, `/api/v1/tasks/${id}/move`, { to: 'in-progress' });
      assert(res.status === 200, 'Expected 200');

      const board = (await get(port, '/api/v1/spaces/default/tasks')).body;
      assert(board['in-progress'].some((t) => t.id === id), 'Task should be in in-progress');
    } finally {
      await close();
    }
  });

  await test('DELETE /api/v1/tasks/:id deletes task from default space', async () => {
    const { port, close } = await startTestServer();
    try {
      const created = await post(port, '/api/v1/tasks', { title: 'Del me', type: 'chore' });
      const id      = created.body.id;

      const res = await del(port, `/api/v1/tasks/${id}`);
      assert(res.status === 200,        'Expected 200');
      assert(res.body.deleted === true, 'deleted should be true');

      const board = (await get(port, '/api/v1/spaces/default/tasks')).body;
      assert(!board.todo.some((t) => t.id === id), 'Task should be gone from default space');
    } finally {
      await close();
    }
  });

  await test('DELETE /api/v1/tasks clears only the default space board', async () => {
    const { port, close } = await startTestServer();
    try {
      const other = await post(port, '/api/v1/spaces', { name: 'Other' });

      // Create tasks in both spaces.
      await post(port, '/api/v1/tasks', { title: 'Default 1', type: 'chore' });
      await createTask(port, other.body.id, { title: 'Other 1' });

      await del(port, '/api/v1/tasks');

      const defaultCount = await totalTasksInSpace(port, 'default');
      const otherCount   = await totalTasksInSpace(port, other.body.id);

      assert(defaultCount === 0, 'Default space should be cleared');
      assert(otherCount   === 1, 'Other space should be unaffected');
    } finally {
      await close();
    }
  });

  await test('PUT /api/v1/tasks/:id updates task in default space', async () => {
    const { port, close } = await startTestServer();
    try {
      const created = await post(port, '/api/v1/tasks', { title: 'Old title', type: 'chore' });
      const id      = created.body.id;

      const res = await put(port, `/api/v1/tasks/${id}`, { title: 'New title' });
      assert(res.status === 200,                'Expected 200');
      assert(res.body.title === 'New title',    'title should be updated');
    } finally {
      await close();
    }
  });

  // =========================================================================
  // Regression — existing task endpoints unaffected
  // =========================================================================

  suite('Regression — existing task endpoints on default space work correctly');

  await test('all three columns are returned by GET /api/v1/tasks', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await get(port, '/api/v1/tasks');
      assert(res.status === 200,                     'Expected 200');
      assert(Array.isArray(res.body.todo),           'todo should be array');
      assert(Array.isArray(res.body['in-progress']), 'in-progress should be array');
      assert(Array.isArray(res.body.done),           'done should be array');
    } finally {
      await close();
    }
  });

  await test('POST /api/v1/tasks validates title', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await post(port, '/api/v1/tasks', { title: '', type: 'chore' });
      assert(res.status === 400, 'Expected 400 for empty title');
    } finally {
      await close();
    }
  });

  await test('POST /api/v1/tasks rejects legacy type "task" with 400 (v1.2.0)', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await post(port, '/api/v1/tasks', { title: 'Legacy', type: 'task' });
      assert(res.status === 400, 'Expected 400 for legacy type "task"');
      assert(res.body.error.code === 'VALIDATION_ERROR', 'Expected VALIDATION_ERROR code');
    } finally {
      await close();
    }
  });

  await test('POST /api/v1/tasks rejects legacy type "research" with 400 (v1.2.0)', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await post(port, '/api/v1/tasks', { title: 'Legacy', type: 'research' });
      assert(res.status === 400, 'Expected 400 for legacy type "research"');
      assert(res.body.error.code === 'VALIDATION_ERROR', 'Expected VALIDATION_ERROR code');
    } finally {
      await close();
    }
  });

  await test('POST /api/v1/tasks accepts all 4 new types (v1.2.0)', async () => {
    const { port, close } = await startTestServer();
    const VALID_TYPES = ['feature', 'bug', 'tech-debt', 'chore'];
    try {
      for (const type of VALID_TYPES) {
        const res = await post(port, '/api/v1/tasks', { title: `Test ${type}`, type });
        assert(res.status === 201, `Expected 201 for type "${type}", got ${res.status}`);
        assert(res.body.type === type, `Expected type "${type}" in response`);
      }
    } finally {
      await close();
    }
  });

  await test('task created via space-scoped route is not visible via different spaceId', async () => {
    const { port, close } = await startTestServer();
    try {
      const spaceA = await post(port, '/api/v1/spaces', { name: 'RegA' });

      await createTask(port, spaceA.body.id, { title: 'Isolated' });

      // Must not appear in default space.
      const defaultBoard = (await get(port, '/api/v1/spaces/default/tasks')).body;
      const found = [
        ...defaultBoard.todo,
        ...defaultBoard['in-progress'],
        ...defaultBoard.done,
      ].some((t) => t.title === 'Isolated');
      assert(!found, 'Task should not appear in default space');
    } finally {
      await close();
    }
  });

  // =========================================================================
  // Search endpoint (HIGH-001)
  // =========================================================================

  suite('GET /api/v1/spaces/:spaceId/tasks/search');

  await test('should_return_matching_tasks_for_valid_query', async () => {
    const { port, close } = await startTestServer();
    try {
      const spaceRes = await post(port, '/api/v1/spaces', { name: 'SearchSpace' });
      const spaceId  = spaceRes.body.id;

      await createTask(port, spaceId, { title: 'Fix SQLite migration bug', type: 'bug' });
      await createTask(port, spaceId, { title: 'Add feature for dashboard', type: 'feature' });

      const res = await get(port, `/api/v1/spaces/${spaceId}/tasks/search?q=SQLite`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(Array.isArray(res.body.results), 'results must be an array');
      assert(typeof res.body.total === 'number', 'total must be a number');
      assert(res.body.total === 1, `Expected 1 result, got ${res.body.total}`);
      assert(res.body.results[0].title === 'Fix SQLite migration bug', 'Wrong task returned');
    } finally {
      await close();
    }
  });

  await test('should_return_400_when_q_param_is_missing', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await get(port, '/api/v1/spaces/default/tasks/search');
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', 'Expected VALIDATION_ERROR');
    } finally {
      await close();
    }
  });

  await test('should_return_400_when_q_param_is_empty_string', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await get(port, `/api/v1/spaces/default/tasks/search?q=${encodeURIComponent('   ')}`);
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', 'Expected VALIDATION_ERROR');
    } finally {
      await close();
    }
  });

  await test('should_return_404_for_unknown_space', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await get(port, '/api/v1/spaces/nonexistent-space/tasks/search?q=anything');
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(res.body.error.code === 'SPACE_NOT_FOUND', 'Expected SPACE_NOT_FOUND');
    } finally {
      await close();
    }
  });

  await test('should_isolate_search_results_between_spaces', async () => {
    const { port, close } = await startTestServer();
    try {
      const spaceA = (await post(port, '/api/v1/spaces', { name: 'SpaceA' })).body.id;
      const spaceB = (await post(port, '/api/v1/spaces', { name: 'SpaceB' })).body.id;

      await createTask(port, spaceA, { title: 'Unique task in space A', type: 'feature' });
      await createTask(port, spaceB, { title: 'Different task in space B', type: 'bug' });

      const resA = await get(port, `/api/v1/spaces/${spaceA}/tasks/search?q=Unique`);
      assert(resA.status === 200, `SpaceA search: expected 200, got ${resA.status}`);
      assert(resA.body.total === 1, `SpaceA: expected 1 result, got ${resA.body.total}`);

      const resB = await get(port, `/api/v1/spaces/${spaceB}/tasks/search?q=Unique`);
      assert(resB.status === 200, `SpaceB search: expected 200, got ${resB.status}`);
      assert(resB.body.total === 0, `SpaceB: expected 0 results, got ${resB.body.total}`);
    } finally {
      await close();
    }
  });

  await test('should_respect_limit_query_param', async () => {
    const { port, close } = await startTestServer();
    try {
      const spaceRes = await post(port, '/api/v1/spaces', { name: 'LimitSpace' });
      const spaceId  = spaceRes.body.id;

      // Create 3 tasks all matching "task"
      for (let i = 1; i <= 3; i++) {
        await createTask(port, spaceId, { title: `task number ${i}`, type: 'chore' });
      }

      const res = await get(port, `/api/v1/spaces/${spaceId}/tasks/search?q=task&limit=2`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.results.length <= 2, `Expected at most 2 results, got ${res.body.results.length}`);
    } finally {
      await close();
    }
  });

  // =========================================================================
  // Summary
  // =========================================================================

  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailed tests:');
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
    process.exit(1);
  } else {
    console.log('All tests passed.');
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
