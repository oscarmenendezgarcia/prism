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

// ---------------------------------------------------------------------------
// Unit tests — pipelineManager helpers (no server needed)
// ---------------------------------------------------------------------------

async function runUnitTests() {
  suite('Unit: findActiveRunByTaskId');

  await test('returns run object when a matching active run exists (status=blocked)', () => {
    const tmpPath = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pm-unit-'));
    const runsDir = require('path').join(tmpPath, 'runs');
    const runId   = 'unit-run-active';
    const taskId  = 'unit-task-active';
    require('fs').mkdirSync(require('path').join(runsDir, runId), { recursive: true });
    const run = { runId, taskId, spaceId: 'sp', status: 'blocked', stages: [],
      currentStage: 0, stageStatuses: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    require('fs').writeFileSync(require('path').join(runsDir, runId, 'run.json'), JSON.stringify(run), 'utf8');
    require('fs').writeFileSync(require('path').join(runsDir, 'runs.json'), JSON.stringify([
      { runId, taskId, spaceId: 'sp', status: 'blocked', createdAt: run.createdAt },
    ]), 'utf8');

    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');

    const found = pm.findActiveRunByTaskId(tmpPath, taskId);
    assert(found !== null, 'should find the active run');
    assert(found.runId === runId, 'runId mismatch');
    assert(found.status === 'blocked', 'status mismatch');

    require('fs').rmSync(tmpPath, { recursive: true, force: true });
  });

  await test('returns null for completed/failed/interrupted runs', () => {
    const tmpPath = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pm-unit-'));
    const runsDir = require('path').join(tmpPath, 'runs');
    require('fs').mkdirSync(runsDir, { recursive: true });
    require('fs').writeFileSync(require('path').join(runsDir, 'runs.json'), JSON.stringify([
      { runId: 'r1', taskId: 'task-done', spaceId: 'sp', status: 'completed', createdAt: new Date().toISOString() },
      { runId: 'r2', taskId: 'task-fail', spaceId: 'sp', status: 'failed',    createdAt: new Date().toISOString() },
    ]), 'utf8');

    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');

    assert(pm.findActiveRunByTaskId(tmpPath, 'task-done') === null, 'completed run should not be returned');
    assert(pm.findActiveRunByTaskId(tmpPath, 'task-fail') === null, 'failed run should not be returned');
    assert(pm.findActiveRunByTaskId(tmpPath, 'unknown')   === null, 'unknown taskId should return null');

    require('fs').rmSync(tmpPath, { recursive: true, force: true });
  });

  suite('Unit: blockRunByComment');

  await test('blocks a between-stages run (current stage pending) with blockedReason', () => {
    const tmpPath = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pm-unit-'));
    const runsDir = require('path').join(tmpPath, 'runs');
    const runId   = 'block-test-between';
    const taskId  = 'task-between';
    require('fs').mkdirSync(require('path').join(runsDir, runId), { recursive: true });
    const run = {
      runId, taskId, spaceId: 'sp', status: 'running',
      stages: ['senior-architect', 'developer-agent'], currentStage: 0,
      stageStatuses: [
        { index: 0, agentId: 'senior-architect', status: 'pending' },
        { index: 1, agentId: 'developer-agent',  status: 'pending' },
      ],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const runJsonPath = require('path').join(runsDir, runId, 'run.json');
    require('fs').writeFileSync(runJsonPath, JSON.stringify(run), 'utf8');
    require('fs').writeFileSync(require('path').join(runsDir, 'runs.json'), JSON.stringify([
      { runId, taskId, spaceId: 'sp', status: 'running', createdAt: run.createdAt },
    ]), 'utf8');

    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');

    const comment = { id: 'c-q1', author: 'senior-architect', text: 'What is the SLA?', type: 'question' };
    pm.blockRunByComment(tmpPath, taskId, comment);

    const persisted = JSON.parse(require('fs').readFileSync(runJsonPath, 'utf8'));
    assert(persisted.status === 'blocked', `Expected blocked, got ${persisted.status}`);
    assert(persisted.blockedReason != null, 'blockedReason should be set');
    assert(persisted.blockedReason.commentId === 'c-q1', 'commentId mismatch');
    assert(persisted.blockedReason.author === 'senior-architect', 'author mismatch');
    assert(persisted.blockedReason.taskId === taskId, 'taskId mismatch');
    assert(typeof persisted.blockedReason.blockedAt === 'string', 'blockedAt should be set');

    require('fs').rmSync(tmpPath, { recursive: true, force: true });
  });

  await test('does NOT block when current stage is actively running (handleStageClose handles it)', () => {
    const tmpPath = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pm-unit-'));
    const runsDir = require('path').join(tmpPath, 'runs');
    const runId   = 'block-test-running';
    const taskId  = 'task-running';
    require('fs').mkdirSync(require('path').join(runsDir, runId), { recursive: true });
    const run = {
      runId, taskId, spaceId: 'sp', status: 'running',
      stages: ['senior-architect'], currentStage: 0,
      stageStatuses: [{ index: 0, agentId: 'senior-architect', status: 'running' }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const runJsonPath = require('path').join(runsDir, runId, 'run.json');
    require('fs').writeFileSync(runJsonPath, JSON.stringify(run), 'utf8');
    require('fs').writeFileSync(require('path').join(runsDir, 'runs.json'), JSON.stringify([
      { runId, taskId, spaceId: 'sp', status: 'running', createdAt: run.createdAt },
    ]), 'utf8');

    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');

    pm.blockRunByComment(tmpPath, taskId, { id: 'c-mid', author: 'a', text: 'Mid-run Q', type: 'question' });

    const persisted = JSON.parse(require('fs').readFileSync(runJsonPath, 'utf8'));
    assert(persisted.status === 'running', `Expected running (stage active), got ${persisted.status}`);
    assert(persisted.blockedReason == null, 'blockedReason should NOT be set');

    require('fs').rmSync(tmpPath, { recursive: true, force: true });
  });

  suite('Unit: unblockRunByComment');

  await test('resumes pipeline when last question resolved (status=running, no blockedReason)', async () => {
    const tmpPath   = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pm-unit-'));
    const runsDir   = require('path').join(tmpPath, 'runs');
    const spacesDir = require('path').join(tmpPath, 'spaces');
    const runId = 'unblock-test-1';
    const taskId = 'task-unblock-1';
    const spaceId = 'sp-unblock';
    require('fs').mkdirSync(require('path').join(runsDir, runId), { recursive: true });
    require('fs').mkdirSync(require('path').join(spacesDir, spaceId), { recursive: true });

    const run = {
      runId, taskId, spaceId, status: 'blocked',
      stages: ['senior-architect', 'developer-agent'], currentStage: 1,
      stageStatuses: [
        { index: 0, agentId: 'senior-architect', status: 'completed' },
        { index: 1, agentId: 'developer-agent',  status: 'pending' },
      ],
      blockedReason: { commentId: 'q-resolved', taskId, author: 'a', text: 'Q?', blockedAt: new Date().toISOString() },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const runJsonPath = require('path').join(runsDir, runId, 'run.json');
    require('fs').writeFileSync(runJsonPath, JSON.stringify(run), 'utf8');
    require('fs').writeFileSync(require('path').join(runsDir, 'runs.json'), JSON.stringify([
      { runId, taskId, spaceId, status: 'blocked', createdAt: run.createdAt },
    ]), 'utf8');

    // Task with no unresolved questions (already resolved)
    const task = { id: taskId, title: 'T', type: 'feature',
      comments: [{ id: 'q-resolved', type: 'question', resolved: true, author: 'a', text: 'Q?', createdAt: new Date().toISOString() }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    require('fs').writeFileSync(require('path').join(spacesDir, spaceId, 'todo.json'), JSON.stringify([task]), 'utf8');
    require('fs').writeFileSync(require('path').join(spacesDir, spaceId, 'in-progress.json'), JSON.stringify([]), 'utf8');
    require('fs').writeFileSync(require('path').join(spacesDir, spaceId, 'done.json'), JSON.stringify([]), 'utf8');

    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');

    pm.unblockRunByComment(tmpPath, taskId, 'q-resolved');
    await new Promise((r) => setTimeout(r, 50)); // allow setImmediate to fire

    const persisted = JSON.parse(require('fs').readFileSync(runJsonPath, 'utf8'));
    assert(persisted.status === 'running', `Expected running, got ${persisted.status}`);
    assert(persisted.blockedReason == null, 'blockedReason should be cleared');

    require('fs').rmSync(tmpPath, { recursive: true, force: true });
  });

  await test('updates blockedReason to second question when first resolved but second remains', () => {
    const tmpPath   = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pm-unit-'));
    const runsDir   = require('path').join(tmpPath, 'runs');
    const spacesDir = require('path').join(tmpPath, 'spaces');
    const runId = 'unblock-test-2';
    const taskId = 'task-unblock-2';
    const spaceId = 'sp-unblock-2';
    require('fs').mkdirSync(require('path').join(runsDir, runId), { recursive: true });
    require('fs').mkdirSync(require('path').join(spacesDir, spaceId), { recursive: true });

    const run = {
      runId, taskId, spaceId, status: 'blocked',
      stages: ['senior-architect', 'developer-agent'], currentStage: 1,
      stageStatuses: [
        { index: 0, agentId: 'senior-architect', status: 'completed' },
        { index: 1, agentId: 'developer-agent',  status: 'pending' },
      ],
      blockedReason: { commentId: 'q-first', taskId, author: 'a', text: 'Q1?', blockedAt: new Date().toISOString() },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const runJsonPath = require('path').join(runsDir, runId, 'run.json');
    require('fs').writeFileSync(runJsonPath, JSON.stringify(run), 'utf8');
    require('fs').writeFileSync(require('path').join(runsDir, 'runs.json'), JSON.stringify([
      { runId, taskId, spaceId, status: 'blocked', createdAt: run.createdAt },
    ]), 'utf8');

    // Task with q-first resolved but q-second still open
    const task = { id: taskId, title: 'T', type: 'feature',
      comments: [
        { id: 'q-first',  type: 'question', resolved: true,  author: 'a', text: 'Q1?', createdAt: new Date().toISOString() },
        { id: 'q-second', type: 'question', resolved: false, author: 'b', text: 'Q2?', createdAt: new Date().toISOString() },
      ],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    require('fs').writeFileSync(require('path').join(spacesDir, spaceId, 'todo.json'), JSON.stringify([task]), 'utf8');
    require('fs').writeFileSync(require('path').join(spacesDir, spaceId, 'in-progress.json'), JSON.stringify([]), 'utf8');
    require('fs').writeFileSync(require('path').join(spacesDir, spaceId, 'done.json'), JSON.stringify([]), 'utf8');

    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');

    pm.unblockRunByComment(tmpPath, taskId, 'q-first');

    const persisted = JSON.parse(require('fs').readFileSync(runJsonPath, 'utf8'));
    assert(persisted.status === 'blocked', `Expected still blocked, got ${persisted.status}`);
    assert(persisted.blockedReason != null, 'blockedReason should still exist');
    assert(persisted.blockedReason.commentId === 'q-second', `Expected q-second, got ${persisted.blockedReason.commentId}`);
    assert(persisted.blockedReason.author === 'b', 'should point to second question author');

    require('fs').rmSync(tmpPath, { recursive: true, force: true });
  });

  await test('does nothing when run is not blocked', () => {
    const tmpPath   = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pm-unit-'));
    const runsDir   = require('path').join(tmpPath, 'runs');
    require('fs').mkdirSync(runsDir, { recursive: true });
    require('fs').writeFileSync(require('path').join(runsDir, 'runs.json'), JSON.stringify([
      { runId: 'run-running', taskId: 'task-r', spaceId: 'sp', status: 'running', createdAt: new Date().toISOString() },
    ]), 'utf8');

    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');

    // Should not throw; run is not blocked
    let threw = false;
    try { pm.unblockRunByComment(tmpPath, 'task-r', 'some-comment'); }
    catch { threw = true; }
    assert(!threw, 'unblockRunByComment should not throw when run is not blocked');

    require('fs').rmSync(tmpPath, { recursive: true, force: true });
  });
}

// ---------------------------------------------------------------------------
// Integration tests — comment-driven blocking with PIPELINE_NO_SPAWN=1
// ---------------------------------------------------------------------------

async function runCommentDrivenTests() {
  suite('Integration: comment-driven blocking (PIPELINE_NO_SPAWN=1)');

  // Setup: start an isolated server with PIPELINE_NO_SPAWN=1
  const tmpServerDir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'prism-blocked-cd-'));
  const agentsDirCd  = require('path').join(tmpServerDir, 'agents');
  require('fs').mkdirSync(agentsDirCd);
  for (const id of ['senior-architect', 'ux-api-designer', 'developer-agent', 'qa-engineer-e2e']) {
    require('fs').writeFileSync(require('path').join(agentsDirCd, `${id}.md`), `# ${id}\nStub.\n`, 'utf8');
  }

  const prevEnvs = {
    PIPELINE_AGENTS_DIR:    process.env.PIPELINE_AGENTS_DIR,
    PIPELINE_MAX_CONCURRENT: process.env.PIPELINE_MAX_CONCURRENT,
    KANBAN_API_URL:          process.env.KANBAN_API_URL,
    PIPELINE_NO_SPAWN:       process.env.PIPELINE_NO_SPAWN,
  };
  process.env.PIPELINE_AGENTS_DIR    = agentsDirCd;
  process.env.PIPELINE_MAX_CONCURRENT = '20';
  process.env.KANBAN_API_URL          = 'http://localhost:19999/api/v1'; // dead URL
  process.env.PIPELINE_NO_SPAWN       = '1';

  // Clear module cache so env vars are picked up
  for (const key of Object.keys(require.cache)) {
    if (key.includes('pipelineManager') || key.includes('agentResolver')) {
      delete require.cache[key];
    }
  }

  const { startServer } = require('../server');
  let cdServer, cdPort;
  await new Promise((resolve, reject) => {
    cdServer = startServer({ port: 0, dataDir: tmpServerDir, silent: true });
    cdServer.once('listening', () => { cdPort = cdServer.address().port; resolve(); });
    cdServer.once('error', reject);
  });

  const req = makeRequest(cdPort);

  /** Poll for run status */
  async function waitStatus(runId, predicate, maxMs = 5000) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const r = await req('GET', `/api/v1/runs/${runId}`);
      if (r.status === 200 && predicate(r.body)) return r.body;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return null;
  }

  /** Create space + task */
  async function mkSpaceTask(suffix = '') {
    const sp = await req('POST', '/api/v1/spaces', { name: `cd-space-${suffix || Date.now()}` });
    assert(sp.status === 201, `Space create: ${sp.status}`);
    const tk = await req('POST', `/api/v1/spaces/${sp.body.id}/tasks`, { title: 'Test', type: 'feature' });
    assert(tk.status === 201, `Task create: ${tk.status}`);
    return { spaceId: sp.body.id, taskId: tk.body.id };
  }

  /** Post a question comment */
  async function postQuestion(spaceId, taskId, text = 'What SLA?') {
    const r = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`,
      { author: 'senior-architect', text, type: 'question' });
    assert(r.status === 201, `postQuestion: ${r.status} - ${JSON.stringify(r.body)}`);
    return r.body;
  }

  /** Resolve a comment */
  async function resolveQ(spaceId, taskId, commentId) {
    return req('PATCH', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments/${commentId}`, { resolved: true });
  }

  // ── Test 1: handleStageClose guard blocks run when question exists ──────────
  await test('question on task before run creation → handleStageClose blocks run after stage completes', async () => {
    const { spaceId, taskId } = await mkSpaceTask('t1');
    const comment = await postQuestion(spaceId, taskId, 'What is the target latency?');

    const runRes = await req('POST', '/api/v1/runs', {
      spaceId, taskId, stages: ['senior-architect', 'developer-agent'],
    });
    assert(runRes.status === 201, `POST /runs: ${runRes.status} - ${JSON.stringify(runRes.body)}`);
    const { runId } = runRes.body;

    const blocked = await waitStatus(runId, (r) => r.status === 'blocked', 5000);
    assert(blocked !== null, 'run should reach blocked status within 5s');
    assert(blocked.status === 'blocked', `Expected blocked, got ${blocked.status}`);
    assert(blocked.blockedReason != null, 'blockedReason should be present');
    assert(blocked.blockedReason.commentId === comment.id, `commentId mismatch: ${blocked.blockedReason.commentId}`);
    assert(blocked.blockedReason.taskId === taskId, 'taskId mismatch');
    assert(blocked.blockedReason.author === 'senior-architect', 'author mismatch');
    assert(typeof blocked.blockedReason.text === 'string' && blocked.blockedReason.text.length > 0, 'text missing');
    assert(typeof blocked.blockedReason.blockedAt === 'string', 'blockedAt missing');
    assert(blocked.stageStatuses[0].status === 'completed', 'stage 0 should be completed');
    assert(blocked.stageStatuses[1].status === 'pending', 'stage 1 should be pending');
  });

  // ── Test 2: GET /runs/:id returns full blockedReason ────────────────────────
  await test('GET /runs/:runId returns blockedReason (commentId, taskId, author, text, blockedAt)', async () => {
    const { spaceId, taskId } = await mkSpaceTask('t2');
    await postQuestion(spaceId, taskId, 'Which cloud region?');

    const runRes = await req('POST', '/api/v1/runs', {
      spaceId, taskId, stages: ['senior-architect', 'developer-agent'],
    });
    const { runId } = runRes.body;

    await waitStatus(runId, (r) => r.status === 'blocked', 5000);

    const getRes = await req('GET', `/api/v1/runs/${runId}`);
    assert(getRes.status === 200, `GET run: ${getRes.status}`);
    assert(getRes.body.status === 'blocked', `Expected blocked, got ${getRes.body.status}`);
    const br = getRes.body.blockedReason;
    assert(br != null, 'blockedReason must be present');
    assert(typeof br.commentId === 'string', 'commentId must be string');
    assert(br.taskId === taskId, 'taskId must match');
    assert(typeof br.author === 'string', 'author must be string');
    assert(typeof br.text === 'string', 'text must be string');
    assert(typeof br.blockedAt === 'string' && Date.parse(br.blockedAt) > 0, 'blockedAt must be ISO date');
  });

  // ── Test 3: resolving question auto-resumes pipeline ────────────────────────
  await test('resolving blocking question auto-resumes pipeline to completion', async () => {
    const { spaceId, taskId } = await mkSpaceTask('t3');
    const comment = await postQuestion(spaceId, taskId, 'Which database engine?');

    const runRes = await req('POST', '/api/v1/runs', {
      spaceId, taskId, stages: ['senior-architect', 'developer-agent'],
    });
    const { runId } = runRes.body;

    const blocked = await waitStatus(runId, (r) => r.status === 'blocked', 5000);
    assert(blocked !== null, 'run should be blocked first');

    const patchRes = await resolveQ(spaceId, taskId, comment.id);
    assert(patchRes.status === 200, `resolveComment: ${patchRes.status}`);
    assert(patchRes.body.resolved === true, 'comment should be resolved');

    const completed = await waitStatus(runId, (r) => r.status === 'completed', 6000);
    assert(completed !== null, 'run should complete after question resolved');
    assert(completed.status === 'completed', `Expected completed, got ${completed.status}`);
    assert(completed.blockedReason == null, 'blockedReason should be absent on completion');
  });

  // ── Test 4: 2 questions, resolving first keeps run blocked at second ─────────
  await test('2 questions: resolving first keeps run blocked, pointing to second question', async () => {
    const { spaceId, taskId } = await mkSpaceTask('t4');
    const q1 = await postQuestion(spaceId, taskId, 'Question 1?');
    const q2 = await postQuestion(spaceId, taskId, 'Question 2?');

    const runRes = await req('POST', '/api/v1/runs', {
      spaceId, taskId, stages: ['senior-architect', 'developer-agent'],
    });
    const { runId } = runRes.body;

    const blocked = await waitStatus(runId, (r) => r.status === 'blocked', 5000);
    assert(blocked !== null, 'run should be blocked');

    await resolveQ(spaceId, taskId, q1.id);
    await new Promise((r) => setTimeout(r, 300)); // allow unblockRunByComment to run

    const stillBlocked = await req('GET', `/api/v1/runs/${runId}`);
    assert(stillBlocked.status === 200, 'GET should return 200');
    assert(stillBlocked.body.status === 'blocked', `Expected still blocked, got ${stillBlocked.body.status}`);
    assert(stillBlocked.body.blockedReason.commentId === q2.id, `Expected q2 as blockedReason, got ${stillBlocked.body.blockedReason.commentId}`);

    // Resolve second question → pipeline completes
    await resolveQ(spaceId, taskId, q2.id);
    const completed = await waitStatus(runId, (r) => r.status === 'completed', 6000);
    assert(completed !== null, 'run should complete after all questions resolved');
  });

  // ── Test 5: POST /resume manually resumes blocked run ────────────────────────
  // Single-stage pipeline: stage 0 completes, question exists → blocks.
  // Manual resume skips the question and marks run complete (no more stages).
  await test('POST /resume manually resumes a blocked run (ignores unresolved question)', async () => {
    const { spaceId, taskId } = await mkSpaceTask('t5');
    await postQuestion(spaceId, taskId, 'Unanswered?');

    const runRes = await req('POST', '/api/v1/runs', {
      spaceId, taskId,
      stages: ['senior-architect'], // single stage: blocked after completion, resume skips question
    });
    const { runId } = runRes.body;

    const blocked = await waitStatus(runId, (r) => r.status === 'blocked', 5000);
    assert(blocked !== null, 'run should be blocked after single stage completes');

    const resumeRes = await req('POST', `/api/v1/runs/${runId}/resume`);
    assert(resumeRes.status === 200, `POST /resume: ${resumeRes.status} - ${JSON.stringify(resumeRes.body)}`);
    // blockedReason cleared on resume
    assert(resumeRes.body.blockedReason == null, 'blockedReason should be cleared on manual resume');

    // With all stages completed, executeNextStage marks the run done (no more stages to run).
    const completed = await waitStatus(runId, (r) => r.status === 'completed', 3000);
    assert(completed !== null, 'run should complete after manual resume (no more stages)');
  });

  // ── Test 6: POST /stop transitions blocked run to interrupted ─────────────────
  await test('POST /stop transitions blocked run to interrupted', async () => {
    const { spaceId, taskId } = await mkSpaceTask('t6');
    await postQuestion(spaceId, taskId, 'Blocking question');

    const runRes = await req('POST', '/api/v1/runs', {
      spaceId, taskId, stages: ['senior-architect', 'developer-agent'],
    });
    const { runId } = runRes.body;

    const blocked = await waitStatus(runId, (r) => r.status === 'blocked', 5000);
    assert(blocked !== null, 'run should be blocked');

    const stopRes = await req('POST', `/api/v1/runs/${runId}/stop`);
    assert(stopRes.status === 200, `POST /stop: ${stopRes.status} - ${JSON.stringify(stopRes.body)}`);
    assert(stopRes.body.status === 'interrupted', `Expected interrupted, got ${stopRes.body.status}`);
  });

  // ── Test 7: comment type=note does NOT block pipeline ────────────────────────
  await test('comment type=note does NOT block the pipeline', async () => {
    const { spaceId, taskId } = await mkSpaceTask('t7');

    await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'developer-agent',
      text: 'This is just a design note.',
      type: 'note',
    });

    const runRes = await req('POST', '/api/v1/runs', {
      spaceId, taskId, stages: ['senior-architect'],
    });
    const { runId } = runRes.body;

    const completed = await waitStatus(runId, (r) => r.status === 'completed', 5000);
    assert(completed !== null, 'run should complete — note does not block');
    assert(completed.status === 'completed', `Expected completed, got ${completed.status}`);
    assert(completed.blockedReason == null, 'no blockedReason for note comment');
  });

  // ── Test 8: question on paused (checkpoint) run → blockRunByComment blocks ───
  await test('question on paused run (checkpoint) → blockRunByComment blocks immediately', async () => {
    const { spaceId, taskId } = await mkSpaceTask('t8');

    // Create run with checkpoint before stage 1
    const runRes = await req('POST', '/api/v1/runs', {
      spaceId, taskId,
      stages:      ['senior-architect', 'developer-agent'],
      checkpoints: [1],
    });
    const { runId } = runRes.body;

    // Wait for paused state (stage 0 done, checkpoint halts before stage 1)
    const paused = await waitStatus(runId, (r) => r.status === 'paused', 5000);
    assert(paused !== null, 'run should be paused at checkpoint');
    assert(paused.stageStatuses[0].status === 'completed', 'stage 0 should be completed');
    assert(paused.stageStatuses[1].status === 'pending', 'stage 1 should be pending');

    // Post question while run is paused (between stages — currentStage status = pending)
    const comment = await postQuestion(spaceId, taskId, 'Paused-run question?');
    await new Promise((r) => setTimeout(r, 100)); // blockRunByComment is synchronous; allow propagation

    const blockedRes = await req('GET', `/api/v1/runs/${runId}`);
    assert(blockedRes.status === 200, 'GET should return 200');
    assert(blockedRes.body.status === 'blocked', `Expected blocked, got ${blockedRes.body.status}`);
    assert(blockedRes.body.blockedReason.commentId === comment.id, 'commentId mismatch in paused→blocked');
  });

  // ── Teardown ────────────────────────────────────────────────────────────────
  try { const pm = require('../src/services/pipelineManager'); await pm.abortAll(tmpServerDir); } catch {}
  if (typeof cdServer.closeAllConnections === 'function') cdServer.closeAllConnections();
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 300);
    cdServer.close(() => { clearTimeout(t); resolve(); });
  });
  require('fs').rmSync(tmpServerDir, { recursive: true, force: true });

  // Restore env
  for (const [k, v] of Object.entries(prevEnvs)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

run()
  .then(() => runUnitTests())
  .then(() => runCommentDrivenTests())
  .then(() => {
    console.log(`\n${passed + failed} tests total: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
      console.error('\nFailed tests:');
      for (const f of failures) console.error(`  - ${f.name}: ${f.error}`);
      process.exit(1);
    }
  })
  .catch((err) => { console.error(err); process.exit(1); });
