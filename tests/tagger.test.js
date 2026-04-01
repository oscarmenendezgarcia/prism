'use strict';

/**
 * Backend unit tests for the tagger handler.
 *
 * Tests run against a real startServer() with a temp data directory.
 * The Anthropic SDK is mocked via module override — no real API calls.
 *
 * Coverage targets: src/handlers/tagger.js >= 90%
 */

const { test, describe, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const http    = require('http');

// ---------------------------------------------------------------------------
// Anthropic SDK mock
// ---------------------------------------------------------------------------

/**
 * We intercept require('@anthropic-ai/sdk') at the Node.js module level
 * so that tagger.js gets our mock client instead of the real SDK.
 *
 * The mock is configured before the test server starts.
 */

let mockCreateResponse = null;
let mockShouldThrow    = false;
let mockThrowMessage   = 'Anthropic API error';
// Block mechanism for concurrent test — when non-null, create() awaits it.
let mockBlockPromise   = null;

class MockAnthropic {
  get messages() {
    return {
      create: async () => {
        if (mockBlockPromise) await mockBlockPromise;
        if (mockShouldThrow) {
          throw new Error(mockThrowMessage);
        }
        return mockCreateResponse;
      },
    };
  }
}

const FAKE_SDK = { default: MockAnthropic };

// Resolve the real SDK's module cache key and inject our mock into the cache.
// This makes tagger.js's lazy require('@anthropic-ai/sdk') return our fake.
{
  const sdkPath = require.resolve('@anthropic-ai/sdk');
  if (require.cache[sdkPath]) {
    require.cache[sdkPath].exports = FAKE_SDK;
  } else {
    // Pre-populate the cache entry so the first require() in tagger.js hits our mock
    require.cache[sdkPath] = {
      id:       sdkPath,
      filename: sdkPath,
      loaded:   true,
      exports:  FAKE_SDK,
      children: [],
      paths:    [],
      parent:   null,
    };
  }
}

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
    // Ensure ANTHROPIC_API_KEY is set so the handler passes the key-check.
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    server = startServer({ port: 0, dataDir, silent: true });
    port   = await listenPort(server);
  });

  after(() => {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    delete process.env.ANTHROPIC_API_KEY;
  });

  // -------------------------------------------------------------------------
  // T-010-1: missing API key → 503
  // -------------------------------------------------------------------------
  describe('missing API key', () => {
    test('returns 503 ANTHROPIC_KEY_MISSING when ANTHROPIC_API_KEY is absent', async () => {
      // Temporarily remove the key
      const saved = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const res = await req(port, 'POST', '/api/v1/spaces/default/tagger/run', {});
      assert.equal(res.status, 503);
      assert.equal(res.body.error.code, 'ANTHROPIC_KEY_MISSING');

      process.env.ANTHROPIC_API_KEY = saved;
    });
  });

  // -------------------------------------------------------------------------
  // T-010-2: invalid column → 400
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
  // T-010-3: space not found → 404
  // -------------------------------------------------------------------------
  describe('space not found', () => {
    test('returns 404 SPACE_NOT_FOUND for unknown spaceId', async () => {
      const res = await req(port, 'POST', '/api/v1/spaces/does-not-exist/tagger/run', {});
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'SPACE_NOT_FOUND');
    });
  });

  // -------------------------------------------------------------------------
  // T-010-4: concurrent runs → 409
  // -------------------------------------------------------------------------
  describe('concurrent runs', () => {
    test('returns 409 TAGGER_ALREADY_RUNNING when a run is in progress', async () => {
      // Seed a card so the handler doesn't short-circuit on empty board
      seedTasks(dataDir, 'default', 'todo', [
        { id: 'card-1', title: 'Fix login', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]);

      // Install a blocking mock: create() will wait until we release it
      let unblock;
      mockBlockPromise = new Promise((resolve) => { unblock = resolve; });
      mockShouldThrow  = false;
      mockCreateResponse = {
        content: [{ type: 'text', text: JSON.stringify({ suggestions: [], skipped: [] }) }],
        usage:   { input_tokens: 0, output_tokens: 0 },
      };

      const first = req(port, 'POST', '/api/v1/spaces/default/tagger/run', {});
      // Give the first request a head-start to register in runningSpaces
      await new Promise((r) => setTimeout(r, 30));
      const second = req(port, 'POST', '/api/v1/spaces/default/tagger/run', {});

      const secondRes = await second;
      assert.equal(secondRes.status, 409);
      assert.equal(secondRes.body.error.code, 'TAGGER_ALREADY_RUNNING');

      // Unblock the first request and wait for it to complete
      unblock();
      await first;

      // Reset block and seed data
      mockBlockPromise = null;
      seedTasks(dataDir, 'default', 'todo', []);
    });
  });

  // -------------------------------------------------------------------------
  // T-010-5: successful run → 200 with correct suggestion shape
  // -------------------------------------------------------------------------
  describe('successful run', () => {
    test('returns 200 with correct suggestion shape', async () => {
      seedTasks(dataDir, 'default', 'todo', [
        {
          id: 'task-a', title: 'Fix the redirect loop', type: 'chore',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
        {
          id: 'task-b', title: 'Add dark mode', type: 'chore',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      ]);

      mockShouldThrow = false;
      mockCreateResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              suggestions: [
                { id: 'task-a', inferredType: 'bug',     confidence: 'high' },
                { id: 'task-b', inferredType: 'feature', confidence: 'medium' },
              ],
              skipped: [],
            }),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      };

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

      // Cleanup
      seedTasks(dataDir, 'default', 'todo', []);
    });
  });

  // -------------------------------------------------------------------------
  // T-010-6: Claude returns invalid JSON → 502
  // -------------------------------------------------------------------------
  describe('invalid JSON from Claude', () => {
    test('returns 502 ANTHROPIC_API_ERROR when Claude response is not valid JSON', async () => {
      seedTasks(dataDir, 'default', 'todo', [
        { id: 'task-x', title: 'Some task', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]);

      mockShouldThrow = false;
      mockCreateResponse = {
        content: [{ type: 'text', text: 'This is not JSON at all.' }],
        usage:   { input_tokens: 10, output_tokens: 5 },
      };

      const res = await req(port, 'POST', '/api/v1/spaces/default/tagger/run', {});
      assert.equal(res.status, 502);
      assert.equal(res.body.error.code, 'ANTHROPIC_API_ERROR');

      seedTasks(dataDir, 'default', 'todo', []);
    });

    test('returns 502 ANTHROPIC_API_ERROR when response JSON is missing required fields', async () => {
      seedTasks(dataDir, 'default', 'todo', [
        { id: 'task-y', title: 'Another task', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]);

      mockShouldThrow = false;
      mockCreateResponse = {
        content: [{ type: 'text', text: JSON.stringify({ wrong: 'shape' }) }],
        usage:   { input_tokens: 10, output_tokens: 5 },
      };

      const res = await req(port, 'POST', '/api/v1/spaces/default/tagger/run', {});
      assert.equal(res.status, 502);
      assert.equal(res.body.error.code, 'ANTHROPIC_API_ERROR');

      seedTasks(dataDir, 'default', 'todo', []);
    });
  });

  // -------------------------------------------------------------------------
  // T-010-7: empty board → 200 with empty suggestions
  // -------------------------------------------------------------------------
  describe('empty board', () => {
    test('returns 200 with empty suggestions when board has no tasks', async () => {
      // Ensure all columns are empty (default state after initDataDir)
      seedTasks(dataDir, 'default', 'todo',         []);
      seedTasks(dataDir, 'default', 'in-progress',  []);
      seedTasks(dataDir, 'default', 'done',         []);

      const res = await req(port, 'POST', '/api/v1/spaces/default/tagger/run', {});
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.suggestions, []);
      assert.deepEqual(res.body.skipped, []);
      assert.equal(res.body.inputTokens, 0);
      assert.equal(res.body.outputTokens, 0);
    });
  });

  // -------------------------------------------------------------------------
  // Additional: GET on tagger route → 405
  // -------------------------------------------------------------------------
  describe('method not allowed', () => {
    test('returns 405 for GET on tagger route', async () => {
      const res = await req(port, 'GET', '/api/v1/spaces/default/tagger/run');
      assert.equal(res.status, 405);
      assert.equal(res.body.error.code, 'METHOD_NOT_ALLOWED');
    });
  });

  // -------------------------------------------------------------------------
  // Additional: Anthropic SDK throws → 502
  // -------------------------------------------------------------------------
  describe('Anthropic SDK throws', () => {
    test('returns 502 ANTHROPIC_API_ERROR when SDK throws', async () => {
      seedTasks(dataDir, 'default', 'todo', [
        { id: 'task-z', title: 'Some card', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]);

      mockShouldThrow    = true;
      mockThrowMessage   = 'Rate limit exceeded';

      const res = await req(port, 'POST', '/api/v1/spaces/default/tagger/run', {});
      assert.equal(res.status, 502);
      assert.equal(res.body.error.code, 'ANTHROPIC_API_ERROR');

      mockShouldThrow = false;
      seedTasks(dataDir, 'default', 'todo', []);
    });
  });
}

runTests();
