'use strict';

/**
 * Who may reach the server: loopback by default, and a token for anything else.
 * Run with: node --test tests/access.test.js
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const http   = require('http');
const os     = require('os');
const path   = require('path');

const { WebSocket } = require('ws');

const { resolveAccess, isLoopback } = require('../src/utils/access');
const { startServer } = require('../server');
const { setupTerminalWebSocket } = require('../terminal');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prism-access-'));

/** Raw request, so the test controls Host, Origin and Cookie exactly. */
function request(port, { method = 'GET', url = '/api/v1/spaces', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function upgrade(port, headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal`, { headers });
    ws.on('open', () => { ws.terminate(); resolve('open'); });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.on('error', () => {});
  });
}

async function serve(options) {
  const dataDir = tmp();
  const server = startServer({ port: 0, dataDir, silent: true, agentsDir: path.join(dataDir, 'agents'), ...options });
  await new Promise((resolve) => server.once('listening', resolve));
  setupTerminalWebSocket(server);
  return {
    server,
    dataDir,
    port: server.address().port,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

describe('resolveAccess', () => {
  test('defaults to loopback with no token', () => {
    assert.deepEqual(resolveAccess({ dataDir: '/nowhere', env: {} }), { host: '127.0.0.1', token: null, generated: false });
  });

  test('PRISM_HOST on loopback still needs no token', () => {
    assert.equal(resolveAccess({ dataDir: '/nowhere', env: { PRISM_HOST: 'localhost' } }).token, null);
  });

  test('an ambient HOST, as conda exports, is ignored', () => {
    assert.equal(resolveAccess({ dataDir: '/nowhere', env: { HOST: 'x86_64-conda-linux-gnu' } }).host, '127.0.0.1');
  });

  test('a non-loopback host generates a token and keeps it private', () => {
    const dataDir = tmp();
    try {
      const first = resolveAccess({ dataDir, env: { PRISM_HOST: '0.0.0.0' } });
      assert.equal(first.generated, true);
      assert.ok(first.token.length >= 32);
      const file = path.join(dataDir, 'auth-token');
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      assert.equal(resolveAccess({ dataDir, env: { PRISM_HOST: '0.0.0.0' } }).token, first.token, 'must survive a restart');
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('PRISM_TOKEN wins and is never written to disk', () => {
    const dataDir = tmp();
    try {
      const access = resolveAccess({ dataDir, env: { PRISM_HOST: '0.0.0.0', PRISM_TOKEN: 'mine' } });
      assert.equal(access.token, 'mine');
      assert.ok(!fs.existsSync(path.join(dataDir, 'auth-token')));
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('isLoopback', () => {
    for (const host of ['localhost', '127.0.0.1', '127.0.0.2', '::1', '[::1]']) assert.ok(isLoopback(host), host);
    for (const host of ['0.0.0.0', '192.168.1.32', '::', 'evil.example', '127.evil.example']) assert.ok(!isLoopback(host), host);
  });
});

describe('default server', () => {
  let s;
  before(async () => { s = await serve(); });
  after(() => s.close());

  test('listens on loopback only', () => {
    assert.equal(s.server.address().address, '127.0.0.1');
  });

  test('accepts local clients with no credentials', async () => {
    assert.equal((await request(s.port)).status, 200);
    assert.equal((await request(s.port, { headers: { Host: `localhost:${s.port}` } })).status, 200);
  });

  test('refuses a rebound DNS name, even when it looks same-origin', async () => {
    const res = await request(s.port, { headers: { Host: 'evil.example', Origin: 'http://evil.example' } });
    assert.equal(res.status, 403);
    assert.equal(JSON.parse(res.body).error.code, 'FORBIDDEN_HOST');
  });

  test('refuses a cross-site request from another web page', async () => {
    const res = await request(s.port, {
      method:  'POST',
      headers: { Origin: 'http://evil.example', 'Content-Type': 'text/plain' },
      body:    '{"name":"pwned"}',
    });
    assert.equal(res.status, 403);
    assert.equal(JSON.parse(res.body).error.code, 'FORBIDDEN_ORIGIN');
  });

  test('accepts the app itself', async () => {
    const res = await request(s.port, { headers: { Host: `localhost:${s.port}`, Origin: `http://localhost:${s.port}` } });
    assert.equal(res.status, 200);
  });

  test('terminal refuses cross-site, rebound and Origin-less upgrades', async () => {
    assert.equal(await upgrade(s.port, { Origin: 'http://evil.example' }), 403);
    assert.equal(await upgrade(s.port, { Host: 'evil.example', Origin: 'http://evil.example' }), 403);
    assert.equal(await upgrade(s.port, {}), 403);
  });
});

describe('server with a token', () => {
  const TOKEN = 'test-token-value';
  let s;
  before(async () => {
    process.env.PRISM_TOKEN = TOKEN;
    s = await serve();
  });
  after(async () => {
    delete process.env.PRISM_TOKEN;
    await s.close();
  });

  test('refuses requests without it, including the frontend', async () => {
    assert.equal((await request(s.port)).status, 401);
    assert.equal((await request(s.port, { url: '/' })).status, 401);
    assert.equal((await request(s.port, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await request(s.port, { headers: { Cookie: 'prism_token=wrong' } })).status, 401);
  });

  test('accepts the bearer token from any Host', async () => {
    const res = await request(s.port, { headers: { Authorization: `Bearer ${TOKEN}`, Host: '192.168.1.32:3000' } });
    assert.equal(res.status, 200);
  });

  test('?token= sets an HttpOnly cookie and drops the token from the URL', async () => {
    const res = await request(s.port, { url: `/board?x=1&token=${TOKEN}` });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/board?x=1');
    const cookie = res.headers['set-cookie'][0];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);

    const pair = cookie.split(';')[0];
    assert.equal((await request(s.port, { headers: { Cookie: pair } })).status, 200);
  });

  test('a malformed request target is refused and does not crash the server', async () => {
    const res = await request(s.port, { url: '//[' });
    assert.equal(res.status, 401);
    assert.equal((await request(s.port, { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 200);
  });

  test('a wrong ?token= gets nothing', async () => {
    const res = await request(s.port, { url: '/?token=wrong' });
    assert.equal(res.status, 401);
    assert.equal(res.headers['set-cookie'], undefined);
  });

  test('a valid token does not excuse a cross-site Origin', async () => {
    const res = await request(s.port, { headers: { Authorization: `Bearer ${TOKEN}`, Origin: 'http://evil.example' } });
    assert.equal(res.status, 403);
  });

  test('the terminal requires it too', async () => {
    const origin = { Origin: `http://127.0.0.1:${s.port}` };
    assert.equal(await upgrade(s.port, origin), 403);
    assert.equal(await upgrade(s.port, { ...origin, Cookie: `prism_token=${TOKEN}` }), 'open');
  });
});

describe('server bound beyond loopback', () => {
  test('generates a token and hands it to the processes it spawns', async () => {
    delete process.env.PRISM_TOKEN;
    const s = await serve({ host: '0.0.0.0' });
    try {
      assert.equal(s.server.address().address, '0.0.0.0');
      const token = fs.readFileSync(path.join(s.dataDir, 'auth-token'), 'utf8').trim();
      assert.equal((await request(s.port)).status, 401);
      assert.equal((await request(s.port, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
      assert.equal(process.env.PRISM_TOKEN, token);
    } finally {
      delete process.env.PRISM_TOKEN;
      await s.close();
    }
  });
});
