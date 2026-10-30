/**
 * Integration tests for the working directory check.
 *
 * Covers:
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
