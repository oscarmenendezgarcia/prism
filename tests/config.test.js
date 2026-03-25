/**
 * Integration tests for the Config Editor API.
 * ADR-1 (Config Editor Panel): covers GET /api/v1/config/files,
 * GET /api/v1/config/files/:fileId, PUT /api/v1/config/files/:fileId.
 *
 * Strategy for filesystem isolation:
 *   - Global files: create temporary .md files in ~/.claude/ with a unique
 *     test prefix, then remove them in teardown. This avoids touching real
 *     config files while still exercising the real registry path.
 *   - Project file: the real CLAUDE.md at process.cwd() is read-only in
 *     these tests (we never write to it). Write tests use a global test file.
 *
 * Run with: node tests/config.test.js
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const http = require('http');
const { startTestServer } = require('./helpers/server');

// ---------------------------------------------------------------------------
// Minimal test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
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

function makeRequest(port) {
  return function request(method, urlPath, body) {
    return new Promise((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : undefined;
      const options = {
        hostname: 'localhost',
        port,
        path: urlPath,
        method,
        headers: {
          'Content-Type': 'application/json',
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
  };
}

// ---------------------------------------------------------------------------
// Test file setup: create temporary .md files in ~/.claude/
// ---------------------------------------------------------------------------

const CLAUDE_DIR       = path.join(os.homedir(), '.claude');
const TEST_FILE_PREFIX = 'prism-test-config-';
const TEST_FILE_NAME   = `${TEST_FILE_PREFIX}${Date.now()}.md`;
const TEST_FILE_PATH   = path.join(CLAUDE_DIR, TEST_FILE_NAME);

// Derived file ID: "global-prism-test-config-<timestamp>-md"
const TEST_STEM       = TEST_FILE_NAME.slice(0, -3); // strip ".md"
const TEST_KEBAB      = TEST_STEM.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const TEST_FILE_ID    = `global-${TEST_KEBAB}-md`;

const TEST_CONTENT    = '# Prism Test Config\n\nThis file is created by integration tests and will be removed.\n';
const UPDATED_CONTENT = '# Prism Test Config (updated)\n\nUpdated by PUT test.\n';

function setupTestFile() {
  if (!fs.existsSync(CLAUDE_DIR)) {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  }
  fs.writeFileSync(TEST_FILE_PATH, TEST_CONTENT, 'utf8');
}

function teardownTestFile() {
  try { fs.unlinkSync(TEST_FILE_PATH); } catch { /* already gone */ }
  // Also clean up any .tmp files left by a failed atomic write test.
  try { fs.unlinkSync(TEST_FILE_PATH + '.tmp'); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Main test runner
// ---------------------------------------------------------------------------

async function runTests() {
  setupTestFile();

  const { port, close } = await startTestServer();
  const request = makeRequest(port);

  try {
    // -----------------------------------------------------------------------
    // GET /api/v1/config/files — list
    // -----------------------------------------------------------------------
    suite('GET /api/v1/config/files — list config files');

    await test('returns 200 with a JSON array', async () => {
      const res = await request('GET', '/api/v1/config/files');
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(Array.isArray(res.body), 'Response body should be an array');
    });

    await test('array items have expected fields (id, name, scope, directory, sizeBytes, modifiedAt)', async () => {
      const res = await request('GET', '/api/v1/config/files');
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      for (const item of res.body) {
        assert(typeof item.id === 'string',        `item.id should be a string, got ${typeof item.id}`);
        assert(typeof item.name === 'string',      `item.name should be a string`);
        assert(item.scope === 'global' || item.scope === 'project' || item.scope === 'agent', `item.scope must be 'global', 'project', or 'agent'`);
        assert(typeof item.directory === 'string', `item.directory should be a string`);
        assert(typeof item.sizeBytes === 'number', `item.sizeBytes should be a number`);
        assert(typeof item.modifiedAt === 'string', `item.modifiedAt should be a string`);
      }
    });

    await test('includes the test file we created in ~/.claude/', async () => {
      const res = await request('GET', '/api/v1/config/files');
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const found = res.body.find((f) => f.id === TEST_FILE_ID);
      assert(found !== undefined, `Expected to find test file with id '${TEST_FILE_ID}'`);
      assert(found.scope === 'global',   `Expected scope=global, got ${found.scope}`);
      assert(found.directory === '~/.claude', `Expected directory='~/.claude', got ${found.directory}`);
    });

    await test('includes the project CLAUDE.md if it exists', async () => {
      const res = await request('GET', '/api/v1/config/files');
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const projectExists = fs.existsSync(path.join(process.cwd(), 'CLAUDE.md'));
      const projectFile   = res.body.find((f) => f.id === 'project-claude-md');
      if (projectExists) {
        assert(projectFile !== undefined, 'Expected project-claude-md to appear when CLAUDE.md exists');
        assert(projectFile.scope === 'project', `Expected scope=project, got ${projectFile.scope}`);
      }
      // If CLAUDE.md doesn't exist, it is simply omitted — no error expected.
    });

    await test('file IDs match pattern: (global|project)-[a-z0-9-]+-md', async () => {
      const res = await request('GET', '/api/v1/config/files');
      const idPattern = /^(global|project|agent)-[a-z0-9-]+-md$/;
      for (const item of res.body) {
        assert(idPattern.test(item.id), `ID '${item.id}' does not match expected pattern`);
      }
    });

    await test('global files come before project files (ordering)', async () => {
      const res = await request('GET', '/api/v1/config/files');
      const globalIdx  = res.body.findIndex((f) => f.scope === 'global');
      const projectIdx = res.body.findIndex((f) => f.scope === 'project');
      if (globalIdx !== -1 && projectIdx !== -1) {
        assert(globalIdx < projectIdx, 'Global files should appear before project files');
      }
    });

    // -----------------------------------------------------------------------
    // GET /api/v1/config/files/:fileId — read
    // -----------------------------------------------------------------------
    suite('GET /api/v1/config/files/:fileId — read file content');

    await test('returns 200 with content for the test file', async () => {
      const res = await request('GET', `/api/v1/config/files/${TEST_FILE_ID}`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.id === TEST_FILE_ID, `Expected id=${TEST_FILE_ID}`);
      assert(res.body.name === TEST_FILE_NAME, `Expected name=${TEST_FILE_NAME}`);
      assert(res.body.scope === 'global',   `Expected scope=global`);
      assert(typeof res.body.content === 'string', 'content should be a string');
      assert(res.body.content === TEST_CONTENT,     `Content mismatch: got '${res.body.content}'`);
      assert(typeof res.body.sizeBytes === 'number', 'sizeBytes should be a number');
      assert(typeof res.body.modifiedAt === 'string', 'modifiedAt should be a string');
    });

    await test('returns 404 for an unknown fileId', async () => {
      const res = await request('GET', '/api/v1/config/files/global-does-not-exist-md');
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(res.body.error, 'Response should have an error field');
      assert(res.body.error.code === 'FILE_NOT_FOUND', `Expected code=FILE_NOT_FOUND, got ${res.body.error.code}`);
    });

    await test('returns 404 for a fileId that looks valid but is not in registry', async () => {
      const res = await request('GET', '/api/v1/config/files/project-nonexistent-md');
      assert(res.status === 404, `Expected 404, got ${res.status}`);
    });

    await test('response does not contain a path field (security: no path disclosure)', async () => {
      const res = await request('GET', `/api/v1/config/files/${TEST_FILE_ID}`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(!('absPath' in res.body), 'absPath must not be exposed');
      assert(!('path' in res.body),    'path must not be exposed');
    });

    // -----------------------------------------------------------------------
    // PUT /api/v1/config/files/:fileId — write
    // -----------------------------------------------------------------------
    suite('PUT /api/v1/config/files/:fileId — write file content');

    await test('returns 200 and writes the new content atomically', async () => {
      const res = await request('PUT', `/api/v1/config/files/${TEST_FILE_ID}`, {
        content: UPDATED_CONTENT,
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.id === TEST_FILE_ID,          `Expected id=${TEST_FILE_ID}`);
      assert(res.body.name === TEST_FILE_NAME,       `Expected name=${TEST_FILE_NAME}`);
      assert(res.body.scope === 'global',            `Expected scope=global`);
      assert(typeof res.body.sizeBytes === 'number', 'sizeBytes should be a number');
      assert(typeof res.body.modifiedAt === 'string','modifiedAt should be a string');
      assert(!('content' in res.body),               'PUT response must not echo content');

      // Verify disk was updated.
      const onDisk = fs.readFileSync(TEST_FILE_PATH, 'utf8');
      assert(onDisk === UPDATED_CONTENT, `Disk content mismatch after PUT`);

      // Verify no .tmp file remains.
      assert(!fs.existsSync(TEST_FILE_PATH + '.tmp'), '.tmp file must be cleaned up after rename');
    });

    await test('saves empty string (clear file) — valid per spec', async () => {
      const res = await request('PUT', `/api/v1/config/files/${TEST_FILE_ID}`, { content: '' });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const onDisk = fs.readFileSync(TEST_FILE_PATH, 'utf8');
      assert(onDisk === '', 'File should be empty after writing empty string');

      // Restore content for subsequent tests.
      fs.writeFileSync(TEST_FILE_PATH, TEST_CONTENT, 'utf8');
    });

    await test('returns 404 for an unknown fileId', async () => {
      const res = await request('PUT', '/api/v1/config/files/global-does-not-exist-md', {
        content: 'hello',
      });
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(res.body.error.code === 'FILE_NOT_FOUND', `Expected FILE_NOT_FOUND`);
    });

    await test('returns 400 when content field is missing', async () => {
      const res = await request('PUT', `/api/v1/config/files/${TEST_FILE_ID}`, { other: 'field' });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', `Expected VALIDATION_ERROR, got ${res.body.error.code}`);
    });

    await test('returns 400 when content is not a string (number)', async () => {
      const res = await request('PUT', `/api/v1/config/files/${TEST_FILE_ID}`, { content: 42 });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', `Expected VALIDATION_ERROR, got ${res.body.error.code}`);
    });

    await test('returns 400 when content is not a string (object)', async () => {
      const res = await request('PUT', `/api/v1/config/files/${TEST_FILE_ID}`, { content: { nested: true } });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', `Expected VALIDATION_ERROR`);
    });

    await test('returns 400 when body is empty (no content field)', async () => {
      const res = await request('PUT', `/api/v1/config/files/${TEST_FILE_ID}`, {});
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', `Expected VALIDATION_ERROR`);
    });

    await test('returns 413 when content exceeds 1 MB', async () => {
      // 1 MB + 1 byte of content.
      const bigContent = 'x'.repeat(1024 * 1024 + 1);
      const res = await request('PUT', `/api/v1/config/files/${TEST_FILE_ID}`, { content: bigContent });
      assert(res.status === 413, `Expected 413, got ${res.status}`);
      assert(res.body.error.code === 'PAYLOAD_TOO_LARGE', `Expected PAYLOAD_TOO_LARGE, got ${res.body.error.code}`);
    });

    // -----------------------------------------------------------------------
    // Method validation
    // -----------------------------------------------------------------------
    suite('Method validation on config routes');

    await test('POST /api/v1/config/files returns 405', async () => {
      const res = await request('POST', '/api/v1/config/files', {});
      assert(res.status === 405, `Expected 405, got ${res.status}`);
    });

    await test('DELETE /api/v1/config/files/:fileId returns 405', async () => {
      const res = await request('DELETE', `/api/v1/config/files/${TEST_FILE_ID}`);
      assert(res.status === 405, `Expected 405, got ${res.status}`);
    });

  } finally {
    await close();
    teardownTestFile();
  }

  // ── Results ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailed tests:');
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  teardownTestFile();
  process.exit(1);
});
