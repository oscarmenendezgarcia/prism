/**
 * Integration tests for Task Attachments feature.
 * ADR-1: Task Attachments — tests covering T-001 through T-007.
 *
 * Run with: node tests/attachments.test.js
 * Starts its own isolated server on a random port with a temporary data directory.
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
// HTTP helper — port is resolved after server starts
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

// ---------------------------------------------------------------------------
// Main test runner
// ---------------------------------------------------------------------------

async function runTests() {
  const { port, close } = await startTestServer();
  const request = makeRequest(port);

  try {
    // -------------------------------------------------------------------------
    // T-001: validateAttachments — optional field
    // -------------------------------------------------------------------------

    suite('T-001: validateAttachments — optional field');

    await test('undefined attachments: task created without attachments field', async () => {
      const res = await request('POST', '/api/v1/tasks', { title: 'No attachments', type: 'task' });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(!('attachments' in res.body), 'attachments field should be absent when not provided');
    });

    await test('empty array: treated as no attachments', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'Empty attachments',
        type: 'task',
        attachments: [],
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(!('attachments' in res.body), 'attachments field should be absent for empty array');
    });

    // -------------------------------------------------------------------------
    // T-001: validateAttachments — type validation
    // -------------------------------------------------------------------------

    suite('T-001: validateAttachments — type validation');

    await test('invalid attachment type returns 400', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'T',
        type: 'task',
        attachments: [{ name: 'f', type: 'pdf', content: 'x' }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', 'Wrong error code');
      assert(res.body.error.message.includes('type'), 'Error should mention type field');
    });

    await test('text type with valid content accepted', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'Text attachment',
        type: 'task',
        attachments: [{ name: 'notes.txt', type: 'text', content: 'Hello world' }],
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(Array.isArray(res.body.attachments), 'attachments should be present');
      assert(res.body.attachments.length === 1, 'Should have 1 attachment');
    });

    await test('file type with absolute path accepted', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'File attachment',
        type: 'task',
        attachments: [{ name: 'hosts', type: 'file', content: '/etc/hosts' }],
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
    });

    await test('file type with relative path rejected', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'T',
        type: 'task',
        attachments: [{ name: 'f', type: 'file', content: 'relative/path' }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.message.includes('absolute path'), 'Should mention absolute path');
    });

    // -------------------------------------------------------------------------
    // T-001: validateAttachments — name validation
    // -------------------------------------------------------------------------

    suite('T-001: validateAttachments — name validation');

    await test('empty name rejected', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'T',
        type: 'task',
        attachments: [{ name: '', type: 'text', content: 'x' }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    await test('whitespace-only name rejected', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'T',
        type: 'task',
        attachments: [{ name: '   ', type: 'text', content: 'x' }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    await test('name exceeding 100 chars rejected', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'T',
        type: 'task',
        attachments: [{ name: 'a'.repeat(101), type: 'text', content: 'x' }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.message.includes('100'), 'Error should mention 100 char limit');
    });

    await test('name at exactly 100 chars accepted', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'T',
        type: 'task',
        attachments: [{ name: 'a'.repeat(100), type: 'text', content: 'x' }],
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
    });

    await test('name is trimmed on save', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'T',
        type: 'task',
        attachments: [{ name: '  trimmed  ', type: 'text', content: 'x' }],
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(
        res.body.attachments[0].name === 'trimmed',
        `Name should be trimmed, got: ${res.body.attachments[0].name}`
      );
    });

    // -------------------------------------------------------------------------
    // T-001: validateAttachments — count limit
    // -------------------------------------------------------------------------

    suite('T-001: validateAttachments — count limit');

    await test('21 attachments rejected', async () => {
      const attachments = Array.from({ length: 21 }, (_, i) => ({
        name: `file${i}.txt`,
        type: 'text',
        content: 'x',
      }));
      const res = await request('POST', '/api/v1/tasks', { title: 'T', type: 'task', attachments });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.message.includes('20'), 'Error should mention 20 item limit');
    });

    await test('exactly 20 attachments accepted', async () => {
      const attachments = Array.from({ length: 20 }, (_, i) => ({
        name: `file${i}.txt`,
        type: 'text',
        content: 'x',
      }));
      const res = await request('POST', '/api/v1/tasks', { title: 'T', type: 'task', attachments });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(
        res.body.attachments.length === 20,
        `Expected 20, got ${res.body.attachments.length}`
      );
    });

    // -------------------------------------------------------------------------
    // T-003: handleCreateTask — attachment response
    // -------------------------------------------------------------------------

    suite('T-003: handleCreateTask — attachment response');

    await test('response strips content field from attachments', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'Stripped content',
        type: 'task',
        attachments: [{ name: 'secret.txt', type: 'text', content: 'TOP SECRET' }],
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(!('content' in res.body.attachments[0]), 'content must be stripped from response');
    });

    await test('response includes name and type fields', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'Fields check',
        type: 'task',
        attachments: [{ name: 'report.txt', type: 'text', content: 'some text' }],
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert('name' in res.body.attachments[0], 'name should be present');
      assert('type' in res.body.attachments[0], 'type should be present');
    });

    // -------------------------------------------------------------------------
    // T-004: handleUpdateAttachments
    // -------------------------------------------------------------------------

    suite('T-004: handleUpdateAttachments');

    const setupTask = await request('POST', '/api/v1/tasks', {
      title: 'Update Attachments Base',
      type: 'task',
      attachments: [{ name: 'original.txt', type: 'text', content: 'original' }],
    });
    const updateTaskId = setupTask.body.id;

    await test('PUT replaces attachments and returns updated task', async () => {
      const res = await request('PUT', `/api/v1/tasks/${updateTaskId}/attachments`, {
        attachments: [{ name: 'replaced.txt', type: 'text', content: 'new content' }],
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.attachments.length === 1, 'Should have exactly 1 attachment');
      assert(res.body.attachments[0].name === 'replaced.txt', 'Name should be updated');
      assert(!('content' in res.body.attachments[0]), 'content should be stripped');
    });

    await test('PUT with empty array clears attachments field', async () => {
      const res = await request('PUT', `/api/v1/tasks/${updateTaskId}/attachments`, {
        attachments: [],
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(!('attachments' in res.body), 'attachments field should be absent after clearing');
    });

    await test('PUT returns 404 for unknown task', async () => {
      const res = await request('PUT', '/api/v1/tasks/nonexistent-id/attachments', {
        attachments: [],
      });
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(res.body.error.code === 'TASK_NOT_FOUND', 'Wrong error code');
    });

    await test('PUT without attachments field returns 400', async () => {
      const res = await request('PUT', `/api/v1/tasks/${updateTaskId}/attachments`, {
        wrong: 'field',
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    await test('PUT with invalid attachment type returns 400', async () => {
      const res = await request('PUT', `/api/v1/tasks/${updateTaskId}/attachments`, {
        attachments: [{ name: 'f', type: 'bad', content: 'x' }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    await test('PUT updates updatedAt timestamp', async () => {
      const before = new Date();
      const res = await request('PUT', `/api/v1/tasks/${updateTaskId}/attachments`, {
        attachments: [{ name: 'ts.txt', type: 'text', content: 'timestamp test' }],
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const updatedAt = new Date(res.body.updatedAt);
      assert(updatedAt >= before, 'updatedAt should be updated to current time');
    });

    // -------------------------------------------------------------------------
    // T-005: handleGetAttachmentContent
    // -------------------------------------------------------------------------

    suite('T-005: handleGetAttachmentContent');

    const contentTask = await request('POST', '/api/v1/tasks', {
      title: 'Content Test Task',
      type: 'task',
      attachments: [
        { name: 'inline.txt', type: 'text', content: 'Hello from inline text' },
        { name: 'hosts', type: 'file', content: '/etc/hosts' },
        { name: 'missing.txt', type: 'file', content: '/nonexistent/path/file.txt' },
      ],
    });
    const contentTaskId = contentTask.body.id;

    await test('text attachment returns inline content', async () => {
      const res = await request('GET', `/api/v1/tasks/${contentTaskId}/attachments/0`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.name === 'inline.txt', 'Wrong name');
      assert(res.body.type === 'text', 'Wrong type');
      assert(res.body.content === 'Hello from inline text', 'Wrong content');
    });

    await test('file attachment reads from disk and includes source', async () => {
      const res = await request('GET', `/api/v1/tasks/${contentTaskId}/attachments/1`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.type === 'file', 'Wrong type');
      assert(
        typeof res.body.content === 'string' && res.body.content.length > 0,
        'Should have content'
      );
      assert(res.body.source === '/etc/hosts', 'Should include source path');
    });

    await test('file attachment returns 422 when file does not exist', async () => {
      const res = await request('GET', `/api/v1/tasks/${contentTaskId}/attachments/2`);
      assert(res.status === 422, `Expected 422, got ${res.status}`);
      assert(res.body.error.code === 'FILE_NOT_FOUND', `Wrong code: ${res.body.error.code}`);
    });

    await test('index out of range returns 404', async () => {
      const res = await request('GET', `/api/v1/tasks/${contentTaskId}/attachments/99`);
      assert(res.status === 404, `Expected 404, got ${res.status}`);
    });

    await test('unknown task returns 404', async () => {
      const res = await request('GET', '/api/v1/tasks/nonexistent/attachments/0');
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(res.body.error.code === 'TASK_NOT_FOUND', 'Wrong error code');
    });

    // -------------------------------------------------------------------------
    // T-006: handleGetTasks — strips content from all attachments
    // -------------------------------------------------------------------------

    suite('T-006: handleGetTasks — strips content from all attachments');

    await test('GET /tasks never includes content in attachments', async () => {
      const res = await request('GET', '/api/v1/tasks');
      assert(res.status === 200, `Expected 200, got ${res.status}`);

      const allTasks = [
        ...res.body.todo,
        ...res.body['in-progress'],
        ...res.body.done,
      ];

      for (const task of allTasks) {
        if (task.attachments) {
          for (const att of task.attachments) {
            assert(!('content' in att), `Task ${task.id} has content in attachment '${att.name}'`);
          }
        }
      }
    });

    await test('GET /tasks omits attachments field when task has none', async () => {
      const res = await request('GET', '/api/v1/tasks');
      const noAttTask = [
        ...res.body.todo,
        ...res.body['in-progress'],
        ...res.body.done,
      ].find(t => !t.attachments);
      assert(noAttTask !== undefined, 'Expected at least one task without attachments');
      assert(!('attachments' in noAttTask), 'attachments field should be absent');
    });

    // -------------------------------------------------------------------------
    // T-007: Route registration
    // -------------------------------------------------------------------------

    suite('T-007: Route registration');

    await test('PUT /api/v1/tasks/:id/attachments is routed correctly', async () => {
      const task = await request('POST', '/api/v1/tasks', { title: 'Route test', type: 'task' });
      const res = await request('PUT', `/api/v1/tasks/${task.body.id}/attachments`, {
        attachments: [{ name: 'r.txt', type: 'text', content: 'routed' }],
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
    });

    await test('GET /api/v1/tasks/:id/attachments/:index is routed correctly', async () => {
      const task = await request('POST', '/api/v1/tasks', {
        title: 'Route test 2',
        type: 'task',
        attachments: [{ name: 'r.txt', type: 'text', content: 'routed content' }],
      });
      const res = await request('GET', `/api/v1/tasks/${task.body.id}/attachments/0`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.content === 'routed content', 'Content should match');
    });

    await test('move route not shadowed by attachments route', async () => {
      const task = await request('POST', '/api/v1/tasks', { title: 'Move test', type: 'task' });
      const res = await request('PUT', `/api/v1/tasks/${task.body.id}/move`, { to: 'done' });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.task.id === task.body.id, 'Should return the moved task');
    });

    // -------------------------------------------------------------------------
    // Backward compatibility
    // -------------------------------------------------------------------------

    suite('Backward compatibility');

    await test('tasks without attachments are unaffected by feature', async () => {
      const created = await request('POST', '/api/v1/tasks', {
        title: 'Legacy task',
        type: 'research',
        description: 'No attachments here',
        assigned: 'qa-engineer-e2e',
      });
      assert(created.status === 201, `Expected 201, got ${created.status}`);
      assert(!('attachments' in created.body), 'No attachments field expected');

      const moved = await request('PUT', `/api/v1/tasks/${created.body.id}/move`, { to: 'in-progress' });
      assert(moved.status === 200, `Expected 200, got ${moved.status}`);

      const deleted = await request('DELETE', `/api/v1/tasks/${created.body.id}`);
      assert(deleted.status === 200, `Expected 200, got ${deleted.status}`);
      assert(deleted.body.deleted === true, 'Expected { deleted: true }');
    });

    await test('GET /tasks returns all three columns for tasks without attachments', async () => {
      const res = await request('GET', '/api/v1/tasks');
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(Array.isArray(res.body.todo), 'todo column should be an array');
      assert(Array.isArray(res.body['in-progress']), 'in-progress column should be an array');
      assert(Array.isArray(res.body.done), 'done column should be an array');
    });

  } finally {
    await close();
  }

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
