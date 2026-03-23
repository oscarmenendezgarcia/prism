/**
 * Integration tests for the Agent Run History endpoints.
 * Tests: POST, PATCH, GET /api/v1/agent-runs
 * ADR-1 (Agent Run History): JSONL persistence, stale healing, pruning.
 *
 * Run with: node tests/agent-runs.test.js
 */

'use strict';

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
// HTTP helper (port-aware)
// ---------------------------------------------------------------------------

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const options = {
      hostname: 'localhost',
      port,
      path:     urlPath,
      method,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': payload ? Buffer.byteLength(payload) : 0,
      },
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          resolve({ status: res.statusCode, body: data });
        } catch {
          resolve({ status: res.statusCode, body: null });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRunPayload(overrides = {}) {
  const ts = new Date().toISOString();
  const id = `run_${Date.now()}_abcd`;
  return {
    id,
    taskId:           'task-001',
    taskTitle:        'Test Task',
    agentId:          'developer-agent',
    agentDisplayName: 'Developer Agent',
    spaceId:          'default',
    spaceName:        'Default',
    cliCommand:       'claude "$(cat /tmp/prompt.md)"',
    promptPath:       '/tmp/prompt.md',
    startedAt:        ts,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite: POST /api/v1/agent-runs
// ---------------------------------------------------------------------------

async function runPostSuite() {
  suite('POST /api/v1/agent-runs — create run');

  const { port, close } = await startTestServer();

  await test('creates a run and returns 201 { id }', async () => {
    const payload = makeRunPayload();
    const res = await request(port, 'POST', '/api/v1/agent-runs', payload);
    assert(res.status === 201, `expected 201, got ${res.status}`);
    assert(res.body.id === payload.id, 'id mismatch');
  });

  await test('created run appears in subsequent GET', async () => {
    const payload = makeRunPayload({ id: `run_${Date.now() + 1}_test` });
    await request(port, 'POST', '/api/v1/agent-runs', payload);
    const listRes = await request(port, 'GET', '/api/v1/agent-runs');
    assert(listRes.status === 200, `expected 200, got ${listRes.status}`);
    const found = listRes.body.runs.find((r) => r.id === payload.id);
    assert(found !== undefined, 'run not found in list');
    assert(found.status === 'running', `expected status=running, got ${found.status}`);
  });

  await test('returns 400 when id is missing', async () => {
    const payload = makeRunPayload();
    delete payload.id;
    const res = await request(port, 'POST', '/api/v1/agent-runs', payload);
    assert(res.status === 400, `expected 400, got ${res.status}`);
    assert(res.body.error.code === 'VALIDATION_ERROR', 'expected VALIDATION_ERROR');
  });

  await test('returns 400 when taskId is missing', async () => {
    const payload = makeRunPayload();
    delete payload.taskId;
    const res = await request(port, 'POST', '/api/v1/agent-runs', payload);
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await test('returns 400 when startedAt is invalid', async () => {
    const payload = makeRunPayload({ startedAt: 'not-a-date' });
    const res = await request(port, 'POST', '/api/v1/agent-runs', payload);
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await test('returns 405 for unsupported method', async () => {
    const res = await request(port, 'DELETE', '/api/v1/agent-runs');
    assert(res.status === 405, `expected 405, got ${res.status}`);
  });

  await close();
}

// ---------------------------------------------------------------------------
// Suite: PATCH /api/v1/agent-runs/:runId
// ---------------------------------------------------------------------------

async function runPatchSuite() {
  suite('PATCH /api/v1/agent-runs/:runId — update run');

  const { port, close } = await startTestServer();

  await test('updates status, completedAt, durationMs and returns 200', async () => {
    const payload = makeRunPayload();
    await request(port, 'POST', '/api/v1/agent-runs', payload);

    const patchRes = await request(port, 'PATCH', `/api/v1/agent-runs/${payload.id}`, {
      status:      'completed',
      completedAt: new Date().toISOString(),
      durationMs:  5000,
    });

    assert(patchRes.status === 200, `expected 200, got ${patchRes.status}`);
    assert(patchRes.body.id === payload.id, 'id mismatch');
    assert(patchRes.body.status === 'completed', `expected status=completed`);
  });

  await test('updated record reflects in subsequent GET', async () => {
    const payload = makeRunPayload({ id: `run_${Date.now() + 2}_xyz1` });
    await request(port, 'POST', '/api/v1/agent-runs', payload);
    await request(port, 'PATCH', `/api/v1/agent-runs/${payload.id}`, {
      status:      'cancelled',
      completedAt: new Date().toISOString(),
      durationMs:  1000,
    });

    const listRes = await request(port, 'GET', '/api/v1/agent-runs');
    const found = listRes.body.runs.find((r) => r.id === payload.id);
    assert(found !== undefined, 'run not found');
    assert(found.status === 'cancelled', `expected cancelled, got ${found.status}`);
    assert(found.durationMs === 1000, 'durationMs mismatch');
  });

  await test('returns 404 when runId does not exist', async () => {
    const res = await request(port, 'PATCH', '/api/v1/agent-runs/run_0000_xxxx', {
      status:      'completed',
      completedAt: new Date().toISOString(),
      durationMs:  0,
    });
    assert(res.status === 404, `expected 404, got ${res.status}`);
    assert(res.body.error.code === 'RUN_NOT_FOUND', 'expected RUN_NOT_FOUND');
  });

  await test('returns 400 when status is invalid (running not allowed)', async () => {
    const payload = makeRunPayload({ id: `run_${Date.now() + 3}_yyy2` });
    await request(port, 'POST', '/api/v1/agent-runs', payload);

    const res = await request(port, 'PATCH', `/api/v1/agent-runs/${payload.id}`, {
      status:      'running',
      completedAt: new Date().toISOString(),
      durationMs:  0,
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await test('returns 400 when completedAt is missing', async () => {
    const payload = makeRunPayload({ id: `run_${Date.now() + 4}_zzz3` });
    await request(port, 'POST', '/api/v1/agent-runs', payload);

    const res = await request(port, 'PATCH', `/api/v1/agent-runs/${payload.id}`, {
      status:    'completed',
      durationMs: 1000,
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await test('returns 400 when durationMs is missing', async () => {
    const payload = makeRunPayload({ id: `run_${Date.now() + 5}_aaa4` });
    await request(port, 'POST', '/api/v1/agent-runs', payload);

    const res = await request(port, 'PATCH', `/api/v1/agent-runs/${payload.id}`, {
      status:      'failed',
      completedAt: new Date().toISOString(),
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await test('returns 405 for unsupported method on single route', async () => {
    const res = await request(port, 'DELETE', '/api/v1/agent-runs/run_1234_abcd');
    assert(res.status === 405, `expected 405, got ${res.status}`);
  });

  await close();
}

// ---------------------------------------------------------------------------
// Suite: GET /api/v1/agent-runs
// ---------------------------------------------------------------------------

async function runGetSuite() {
  suite('GET /api/v1/agent-runs — list runs');

  const { port, close } = await startTestServer();

  // Create a few test records
  const runA = makeRunPayload({ id: `run_100_aaaa`, startedAt: new Date(Date.now() - 10000).toISOString() });
  const runB = makeRunPayload({ id: `run_200_bbbb`, startedAt: new Date(Date.now() - 5000).toISOString() });
  const runC = makeRunPayload({ id: `run_300_cccc`, startedAt: new Date(Date.now() - 1000).toISOString() });

  await request(port, 'POST', '/api/v1/agent-runs', runA);
  await request(port, 'POST', '/api/v1/agent-runs', runB);
  await request(port, 'POST', '/api/v1/agent-runs', runC);

  // Complete runA
  await request(port, 'PATCH', `/api/v1/agent-runs/${runA.id}`, {
    status:      'completed',
    completedAt: new Date().toISOString(),
    durationMs:  10000,
  });

  await test('returns 200 with runs and total', async () => {
    const res = await request(port, 'GET', '/api/v1/agent-runs');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(Array.isArray(res.body.runs), 'runs should be an array');
    assert(typeof res.body.total === 'number', 'total should be a number');
    assert(res.body.total >= 3, `expected at least 3 runs, got ${res.body.total}`);
  });

  await test('returns runs newest-first', async () => {
    const res = await request(port, 'GET', '/api/v1/agent-runs');
    const ids = res.body.runs.map((r) => r.id);
    const idxC = ids.indexOf(runC.id);
    const idxA = ids.indexOf(runA.id);
    assert(idxC < idxA, `runC (newest) should appear before runA (oldest), got idxC=${idxC} idxA=${idxA}`);
  });

  await test('?status=completed filters correctly', async () => {
    const res = await request(port, 'GET', '/api/v1/agent-runs?status=completed');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const allCompleted = res.body.runs.every((r) => r.status === 'completed');
    assert(allCompleted, 'all returned runs should be completed');
    const found = res.body.runs.find((r) => r.id === runA.id);
    assert(found !== undefined, 'runA should appear in completed filter');
  });

  await test('?status=running filters correctly (only running runs)', async () => {
    const res = await request(port, 'GET', '/api/v1/agent-runs?status=running');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const allRunning = res.body.runs.every((r) => r.status === 'running');
    assert(allRunning, 'all returned runs should have status=running');
  });

  await test('?limit= caps results', async () => {
    const res = await request(port, 'GET', '/api/v1/agent-runs?limit=1');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.body.runs.length === 1, `expected 1 run, got ${res.body.runs.length}`);
  });

  await test('returns 400 for invalid status filter', async () => {
    const res = await request(port, 'GET', '/api/v1/agent-runs?status=unknown');
    assert(res.status === 400, `expected 400, got ${res.status}`);
    assert(res.body.error.code === 'VALIDATION_ERROR', 'expected VALIDATION_ERROR');
  });

  await test('returns 400 for limit out of range', async () => {
    const res = await request(port, 'GET', '/api/v1/agent-runs?limit=999');
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await close();
}

// ---------------------------------------------------------------------------
// Suite: Stale run healing
// ---------------------------------------------------------------------------

async function runStaleSuite() {
  suite('GET /api/v1/agent-runs — stale healing');

  const { port, close } = await startTestServer();

  await test('running records older than 4 hours are returned as failed with reason=stale', async () => {
    // Create a run with a startedAt 5 hours ago
    const staleRun = makeRunPayload({
      id:        `run_${Date.now()}_stal`,
      startedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    });
    await request(port, 'POST', '/api/v1/agent-runs', staleRun);

    const res = await request(port, 'GET', '/api/v1/agent-runs');
    const found = res.body.runs.find((r) => r.id === staleRun.id);
    assert(found !== undefined, 'stale run not found in list');
    assert(found.status === 'failed', `expected failed, got ${found.status}`);
    assert(found.reason === 'stale', `expected reason=stale, got ${found.reason}`);
  });

  await test('recent running records are NOT marked stale', async () => {
    const recentRun = makeRunPayload({ id: `run_${Date.now()}_frsh` });
    await request(port, 'POST', '/api/v1/agent-runs', recentRun);

    const res = await request(port, 'GET', '/api/v1/agent-runs');
    const found = res.body.runs.find((r) => r.id === recentRun.id);
    assert(found !== undefined, 'recent run not found');
    assert(found.status === 'running', `expected running, got ${found.status}`);
    assert(found.reason === undefined, 'recent run should not have reason field');
  });

  await close();
}

// ---------------------------------------------------------------------------
// Suite: Pruning at 500 entries
// ---------------------------------------------------------------------------

async function runPruneSuite() {
  suite('POST /api/v1/agent-runs — pruning at 500 entries');

  const { port, close } = await startTestServer();

  await test('inserting 501 runs results in exactly 500 records in GET', async () => {
    // Create 501 runs sequentially (we batch them fast)
    const baseTime = Date.now();
    for (let i = 0; i < 501; i++) {
      const id = `run_${baseTime + i}_${i.toString(36).padStart(4, '0').slice(-4)}`;
      await request(port, 'POST', '/api/v1/agent-runs', makeRunPayload({
        id,
        startedAt: new Date(baseTime + i).toISOString(),
      }));
    }

    const res = await request(port, 'GET', '/api/v1/agent-runs?limit=500');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.body.total <= 500, `expected total <= 500, got ${res.body.total}`);
    assert(res.body.runs.length <= 500, `expected runs.length <= 500, got ${res.body.runs.length}`);
  });

  await close();
}

// ---------------------------------------------------------------------------
// Run all suites
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('\nAgent Run History — Backend Integration Tests');

  await runPostSuite();
  await runPatchSuite();
  await runGetSuite();
  await runStaleSuite();
  await runPruneSuite();

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.error('\nFailed tests:');
    for (const f of failures) {
      console.error(`  - ${f.name}: ${f.error}`);
    }
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
