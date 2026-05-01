'use strict';

/**
 * Integration tests for GET /api/v1/tasks/search.
 * ADR-1 (global-search): covers T-002 + T-003 acceptance criteria.
 *
 * Run with: node tests/routes.search.test.js
 * Starts its own isolated server on a random port with a temporary data directory.
 */

const http = require('http');
const { startTestServer } = require('./helpers/server');

// ---------------------------------------------------------------------------
// Minimal test runner (same pattern as comments.test.js)
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
// HTTP helper
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

// ---------------------------------------------------------------------------
// Helpers to seed test data via the API
// ---------------------------------------------------------------------------

async function createSpace(request, name) {
  const res = await request('POST', '/api/v1/spaces', { name });
  assert(res.status === 201, `createSpace: expected 201, got ${res.status}`);
  return res.body;
}

async function createTask(request, spaceId, title, description) {
  const res = await request(
    'POST',
    `/api/v1/spaces/${spaceId}/tasks`,
    { title, type: 'feature', ...(description ? { description } : {}) }
  );
  assert(res.status === 201, `createTask: expected 201, got ${res.status}`);
  return res.body;
}

// ---------------------------------------------------------------------------
// Test runner entry point
// ---------------------------------------------------------------------------

async function runTests() {
  let serverInfo;
  try {
    serverInfo = await startTestServer();
  } catch (err) {
    console.error('Failed to start test server:', err.message);
    process.exit(1);
  }

  const { port, close } = serverInfo;
  const request = makeRequest(port);

  // ── Seed data ────────────────────────────────────────────────────────────

  const spaceA = await createSpace(request, 'Alpha');
  const spaceB = await createSpace(request, 'Beta');

  await createTask(request, spaceA.id, 'Deploy to staging',   'Run the deploy pipeline');
  await createTask(request, spaceA.id, 'Fix login bug',       'Users cannot log in');
  await createTask(request, spaceB.id, 'Update deploy docs',  'Document deployment steps');
  await createTask(request, spaceB.id, 'Unrelated task',      null);

  // ── 200 Happy path ───────────────────────────────────────────────────────

  suite('GET /api/v1/tasks/search — happy path');

  await test('should_return_200_with_correct_shape', async () => {
    const res = await request('GET', '/api/v1/tasks/search?q=deploy');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(typeof res.body.query   === 'string',  'body.query must be string');
    assert(typeof res.body.count   === 'number',  'body.count must be number');
    assert(Array.isArray(res.body.results), 'body.results must be array');
  });

  await test('should_return_results_from_both_spaces', async () => {
    const res = await request('GET', '/api/v1/tasks/search?q=deploy');
    assert(res.status === 200, `expected 200, got ${res.status}`);

    const spaceIds = res.body.results.map((r) => r.spaceId);
    assert(spaceIds.includes(spaceA.id), 'should include result from spaceA');
    assert(spaceIds.includes(spaceB.id), 'should include result from spaceB');
  });

  await test('should_include_spaceName_in_each_result', async () => {
    const res = await request('GET', '/api/v1/tasks/search?q=deploy');
    assert(res.status === 200, `expected 200, got ${res.status}`);

    for (const result of res.body.results) {
      assert(typeof result.spaceName === 'string', 'result.spaceName must be string');
      assert(result.spaceName.length > 0, 'result.spaceName must not be empty');
    }
  });

  await test('should_include_column_in_each_result', async () => {
    const res = await request('GET', '/api/v1/tasks/search?q=deploy');
    assert(res.status === 200, `expected 200, got ${res.status}`);

    const validColumns = new Set(['todo', 'in-progress', 'done']);
    for (const result of res.body.results) {
      assert(validColumns.has(result.column), `result.column "${result.column}" must be valid`);
    }
  });

  await test('should_return_full_task_object_in_each_result', async () => {
    const res = await request('GET', '/api/v1/tasks/search?q=deploy');
    assert(res.status === 200, `expected 200, got ${res.status}`);

    for (const result of res.body.results) {
      assert(typeof result.task.id    === 'string', 'task.id must be string');
      assert(typeof result.task.title === 'string', 'task.title must be string');
      assert(typeof result.task.type  === 'string', 'task.type must be string');
    }
  });

  await test('should_respect_limit_parameter', async () => {
    const res = await request('GET', '/api/v1/tasks/search?q=deploy&limit=1');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.body.results.length <= 1, 'should return at most 1 result');
  });

  await test('should_return_0_results_for_non_matching_query', async () => {
    const res = await request('GET', '/api/v1/tasks/search?q=xyz123nonexistenttoken');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.body.count   === 0, 'count should be 0');
    assert(res.body.results.length === 0, 'results should be empty');
  });

  await test('should_echo_trimmed_query_in_response', async () => {
    const res = await request('GET', '/api/v1/tasks/search?q=deploy');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.body.query === 'deploy', `expected query "deploy", got "${res.body.query}"`);
  });

  // ── 400 Validation errors ─────────────────────────────────────────────────

  suite('GET /api/v1/tasks/search — 400 validation errors');

  await test('should_return_400_INVALID_QUERY_when_q_is_missing', async () => {
    const res = await request('GET', '/api/v1/tasks/search');
    assert(res.status === 400, `expected 400, got ${res.status}`);
    assert(res.body.error.code === 'INVALID_QUERY', `expected INVALID_QUERY, got ${res.body.error.code}`);
  });

  await test('should_return_400_INVALID_QUERY_when_q_is_whitespace_only', async () => {
    const res = await request('GET', '/api/v1/tasks/search?q=%20%20');
    assert(res.status === 400, `expected 400, got ${res.status}`);
    assert(res.body.error.code === 'INVALID_QUERY', `expected INVALID_QUERY, got ${res.body.error.code}`);
  });

  await test('should_return_400_INVALID_QUERY_when_q_exceeds_200_chars', async () => {
    const longQ = 'a'.repeat(201);
    const res = await request('GET', `/api/v1/tasks/search?q=${encodeURIComponent(longQ)}`);
    assert(res.status === 400, `expected 400, got ${res.status}`);
    assert(res.body.error.code === 'INVALID_QUERY', `expected INVALID_QUERY, got ${res.body.error.code}`);
  });

  await test('should_return_400_INVALID_LIMIT_when_limit_is_not_numeric', async () => {
    const res = await request('GET', '/api/v1/tasks/search?q=deploy&limit=abc');
    assert(res.status === 400, `expected 400, got ${res.status}`);
    assert(res.body.error.code === 'INVALID_LIMIT', `expected INVALID_LIMIT, got ${res.body.error.code}`);
  });

  await test('should_return_400_INVALID_LIMIT_when_limit_is_zero', async () => {
    const res = await request('GET', '/api/v1/tasks/search?q=deploy&limit=0');
    assert(res.status === 400, `expected 400, got ${res.status}`);
    assert(res.body.error.code === 'INVALID_LIMIT', `expected INVALID_LIMIT, got ${res.body.error.code}`);
  });

  await test('should_return_400_INVALID_LIMIT_when_limit_exceeds_50', async () => {
    const res = await request('GET', '/api/v1/tasks/search?q=deploy&limit=51');
    assert(res.status === 400, `expected 400, got ${res.status}`);
    assert(res.body.error.code === 'INVALID_LIMIT', `expected INVALID_LIMIT, got ${res.body.error.code}`);
  });

  // ── 405 Method not allowed ────────────────────────────────────────────────

  suite('GET /api/v1/tasks/search — 405 method not allowed');

  await test('should_return_405_for_POST_on_search_route', async () => {
    const res = await request('POST', '/api/v1/tasks/search', { q: 'deploy' });
    assert(res.status === 405, `expected 405, got ${res.status}`);
    assert(res.body.error.code === 'METHOD_NOT_ALLOWED', `expected METHOD_NOT_ALLOWED, got ${res.body.error.code}`);
  });

  await test('should_return_405_for_DELETE_on_search_route', async () => {
    const res = await request('DELETE', '/api/v1/tasks/search');
    assert(res.status === 405, `expected 405, got ${res.status}`);
  });

  // ── Regression: existing routes unaffected ────────────────────────────────

  suite('Regression — existing routes unaffected by SEARCH_ROUTE registration');

  await test('should_not_break_legacy_tasks_route', async () => {
    const res = await request('GET', '/api/v1/tasks');
    // Legacy route → default space → board response (200 or 404 if no default space)
    assert(res.status === 200 || res.status === 404,
      `expected 200 or 404 from legacy tasks route, got ${res.status}`);
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  await close();

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.error('\nFailed tests:');
    for (const { name, error } of failures) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${error}`);
    }
    process.exit(1);
  } else {
    console.log('All tests passed.');
  }
}

runTests().catch((err) => {
  console.error('Unexpected error in test runner:', err);
  process.exit(1);
});
