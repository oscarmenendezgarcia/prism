'use strict';

/**
 * Inksmith integration tests — T-002, T-003, T-004, T-005, T-006, T-007
 * Run with: node --test tests/inksmith.test.js
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert  = require('node:assert/strict');
const http    = require('http');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const crypto  = require('crypto');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-inksmith-test-'));
}

function startMockHttpServer(initialHandler) {
  let handler = initialHandler;
  const server = http.createServer((req, res) => handler(req, res));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        setHandler: (fn) => { handler = fn; },
        // closeAllConnections() force-closes lingering connections (e.g. from the timeout test
        // where the server never sends a response, leaving the socket open until client destroys it).
        close: () => new Promise((r) => {
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          server.close(r);
        }),
      });
    });
  });
}

function request(port, method, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const raw  = payload !== undefined ? JSON.stringify(payload) : undefined;
    const opts = { hostname: 'localhost', port, path: urlPath, method, headers: { 'Content-Type': 'application/json', ...(raw !== undefined && { 'Content-Length': Buffer.byteLength(raw) }) } };
    const req  = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw2 = Buffer.concat(chunks).toString('utf8');
        let parsed; try { parsed = JSON.parse(raw2); } catch { parsed = raw2; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (raw !== undefined) req.write(raw);
    req.end();
  });
}

function inksmithSettings(port, overrides = {}) {
  return {
    cli: { tool: 'claude', binary: 'claude', flags: ['-p'], promptFlag: '-p', fileInputMethod: 'cat-subshell' },
    pipeline: { autoAdvance: true, confirmBetweenStages: true, stages: [], agentsDir: '' },
    prompts: {
      includeKanbanBlock: false, includeGitBlock: false, workingDirectory: '',
      inksmith: { enabled: true, endpoint: `http://127.0.0.1:${port}/v1/refine`, timeoutMs: 2000, retry: { attempts: 0, backoffMs: 0 }, circuitBreaker: { failureThreshold: 5, openMs: 30000 }, ...overrides },
    },
  };
}

function disabledSettings() {
  return {
    cli: { tool: 'claude', binary: 'claude', flags: ['-p'], promptFlag: '-p', fileInputMethod: 'cat-subshell' },
    pipeline: { autoAdvance: true, confirmBetweenStages: true, stages: [], agentsDir: '' },
    prompts: {
      includeKanbanBlock: false, includeGitBlock: false, workingDirectory: '',
      inksmith: { enabled: false, endpoint: 'https://api.inksmith.example/v1/refine', timeoutMs: 1500, retry: { attempts: 1, backoffMs: 200 }, circuitBreaker: { failureThreshold: 5, openMs: 30000 } },
    },
  };
}

// ---------------------------------------------------------------------------
// Settings schema — T-002 + BUG-001 regressions
// ---------------------------------------------------------------------------

describe('settings schema — prompts.inksmith block (T-002)', () => {
  const { DEFAULT_SETTINGS, readSettings, deepMergeSettings } = require('../src/handlers/settings');

  test('DEFAULT_SETTINGS.prompts.inksmith exists with enabled:false', () => {
    assert.ok(DEFAULT_SETTINGS.prompts.inksmith);
    assert.strictEqual(DEFAULT_SETTINGS.prompts.inksmith.enabled, false);
  });

  test('DEFAULT_SETTINGS.prompts.inksmith has all required fields', () => {
    const { inksmith } = DEFAULT_SETTINGS.prompts;
    assert.strictEqual(typeof inksmith.endpoint, 'string');
    assert.strictEqual(typeof inksmith.timeoutMs, 'number');
    assert.strictEqual(typeof inksmith.retry, 'object');
    assert.strictEqual(typeof inksmith.circuitBreaker, 'object');
  });

  test('readSettings() returns inksmith defaults when settings.json is absent', () => {
    const s = readSettings(tmpDir());
    assert.ok(s.prompts.inksmith);
    assert.strictEqual(s.prompts.inksmith.enabled, false);
  });

  test('readSettings() merges inksmith.enabled:true stored on disk', () => {
    const d = tmpDir();
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ prompts: { inksmith: { enabled: true, endpoint: 'https://custom.example/v1', timeoutMs: 1500, retry: { attempts: 1, backoffMs: 200 }, circuitBreaker: { failureThreshold: 5, openMs: 30000 } } } }), 'utf8');
    const s = readSettings(d);
    assert.strictEqual(s.prompts.inksmith.enabled, true);
    assert.strictEqual(s.prompts.inksmith.endpoint, 'https://custom.example/v1');
    assert.strictEqual(s.prompts.includeKanbanBlock, true);
  });

  test('missing INKSMITH_API_KEY — settings schema unchanged', () => {
    assert.ok('enabled' in readSettings(tmpDir()).prompts.inksmith);
  });

  // BUG-001 regressions
  test('deepMergeSettings partial inksmith update preserves all sibling fields', () => {
    const merged = deepMergeSettings(DEFAULT_SETTINGS, { prompts: { inksmith: { enabled: true } } });
    assert.strictEqual(merged.prompts.inksmith.enabled, true);
    assert.strictEqual(merged.prompts.inksmith.endpoint, DEFAULT_SETTINGS.prompts.inksmith.endpoint);
    assert.strictEqual(merged.prompts.inksmith.timeoutMs, DEFAULT_SETTINGS.prompts.inksmith.timeoutMs);
    assert.deepStrictEqual(merged.prompts.inksmith.retry, DEFAULT_SETTINGS.prompts.inksmith.retry);
    assert.deepStrictEqual(merged.prompts.inksmith.circuitBreaker, DEFAULT_SETTINGS.prompts.inksmith.circuitBreaker);
    assert.strictEqual(merged.prompts.includeKanbanBlock, DEFAULT_SETTINGS.prompts.includeKanbanBlock);
  });

  test('deepMergeSettings partial inksmith update changes only named sub-field', () => {
    const merged = deepMergeSettings(DEFAULT_SETTINGS, { prompts: { inksmith: { endpoint: 'https://new.example/v1' } } });
    assert.strictEqual(merged.prompts.inksmith.endpoint, 'https://new.example/v1');
    assert.strictEqual(merged.prompts.inksmith.enabled, false);
    assert.strictEqual(merged.prompts.inksmith.timeoutMs, DEFAULT_SETTINGS.prompts.inksmith.timeoutMs);
  });
});

// ---------------------------------------------------------------------------
// CircuitBreaker — T-003
// ---------------------------------------------------------------------------

describe('CircuitBreaker — state machine', () => {
  const { CircuitBreaker, STATE } = require('../src/services/circuitBreaker');

  test('starts in CLOSED state', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 500 });
    assert.strictEqual(cb.getState(), STATE.CLOSED);
    assert.ok(cb.canPass());
  });

  test('stays CLOSED under threshold', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 500 });
    cb.recordFailure(); cb.recordFailure();
    assert.strictEqual(cb.getState(), STATE.CLOSED);
    assert.ok(cb.canPass());
  });

  test('CLOSED → OPEN after N consecutive failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 500 });
    cb.recordFailure(); cb.recordFailure(); cb.recordFailure();
    assert.strictEqual(cb.getState(), STATE.OPEN);
    assert.ok(!cb.canPass());
  });

  test('OPEN blocks all requests within open window', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, openMs: 60000 });
    cb.recordFailure();
    for (let i = 0; i < 5; i++) assert.ok(!cb.canPass(), `Request ${i} must be blocked`);
  });

  test('OPEN → HALF_OPEN after openMs elapsed', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, openMs: 1 });
    cb.recordFailure();
    return new Promise((r) => setTimeout(() => { assert.ok(cb.canPass()); r(); }, 10));
  });

  test('HALF_OPEN: successful probe → CLOSED', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, openMs: 1 });
    cb.recordFailure();
    return new Promise((r) => setTimeout(() => { cb.canPass(); cb.recordSuccess(); assert.strictEqual(cb.getState(), STATE.CLOSED); r(); }, 10));
  });

  test('HALF_OPEN: failed probe → OPEN', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, openMs: 1 });
    cb.recordFailure();
    return new Promise((r) => setTimeout(() => { cb.canPass(); cb.recordFailure(); assert.strictEqual(cb.getState(), STATE.OPEN); r(); }, 10));
  });

  test('recordSuccess resets consecutive failures in CLOSED state', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 500 });
    cb.recordFailure(); cb.recordFailure(); cb.recordSuccess(); cb.recordFailure(); cb.recordFailure();
    assert.strictEqual(cb.getState(), STATE.CLOSED);
  });
});

// ---------------------------------------------------------------------------
// InksmithClient — T-004
// ---------------------------------------------------------------------------

describe('InksmithClient — refine()', () => {
  let mock;

  before(async () => {
    mock = await startMockHttpServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ refinedPrompt: 'refined', refinementId: 'rid-1' })); });
    process.env.INKSMITH_ALLOW_HTTP = '1';
    process.env.INKSMITH_API_KEY    = 'test-api-key-abc123';
  });

  after(async () => { await mock.close(); delete process.env.INKSMITH_ALLOW_HTTP; delete process.env.INKSMITH_API_KEY; });

  const { refine, redactKey } = require('../src/services/inksmithClient');

  function bs(port, o = {}) { return { enabled: true, endpoint: `http://127.0.0.1:${port}/v1/refine`, timeoutMs: 2000, retry: { attempts: 0, backoffMs: 0 }, ...o }; }

  test('200 happy path', async () => {
    mock.setHandler((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ refinedPrompt: 'polished', refinementId: 'rid-abc' })); });
    const r = await refine('raw', {}, bs(mock.port));
    assert.strictEqual(r.ok, true); assert.strictEqual(r.refinedPrompt, 'polished'); assert.strictEqual(r.refinementId, 'rid-abc');
  });

  test('5xx response — ok:false, reason:"5xx"', async () => {
    mock.setHandler((req, res) => { res.writeHead(500); res.end('err'); });
    const r = await refine('raw', {}, bs(mock.port));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, '5xx');
  });

  test('401 4xx response — ok:false, reason:"4xx"', async () => {
    mock.setHandler((req, res) => { res.writeHead(401); res.end('{}'); });
    const r = await refine('raw', {}, bs(mock.port));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, '4xx'); assert.strictEqual(r.httpStatus, 401);
  });

  test('malformed JSON — ok:false, reason:"malformed_json"', async () => {
    mock.setHandler((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('not-json{{'); });
    const r = await refine('raw', {}, bs(mock.port));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'malformed_json');
  });

  test('empty refinedPrompt — ok:false, reason:"schema_mismatch"', async () => {
    mock.setHandler((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ refinedPrompt: '   ' })); });
    const r = await refine('raw', {}, bs(mock.port));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'schema_mismatch');
  });

  test('missing refinedPrompt — ok:false, reason:"schema_mismatch"', async () => {
    mock.setHandler((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ model: 'gpt-4' })); });
    const r = await refine('raw', {}, bs(mock.port));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'schema_mismatch');
  });

  test('request too large — ok:false, reason:"request_too_large"', async () => {
    const r = await refine('x'.repeat(256 * 1024 + 1), {}, bs(mock.port));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'request_too_large');
  });

  // BUG-004: response_too_large path
  test('response too large — ok:false, reason:"response_too_large"', async () => {
    mock.setHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.on('error', () => {}); // suppress write error if client destroys socket mid-stream
      res.end(Buffer.alloc(512 * 1024 + 1, 'x'));
    });
    const r = await refine('raw', {}, bs(mock.port));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'response_too_large');
  });

  // Review #2: timeout path
  test('timeout — ok:false, reason:"timeout"', async () => {
    mock.setHandler((req, res) => {
      req.socket.setTimeout(0); // disable server-side socket timeout
      req.resume(); // drain request body — never send response
      res.on('error', () => {}); // suppress ECONNRESET when client destroys socket after timeout
    });
    const r = await refine('raw', {}, bs(mock.port, { timeoutMs: 80, retry: { attempts: 0, backoffMs: 0 } }));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'timeout');
  });

  test('non-HTTPS endpoint rejected without INKSMITH_ALLOW_HTTP', async () => {
    delete process.env.INKSMITH_ALLOW_HTTP;
    const r = await refine('raw', {}, { enabled: true, endpoint: `http://127.0.0.1:${mock.port}/v1`, timeoutMs: 2000, retry: { attempts: 0, backoffMs: 0 } });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'insecure_endpoint');
    process.env.INKSMITH_ALLOW_HTTP = '1';
  });

  // BUG-002 regressions
  test('undefined endpoint — ok:false, reason:"missing_endpoint"', async () => {
    const r = await refine('raw', {}, { enabled: true, endpoint: undefined, timeoutMs: 500, retry: { attempts: 0, backoffMs: 0 } });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'missing_endpoint');
  });

  test('null endpoint — ok:false, reason:"missing_endpoint"', async () => {
    const r = await refine('raw', {}, { enabled: true, endpoint: null, timeoutMs: 500, retry: { attempts: 0, backoffMs: 0 } });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'missing_endpoint');
  });

  // BUG-003 regression: attempts=0 → exactly 1 HTTP call
  test('retry.attempts=0 — exactly 1 HTTP call on 5xx', async () => {
    let calls = 0;
    mock.setHandler((req, res) => { calls++; res.writeHead(500); res.end(); });
    await refine('raw', {}, bs(mock.port, { retry: { attempts: 0, backoffMs: 0 } }));
    assert.strictEqual(calls, 1, `Expected 1 call, got ${calls}`);
  });

  test('API key never appears in reason or error fields', async () => {
    mock.setHandler((req, res) => { res.writeHead(500); res.end(); });
    const r = await refine('raw', {}, bs(mock.port, { retry: { attempts: 0, backoffMs: 0 } }));
    assert.ok(!JSON.stringify(r).includes('test-api-key-abc123'), 'API key must not appear in result');
  });

  test('redactKey() replaces key occurrences', () => {
    const { redactKey } = require('../src/services/inksmithClient');
    const r = redactKey('Bearer test-api-key-abc123 rejected', 'test-api-key-abc123');
    assert.ok(!r.includes('test-api-key-abc123')); assert.ok(r.includes('[REDACTED]'));
  });

  test('redactKey() returns unchanged when key is empty', () => {
    const { redactKey } = require('../src/services/inksmithClient');
    const msg = 'some error';
    assert.strictEqual(redactKey(msg, ''), msg); assert.strictEqual(redactKey(msg, null), msg);
  });
});

// ---------------------------------------------------------------------------
// PromptRefiner — T-005
// ---------------------------------------------------------------------------

describe('PromptRefiner — refine()', () => {
  let mock;

  before(async () => {
    mock = await startMockHttpServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ refinedPrompt: 'ink-refined', refinementId: 'r-id-1' })); });
    process.env.INKSMITH_ALLOW_HTTP = '1';
  });

  after(async () => { await mock.close(); delete process.env.INKSMITH_ALLOW_HTTP; delete process.env.INKSMITH_API_KEY; });

  let pr;
  beforeEach(() => {
    delete require.cache[require.resolve('../src/services/promptRefiner')];
    pr = require('../src/services/promptRefiner');
    pr.resetBreaker(); pr.resetCounters();
  });

  test('disabled flag → local-fallback, reason="disabled"', async () => {
    delete process.env.INKSMITH_API_KEY;
    const r = await pr.refine('raw', { taskId: 't1' }, disabledSettings());
    assert.strictEqual(r.source, 'local-fallback'); assert.strictEqual(r.reason, 'disabled');
  });

  test('enabled but missing API key → local-fallback', async () => {
    delete process.env.INKSMITH_API_KEY;
    const r = await pr.refine('raw', { taskId: 't1' }, inksmithSettings(mock.port));
    assert.strictEqual(r.source, 'local-fallback'); assert.strictEqual(r.reason, 'disabled');
  });

  test('enabled + API key + 200 → source="inksmith"', async () => {
    process.env.INKSMITH_API_KEY = 'key-xyz';
    mock.setHandler((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ refinedPrompt: 'polished', refinementId: 'r-ok' })); });
    const r = await pr.refine('raw', { agentId: 'dev', taskId: 't1', spaceId: 's1' }, inksmithSettings(mock.port));
    assert.strictEqual(r.source, 'inksmith'); assert.strictEqual(r.prompt, 'polished');
  });

  test('client returns ok:false → local-fallback', async () => {
    process.env.INKSMITH_API_KEY = 'key-xyz';
    mock.setHandler((req, res) => { res.writeHead(500); res.end(); });
    const r = await pr.refine('raw', { taskId: 't1' }, inksmithSettings(mock.port, { retry: { attempts: 0, backoffMs: 0 } }));
    assert.strictEqual(r.source, 'local-fallback'); assert.ok(r.reason);
  });

  test('breaker open → local-fallback, reason="breaker_open"', async () => {
    process.env.INKSMITH_API_KEY = 'key-xyz';
    mock.setHandler((req, res) => { res.writeHead(500); res.end(); });
    const s = inksmithSettings(mock.port, { retry: { attempts: 0, backoffMs: 0 }, circuitBreaker: { failureThreshold: 2, openMs: 60000 } });
    await pr.refine('raw', { taskId: 't1' }, s);
    await pr.refine('raw', { taskId: 't1' }, s);
    const r = await pr.refine('raw', { taskId: 't1' }, s);
    assert.strictEqual(r.source, 'local-fallback'); assert.strictEqual(r.reason, 'breaker_open');
  });

  test('never throws under any failure mode', async () => {
    process.env.INKSMITH_API_KEY = 'key-xyz';
    let threw = false;
    try { await pr.refine('raw', { taskId: 't1' }, inksmithSettings(1, { retry: { attempts: 0, backoffMs: 0 } })); } catch { threw = true; }
    assert.ok(!threw);
  });

  test('counters increment on success', async () => {
    process.env.INKSMITH_API_KEY = 'key-xyz';
    mock.setHandler((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ refinedPrompt: 'r', refinementId: 'r-1' })); });
    await pr.refine('raw', { taskId: 't1' }, inksmithSettings(mock.port));
    const c = pr.getCounters();
    assert.strictEqual(c.callsTotal.success, 1); assert.strictEqual(c.callsTotal.failure, 0);
  });

  test('counters increment on failure', async () => {
    process.env.INKSMITH_API_KEY = 'key-xyz';
    mock.setHandler((req, res) => { res.writeHead(500); res.end(); });
    await pr.refine('raw', { taskId: 't1' }, inksmithSettings(mock.port, { retry: { attempts: 0, backoffMs: 0 } }));
    const c = pr.getCounters();
    assert.strictEqual(c.callsTotal.failure, 1); assert.strictEqual(c.callsTotal.success, 0);
  });

  test('fallback counters keyed by reason', async () => {
    delete process.env.INKSMITH_API_KEY;
    await pr.refine('raw', { taskId: 't1' }, disabledSettings());
    await pr.refine('raw', { taskId: 't2' }, disabledSettings());
    assert.ok(pr.getCounters().fallbackTotal['disabled'] >= 2);
  });

  test('getCounters() includes breakerState', () => { assert.ok('breakerState' in pr.getCounters()); });
  test('getCounters() includes lastFailures array', () => { assert.ok(Array.isArray(pr.getCounters().lastFailures)); });
});

// ---------------------------------------------------------------------------
// GET /api/v1/inksmith/health — T-007
// ---------------------------------------------------------------------------

describe('GET /api/v1/inksmith/health — REST integration', () => {
  let server, port, dataDir, agentsDir;

  before(async () => {
    dataDir = tmpDir(); agentsDir = tmpDir();
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'senior-architect.md'), '---\nmodel: sonnet\n---\nTest agent.', 'utf8');
    process.env.PIPELINE_AGENTS_DIR = agentsDir; process.env.PIPELINE_MAX_CONCURRENT = '5'; process.env.KANBAN_API_URL = 'http://localhost:19999/api/v1';
    for (const k of Object.keys(require.cache)) { if (k.includes('/src/services/promptRefiner') || k.includes('/src/services/agentResolver') || k.includes('/src/services/pipelineManager') || k.includes('/src/routes')) delete require.cache[k]; }
    const { startServer } = require('../server');
    await new Promise((resolve, reject) => { server = startServer({ port: 0, dataDir, silent: true }); server.once('listening', () => { port = server.address().port; resolve(); }); server.once('error', reject); });
  });

  after(async () => {
    delete process.env.PIPELINE_AGENTS_DIR; delete process.env.PIPELINE_MAX_CONCURRENT; delete process.env.KANBAN_API_URL;
    await new Promise((r) => server.close(r));
    fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  test('returns 200 with all counter fields', async () => {
    const res = await request(port, 'GET', '/api/v1/inksmith/health');
    assert.strictEqual(res.status, 200);
    for (const f of ['callsTotal', 'fallbackTotal', 'latencyMs', 'breakerState', 'lastFailures']) assert.ok(f in res.body, `missing ${f}`);
  });

  test('callsTotal has success and failure numbers', async () => {
    const res = await request(port, 'GET', '/api/v1/inksmith/health');
    assert.strictEqual(typeof res.body.callsTotal.success, 'number');
    assert.strictEqual(typeof res.body.callsTotal.failure, 'number');
  });

  test('breakerState is one of closed|open|half-open', async () => {
    const res = await request(port, 'GET', '/api/v1/inksmith/health');
    assert.ok(['closed', 'open', 'half-open'].includes(res.body.breakerState));
  });

  test('lastFailures is an array', async () => {
    const res = await request(port, 'GET', '/api/v1/inksmith/health');
    assert.ok(Array.isArray(res.body.lastFailures));
  });

  test('405 on non-GET method', async () => {
    const res = await request(port, 'POST', '/api/v1/inksmith/health');
    assert.strictEqual(res.status, 405);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/agent/prompt — source + refinementId (T-006)
// ---------------------------------------------------------------------------

describe('POST /api/v1/agent/prompt — source field integration (T-006)', () => {
  let server, port, dataDir, agentsDir;

  before(async () => {
    dataDir = tmpDir(); agentsDir = tmpDir();
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'senior-architect.md'), '---\nmodel: sonnet\n---\nYou are a test agent.', 'utf8');
    process.env.PIPELINE_AGENTS_DIR = agentsDir; process.env.PIPELINE_MAX_CONCURRENT = '5'; process.env.KANBAN_API_URL = 'http://localhost:19999/api/v1';
    for (const k of Object.keys(require.cache)) { if (k.includes('/src/services/promptRefiner') || k.includes('/src/routes') || k.includes('/src/handlers/prompt') || k.includes('/src/handlers/settings')) delete require.cache[k]; }
    const { startServer } = require('../server');
    await new Promise((resolve, reject) => { server = startServer({ port: 0, dataDir, silent: true }); server.once('listening', () => { port = server.address().port; resolve(); }); server.once('error', reject); });
  });

  after(async () => {
    delete process.env.PIPELINE_AGENTS_DIR; delete process.env.PIPELINE_MAX_CONCURRENT; delete process.env.KANBAN_API_URL; delete process.env.INKSMITH_API_KEY;
    await new Promise((r) => server.close(r));
    fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  function createSpace() {
    const { createSpaceManager } = require('../src/services/spaceManager');
    const sm = createSpaceManager(dataDir);
    const { space } = sm.createSpace(`t006-${crypto.randomUUID().slice(0, 8)}`);
    const taskId = crypto.randomUUID();
    const todoPath = path.join(dataDir, 'spaces', space.id, 'todo.json');
    const tasks = JSON.parse(fs.readFileSync(todoPath, 'utf8'));
    tasks.push({ id: taskId, title: 'T-006 test', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    fs.writeFileSync(todoPath, JSON.stringify(tasks), 'utf8');
    return { spaceId: space.id, taskId };
  }

  test('response includes source:"local-fallback" when inksmith disabled (default)', async () => {
    const { spaceId, taskId } = createSpace();
    const res = await request(port, 'POST', '/api/v1/agent/prompt', { agentId: 'senior-architect', taskId, spaceId });
    assert.strictEqual(res.status, 201, `Expected 201: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.source, 'local-fallback');
    assert.strictEqual(res.body.refinementId, null);
  });

  test('source and refinementId present alongside existing fields', async () => {
    const { spaceId, taskId } = createSpace();
    const res = await request(port, 'POST', '/api/v1/agent/prompt', { agentId: 'senior-architect', taskId, spaceId });
    assert.strictEqual(res.status, 201);
    assert.ok('source' in res.body); assert.ok('refinementId' in res.body);
    for (const f of ['promptPath', 'promptPreview', 'promptFull', 'cliCommand', 'estimatedTokens']) assert.ok(f in res.body, `missing ${f}`);
  });

  test('written file content matches promptFull', async () => {
    const { spaceId, taskId } = createSpace();
    const res = await request(port, 'POST', '/api/v1/agent/prompt', { agentId: 'senior-architect', taskId, spaceId });
    assert.strictEqual(res.status, 201);
    assert.ok(fs.existsSync(res.body.promptPath));
    assert.strictEqual(fs.readFileSync(res.body.promptPath, 'utf8'), res.body.promptFull);
  });
});
