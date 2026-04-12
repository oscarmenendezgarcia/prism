'use strict';

/**
 * Backend unit tests for the tagger handler.
 *
 * Tests run against a real startServer() with a temp data directory.
 * child_process.spawn is mocked — no real CLI calls are made.
 *
 * Coverage targets: src/handlers/tagger.js >= 90%
 */

const { test, describe, before, after } = require('node:test');
const assert       = require('node:assert/strict');
const fs           = require('fs');
const os           = require('os');
const path         = require('path');
const http         = require('http');
const { EventEmitter } = require('events');

// ---------------------------------------------------------------------------
// child_process.spawn mock
// ---------------------------------------------------------------------------
// We replace require('child_process').spawn with a controllable fake BEFORE
// server.js (and tagger.js) are loaded, so the lazy require() inside callClaude
// picks up our mock from the module cache.
//
// mockSpawnStdout    — string emitted on stdout (the JSON response from the CLI)
// mockSpawnExitCode  — exit code emitted on 'close' (default 0 = success)
// mockSpawnEmitError — when true, child emits 'error' instead of closing
// mockSpawnErrorMsg  — message for the error event
// mockSpawnBlock     — Promise; when set, stdout/close are deferred until resolved
// ---------------------------------------------------------------------------

let mockSpawnStdout    = '';
let mockSpawnExitCode  = 0;
let mockSpawnEmitError = false;
let mockSpawnErrorMsg  = 'spawn error';
let mockSpawnBlock     = null;

const _realSpawn = require('child_process').spawn;

function installSpawnMock() {
  require('child_process').spawn = function mockSpawn(_cmd, _args, _opts) {
    const child  = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin  = { write: () => {}, end: () => {} };

    setImmediate(async () => {
      if (mockSpawnBlock) await mockSpawnBlock;
      if (mockSpawnEmitError) {
        child.emit('error', new Error(mockSpawnErrorMsg));
        return;
      }
      if (mockSpawnStdout) child.stdout.emit('data', mockSpawnStdout);
      child.emit('close', mockSpawnExitCode);
    });

    return child;
  };
}

function restoreSpawn() {
  require('child_process').spawn = _realSpawn;
}

// Install mock BEFORE server is required so the lazy require() in callClaude sees it.
installSpawnMock();

// ---------------------------------------------------------------------------
// Server / HTTP helpers
// ---------------------------------------------------------------------------

const { startServer } = require('../server');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-tagger-'));
}

function initDataDir(dir) {
  fs.mkdirSync(path.join(dir, 'spaces'), { recursive: true });
  const spaces = [
    { id: 'default', name: 'General', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ];
  fs.writeFileSync(path.join(dir, 'spaces.json'), JSON.stringify(spaces), 'utf8');
  const spaceDir = path.join(dir, 'spaces', 'default');
  fs.mkdirSync(spaceDir, { recursive: true });
  for (const col of ['todo', 'in-progress', 'done']) {
    fs.writeFileSync(path.join(spaceDir, `${col}.json`), '[]', 'utf8');
  }
}

function req(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const pl = body !== undefined ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: 'localhost',
      port,
      path:     urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(pl !== undefined ? { 'Content-Length': Buffer.byteLength(pl) } : {}),
      },
    };
    const r = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (pl !== undefined) r.write(pl);
    r.end();
  });
}

function listenPort(srv) {
  return new Promise((resolve) => srv.once('listening', () => resolve(srv.address().port)));
}

function seedTasks(dir, spaceId, column, tasks) {
  const filePath = path.join(dir, 'spaces', spaceId, `${column}.json`);
  fs.writeFileSync(filePath, JSON.stringify(tasks), 'utf8');
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

async function runTests() {
  let dataDir;
  let server;
  let port;

  before(async () => {
    dataDir = tmpDir();
    initDataDir(dataDir);
    server = startServer({ port: 0, dataDir, silent: true });
    port   = await listenPort(server);
  });

  after(() => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close();
    restoreSpawn();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // T-010-1: invalid column → 400
  // -------------------------------------------------------------------------
  describe('invalid column', () => {
    test('returns 400 VALIDATION_ERROR for unknown column value', async () => {
      const res = await req(port, 'POST', '/api/v1/spaces/default/tagger/run', {
        column: 'backlog',
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.ok(res.body.error.message.includes('column'));
    });
  });

  // -------------------------------------------------------------------------
  // T-010-2: space not found → 404
  // -------------------------------------------------------------------------
  describe('space not found', () => {
    test('returns 404 SPACE_NOT_FOUND for unknown spaceId', async () => {
      const res = await req(port, 'POST', '/api/v1/spaces/does-not-exist/tagger/run', {});
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'SPACE_NOT_FOUND');
    });
  });

  // -------------------------------------------------------------------------
  // T-010-3: concurrent runs → 409
  // -------------------------------------------------------------------------
  describe('concurrent runs', () => {
    test('returns 409 TAGGER_ALREADY_RUNNING when a run is in progress', async () => {
      seedTasks(dataDir, 'default', 'todo', [
        { id: 'card-1', title: 'Fix login', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]);

      // Block the spawn mock so the first request stays in-flight
      let unblock;
      mockSpawnBlock  = new Promise((resolve) => { unblock = resolve; });
      mockSpawnStdout = JSON.stringify({ suggestions: [], skipped: [] });
      mockSpawnExitCode = 0;

      const first = req(port, 'POST', '/api/v1/spaces/default/tagger/run', {});
      await new Promise((r) => setTimeout(r, 30));
      const second = req(port, 'POST', '/api/v1/spaces/default/tagger/run', {});

      const secondRes = await second;
      assert.equal(secondRes.status, 409);
      assert.equal(secondRes.body.error.code, 'TAGGER_ALREADY_RUNNING');

      unblock();
      await first;

      mockSpawnBlock = null;
      seedTasks(dataDir, 'default', 'todo', []);
    });
  });

  // -------------------------------------------------------------------------
  // T-010-4: successful run → 200 with correct suggestion shape
  // -------------------------------------------------------------------------
  describe('successful run', () => {
    test('returns 200 with correct suggestion shape', async () => {
      seedTasks(dataDir, 'default', 'todo', [
        { id: 'task-a', title: 'Fix the redirect loop', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: 'task-b', title: 'Add dark mode',         type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]);

      mockSpawnEmitError = false;
      mockSpawnExitCode  = 0;
      mockSpawnStdout    = JSON.stringify({
        suggestions: [
          { id: 'task-a', inferredType: 'bug',     confidence: 'high'   },
          { id: 'task-b', inferredType: 'feature', confidence: 'medium' },
        ],
        skipped: [],
      });

      const res = await req(port, 'POST', '/api/v1/spaces/default/tagger/run', {});
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.suggestions));
      assert.equal(res.body.suggestions.length, 2);

      const suggA = res.body.suggestions.find((s) => s.id === 'task-a');
      assert.equal(suggA.inferredType, 'bug');
      assert.equal(suggA.confidence, 'high');
      assert.equal(suggA.currentType, 'chore');
      assert.equal(suggA.title, 'Fix the redirect loop');

      assert.ok(Array.isArray(res.body.skipped));
      assert.equal(typeof res.body.model, 'string');
      assert.equal(typeof res.body.inputTokens, 'number');
      assert.equal(typeof res.body.outputTokens, 'number');

      seedTasks(dataDir, 'default', 'todo', []);
    });
  });

  // -------------------------------------------------------------------------
  // T-010-5: CLI returns invalid JSON → 502
  // -------------------------------------------------------------------------
  describe('invalid JSON from CLI', () => {
    test('returns 502 TAGGER_CLI_ERROR when CLI outputs no JSON', async () => {
      seedTasks(dataDir, 'default', 'todo', [
        { id: 'task-x', title: 'Some task', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]);

      mockSpawnEmitError = false;
      mockSpawnExitCode  = 0;
      mockSpawnStdout    = 'This is not JSON at all.';

      const res = await req(port, 'POST', '/api/v1/spaces/default/tagger/run', {});
      assert.equal(res.status, 502);
      assert.equal(res.body.error.code, 'TAGGER_CLI_ERROR');

      seedTasks(dataDir, 'default', 'todo', []);
    });

    test('returns 502 TAGGER_CLI_ERROR when JSON is missing required fields', async () => {
      seedTasks(dataDir, 'default', 'todo', [
        { id: 'task-y', title: 'Another task', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]);

      mockSpawnEmitError = false;
      mockSpawnExitCode  = 0;
      mockSpawnStdout    = JSON.stringify({ wrong: 'shape' });

      const res = await req(port, 'POST', '/api/v1/spaces/default/tagger/run', {});
      assert.equal(res.status, 502);
      assert.equal(res.body.error.code, 'TAGGER_CLI_ERROR');

      seedTasks(dataDir, 'default', 'todo', []);
    });
  });

  // -------------------------------------------------------------------------
  // T-010-6: empty board → 200 with empty suggestions (no spawn)
  // -------------------------------------------------------------------------
  describe('empty board', () => {
    test('returns 200 with empty suggestions when board has no tasks', async () => {
      seedTasks(dataDir, 'default', 'todo',        []);
      seedTasks(dataDir, 'default', 'in-progress', []);
      seedTasks(dataDir, 'default', 'done',        []);

      const res = await req(port, 'POST', '/api/v1/spaces/default/tagger/run', {});
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.suggestions, []);
      assert.deepEqual(res.body.skipped, []);
      assert.equal(res.body.inputTokens, 0);
      assert.equal(res.body.outputTokens, 0);
    });
  });

  // -------------------------------------------------------------------------
  // T-010-7: GET on tagger route → 405
  // -------------------------------------------------------------------------
  describe('method not allowed', () => {
    test('returns 405 for GET on tagger route', async () => {
      const res = await req(port, 'GET', '/api/v1/spaces/default/tagger/run');
      assert.equal(res.status, 405);
      assert.equal(res.body.error.code, 'METHOD_NOT_ALLOWED');
    });
  });

  // -------------------------------------------------------------------------
  // T-010-8: CLI spawn error → 502
  // -------------------------------------------------------------------------
  describe('CLI spawn failure', () => {
    test('returns 502 TAGGER_CLI_ERROR when CLI emits error event', async () => {
      seedTasks(dataDir, 'default', 'todo', [
        { id: 'task-z', title: 'Some card', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]);

      mockSpawnEmitError = true;
      mockSpawnErrorMsg  = 'spawn ENOENT';

      const res = await req(port, 'POST', '/api/v1/spaces/default/tagger/run', {});
      assert.equal(res.status, 502);
      assert.equal(res.body.error.code, 'TAGGER_CLI_ERROR');

      mockSpawnEmitError = false;
      seedTasks(dataDir, 'default', 'todo', []);
    });

    test('returns 502 TAGGER_CLI_ERROR when CLI exits with non-zero code', async () => {
      seedTasks(dataDir, 'default', 'todo', [
        { id: 'task-w', title: 'Some card', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]);

      mockSpawnEmitError = false;
      mockSpawnExitCode  = 1;
      mockSpawnStdout    = '';

      const res = await req(port, 'POST', '/api/v1/spaces/default/tagger/run', {});
      assert.equal(res.status, 502);
      assert.equal(res.body.error.code, 'TAGGER_CLI_ERROR');

      mockSpawnExitCode = 0;
      seedTasks(dataDir, 'default', 'todo', []);
    });
  });
}

runTests();
