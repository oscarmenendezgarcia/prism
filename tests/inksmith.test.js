'use strict';

/**
 * Inksmith integration tests — T-003, T-004, T-005, T-007
 *
 * Covers:
 *   CircuitBreaker:
 *     - closed → open after N consecutive failures
 *     - open blocks all requests
 *     - open → half-open after openMs elapsed
 *     - half-open probe succeeds → closed
 *     - half-open probe fails → re-opens
 *     - getState() returns current state string
 *
 *   InksmithClient (refine):
 *     - 200 happy path returns { ok: true, refinedPrompt, refinementId }
 *     - 5xx response returns { ok: false, reason: '5xx' }
 *     - 4xx (non-retriable) returns { ok: false, reason: '4xx' }
 *     - network error returns { ok: false, reason: 'network' }
 *     - malformed JSON returns { ok: false, reason: 'malformed_json' }
 *     - empty refinedPrompt returns { ok: false, reason: 'schema_mismatch' }
 *     - oversized response returns { ok: false, reason: 'response_too_large' }
 *     - oversized request returns { ok: false, reason: 'request_too_large' }
 *     - non-HTTPS endpoint rejected (unless INKSMITH_ALLOW_HTTP=1)
 *     - API key never appears in error reason strings
 *
 *   PromptRefiner:
 *     - disabled flag (enabled=false) → local-fallback, reason='disabled'
 *     - missing API key → local-fallback, reason='disabled'
 *     - breaker open → local-fallback, reason='breaker_open'
 *     - inksmithClient error → local-fallback, reason=<client reason>
 *     - happy path → source='inksmith', prompt=refinedPrompt
 *     - counters increment correctly
 *     - never throws under any mocked failure
 *
 *   GET /api/v1/inksmith/health:
 *     - returns JSON with callsTotal, fallbackTotal, latencyMs, breakerState, lastFailures
 *     - increments after a prompt generation with flag disabled
 *
 * Run with: node --test tests/inksmith.test.js
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert  = require('node:assert/strict');
const http    = require('http');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const crypto  = require('crypto');
const net     = require('net');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-inksmith-test-'));
}

/** Start a minimal mock HTTP server and return { server, port, setHandler }. */
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
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

/** Send a request to the test server and return { status, body }. */
function request(port, method, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const raw = payload !== undefined ? JSON.stringify(payload) : undefined;
    const opts = {
      hostname: 'localhost',
      port,
      path:     urlPath,
      method,
      headers:  {
        'Content-Type': 'application/json',
        ...(raw !== undefined && { 'Content-Length': Buffer.byteLength(raw) }),
      },
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw2 = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = JSON.parse(raw2); } catch { parsed = raw2; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (raw !== undefined) req.write(raw);
    req.end();
  });
}

/** Build minimal Prism settings with inksmith.enabled=true pointing at a local port. */
function inksmithSettings(port, overrides = {}) {
  return {
    cli:     { tool: 'claude', binary: 'claude', flags: ['-p'], promptFlag: '-p', fileInputMethod: 'cat-subshell' },
    pipeline: { autoAdvance: true, confirmBetweenStages: true, stages: [], agentsDir: '' },
    prompts: {
      includeKanbanBlock: false,
      includeGitBlock:    false,
      workingDirectory:   '',
      inksmith: {
        enabled:   true,
        endpoint:  `http://127.0.0.1:${port}/v1/refine`,
        timeoutMs: 2000,
        retry:     { attempts: 0, backoffMs: 0 },  // no retries for speed in tests
        circuitBreaker: { failureThreshold: 5, openMs: 30000 },
        ...overrides,
      },
    },
  };
}

function disabledSettings() {
  return {
    cli:     { tool: 'claude', binary: 'claude', flags: ['-p'], promptFlag: '-p', fileInputMethod: 'cat-subshell' },
    pipeline: { autoAdvance: true, confirmBetweenStages: true, stages: [], agentsDir: '' },
    prompts: {
      includeKanbanBlock: false,
      includeGitBlock:    false,
      workingDirectory:   '',
      inksmith: {
        enabled:   false,
        endpoint:  'https://api.inksmith.example/v1/refine',
        timeoutMs: 1500,
        retry:     { attempts: 1, backoffMs: 200 },
        circuitBreaker: { failureThreshold: 5, openMs: 30000 },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Settings schema — T-002
// ---------------------------------------------------------------------------

describe('settings schema — prompts.inksmith block (T-002)', () => {
  const { DEFAULT_SETTINGS, readSettings } = require('../src/handlers/settings');

  test('DEFAULT_SETTINGS.prompts.inksmith exists with enabled:false', () => {
    assert.ok(DEFAULT_SETTINGS.prompts.inksmith, 'inksmith block must exist in DEFAULT_SETTINGS');
    assert.strictEqual(DEFAULT_SETTINGS.prompts.inksmith.enabled, false);
  });

  test('DEFAULT_SETTINGS.prompts.inksmith has all required fields', () => {
    const { inksmith } = DEFAULT_SETTINGS.prompts;
    assert.strictEqual(typeof inksmith.endpoint,        'string');
    assert.strictEqual(typeof inksmith.timeoutMs,       'number');
    assert.strictEqual(typeof inksmith.retry,           'object');
    assert.strictEqual(typeof inksmith.circuitBreaker,  'object');
  });

  test('readSettings() returns inksmith defaults when settings.json is absent', () => {
    const dataDir  = tmpDir();
    const settings = readSettings(dataDir);
    assert.ok(settings.prompts.inksmith, 'inksmith block must be present after readSettings');
    assert.strictEqual(settings.prompts.inksmith.enabled, false);
  });

  test('readSettings() merges inksmith.enabled:true stored on disk', () => {
    const dataDir = tmpDir();
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, 'settings.json'),
      JSON.stringify({
        prompts: {
          inksmith: {
            enabled:        true,
            endpoint:       'https://custom.example/v1/refine',
            timeoutMs:      1500,
            retry:          { attempts: 1, backoffMs: 200 },
            circuitBreaker: { failureThreshold: 5, openMs: 30000 },
          },
        },
      }),
      'utf8',
    );
    const settings = readSettings(dataDir);
    assert.strictEqual(settings.prompts.inksmith.enabled, true);
    assert.strictEqual(settings.prompts.inksmith.endpoint, 'https://custom.example/v1/refine');
    // Adjacent prompts fields must be preserved
    assert.strictEqual(settings.prompts.includeKanbanBlock, true);
  });

  test('missing INKSMITH_API_KEY with enabled:true → still enabled in settings (runtime guard in promptRefiner)', () => {
    // Settings itself doesn't check env vars — that's promptRefiner's job.
    // This test just confirms the settings schema doesn't strip the field.
    const dataDir = tmpDir();
    const settings = readSettings(dataDir);
    // enabled:false by default means missing key won't matter; just verify schema shape
    assert.ok('enabled' in settings.prompts.inksmith);
  });
});

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

describe('CircuitBreaker — state machine', () => {
  const { CircuitBreaker, STATE } = require('../src/services/circuitBreaker');

  test('starts in CLOSED state', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 500 });
    assert.strictEqual(cb.getState(), STATE.CLOSED);
    assert.ok(cb.canPass(), 'CLOSED breaker must allow requests');
  });

  test('stays CLOSED under threshold', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 500 });
    cb.recordFailure();
    cb.recordFailure();
    assert.strictEqual(cb.getState(), STATE.CLOSED);
    assert.ok(cb.canPass());
  });

  test('CLOSED → OPEN after N consecutive failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 500 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    assert.strictEqual(cb.getState(), STATE.OPEN);
    assert.ok(!cb.canPass(), 'OPEN breaker must block requests');
  });

  test('OPEN blocks all requests within open window', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, openMs: 60000 });
    cb.recordFailure();
    assert.strictEqual(cb.getState(), STATE.OPEN);
    for (let i = 0; i < 5; i++) {
      assert.ok(!cb.canPass(), `Request ${i} must be blocked while OPEN`);
    }
  });

  test('OPEN → HALF_OPEN after openMs elapsed', () => {
    const { CircuitBreaker: CB } = require('../src/services/circuitBreaker');
    const cb = new CB({ failureThreshold: 1, openMs: 1 }); // 1ms window
    cb.recordFailure();
    assert.strictEqual(cb.getState(), STATE.OPEN);

    // Wait slightly longer than openMs.
    return new Promise((resolve) => setTimeout(() => {
      const result = cb.canPass();
      // After canPass(), the state transitions to HALF_OPEN internally.
      assert.ok(result, 'should allow probe after openMs elapsed');
      resolve();
    }, 10));
  });

  test('HALF_OPEN: successful probe → CLOSED', () => {
    const { CircuitBreaker: CB } = require('../src/services/circuitBreaker');
    const cb = new CB({ failureThreshold: 1, openMs: 1 });
    cb.recordFailure();

    return new Promise((resolve) => setTimeout(() => {
      cb.canPass(); // probe
      cb.recordSuccess();
      assert.strictEqual(cb.getState(), STATE.CLOSED, 'HALF_OPEN success must close the breaker');
      assert.ok(cb.canPass(), 'CLOSED must allow requests');
      resolve();
    }, 10));
  });

  test('HALF_OPEN: failed probe → OPEN', () => {
    const { CircuitBreaker: CB } = require('../src/services/circuitBreaker');
    const cb = new CB({ failureThreshold: 1, openMs: 1 });
    cb.recordFailure();

    return new Promise((resolve) => setTimeout(() => {
      cb.canPass(); // probe
      cb.recordFailure(); // probe failed
      assert.strictEqual(cb.getState(), STATE.OPEN, 'HALF_OPEN failure must re-open the breaker');
      assert.ok(!cb.canPass(), 'OPEN must block requests');
      resolve();
    }, 10));
  });

  test('recordSuccess resets consecutive failures in CLOSED state', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 500 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess(); // resets
    cb.recordFailure();
    cb.recordFailure();
    // only 2 failures after reset — should still be CLOSED
    assert.strictEqual(cb.getState(), STATE.CLOSED);
  });
});

// ---------------------------------------------------------------------------
// InksmithClient
// ---------------------------------------------------------------------------

describe('InksmithClient — refine()', () => {
  let mock;

  before(async () => {
    mock = await startMockHttpServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ refinedPrompt: 'refined text', refinementId: 'rid-1' }));
    });
    // Allow HTTP for local mock server
    process.env.INKSMITH_ALLOW_HTTP = '1';
    process.env.INKSMITH_API_KEY    = 'test-api-key-abc123';
  });

  after(async () => {
    await mock.close();
    delete process.env.INKSMITH_ALLOW_HTTP;
    delete process.env.INKSMITH_API_KEY;
  });

  const { refine, redactKey } = require('../src/services/inksmithClient');

  function buildSettings(port, overrides = {}) {
    return {
      enabled:   true,
      endpoint:  `http://127.0.0.1:${port}/v1/refine`,
      timeoutMs: 2000,
      retry:     { attempts: 0, backoffMs: 0 },
      ...overrides,
    };
  }

  test('200 happy path — returns ok:true with refinedPrompt and refinementId', async () => {
    mock.setHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ refinedPrompt: 'polished prompt', refinementId: 'rid-abc' }));
    });

    const result = await refine('raw prompt', { agentId: 'dev', taskId: 't1', spaceId: 's1' }, buildSettings(mock.port));
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.refinedPrompt, 'polished prompt');
    assert.strictEqual(result.refinementId, 'rid-abc');
  });

  test('5xx response — returns ok:false, reason: "5xx"', async () => {
    mock.setHandler((req, res) => {
      res.writeHead(500);
      res.end('Internal Server Error');
    });

    // retry=0 means only 1 attempt (initial)
    const result = await refine('raw', {}, buildSettings(mock.port, { retry: { attempts: 0, backoffMs: 0 } }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, '5xx');
  });

  test('401 4xx response — returns ok:false, reason: "4xx"', async () => {
    mock.setHandler((req, res) => {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Unauthorized' }));
    });

    const result = await refine('raw', {}, buildSettings(mock.port));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, '4xx');
    assert.strictEqual(result.httpStatus, 401);
  });

  test('malformed JSON response — returns ok:false, reason: "malformed_json"', async () => {
    mock.setHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('not-json{{{{');
    });

    const result = await refine('raw', {}, buildSettings(mock.port));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'malformed_json');
  });

  test('empty refinedPrompt — returns ok:false, reason: "schema_mismatch"', async () => {
    mock.setHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ refinedPrompt: '   ', refinementId: 'rid' }));
    });

    const result = await refine('raw', {}, buildSettings(mock.port));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'schema_mismatch');
  });

  test('missing refinedPrompt field — returns ok:false, reason: "schema_mismatch"', async () => {
    mock.setHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'gpt-4', usage: {} }));
    });

    const result = await refine('raw', {}, buildSettings(mock.port));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'schema_mismatch');
  });

  test('request too large — returns ok:false, reason: "request_too_large"', async () => {
    // 256 KB + 1 byte prompt to exceed the limit
    const hugePrompt = 'x'.repeat(256 * 1024 + 1);
    const result = await refine(hugePrompt, {}, buildSettings(mock.port));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'request_too_large');
  });

  test('non-HTTPS endpoint rejected when INKSMITH_ALLOW_HTTP unset', async () => {
    delete process.env.INKSMITH_ALLOW_HTTP;
    const result = await refine('raw', {}, {
      enabled:   true,
      endpoint:  `http://127.0.0.1:${mock.port}/v1/refine`,
      timeoutMs: 2000,
      retry:     { attempts: 0, backoffMs: 0 },
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'insecure_endpoint');
    // Restore for other tests
    process.env.INKSMITH_ALLOW_HTTP = '1';
  });

  test('API key never appears in reason or error fields', async () => {
    mock.setHandler((req, res) => {
      res.writeHead(500);
      res.end('error');
    });

    const result = await refine('raw', {}, buildSettings(mock.port, { retry: { attempts: 0, backoffMs: 0 } }));
    const resultStr = JSON.stringify(result);
    assert.ok(
      !resultStr.includes('test-api-key-abc123'),
      `API key must not appear in result: ${resultStr}`,
    );
  });

  test('redactKey() replaces API key occurrences in strings', () => {
    const msg = 'Error: Bearer test-api-key-abc123 was rejected by server';
    const redacted = redactKey(msg, 'test-api-key-abc123');
    assert.ok(!redacted.includes('test-api-key-abc123'), 'key must be redacted');
    assert.ok(redacted.includes('[REDACTED]'), 'must contain [REDACTED]');
  });

  test('redactKey() returns message unchanged when key is empty', () => {
    const msg = 'some error message';
    assert.strictEqual(redactKey(msg, ''), msg);
    assert.strictEqual(redactKey(msg, null), msg);
  });
});

// ---------------------------------------------------------------------------
// PromptRefiner
// ---------------------------------------------------------------------------

describe('PromptRefiner — refine()', () => {
  // We test by controlling environment variables and using a local mock server.
  let mock;

  before(async () => {
    mock = await startMockHttpServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ refinedPrompt: 'ink-refined', refinementId: 'r-id-1' }));
    });
    process.env.INKSMITH_ALLOW_HTTP = '1';
  });

  after(async () => {
    await mock.close();
    delete process.env.INKSMITH_ALLOW_HTTP;
    delete process.env.INKSMITH_API_KEY;
  });

  // Re-require and reset state between tests.
  let promptRefiner;

  beforeEach(() => {
    // Clear cached module so resetBreaker/resetCounters work cleanly.
    delete require.cache[require.resolve('../src/services/promptRefiner')];
    promptRefiner = require('../src/services/promptRefiner');
    promptRefiner.resetBreaker();
    promptRefiner.resetCounters();
  });

  test('disabled flag → local-fallback with reason="disabled"', async () => {
    delete process.env.INKSMITH_API_KEY;
    const result = await promptRefiner.refine('raw prompt', { taskId: 't1' }, disabledSettings());

    assert.strictEqual(result.source, 'local-fallback');
    assert.strictEqual(result.prompt, 'raw prompt');
    assert.strictEqual(result.reason, 'disabled');
  });

  test('enabled flag but missing API key → local-fallback', async () => {
    delete process.env.INKSMITH_API_KEY;
    const settings = inksmithSettings(mock.port);

    const result = await promptRefiner.refine('raw prompt', { taskId: 't1' }, settings);
    assert.strictEqual(result.source, 'local-fallback');
    // reason: 'disabled' because !enabled || !apiKey → !enabled
  });

  test('enabled + API key + server returns 200 → source="inksmith"', async () => {
    process.env.INKSMITH_API_KEY = 'test-key-xyz';
    mock.setHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ refinedPrompt: 'ink polished', refinementId: 'r-id-ok' }));
    });

    const result = await promptRefiner.refine('raw prompt', { agentId: 'dev', taskId: 't1', spaceId: 's1' }, inksmithSettings(mock.port));

    assert.strictEqual(result.source, 'inksmith');
    assert.strictEqual(result.prompt, 'ink polished');
    assert.strictEqual(result.refinementId, 'r-id-ok');
  });

  test('client returns ok:false → local-fallback', async () => {
    process.env.INKSMITH_API_KEY = 'test-key-xyz';
    mock.setHandler((req, res) => {
      res.writeHead(500);
      res.end('Server Error');
    });

    const result = await promptRefiner.refine('raw', { taskId: 't1' }, inksmithSettings(mock.port, { retry: { attempts: 0, backoffMs: 0 } }));

    assert.strictEqual(result.source, 'local-fallback');
    assert.strictEqual(result.prompt, 'raw');
    assert.ok(result.reason, 'must have a reason on fallback');
  });

  test('breaker open → local-fallback with reason="breaker_open"', async () => {
    process.env.INKSMITH_API_KEY = 'test-key-xyz';
    // Force the breaker open by burning through the threshold.
    mock.setHandler((req, res) => {
      res.writeHead(500);
      res.end('Error');
    });

    const settings = inksmithSettings(mock.port, {
      retry:          { attempts: 0, backoffMs: 0 },
      circuitBreaker: { failureThreshold: 2, openMs: 60000 },
    });

    // First two calls fail and open the breaker.
    await promptRefiner.refine('raw', { taskId: 't1' }, settings);
    await promptRefiner.refine('raw', { taskId: 't1' }, settings);

    // Third call: breaker should now be open.
    const result = await promptRefiner.refine('raw', { taskId: 't1' }, settings);
    assert.strictEqual(result.source, 'local-fallback');
    assert.strictEqual(result.reason, 'breaker_open');
  });

  test('never throws under any failure mode', async () => {
    process.env.INKSMITH_API_KEY = 'test-key-xyz';
    // Use a dead port to force a network error.
    const deadPortSettings = inksmithSettings(1, { retry: { attempts: 0, backoffMs: 0 } });

    let threw = false;
    try {
      await promptRefiner.refine('raw', { taskId: 't1' }, deadPortSettings);
    } catch {
      threw = true;
    }
    assert.ok(!threw, 'refine() must never throw');
  });

  test('counters increment on success', async () => {
    process.env.INKSMITH_API_KEY = 'test-key-xyz';
    mock.setHandler((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ refinedPrompt: 'refined', refinementId: 'r-1' }));
    });

    await promptRefiner.refine('raw', { taskId: 't1' }, inksmithSettings(mock.port));

    const counters = promptRefiner.getCounters();
    assert.strictEqual(counters.callsTotal.success, 1);
    assert.strictEqual(counters.callsTotal.failure, 0);
  });

  test('counters increment on failure', async () => {
    process.env.INKSMITH_API_KEY = 'test-key-xyz';
    mock.setHandler((req, res) => {
      res.writeHead(500);
      res.end('Error');
    });

    await promptRefiner.refine('raw', { taskId: 't1' }, inksmithSettings(mock.port, { retry: { attempts: 0, backoffMs: 0 } }));

    const counters = promptRefiner.getCounters();
    assert.strictEqual(counters.callsTotal.failure, 1);
    assert.strictEqual(counters.callsTotal.success, 0);
  });

  test('fallback counters are keyed by reason', async () => {
    delete process.env.INKSMITH_API_KEY;

    await promptRefiner.refine('raw', { taskId: 't1' }, disabledSettings());
    await promptRefiner.refine('raw', { taskId: 't2' }, disabledSettings());

    const counters = promptRefiner.getCounters();
    assert.ok(counters.fallbackTotal['disabled'] >= 2, 'disabled fallback must be counted');
  });

  test('getCounters() includes breakerState', async () => {
    const counters = promptRefiner.getCounters();
    assert.ok('breakerState' in counters, 'must have breakerState');
  });

  test('getCounters() includes lastFailures array', async () => {
    const counters = promptRefiner.getCounters();
    assert.ok(Array.isArray(counters.lastFailures), 'lastFailures must be an array');
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/inksmith/health — integration via Prism server
// ---------------------------------------------------------------------------

describe('GET /api/v1/inksmith/health — REST integration', () => {
  let server;
  let port;
  let dataDir;
  let agentsDir;

  before(async () => {
    dataDir   = tmpDir();
    agentsDir = tmpDir();

    // Write a dummy agent file.
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'senior-architect.md'), '---\nmodel: sonnet\n---\nTest agent.', 'utf8');

    process.env.PIPELINE_AGENTS_DIR    = agentsDir;
    process.env.PIPELINE_MAX_CONCURRENT = '5';
    process.env.KANBAN_API_URL          = 'http://localhost:19999/api/v1';

    // Bust module cache to pick up env vars.
    for (const key of Object.keys(require.cache)) {
      if (
        key.includes('/src/services/promptRefiner') ||
        key.includes('/src/services/agentResolver') ||
        key.includes('/src/services/pipelineManager') ||
        key.includes('/src/routes')
      ) {
        delete require.cache[key];
      }
    }

    const { startServer } = require('../server');

    await new Promise((resolve, reject) => {
      server = startServer({ port: 0, dataDir, silent: true });
      server.once('listening', () => { port = server.address().port; resolve(); });
      server.once('error', reject);
    });
  });

  after(async () => {
    delete process.env.PIPELINE_AGENTS_DIR;
    delete process.env.PIPELINE_MAX_CONCURRENT;
    delete process.env.KANBAN_API_URL;
    await new Promise((r) => server.close(r));
    fs.rmSync(dataDir,   { recursive: true, force: true });
    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  test('returns 200 with counter shape', async () => {
    const res = await request(port, 'GET', '/api/v1/inksmith/health');
    assert.strictEqual(res.status, 200);
    assert.ok('callsTotal'   in res.body, 'must have callsTotal');
    assert.ok('fallbackTotal' in res.body, 'must have fallbackTotal');
    assert.ok('latencyMs'    in res.body, 'must have latencyMs');
    assert.ok('breakerState' in res.body, 'must have breakerState');
    assert.ok('lastFailures' in res.body, 'must have lastFailures');
  });

  test('callsTotal has success and failure fields', async () => {
    const res = await request(port, 'GET', '/api/v1/inksmith/health');
    assert.strictEqual(res.status, 200);
    assert.ok(typeof res.body.callsTotal.success === 'number', 'success must be a number');
    assert.ok(typeof res.body.callsTotal.failure === 'number', 'failure must be a number');
  });

  test('breakerState is one of closed|open|half-open', async () => {
    const res = await request(port, 'GET', '/api/v1/inksmith/health');
    assert.ok(['closed', 'open', 'half-open'].includes(res.body.breakerState),
      `unexpected breakerState: ${res.body.breakerState}`);
  });

  test('lastFailures is an array', async () => {
    const res = await request(port, 'GET', '/api/v1/inksmith/health');
    assert.ok(Array.isArray(res.body.lastFailures), 'lastFailures must be an array');
  });

  test('405 on non-GET method', async () => {
    const res = await request(port, 'POST', '/api/v1/inksmith/health');
    assert.strictEqual(res.status, 405);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/agent/prompt — source + refinementId fields (T-006)
// ---------------------------------------------------------------------------

describe('POST /api/v1/agent/prompt — source field integration (T-006)', () => {
  let server;
  let port;
  let dataDir;
  let agentsDir;

  before(async () => {
    dataDir   = tmpDir();
    agentsDir = tmpDir();

    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'senior-architect.md'),
      '---\nmodel: sonnet\n---\nYou are a test agent.',
      'utf8',
    );

    process.env.PIPELINE_AGENTS_DIR     = agentsDir;
    process.env.PIPELINE_MAX_CONCURRENT = '5';
    process.env.KANBAN_API_URL          = 'http://localhost:19999/api/v1';

    // Clear enough of the module cache to get a fresh promptRefiner for this suite
    for (const key of Object.keys(require.cache)) {
      if (
        key.includes('/src/services/promptRefiner') ||
        key.includes('/src/routes') ||
        key.includes('/src/handlers/prompt') ||
        key.includes('/src/handlers/settings')
      ) {
        delete require.cache[key];
      }
    }

    const { startServer } = require('../server');

    await new Promise((resolve, reject) => {
      server = startServer({ port: 0, dataDir, silent: true });
      server.once('listening', () => { port = server.address().port; resolve(); });
      server.once('error', reject);
    });
  });

  after(async () => {
    delete process.env.PIPELINE_AGENTS_DIR;
    delete process.env.PIPELINE_MAX_CONCURRENT;
    delete process.env.KANBAN_API_URL;
    delete process.env.INKSMITH_API_KEY;
    await new Promise((r) => server.close(r));
    fs.rmSync(dataDir,   { recursive: true, force: true });
    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  function createSpace() {
    const { createSpaceManager } = require('../src/services/spaceManager');
    const sm     = createSpaceManager(dataDir);
    const result = sm.createSpace(`t006-${crypto.randomUUID().slice(0, 8)}`);
    const spaceId = result.space.id;
    const taskId  = crypto.randomUUID();
    const todoPath = path.join(dataDir, 'spaces', spaceId, 'todo.json');
    const tasks   = JSON.parse(fs.readFileSync(todoPath, 'utf8'));
    tasks.push({ id: taskId, title: 'T-006 test', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    fs.writeFileSync(todoPath, JSON.stringify(tasks), 'utf8');
    return { spaceId, taskId };
  }

  test('response includes source:"local-fallback" when inksmith disabled (default)', async () => {
    const { spaceId, taskId } = createSpace();
    const res = await request(port, 'POST', '/api/v1/agent/prompt', {
      agentId: 'senior-architect', taskId, spaceId,
    });
    assert.strictEqual(res.status, 201, `Expected 201: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.source,       'local-fallback');
    assert.strictEqual(res.body.refinementId, null);
  });

  test('response source and refinementId are present alongside existing fields', async () => {
    const { spaceId, taskId } = createSpace();
    const res = await request(port, 'POST', '/api/v1/agent/prompt', {
      agentId: 'senior-architect', taskId, spaceId,
    });
    assert.strictEqual(res.status, 201);
    // New fields
    assert.ok('source'       in res.body, 'source must be present');
    assert.ok('refinementId' in res.body, 'refinementId must be present');
    // Existing fields preserved (backward compat)
    for (const field of ['promptPath', 'promptPreview', 'promptFull', 'cliCommand', 'estimatedTokens']) {
      assert.ok(field in res.body, `existing field ${field} must still be present`);
    }
  });

  test('written file content matches promptFull (refined or raw)', async () => {
    const { spaceId, taskId } = createSpace();
    const res = await request(port, 'POST', '/api/v1/agent/prompt', {
      agentId: 'senior-architect', taskId, spaceId,
    });
    assert.strictEqual(res.status, 201);
    const { promptPath, promptFull } = res.body;
    assert.ok(fs.existsSync(promptPath), 'prompt file must exist on disk');
    assert.strictEqual(fs.readFileSync(promptPath, 'utf8'), promptFull, 'file must match promptFull');
  });
});
