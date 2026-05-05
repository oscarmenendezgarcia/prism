'use strict';

/**
 * Unit tests for src/handlers/static.js
 *
 * Covers:
 *  - When dist/index.html is absent → HTTP 404 with { error, hint } JSON
 *  - When dist/index.html is present → HTML served for SPA routes
 *  - Path traversal → HTTP 403
 *  - Unknown asset extension → HTTP 404 (generic)
 *
 * Run with: node tests/static-handler.test.js
 *
 * The tests manipulate dist/index.html directly using a backup/restore
 * strategy so the real build output is never permanently altered.
 */

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Minimal test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual(actual, expected, label) {
  assert(actual === expected, `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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
// Mock HTTP response
// ---------------------------------------------------------------------------

function makeMockRes() {
  const res = {
    statusCode:  null,
    headers:     {},
    body:        null,
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers    = headers || {};
    },
    end(data) {
      this.body = data;
    },
  };
  return res;
}

function makeMockReq(url) {
  return { url };
}

// ---------------------------------------------------------------------------
// dist/index.html management
// ---------------------------------------------------------------------------

const DIST_DIR   = path.join(__dirname, '..', 'dist');
const INDEX_PATH = path.join(DIST_DIR, 'index.html');
const BACKUP_PATH = path.join(DIST_DIR, 'index.html.__test_backup__');

function hideIndex() {
  if (fs.existsSync(INDEX_PATH)) {
    fs.renameSync(INDEX_PATH, BACKUP_PATH);
  }
  // Bust the module cache so fresh existsSync calls reflect the change
  // (the handler calls fs.existsSync at request time — no caching needed here).
}

function restoreIndex() {
  if (fs.existsSync(BACKUP_PATH)) {
    fs.renameSync(BACKUP_PATH, INDEX_PATH);
  }
}

function ensureDistDir() {
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }
}

function createMinimalIndex() {
  ensureDistDir();
  fs.writeFileSync(INDEX_PATH, '<!DOCTYPE html><html><body>Prism</body></html>');
}

// ---------------------------------------------------------------------------
// Import the handler (after helpers are defined so we can call them)
// ---------------------------------------------------------------------------

const { handleStatic } = require('../src/handlers/static');

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

async function runTests() {

  // -------------------------------------------------------------------------
  suite('UI not available (dist/index.html missing)');
  // -------------------------------------------------------------------------

  await test('should_return_404_with_ui_not_available_for_root_when_index_missing', async () => {
    hideIndex();
    try {
      const req = makeMockReq('/');
      const res = makeMockRes();
      handleStatic(req, res);
      assertEqual(res.statusCode, 404, 'status');
      const body = JSON.parse(res.body);
      assertEqual(body.error, 'UI not available', 'error field');
      assert(typeof body.hint === 'string' && body.hint.length > 0, 'hint is a non-empty string');
      assert(body.hint.includes('npm install'), 'hint mentions npm install');
    } finally {
      restoreIndex();
    }
  });

  await test('should_return_404_with_ui_not_available_for_spa_route_when_index_missing', async () => {
    hideIndex();
    try {
      const req = makeMockReq('/tasks');
      const res = makeMockRes();
      handleStatic(req, res);
      assertEqual(res.statusCode, 404, 'status');
      const body = JSON.parse(res.body);
      assertEqual(body.error, 'UI not available', 'error field');
    } finally {
      restoreIndex();
    }
  });

  await test('should_return_404_with_ui_not_available_for_asset_request_when_index_missing', async () => {
    hideIndex();
    try {
      const req = makeMockReq('/assets/app.js');
      const res = makeMockRes();
      handleStatic(req, res);
      assertEqual(res.statusCode, 404, 'status');
      const body = JSON.parse(res.body);
      assertEqual(body.error, 'UI not available', 'error field');
    } finally {
      restoreIndex();
    }
  });

  await test('should_include_hint_with_prism_kanban_package_name', async () => {
    hideIndex();
    try {
      const req = makeMockReq('/');
      const res = makeMockRes();
      handleStatic(req, res);
      const body = JSON.parse(res.body);
      assert(body.hint.includes('prism-kanban'), 'hint mentions prism-kanban package');
    } finally {
      restoreIndex();
    }
  });

  await test('should_respond_with_json_content_type_when_index_missing', async () => {
    hideIndex();
    try {
      const req = makeMockReq('/');
      const res = makeMockRes();
      handleStatic(req, res);
      assert(
        res.headers['Content-Type'] && res.headers['Content-Type'].includes('application/json'),
        'Content-Type is application/json',
      );
    } finally {
      restoreIndex();
    }
  });

  // -------------------------------------------------------------------------
  suite('UI available (dist/index.html present)');
  // -------------------------------------------------------------------------

  // Guard: ensure index.html exists before running these tests.
  // If the real build is missing we create a minimal placeholder.
  const hadIndex = fs.existsSync(INDEX_PATH);
  if (!hadIndex) createMinimalIndex();

  await test('should_serve_200_html_for_root_when_index_present', async () => {
    const req = makeMockReq('/');
    const res = makeMockRes();
    handleStatic(req, res);
    assertEqual(res.statusCode, 200, 'status');
    assert(
      res.headers['Content-Type'] && res.headers['Content-Type'].includes('text/html'),
      'Content-Type is text/html',
    );
  });

  await test('should_serve_200_html_for_spa_route_when_index_present', async () => {
    const req = makeMockReq('/spaces/abc-123');
    const res = makeMockRes();
    handleStatic(req, res);
    assertEqual(res.statusCode, 200, 'status');
  });

  await test('should_return_404_for_unknown_asset_extension_when_ui_present', async () => {
    const req = makeMockReq('/nonexistent-asset.wasm');
    const res = makeMockRes();
    handleStatic(req, res);
    assertEqual(res.statusCode, 404, 'status');
    // Generic 404 — not the "UI not available" response
    const body = JSON.parse(res.body);
    assert(body.error !== 'UI not available', 'should not be "UI not available" when UI is installed');
  });

  // Clean up the placeholder if we created it
  if (!hadIndex && fs.existsSync(INDEX_PATH)) {
    fs.unlinkSync(INDEX_PATH);
  }

  // -------------------------------------------------------------------------
  suite('Path traversal protection');
  // -------------------------------------------------------------------------

  // Ensure index exists so we reach the traversal check
  if (!fs.existsSync(INDEX_PATH)) createMinimalIndex();
  const createdForTraversal = !hadIndex;

  await test('should_return_403_for_path_traversal_attempt', async () => {
    const req = makeMockReq('/../../../etc/passwd');
    const res = makeMockRes();
    handleStatic(req, res);
    assertEqual(res.statusCode, 403, 'status');
  });

  if (createdForTraversal && fs.existsSync(INDEX_PATH)) {
    fs.unlinkSync(INDEX_PATH);
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.error('\nFailed tests:');
    for (const f of failures) {
      console.error(`  • ${f.name}: ${f.error}`);
    }
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
