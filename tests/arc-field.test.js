'use strict';

/**
 * Integration & unit tests for the `arc` field.
 *
 * Covers:
 *   - Store: arc persistence, update/clear, migration idempotency
 *   - REST API: POST /tasks with arc, PUT /tasks arc update/clear, GET /tasks
 *   - Validation: arc too long, arc non-string, arc empty string → null
 *   - Edge cases: whitespace trimming, 60-char boundary
 *
 * Arc suggestions are derived client-side from the loaded tasks (no /arcs
 * endpoint), so there are no distinct-arc listing tests here.
 *
 * Run with:
 *   node --test tests/arc-field.test.js
 */

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const { createStore }     = require('../src/services/store');
const { startTestServer } = require('./helpers/server');

// ---------------------------------------------------------------------------
// Helpers — store fixtures
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

function makeTask(overrides = {}) {
  return {
    id:        overrides.id        ?? 'task-1',
    title:     overrides.title     ?? 'Test Task',
    type:      overrides.type      ?? 'feature',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers — HTTP
// ---------------------------------------------------------------------------

const http = require('http');

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

const get  = (port, path)       => request(port, 'GET',  path);
const post = (port, path, body) => request(port, 'POST', path, body);
const put  = (port, path, body) => request(port, 'PUT',  path, body);

// ---------------------------------------------------------------------------
// 1. Store unit tests — arc persistence
// ---------------------------------------------------------------------------

describe('Store — arc field', () => {
  let store;
  const SPACE = 'space-arc';

  beforeEach(() => {
    store = createStore(':memory:');
    store.upsertSpace(makeSpace({ id: SPACE }));
  });

  it('arc_is_persisted_on_insertTask', () => {
    store.insertTask(makeTask({ id: 't1', arc: 'QOL' }), SPACE, 'todo');
    const tasks = store.getTasksByColumn(SPACE, 'todo');
    assert.equal(tasks[0].arc, 'QOL');
  });

  it('updateTask_can_set_arc', () => {
    store.insertTask(makeTask({ id: 't1' }), SPACE, 'todo');
    store.updateTask(SPACE, 't1', { arc: 'AUTH' });
    const tasks = store.getTasksByColumn(SPACE, 'todo');
    assert.equal(tasks[0].arc, 'AUTH');
  });

  it('updateTask_can_clear_arc_with_undefined', () => {
    store.insertTask(makeTask({ id: 't1', arc: 'QOL' }), SPACE, 'todo');
    store.updateTask(SPACE, 't1', { arc: undefined });
    const tasks = store.getTasksByColumn(SPACE, 'todo');
    assert.equal(tasks[0].arc, undefined, 'arc should be absent after clearing');
  });

  it('arc_field_absent_from_task_object_when_null_in_db', () => {
    store.insertTask(makeTask({ id: 't1' }), SPACE, 'todo');
    const tasks = store.getTasksByColumn(SPACE, 'todo');
    assert.ok(!('arc' in tasks[0]), 'arc key should not be present on task when null in db');
  });

  it('migration_idempotency_creating_second_store_does_not_throw', () => {
    assert.doesNotThrow(() => {
      const store2 = createStore(':memory:');
      store2.upsertSpace(makeSpace({ id: 'sp-tmp', name: 'Tmp Space' }));
      store2.insertTask(makeTask({ id: 'tmp-task', arc: 'TEST' }), 'sp-tmp', 'todo');
      const tasks = store2.getTasksByColumn('sp-tmp', 'todo');
      assert.equal(tasks[0].arc, 'TEST');
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Route integration tests — arc REST API
// ---------------------------------------------------------------------------

describe('Routes — arc API', () => {
  let server, port, spaceCounter;

  before(async () => {
    server = await startTestServer();
    port   = server.port;
    spaceCounter = 0;
  });

  after(async () => {
    await server.close();
  });

  async function createSpace() {
    spaceCounter++;
    const name = `Arc Test Space ${spaceCounter}`;
    const res = await post(port, '/api/v1/spaces', { name });
    assert.equal(res.status, 201, `Expected 201 creating space "${name}", got ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body.id;
  }

  it('PUT_task_arc_updates_arc_value', async () => {
    const spaceId = await createSpace();
    const created = await post(port, `/api/v1/spaces/${spaceId}/tasks`, { title: 'Task', type: 'feature', arc: 'QOL' });
    const taskId  = created.body.id;
    const updated = await put(port, `/api/v1/spaces/${spaceId}/tasks/${taskId}`, { arc: 'AUTH' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.arc, 'AUTH', 'arc should be updated to AUTH');
  });

  it('PUT_task_with_empty_string_arc_clears_arc', async () => {
    const spaceId = await createSpace();
    const created = await post(port, `/api/v1/spaces/${spaceId}/tasks`, { title: 'Task', type: 'feature', arc: 'QOL' });
    const taskId  = created.body.id;
    const updated = await put(port, `/api/v1/spaces/${spaceId}/tasks/${taskId}`, { arc: '' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.arc, undefined, 'arc should be absent after clearing with ""');
  });

  it('PUT_task_without_arc_key_leaves_arc_unchanged', async () => {
    const spaceId = await createSpace();
    const created = await post(port, `/api/v1/spaces/${spaceId}/tasks`, { title: 'Task', type: 'feature', arc: 'LOOP' });
    const taskId  = created.body.id;
    const updated = await put(port, `/api/v1/spaces/${spaceId}/tasks/${taskId}`, { title: 'New Title' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.arc,   'LOOP',      'arc should be unchanged when key is omitted');
    assert.equal(updated.body.title, 'New Title');
  });

  it('POST_task_with_arc_exceeding_60_chars_returns_400', async () => {
    const spaceId = await createSpace();
    const res = await post(port, `/api/v1/spaces/${spaceId}/tasks`, { title: 'Task', type: 'feature', arc: 'A'.repeat(61) });
    assert.equal(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  it('POST_task_with_arc_exactly_60_chars_is_valid', async () => {
    const spaceId = await createSpace();
    const maxArc  = 'A'.repeat(60);
    const res = await post(port, `/api/v1/spaces/${spaceId}/tasks`, { title: 'Task', type: 'feature', arc: maxArc });
    assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.arc, maxArc);
  });

  it('POST_task_with_non_string_arc_returns_400', async () => {
    const spaceId = await createSpace();
    const res = await post(port, `/api/v1/spaces/${spaceId}/tasks`, { title: 'Task', type: 'feature', arc: 123 });
    assert.equal(res.status, 400, `Expected 400, got ${res.status}`);
  });

  it('POST_task_without_arc_omits_arc_from_response', async () => {
    const spaceId = await createSpace();
    const res = await post(port, `/api/v1/spaces/${spaceId}/tasks`, { title: 'No arc task', type: 'chore' });
    assert.equal(res.status, 201);
    assert.equal(res.body.arc, undefined, 'arc should be absent when not provided');
  });

  it('GET_tasks_list_includes_arc_field', async () => {
    const spaceId = await createSpace();
    await post(port, `/api/v1/spaces/${spaceId}/tasks`, { title: 'With arc', type: 'feature', arc: 'AUTH' });
    await post(port, `/api/v1/spaces/${spaceId}/tasks`, { title: 'No arc',   type: 'chore' });

    const res = await get(port, `/api/v1/spaces/${spaceId}/tasks`);
    assert.equal(res.status, 200);
    const tasks = res.body.todo ?? [];
    const withArc    = tasks.find((t) => t.title === 'With arc');
    const withoutArc = tasks.find((t) => t.title === 'No arc');
    assert.ok(withArc,    'task with arc should be in list');
    assert.ok(withoutArc, 'task without arc should be in list');
    assert.equal(withArc.arc,    'AUTH',    'arc should be AUTH');
    assert.equal(withoutArc.arc, undefined, 'arc should be absent on task without arc');
  });

  it('POST_task_arc_leading_trailing_whitespace_is_trimmed', async () => {
    const spaceId = await createSpace();
    const res = await post(port, `/api/v1/spaces/${spaceId}/tasks`, { title: 'Task', type: 'feature', arc: '  QOL  ' });
    assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.arc, 'QOL', 'arc should be trimmed');
  });

  it('POST_task_with_whitespace_only_arc_omits_arc', async () => {
    const spaceId = await createSpace();
    const res = await post(port, `/api/v1/spaces/${spaceId}/tasks`, { title: 'Task', type: 'chore', arc: '   ' });
    assert.ok(res.status === 201 || res.status === 400, `Expected 201 or 400, got ${res.status}`);
    if (res.status === 201) {
      assert.equal(res.body.arc, undefined, 'whitespace-only arc should not be persisted');
    }
  });
});
