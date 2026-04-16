/**
 * Integration tests for pipeline block/unblock feature.
 *
 * Tests:
 *   POST /api/v1/runs/:runId/block   — handleBlockRun
 *   POST /api/v1/runs/:runId/unblock — handleUnblockRun
 *
 * Run: node tests/pipeline-blocked.test.js
 * Starts an isolated server on a random port with a temporary data directory.
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const http   = require('http');
const os     = require('os');
const path   = require('path');
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

function suite(name) { console.log(`\n${name}`); }

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
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  };
}

// ---------------------------------------------------------------------------
// Helpers: create a run in a given state by directly writing run.json
// ---------------------------------------------------------------------------

/**
 * Write a fake run.json directly into the data/runs/<runId>/ directory
 * so we can test block/unblock without actually spawning Claude.
 */
function seedRun(dataDir, runId, overrides = {}) {
  const now     = new Date().toISOString();
  const runsDir = path.join(dataDir, 'runs');
  const runDirP = path.join(runsDir, runId);
  fs.mkdirSync(runDirP, { recursive: true });

  const run = {
    runId,
    spaceId: overrides.spaceId ?? 'test-space',
    taskId:  overrides.taskId  ?? 'test-task',
    stages:  ['developer-agent', 'qa-engineer-e2e'],
    currentStage: 0,
    status:  overrides.status  ?? 'running',
    stageStatuses: [
      { index: 0, agentId: 'developer-agent', status: overrides.stage0Status ?? 'running', exitCode: null, startedAt: now, finishedAt: null },
      { index: 1, agentId: 'qa-engineer-e2e',  status: 'pending', exitCode: null, startedAt: null, finishedAt: null },
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  fs.writeFileSync(path.join(runDirP, 'run.json'), JSON.stringify(run, null, 2), 'utf8');

  // Also update the registry
  const registryPath = path.join(runsDir, 'runs.json');
  let registry = [];
  if (fs.existsSync(registryPath)) {
    try { registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')); } catch {}
  }
  const idx = registry.findIndex((r) => r.runId === runId);
  const summary = { runId, spaceId: run.spaceId, taskId: run.taskId, status: run.status, createdAt: run.createdAt };
  if (idx === -1) registry.push(summary);
  else registry[idx] = summary;
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');

  return run;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

async function run() {
  const { port, close } = await startTestServer();
  const request = makeRequest(port);

  // We need the server's dataDir to seed fake runs. Grab it by asking system info
  // (which exists) — but we don't have a dataDir API. Instead, create a real
  // space+task and start a pipeline (which fails immediately since agents are stubs)
  // so we have a real runId from the registry. Alternatively, seed manually.
  // For block/unblock tests, we seed runs directly using the TMP dir trick:
  // We'll read the dataDir from the runs endpoint — if no runs yet, the path
  // is implicit. Instead let's use a different approach: use the GET /api/v1/runs
  // endpoint to find a recently created run's path.

  // Actually the cleanest approach: create a run via POST /api/v1/runs.
  // The pipeline will try to spawn stage 0 (stub agent) which will fail fast.
  // We just need the runId. We can then poke run.json directly. But we don't
  // know dataDir from outside the server process.

  // PLAN: use GET /api/v1/runs to discover the runs dir by reading a known
  // run.json path. Since we can't do that from outside, we'll use the API only.

  // Actually: we just POST /runs (creates run + spawns stub → quick failure or
  // completes), wait briefly, then test block on the resulting runId.

  // For predictable tests, let's just call block/unblock with a fake runId first
  // (404 tests) then use the real pipeline creation pattern to get valid runIds.

  // ── First, create a space and task ─────────────────────────────────────────
  const spaceRes = await request('POST', '/api/v1/spaces', { name: 'blocked-test-space' });
  assert(spaceRes.status === 201, `Expected 201 creating space, got ${spaceRes.status}`);
  const spaceId = spaceRes.body.id;

  const taskRes = await request('POST', `/api/v1/spaces/${spaceId}/tasks`, {
    title: 'Task for blocked-pipeline tests',
    type:  'feature',
  });
  assert(taskRes.status === 201, `Expected 201 creating task, got ${taskRes.status}`);
  const taskId = taskRes.body.id;

  // ── Discover dataDir by starting a real run ─────────────────────────────────
  // The run will fail quickly (stubs exit 0 immediately).
  // We tolerate partial run lifecycle; we'll grab the runId and test block/unblock.
  // We create a "fake" run by calling the run endpoint, wait for it to appear in
  // the registry, then use its runId. But since stubs complete immediately the run
  // may already be 'completed' by the time we try to block it.
  //
  // To avoid timing issues, we use the lowest-level approach: direct file manipulation.
  // We get dataDir via inspecting a temp file created by startTestServer.
  // startTestServer returns { port, agentsDir, close }. We can derive dataDir from agentsDir.

  // Re-call startTestServer to get agentsDir path info — but we already have it.
  // Actually, startTestServer creates tmpDir = mkdtempSync(…) and agentsDir = tmpDir/agents.
  // But our startTestServer helper only returns { port, close } in older versions...

  // Let's check what helpers/server.js returns:
  // It returns { port, agentsDir, close }. So we can derive dataDir from agentsDir.
  // dataDir = parent of agentsDir... wait, agents are at tmpDir/agents where dataDir=tmpDir.

  // Actually the server.js startServer accepts { dataDir } and stores state there.
  // The startTestServer puts agents in tmpDir/agents. The server's dataDir IS tmpDir.
  // So: dataDir = path.dirname(agentsDir).

  // Let's re-do the test setup to capture dataDir:
  // (close the current server, restart with dataDir accessible)

  await close();

  // ── Restart server and capture dataDir ─────────────────────────────────────
  const { port: port2, agentsDir, close: close2 } = await (async () => {
    // Re-import to avoid module-level issues:
    const { startTestServer: sts } = require('./helpers/server');
    return sts();
  })();
  const req2    = makeRequest(port2);
  const dataDir = path.dirname(agentsDir);

  // Create space + task in new server instance
  const sp2 = await req2('POST', '/api/v1/spaces', { name: 'blocked-test-space' });
  assert(sp2.status === 201, `space create: ${sp2.status}`);
  const sid = sp2.body.id;

  const tk2 = await req2('POST', `/api/v1/spaces/${sid}/tasks`, { title: 'Blocked task', type: 'feature' });
  assert(tk2.status === 201, `task create: ${tk2.status}`);
  const tid = tk2.body.id;

  // ── Seed a fake run in 'running' state ──────────────────────────────────────

  const runId = crypto.randomUUID();
  seedRun(dataDir, runId, { spaceId: sid, taskId: tid, status: 'running', stage0Status: 'running' });

  // ── Tests ───────────────────────────────────────────────────────────────────

  suite('POST /api/v1/runs/:runId/block');

  await test('404 for unknown runId', async () => {
    const res = await req2('POST', '/api/v1/runs/nonexistent-id/block', {});
    assert(res.status === 404, `Expected 404, got ${res.status}`);
    assert(res.body.error?.code === 'RUN_NOT_FOUND', `Expected RUN_NOT_FOUND, got ${JSON.stringify(res.body)}`);
  });

  await test('405 for GET on block route', async () => {
    const res = await req2('GET', `/api/v1/runs/${runId}/block`);
    assert(res.status === 405, `Expected 405, got ${res.status}`);
  });

  await test('200 blocks a running pipeline', async () => {
    const res = await req2('POST', `/api/v1/runs/${runId}/block`, {});
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.status === 'blocked', `Expected status=blocked, got ${res.body.status}`);
    assert(res.body.runId === runId, 'runId mismatch');
  });

  await test('200 blocking already-blocked run is idempotent', async () => {
    const res = await req2('POST', `/api/v1/runs/${runId}/block`, {});
    assert(res.status === 200, `Expected 200 (idempotent), got ${res.status}`);
    assert(res.body.status === 'blocked', `Expected status=blocked, got ${res.body.status}`);
  });

  suite('POST /api/v1/runs/:runId/unblock');

  await test('404 for unknown runId', async () => {
    const res = await req2('POST', '/api/v1/runs/nonexistent-id/unblock', {});
    assert(res.status === 404, `Expected 404, got ${res.status}`);
    assert(res.body.error?.code === 'RUN_NOT_FOUND', `Expected RUN_NOT_FOUND, got ${JSON.stringify(res.body)}`);
  });

  await test('405 for GET on unblock route', async () => {
    const res = await req2('GET', `/api/v1/runs/${runId}/unblock`);
    assert(res.status === 405, `Expected 405, got ${res.status}`);
  });

  await test('200 unblocks a blocked pipeline', async () => {
    // Run is currently 'blocked' from the previous test block.
    const res = await req2('POST', `/api/v1/runs/${runId}/unblock`, {});
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.status === 'running', `Expected status=running, got ${res.body.status}`);
  });

  await test('422 unblocking a non-blocked run returns RUN_NOT_BLOCKED', async () => {
    // Run is now 'running' again — unblocking should fail.
    const res = await req2('POST', `/api/v1/runs/${runId}/unblock`, {});
    assert(res.status === 422, `Expected 422, got ${res.status}`);
    assert(res.body.error?.code === 'RUN_NOT_BLOCKED', `Expected RUN_NOT_BLOCKED, got ${JSON.stringify(res.body)}`);
  });

  suite('POST /api/v1/runs/:runId/block — terminal state guard');

  await test('422 blocking a completed run returns RUN_IN_TERMINAL_STATE', async () => {
    const completedRunId = crypto.randomUUID();
    seedRun(dataDir, completedRunId, { spaceId: sid, taskId: tid, status: 'completed', stage0Status: 'completed' });

    const res = await req2('POST', `/api/v1/runs/${completedRunId}/block`, {});
    assert(res.status === 422, `Expected 422, got ${res.status}`);
    assert(res.body.error?.code === 'RUN_IN_TERMINAL_STATE', `Expected RUN_IN_TERMINAL_STATE, got ${JSON.stringify(res.body)}`);
  });

  await test('422 blocking a failed run returns RUN_IN_TERMINAL_STATE', async () => {
    const failedRunId = crypto.randomUUID();
    seedRun(dataDir, failedRunId, { spaceId: sid, taskId: tid, status: 'failed', stage0Status: 'failed' });

    const res = await req2('POST', `/api/v1/runs/${failedRunId}/block`, {});
    assert(res.status === 422, `Expected 422, got ${res.status}`);
    assert(res.body.error?.code === 'RUN_IN_TERMINAL_STATE', `Expected RUN_IN_TERMINAL_STATE, got ${JSON.stringify(res.body)}`);
  });

  suite('GET /api/v1/runs — list includes blocked runs');

  await test('blocked run appears in run list with correct status', async () => {
    const listedRunId = crypto.randomUUID();
    seedRun(dataDir, listedRunId, { spaceId: sid, taskId: tid, status: 'blocked', stage0Status: 'running' });

    await req2('POST', `/api/v1/runs/${listedRunId}/block`, {});
    const listRes = await req2('GET', '/api/v1/runs');
    assert(listRes.status === 200, `Expected 200, got ${listRes.status}`);
    const entry = listRes.body.find((r) => r.runId === listedRunId);
    assert(entry, 'blocked run not found in list');
    assert(entry.status === 'blocked', `Expected status=blocked in list, got ${entry.status}`);
  });

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  await close2();

  // ── Results ─────────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.error('\nFailed tests:');
    for (const f of failures) console.error(`  - ${f.name}: ${f.error}`);
    process.exit(1);
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
