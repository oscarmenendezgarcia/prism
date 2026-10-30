'use strict';

/**
 * Accounts: the first admin, signing in, sessions, invitations and reset links.
 * Run with: node --test tests/accounts.test.js
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs     = require('fs');
const http   = require('http');
const os     = require('os');
const path   = require('path');

const { startServer } = require('../server');
const { createStore } = require('../src/services/store');

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
        try { json = JSON.parse(data); } catch { /* the frontend, say */ }
        resolve({ status: res.statusCode, headers: res.headers, json, cookie: res.headers['set-cookie']?.[0]?.split(';')[0], raw: res.headers['set-cookie']?.[0] });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function serve(options) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-accounts-'));
  const server = startServer({ port: 0, dataDir, silent: true, ...options });
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return {
    port, dataDir, server,
    call: (...args) => call(port, ...args),
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      server._store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

const ADMIN = { name: 'Ana López', email: 'Ana@Example.com', password: PASSWORD };

describe('first run', () => {
  let s;
  before(async () => { s = await serve(); });
  after(() => s.close());

  test('says it needs an admin, and asks no code on loopback', async () => {
    const { json } = await s.call('GET', '/api/v1/auth/status');
    assert.deepEqual(json, { needsSetup: true, setupCodeRequired: false, user: null });
  });

  test('refuses a weak or incomplete account', async () => {
    for (const body of [
      { ...ADMIN, password: 'short' },
      { ...ADMIN, password: 'x'.repeat(201) },
      { ...ADMIN, email: 'nope' },
      { ...ADMIN, name: '  ' },
      { ...ADMIN, name: 'x'.repeat(51) },
      { ...ADMIN, password: 1234567890123 },
    ]) {
      assert.equal((await s.call('POST', '/api/v1/auth/setup', { body })).status, 400, JSON.stringify(body));
    }
  });

  test('makes the admin and signs them in', async () => {
    const res = await s.call('POST', '/api/v1/auth/setup', { body: ADMIN });
    assert.equal(res.status, 201);
    assert.equal(res.json.user.role, 'admin');
    assert.equal(res.json.user.email, 'ana@example.com');
    assert.equal(res.json.user.password_hash, undefined);
    assert.match(res.raw, /HttpOnly/);
    assert.match(res.raw, /SameSite=Lax/);
    const status = await s.call('GET', '/api/v1/auth/status', { cookie: res.cookie });
    assert.equal(status.json.needsSetup, false);
    assert.equal(status.json.user.name, 'Ana López');
  });

  test('cannot happen twice', async () => {
    const res = await s.call('POST', '/api/v1/auth/setup', { body: { ...ADMIN, email: 'eve@example.com' } });
    assert.equal(res.status, 409);
  });

  test('two at once make one admin', async () => {
    const other = await serve();
    try {
      const results = await Promise.all(['a', 'b', 'c'].map((n) => other.call('POST', '/api/v1/auth/setup', { body: { ...ADMIN, email: `${n}@example.com` } })));
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
    } finally {
      await other.close();
    }
  });

  test('stores no password or session in the clear', () => {
    const db = new (require('better-sqlite3'))(path.join(s.dataDir, 'prism.db'), { readonly: true });
    const dump = JSON.stringify(db.prepare('SELECT * FROM users').all()) + JSON.stringify(db.prepare('SELECT * FROM sessions').all());
    db.close();
    assert.ok(!dump.includes(PASSWORD));
    assert.match(dump, /scrypt\$/);
  });
});

describe('a server others can reach', () => {
  test('asks the code in its log for the first account', async () => {
    const logged = [];
    const log = console.log;
    console.log = (line) => logged.push(String(line));
    let s;
    try {
      s = await serve({ host: '0.0.0.0' });
    } finally {
      console.log = log;
    }
    try {
      const code = logged.join('\n').match(/Setup code for the first account: (\w+)/)?.[1];
      assert.ok(code, 'the code is in the log');
      assert.equal((await s.call('GET', '/api/v1/auth/status')).json.setupCodeRequired, true);
      assert.equal((await s.call('POST', '/api/v1/auth/setup', { body: ADMIN })).status, 403);
      assert.equal((await s.call('POST', '/api/v1/auth/setup', { body: { ...ADMIN, setupCode: 'wrong' } })).status, 403);
      assert.equal((await s.call('POST', '/api/v1/auth/setup', { body: { ...ADMIN, setupCode: code } })).status, 201);
    } finally {
      await s.close();
    }
  });
});

describe('every route needs someone', () => {
  let s;
  before(async () => { s = await serve(); });
  after(() => s.close());

  const ROUTES = [
    ['GET', '/api/v1/spaces'], ['POST', '/api/v1/spaces'], ['PUT', '/api/v1/spaces/x'], ['DELETE', '/api/v1/spaces/x'],
    ['GET', '/api/v1/spaces/x/tasks'], ['POST', '/api/v1/spaces/x/tasks'], ['DELETE', '/api/v1/spaces/x/tasks'],
    ['PUT', '/api/v1/spaces/x/tasks/y'], ['DELETE', '/api/v1/spaces/x/tasks/y'], ['PUT', '/api/v1/spaces/x/tasks/y/move'],
    ['GET', '/api/v1/spaces/x/tasks/y/attachments/0'], ['PUT', '/api/v1/spaces/x/tasks/y/attachments'],
    ['GET', '/api/v1/spaces/x/tasks/y/comments'], ['POST', '/api/v1/spaces/x/tasks/y/comments'],
    ['PATCH', '/api/v1/spaces/x/tasks/y/comments/z'], ['GET', '/api/v1/spaces/x/tasks/y/history'],
    ['POST', '/api/v1/spaces/x/tasks/y/run'], ['POST', '/api/v1/spaces/x/tasks/y/request-changes'],
    ['POST', '/api/v1/spaces/x/tasks/y/close'], ['POST', '/api/v1/spaces/x/tasks/y/pr'],
    ['GET', '/api/v1/spaces/x/task-runs'], ['PUT', '/api/v1/spaces/x/hooks'], ['PUT', '/api/v1/spaces/x/statuses'],
    ['GET', '/api/v1/runs/x/diff'], ['GET', '/api/v1/runs/x/log'], ['POST', '/api/v1/runs/x/stop'], ['POST', '/api/v1/runs/x/resume'],
    ['POST', '/api/v1/fs/validate'], ['GET', '/api/v1/tasks'], ['GET', '/api/v1/tasks/search?q=a'], ['GET', '/api/v1/issues/WEB-1'],
    ['GET', '/api/v1/harnesses'], ['GET', '/api/v1/users'], ['GET', '/api/v1/invites'], ['POST', '/api/v1/invites'],
    ['DELETE', '/api/v1/invites/x'], ['POST', '/api/v1/users/x/reset-link'],
    ['GET', '/api/v1/nothing-here'], ['GET', '/api/v2/spaces'], ['GET', '/api/'],
  ];

  for (const [method, url] of ROUTES) {
    test(`${method} ${url}`, async () => {
      const res = await s.call(method, url, { body: method === 'GET' ? undefined : {} });
      assert.equal(res.status, 401);
      assert.equal(res.json.error.code, 'UNAUTHENTICATED');
    });
  }

  test('a made-up session and an old token count for nothing', async () => {
    assert.equal((await s.call('GET', '/api/v1/spaces', { cookie: `prism_session_${s.port}=made-up` })).status, 401);
    assert.equal((await s.call('GET', '/api/v1/spaces', { headers: { 'X-Prism-Actor': 'admin', Authorization: 'Bearer x' } })).status, 401);
  });

  test('the frontend itself stays public, to show the sign-in page', async () => {
    const res = await s.call('GET', '/');
    assert.notEqual(res.status, 401);
  });
});

describe('signing in and out', () => {
  let s;
  before(async () => {
    s = await serve();
    await s.call('POST', '/api/v1/auth/setup', { body: ADMIN });
  });
  after(() => s.close());

  test('a right password gets a session, whatever the case of the email', async () => {
    const res = await s.call('POST', '/api/v1/auth/login', { body: { email: 'ANA@example.com ', password: PASSWORD } });
    assert.equal(res.status, 200);
    assert.equal((await s.call('GET', '/api/v1/spaces', { cookie: res.cookie })).status, 200);
  });

  test('a wrong password and an unknown email get the same answer', async () => {
    const wrong = await s.call('POST', '/api/v1/auth/login', { body: { email: 'ana@example.com', password: 'wrong wrong wrong' } });
    const unknown = await s.call('POST', '/api/v1/auth/login', { body: { email: 'nobody@example.com', password: 'wrong wrong wrong' } });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.json, unknown.json);
    assert.equal(wrong.cookie, undefined);
  });

  test('a body that is not what it should be does not crash', async () => {
    for (const body of [{}, { email: 1, password: {} }, null, []]) {
      assert.equal((await s.call('POST', '/api/v1/auth/login', { body })).status, 401, JSON.stringify(body));
    }
  });

  test('signing out ends that session only', async () => {
    const one = await s.call('POST', '/api/v1/auth/login', { body: { email: 'ana@example.com', password: PASSWORD } });
    const two = await s.call('POST', '/api/v1/auth/login', { body: { email: 'ana@example.com', password: PASSWORD } });
    const out = await s.call('POST', '/api/v1/auth/logout', { cookie: one.cookie });
    assert.equal(out.status, 200);
    assert.match(out.raw, /Max-Age=0/);
    assert.equal((await s.call('GET', '/api/v1/spaces', { cookie: one.cookie })).status, 401);
    assert.equal((await s.call('GET', '/api/v1/spaces', { cookie: two.cookie })).status, 200);
  });

  test('a session from another port does not count', async () => {
    const one = await s.call('POST', '/api/v1/auth/login', { body: { email: 'ana@example.com', password: PASSWORD } });
    const elsewhere = one.cookie.replace(`prism_session_${s.port}`, 'prism_session_1');
    assert.equal((await s.call('GET', '/api/v1/spaces', { cookie: elsewhere })).status, 401);
  });

  test('a cross-site sign-in is refused', async () => {
    const res = await s.call('POST', '/api/v1/auth/login', { body: { email: 'ana@example.com', password: PASSWORD }, headers: { Origin: 'http://evil.example' } });
    assert.equal(res.status, 403);
  });

  test('too many failures stop further tries, even with the right password', async () => {
    const email = 'ana@example.com';
    let last;
    for (let i = 0; i < 10; i++) last = await s.call('POST', '/api/v1/auth/login', { body: { email, password: 'wrong wrong wrong' } });
    assert.equal(last.status, 401);
    const blocked = await s.call('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD } });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers['retry-after']);
    // Another email is not affected.
    assert.equal((await s.call('POST', '/api/v1/auth/login', { body: { email: 'nobody@example.com', password: 'x' } })).status, 401);
  });
});

describe('sessions over time', () => {
  test('an expired one is refused, and a used one is renewed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-sessions-'));
    const store = createStore(dir);
    try {
      const user = await store.accounts.createFirstAdmin({ email: 'a@b.c', name: 'A', password: PASSWORD });
      const { token, expiresAt } = store.accounts.createSession(user.id);
      assert.ok(Date.parse(expiresAt) > Date.now() + 29 * 24 * 3600 * 1000);
      assert.equal(store.accounts.userForSession(token).id, user.id);

      const db = new (require('better-sqlite3'))(path.join(dir, 'prism.db'));
      const hours = (n) => new Date(Date.now() + n * 3600 * 1000).toISOString();
      db.prepare('UPDATE sessions SET used_at = ?, expires_at = ?').run(hours(-2), hours(1));
      assert.equal(store.accounts.userForSession(token).id, user.id);
      const renewed = db.prepare('SELECT expires_at FROM sessions').get().expires_at;
      assert.ok(Date.parse(renewed) > Date.now() + 29 * 24 * 3600 * 1000);

      db.prepare('UPDATE sessions SET expires_at = ?').run(hours(-1));
      assert.equal(store.accounts.userForSession(token), null);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
      db.close();
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('invitations', () => {
  let s, admin, member;
  before(async () => {
    s = await serve();
    admin = (await s.call('POST', '/api/v1/auth/setup', { body: ADMIN })).cookie;
  });
  after(() => s.close());

  const invite = (body, cookie = admin) => s.call('POST', '/api/v1/invites', { body, cookie });
  const tokenOf = (res) => res.json.path.split('/').pop();

  test('only a valid email and role', async () => {
    assert.equal((await invite({ email: 'nope', role: 'member' })).status, 400);
    assert.equal((await invite({ email: 'a@b.c', role: 'owner' })).status, 400);
    assert.equal((await invite({ email: 'ana@example.com', role: 'member' })).status, 409);
  });

  test('a link makes the account, with the role it was given, and works once', async () => {
    const res = await invite({ email: 'Bea@example.com', role: 'member' });
    assert.equal(res.status, 201);
    const token = tokenOf(res);

    const seen = await s.call('GET', `/api/v1/auth/links/${token}`);
    assert.deepEqual(seen.json, { kind: 'invite', email: 'bea@example.com', role: 'member', createdBy: 'Ana López' });

    assert.equal((await s.call('POST', `/api/v1/auth/links/${token}`, { body: { name: 'Bea', password: 'short' } })).status, 400);
    assert.equal((await s.call('POST', `/api/v1/auth/links/${token}`, { body: { password: PASSWORD } })).status, 400);

    const used = await s.call('POST', `/api/v1/auth/links/${token}`, { body: { name: 'Bea Ruiz', password: PASSWORD, role: 'admin', email: 'x@y.z' } });
    assert.equal(used.status, 200);
    assert.equal(used.json.user.role, 'member');
    assert.equal(used.json.user.email, 'bea@example.com');
    member = used.cookie;
    assert.equal((await s.call('GET', '/api/v1/spaces', { cookie: member })).status, 200);

    assert.equal((await s.call('GET', `/api/v1/auth/links/${token}`)).status, 404);
    assert.equal((await s.call('POST', `/api/v1/auth/links/${token}`, { body: { name: 'Eve', password: PASSWORD } })).status, 404);
  });

  test('two at once make one account', async () => {
    const token = tokenOf(await invite({ email: 'race@example.com', role: 'viewer' }));
    const results = await Promise.all([1, 2, 3].map(() => s.call('POST', `/api/v1/auth/links/${token}`, { body: { name: 'R', password: PASSWORD } })));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
  });

  test('a member can list people but not invite', async () => {
    const list = await s.call('GET', '/api/v1/users', { cookie: member });
    assert.equal(list.status, 200);
    assert.ok(list.json.some((u) => u.email === 'bea@example.com'));
    assert.ok(list.json.every((u) => u.password_hash === undefined));
    assert.equal((await invite({ email: 'c@d.e', role: 'admin' }, member)).status, 403);
    assert.equal((await s.call('GET', '/api/v1/invites', { cookie: member })).status, 403);
    assert.equal((await s.call('DELETE', '/api/v1/invites/x', { cookie: member })).status, 403);
    assert.equal((await s.call('POST', `/api/v1/users/x/reset-link`, { cookie: member })).status, 403);
  });

  test('a new invite replaces the earlier one, and an invite can be cancelled', async () => {
    const first = await invite({ email: 'dani@example.com', role: 'member' });
    const second = await invite({ email: 'dani@example.com', role: 'viewer' });
    assert.equal((await s.call('GET', `/api/v1/auth/links/${tokenOf(first)}`)).status, 404);
    const listed = await s.call('GET', '/api/v1/invites', { cookie: admin });
    const mine = listed.json.filter((i) => i.email === 'dani@example.com');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].token, undefined);
    assert.equal((await s.call('DELETE', `/api/v1/invites/${second.json.id}`, { cookie: admin })).status, 200);
    assert.equal((await s.call('GET', `/api/v1/auth/links/${tokenOf(second)}`)).status, 404);
    assert.equal((await s.call('DELETE', `/api/v1/invites/${second.json.id}`, { cookie: admin })).status, 404);
  });

  test('an expired link does not work', async () => {
    const token = tokenOf(await invite({ email: 'late@example.com', role: 'member' }));
    const db = new (require('better-sqlite3'))(path.join(s.dataDir, 'prism.db'));
    db.prepare(`UPDATE account_links SET expires_at = '2020-01-01T00:00:00.000Z' WHERE email = 'late@example.com'`).run();
    db.close();
    assert.equal((await s.call('GET', `/api/v1/auth/links/${token}`)).status, 404);
    assert.equal((await s.call('POST', `/api/v1/auth/links/${token}`, { body: { name: 'L', password: PASSWORD } })).status, 404);
  });

  test('a made-up link gets nowhere', async () => {
    assert.equal((await s.call('GET', '/api/v1/auth/links/made-up')).status, 404);
  });
});

describe('reset links', () => {
  let s, admin, userId;
  before(async () => {
    s = await serve();
    const res = await s.call('POST', '/api/v1/auth/setup', { body: ADMIN });
    admin = res.cookie;
    userId = res.json.user.id;
  });
  after(() => s.close());

  test('change the password, end every session, and work once', async () => {
    const created = await s.call('POST', `/api/v1/users/${userId}/reset-link`, { cookie: admin });
    assert.equal(created.status, 201);
    const token = created.json.path.split('/').pop();
    assert.equal((await s.call('GET', `/api/v1/auth/links/${token}`)).json.kind, 'reset');

    const NEW = 'a brand new password';
    const used = await s.call('POST', `/api/v1/auth/links/${token}`, { body: { password: NEW } });
    assert.equal(used.status, 200);
    assert.equal(used.json.user.role, 'admin');

    assert.equal((await s.call('GET', '/api/v1/spaces', { cookie: admin })).status, 401);
    assert.equal((await s.call('GET', '/api/v1/spaces', { cookie: used.cookie })).status, 200);
    assert.equal((await s.call('POST', '/api/v1/auth/login', { body: { email: ADMIN.email, password: PASSWORD } })).status, 401);
    assert.equal((await s.call('POST', '/api/v1/auth/login', { body: { email: ADMIN.email, password: NEW } })).status, 200);
    assert.equal((await s.call('POST', `/api/v1/auth/links/${token}`, { body: { password: NEW } })).status, 404);
  });

  test('for someone who does not exist', async () => {
    const login = await s.call('POST', '/api/v1/auth/login', { body: { email: ADMIN.email, password: 'a brand new password' } });
    assert.equal((await s.call('POST', '/api/v1/users/nobody/reset-link', { cookie: login.cookie })).status, 404);
  });
});

describe('prism reset-password', () => {
  const cli = path.join(__dirname, '..', 'bin', 'cli.js');
  const env = { ...process.env, PRISM_NO_UPDATE_CHECK: '1' };
  const run = (...args) => execFileSync('node', [cli, 'reset-password', ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  test('prints a link that works, and only the link', async () => {
    const s = await serve();
    try {
      await s.call('POST', '/api/v1/auth/setup', { body: ADMIN });
      const out = run('ana@example.com', '--data-dir', s.dataDir);
      assert.ok(!out.includes('[store]'));
      const token = out.match(/\/reset\/([\w-]+)/)[1];
      assert.equal((await s.call('POST', `/api/v1/auth/links/${token}`, { body: { password: 'a brand new password' } })).status, 200);
    } finally {
      await s.close();
    }
  });

  test('says so if there is no such account or no database', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-cli-'));
    try {
      assert.throws(() => run('a@b.c', '--data-dir', dir), /no database/);
      createStore(dir).close();
      assert.throws(() => run('a@b.c', '--data-dir', dir), /no active account/);
      assert.throws(() => run('--data-dir', dir), /Usage/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('upgrading a database', () => {
  test('keeps its data, keeps a copy, and adds accounts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-upgrade-'));
    try {
      const first = createStore(dir);
      first.close();
      const db = new (require('better-sqlite3'))(path.join(dir, 'prism.db'));
      db.exec('DROP TABLE account_links; DROP TABLE sessions; DROP TABLE users;');
      db.pragma('user_version = 3');
      db.prepare(`UPDATE spaces SET name = 'Kept'`).run();
      db.close();

      const store = createStore(dir);
      assert.equal(store.listSpaces().every((sp) => sp.name === 'Kept'), true);
      assert.equal(store.accounts.hasUsers(), false);
      store.close();
      assert.ok(fs.existsSync(path.join(dir, 'prism.db.before-v4')));
      const after = new (require('better-sqlite3'))(path.join(dir, 'prism.db'), { readonly: true });
      assert.equal(after.pragma('user_version', { simple: true }), 4);
      after.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
