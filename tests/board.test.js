'use strict';

/**
 * GET /spaces/:id/board, and what goes with it: only what is on screen, what cards show about
 * what is not, and a poll that costs nothing when nothing changed.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startTestServer } = require('./helpers/server');
const { startServer } = require('../server');
const { createStore } = require('../src/services/store');
const { mayRequest, runMayRequest } = require('../src/utils/permissions');

function raw(port, method, urlPath, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port, method, path: urlPath,
      headers: { ...(payload && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function json(port, method, urlPath, body, headers) {
  const res = await raw(port, method, urlPath, { body, headers });
  return { ...res, json: res.body.length ? JSON.parse(res.body.toString()) : null };
}

describe('GET /spaces/:id/board', () => {
  let server;
  let port;
  let spaceId;
  const url = (query = '') => `/api/v1/spaces/${spaceId}/board${query}`;
  const tasksUrl = (rest = '') => `/api/v1/spaces/${spaceId}/tasks${rest}`;

  async function create(fields) {
    const res = await json(port, 'POST', tasksUrl(), { type: 'feature', ...fields });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    return res.json;
  }
  const move = (id, to) => json(port, 'PUT', tasksUrl(`/${id}/move`), { to });

  before(async () => {
    server = await startTestServer();
    port = server.port;
    const space = await json(port, 'POST', '/api/v1/spaces', { name: 'Board', key: 'BRD' });
    spaceId = space.json.id;
  });
  after(() => server.close());

  async function newSpace(name) {
    const res = await json(port, 'POST', '/api/v1/spaces', { name });
    return res.json.id;
  }

  test('has every status of the space, with what it holds', async () => {
    const res = await json(port, 'GET', url());
    assert.equal(res.status, 200);
    const statuses = (await json(port, 'GET', `/api/v1/spaces/${spaceId}`)).json.statuses;
    assert.deepEqual(Object.keys(res.json.columns), statuses.map((s) => s.id));
    assert.ok(Array.isArray(res.json.epics));
  });

  test('a space that does not exist is a 404, and only GET is allowed', async () => {
    assert.equal((await json(port, 'GET', '/api/v1/spaces/nope/board')).status, 404);
    assert.equal((await json(port, 'POST', url(), {})).status, 405);
  });

  describe('limits', () => {
    let id;
    let doneId;
    let todoId;
    const titles = (column) => column.tasks.map((t) => t.title);

    before(async () => {
      id = await newSpace('Limits');
      const { statuses } = (await json(port, 'GET', `/api/v1/spaces/${id}`)).json;
      todoId = statuses.find((s) => s.category === 'todo').id;
      doneId = statuses.find((s) => s.category === 'done').id;
      // Directly, since a hundred and some requests would only make this slow.
      for (let i = 1; i <= 120; i += 1) {
        server.store.insertTask({ id: `t${i}`, title: `T${i}`, type: 'chore', rank: i * 1000, createdAt: new Date(i).toISOString(), updatedAt: new Date(i).toISOString() }, id, todoId);
        server.store.insertTask({ id: `d${i}`, title: `D${i}`, type: 'chore', rank: i * 1000, createdAt: new Date(i).toISOString(), updatedAt: new Date(i).toISOString() }, id, doneId);
      }
    });

    const board = async (query = '') => (await json(port, 'GET', `/api/v1/spaces/${id}/board${query}`));

    test('by default, the first 100 of a column that is not done', async () => {
      const column = (await board()).json.columns[todoId];
      assert.equal(column.tasks.length, 100);
      assert.equal(column.total, 120);
      assert.equal(column.tasks[0].title, 'T1');
      assert.equal(column.tasks[99].title, 'T100');
    });

    test('by default, the last 50 of a done column, still in rank order', async () => {
      const column = (await board()).json.columns[doneId];
      assert.equal(column.tasks.length, 50);
      assert.equal(column.total, 120);
      assert.deepEqual(titles(column), Array.from({ length: 50 }, (_, i) => `D${71 + i}`));
    });

    test('limits override each column on its own', async () => {
      const { columns } = (await board(`?limits=${todoId}:3,${doneId}:2`)).json;
      assert.deepEqual(titles(columns[todoId]), ['T1', 'T2', 'T3']);
      assert.deepEqual(titles(columns[doneId]), ['D119', 'D120']);
      assert.equal(columns[todoId].total, 120);
    });

    test('a limit over the maximum is capped, and one of an unknown status is ignored', async () => {
      const { columns } = (await board(`?limits=${todoId}:999999,gone:5`)).json;
      assert.equal(columns[todoId].tasks.length, 120);
      assert.equal(columns.gone, undefined);
    });

    test('a limit that makes no sense is refused', async () => {
      assert.equal((await board(`?limits=${todoId}:many`)).status, 400);
      assert.equal((await board(`?limits=${todoId}:-1`)).status, 400);
      assert.equal((await board('?limits=nothing')).status, 400);
    });

    test('says where the next card beyond what is loaded is, to drop next to it', async () => {
      const { columns } = (await board(`?limits=${todoId}:3,${doneId}:2`)).json;
      assert.equal(columns[todoId].rankAfter, 4000);
      assert.equal(columns[todoId].rankBefore, undefined);
      assert.equal(columns[doneId].rankBefore, 118000);
      assert.equal(columns[doneId].rankAfter, undefined);
      const all = (await board(`?limits=${todoId}:120`)).json.columns[todoId];
      assert.equal(all.rankAfter, undefined);
    });

    test('takes the cards of the right end when ranks tie', async () => {
      const space = await newSpace('Ties');
      const { statuses } = (await json(port, 'GET', `/api/v1/spaces/${space}`)).json;
      const done = statuses.find((s) => s.category === 'done').id;
      const at = new Date(0).toISOString();
      for (const name of ['a', 'b', 'c']) {
        server.store.insertTask({ id: `tie-${name}`, title: name, type: 'chore', rank: 1000, createdAt: at, updatedAt: at }, space, done);
      }
      const { columns } = (await json(port, 'GET', `/api/v1/spaces/${space}/board?limits=${done}:2`)).json;
      assert.deepEqual(columns[done].tasks.map((t) => t.title), ['b', 'c']);
    });
  });

  describe('epic filter', () => {
    let id;
    let epic;
    let other;
    let issue;
    let subtask;
    let loose;
    let doneStatus;

    before(async () => {
      id = await newSpace('Epics');
      const { statuses } = (await json(port, 'GET', `/api/v1/spaces/${id}`)).json;
      doneStatus = statuses.find((s) => s.category === 'done').id;
      const add = async (fields) => (await json(port, 'POST', `/api/v1/spaces/${id}/tasks`, { type: 'feature', ...fields })).json;
      epic = await add({ title: 'Epic', type: 'epic' });
      other = await add({ title: 'Other epic', type: 'epic' });
      issue = await add({ title: 'Issue', parentId: epic.id });
      subtask = await add({ title: 'Sub-task', parentId: issue.id });
      loose = await add({ title: 'Loose' });
      await add({ title: 'Of the other', parentId: other.id });
      await json(port, 'PUT', `/api/v1/spaces/${id}/tasks/${subtask.id}/move`, { to: doneStatus });
    });

    const board = async (query = '') => (await json(port, 'GET', `/api/v1/spaces/${id}/board${query}`)).json;
    const ids = (body) => Object.values(body.columns).flatMap((c) => c.tasks.map((t) => t.id));

    test('shows the epic, its issues and their sub-tasks', async () => {
      const body = await board(`?epic=${epic.id}`);
      assert.deepEqual(ids(body).sort(), [epic.id, issue.id, subtask.id].sort());
      assert.ok(!ids(body).includes(loose.id));
    });

    test('totals count what the filter shows, not the whole column', async () => {
      const body = await board(`?epic=${epic.id}`);
      assert.equal(Object.values(body.columns).reduce((n, c) => n + c.total, 0), 3);
      assert.equal(body.columns[doneStatus].total, 1);
    });

    test('a total is the real count, not what was loaded', async () => {
      const body = await board(`?epic=${epic.id}&limits=${doneStatus}:0`);
      assert.equal(body.columns[doneStatus].total, 1);
      assert.equal(body.columns[doneStatus].tasks.length, 0);
    });

    test('still lists every epic of the space, with its progress', async () => {
      const { epics } = await board(`?epic=${epic.id}`);
      assert.deepEqual(epics.map((e) => e.id).sort(), [epic.id, other.id].sort());
      const mine = epics.find((e) => e.id === epic.id);
      assert.equal(mine.title, 'Epic');
      assert.match(mine.key, /-\d+$/);
      assert.equal(mine.category, 'todo');
      assert.ok(mine.statusId);
      assert.equal(mine.total, 1);
      assert.equal(mine.done, 0);
    });

    test('something that is not an epic of this space has nothing in it', async () => {
      for (const not of ['nope', issue.id]) {
        const body = await board(`?epic=${not}`);
        assert.deepEqual(ids(body), []);
        assert.equal(Object.values(body.columns).reduce((n, c) => n + c.total, 0), 0);
        assert.equal(body.epics.length, 2);
      }
    });
  });

  describe('what a card carries', () => {
    const find = (body, taskId) => Object.values(body.columns).flatMap((c) => c.tasks).find((t) => t.id === taskId);

    test('its epic, directly or through its parent, and its parent key', async () => {
      const epic = await create({ title: 'The epic', type: 'epic' });
      const issue = await create({ title: 'The issue', parentId: epic.id });
      const sub = await create({ title: 'The sub-task', parentId: issue.id });
      const loose = await create({ title: 'Nobody\'s' });
      const body = (await json(port, 'GET', url())).json;
      assert.deepEqual(find(body, epic.id).epic, null);
      assert.equal(find(body, epic.id).parentKey, null);
      assert.deepEqual(find(body, issue.id).epic, { id: epic.id, title: 'The epic' });
      assert.equal(find(body, issue.id).parentKey, null);
      assert.deepEqual(find(body, sub.id).epic, { id: epic.id, title: 'The epic' });
      assert.equal(find(body, sub.id).parentKey, issue.key);
      assert.equal(find(body, loose.id).epic, null);
      assert.equal(find(body, loose.id).parentKey, null);
    });

    test('a sub-task of an issue with no epic has no epic', async () => {
      const issue = await create({ title: 'Top' });
      const sub = await create({ title: 'Under', parentId: issue.id });
      const body = (await json(port, 'GET', url())).json;
      assert.equal(find(body, sub.id).epic, null);
      assert.equal(find(body, sub.id).parentKey, issue.key);
    });

    test('how many of its children are done', async () => {
      const { statuses } = (await json(port, 'GET', `/api/v1/spaces/${spaceId}`)).json;
      const done = statuses.find((s) => s.category === 'done').id;
      const issue = await create({ title: 'Parent' });
      const a = await create({ title: 'A', parentId: issue.id });
      await create({ title: 'B', parentId: issue.id });
      await move(a.id, done);
      const body = (await json(port, 'GET', url())).json;
      assert.deepEqual(find(body, issue.id).progress, { done: 1, total: 2 });
      assert.deepEqual(find(body, a.id).progress, { done: 0, total: 0 });
    });

    test('whether it is blocked, the same as GET tasks says', async () => {
      const { statuses } = (await json(port, 'GET', `/api/v1/spaces/${spaceId}`)).json;
      const done = statuses.find((s) => s.category === 'done').id;
      const waitingFor = await create({ title: 'Dep open' });
      const finished = await create({ title: 'Dep done' });
      await move(finished.id, done);
      const blocked = await create({ title: 'Blocked', dependsOn: [waitingFor.id, finished.id] });
      const free = await create({ title: 'Free', dependsOn: [finished.id] });
      const none = await create({ title: 'No deps' });

      const body = (await json(port, 'GET', url())).json;
      assert.equal(find(body, blocked.id).isBlocked, true);
      assert.equal(find(body, blocked.id).blockedByCount, 1);
      assert.equal(find(body, free.id).isBlocked, false);
      assert.equal(find(body, free.id).blockedByCount, 0);
      assert.equal('isBlocked' in find(body, none.id), false);

      const old = (await json(port, 'GET', tasksUrl())).json;
      const oldTasks = Object.values(old).filter(Array.isArray).flat();
      for (const taskId of [blocked.id, free.id, none.id]) {
        const before = oldTasks.find((t) => t.id === taskId);
        assert.equal(find(body, taskId).isBlocked, before.isBlocked);
        assert.equal(find(body, taskId).blockedByCount, before.blockedByCount);
      }
    });

    test('a dependency in a status of category done stops blocking, whatever it is called', async () => {
      const id = await newSpace('Custom');
      const space = (await json(port, 'GET', `/api/v1/spaces/${id}`)).json;
      await json(port, 'PUT', `/api/v1/spaces/${id}/statuses`, {
        statuses: [...space.statuses, { name: 'Shipped', category: 'done' }],
        moves: {},
      });
      const shipped = (await json(port, 'GET', `/api/v1/spaces/${id}`)).json.statuses.find((s) => s.name === 'Shipped');
      const dep = (await json(port, 'POST', `/api/v1/spaces/${id}/tasks`, { title: 'Dep', type: 'chore' })).json;
      const task = (await json(port, 'POST', `/api/v1/spaces/${id}/tasks`, { title: 'Waits', type: 'chore', dependsOn: [dep.id] })).json;
      await json(port, 'PUT', `/api/v1/spaces/${id}/tasks/${dep.id}/move`, { to: shipped.id });
      const body = (await json(port, 'GET', `/api/v1/spaces/${id}/board`)).json;
      assert.equal(find(body, task.id).isBlocked, false);
    });

    test('its open questions, and not its comments', async () => {
      const task = await create({ title: 'Asked' });
      const quiet = await create({ title: 'Quiet' });
      const post = (fields) => json(port, 'POST', tasksUrl(`/${task.id}/comments`), { author: 'dev', ...fields });
      const first = await post({ text: 'First question?', type: 'question' });
      await post({ text: 'Second question?', type: 'question' });
      await post({ text: 'A note', type: 'note' });
      assert.equal(first.status, 201, JSON.stringify(first.json));

      let card = find((await json(port, 'GET', url())).json, task.id);
      assert.equal(card.pendingQuestions, 2);
      assert.equal(card.pendingQuestionText, 'First question?');
      assert.equal('comments' in card, false);
      assert.equal(find((await json(port, 'GET', url())).json, quiet.id).pendingQuestions, 0);

      await json(port, 'PATCH', tasksUrl(`/${task.id}/comments/${first.json.id}`), { resolved: true });
      card = find((await json(port, 'GET', url())).json, task.id);
      assert.equal(card.pendingQuestions, 1);
      assert.equal(card.pendingQuestionText, 'Second question?');
    });

    test('its attachments without their content, except a link', async () => {
      const task = await create({ title: 'With files' });
      const put = await json(port, 'PUT', tasksUrl(`/${task.id}/attachments`), {
        attachments: [
          { name: 'notes.txt', type: 'text', content: 'A secret worth nothing on a card' },
          { name: 'site', type: 'link', content: 'https://example.com/' },
        ],
      });
      assert.equal(put.status, 200, JSON.stringify(put.json));
      const card = find((await json(port, 'GET', url())).json, task.id);
      assert.deepEqual(card.attachments, [
        { name: 'notes.txt', type: 'text' },
        { name: 'site', type: 'link', content: 'https://example.com/' },
      ]);
    });

    test('a description of up to 400 characters stays whole, and a longer one says it was cut', async () => {
      const exact = await create({ title: 'Exact', description: 'x'.repeat(400) });
      const long = await create({ title: 'Long', description: 'y'.repeat(401) });
      const body = (await json(port, 'GET', url())).json;
      assert.equal(find(body, exact.id).description.length, 400);
      assert.equal('descriptionTruncated' in find(body, exact.id), false);
      assert.equal(find(body, long.id).description, 'y'.repeat(400));
      assert.equal(find(body, long.id).descriptionTruncated, true);
      // And GET /tasks/:id has all of it.
      assert.equal((await json(port, 'GET', tasksUrl(`/${long.id}`))).json.description.length, 401);
    });

    test('does not cut a character in two', async () => {
      const task = await create({ title: 'Emoji', description: `${'z'.repeat(399)}😀 and more` });
      const card = find((await json(port, 'GET', url())).json, task.id);
      assert.equal(card.description, 'z'.repeat(399));
      assert.equal(card.descriptionTruncated, true);
    });
  });

  describe('ETag', () => {
    test('asking with the ETag it was given answers 304 with no body', async () => {
      const first = await raw(port, 'GET', url());
      assert.equal(first.status, 200);
      assert.match(first.headers.etag, /^"[0-9a-f]{40}"$/);
      const second = await raw(port, 'GET', url(), { headers: { 'If-None-Match': first.headers.etag } });
      assert.equal(second.status, 304);
      assert.equal(second.body.length, 0);
      assert.equal(second.headers.etag, first.headers.etag);
    });

    test('a weakened ETag still counts', async () => {
      const first = await raw(port, 'GET', url());
      const second = await raw(port, 'GET', url(), { headers: { 'If-None-Match': `W/${first.headers.etag}` } });
      assert.equal(second.status, 304);
    });

    test('is the hash of the body, whichever way it travels', async () => {
      const plain = await raw(port, 'GET', url());
      const gzipped = await raw(port, 'GET', url(), { headers: { 'Accept-Encoding': 'gzip' } });
      assert.equal(plain.headers.etag, gzipped.headers.etag);
    });

    test('changes when the board does', async () => {
      const first = await raw(port, 'GET', url());
      await create({ title: 'Something new' });
      const second = await raw(port, 'GET', url(), { headers: { 'If-None-Match': first.headers.etag } });
      assert.equal(second.status, 200);
      assert.notEqual(second.headers.etag, first.headers.etag);
    });

    test('changes with what is asked for', async () => {
      const first = await raw(port, 'GET', url());
      const { statuses } = (await json(port, 'GET', `/api/v1/spaces/${spaceId}`)).json;
      const limited = await raw(port, 'GET', url(`?limits=${statuses[0].id}:1`), { headers: { 'If-None-Match': first.headers.etag } });
      assert.equal(limited.status, 200);
    });
  });

  describe('gzip', () => {
    test('compresses what is over 1 KB for a request that takes it', async () => {
      const plain = await raw(port, 'GET', url());
      assert.ok(plain.body.length > 1024, 'the board has grown by now');
      assert.equal(plain.headers['content-encoding'], undefined);
      assert.match(plain.headers.vary, /Accept-Encoding/);

      const gzipped = await raw(port, 'GET', url(), { headers: { 'Accept-Encoding': 'gzip, deflate' } });
      assert.equal(gzipped.headers['content-encoding'], 'gzip');
      assert.match(gzipped.headers.vary, /Accept-Encoding/);
      assert.equal(Number(gzipped.headers['content-length']), gzipped.body.length);
      assert.ok(gzipped.body.length < plain.body.length);
      assert.deepEqual(JSON.parse(zlib.gunzipSync(gzipped.body).toString()), JSON.parse(plain.body.toString()));
    });

    test('leaves alone a small answer, and a request that refuses it', async () => {
      const small = await raw(port, 'GET', '/api/v1/spaces/nope/board', { headers: { 'Accept-Encoding': 'gzip' } });
      assert.equal(small.headers['content-encoding'], undefined);
      const refused = await raw(port, 'GET', url(), { headers: { 'Accept-Encoding': 'gzip;q=0' } });
      assert.equal(refused.headers['content-encoding'], undefined);
    });

    test('also for the old route, and any other', async () => {
      const res = await raw(port, 'GET', tasksUrl(), { headers: { 'Accept-Encoding': 'gzip' } });
      assert.equal(res.headers['content-encoding'], 'gzip');
      assert.ok(typeof JSON.parse(zlib.gunzipSync(res.body).toString()).total === 'number');
    });
  });

  describe('the old route stays as it was', () => {
    test('every task of every column, with comments and whole descriptions', async () => {
      const task = await create({ title: 'Old route', description: 'o'.repeat(1000) });
      await json(port, 'POST', tasksUrl(`/${task.id}/comments`), { author: 'dev', text: 'Hi', type: 'note' });
      const res = await json(port, 'GET', tasksUrl());
      assert.equal(res.status, 200);
      assert.ok('total' in res.json && 'nextCursor' in res.json);
      assert.equal(res.headers.etag, undefined);
      const found = Object.values(res.json).filter(Array.isArray).flat().find((t) => t.id === task.id);
      assert.equal(found.description.length, 1000);
      assert.equal(found.comments.length, 1);
      for (const field of ['epic', 'parentKey', 'progress', 'pendingQuestions', 'descriptionTruncated']) {
        assert.equal(field in found, false, `${field} is new, and not for this route`);
      }
    });

    test('GET /tasks/:id without a view is as it was too', async () => {
      const parent = await create({ title: 'Old parent' });
      const child = await create({ title: 'Old child', parentId: parent.id });
      const body = (await json(port, 'GET', tasksUrl(`/${parent.id}`))).json;
      assert.equal(body.children.length, 1);
      assert.equal(body.children[0].id, child.id);
      assert.equal('isBlocked' in body, false);
      assert.equal('parent' in (await json(port, 'GET', tasksUrl(`/${child.id}`))).json, false);
    });
  });

  describe('lookups for what is not on the board', () => {
    test('?parent= lists the issues under one, in order, with its counts', async () => {
      const { statuses } = (await json(port, 'GET', `/api/v1/spaces/${spaceId}`)).json;
      const done = statuses.find((s) => s.category === 'done').id;
      const parent = await create({ title: 'Lookup parent' });
      const a = await create({ title: 'A', parentId: parent.id, description: 'heavy' });
      const b = await create({ title: 'B', parentId: parent.id });
      await move(a.id, done);
      const body = (await json(port, 'GET', tasksUrl(`?parent=${parent.id}`))).json;
      assert.deepEqual(body.tasks.map((t) => t.id), [a.id, b.id]);
      assert.equal(body.total, 2);
      assert.equal(body.done, 1);
      assert.equal(body.tasks[0].category, 'done');
      assert.equal('description' in body.tasks[0], false);
    });

    test('?parent= stops at its limit, and the counts stay the real ones', async () => {
      const parent = await create({ title: 'Many' });
      await create({ title: 'A', parentId: parent.id });
      await create({ title: 'B', parentId: parent.id });
      const body = (await json(port, 'GET', tasksUrl(`?parent=${parent.id}&limit=1`))).json;
      assert.equal(body.tasks.length, 1);
      assert.equal(body.total, 2);
    });

    test('?ids= finds issues in any column, and not those of another space', async () => {
      const mine = await create({ title: 'Mine' });
      const otherSpace = await newSpace('Elsewhere');
      const theirs = (await json(port, 'POST', `/api/v1/spaces/${otherSpace}/tasks`, { title: 'Theirs', type: 'chore' })).json;
      const body = (await json(port, 'GET', tasksUrl(`?ids=${mine.id},${theirs.id},nope`))).json;
      assert.deepEqual(body.tasks.map((t) => t.id), [mine.id]);
      assert.equal(body.total, 1);
    });

    test('?view=panel has the whole issue, what is derived from it, and no attachment content', async () => {
      const dep = await create({ title: 'Dep' });
      const parent = await create({ title: 'Panel parent' });
      const task = await create({ title: 'Panel', description: 'p'.repeat(1000), parentId: parent.id, dependsOn: [dep.id] });
      await json(port, 'POST', tasksUrl(`/${task.id}/comments`), { author: 'dev', text: 'Hi', type: 'note' });
      await json(port, 'PUT', tasksUrl(`/${task.id}/attachments`), { attachments: [{ name: 'a.txt', type: 'text', content: 'heavy' }] });
      const res = await json(port, 'GET', tasksUrl(`/${task.id}?view=panel`));
      assert.equal(res.json.description.length, 1000);
      assert.equal(res.json.comments.length, 1);
      assert.equal(res.json.isBlocked, true);
      assert.equal(res.json.blockedByCount, 1);
      assert.deepEqual(res.json.parent, { id: parent.id, key: parent.key, title: 'Panel parent', type: 'feature' });
      assert.deepEqual(res.json.attachments, [{ name: 'a.txt', type: 'text' }]);
      assert.equal('children' in res.json, false);
    });

    test('?view=panel answers 304 when it did not change, and 404 once it is gone', async () => {
      const task = await create({ title: 'Going' });
      const first = await json(port, 'GET', tasksUrl(`/${task.id}?view=panel`));
      const again = await raw(port, 'GET', tasksUrl(`/${task.id}?view=panel`), { headers: { 'If-None-Match': first.headers.etag } });
      assert.equal(again.status, 304);
      assert.equal(again.body.length, 0);
      await json(port, 'DELETE', tasksUrl(`/${task.id}`));
      const gone = await json(port, 'GET', tasksUrl(`/${task.id}?view=panel`));
      assert.equal(gone.status, 404);
      assert.equal(gone.json.error.code, 'TASK_NOT_FOUND');
    });
  });
});

describe('who may read the board', () => {
  const board = '/api/v1/spaces/s1/board';

  test('anyone signed in, as with GET tasks', () => {
    for (const role of ['viewer', 'member', 'admin']) {
      assert.equal(mayRequest({ role }, 'GET', board), true, role);
      assert.equal(mayRequest({ role }, 'GET', '/api/v1/spaces/s1/tasks'), true, role);
    }
  });

  test('nobody writes to it but an admin, whom the route then refuses', () => {
    assert.equal(mayRequest({ role: 'viewer' }, 'POST', board), false);
    assert.equal(mayRequest({ role: 'member' }, 'POST', board), false);
  });

  test('an agent reads the board of its own space only', () => {
    const run = { spaceId: 's1', taskId: 't1', taskKey: null };
    assert.equal(runMayRequest(run, 'GET', board), true);
    assert.equal(runMayRequest(run, 'GET', '/api/v1/spaces/s2/board'), false);
  });

  test('a viewer really gets it, on a server with accounts', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-board-auth-'));
    const server = startServer({ port: 0, dataDir, silent: true });
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();
    try {
      const anonymous = await raw(port, 'GET', '/api/v1/spaces/default/board');
      assert.equal(anonymous.status, 401);

      const code = fs.readFileSync(path.join(dataDir, 'setup-code'), 'utf8').trim();
      const setup = await raw(port, 'POST', '/api/v1/auth/setup', {
        body: { name: 'Admin', email: 'admin@example.com', password: 'correct horse battery', setupCode: code },
      });
      assert.equal(setup.status, 201, setup.body.toString());
      const adminCookie = setup.headers['set-cookie'][0].split(';')[0];
      const invite = await json(port, 'POST', '/api/v1/invites', { email: 'viewer@example.com', role: 'viewer' }, { Cookie: adminCookie });
      assert.equal(invite.status, 201, JSON.stringify(invite.json));
      const token = invite.json.path.split('/').pop();
      const redeemed = await raw(port, 'POST', `/api/v1/auth/links/${token}`, { body: { name: 'Viewer', password: 'correct horse battery' } });
      assert.ok(redeemed.status < 300, redeemed.body.toString());
      const viewerCookie = redeemed.headers['set-cookie'][0].split(';')[0];

      const res = await json(port, 'GET', '/api/v1/spaces/default/board', undefined, { Cookie: viewerCookie });
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assert.ok(res.json.columns);
      const refused = await json(port, 'POST', '/api/v1/spaces/default/board', {}, { Cookie: viewerCookie });
      assert.equal(refused.status, 403);
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('the store does not read the whole space to draw a board', () => {
  test('nor does the database scan it: the column is read from the index, in order', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-board-plan-'));
    const store = createStore(dataDir);
    const Database = require('better-sqlite3');
    const db = new Database(path.join(dataDir, 'prism.db'), { readonly: true });
    try {
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
      for (const name of ['idx_tasks_board', 'idx_tasks_parent_column', 'idx_tasks_epics']) assert.ok(indexes.includes(name), name);
      const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM tasks t WHERE t.space_id = 'a' AND t.status_id = 'b'
        ORDER BY t.rank DESC, t.created_at DESC, t.rowid DESC LIMIT 50`).all().map((r) => r.detail).join(' ');
      assert.match(plan, /idx_tasks_board/);
      assert.doesNotMatch(plan, /TEMP B-TREE/);
    } finally {
      db.close();
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
