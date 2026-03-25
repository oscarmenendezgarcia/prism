/**
 * Integration tests for GET /api/v1/tasks pagination and server-side filtering.
 *
 * Run with: node tests/list-tasks-pagination.test.js
 * Requires the server to be running on http://localhost:3000.
 */

'use strict';

const http = require('http');

// ---------------------------------------------------------------------------
// Minimal test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
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

function suite(name) { console.log(`\n${name}`); }

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function clearBoard() { await request('DELETE', '/api/v1/tasks'); }

async function createTask(title, assigned) {
  const res = await request('POST', '/api/v1/tasks', {
    title,
    type: 'task',
    ...(assigned ? { assigned } : {}),
  });
  assert(res.status === 201, `createTask: expected 201, got ${res.status}`);
  return res.body.id;
}

function totalTasks(body) {
  return (body.todo?.length ?? 0) + (body['in-progress']?.length ?? 0) + (body.done?.length ?? 0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  await clearBoard();

  // -------------------------------------------------------------------------

  suite('GET /api/v1/tasks — response shape');

  await test('returns total and nextCursor fields alongside column arrays', async () => {
    await clearBoard();
    await createTask('T1');
    const res = await request('GET', '/api/v1/tasks');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(typeof res.body.total === 'number', 'total must be a number');
    assert('nextCursor' in res.body, 'nextCursor must be present');
    assert(Array.isArray(res.body.todo), 'todo must be an array');
    assert(Array.isArray(res.body['in-progress']), 'in-progress must be an array');
    assert(Array.isArray(res.body.done), 'done must be an array');
    await clearBoard();
  });

  await test('total reflects the count of all tasks on the board', async () => {
    await clearBoard();
    await createTask('A');
    await createTask('B');
    await createTask('C');
    const res = await request('GET', '/api/v1/tasks');
    assert(res.body.total === 3, `Expected total=3, got ${res.body.total}`);
    await clearBoard();
  });

  await test('nextCursor is null when all tasks fit in one page', async () => {
    await clearBoard();
    await createTask('only');
    const res = await request('GET', '/api/v1/tasks?limit=50');
    assert(res.body.nextCursor === null, `Expected nextCursor=null, got ${res.body.nextCursor}`);
    await clearBoard();
  });

  // -------------------------------------------------------------------------

  suite('GET /api/v1/tasks — limit parameter');

  await test('respects limit: returns at most N tasks', async () => {
    await clearBoard();
    for (let i = 0; i < 5; i++) await createTask(`Task ${i}`);
    const res = await request('GET', '/api/v1/tasks?limit=3');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(totalTasks(res.body) === 3, `Expected 3 tasks, got ${totalTasks(res.body)}`);
    assert(res.body.total === 5, `Expected total=5, got ${res.body.total}`);
    assert(res.body.nextCursor !== null, 'Expected nextCursor to be set');
    await clearBoard();
  });

  await test('default limit is 50 (does not return more than 50 without cursor)', async () => {
    await clearBoard();
    for (let i = 0; i < 60; i++) await createTask(`Bulk ${i}`);
    const res = await request('GET', '/api/v1/tasks');
    assert(totalTasks(res.body) === 50, `Expected 50, got ${totalTasks(res.body)}`);
    assert(res.body.total === 60, `Expected total=60, got ${res.body.total}`);
    assert(res.body.nextCursor !== null, 'Expected nextCursor to be set');
    await clearBoard();
  });

  // -------------------------------------------------------------------------

  suite('GET /api/v1/tasks — cursor pagination');

  await test('cursor returns the next page without overlap or gap', async () => {
    await clearBoard();
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await createTask(`Page task ${i}`));

    const page1 = await request('GET', '/api/v1/tasks?limit=3');
    assert(totalTasks(page1.body) === 3, `Page 1: expected 3, got ${totalTasks(page1.body)}`);
    assert(page1.body.nextCursor !== null, 'Page 1 must have nextCursor');

    const page2 = await request('GET', `/api/v1/tasks?limit=3&cursor=${page1.body.nextCursor}`);
    assert(totalTasks(page2.body) === 2, `Page 2: expected 2, got ${totalTasks(page2.body)}`);
    assert(page2.body.nextCursor === null, 'Page 2 must not have nextCursor');

    // No overlap between pages
    const ids1 = page1.body.todo.map((t) => t.id);
    const ids2 = page2.body.todo.map((t) => t.id);
    const overlap = ids1.filter((id) => ids2.includes(id));
    assert(overlap.length === 0, `Expected no overlap, got: ${overlap}`);

    // Combined total equals all tasks
    assert(ids1.length + ids2.length === 5, 'Combined pages should cover all 5 tasks');
    await clearBoard();
  });

  await test('cursor pages across multiple columns', async () => {
    await clearBoard();
    const id1 = await createTask('T-todo');
    const id2 = await createTask('T-ip');
    const id3 = await createTask('T-done');
    await request('PUT', `/api/v1/tasks/${id2}/move`, { to: 'in-progress' });
    await request('PUT', `/api/v1/tasks/${id3}/move`, { to: 'done' });

    const page1 = await request('GET', '/api/v1/tasks?limit=2');
    assert(totalTasks(page1.body) === 2, `Page 1: expected 2, got ${totalTasks(page1.body)}`);

    const page2 = await request('GET', `/api/v1/tasks?limit=2&cursor=${page1.body.nextCursor}`);
    assert(totalTasks(page2.body) === 1, `Page 2: expected 1, got ${totalTasks(page2.body)}`);
    assert(page2.body.nextCursor === null, 'Page 2 should have no cursor');

    await clearBoard();
  });

  // -------------------------------------------------------------------------

  suite('GET /api/v1/tasks — server-side filters');

  await test('column filter returns only the requested column', async () => {
    await clearBoard();
    await createTask('In todo');
    const res = await request('GET', '/api/v1/tasks?column=todo');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.body.todo), 'todo array must be present');
    assert(!('in-progress' in res.body), 'in-progress must not be present');
    assert(!('done' in res.body), 'done must not be present');
    await clearBoard();
  });

  await test('assigned filter returns only tasks matching the agent', async () => {
    await clearBoard();
    await createTask('By agent-x', 'agent-x');
    await createTask('By agent-y', 'agent-y');
    const res = await request('GET', '/api/v1/tasks?assigned=agent-x');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.total === 1, `Expected total=1, got ${res.body.total}`);
    assert(res.body.todo[0].assigned === 'agent-x', 'Task must belong to agent-x');
    await clearBoard();
  });

  await test('combined column + assigned + limit filters work together', async () => {
    await clearBoard();
    await createTask('A1', 'agent-a');
    await createTask('A2', 'agent-a');
    await createTask('B1', 'agent-b');
    const res = await request('GET', '/api/v1/tasks?column=todo&assigned=agent-a&limit=1');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(totalTasks(res.body) === 1, `Expected 1, got ${totalTasks(res.body)}`);
    assert(res.body.total === 2, `Expected total=2, got ${res.body.total}`);
    assert(res.body.nextCursor !== null, 'Should have nextCursor for second page');
    await clearBoard();
  });

  // -------------------------------------------------------------------------

  suite('GET /api/v1/tasks — error cases');

  await test('invalid column returns 400 VALIDATION_ERROR', async () => {
    const res = await request('GET', '/api/v1/tasks?column=invalid');
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error.code === 'VALIDATION_ERROR', `Expected VALIDATION_ERROR, got ${res.body.error.code}`);
  });

  await test('invalid cursor returns 400 VALIDATION_ERROR', async () => {
    const res = await request('GET', '/api/v1/tasks?cursor=!!!notbase64!!!');
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error.code === 'VALIDATION_ERROR', `Expected VALIDATION_ERROR, got ${res.body.error.code}`);
  });

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------
  await clearBoard();

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailed tests:');
    for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
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
