'use strict';

/**
 * Integration tests for GET /api/v1/spaces/:spaceId/tasks/search.
 *
 * Focus: UUID direct lookup fix (beeb6e9) — FTS5 cannot tokenise UUIDs so
 * the handler must detect UUID-shaped queries and call store.getTask(spaceId, id)
 * directly instead of hitting the FTS index.
 *
 * Coverage:
 *   - UUID lookup returns the correct task when it belongs to the queried space
 *   - UUID lookup returns empty when the UUID belongs to a different space
 *   - UUID lookup returns empty for a UUID that does not exist at all
 *   - Normal text search (FTS5 path) still works after the UUID guard
 *   - 400 VALIDATION_ERROR when q is missing or empty
 *   - Response shape: { results: [], total: N }
 *
 * Run with: node tests/routes.perspace-search.test.js
 */

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
// Seed helpers
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
  assert(res.status === 201, `createTask: expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function getTasksInSpace(request, spaceId) {
  const res = await request('GET', `/api/v1/spaces/${spaceId}/tasks`);
  assert(res.status === 200, `getTasksInSpace: expected 200, got ${res.status}`);
  // Board shape: { todo: [], "in-progress": [], done: [] }
  return [
    ...(res.body.todo         || []),
    ...(res.body['in-progress'] || []),
    ...(res.body.done         || []),
  ];
}

// ---------------------------------------------------------------------------
// Entry point
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

  // ── Seed ─────────────────────────────────────────────────────────────────

  const spaceA = await createSpace(request, 'SpaceAlpha');
  const spaceB = await createSpace(request, 'SpaceBeta');

  // Create tasks in both spaces
  const taskA1 = await createTask(request, spaceA.id, 'Deploy to staging', 'Run the deploy pipeline');
  const taskA2 = await createTask(request, spaceA.id, 'Fix login bug',     'Users cannot log in');
  const taskB1 = await createTask(request, spaceB.id, 'Update deploy docs','Document deployment steps');

  // Verify the UUIDs were returned by the create calls
  assert(taskA1.id, 'taskA1 must have an id');
  assert(taskA2.id, 'taskA2 must have an id');
  assert(taskB1.id, 'taskB1 must have an id');

  // ── UUID direct lookup — same space ──────────────────────────────────────

  suite('Per-space search — UUID direct lookup (same space)');

  await test('should_return_task_when_uuid_belongs_to_queried_space', async () => {
    const res = await request('GET',
      `/api/v1/spaces/${spaceA.id}/tasks/search?q=${taskA1.id}`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(Array.isArray(res.body.results), 'results must be an array');
    assert(res.body.total === 1, `expected total=1, got ${res.body.total}`);
    assert(res.body.results.length === 1, 'results must have 1 item');
    assert(res.body.results[0].id === taskA1.id,
      `id mismatch: expected ${taskA1.id}, got ${res.body.results[0].id}`);
  });

  await test('should_return_correct_task_fields_for_uuid_lookup', async () => {
    const res = await request('GET',
      `/api/v1/spaces/${spaceA.id}/tasks/search?q=${taskA1.id}`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const task = res.body.results[0];
    assert(task.id    === taskA1.id,    'id must match');
    assert(task.title === 'Deploy to staging', `title mismatch: ${task.title}`);
    assert(task.type  === 'feature',    `type mismatch: ${task.type}`);
    assert(typeof task.createdAt === 'string', 'createdAt must be a string');
    assert(typeof task.updatedAt === 'string', 'updatedAt must be a string');
  });

  await test('should_find_second_task_in_same_space_by_uuid', async () => {
    const res = await request('GET',
      `/api/v1/spaces/${spaceA.id}/tasks/search?q=${taskA2.id}`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.body.total === 1, `expected total=1, got ${res.body.total}`);
    assert(res.body.results[0].id === taskA2.id, 'id must match taskA2');
  });

  // ── UUID cross-space isolation ────────────────────────────────────────────

  suite('Per-space search — UUID cross-space isolation (key regression test)');

  await test('should_return_empty_when_uuid_belongs_to_different_space', async () => {
    // taskB1 is in spaceB — querying spaceA should return empty
    const res = await request('GET',
      `/api/v1/spaces/${spaceA.id}/tasks/search?q=${taskB1.id}`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.body.total === 0,
      `expected total=0 (cross-space isolation), got ${res.body.total}`);
    assert(res.body.results.length === 0, 'results must be empty for cross-space UUID');
  });

  await test('should_return_empty_when_uuid_does_not_exist_anywhere', async () => {
    const nonexistentUuid = '00000000-0000-0000-0000-000000000000';
    const res = await request('GET',
      `/api/v1/spaces/${spaceA.id}/tasks/search?q=${nonexistentUuid}`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.body.total === 0, `expected total=0, got ${res.body.total}`);
    assert(res.body.results.length === 0, 'results must be empty');
  });

  await test('should_find_taskB1_when_querying_correct_spaceB', async () => {
    // Verify spaceB isolation works in the correct direction too
    const res = await request('GET',
      `/api/v1/spaces/${spaceB.id}/tasks/search?q=${taskB1.id}`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.body.total === 1, `expected total=1, got ${res.body.total}`);
    assert(res.body.results[0].id === taskB1.id, 'should return taskB1 in spaceB');
  });

  // ── FTS5 text search still works ─────────────────────────────────────────

  suite('Per-space search — FTS5 text path unaffected by UUID guard');

  await test('should_return_matching_tasks_for_text_query', async () => {
    const res = await request('GET',
      `/api/v1/spaces/${spaceA.id}/tasks/search?q=deploy`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.body.total >= 1, `expected at least 1 result for "deploy", got ${res.body.total}`);
    const ids = res.body.results.map((t) => t.id);
    assert(ids.includes(taskA1.id), 'should find taskA1 by FTS on title "Deploy to staging"');
  });

  await test('should_only_return_tasks_in_queried_space_for_text_search', async () => {
    // spaceA has "Deploy to staging"; spaceB has "Update deploy docs"
    // Querying spaceA with "deploy" should NOT return taskB1
    const res = await request('GET',
      `/api/v1/spaces/${spaceA.id}/tasks/search?q=deploy`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const ids = res.body.results.map((t) => t.id);
    assert(!ids.includes(taskB1.id),
      'per-space FTS should not leak results from other spaces');
  });

  await test('should_return_0_results_for_non_matching_text', async () => {
    const res = await request('GET',
      `/api/v1/spaces/${spaceA.id}/tasks/search?q=xyznonexistenttoken999`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.body.total === 0, `expected total=0, got ${res.body.total}`);
    assert(res.body.results.length === 0, 'results must be empty');
  });

  // ── 400 Validation errors ─────────────────────────────────────────────────

  suite('Per-space search — 400 validation errors');

  await test('should_return_400_when_q_is_missing', async () => {
    const res = await request('GET',
      `/api/v1/spaces/${spaceA.id}/tasks/search`);
    assert(res.status === 400, `expected 400, got ${res.status}`);
    assert(res.body.error !== undefined, 'body.error must be present');
  });

  await test('should_return_400_when_q_is_whitespace_only', async () => {
    const res = await request('GET',
      `/api/v1/spaces/${spaceA.id}/tasks/search?q=%20%20`);
    assert(res.status === 400, `expected 400, got ${res.status}`);
    assert(res.body.error !== undefined, 'body.error must be present');
  });

  await test('should_return_400_when_q_exceeds_200_chars', async () => {
    const longQ = 'a'.repeat(201);
    const res = await request('GET',
      `/api/v1/spaces/${spaceA.id}/tasks/search?q=${encodeURIComponent(longQ)}`);
    assert(res.status === 400, `expected 400, got ${res.status}`);
    assert(res.body.error !== undefined, 'body.error must be present');
  });

  // ── Response shape ────────────────────────────────────────────────────────

  suite('Per-space search — response shape');

  await test('should_return_object_with_results_array_and_numeric_total', async () => {
    const res = await request('GET',
      `/api/v1/spaces/${spaceA.id}/tasks/search?q=deploy`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(Array.isArray(res.body.results), 'body.results must be an array');
    assert(typeof res.body.total === 'number', 'body.total must be a number');
  });

  await test('should_not_include_attachment_content_in_search_results', async () => {
    // Verify stripAttachmentContent is applied (attachments stripped in list responses)
    // Create a task with a text attachment
    const taskWithAttachment = await createTask(request, spaceA.id,
      'Attachment task', 'should strip content');
    await request('PUT',
      `/api/v1/spaces/${spaceA.id}/tasks/${taskWithAttachment.id}/attachments`,
      { attachments: [{ name: 'readme.md', type: 'text', content: 'hello world' }] }
    );

    const res = await request('GET',
      `/api/v1/spaces/${spaceA.id}/tasks/search?q=${taskWithAttachment.id}`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.body.total === 1, `expected total=1, got ${res.body.total}`);

    const task = res.body.results[0];
    // attachments should be present but content stripped (only name+type)
    if (task.attachments && task.attachments.length > 0) {
      for (const att of task.attachments) {
        assert(!('content' in att),
          `attachment content must be stripped; got keys: ${Object.keys(att).join(', ')}`);
      }
    }
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
