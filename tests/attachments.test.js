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
      const res = await request('POST', '/api/v1/tasks', { title: 'No attachments', type: 'chore' });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(!('attachments' in res.body), 'attachments field should be absent when not provided');
    });

    await test('empty array: treated as no attachments', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'Empty attachments',
        type: 'chore',
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
        type: 'chore',
        attachments: [{ name: 'f', type: 'pdf', content: 'x' }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', 'Wrong error code');
      assert(res.body.error.message.includes('type'), 'Error should mention type field');
    });

    await test('text type with valid content accepted', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'Text attachment',
        type: 'chore',
        attachments: [{ name: 'notes.txt', type: 'text', content: 'Hello world' }],
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(Array.isArray(res.body.attachments), 'attachments should be present');
      assert(res.body.attachments.length === 1, 'Should have 1 attachment');
    });

    await test('file type with absolute path accepted', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'File attachment',
        type: 'chore',
        attachments: [{ name: 'hosts', type: 'file', content: '/etc/hosts' }],
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
    });

    await test('file type with relative path rejected', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'T',
        type: 'chore',
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
        type: 'chore',
        attachments: [{ name: '', type: 'text', content: 'x' }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    await test('whitespace-only name rejected', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'T',
        type: 'chore',
        attachments: [{ name: '   ', type: 'text', content: 'x' }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    await test('name exceeding 100 chars rejected', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'T',
        type: 'chore',
        attachments: [{ name: 'a'.repeat(101), type: 'text', content: 'x' }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.message.includes('100'), 'Error should mention 100 char limit');
    });

    await test('name at exactly 100 chars accepted', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'T',
        type: 'chore',
        attachments: [{ name: 'a'.repeat(100), type: 'text', content: 'x' }],
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
    });

    await test('name is trimmed on save', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'T',
        type: 'chore',
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
      const res = await request('POST', '/api/v1/tasks', { title: 'T', type: 'chore', attachments });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.message.includes('20'), 'Error should mention 20 item limit');
    });

    await test('exactly 20 attachments accepted', async () => {
      const attachments = Array.from({ length: 20 }, (_, i) => ({
        name: `file${i}.txt`,
        type: 'text',
        content: 'x',
      }));
      const res = await request('POST', '/api/v1/tasks', { title: 'T', type: 'chore', attachments });
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
        type: 'chore',
        attachments: [{ name: 'secret.txt', type: 'text', content: 'TOP SECRET' }],
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(!('content' in res.body.attachments[0]), 'content must be stripped from response');
    });

    await test('response includes name and type fields', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'Fields check',
        type: 'chore',
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
      type: 'chore',
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
    // T-004-merge: merge semantics (new tests per ADR-1 / tasks.json T-004)
    // -------------------------------------------------------------------------

    suite('T-004-merge: merge-by-name semantics');

    // AC1: merge default appends a new attachment to a task that already has two.
    const mergeBase = await request('POST', '/api/v1/tasks', {
      title: 'Merge base task',
      type: 'chore',
      attachments: [
        { name: 'ADR-1.md',     type: 'text', content: 'adr content' },
        { name: 'blueprint.md', type: 'text', content: 'blueprint content' },
      ],
    });
    const mergeTaskId = mergeBase.body.id;

    await test('AC1: default merge appends new attachment — result has 3 items', async () => {
      const res = await request('PATCH', `/api/v1/tasks/${mergeTaskId}/attachments`, {
        attachments: [{ name: 'wireframes.md', type: 'text', content: 'wf content' }],
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.attachments.length === 3, `Expected 3, got ${res.body.attachments.length}`);
      const names = res.body.attachments.map((a) => a.name);
      assert(names.includes('ADR-1.md'),     'ADR-1.md should be preserved');
      assert(names.includes('blueprint.md'), 'blueprint.md should be preserved');
      assert(names.includes('wireframes.md'),'wireframes.md should be appended');
      // Verify persisted state
      const get = await request('GET', `/api/v1/tasks/${mergeTaskId}/attachments/0`);
      assert(get.status === 200, `GET 0 expected 200, got ${get.status}`);
      assert(get.body.name === 'ADR-1.md', `Expected ADR-1.md at index 0, got ${get.body.name}`);
    });

    // AC2: merge upserts by name, preserving order and not duplicating.
    await test('AC2: merge upserts existing name in place — array length unchanged', async () => {
      const before = await request('GET', `/api/v1/tasks/${mergeTaskId}/attachments/1`);
      assert(before.body.content === 'blueprint content', 'Pre-condition check');

      const res = await request('PATCH', `/api/v1/tasks/${mergeTaskId}/attachments`, {
        attachments: [{ name: 'blueprint.md', type: 'text', content: 'UPDATED blueprint' }],
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.attachments.length === 3, `Length should still be 3, got ${res.body.attachments.length}`);

      // Verify upserted content via GET
      const idx = res.body.attachments.findIndex((a) => a.name === 'blueprint.md');
      assert(idx === 1, `blueprint.md should remain at index 1, found at ${idx}`);
      const content = await request('GET', `/api/v1/tasks/${mergeTaskId}/attachments/${idx}`);
      assert(content.body.content === 'UPDATED blueprint', `Expected updated content, got: ${content.body.content}`);
    });

    // AC3: PATCH with empty attachments array is a no-op (200, task unchanged).
    await test('AC3: PATCH with attachments:[] is a no-op — task unchanged', async () => {
      const before = await request('GET', `/api/v1/tasks/${mergeTaskId}/attachments/0`);
      const beforeCount = 3; // from previous tests

      const res = await request('PATCH', `/api/v1/tasks/${mergeTaskId}/attachments`, {
        attachments: [],
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.attachments.length === beforeCount,
        `Should have ${beforeCount} attachments after no-op, got ${res.body.attachments.length}`);
      assert(res.body.attachments[0].name === before.body.name,
        'First attachment name should be unchanged');
    });

    // AC4 (PUT + [] clears all) — already covered in T-004 replace tests.
    // Additional check: PUT with non-empty array replaces entirely.
    await test('AC4b: PUT overwrites all existing attachments', async () => {
      const res = await request('PUT', `/api/v1/tasks/${mergeTaskId}/attachments`, {
        attachments: [{ name: 'only.md', type: 'text', content: 'only content' }],
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.attachments.length === 1, `Expected 1, got ${res.body.attachments.length}`);
      assert(res.body.attachments[0].name === 'only.md', 'Should contain only.md');
    });

    // AC5: post-merge cap returns 413 ATTACHMENT_LIMIT_EXCEEDED.
    await test('AC5: post-merge exceeding ATTACHMENT_MAX_COUNT returns 413', async () => {
      // Create task with 19 attachments.
      const capBase = await request('POST', '/api/v1/tasks', {
        title: 'Cap test task',
        type: 'chore',
        attachments: Array.from({ length: 19 }, (_, i) => ({
          name: `existing${i}.txt`, type: 'text', content: `c${i}`,
        })),
      });
      assert(capBase.status === 201, `Expected 201, got ${capBase.status}`);
      const capTaskId = capBase.body.id;

      // PATCH 3 more (2 new + 1 upsert of existing0) → merged = 21, exceeds 20.
      const res = await request('PATCH', `/api/v1/tasks/${capTaskId}/attachments`, {
        attachments: [
          { name: 'existing0.txt', type: 'text', content: 'updated existing0' },
          { name: 'new1.txt',      type: 'text', content: 'new1' },
          { name: 'new2.txt',      type: 'text', content: 'new2' },
        ],
        // PATCH = merge, merged = 21 (19 existing, 2 new, 1 upsert)
      });
      assert(res.status === 413, `Expected 413, got ${res.status}`);
      assert(
        res.body.error.code === 'ATTACHMENT_LIMIT_EXCEEDED',
        `Expected ATTACHMENT_LIMIT_EXCEEDED, got ${res.body.error.code}`
      );
      // Verify task was NOT modified (GET still returns 19 items).
      const check = await request('GET', `/api/v1/tasks/${capTaskId}`);
      // GET /tasks/:id returns all columns, check per the direct handler
      const checkList = await request('GET', `/api/v1/tasks`);
      const allTasks = [
        ...checkList.body.todo,
        ...checkList.body['in-progress'],
        ...checkList.body.done,
      ];
      const unchanged = allTasks.find((t) => t.id === capTaskId);
      assert(unchanged !== undefined, 'Cap test task should still exist');
      assert(unchanged.attachments.length === 19, `Expected 19 items unchanged, got ${unchanged.attachments.length}`);
    });

    // AC6: duplicate names within a single incoming payload — last-write-wins.
    await test('AC6: duplicate names in incoming payload follow last-write-wins', async () => {
      const dupTask = await request('POST', '/api/v1/tasks', {
        title: 'Dup names task',
        type: 'chore',
      });
      const dupId = dupTask.body.id;

      const res = await request('PATCH', `/api/v1/tasks/${dupId}/attachments`, {
        attachments: [
          { name: 'dup.txt', type: 'text', content: 'first' },
          { name: 'other.txt', type: 'text', content: 'other' },
          { name: 'dup.txt', type: 'text', content: 'last' },
        ],
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.attachments.length === 2, `Expected 2 (deduped), got ${res.body.attachments.length}`);
      const dupIdx = res.body.attachments.findIndex((a) => a.name === 'dup.txt');
      assert(dupIdx !== -1, 'dup.txt should be present');
      const content = await request('GET', `/api/v1/tasks/${dupId}/attachments/${dupIdx}`);
      assert(content.body.content === 'last', `Last-write-wins: expected 'last', got '${content.body.content}'`);
    });

    // AC7: PUT ignores any mode field (always replace); PATCH always merges.
    await test('AC7: PUT with extra mode field still replaces (mode is ignored)', async () => {
      const task = await request('POST', '/api/v1/tasks', {
        title: 'Mode test PUT',
        type: 'chore',
        attachments: [{ name: 'old.txt', type: 'text', content: 'old' }],
      });
      const id = task.body.id;
      // PUT with any mode field — should replace, not error
      const res = await request('PUT', `/api/v1/tasks/${id}/attachments`, {
        attachments: [{ name: 'new.txt', type: 'text', content: 'new' }],
        mode: 'merge', // ignored by PUT
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.attachments.length === 1, 'PUT replaces regardless of mode param');
      assert(res.body.attachments[0].name === 'new.txt', 'Only new attachment should remain');
    });

    await test('AC7b: PATCH without attachments field returns 400 VALIDATION_ERROR', async () => {
      const task = await request('POST', '/api/v1/tasks', { title: 'PATCH validation', type: 'chore' });
      const res = await request('PATCH', `/api/v1/tasks/${task.body.id}/attachments`, {
        wrong: 'field',
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', `Expected VALIDATION_ERROR, got ${res.body.error.code}`);
    });

    // -------------------------------------------------------------------------
    // T-005: End-to-end pipeline-handoff regression test
    // -------------------------------------------------------------------------

    suite('T-005: end-to-end pipeline handoff — all stages\' artifacts preserved');

    await test('simulated 5-stage handoff: all artifacts survive on the card', async () => {
      const pipelineTask = await request('POST', '/api/v1/tasks', {
        title: 'Pipeline regression task',
        type: 'feature',
      });
      assert(pipelineTask.status === 201, `Expected 201, got ${pipelineTask.status}`);
      const pid = pipelineTask.body.id;

      // Stage 1: senior-architect
      const s1 = await request('PATCH', `/api/v1/tasks/${pid}/attachments`, {
        attachments: [
          { name: 'ADR-1.md',     type: 'text', content: 'adr content' },
          { name: 'blueprint.md', type: 'text', content: 'blueprint content' },
          { name: 'tasks.json',   type: 'text', content: '{}' },
        ],
      });
      assert(s1.status === 200, `Stage 1 expected 200, got ${s1.status}`);

      // Stage 2: ux-api-designer
      const s2 = await request('PATCH', `/api/v1/tasks/${pid}/attachments`, {
        attachments: [
          { name: 'wireframes.md',   type: 'text', content: 'wireframes content' },
          { name: 'api-spec.json',   type: 'text', content: '{}' },
          { name: 'user-stories.md', type: 'text', content: 'user stories' },
        ],
      });
      assert(s2.status === 200, `Stage 2 expected 200, got ${s2.status}`);

      // Stage 3: developer-agent
      const s3 = await request('PATCH', `/api/v1/tasks/${pid}/attachments`, {
        attachments: [
          { name: 'changelog', type: 'text', content: 'changelog text' },
        ],
      });
      assert(s3.status === 200, `Stage 3 expected 200, got ${s3.status}`);

      // Stage 3.5: code-reviewer
      const s4 = await request('PATCH', `/api/v1/tasks/${pid}/attachments`, {
        attachments: [
          { name: 'review-report.md', type: 'text', content: 'review content' },
        ],
      });
      assert(s4.status === 200, `Stage 4 expected 200, got ${s4.status}`);

      // Stage 4: qa-engineer-e2e
      const s5 = await request('PATCH', `/api/v1/tasks/${pid}/attachments`, {
        attachments: [
          { name: 'test-plan.md',     type: 'text', content: 'test plan' },
          { name: 'test-results.json',type: 'text', content: '{}' },
          { name: 'bugs.md',          type: 'text', content: 'no bugs' },
        ],
      });
      assert(s5.status === 200, `Stage 5 expected 200, got ${s5.status}`);

      // GET task and verify all 10 artifacts are present.
      const all = await request('GET', '/api/v1/tasks');
      const allTasks = [
        ...all.body.todo,
        ...all.body['in-progress'],
        ...all.body.done,
      ];
      const final = allTasks.find((t) => t.id === pid);
      assert(final !== undefined, 'Pipeline task should exist in board');
      assert(final.attachments !== undefined, 'Pipeline task should have attachments');

      const expected = [
        'ADR-1.md', 'blueprint.md', 'tasks.json',
        'wireframes.md', 'api-spec.json', 'user-stories.md',
        'changelog', 'review-report.md',
        'test-plan.md', 'test-results.json', 'bugs.md',
      ];
      const actualNames = final.attachments.map((a) => a.name);
      for (const name of expected) {
        assert(actualNames.includes(name), `Missing artifact: ${name}. Found: ${actualNames.join(', ')}`);
      }
      assert(
        final.attachments.length >= expected.length,
        `Expected at least ${expected.length} attachments, got ${final.attachments.length}`
      );
    });

    // -------------------------------------------------------------------------
    // T-005: handleGetAttachmentContent
    // -------------------------------------------------------------------------

    suite('T-005: handleGetAttachmentContent');

    const contentTask = await request('POST', '/api/v1/tasks', {
      title: 'Content Test Task',
      type: 'chore',
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

    await test('GET /tasks strips content from text/file attachments; preserves content for link', async () => {
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
            if (att.type === 'link') {
              // Link attachments MUST preserve content so the frontend can extract hostname
              assert('content' in att, `Task ${task.id}: link attachment '${att.name}' is missing content`);
              assert(typeof att.content === 'string', `Task ${task.id}: link attachment '${att.name}' content is not a string`);
            } else {
              assert(!('content' in att), `Task ${task.id}: ${att.type} attachment '${att.name}' should have content stripped`);
            }
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
      const task = await request('POST', '/api/v1/tasks', { title: 'Route test', type: 'chore' });
      const res = await request('PUT', `/api/v1/tasks/${task.body.id}/attachments`, {
        attachments: [{ name: 'r.txt', type: 'text', content: 'routed' }],
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
    });

    await test('GET /api/v1/tasks/:id/attachments/:index is routed correctly', async () => {
      const task = await request('POST', '/api/v1/tasks', {
        title: 'Route test 2',
        type: 'chore',
        attachments: [{ name: 'r.txt', type: 'text', content: 'routed content' }],
      });
      const res = await request('GET', `/api/v1/tasks/${task.body.id}/attachments/0`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.content === 'routed content', 'Content should match');
    });

    await test('move route not shadowed by attachments route', async () => {
      const task = await request('POST', '/api/v1/tasks', { title: 'Move test', type: 'chore' });
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
        type: 'chore',
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

    // -------------------------------------------------------------------------
    // T-002: Link attachment — positive create+read
    // -------------------------------------------------------------------------

    suite('T-002: link attachment — create and read roundtrip');

    const linkTaskRes = await request('POST', '/api/v1/tasks', {
      title: 'Link attachment task',
      type: 'feature',
      attachments: [{ name: 'PR #82', type: 'link', content: 'https://github.com/owner/repo/pull/82' }],
    });
    const linkTaskId = linkTaskRes.body.id;

    await test('POST with link attachment returns 201', async () => {
      assert(linkTaskRes.status === 201, `Expected 201, got ${linkTaskRes.status}`);
      assert(Array.isArray(linkTaskRes.body.attachments), 'attachments should be present');
      assert(linkTaskRes.body.attachments.length === 1, 'Should have 1 attachment');
    });

    await test('link attachment in list response preserves content (URL)', async () => {
      const att = linkTaskRes.body.attachments[0];
      assert(att.type === 'link', `Expected type 'link', got '${att.type}'`);
      assert(att.name === 'PR #82', `Expected name 'PR #82', got '${att.name}'`);
      assert(att.content === 'https://github.com/owner/repo/pull/82',
        `Expected URL content, got '${att.content}'`);
    });

    await test('GET /tasks/:id/attachments/:index returns link type with content', async () => {
      const res = await request('GET', `/api/v1/tasks/${linkTaskId}/attachments/0`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.type === 'link', `Expected 'link', got '${res.body.type}'`);
      assert(res.body.content === 'https://github.com/owner/repo/pull/82', 'Content should be the URL');
      assert(!('source' in res.body), 'source field should not be present for link attachments');
    });

    await test('link attachment content (URL) is preserved in GET /tasks list', async () => {
      const res = await request('GET', '/api/v1/tasks');
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const allTasks = [...res.body.todo, ...res.body['in-progress'], ...res.body.done];
      const found = allTasks.find((t) => t.id === linkTaskId);
      assert(found !== undefined, 'Link task should appear in board');
      const linkAtt = (found.attachments ?? []).find((a) => a.type === 'link');
      assert(linkAtt !== undefined, 'Link attachment should be in the response');
      assert(linkAtt.content === 'https://github.com/owner/repo/pull/82',
        `Expected URL, got '${linkAtt.content}'`);
    });

    // -------------------------------------------------------------------------
    // T-002: Link attachment — negative validation cases
    // -------------------------------------------------------------------------

    suite('T-002: link attachment — validation rejections');

    await test('link with ftp:// scheme returns 400', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'T',
        type: 'chore',
        attachments: [{ name: 'ftp link', type: 'link', content: 'ftp://files.example.com/thing' }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', 'Expected VALIDATION_ERROR');
      assert(res.body.error.message.includes('ftp:'), `Error should mention scheme, got: ${res.body.error.message}`);
    });

    await test('link with custom scheme returns 400', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'T',
        type: 'chore',
        attachments: [{ name: 'slack link', type: 'link', content: 'slack://channel/general' }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', 'Expected VALIDATION_ERROR');
    });

    await test('link with malformed URL returns 400', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'T',
        type: 'chore',
        attachments: [{ name: 'bad url', type: 'link', content: 'not a url at all' }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', 'Expected VALIDATION_ERROR');
    });

    await test('link content exceeding 2048 chars returns 400', async () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2040);
      const res = await request('POST', '/api/v1/tasks', {
        title: 'T',
        type: 'chore',
        attachments: [{ name: 'long url', type: 'link', content: longUrl }],
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', 'Expected VALIDATION_ERROR');
      assert(res.body.error.message.includes('2048'), `Error should mention 2048, got: ${res.body.error.message}`);
    });

    await test('link with http:// scheme is accepted', async () => {
      const res = await request('POST', '/api/v1/tasks', {
        title: 'HTTP link task',
        type: 'chore',
        attachments: [{ name: 'http link', type: 'link', content: 'http://internal.company.com/ci/build/42' }],
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
    });

    // -------------------------------------------------------------------------
    // T-002: Link attachment — merge-by-name
    // -------------------------------------------------------------------------

    suite('T-002: link attachment — merge-by-name semantics');

    await test('merge-by-name upserts an existing link attachment (same name)', async () => {
      const base = await request('POST', '/api/v1/tasks', {
        title: 'Link merge task',
        type: 'feature',
        attachments: [{ name: 'PR #82', type: 'link', content: 'https://github.com/owner/repo/pull/82' }],
      });
      assert(base.status === 201, `Expected 201, got ${base.status}`);
      const tid = base.body.id;

      // Update: upsert same name with new URL
      const updated = await request('PUT', `/api/v1/tasks/${tid}/attachments`, {
        attachments: [{ name: 'PR #82', type: 'link', content: 'https://github.com/owner/repo/pull/99' }],
      });
      assert(updated.status === 200, `Expected 200, got ${updated.status}`);
      assert(updated.body.attachments.length === 1, 'Should still have 1 attachment (upserted)');
      // Verify upserted URL via single-attachment endpoint
      const get = await request('GET', `/api/v1/tasks/${tid}/attachments/0`);
      assert(get.body.content === 'https://github.com/owner/repo/pull/99',
        `Expected updated URL, got '${get.body.content}'`);
    });

    await test('merge appends a new link when name is different', async () => {
      const base = await request('POST', '/api/v1/tasks', {
        title: 'Link merge append task',
        type: 'feature',
        attachments: [{ name: 'PR #82', type: 'link', content: 'https://github.com/owner/repo/pull/82' }],
      });
      const tid = base.body.id;

      const updated = await request('PUT', `/api/v1/tasks/${tid}/attachments`, {
        attachments: [{ name: 'CI Build', type: 'link', content: 'https://circleci.com/build/42' }],
      });
      assert(updated.status === 200, `Expected 200, got ${updated.status}`);
      assert(updated.body.attachments.length === 2, `Expected 2, got ${updated.body.attachments.length}`);
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
