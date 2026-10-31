'use strict';

/**
 * GET /spaces/:id/issues, the filters it shares with the board, and PATCH /tasks/bulk.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { startTestServer } = require('./helpers/server');
const { leastRole, runMayRequest } = require('../src/utils/permissions');

function call(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port, method, path: urlPath,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('the list of issues', () => {
  let server;
  let port;
  let spaceId;
  let epic;
  let other;
  let parent;
  let child;
  let bug;
  let done;
  let bare;

  const list = (query = '') => call(port, 'GET', `/api/v1/spaces/${spaceId}/issues${query}`);
  const titles = async (query) => {
    const res = await list(query);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return res.json.tasks.map((t) => t.title);
  };
  const bulk = (body) => call(port, 'PATCH', `/api/v1/spaces/${spaceId}/tasks/bulk`, body);
  const create = async (fields) => {
    const res = await call(port, 'POST', `/api/v1/spaces/${spaceId}/tasks`, { type: 'feature', ...fields });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    return res.json;
  };
  const get = async (id) => (await call(port, 'GET', `/api/v1/spaces/${spaceId}/tasks/${id}`)).json;

  before(async () => {
    server = await startTestServer();
    port = server.port;
    spaceId = (await call(port, 'POST', '/api/v1/spaces', { name: 'List', key: 'LST' })).json.id;
    epic = await create({ title: 'Checkout', type: 'epic' });
    other = await create({ title: 'Accounts', type: 'epic' });
    parent = await create({ title: 'Pay with card', parentId: epic.id, priority: 'urgent', assigned: 'opencode', labels: ['pay', 'web'], dueDate: '2020-01-01', estimate: 5 });
    child = await create({ title: 'Ñandú 100% done', parentId: parent.id, priority: 'low', labels: ['web'], dueDate: '2099-01-01', estimate: 1 });
    bug = await create({ title: 'Login_fails', type: 'bug', parentId: other.id, priority: 'high', assigned: 'claude' });
    done = await create({ title: 'Old thing', dueDate: '2020-01-01' });
    bare = await create({ title: 'Nothing set' });
    await call(port, 'PUT', `/api/v1/spaces/${spaceId}/tasks/${done.id}/move`, { to: 'done' });
  });

  after(() => server.close());

  describe('GET', () => {
    test('newest first, with what a row shows and without what weighs', async () => {
      const { json, headers } = await list();
      assert.equal(json.total, 7);
      assert.deepEqual(json.tasks.map((t) => t.number), [7, 6, 5, 4, 3, 2, 1]);
      const row = json.tasks.find((t) => t.id === child.id);
      assert.equal(row.epic.title, 'Checkout');
      assert.equal(row.parentKey, parent.key);
      assert.ok(!('description' in row));
      assert.ok(headers.etag);
    });

    test('a page, and the same total', async () => {
      const { json } = await list('?limit=2&offset=1&sort=key&dir=asc');
      assert.equal(json.total, 7);
      assert.deepEqual(json.tasks.map((t) => t.number), [2, 3]);
    });

    test('by each field, any of its values', async () => {
      assert.deepEqual(await titles('?status=done'), ['Old thing']);
      assert.deepEqual(await titles('?priority=urgent&priority=high'), ['Login_fails', 'Pay with card']);
      assert.deepEqual(await titles('?type=bug'), ['Login_fails']);
      assert.deepEqual(await titles('?assignee=opencode'), ['Pay with card']);
      assert.deepEqual(await titles('?label=pay'), ['Pay with card']);
      assert.deepEqual(await titles('?label=pay&label=web'), ['Ñandú 100% done', 'Pay with card']);
    });

    test('fields apply together', async () => {
      assert.deepEqual(await titles('?label=web&priority=low'), ['Ñandú 100% done']);
      assert.deepEqual(await titles('?label=web&type=bug'), []);
    });

    test('an empty assignee is having none, also next to names', async () => {
      const none = await titles('?assignee=');
      assert.ok(none.includes('Nothing set'));
      assert.ok(!none.includes('Pay with card'));
      const some = await titles('?assignee=&assignee=opencode');
      assert.ok(some.includes('Nothing set') && some.includes('Pay with card'));
    });

    test('an epic holds itself, its issues and their sub-tasks', async () => {
      assert.deepEqual(await titles(`?epic=${epic.id}`), ['Ñandú 100% done', 'Pay with card', 'Checkout']);
      assert.deepEqual(await titles('?epic='), ['Nothing set', 'Old thing']);
      assert.deepEqual(await titles(`?epic=${parent.id}`), [], 'not an epic');
    });

    test('dates, on the day of whoever asks', async () => {
      assert.deepEqual(await titles('?due=overdue'), ['Pay with card'], 'what is done is not overdue');
      assert.deepEqual(await titles('?due=week&today=2098-12-30'), ['Ñandú 100% done']);
      assert.deepEqual(await titles('?due=week&today=2098-12-20'), []);
      assert.ok((await titles('?due=none')).includes('Nothing set'));
    });

    test('text in the title, whatever its case, taken literally; and keys', async () => {
      assert.deepEqual(await titles('?q=%C3%91AND%C3%9A'), ['Ñandú 100% done']);
      assert.deepEqual(await titles('?q=100%25'), ['Ñandú 100% done']);
      assert.deepEqual(await titles('?q=_'), ['Login_fails']);
      assert.deepEqual(await titles(`?q=${parent.key}`), ['Pay with card']);
      assert.deepEqual(await titles(`?q=${parent.number}`), ['Pay with card']);
    });

    test('every order works, and what has no value goes last both ways', async () => {
      for (const sort of ['key', 'title', 'status', 'priority', 'assignee', 'type', 'epic', 'estimate', 'due', 'updated', 'created']) {
        for (const dir of ['asc', 'desc']) {
          const { status, json } = await list(`?sort=${sort}&dir=${dir}`);
          assert.equal(status, 200, sort);
          assert.equal(json.tasks.length, 7, sort);
        }
      }
      const up = (await list('?sort=estimate&dir=asc')).json.tasks.map((t) => t.estimate);
      assert.deepEqual(up.slice(0, 2), [1, 5]);
      const down = (await list('?sort=estimate&dir=desc')).json.tasks.map((t) => t.estimate);
      assert.deepEqual(down.slice(0, 2), [5, 1]);
      assert.deepEqual((await list('?sort=priority&dir=asc&limit=2')).json.tasks.map((t) => t.priority), ['urgent', 'high']);
    });

    test('statuses named like what objects have are statuses', async () => {
      const { status, json } = await list('?status=constructor&status=__proto__');
      assert.equal(status, 200);
      assert.equal(json.total, 0);
    });

    test('says what is wrong with a query', async () => {
      for (const query of ['?sort=rowid', '?dir=up', '?offset=-1', '?limit=0', '?limit=201', '?limit=a', '?priority=huge', '?type=x', '?due=soon', '?today=tomorrow', `?q=${'x'.repeat(201)}`]) {
        assert.equal((await list(query)).status, 400, query);
      }
    });

    test('ids of what matches, to select it all', async () => {
      const { status, json } = await list('?fields=id&sort=key&dir=asc&label=web');
      assert.equal(status, 200);
      assert.deepEqual(json, { ids: [parent.id, child.id], total: 2 });
    });

    test('only issues of the space', async () => {
      const elsewhere = (await call(port, 'POST', '/api/v1/spaces', { name: 'Else', key: 'ELS' })).json.id;
      const res = await call(port, 'GET', `/api/v1/spaces/${elsewhere}/issues?epic=${epic.id}`);
      assert.equal(res.json.total, 0);
      assert.equal((await call(port, 'GET', '/api/v1/spaces/nope/issues')).status, 404);
      assert.equal((await call(port, 'POST', `/api/v1/spaces/${spaceId}/issues`, {})).status, 405);
    });

    test('the labels in use', async () => {
      const res = await call(port, 'GET', `/api/v1/spaces/${spaceId}/issues/labels`);
      assert.deepEqual(res.json, { labels: ['pay', 'web'] });
    });
  });

  describe('the board takes the same filters', () => {
    const board = (query) => call(port, 'GET', `/api/v1/spaces/${spaceId}/board${query}`);

    test('cards and totals are of what matches', async () => {
      const { json } = await board('?label=web');
      assert.equal(json.columns.todo.total, 2);
      assert.deepEqual(json.columns.todo.tasks.map((t) => t.title).sort(), ['Pay with card', 'Ñandú 100% done']);
      assert.equal(json.columns.done.total, 0);
    });

    test('an epic, as before', async () => {
      const { json } = await board(`?epic=${epic.id}`);
      assert.equal(json.columns.todo.total, 3);
      assert.equal((await board(`?epic=${parent.id}`)).json.columns.todo.total, 0);
    });

    test('a card brought by id only if it matches', async () => {
      const { json } = await board(`?label=pay&include=${bare.id},${parent.id}&limits=todo:0`);
      assert.deepEqual(json.columns.todo.tasks.map((t) => t.id), [parent.id]);
    });

    test('and says what is wrong with them', async () => {
      assert.equal((await board('?priority=huge')).status, 400);
    });
  });

  describe('PATCH /tasks/bulk', () => {
    test('changes each issue and leaves it in its history', async () => {
      const a = await create({ title: 'Bulk a' });
      const b = await create({ title: 'Bulk b', labels: ['old', 'keep'] });
      const res = await bulk({ ids: [a.id, b.id], changes: { statusId: 'in-progress', priority: 'high', assigned: 'opencode', addLabels: ['new'], removeLabels: ['old'] } });
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assert.deepEqual(res.json, { updated: 2 });
      const after = await get(b.id);
      assert.equal(after.statusId, 'in-progress');
      assert.equal(after.priority, 'high');
      assert.equal(after.assigned, 'opencode');
      assert.deepEqual(after.labels, ['keep', 'new']);
      const { history } = (await call(port, 'GET', `/api/v1/spaces/${spaceId}/tasks/${b.id}/history`)).json;
      for (const field of ['status', 'priority', 'assigned', 'labels']) assert.ok(history.some((h) => h.field === field), field);
    });

    test('what already is as asked does not count, nor goes to the history', async () => {
      const a = await create({ title: 'Same', priority: 'low' });
      const before = (await call(port, 'GET', `/api/v1/spaces/${spaceId}/tasks/${a.id}/history`)).json.history.length;
      assert.deepEqual((await bulk({ ids: [a.id], changes: { priority: 'low', statusId: 'todo', removeLabels: ['none'] } })).json, { updated: 0 });
      assert.equal((await call(port, 'GET', `/api/v1/spaces/${spaceId}/tasks/${a.id}/history`)).json.history.length, before);
    });

    test('an empty assignee unassigns', async () => {
      const a = await create({ title: 'Unassign', assigned: 'opencode' });
      assert.equal((await bulk({ ids: [a.id], changes: { assigned: '' } })).status, 200);
      assert.equal((await get(a.id)).assigned, undefined);
    });

    test('all or none: one that is not there stops them all', async () => {
      const a = await create({ title: 'Stays', priority: 'low' });
      const res = await bulk({ ids: [a.id, 'nope'], changes: { priority: 'urgent' } });
      assert.equal(res.status, 404);
      assert.match(res.json.error.message, /nope/);
      assert.equal((await get(a.id)).priority, 'low');
    });

    test('an issue of another space is not there', async () => {
      const elsewhere = (await call(port, 'POST', '/api/v1/spaces', { name: 'Other', key: 'OTH' })).json.id;
      const foreign = (await call(port, 'POST', `/api/v1/spaces/${elsewhere}/tasks`, { title: 'Far', type: 'bug' })).json;
      assert.equal((await bulk({ ids: [foreign.id], changes: { priority: 'urgent' } })).status, 404);
    });

    test('too many labels on one stops them all, and says which', async () => {
      const a = await create({ title: 'Few', labels: ['a'] });
      const full = await create({ title: 'Full', labels: Array.from({ length: 20 }, (_, i) => `l${i}`) });
      const res = await bulk({ ids: [a.id, full.id], changes: { addLabels: ['more'] } });
      assert.equal(res.status, 400);
      assert.match(res.json.error.message, new RegExp(full.key));
      assert.deepEqual((await get(a.id)).labels, ['a']);
    });

    test('says what is wrong with a request', async () => {
      const a = await create({ title: 'Valid' });
      const wrong = [
        {}, { ids: [], changes: { priority: 'low' } }, { ids: 'x', changes: { priority: 'low' } }, { ids: [1], changes: { priority: 'low' } },
        { ids: [a.id] }, { ids: [a.id], changes: {} }, { ids: [a.id], changes: [] },
        { ids: [a.id], changes: { title: 'x' } }, { ids: [a.id], changes: { priority: 'huge' } },
        { ids: [a.id], changes: { statusId: 'nope' } }, { ids: [a.id], changes: { statusId: 'constructor' } },
        { ids: [a.id], changes: { assigned: 1 } }, { ids: [a.id], changes: { addLabels: 'x' } },
        { ids: [a.id], changes: { addLabels: ['a,b'] } },
        { ids: Array.from({ length: 501 }, (_, i) => `i${i}`), changes: { priority: 'low' } },
      ];
      for (const body of wrong) assert.equal((await bulk(body)).status, 400, JSON.stringify(body).slice(0, 80));
    });

    test('500 at once', async () => {
      const created = await Promise.all(Array.from({ length: 500 }, (_, i) => create({ title: `Many ${i}` })));
      const res = await bulk({ ids: created.map((t) => t.id), changes: { priority: 'low' } });
      assert.equal(res.status, 200);
      assert.equal(res.json.updated, 500);
    });
  });

  test('who may: members change several, agents only read', () => {
    assert.equal(leastRole('PATCH', '/api/v1/spaces/s/tasks/bulk'), 'member');
    assert.equal(leastRole('GET', '/api/v1/spaces/s/issues'), 'viewer');
    const run = { spaceId: 's', taskId: 't', taskKey: 'K-1' };
    assert.equal(runMayRequest(run, 'GET', '/api/v1/spaces/s/issues'), true);
    assert.equal(runMayRequest(run, 'GET', '/api/v1/spaces/s/issues/labels'), true);
    assert.equal(runMayRequest(run, 'GET', '/api/v1/spaces/other/issues'), false);
    assert.equal(runMayRequest(run, 'PATCH', '/api/v1/spaces/s/tasks/bulk'), false);
  });
});
