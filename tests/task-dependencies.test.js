'use strict';

/**
 * Tests for QOL-3 — task dependsOn / dependency feature.
 *
 * Covers:
 *  - store.setTaskDependencies: basic set, cycle detection, validation
 *  - store.getAllTasksForSpaceWithStatus: derives isBlocked / blockedByCount
 *  - store.deleteTask: cleans up reverse references
 *  - GET /tasks: returns isBlocked / blockedByCount in response
 *  - PUT /tasks/:id: accepts dependsOn, validates cycles
 *  - POST /tasks: accepts dependsOn on creation
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { createStore } = require('../src/services/store');
const { createApp }   = require('../src/handlers/tasks');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeStore() {
  return createStore(':memory:');
}

function makeTask(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id:        crypto.randomUUID(),
    title:     overrides.title || 'Test task',
    type:      overrides.type  || 'chore',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Build a minimal IncomingMessage mock */
function mockReq(method, url, body) {
  const chunks = [Buffer.from(JSON.stringify(body))];
  const req = {
    method,
    url,
    on(event, cb) {
      if (event === 'data') for (const c of chunks) cb(c);
      if (event === 'end')  cb();
      return req;
    },
  };
  return req;
}

/** Build a collector ServerResponse mock */
function mockRes() {
  const res = {
    _status:  null,
    _headers: {},
    _body:    '',
    statusCode: 200,
    setHeader(k, v) { res._headers[k] = v; },
    writeHead(status, headers = {}) {
      res._status = status;
      Object.assign(res._headers, headers);
    },
    end(body) {
      res._body = body || '';
    },
    json() {
      return JSON.parse(res._body);
    },
  };
  return res;
}

// ---------------------------------------------------------------------------
// Store-level tests
// ---------------------------------------------------------------------------

describe('Store — setTaskDependencies', () => {
  let store;
  let spaceId;
  let t1, t2, t3;

  before(() => {
    store = makeStore();
    spaceId = crypto.randomUUID();
    store.upsertSpace({ id: spaceId, name: 'Test', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    t1 = makeTask({ title: 'Task 1' });
    t2 = makeTask({ title: 'Task 2' });
    t3 = makeTask({ title: 'Task 3' });
    store.insertTask(t1, spaceId, 'todo');
    store.insertTask(t2, spaceId, 'todo');
    store.insertTask(t3, spaceId, 'done');
  });

  after(() => store.close());

  it('sets dependencies on a task', () => {
    const result = store.setTaskDependencies(spaceId, t1.id, [t2.id]);
    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    assert.equal(result.task.id, t1.id);
    assert.deepStrictEqual(result.task.dependsOn, [t2.id]);
  });

  it('clears dependencies when empty array is passed', () => {
    store.setTaskDependencies(spaceId, t1.id, [t2.id]);
    const result = store.setTaskDependencies(spaceId, t1.id, []);
    assert.ok(!result.error);
    assert.equal(result.task.dependsOn, undefined);
  });

  it('returns TASK_NOT_FOUND for non-existent task', () => {
    const result = store.setTaskDependencies(spaceId, 'nonexistent-id', [t2.id]);
    assert.equal(result.error, 'Task not found');
    assert.equal(result.code, 'TASK_NOT_FOUND');
  });

  it('returns DEPENDENCY_NOT_FOUND for non-existent dep', () => {
    const result = store.setTaskDependencies(spaceId, t1.id, ['fake-dep-id']);
    assert.equal(result.code, 'DEPENDENCY_NOT_FOUND');
  });

  it('returns CYCLE_DETECTED for direct self-loop', () => {
    const result = store.setTaskDependencies(spaceId, t1.id, [t1.id]);
    assert.equal(result.code, 'CYCLE_DETECTED');
  });

  it('returns CYCLE_DETECTED for transitive cycle', () => {
    // t1 depends on t2
    store.setTaskDependencies(spaceId, t1.id, [t2.id]);
    // t2 depends on t1 → cycle
    const result = store.setTaskDependencies(spaceId, t2.id, [t1.id]);
    assert.equal(result.code, 'CYCLE_DETECTED');
    // Clean up
    store.setTaskDependencies(spaceId, t1.id, []);
  });

  it('persists dependsOn and returns in getTask', () => {
    store.setTaskDependencies(spaceId, t1.id, [t2.id, t3.id]);
    const task = store.getTask(spaceId, t1.id);
    assert.deepStrictEqual(task.dependsOn, [t2.id, t3.id]);
    // Clean up
    store.setTaskDependencies(spaceId, t1.id, []);
  });
});

describe('Store — deriveBlockedStatus (via getAllTasksForSpaceWithStatus)', () => {
  let store;
  let spaceId;
  let todo1, todo2, doneTask;

  before(() => {
    store = makeStore();
    spaceId = crypto.randomUUID();
    store.upsertSpace({ id: spaceId, name: 'S', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    todo1    = makeTask({ title: 'todo1' });
    todo2    = makeTask({ title: 'todo2' });
    doneTask = makeTask({ title: 'done1' });

    store.insertTask(todo1,    spaceId, 'todo');
    store.insertTask(todo2,    spaceId, 'todo');
    store.insertTask(doneTask, spaceId, 'done');
  });

  after(() => store.close());

  it('returns _col field for each task', () => {
    const tasks = store.getAllTasksForSpaceWithStatus(spaceId);
    const t1Row = tasks.find(t => t.id === todo1.id);
    assert.equal(t1Row._col, 'todo');
    const doneRow = tasks.find(t => t.id === doneTask.id);
    assert.equal(doneRow._col, 'done');
  });

  it('task with no deps has no isBlocked field', () => {
    const tasks = store.getAllTasksForSpaceWithStatus(spaceId);
    const t = tasks.find(t => t.id === todo1.id);
    assert.equal(t.isBlocked, undefined);
    assert.equal(t.blockedByCount, undefined);
  });

  it('task depending on non-done task is blocked', () => {
    store.setTaskDependencies(spaceId, todo1.id, [todo2.id]);
    const tasks = store.getAllTasksForSpaceWithStatus(spaceId);
    const t = tasks.find(t => t.id === todo1.id);
    assert.equal(t.isBlocked, true);
    assert.equal(t.blockedByCount, 1);
    store.setTaskDependencies(spaceId, todo1.id, []);
  });

  it('task depending only on done tasks is NOT blocked', () => {
    store.setTaskDependencies(spaceId, todo1.id, [doneTask.id]);
    const tasks = store.getAllTasksForSpaceWithStatus(spaceId);
    const t = tasks.find(t => t.id === todo1.id);
    assert.equal(t.isBlocked, false);
    assert.equal(t.blockedByCount, 0);
    store.setTaskDependencies(spaceId, todo1.id, []);
  });
});

describe('Store — deleteTask cleans up reverse refs', () => {
  let store;
  let spaceId;
  let taskA, taskB, taskC;

  before(() => {
    store = makeStore();
    spaceId = crypto.randomUUID();
    store.upsertSpace({ id: spaceId, name: 'S', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    taskA = makeTask({ title: 'A' });
    taskB = makeTask({ title: 'B' });
    taskC = makeTask({ title: 'C' });

    store.insertTask(taskA, spaceId, 'todo');
    store.insertTask(taskB, spaceId, 'todo');
    store.insertTask(taskC, spaceId, 'todo');

    // B and C both depend on A
    store.setTaskDependencies(spaceId, taskB.id, [taskA.id]);
    store.setTaskDependencies(spaceId, taskC.id, [taskA.id]);
  });

  after(() => store.close());

  it('removes task from other tasks dependsOn when deleted', () => {
    const deleted = store.deleteTask(spaceId, taskA.id);
    assert.ok(deleted);

    const b = store.getTask(spaceId, taskB.id);
    // dependsOn should be cleared (either undefined or empty)
    assert.ok(!b.dependsOn || b.dependsOn.length === 0);

    const c = store.getTask(spaceId, taskC.id);
    assert.ok(!c.dependsOn || c.dependsOn.length === 0);
  });
});

// ---------------------------------------------------------------------------
// HTTP handler tests
// ---------------------------------------------------------------------------

describe('handleGetTasks — returns isBlocked field', () => {
  let store;
  let spaceId;
  let app;
  let t1, t2;

  before(() => {
    store = makeStore();
    spaceId = crypto.randomUUID();
    store.upsertSpace({ id: spaceId, name: 'S', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    t1 = makeTask({ title: 'T1' });
    t2 = makeTask({ title: 'T2' });
    store.insertTask(t1, spaceId, 'todo');
    store.insertTask(t2, spaceId, 'todo');

    // T1 depends on T2 (both in todo → T1 is blocked)
    store.setTaskDependencies(spaceId, t1.id, [t2.id]);

    app = createApp(spaceId, store);
  });

  after(() => store.close());

  it('GET /tasks returns isBlocked on blocked task', async () => {
    const req = mockReq('GET', '/tasks', null);
    const res = mockRes();

    await app.router(req, res, '/tasks');

    const body = res.json();
    const todo = body.todo ?? [];
    const t1Row = todo.find(t => t.id === t1.id);
    assert.ok(t1Row, 'T1 should be in response');
    assert.equal(t1Row.isBlocked, true, 'T1 should be blocked');
    assert.equal(t1Row.blockedByCount, 1);
  });

  it('GET /tasks does NOT return isBlocked for unblocked task', async () => {
    const req = mockReq('GET', '/tasks', null);
    const res = mockRes();

    await app.router(req, res, '/tasks');

    const body = res.json();
    const todo = body.todo ?? [];
    const t2Row = todo.find(t => t.id === t2.id);
    assert.ok(t2Row, 'T2 should be in response');
    assert.equal(t2Row.isBlocked, undefined);
  });
});

describe('handleUpdateTask — dependsOn field', () => {
  let store;
  let spaceId;
  let app;
  let t1, t2;

  before(() => {
    store = makeStore();
    spaceId = crypto.randomUUID();
    store.upsertSpace({ id: spaceId, name: 'S', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    t1 = makeTask({ title: 'T1' });
    t2 = makeTask({ title: 'T2' });
    store.insertTask(t1, spaceId, 'todo');
    store.insertTask(t2, spaceId, 'todo');

    app = createApp(spaceId, store);
  });

  after(() => store.close());

  it('PUT /tasks/:id with dependsOn sets dependencies', async () => {
    const req = mockReq('PUT', `/tasks/${t1.id}`, { dependsOn: [t2.id] });
    const res = mockRes();

    await app.router(req, res, `/tasks/${t1.id}`);

    assert.equal(res._status, 200);
    const body = res.json();
    assert.deepStrictEqual(body.dependsOn, [t2.id]);
  });

  it('PUT /tasks/:id with empty dependsOn clears deps', async () => {
    // First set a dep
    store.setTaskDependencies(spaceId, t1.id, [t2.id]);

    const req = mockReq('PUT', `/tasks/${t1.id}`, { dependsOn: [] });
    const res = mockRes();

    await app.router(req, res, `/tasks/${t1.id}`);

    assert.equal(res._status, 200);
    const body = res.json();
    assert.equal(body.dependsOn, undefined);
  });

  it('PUT /tasks/:id with cycle returns 409', async () => {
    store.setTaskDependencies(spaceId, t1.id, [t2.id]);

    const req = mockReq('PUT', `/tasks/${t2.id}`, { dependsOn: [t1.id] });
    const res = mockRes();

    await app.router(req, res, `/tasks/${t2.id}`);

    assert.equal(res._status, 409);
    const body = res.json();
    assert.equal(body.error.code, 'CYCLE_DETECTED');

    // Clean up
    store.setTaskDependencies(spaceId, t1.id, []);
  });

  it('PUT /tasks/:id with invalid dep returns 422', async () => {
    const req = mockReq('PUT', `/tasks/${t1.id}`, { dependsOn: ['nonexistent-id'] });
    const res = mockRes();

    await app.router(req, res, `/tasks/${t1.id}`);

    assert.equal(res._status, 422);
    const body = res.json();
    assert.equal(body.error.code, 'DEPENDENCY_NOT_FOUND');
  });

  it('PUT /tasks/:id with invalid type returns 400', async () => {
    const req = mockReq('PUT', `/tasks/${t1.id}`, { dependsOn: 'not-an-array' });
    const res = mockRes();

    await app.router(req, res, `/tasks/${t1.id}`);

    assert.equal(res._status, 400);
  });

  it('PUT /tasks/:id can update dependsOn AND title together', async () => {
    const req = mockReq('PUT', `/tasks/${t1.id}`, { dependsOn: [t2.id], title: 'Updated Title' });
    const res = mockRes();

    await app.router(req, res, `/tasks/${t1.id}`);

    assert.equal(res._status, 200);
    const body = res.json();
    assert.deepStrictEqual(body.dependsOn, [t2.id]);
    assert.equal(body.title, 'Updated Title');
    // Clean up
    store.setTaskDependencies(spaceId, t1.id, []);
  });
});

describe('handleCreateTask — dependsOn field', () => {
  let store;
  let spaceId;
  let app;
  let existingTask;

  before(() => {
    store = makeStore();
    spaceId = crypto.randomUUID();
    store.upsertSpace({ id: spaceId, name: 'S', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    existingTask = makeTask({ title: 'Existing' });
    store.insertTask(existingTask, spaceId, 'todo');

    app = createApp(spaceId, store);
  });

  after(() => store.close());

  it('POST /tasks with dependsOn creates task with deps', async () => {
    const req = mockReq('POST', '/tasks', {
      title:     'New Task',
      type:      'chore',
      dependsOn: [existingTask.id],
    });
    const res = mockRes();

    await app.router(req, res, '/tasks');

    assert.equal(res._status, 201);
    const body = res.json();
    assert.deepStrictEqual(body.dependsOn, [existingTask.id]);
  });

  it('POST /tasks with invalid dep rollbacks and returns 422', async () => {
    const before = store.getAllTasksForSpace(spaceId).length;
    const req = mockReq('POST', '/tasks', {
      title:     'Should rollback',
      type:      'chore',
      dependsOn: ['nonexistent-dep'],
    });
    const res = mockRes();

    await app.router(req, res, '/tasks');

    assert.equal(res._status, 422);
    // Task should have been rolled back
    const after = store.getAllTasksForSpace(spaceId).length;
    assert.equal(before, after, 'Task should have been deleted on rollback');
  });
});

describe('validateDependsOnField — edge cases', () => {
  let store;
  let spaceId;
  let app;
  let t1;

  before(() => {
    store = makeStore();
    spaceId = crypto.randomUUID();
    store.upsertSpace({ id: spaceId, name: 'S', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    t1 = makeTask({ title: 'T1' });
    store.insertTask(t1, spaceId, 'todo');

    app = createApp(spaceId, store);
  });

  after(() => store.close());

  it('PUT /tasks/:id with duplicate deps returns 400', async () => {
    // Need another task to use as dep
    const t2 = makeTask({ title: 'T2' });
    store.insertTask(t2, spaceId, 'todo');

    const req = mockReq('PUT', `/tasks/${t1.id}`, { dependsOn: [t2.id, t2.id] });
    const res = mockRes();

    await app.router(req, res, `/tasks/${t1.id}`);

    assert.equal(res._status, 400);
    const body = res.json();
    assert.ok(body.error.message.includes('duplicate'), body.error.message);
  });

  it('PUT /tasks/:id with non-string dep item returns 400', async () => {
    const req = mockReq('PUT', `/tasks/${t1.id}`, { dependsOn: [123, 'foo'] });
    const res = mockRes();

    await app.router(req, res, `/tasks/${t1.id}`);

    assert.equal(res._status, 400);
  });
});
