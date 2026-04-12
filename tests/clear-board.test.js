/**
 * Integration tests for the Clear Board feature.
 * ADR-1 (Clear Board): covers T-001 acceptance criteria.
 *
 * Run with: node tests/clear-board.test.js
 */

'use strict';

const http = require('http');
const { startTestServer } = require('./helpers/server');

// ---------------------------------------------------------------------------
// Minimal test runner (same pattern as attachments.test.js)
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
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
// HTTP helper — port resolved after server starts
// ---------------------------------------------------------------------------

function makeRequest(port) {
  return function request(method, urlPath, body) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : undefined;
      const options = {
        hostname: 'localhost',
        port,
        path: urlPath,
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
  };
}

function totalTasks(board) {
  return board.todo.length + board['in-progress'].length + board.done.length;
}

// ---------------------------------------------------------------------------
// Main test runner
// ---------------------------------------------------------------------------

async function runTests() {
  const { port, close } = await startTestServer();
  const request = makeRequest(port);

  async function createTasks(count) {
    const ids = [];
    for (let i = 0; i < count; i++) {
      const res = await request('POST', '/api/v1/tasks', {
        title: `Clear-board test task ${i + 1}`,
        type: 'chore',
      });
      assert(res.status === 201, `Setup: expected 201, got ${res.status}`);
      ids.push(res.body.id);
    }
    return ids;
  }

  async function getBoard() {
    const res = await request('GET', '/api/v1/tasks');
    assert(res.status === 200, `getBoard: expected 200, got ${res.status}`);
    return res.body;
  }

  async function clearBoard() {
    await request('DELETE', '/api/v1/tasks');
  }

  try {
    await clearBoard();

    // -------------------------------------------------------------------------
    // Suite: empty board (idempotent path)
  // -------------------------------------------------------------------------

  suite('DELETE /api/v1/tasks — empty board');

  await test('returns 200 with { deleted: 0 } when board is already empty', async () => {
    const res = await request('DELETE', '/api/v1/tasks');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(typeof res.body.deleted === 'number', 'deleted should be a number');
    assert(res.body.deleted === 0, `Expected 0, got ${res.body.deleted}`);
  });

  await test('GET /api/v1/tasks returns all-empty columns after clearing an already-empty board', async () => {
    await request('DELETE', '/api/v1/tasks');
    const board = await getBoard();
    assert(board.todo.length === 0, 'todo should be empty');
    assert(board['in-progress'].length === 0, 'in-progress should be empty');
    assert(board.done.length === 0, 'done should be empty');
  });

  // -------------------------------------------------------------------------
  // Suite: populated board — tasks in todo only
  // -------------------------------------------------------------------------

  suite('DELETE /api/v1/tasks — tasks in todo column only');

  await test('returns 200 with correct count when tasks exist only in todo', async () => {
    await createTasks(3);
    const res = await request('DELETE', '/api/v1/tasks');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.deleted === 3, `Expected 3, got ${res.body.deleted}`);
  });

  await test('board is fully empty after clear (todo-only case)', async () => {
    const board = await getBoard();
    assert(totalTasks(board) === 0, `Expected 0 total tasks, got ${totalTasks(board)}`);
  });

  // -------------------------------------------------------------------------
  // Suite: populated board — tasks spread across all three columns
  // -------------------------------------------------------------------------

  suite('DELETE /api/v1/tasks — tasks across all three columns');

  await test('returns correct total count when tasks exist in all columns', async () => {
    // Create 3 tasks in todo, move 1 to in-progress, move 1 to done.
    const ids = await createTasks(3);
    await request('PUT', `/api/v1/tasks/${ids[0]}/move`, { to: 'in-progress' });
    await request('PUT', `/api/v1/tasks/${ids[1]}/move`, { to: 'done' });

    const boardBefore = await getBoard();
    const countBefore = totalTasks(boardBefore);
    assert(countBefore === 3, `Expected 3 tasks before clear, got ${countBefore}`);

    const res = await request('DELETE', '/api/v1/tasks');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.deleted === 3, `Expected deleted=3, got ${res.body.deleted}`);
  });

  await test('GET /api/v1/tasks returns all-empty columns after cross-column clear', async () => {
    const board = await getBoard();
    assert(board.todo.length === 0, 'todo should be empty');
    assert(board['in-progress'].length === 0, 'in-progress should be empty');
    assert(board.done.length === 0, 'done should be empty');
  });

  // -------------------------------------------------------------------------
  // Suite: large board
  // -------------------------------------------------------------------------

  suite('DELETE /api/v1/tasks — large board (20 tasks)');

  await test('clears 20 tasks and returns correct count', async () => {
    await createTasks(20);
    const res = await request('DELETE', '/api/v1/tasks');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.deleted === 20, `Expected 20, got ${res.body.deleted}`);
  });

  await test('board is empty after clearing 20 tasks', async () => {
    const board = await getBoard();
    assert(totalTasks(board) === 0, `Expected 0, got ${totalTasks(board)}`);
  });

  // -------------------------------------------------------------------------
  // Suite: idempotency — two consecutive clear calls
  // -------------------------------------------------------------------------

  suite('DELETE /api/v1/tasks — idempotency');

  await test('second clear after first returns { deleted: 0 }', async () => {
    await createTasks(2);
    const first = await request('DELETE', '/api/v1/tasks');
    assert(first.body.deleted === 2, `Expected 2 on first call, got ${first.body.deleted}`);

    const second = await request('DELETE', '/api/v1/tasks');
    assert(second.status === 200, `Expected 200 on second call, got ${second.status}`);
    assert(second.body.deleted === 0, `Expected 0 on second call, got ${second.body.deleted}`);
  });

  // -------------------------------------------------------------------------
  // Suite: routing regression — existing endpoints must not be affected
  // -------------------------------------------------------------------------

  suite('Routing regression — existing endpoints unaffected');

  await test('DELETE /api/v1/tasks/:id still deletes a specific task by ID', async () => {
    const created = await request('POST', '/api/v1/tasks', { title: 'Regression task', type: 'chore' });
    assert(created.status === 201, `Create: expected 201, got ${created.status}`);
    const taskId = created.body.id;

    const res = await request('DELETE', `/api/v1/tasks/${taskId}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.deleted === true, 'Expected { deleted: true }');
    assert(res.body.id === taskId, 'Expected correct ID in response');
  });

  await test('GET /api/v1/tasks returns structured columns after clear + create', async () => {
    await request('DELETE', '/api/v1/tasks');
    await request('POST', '/api/v1/tasks', { title: 'Post-clear task', type: 'chore' });
    const board = await getBoard();
    assert(Array.isArray(board.todo), 'todo should be an array');
    assert(Array.isArray(board['in-progress']), 'in-progress should be an array');
    assert(Array.isArray(board.done), 'done should be an array');
    assert(board.todo.length === 1, 'Should have exactly 1 task in todo');
  });

  await test('POST /api/v1/tasks still creates tasks after clear', async () => {
    await request('DELETE', '/api/v1/tasks');
    const res = await request('POST', '/api/v1/tasks', { title: 'After clear', type: 'chore' });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.body.title === 'After clear', 'Title should match');
  });

  await test('DELETE /api/v1/tasks returns 200 not 404 when board is empty', async () => {
    await request('DELETE', '/api/v1/tasks'); // pre-clear
    const res = await request('DELETE', '/api/v1/tasks');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    // Must NOT behave like DELETE /:id (which returns 404 when not found)
    assert(!res.body.error, `Should not have an error field, got: ${JSON.stringify(res.body)}`);
  });

  } finally {
    await close();
  }

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
