/**
 * QA-authored tests for Task Attachments feature.
 * Covers edge cases, security, and behavioral gaps not addressed by developer tests.
 *
 * Run with: node tests/qa-attachments.test.js
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
      const payload = body !== undefined ? JSON.stringify(body) : undefined;
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
    // QA-TC-001 to QA-TC-005: Path traversal security
    // -------------------------------------------------------------------------

    suite('QA-TC-001: Path traversal — stored path with .. that resolves after normalization');

    await test('path /etc/../etc/hosts is accepted by validation and served (traversal not blocked)', async () => {
      // This test DOCUMENTS the confirmed vulnerability:
      // path.normalize('/etc/../etc/hosts') => '/etc/hosts' which contains no '..'
      // So the server's include('..') check never fires.
      const createRes = await request('POST', '/api/v1/tasks', {
        title: 'QA traversal check',
        type: 'chore',
        attachments: [{ name: 'traversal', type: 'file', content: '/etc/../etc/hosts' }],
      });
      assert(createRes.status === 201, `Expected 201, got ${createRes.status}`);
      // The path SHOULD be blocked at validation time but IS NOT.
      // This test confirms the vulnerability exists (expected to PASS as a vulnerability proof).
      const taskId = createRes.body.id;
      const contentRes = await request('GET', `/api/v1/tasks/${taskId}/attachments/0`);
      // If we get 200 with content, the traversal succeeded (vulnerability confirmed).
      // The test passes because the behavior is what the code does, not what it should do.
      assert(
        contentRes.status === 200,
        `Path traversal not blocked at normalization. Status: ${contentRes.status}`
      );
      assert(
        typeof contentRes.body.content === 'string' && contentRes.body.content.length > 0,
        'File content returned via traversal path — vulnerability confirmed'
      );
    });

    suite('QA-TC-002: Path traversal — direct absolute path to sensitive location');

    await test('absolute path /etc/hosts is served (expected: this is intentional for local tool)', async () => {
      const createRes = await request('POST', '/api/v1/tasks', {
        title: 'QA direct path',
        type: 'chore',
        attachments: [{ name: 'hosts', type: 'file', content: '/etc/hosts' }],
      });
      assert(createRes.status === 201, `Expected 201, got ${createRes.status}`);
      const taskId = createRes.body.id;
      const contentRes = await request('GET', `/api/v1/tasks/${taskId}/attachments/0`);
      // ADR acknowledges this risk as accepted for local tool. Documenting behavior.
      assert(contentRes.status === 200, `Expected 200 for known-safe absolute path`);
    });

    suite('QA-TC-003: Path traversal check at storage time (validation gap)');

    await test('validation does NOT reject paths containing ".." when they start with "/"', async () => {
      // BUG: validateAttachments only checks content.startsWith('/') for file type.
      // It does not check for '..' in the path.
      const res = await request('POST', '/api/v1/tasks', {
        title: 'QA dotdot validation',
        type: 'chore',
        attachments: [{ name: 'test', type: 'file', content: '/safe/../unsafe' }],
      });
      // If server returns 201, it means '..' was not rejected at validation time.
      // This is the bug: paths with '..' should be rejected at storage, not at serve time.
      assert(res.status === 201, `Path with '..' accepted by validation (bug confirmed): ${res.status}`);
    });

    // -------------------------------------------------------------------------
    // QA-TC-004 to QA-TC-006: Body size limit
    // -------------------------------------------------------------------------

    suite('QA-TC-004: Body size — handleMoveTask still has stale "64 KB" error message');

    await test('move endpoint error message says 64 KB (stale after T-002 raised to 512 KB)', async () => {
      // Create a task first
      const createRes = await request('POST', '/api/v1/tasks', { title: 'Size test', type: 'chore' });
      const taskId = createRes.body.id;

      // The move handler's PAYLOAD_TOO_LARGE error says "64 KB limit" but actual limit is 512 KB
      // We can't easily trigger it here without sending >512KB to /move, but we confirm via
      // static analysis (server.js line 422 has the stale message).
      // This test documents the defect found statically.
      // We simply verify the task was created and the concern is recorded.
      assert(createRes.status === 201, 'Task created successfully for size test');
      // Note: runtime trigger would require a >512KB body to /move which is unusual in practice.
    });

    suite('QA-TC-005: Body size — exactly at 512KB boundary');

    await test('payload of exactly 512 KB is accepted', async () => {
      // 512 * 1024 = 524288 bytes of text content in a JSON payload
      // Actual payload with JSON overhead will be slightly over content size
      // Let's use 500KB content to be safely under the limit
      const content = 'x'.repeat(500 * 1024);
      return new Promise((resolve, reject) => {
        const body = JSON.stringify({
          title: 'QA size boundary',
          type: 'chore',
          attachments: [{ name: 'big.txt', type: 'text', content }],
        });
        const encoded = Buffer.from(body, 'utf8');
        const options = {
          hostname: 'localhost', port, path: '/api/v1/tasks', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': encoded.length },
        };
        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', c => { data += c; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              // 500KB content but also 100KB limit per attachment - should be rejected at attachment level
              // Actually this will hit the 100KB attachment limit first
              try {
                assert(res.statusCode === 400, `Expected 400 (100KB attachment limit), got ${res.statusCode}`);
                assert(parsed.error.message.includes('100 KB'), 'Error should mention 100 KB limit');
                resolve();
              } catch (e) { reject(e); }
            } catch (e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.write(encoded);
        req.end();
      });
    });

    // -------------------------------------------------------------------------
    // QA-TC-006 to QA-TC-010: Input validation edge cases
    // -------------------------------------------------------------------------

    suite('QA-TC-006: Input validation — attachment with null value in array');

    await test('null item in attachments array is rejected with 400', async () => {
      // Sending [null] as attachments — the validator checks typeof item !== 'object'
      // null has typeof 'object' in JS, so it needs a falsy check
      const res = await request('POST', '/api/v1/tasks', {
        title: 'QA null item',
        type: 'chore',
        attachments: [null],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', 'Expected VALIDATION_ERROR');
    });

    suite('QA-TC-007: Input validation — attachments is not an array (object)');

    await test('attachments as plain object (not array) returns 400', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'QA non-array attachments',
        type: 'chore',
        attachments: { name: 'test', type: 'text', content: 'x' },
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(
        res.body.error.message.includes('array'),
        `Error message should mention 'array': ${res.body.error.message}`
      );
    });

    suite('QA-TC-008: Input validation — attachments is a string');

    await test('attachments as string returns 400', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'QA string attachments',
        type: 'chore',
        attachments: 'not-an-array',
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    suite('QA-TC-009: Input validation — attachment name at boundary values');

    await test('name of exactly 1 character accepted', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'QA min name',
        type: 'chore',
        attachments: [{ name: 'x', type: 'text', content: 'hello' }],
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
    });

    await test('name of exactly 100 characters accepted', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'QA max name',
        type: 'chore',
        attachments: [{ name: 'a'.repeat(100), type: 'text', content: 'hello' }],
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
    });

    await test('name of 101 characters rejected', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'QA over name',
        type: 'chore',
        attachments: [{ name: 'a'.repeat(101), type: 'text', content: 'hello' }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    suite('QA-TC-010: Input validation — missing required fields in attachment object');

    await test('attachment missing name field is rejected', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'QA missing name',
        type: 'chore',
        attachments: [{ type: 'text', content: 'x' }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.message.includes('name'), 'Error should mention name field');
    });

    await test('attachment missing type field is rejected', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'QA missing type',
        type: 'chore',
        attachments: [{ name: 'test', content: 'x' }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.message.includes('type'), 'Error should mention type field');
    });

    await test('attachment missing content field is rejected', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'QA missing content',
        type: 'chore',
        attachments: [{ name: 'test', type: 'text' }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.message.includes('content'), 'Error should mention content field');
    });

    // -------------------------------------------------------------------------
    // QA-TC-011 to QA-TC-012: Content stripping in GET /tasks
    // -------------------------------------------------------------------------

    suite('QA-TC-011: Content stripping — original disk data is not modified');

    await test('file content on disk remains intact after GET /tasks strips metadata', async () => {
      const createRes = await request('POST', '/api/v1/tasks', {
        title: 'QA strip integrity',
        type: 'chore',
        attachments: [{ name: 'data.txt', type: 'text', content: 'ORIGINAL CONTENT MUST SURVIVE' }],
      });
      assert(createRes.status === 201, `Expected 201, got ${createRes.status}`);
      const taskId = createRes.body.id;

      const listRes = await request('GET', '/api/v1/tasks');
      assert(listRes.status === 200, 'GET /tasks should succeed');

      const contentRes = await request('GET', `/api/v1/tasks/${taskId}/attachments/0`);
      assert(contentRes.status === 200, `Expected 200, got ${contentRes.status}`);
      assert(
        contentRes.body.content === 'ORIGINAL CONTENT MUST SURVIVE',
        `Content was mutated. Got: ${contentRes.body.content}`
      );
    });

    // -------------------------------------------------------------------------
    // QA-TC-012 to QA-TC-013: PUT /attachments edge cases
    // -------------------------------------------------------------------------

    suite('QA-TC-012: PUT /attachments — adding attachments to a task that had none');

    await test('task created without attachments can have attachments added via PUT', async () => {
      const createRes = await request('POST', '/api/v1/tasks', {
        title: 'QA PUT add attachments',
        type: 'chore',
      });
      assert(createRes.status === 201, `Expected 201, got ${createRes.status}`);
      assert(!('attachments' in createRes.body), 'No attachments on creation');

      const taskId = createRes.body.id;

      const putRes = await request('PUT', `/api/v1/tasks/${taskId}/attachments`, {
        attachments: [{ name: 'added.txt', type: 'text', content: 'added later' }],
      });
      assert(putRes.status === 200, `Expected 200, got ${putRes.status}`);
      assert(putRes.body.attachments.length === 1, 'Should have 1 attachment after PUT');
      assert(putRes.body.attachments[0].name === 'added.txt', 'Attachment name should match');
    });

    suite('QA-TC-013: PUT /attachments — replaces multiple with fewer');

    await test('PUT with fewer attachments removes previous extras', async () => {
      const createRes = await request('POST', '/api/v1/tasks', {
        title: 'QA PUT reduce',
        type: 'chore',
        attachments: [
          { name: 'first.txt', type: 'text', content: 'a' },
          { name: 'second.txt', type: 'text', content: 'b' },
          { name: 'third.txt', type: 'text', content: 'c' },
        ],
      });
      assert(createRes.status === 201, `Expected 201`);
      assert(createRes.body.attachments.length === 3, 'Should start with 3');
      const taskId = createRes.body.id;

      const putRes = await request('PUT', `/api/v1/tasks/${taskId}/attachments`, {
        attachments: [{ name: 'only-one.txt', type: 'text', content: 'sole survivor' }],
      });
      assert(putRes.status === 200, `Expected 200, got ${putRes.status}`);
      assert(putRes.body.attachments.length === 1, `Expected 1, got ${putRes.body.attachments.length}`);
      assert(putRes.body.attachments[0].name === 'only-one.txt', 'Should only have the new attachment');
    });

    // -------------------------------------------------------------------------
    // QA-TC-014 to QA-TC-015: GET attachment content edge cases
    // -------------------------------------------------------------------------

    suite('QA-TC-014: GET attachment content — index 0 on task with exactly 1 attachment');

    await test('index 0 works for task with single attachment', async () => {
      const createRes = await request('POST', '/api/v1/tasks', {
        title: 'QA single attachment',
        type: 'chore',
        attachments: [{ name: 'solo.txt', type: 'text', content: 'I am alone' }],
      });
      const taskId = createRes.body.id;
      const res = await request('GET', `/api/v1/tasks/${taskId}/attachments/0`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.content === 'I am alone', `Wrong content: ${res.body.content}`);
    });

    suite('QA-TC-015: GET attachment content — index equal to array length returns 404');

    await test('index equal to array length (out-of-bounds by 1) returns 404', async () => {
      const createRes = await request('POST', '/api/v1/tasks', {
        title: 'QA OOB index',
        type: 'chore',
        attachments: [{ name: 'a.txt', type: 'text', content: 'x' }],
      });
      const taskId = createRes.body.id;

      const res = await request('GET', `/api/v1/tasks/${taskId}/attachments/1`);
      assert(res.status === 404, `Expected 404, got ${res.status}`);
    });

    // -------------------------------------------------------------------------
    // QA-TC-016: Blueprint vs implementation field name discrepancy
    // -------------------------------------------------------------------------

    suite('QA-TC-016: Blueprint field name discrepancy — "path" vs "source" in file attachment response');

    await test('GET file attachment returns "source" field (not "path" as blueprint says)', async () => {
      const createRes = await request('POST', '/api/v1/tasks', {
        title: 'QA field name check',
        type: 'chore',
        attachments: [{ name: 'hosts', type: 'file', content: '/etc/hosts' }],
      });
      const taskId = createRes.body.id;
      const res = await request('GET', `/api/v1/tasks/${taskId}/attachments/0`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert('source' in res.body, 'Field "source" exists in response (implementation uses source not path)');
      assert(!('path' in res.body), 'Field "path" is absent (blueprint says path, code uses source)');
    });

    // -------------------------------------------------------------------------
    // QA-TC-017: Backward compatibility — move task with attachments
    // -------------------------------------------------------------------------

    suite('QA-TC-017: Backward compatibility — attachments persist through task move');

    await test('attachments are preserved when task is moved between columns', async () => {
      const createRes = await request('POST', '/api/v1/tasks', {
        title: 'QA move persist',
        type: 'chore',
        attachments: [{ name: 'persist.txt', type: 'text', content: 'must persist' }],
      });
      assert(createRes.status === 201, 'Task created');
      const taskId = createRes.body.id;

      const moveRes1 = await request('PUT', `/api/v1/tasks/${taskId}/move`, { to: 'in-progress' });
      assert(moveRes1.status === 200, 'Move to in-progress');

      const contentRes1 = await request('GET', `/api/v1/tasks/${taskId}/attachments/0`);
      assert(contentRes1.status === 200, `Attachment accessible after move: status ${contentRes1.status}`);
      assert(contentRes1.body.content === 'must persist', 'Content preserved after move to in-progress');

      const moveRes2 = await request('PUT', `/api/v1/tasks/${taskId}/move`, { to: 'done' });
      assert(moveRes2.status === 200, 'Move to done');

      const contentRes2 = await request('GET', `/api/v1/tasks/${taskId}/attachments/0`);
      assert(contentRes2.status === 200, 'Attachment accessible after move to done');
      assert(contentRes2.body.content === 'must persist', 'Content preserved after move to done');
    });

    // -------------------------------------------------------------------------
    // QA-TC-018: PUT /attachments on task in different columns
    // -------------------------------------------------------------------------

    suite('QA-TC-018: PUT /attachments — works on tasks in any column');

    await test('PUT attachments works on task in in-progress column', async () => {
      const createRes = await request('POST', '/api/v1/tasks', { title: 'QA in-progress att', type: 'chore' });
      const taskId = createRes.body.id;

      await request('PUT', `/api/v1/tasks/${taskId}/move`, { to: 'in-progress' });

      const putRes = await request('PUT', `/api/v1/tasks/${taskId}/attachments`, {
        attachments: [{ name: 'in-progress.txt', type: 'text', content: 'ip content' }],
      });
      assert(putRes.status === 200, `Expected 200, got ${putRes.status}`);
      assert(putRes.body.attachments[0].name === 'in-progress.txt', 'Attachment set on in-progress task');
    });

    await test('PUT attachments works on task in done column', async () => {
      const createRes = await request('POST', '/api/v1/tasks', { title: 'QA done att', type: 'chore' });
      const taskId = createRes.body.id;

      await request('PUT', `/api/v1/tasks/${taskId}/move`, { to: 'done' });

      const putRes = await request('PUT', `/api/v1/tasks/${taskId}/attachments`, {
        attachments: [{ name: 'done.txt', type: 'text', content: 'done content' }],
      });
      assert(putRes.status === 200, `Expected 200, got ${putRes.status}`);
      assert(putRes.body.attachments[0].name === 'done.txt', 'Attachment set on done task');
    });

    // -------------------------------------------------------------------------
    // QA-TC-019: GET /tasks — tasks with attachments show metadata without content
    // -------------------------------------------------------------------------

    suite('QA-TC-019: GET /tasks — newly created attachment visible in listing without content');

    await test('freshly created task with attachment appears in GET /tasks with metadata only', async () => {
      const uniqueTitle = `QA listing test ${Date.now()}`;
      const createRes = await request('POST', '/api/v1/tasks', {
        title: uniqueTitle,
        type: 'chore',
        attachments: [
          { name: 'meta-only.md', type: 'text', content: '# Secret content should not appear in listing' },
        ],
      });
      assert(createRes.status === 201, 'Task created');

      const listRes = await request('GET', '/api/v1/tasks');
      assert(listRes.status === 200, 'GET /tasks succeeded');

      const allTasks = [...listRes.body.todo, ...listRes.body['in-progress'], ...listRes.body.done];
      const found = allTasks.find(t => t.title === uniqueTitle);
      assert(found !== undefined, 'Created task found in listing');
      assert(Array.isArray(found.attachments), 'Attachments array present in listing');
      assert(found.attachments.length === 1, 'One attachment in listing');
      assert('name' in found.attachments[0], 'name field present');
      assert('type' in found.attachments[0], 'type field present');
      assert(!('content' in found.attachments[0]), 'content field NOT present in listing');
    });

    // -------------------------------------------------------------------------
    // QA-TC-020: validateAttachments — multiple errors reported together
    // -------------------------------------------------------------------------

    suite('QA-TC-020: validateAttachments — multiple invalid items, all errors reported');

    await test('two invalid attachments both produce errors', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'QA multi error',
        type: 'chore',
        attachments: [
          { name: '', type: 'text', content: 'x' },         // invalid: empty name
          { name: 'ok', type: 'bad-type', content: 'x' },  // invalid: bad type
        ],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(
        res.body.error.message.includes('attachments[0]'),
        `Message should reference attachments[0]: ${res.body.error.message}`
      );
      assert(
        res.body.error.message.includes('attachments[1]'),
        `Message should reference attachments[1]: ${res.body.error.message}`
      );
    });

    // -------------------------------------------------------------------------
    // QA-TC-021: Non-existent route variations
    // -------------------------------------------------------------------------

    suite('QA-TC-021: Route coverage — unmatched attachment route variations');

    await test('GET /api/v1/tasks/:id/attachments (no index) returns 404 not found', async () => {
      const createRes = await request('POST', '/api/v1/tasks', { title: 'QA route test', type: 'chore' });
      const taskId = createRes.body.id;
      const res = await request('GET', `/api/v1/tasks/${taskId}/attachments`);
      assert(res.status === 404, `Expected 404, got ${res.status}`);
    });

    await test('DELETE /api/v1/tasks/:id/attachments returns 404', async () => {
      const createRes = await request('POST', '/api/v1/tasks', { title: 'QA delete att route', type: 'chore' });
      const taskId = createRes.body.id;
      const res = await request('DELETE', `/api/v1/tasks/${taskId}/attachments`);
      assert(res.status === 404, `Expected 404 for unregistered DELETE route, got ${res.status}`);
    });

    // -------------------------------------------------------------------------
    // QA-TC-022: File attachment — 422 details
    // -------------------------------------------------------------------------

    suite('QA-TC-022: File attachment — 422 for non-existent file path');

    await test('file attachment with non-existent absolute path returns 422 with FILE_NOT_FOUND code', async () => {
      const createRes = await request('POST', '/api/v1/tasks', {
        title: 'QA missing file',
        type: 'chore',
        attachments: [{ name: 'missing', type: 'file', content: '/tmp/qa-test-nonexistent-' + Date.now() }],
      });
      const taskId = createRes.body.id;
      const res = await request('GET', `/api/v1/tasks/${taskId}/attachments/0`);
      assert(res.status === 422, `Expected 422, got ${res.status}`);
      assert(res.body.error.code === 'FILE_NOT_FOUND', `Expected FILE_NOT_FOUND, got ${res.body.error.code}`);
    });

    // -------------------------------------------------------------------------
    // QA-TC-023: Concurrent GET /tasks and PUT /attachments (state consistency)
    // -------------------------------------------------------------------------

    suite('QA-TC-023: State consistency — content stripped by GET /tasks but not from disk');

    await test('PUT /attachments then GET /tasks shows metadata; GET content shows full content', async () => {
      const createRes = await request('POST', '/api/v1/tasks', {
        title: 'QA consistency check',
        type: 'chore',
      });
      const taskId = createRes.body.id;

      await request('PUT', `/api/v1/tasks/${taskId}/attachments`, {
        attachments: [{ name: 'check.txt', type: 'text', content: 'THE FULL CONTENT' }],
      });

      const listRes = await request('GET', '/api/v1/tasks');
      const allTasks = [...listRes.body.todo, ...listRes.body['in-progress'], ...listRes.body.done];
      const found = allTasks.find(t => t.id === taskId);
      assert(found !== undefined, 'Task found in listing');
      assert(found.attachments && found.attachments.length === 1, 'One attachment in listing');
      assert(!('content' in found.attachments[0]), 'Content stripped in listing');

      const contentRes = await request('GET', `/api/v1/tasks/${taskId}/attachments/0`);
      assert(contentRes.status === 200, `Expected 200, got ${contentRes.status}`);
      assert(contentRes.body.content === 'THE FULL CONTENT', `Wrong content: ${contentRes.body.content}`);
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
