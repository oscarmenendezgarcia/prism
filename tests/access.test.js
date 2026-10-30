'use strict';

/**
 * Which requests may reach the server at all, before asking who makes them.
 * Run with: node --test tests/access.test.js
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const http   = require('http');
const os     = require('os');
const path   = require('path');


const { resolveAccess, isLoopback } = require('../src/utils/access');
const { startServer } = require('../server');

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

async function serve(options) {
  const dataDir = tmp();
  const server = startServer({ port: 0, dataDir, silent: true, auth: false, ...options });
  await new Promise((resolve) => server.once('listening', resolve));
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
  test('defaults to loopback', () => {
    assert.deepEqual(resolveAccess({ env: {} }), { host: '127.0.0.1', loopback: true });
  });

  test('PRISM_HOST sets the address', () => {
    assert.equal(resolveAccess({ env: { PRISM_HOST: 'localhost' } }).loopback, true);
    assert.deepEqual(resolveAccess({ env: { PRISM_HOST: '0.0.0.0' } }), { host: '0.0.0.0', loopback: false });
  });

  test('an ambient HOST, as conda exports, is ignored', () => {
    assert.equal(resolveAccess({ env: { HOST: 'x86_64-conda-linux-gnu' } }).host, '127.0.0.1');
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

  test('accepts local clients', async () => {
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

});

describe('server bound beyond loopback', () => {
  test('takes any Host, but still refuses a cross-site Origin', async () => {
    const s = await serve({ host: '0.0.0.0' });
    try {
      assert.equal(s.server.address().address, '0.0.0.0');
      assert.equal((await request(s.port, { headers: { Host: '192.168.1.32:3000' } })).status, 200);
      assert.equal((await request(s.port, { headers: { Origin: 'http://evil.example' } })).status, 403);
    } finally {
      await s.close();
    }
  });
});

describe('PRISM_TOKEN, from before there were accounts', () => {
  test('gives no access, as a header or in the address', async () => {
    process.env.PRISM_TOKEN = 'old-token';
    const dataDir = tmp();
    const server = startServer({ port: 0, dataDir, silent: true });
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();
    try {
      assert.equal((await request(port, { headers: { Authorization: 'Bearer old-token' } })).status, 401);
      const res = await request(port, { url: '/?token=old-token' });
      assert.equal(res.headers['set-cookie'], undefined);
      assert.notEqual(res.status, 302);
    } finally {
      delete process.env.PRISM_TOKEN;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
