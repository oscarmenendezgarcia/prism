/**
 * Integration tests for the filesystem browser endpoints.
 *
 * Covers:
 *   GET  /api/v1/fs/home
 *   POST /api/v1/fs/browse
 *   POST /api/v1/fs/validate
 *
 * Each suite starts its own isolated server on a random port.
 * Run with: node tests/fs.test.js
 */

'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');
const http = require('http');
const { startTestServer } = require('./helpers/server');

// ---------------------------------------------------------------------------
// Minimal test runner
// ---------------------------------------------------------------------------

let passed   = 0;
let failed   = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
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
// HTTP helper
// ---------------------------------------------------------------------------

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const options = {
      hostname: 'localhost',
      port,
      path:     urlPath,
      method,
      headers:  {
        'Content-Type':   'application/json',
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

// ---------------------------------------------------------------------------
// GET /api/v1/fs/home
// ---------------------------------------------------------------------------

async function runHomeTests() {
  suite('GET /api/v1/fs/home');

  const { port, close } = await startTestServer();

  try {
    await test('returns 200 with homePath string', async () => {
      const res = await request(port, 'GET', '/api/v1/fs/home');
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(typeof res.body.homePath === 'string', 'homePath should be a string');
      assert(res.body.homePath.length > 0, 'homePath should not be empty');
      assert(path.isAbsolute(res.body.homePath), 'homePath should be absolute');
    });

    await test('homePath matches os.homedir()', async () => {
      const res = await request(port, 'GET', '/api/v1/fs/home');
      assert(res.body.homePath === os.homedir(), `expected ${os.homedir()}, got ${res.body.homePath}`);
    });

    await test('returns 405 for POST', async () => {
      const res = await request(port, 'POST', '/api/v1/fs/home', {});
      assert(res.status === 405, `expected 405, got ${res.status}`);
    });
  } finally {
    close();
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/fs/browse
// ---------------------------------------------------------------------------

async function runBrowseTests() {
  suite('POST /api/v1/fs/browse');

  const { port, close } = await startTestServer();

  // Create a temporary directory structure for testing
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-fs-test-'));
  fs.mkdirSync(path.join(tmpRoot, 'alpha'));
  fs.mkdirSync(path.join(tmpRoot, 'beta'));
  fs.mkdirSync(path.join(tmpRoot, 'gamma'));
  fs.writeFileSync(path.join(tmpRoot, 'file.txt'), 'content');
  fs.mkdirSync(path.join(tmpRoot, '.hidden-dir'));

  try {
    await test('lists subdirectories and excludes files', async () => {
      const res = await request(port, 'POST', '/api/v1/fs/browse', { path: tmpRoot });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(Array.isArray(res.body.items), 'items should be an array');
      const names = res.body.items.map((it) => it.name);
      assert(names.includes('alpha'), 'should include alpha');
      assert(names.includes('beta'), 'should include beta');
      assert(names.includes('gamma'), 'should include gamma');
      assert(!names.includes('file.txt'), 'should not include files');
    });

    await test('excludes hidden dirs by default', async () => {
      const res = await request(port, 'POST', '/api/v1/fs/browse', { path: tmpRoot });
      const names = res.body.items.map((it) => it.name);
      assert(!names.includes('.hidden-dir'), 'should not include .hidden-dir by default');
    });

    await test('includes hidden dirs when includeHidden is true', async () => {
      const res = await request(port, 'POST', '/api/v1/fs/browse', { path: tmpRoot, includeHidden: true });
      const names = res.body.items.map((it) => it.name);
      assert(names.includes('.hidden-dir'), 'should include .hidden-dir when includeHidden=true');
    });

    await test('items are sorted alphabetically', async () => {
      const res = await request(port, 'POST', '/api/v1/fs/browse', { path: tmpRoot });
      const names = res.body.items.map((it) => it.name);
      const sorted = [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      assert(JSON.stringify(names) === JSON.stringify(sorted), 'items should be alphabetically sorted');
    });

    await test('each item has required fields', async () => {
      const res = await request(port, 'POST', '/api/v1/fs/browse', { path: tmpRoot });
      for (const item of res.body.items) {
        assert(typeof item.name === 'string', 'item.name should be string');
        assert(item.type === 'dir' || item.type === 'symlink', `item.type should be dir or symlink, got ${item.type}`);
        assert(typeof item.isReadable === 'boolean', 'item.isReadable should be boolean');
        assert(typeof item.isAccessible === 'boolean', 'item.isAccessible should be boolean');
      }
    });

    await test('returns path in response', async () => {
      const res = await request(port, 'POST', '/api/v1/fs/browse', { path: tmpRoot });
      assert(res.body.path === tmpRoot, `expected path ${tmpRoot}, got ${res.body.path}`);
    });

    await test('expands ~ to home directory', async () => {
      const res = await request(port, 'POST', '/api/v1/fs/browse', { path: '~' });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.body.path === os.homedir(), `expected ${os.homedir()}, got ${res.body.path}`);
    });

    await test('returns 404 for non-existent directory', async () => {
      const res = await request(port, 'POST', '/api/v1/fs/browse', { path: '/nonexistent/path/xyz123' });
      assert(res.status === 404, `expected 404, got ${res.status}`);
    });

    await test('returns 400 when path is missing', async () => {
      const res = await request(port, 'POST', '/api/v1/fs/browse', {});
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test('returns 400 for relative path', async () => {
      const res = await request(port, 'POST', '/api/v1/fs/browse', { path: 'relative/path' });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test('returns 400 when path points to a file', async () => {
      const file = path.join(tmpRoot, 'file.txt');
      const res  = await request(port, 'POST', '/api/v1/fs/browse', { path: file });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test('returns 400 for empty path string', async () => {
      const res = await request(port, 'POST', '/api/v1/fs/browse', { path: '' });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test('returns 405 for GET', async () => {
      const res = await request(port, 'GET', '/api/v1/fs/browse');
      assert(res.status === 405, `expected 405, got ${res.status}`);
    });
  } finally {
    close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/fs/validate
// ---------------------------------------------------------------------------

async function runValidateTests() {
  suite('POST /api/v1/fs/validate');

  const { port, close } = await startTestServer();

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-validate-test-'));
  const subDir  = path.join(tmpRoot, 'subdir');
  fs.mkdirSync(subDir);

  try {
    await test('returns 200 with isValid=true for an accessible directory', async () => {
      const res = await request(port, 'POST', '/api/v1/fs/validate', { path: tmpRoot });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.body.isValid === true, 'isValid should be true');
      assert(res.body.path === tmpRoot, `expected path ${tmpRoot}`);
    });

    await test('resolves ~ to home directory', async () => {
      const res = await request(port, 'POST', '/api/v1/fs/validate', { path: '~' });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.body.path === os.homedir(), `expected home path ${os.homedir()}`);
    });

    await test('returns 404 for non-existent path', async () => {
      const res = await request(port, 'POST', '/api/v1/fs/validate', { path: '/nonexistent/xyz123' });
      assert(res.status === 404, `expected 404, got ${res.status}`);
    });

    await test('returns 400 when path is missing', async () => {
      const res = await request(port, 'POST', '/api/v1/fs/validate', {});
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test('returns 400 for relative path', async () => {
      const res = await request(port, 'POST', '/api/v1/fs/validate', { path: 'not/absolute' });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test('returns 400 when path points to a file', async () => {
      const file = path.join(tmpRoot, 'afile.txt');
      fs.writeFileSync(file, 'hi');
      const res = await request(port, 'POST', '/api/v1/fs/validate', { path: file });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test('returns 405 for GET', async () => {
      const res = await request(port, 'GET', '/api/v1/fs/validate');
      assert(res.status === 405, `expected 405, got ${res.status}`);
    });
  } finally {
    close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('Filesystem browser endpoint tests\n');

  await runHomeTests();
  await runBrowseTests();
  await runValidateTests();

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.error('\nFailed tests:');
    for (const f of failures) {
      console.error(`  - ${f.name}: ${f.error}`);
    }
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
