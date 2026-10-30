'use strict';

/**
 * Issues: keys, statuses, epics and sub-tasks, per-field history, comments in their own
 * table, and the upgrade from tasks with arcs.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Database = require('better-sqlite3');

const { createStore } = require('../src/services/store');
const { startTestServer } = require('./helpers/server');

describe('issues over HTTP', () => {
  let server, port, space;

  const call = (method, url, body, headers = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      port, method, path: `/api/v1${url}`,
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, json: raw ? JSON.parse(raw) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
  const issue = async (fields) => {
    const { status, json } = await call('POST', `/spaces/${space.id}/tasks`, { title: 'An issue', type: 'feature', ...fields });
    assert.equal(status, 201, JSON.stringify(json));
    return json;
  };

  before(async () => {
    server = await startTestServer();
    port = server.port;
    space = (await call('POST', '/spaces', { name: 'Web app', key: 'WEB' })).json;
  });

  after(async () => {
    await server.close();
  });

  describe('keys', () => {
    it('numbers issues per space and finds them by key', async () => {
      const first = await issue();
      const second = await issue();
      assert.equal(first.key, 'WEB-1');
      assert.equal(second.key, 'WEB-2');

      const byKey = await call('GET', `/spaces/${space.id}/tasks/web-2`);
      assert.equal(byKey.status, 200, 'keys in any case work in space routes');
      const global = await call('GET', '/issues/WEB-1');
      assert.equal(global.json.id, first.id);
      assert.equal(global.json.spaceId, space.id);
      assert.equal((await call('GET', '/tasks/search?q=WEB-2')).json.results[0].task.id, second.id);
    });

    it('never reuses a number, even after clearing the board', async () => {
      const other = (await call('POST', '/spaces', { name: 'Numbers' })).json;
      const create = () => call('POST', `/spaces/${other.id}/tasks`, { title: 'x', type: 'bug' });
      const made = (await create()).json;
      await call('DELETE', `/spaces/${other.id}/tasks/${made.id}`);
      assert.equal((await create()).json.number, 2);
      await call('DELETE', `/spaces/${other.id}/tasks`);
      assert.equal((await create()).json.number, 3);
    });

    it('keeps old keys working after a change, and nobody else can take them', async () => {
      const other = (await call('POST', '/spaces', { name: 'Rekey', key: 'OLD' })).json;
      const made = (await call('POST', `/spaces/${other.id}/tasks`, { title: 'x', type: 'bug' })).json;
      assert.equal(made.key, 'OLD-1');

      const changed = await call('PUT', `/spaces/${other.id}`, { key: 'NEW' });
      assert.equal(changed.status, 200);
      assert.equal(changed.json.key, 'NEW');
      assert.equal((await call('GET', '/issues/NEW-1')).json.id, made.id);
      assert.equal((await call('GET', '/issues/OLD-1')).json.id, made.id);

      const taken = await call('POST', '/spaces', { name: 'Thief', key: 'OLD' });
      assert.equal(taken.status, 409);
      assert.equal(taken.json.error.code, 'DUPLICATE_KEY');
      assert.equal((await call('PUT', `/spaces/${space.id}`, { key: 'OLD' })).status, 409);
      assert.equal((await call('PUT', `/spaces/${other.id}`, { key: 'OLD' })).status, 200, 'its own old key');
    });

    it('does not free the key of a deleted space, nor burn the one it did not use', async () => {
      const gone = (await call('POST', '/spaces', { name: 'Gone', key: 'ZED' })).json;
      await call('POST', `/spaces/${gone.id}/tasks`, { title: 'old', type: 'bug' });
      await call('DELETE', `/spaces/${gone.id}`);
      assert.equal((await call('POST', '/spaces', { name: 'Thief 2', key: 'ZED' })).status, 409);
      assert.equal((await call('GET', '/issues/ZED-1')).status, 404);

      await call('POST', '/spaces', { name: 'Sugar', key: 'ABC' });
      assert.equal((await call('POST', '/spaces', { name: 'Other', key: 'SUG' })).status, 201);
    });

    it('takes keys for parents and dependencies, and on the legacy routes', async () => {
      const epic = await issue({ type: 'epic' });
      const dep = await issue();
      const made = await issue({ parentId: epic.key, dependsOn: [dep.key] });
      assert.equal(made.parentId, epic.id);
      assert.deepEqual(made.dependsOn, [dep.id]);

      const { json: general } = await call('GET', '/spaces');
      const own = general.find((s) => s.id === 'default');
      const task = (await call('POST', '/tasks', { title: 'legacy', type: 'bug' })).json;
      assert.equal(task.key.split('-')[0], own.key);
      assert.equal((await call('GET', `/tasks/${task.key}`)).json.id, task.id);
    });

    it('rejects a malformed key and does not create the space', async () => {
      const bad = await call('POST', '/spaces', { name: 'Bad key', key: 'a-b' });
      assert.equal(bad.status, 400);
      const names = (await call('GET', '/spaces')).json.map((s) => s.name);
      assert.ok(!names.includes('Bad key'));
    });
  });

  describe('fields', () => {
    it('creates and changes priority, labels, due date and estimate', async () => {
      const made = await issue({ priority: 'urgent', labels: ['auth', ' auth ', 'ui'], dueDate: '2026-11-03', estimate: 3 });
      assert.equal(made.priority, 'urgent');
      assert.deepEqual(made.labels, ['auth', 'ui']);

      const { json } = await call('PUT', `/spaces/${space.id}/tasks/${made.id}`, { labels: [], dueDate: null, estimate: null, priority: 'low' });
      assert.equal(json.priority, 'low');
      assert.equal(json.labels, undefined);
      assert.equal(json.dueDate, undefined);
      assert.equal(json.estimate, undefined);
      assert.equal((await issue()).priority, 'medium');
    });

    for (const [name, body] of [
      ['an unknown priority', { priority: 'blocker' }],
      ['a date that does not exist', { dueDate: '2026-02-30' }],
      ['a negative estimate', { estimate: -1 }],
      ['a label with a comma', { labels: ['a,b'] }],
      ['an unknown type', { type: 'story' }],
    ]) {
      it(`rejects ${name}`, async () => {
        const made = await issue();
        assert.equal((await call('PUT', `/spaces/${space.id}/tasks/${made.id}`, body)).status, 400);
        assert.equal((await call('POST', `/spaces/${space.id}/tasks`, { title: 'x', type: 'bug', ...body })).status, 400);
      });
    }
  });

  describe('epics and sub-tasks', () => {
    it('nests epic, issue and sub-task, and no deeper', async () => {
      const epic = await issue({ type: 'epic', title: 'Billing' });
      const story = await issue({ parentId: epic.id });
      const sub = await issue({ parentId: story.id });
      assert.equal(sub.parentId, story.id);

      assert.equal((await call('POST', `/spaces/${space.id}/tasks`, { title: 'deep', type: 'bug', parentId: sub.id })).status, 422);
      const child = await call('GET', `/spaces/${space.id}/tasks/${story.id}`);
      assert.deepEqual(child.json.children.map((c) => c.key), [sub.key]);
    });

    it('refuses positions that break the hierarchy', async () => {
      const epic = await issue({ type: 'epic' });
      const other = await issue({ type: 'epic' });
      const parent = await issue();
      const sub = await issue({ parentId: parent.id });
      const put = (id, body) => call('PUT', `/spaces/${space.id}/tasks/${id}`, body);

      assert.equal((await put(epic.id, { parentId: other.id })).status, 422, 'epic under epic');
      assert.equal((await put(parent.id, { parentId: parent.id })).status, 422, 'its own parent');
      assert.equal((await put(sub.id, { type: 'epic' })).status, 422, 'a sub-task cannot be an epic');
      const lone = await issue();
      assert.equal((await put(parent.id, { parentId: lone.id })).status, 422, 'an issue with sub-tasks cannot become one');
      assert.equal((await put(parent.id, { parentId: 'nope' })).status, 422, 'unknown parent');

      const member = await issue({ parentId: epic.id });
      assert.equal((await put(epic.id, { type: 'bug' })).status, 422, 'an epic with issues keeps its type');
      assert.equal((await put(member.id, { parentId: null })).status, 200);
      assert.equal((await put(epic.id, { type: 'bug' })).status, 200);
    });

    it('leaves the issues without parent when their epic is deleted', async () => {
      const epic = await issue({ type: 'epic', title: 'Gone' });
      const member = await issue({ parentId: epic.id });
      await call('DELETE', `/spaces/${space.id}/tasks/${epic.id}`);

      const { json } = await call('GET', `/spaces/${space.id}/tasks/${member.id}`);
      assert.equal(json.parentId, undefined);
      const history = (await call('GET', `/spaces/${space.id}/tasks/${member.id}/history`)).json.history;
      assert.equal(history[0].field, 'parentId');
      assert.equal(history[0].oldValue, epic.key);
    });

    it('deleting through another space changes nothing there', async () => {
      const other = (await call('POST', '/spaces', { name: 'Cross' })).json;
      const parent = await issue();
      const child = await issue({ parentId: parent.id });
      assert.equal((await call('DELETE', `/spaces/${other.id}/tasks/${parent.id}`)).status, 404);
      const { history } = (await call('GET', `/spaces/${space.id}/tasks/${child.id}/history`)).json;
      assert.deepEqual(history.map((h) => h.field), ['created']);
    });

    it('records dependencies lost when an issue is deleted', async () => {
      const dep = await issue();
      const made = await issue({ dependsOn: [dep.id] });
      await call('DELETE', `/spaces/${space.id}/tasks/${dep.id}`);
      const { history } = (await call('GET', `/spaces/${space.id}/tasks/${made.id}/history`)).json;
      assert.equal(history[0].field, 'dependsOn');
      assert.equal(history[0].oldValue, dep.key);
      assert.equal(history[0].newValue, null);
    });

    it('does not run an epic', async () => {
      const epic = await issue({ type: 'epic' });
      const run = await call('POST', `/spaces/${space.id}/tasks/${epic.id}/run`, {});
      assert.equal(run.status, 409);
      assert.equal(run.json.error.code, 'TASK_IS_EPIC');
    });
  });

  describe('history', () => {
    it('records who changed each field, and nothing when nothing changed', async () => {
      const made = await issue({ priority: 'low' });
      const as = { 'X-Prism-Actor': 'Ana' };
      await call('PUT', `/spaces/${space.id}/tasks/${made.id}`, { priority: 'high', assigned: 'Bea', labels: ['a', 'b'] }, as);
      await call('PUT', `/spaces/${space.id}/tasks/${made.id}`, { priority: 'high' }, as);
      await call('PUT', `/spaces/${space.id}/tasks/${made.id}/move`, { to: 'in-review' }, as);

      const { history } = (await call('GET', `/spaces/${space.id}/tasks/${made.id}/history`)).json;
      const seen = history.map((h) => [h.actor, h.field, h.oldValue, h.newValue]);
      assert.deepEqual(seen, [
        ['Ana', 'status', 'To do', 'In review'],
        ['Ana', 'labels', null, 'a, b'],
        ['Ana', 'assigned', null, 'Bea'],
        ['Ana', 'priority', 'low', 'high'],
        ['API', 'created', null, null],
      ]);
    });

    it('records dependencies by key', async () => {
      const dep = await issue();
      const made = await issue();
      await call('PUT', `/spaces/${space.id}/tasks/${made.id}`, { dependsOn: [dep.id] });
      const { history } = (await call('GET', `/spaces/${space.id}/tasks/${made.id}/history`)).json;
      assert.equal(history[0].field, 'dependsOn');
      assert.equal(history[0].newValue, dep.key);
    });
  });

  describe('statuses', () => {
    let own;
    const put = (body) => call('PUT', `/spaces/${own.id}/statuses`, body);
    const defaults = () => [
      { id: 'todo', name: 'To do', category: 'todo' },
      { id: 'in-progress', name: 'In progress', category: 'in-progress' },
      { id: 'in-review', name: 'In review', category: 'in-progress' },
      { id: 'done', name: 'Done', category: 'done' },
    ];
    const add = (fields) => call('POST', `/spaces/${own.id}/tasks`, { title: 'x', type: 'bug', ...fields });

    before(async () => {
      own = (await call('POST', '/spaces', { name: 'Own statuses' })).json;
    });

    it('starts with the four defaults, and new issues in the first to-do', async () => {
      assert.deepEqual(own.statuses.map((s) => s.name), ['To do', 'In progress', 'In review', 'Done']);
      assert.equal(own.finishStatusId, 'in-review');
      assert.equal((await add()).json.statusId, 'todo');
    });

    it('adds, renames and reorders, grouping the board by status', async () => {
      const [todo, doing, review, done] = defaults();
      const { status, json } = await put({ statuses: [
        { ...todo, name: 'Backlog' }, { name: 'Ready for QA!', category: 'in-progress' }, doing, review, done,
      ] });
      assert.equal(status, 200);
      assert.deepEqual(json.statuses.map((s) => s.id), ['todo', 'ready-for-qa', 'in-progress', 'in-review', 'done']);
      assert.equal(json.statuses[0].name, 'Backlog');

      const moved = await add();
      await call('PUT', `/spaces/${own.id}/tasks/${moved.json.id}/move`, { to: 'ready-for-qa' });
      const board = (await call('GET', `/spaces/${own.id}/tasks`)).json;
      assert.deepEqual(board['ready-for-qa'].map((t) => t.id), [moved.json.id]);
      assert.equal(board['ready-for-qa'][0].category, 'in-progress');
      const filtered = (await call('GET', `/spaces/${own.id}/tasks?category=todo`)).json;
      assert.ok(filtered.todo.length > 0);
      assert.equal(filtered['ready-for-qa'].length, 0);
    });

    it('rejects a list that leaves a category empty, repeats a name or invents an id', async () => {
      const [todo, doing, , done] = defaults();
      assert.equal((await put({ statuses: [todo, doing] })).status, 400);
      assert.equal((await put({ statuses: [todo, doing, { ...done, name: 'to DO' }] })).status, 400);
      assert.equal((await put({ statuses: [{ ...todo, id: 'made-up' }, doing, done] })).status, 400);
      assert.equal((await put({ statuses: [] })).status, 400);
    });

    it('does not let a status take a name the list response uses', async () => {
      const space2 = (await call('POST', '/spaces', { name: 'Reserved' })).json;
      const { json } = await call('PUT', `/spaces/${space2.id}/statuses`, { statuses: [...space2.statuses, { name: 'Total', category: 'done' }] });
      assert.ok(json.statuses.some((s) => s.id === 'total-status'));
    });

    it('needs a destination to remove a status with issues, and moves them with history', async () => {
      const space3 = (await call('POST', '/spaces', { name: 'Removal' })).json;
      const made = (await call('POST', `/spaces/${space3.id}/tasks`, { title: 'x', type: 'bug' })).json;
      await call('PUT', `/spaces/${space3.id}/tasks/${made.id}/move`, { to: 'in-review' });
      const keep = space3.statuses.filter((s) => s.id !== 'in-review');

      const refused = await call('PUT', `/spaces/${space3.id}/statuses`, { statuses: keep });
      assert.equal(refused.status, 409);
      assert.equal(refused.json.error.code, 'STATUS_IN_USE');
      assert.equal((await call('GET', `/spaces/${space3.id}`)).json.statuses.length, 4, 'nothing changed');

      const saved = await call('PUT', `/spaces/${space3.id}/statuses`, { statuses: keep, moves: { 'in-review': 'done' } });
      assert.equal(saved.status, 200);
      const task = (await call('GET', `/spaces/${space3.id}/tasks/${made.id}`)).json;
      assert.equal(task.statusId, 'done');
      assert.equal(task.category, 'done');
      assert.equal(saved.json.finishStatusId, 'done', 'agents end in a done status once In review is gone');
      const { history } = (await call('GET', `/spaces/${space3.id}/tasks/${made.id}/history`)).json;
      assert.equal(history[0].oldValue, 'In review');
      assert.equal(history[0].newValue, 'Done');
    });

    it('moves issues along when a status changes category, and dependencies follow', async () => {
      const space4 = (await call('POST', '/spaces', { name: 'Category' })).json;
      const url = `/spaces/${space4.id}/tasks`;
      const dep = (await call('POST', url, { title: 'dep', type: 'bug' })).json;
      const blocked = (await call('POST', url, { title: 'blocked', type: 'bug', dependsOn: [dep.id] })).json;
      await call('PUT', `${url}/${dep.id}/move`, { to: 'in-review' });
      assert.equal((await call('GET', url)).json.todo.find((t) => t.id === blocked.id).isBlocked, true);

      const statuses = space4.statuses.map((s) => (s.id === 'in-review' ? { ...s, category: 'done' } : s));
      await call('PUT', `/spaces/${space4.id}/statuses`, { statuses });
      assert.equal((await call('GET', url)).json.todo.find((t) => t.id === blocked.id).isBlocked, false);
    });

    it('rejects moving to a status of another space', async () => {
      const made = await add();
      assert.equal((await call('PUT', `/spaces/${own.id}/tasks/${made.json.id}/move`, { to: 'nope' })).status, 400);
    });

    it('forgets a finish status that was removed', async () => {
      const space6 = (await call('POST', '/spaces', { name: 'Forget' })).json;
      const statuses = [...space6.statuses, { name: 'Proto', category: 'in-progress' }];
      const added = (await call('PUT', `/spaces/${space6.id}/statuses`, { statuses })).json;
      await call('PUT', `/spaces/${space6.id}/hooks`, { checkCommand: null, autoPr: false, finishStatus: 'proto' });
      const without = added.statuses.filter((s) => s.id !== 'proto');
      const saved = (await call('PUT', `/spaces/${space6.id}/statuses`, { statuses: without })).json;
      assert.equal(saved.hooks.finishStatus, undefined);
      assert.equal(saved.finishStatusId, 'in-review');

      const again = (await call('PUT', `/spaces/${space6.id}/statuses`, { statuses: [...without, { name: 'Proto', category: 'in-progress' }] })).json;
      assert.equal(again.finishStatusId, 'in-review', 'a new status with that name does not inherit it');
    });

    it('lets a space choose where agents finish, while the status exists', async () => {
      const space5 = (await call('POST', '/spaces', { name: 'Finish' })).json;
      const hooks = (body) => call('PUT', `/spaces/${space5.id}/hooks`, { checkCommand: null, autoPr: false, ...body });
      assert.equal((await hooks({ finishStatus: 'nope' })).status, 400);
      assert.equal((await hooks({ finishStatus: 'todo' })).status, 400, 'finished work does not look unstarted');
      assert.equal((await hooks({ finishStatus: 'done' })).json.finishStatusId, 'done');
      assert.equal((await hooks({})).json.finishStatusId, 'done', 'saving the rest keeps it');
    });
  });

  describe('comments', () => {
    it('keeps them with the issue, and removes them with it', async () => {
      const made = await issue();
      const url = `/spaces/${space.id}/tasks/${made.id}`;
      const posted = await call('POST', `${url}/comments`, { author: 'Ana', text: 'hi', type: 'question' });
      assert.equal(posted.status, 201);
      assert.equal((await call('PATCH', `${url}/comments/${posted.json.id}`, { resolved: true })).json.resolved, true);

      const fetched = (await call('GET', url)).json;
      assert.equal(fetched.comments.length, 1);
      assert.equal(fetched.comments[0].resolved, true);
      const board = (await call('GET', `/spaces/${space.id}/tasks`)).json;
      assert.equal(board.todo.find((t) => t.id === made.id).comments[0].text, 'hi');
    });
  });
});

describe('upgrade from tasks with arcs', () => {
  /** A database as the previous version left it. */
  function oldDatabase(dir) {
    const db = new Database(path.join(dir, 'prism.db'));
    db.exec(`
      CREATE TABLE spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, working_directory TEXT, pipeline TEXT, project_claude_md TEXT,
        agent_nicknames TEXT, folio_backend TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
        pinned_rank INTEGER, stage_models TEXT, hooks TEXT);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        column TEXT NOT NULL CHECK(column IN ('todo','in-progress','done')), title TEXT NOT NULL, type TEXT NOT NULL,
        description TEXT, assigned TEXT, pipeline TEXT, attachments TEXT, comments TEXT, arc TEXT, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, stage_models TEXT, depends_on TEXT, rank REAL DEFAULT 0);
    `);
    const space = db.prepare(`INSERT INTO spaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`);
    space.run('s1', 'General', '2026-01-01', '2026-01-01');
    space.run('s2', 'Géneral Ñu', '2026-01-02', '2026-01-02');
    space.run('s3', 'Odd comments', '2026-01-03', '2026-01-03');
    const task = db.prepare(`INSERT INTO tasks (id, space_id, column, title, type, comments, arc, rank, created_at, updated_at, depends_on)
      VALUES (?, ?, ?, ?, 'feature', ?, ?, ?, ?, ?, ?)`);
    const comment = JSON.stringify([{ id: 'c1', author: 'Ana', text: 'hello', type: 'question', resolved: true, createdAt: '2026-02-01T00:00:00Z' }]);
    task.run('t3', 's1', 'done', 'Third', null, 'Billing', 1000, '2026-01-13', '2026-01-13', null);
    task.run('t1', 's1', 'todo', 'First', comment, 'Billing', 2000, '2026-01-11', '2026-01-11', null);
    task.run('t2', 's1', 'done', 'Second', '{broken', 'Finished', 3000, '2026-01-12', '2026-01-12', JSON.stringify(['t1']));
    task.run('t4', 's1', 'todo', 'Fourth', null, null, 4000, '2026-01-14', '2026-01-14', null);
    task.run('t5', 's2', 'in-progress', 'Other space', null, 'Billing', 1000, '2026-01-15', '2026-01-15', null);
    for (const [id, odd] of [['o1', '[null]'], ['o2', '[{"text":{"a":1}}]'], ['o3', '{"note":"keep me"}'], ['o4', '["just text"]']]) {
      task.run(id, 's3', 'todo', id, odd, null, 1000, '2026-01-20', '2026-01-20', null);
    }
    task.run('o5', 's3', 'todo', 'o5', '[{"text":"ok","author":true,"parentId":7}]', null, 1000, '2026-01-21', '2026-01-21', null);
    db.pragma('user_version = 2');
    db.close();
  }

  let dir, store;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-upgrade-'));
    oldDatabase(dir);
    store = createStore(dir);
  });

  after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps a copy of the old database', () => {
    const copy = new Database(path.join(dir, 'prism.db.before-v3'), { readonly: true });
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 10);
    assert.equal(copy.pragma('user_version', { simple: true }), 2);
    copy.close();
  });

  it('gives each space a key, and each task a number by creation order', () => {
    assert.equal(store.getSpace('s1').key, 'GEN');
    assert.equal(store.getSpace('s2').key, 'GN');
    assert.equal(store.getTask('s1', 't1').key, 'GEN-1');
    assert.equal(store.getTask('s1', 't2').key, 'GEN-2');
    assert.equal(store.getTask('s1', 't3').key, 'GEN-3');
    assert.equal(store.getTask('s1', 't4').key, 'GEN-4');
  });

  it('turns each arc into an epic of its space, holding its tasks', () => {
    const epics = store.getAllTasksForSpace('s1').filter((t) => t.type === 'epic');
    assert.deepEqual(epics.map((e) => e.title).sort(), ['Billing', 'Finished']);
    const billing = epics.find((e) => e.title === 'Billing');
    assert.equal(store.getTask('s1', 't1').parentId, billing.id);
    assert.equal(store.getTask('s1', 't3').parentId, billing.id);
    assert.equal(store.getTask('s1', 't4').parentId, undefined);
    assert.equal(store.getTask('s1', 't1').arc, undefined);

    assert.equal(billing.statusId, 'in-progress', 'part done, part to do');
    assert.equal(epics.find((e) => e.title === 'Finished').statusId, 'done', 'all done');
    assert.equal(store.getAllTasksForSpace('s2').find((t) => t.type === 'epic').statusId, 'in-progress');
  });

  it('numbers epics after the tasks and goes on from there', () => {
    const numbers = store.getAllTasksForSpace('s1').map((t) => t.number).sort((a, b) => a - b);
    assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6]);
    const next = { id: 'new', title: 'New', type: 'bug', createdAt: 'x', updatedAt: 'x' };
    store.insertTask(next, 's1', 'todo');
    assert.equal(next.key, 'GEN-7');
  });

  it('keeps status, rank, dependencies and comments', () => {
    assert.equal(store.getTask('s1', 't3').statusId, 'done');
    assert.equal(store.getTask('s1', 't1').rank, 2000);
    assert.deepEqual(store.getTask('s1', 't2').dependsOn, ['t1']);
    assert.deepEqual(store.getTask('s1', 't1').comments, [
      { id: 'c1', author: 'Ana', text: 'hello', type: 'question', resolved: true, createdAt: '2026-02-01T00:00:00Z' },
    ]);
  });

  it('survives unreadable comments, leaving them in the old column', () => {
    assert.equal(store.getTask('s1', 't2').comments, undefined);
    assert.equal(store.getTask('s1', 't2').number, 2);
    store.close();
    const raw = new Database(path.join(dir, 'prism.db'), { readonly: true });
    assert.equal(raw.prepare(`SELECT comments FROM tasks WHERE id = 't2'`).get().comments, '{broken');
    raw.close();
    store = createStore(dir);
  });

  it('leaves comments of an unexpected shape where they were, and starts anyway', () => {
    store.close();
    const raw = new Database(path.join(dir, 'prism.db'), { readonly: true });
    const left = (id) => raw.prepare('SELECT comments FROM tasks WHERE id = ?').get(id).comments;
    assert.equal(left('o1'), '[null]');
    assert.equal(left('o2'), '[{"text":{"a":1}}]');
    assert.equal(left('o3'), '{"note":"keep me"}');
    assert.equal(left('o4'), '["just text"]');
    raw.close();
    store = createStore(dir);
    assert.equal(store.getTask('s3', 'o3').comments, undefined);
    const { author, parentId, text } = store.getTask('s3', 'o5').comments[0];
    assert.deepEqual([author, parentId, text], ['unknown', undefined, 'ok']);
  });

  it('does not trust an empty backup', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-upgrade-empty-'));
    oldDatabase(emptyDir);
    fs.writeFileSync(path.join(emptyDir, 'prism.db.before-v3'), '');
    createStore(emptyDir).close();
    assert.ok(fs.statSync(path.join(emptyDir, 'prism.db.before-v3')).size > 0);
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('does nothing the second time', () => {
    store.close();
    store = createStore(dir);
    assert.equal(store.getAllTasksForSpace('s1').filter((t) => t.type === 'epic').length, 2);
    assert.equal(store.getTask('s1', 't1').comments.length, 1);
    assert.equal(store.getTask('s1', 't1').key, 'GEN-1');
  });

  it('rolls back whole if the upgrade fails halfway', () => {
    const failDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-upgrade-fail-'));
    oldDatabase(failDir);
    const db = new Database(path.join(failDir, 'prism.db'));
    db.exec(`CREATE TRIGGER boom BEFORE UPDATE OF arc ON tasks WHEN new.id = 't5' BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
    db.close();

    assert.throws(() => createStore(failDir), /boom/);
    const check = new Database(path.join(failDir, 'prism.db'), { readonly: true });
    assert.equal(check.pragma('user_version', { simple: true }), 2);
    assert.equal(check.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE type = 'epic'`).get().n, 0);
    assert.equal(check.prepare(`SELECT arc FROM tasks WHERE id = 't1'`).get().arc, 'Billing');
    assert.equal(check.prepare(`SELECT COUNT(*) AS n FROM comments`).get().n, 0);
    check.close();
    fs.rmSync(failDir, { recursive: true, force: true });
  });
});
