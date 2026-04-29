/**
 * T-009: Concurrency regression test for parallel task writes.
 *
 * Fires 20 PUT /tasks/:id/move requests concurrently against the same space
 * and asserts that:
 *   1. All 20 requests complete with HTTP 200.
 *   2. Each task is found in its expected destination column (no lost updates).
 *
 * Why this test matters vs. the old JSON-file implementation:
 *   The previous implementation used fs.readFileSync / fs.writeFileSync with a
 *   rename-to-tmp pattern that was NOT atomic under concurrent Node.js event
 *   loop callbacks.  Under the old approach, two concurrent moves could read the
 *   same stale file, write independent results, and one write would silently
 *   overwrite the other — effectively losing a task move (race condition).
 *
 *   SQLite's WAL mode with better-sqlite3's synchronous API serialises all
 *   writes at the DB level, making concurrent moves safe.  This test
 *   demonstrates that all 20 moves are durably recorded with no lost updates.
 *
 * Run with: node tests/concurrency.test.js
 * Starts its own isolated server on a random port; no running server needed.
 */

'use strict';

const http = require('http');
const { startTestServer } = require('./helpers/server');

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

function suite(name) {
  console.log(`\n${name}`);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function makeRequest(port) {
  return function request(method, urlPath, body) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : undefined;
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
        res.on('data', (c) => { data += c; });
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

// ---------------------------------------------------------------------------
// Setup: create a space and 20 tasks, then return their IDs
// ---------------------------------------------------------------------------

async function setup(request, spaceId) {
  const tasks = [];
  for (let i = 0; i < 20; i++) {
    const res = await request('POST', `/api/v1/spaces/${spaceId}/tasks`, {
      title: `Concurrent Task ${i}`,
      type:  'chore',
    });
    assert(res.status === 201, `Task creation should return 201 (got ${res.status})`);
    tasks.push(res.body);
  }
  return tasks;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {

  suite('Concurrent PUT /tasks/:id/move — 20 parallel writes');

  // -------------------------------------------------------------------------
  // Test 1: all 20 concurrent moves return HTTP 200
  // -------------------------------------------------------------------------
  await test('all 20 concurrent moves return HTTP 200', async () => {
    const { port, close } = await startTestServer();
    const request = makeRequest(port);

    try {
      // Retrieve the default space id.
      const spacesRes = await request('GET', '/api/v1/spaces');
      assert(spacesRes.status === 200, 'GET /spaces should return 200');
      const spaceId = spacesRes.body[0].id;

      const tasks = await setup(request, spaceId);

      // Fire all 20 moves concurrently.
      const responses = await Promise.all(
        tasks.map((t) =>
          request('PUT', `/api/v1/spaces/${spaceId}/tasks/${t.id}/move`, {
            to: 'in-progress',
          })
        )
      );

      const nonOk = responses.filter((r) => r.status !== 200);
      assert(
        nonOk.length === 0,
        `Expected all 200 responses, got ${nonOk.length} non-200: ` +
        JSON.stringify(nonOk.map((r) => ({ status: r.status, body: r.body })))
      );
    } finally {
      await close();
    }
  });

  // -------------------------------------------------------------------------
  // Test 2: each task ends up in the expected column after concurrent moves
  // -------------------------------------------------------------------------
  await test('each task is in the expected column after 20 concurrent moves', async () => {
    const { port, close } = await startTestServer();
    const request = makeRequest(port);

    try {
      const spacesRes = await request('GET', '/api/v1/spaces');
      const spaceId   = spacesRes.body[0].id;

      const tasks = await setup(request, spaceId);

      // Move all tasks to 'done' concurrently.
      await Promise.all(
        tasks.map((t) =>
          request('PUT', `/api/v1/spaces/${spaceId}/tasks/${t.id}/move`, { to: 'done' })
        )
      );

      // Verify the destination column contains all 20 tasks.
      const listRes = await request('GET', `/api/v1/spaces/${spaceId}/tasks?column=done`);
      assert(listRes.status === 200, 'GET tasks should return 200');

      const doneIds = new Set((listRes.body.done || []).map((t) => t.id));
      const missing = tasks.filter((t) => !doneIds.has(t.id));

      assert(
        missing.length === 0,
        `${missing.length} tasks were lost after concurrent moves: ` +
        JSON.stringify(missing.map((t) => t.id))
      );
    } finally {
      await close();
    }
  });

  // -------------------------------------------------------------------------
  // Test 3: 20 concurrent moves to different destination columns (fan-out)
  // -------------------------------------------------------------------------
  await test('concurrent moves to mixed destination columns produce no lost updates', async () => {
    const { port, close } = await startTestServer();
    const request = makeRequest(port);

    try {
      const spacesRes = await request('GET', '/api/v1/spaces');
      const spaceId   = spacesRes.body[0].id;

      const tasks = await setup(request, spaceId);

      const destinations = ['todo', 'in-progress', 'done'];

      // Assign each task a deterministic destination column based on its index.
      const expectedColumn = (idx) => destinations[idx % destinations.length];

      await Promise.all(
        tasks.map((t, idx) =>
          request('PUT', `/api/v1/spaces/${spaceId}/tasks/${t.id}/move`, {
            to: expectedColumn(idx),
          })
        )
      );

      // Check all tasks ended up in the correct column.
      const listRes = await request('GET', `/api/v1/spaces/${spaceId}/tasks`);
      assert(listRes.status === 200, 'GET tasks should return 200');

      for (let idx = 0; idx < tasks.length; idx++) {
        const taskId = tasks[idx].id;
        const dest   = expectedColumn(idx);
        const col    = listRes.body[dest] || [];
        const found  = col.some((t) => t.id === taskId);
        assert(
          found,
          `Task ${taskId} (expected in '${dest}') was not found in that column`
        );
      }
    } finally {
      await close();
    }
  });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
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
