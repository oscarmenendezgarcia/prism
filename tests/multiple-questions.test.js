/**
 * Integration tests for the multiple-questions pipeline flow.
 *
 * Tests the scenario where an agent posts multiple questions before the pipeline
 * resumes. Each question must be answered in turn; the pipeline stays blocked
 * until ALL questions are resolved.
 *
 * Coverage:
 *   MQ-1: Single question → block → answer → resume
 *   MQ-2: Two questions (no targetAgent) → block on first → answer first → block on second → answer second → resume
 *   MQ-3: Three questions → sequential resolution → correct blockedReason progression
 *   MQ-4: Answer out-of-order still requires all questions resolved before unblocking
 *   MQ-5: Pipeline already unblocked — duplicate answer is idempotent (no error)
 *
 * Run: node tests/multiple-questions.test.js
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
  return function req(method, urlPath, body) {
    return new Promise((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : undefined;
      const options = {
        hostname: 'localhost',
        port,
        path:    urlPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      };
      const r = http.request(options, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      });
      r.on('error', reject);
      if (payload) r.write(payload);
      r.end();
    });
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a space + task via the REST API, then seed a fake 'running' run
 * that is between stages (stage 0 completed, stage 1 pending). This state
 * allows `blockRunByComment` to correctly set blockedReason when a question
 * comment is posted via the API.
 *
 * Do NOT seed the run as 'blocked' — that causes blockRunByComment to short-
 * circuit and skip setting blockedReason.
 *
 * When the server is using SQLite (store initialised via migrate()), this
 * function upserts into the SQLite store so pipelineManager.findActiveRunByTaskId
 * can find it. Falls back to writing run.json + runs.json to disk.
 *
 * @param {Function}  req        - HTTP requester bound to the test server port
 * @param {string}    dataDir    - Temporary data directory for the test server
 * @param {string[]}  stages     - Pipeline stage agent IDs (≥2 required)
 * @returns {{ spaceId, taskId, runId }}
 */
async function seedRunBetweenStages(req, dataDir, stages = ['senior-architect', 'developer-agent']) {
  // 1. Create a space.
  const spaceRes = await req('POST', '/api/v1/spaces', { name: `mq-test-${crypto.randomUUID().slice(0, 8)}` });
  assert(spaceRes.status === 201, `createSpace: ${spaceRes.status} ${JSON.stringify(spaceRes.body)}`);
  const spaceId = spaceRes.body.id;

  // 2. Create a task in the space.
  const taskRes = await req('POST', `/api/v1/spaces/${spaceId}/tasks`, {
    title: 'Multiple-questions test task',
    type:  'feature',
  });
  assert(taskRes.status === 201, `createTask: ${taskRes.status}`);
  const taskId = taskRes.body.id;

  // 3. Seed a run that is "between stages": stage 0 is completed, stage 1
  //    is pending, overall status is 'running'. When a question comment is
  //    posted, blockRunByComment will transition this run to 'blocked'.
  const runId   = crypto.randomUUID();
  const now     = new Date().toISOString();
  const runsDir = path.join(dataDir, 'runs');
  const runDir  = path.join(runsDir, runId);
  // Always create the run directory — stage logs and sentinels live here
  // even when state is stored in SQLite.
  fs.mkdirSync(runDir, { recursive: true });

  const run = {
    runId,
    spaceId,
    taskId,
    stages,
    currentStage: 1,          // between stage 0 (done) and stage 1 (pending)
    status: 'running',
    stageStatuses: stages.map((agentId, i) => ({
      index:     i,
      agentId,
      status:    i === 0 ? 'completed' : 'pending',
      exitCode:  i === 0 ? 0 : null,
      startedAt: now,
      finishedAt: i === 0 ? now : null,
    })),
    resolverActive: false,
    createdAt: now,
    updatedAt: now,
  };

  // Use the SQLite store when the server has initialised one so that
  // pipelineManager.findActiveRunByTaskId (which queries SQLite when _store is
  // set) can find this run. Fall back to file-based seeding otherwise.
  const pm    = require('../src/services/pipelineManager');
  const store = pm.getStore();
  if (store) {
    store.upsertRun(run);
  } else {
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run, null, 2), 'utf8');
    const registryPath = path.join(runsDir, 'runs.json');
    let registry = [];
    if (fs.existsSync(registryPath)) {
      try { registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')); } catch {}
    }
    registry.push({ runId, spaceId, taskId, status: 'running', createdAt: now });
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');
  }

  return { spaceId, taskId, runId };
}

/**
 * Read the current run state.
 *
 * When the server uses SQLite (store initialised), delegates to the SQLite
 * store directly (same source of truth as pipelineManager). Falls back to
 * reading run.json from disk for environments without a store.
 *
 * @param {string} dataDir - Root data directory for the test server.
 * @param {string} runId
 * @returns {object} Run state object.
 */
function readRunJson(dataDir, runId) {
  const pm    = require('../src/services/pipelineManager');
  const store = pm.getStore();
  if (store) {
    const run = store.getRun(runId);
    if (!run) throw new Error(`run ${runId} not found in SQLite store`);
    return run;
  }
  // Legacy fallback: read from disk (used when no store / pure unit-test context).
  const p = path.join(dataDir, 'runs', runId, 'run.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function run() {
  let server;
  let req;
  let dataDir;

  try {
    // Start a single shared test server for all MQ tests.
    // startTestServer returns { port, agentsDir, close }.
    // dataDir = parent of agentsDir (agentsDir lives at <tmpDir>/agents).
    server  = await startTestServer();
    req     = makeRequest(server.port);
    dataDir = path.dirname(server.agentsDir);
  } catch (err) {
    console.error('Failed to start test server:', err.message);
    process.exit(1);
  }

  // ── MQ-1: Single question → block → answer → resume ──────────────────────
  suite('MQ-1: single question → block → answer → resume');

  await test('posting one question with type=question blocks the run', async () => {
    const { spaceId, taskId, runId } = await seedRunBetweenStages(req, dataDir);

    const postRes = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'senior-architect',
      text:   'Should we use REST or GraphQL?',
      type:   'question',
    });
    assert(postRes.status === 201, `Expected 201, got ${postRes.status}`);
    const questionId = postRes.body.id;
    assert(questionId, 'comment must have an id');
    assert(postRes.body.type    === 'question',         'type must be question');
    assert(postRes.body.resolved === false,              'must start unresolved');
    assert(postRes.body.needsHuman === false,            'needsHuman must default false');

    // blockedReason should point to this question.
    const runState = readRunJson(dataDir, runId);
    assert(runState.status === 'blocked',               'run must remain blocked');
    assert(runState.blockedReason?.commentId === questionId,
      `blockedReason.commentId must be ${questionId}, got ${runState.blockedReason?.commentId}`);
  });

  await test('answering the single question resumes the pipeline (status → running)', async () => {
    const { spaceId, taskId, runId } = await seedRunBetweenStages(req, dataDir);

    // Post the question.
    const qRes = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'developer-agent',
      text:   'Which database engine should we use?',
      type:   'question',
    });
    assert(qRes.status === 201, `postQ: ${qRes.status}`);
    const qId = qRes.body.id;

    // Resolve it.
    const patchRes = await req('PATCH', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments/${qId}`, {
      resolved: true,
    });
    assert(patchRes.status === 200, `patchQ: ${patchRes.status}`);
    assert(patchRes.body.resolved === true, 'comment must now be resolved');

    // Allow unblockRunByComment to process (it's synchronous but may need one tick).
    await new Promise((r) => setTimeout(r, 100));

    const runState = readRunJson(dataDir, runId);
    // Pipeline resumes: status becomes 'running' (or 'completed' if PIPELINE_NO_SPAWN=1
    // sentinel processing fires within the timeout). The important invariant is that
    // the run is NOT 'blocked' anymore.
    assert(runState.status !== 'blocked',
      `Expected run to be unblocked, got status=${runState.status}`);
  });

  // ── MQ-2: Two questions (no targetAgent) ──────────────────────────────────
  suite('MQ-2: two questions — sequential resolution, no targetAgent');

  await test('Q1 posted → run stays blocked on Q1', async () => {
    const { spaceId, taskId, runId } = await seedRunBetweenStages(req, dataDir);

    const q1Res = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'senior-architect',
      text:   'Q1: REST or GraphQL?',
      type:   'question',
    });
    assert(q1Res.status === 201, `postQ1: ${q1Res.status}`);

    const q2Res = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'senior-architect',
      text:   'Q2: monolith or microservices?',
      type:   'question',
    });
    assert(q2Res.status === 201, `postQ2: ${q2Res.status}`);

    const runState = readRunJson(dataDir, runId);
    assert(runState.status === 'blocked', 'run must be blocked');
    // blockedReason must point to Q1 (the FIRST unresolved question)
    assert(runState.blockedReason?.commentId === q1Res.body.id,
      `blockedReason must point to Q1 (${q1Res.body.id}), got ${runState.blockedReason?.commentId}`);
  });

  await test('resolving Q1 transitions blockedReason to Q2 (not yet resolved)', async () => {
    const { spaceId, taskId, runId } = await seedRunBetweenStages(req, dataDir);

    const q1Res = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'developer-agent', text: 'Q1: use Postgres or MySQL?', type: 'question',
    });
    const q2Res = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'developer-agent', text: 'Q2: use ORM or raw SQL?', type: 'question',
    });
    assert(q1Res.status === 201, `postQ1: ${q1Res.status}`);
    assert(q2Res.status === 201, `postQ2: ${q2Res.status}`);

    // Resolve Q1.
    const patchRes = await req('PATCH', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments/${q1Res.body.id}`, {
      resolved: true,
    });
    assert(patchRes.status === 200, `patchQ1: ${patchRes.status}`);
    await new Promise((r) => setTimeout(r, 100));

    // Run must still be blocked — now on Q2.
    const runState = readRunJson(dataDir, runId);
    assert(runState.status === 'blocked', `run must still be blocked (on Q2), got ${runState.status}`);
    assert(runState.blockedReason?.commentId === q2Res.body.id,
      `blockedReason must now point to Q2 (${q2Res.body.id}), got ${runState.blockedReason?.commentId}`);
  });

  await test('resolving Q2 after Q1 is already resolved unblocks the pipeline', async () => {
    const { spaceId, taskId, runId } = await seedRunBetweenStages(req, dataDir);

    const q1Res = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'developer-agent', text: 'Q1: TypeScript or JavaScript?', type: 'question',
    });
    const q2Res = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'developer-agent', text: 'Q2: Jest or Mocha?', type: 'question',
    });
    assert(q1Res.status === 201 && q2Res.status === 201, 'both questions must be posted');

    // Resolve Q1, then Q2.
    await req('PATCH', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments/${q1Res.body.id}`, { resolved: true });
    await new Promise((r) => setTimeout(r, 100));
    await req('PATCH', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments/${q2Res.body.id}`, { resolved: true });
    await new Promise((r) => setTimeout(r, 100));

    const runState = readRunJson(dataDir, runId);
    assert(runState.status !== 'blocked',
      `run must be unblocked after both questions resolved, got status=${runState.status}`);
    assert(!runState.blockedReason || Object.keys(runState.blockedReason).length === 0,
      'blockedReason must be cleared after unblocking');
  });

  // ── MQ-3: Three questions — sequential resolution ────────────────────────
  suite('MQ-3: three questions — sequential resolution with correct blockedReason progression');

  await test('resolving Q1 → blocks on Q2 → resolving Q2 → blocks on Q3 → resolving Q3 → unblocked', async () => {
    const { spaceId, taskId, runId } = await seedRunBetweenStages(req, dataDir);

    const q1Res = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'senior-architect', text: 'Q1: auth strategy?', type: 'question',
    });
    const q2Res = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'senior-architect', text: 'Q2: caching layer?', type: 'question',
    });
    const q3Res = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'senior-architect', text: 'Q3: deployment target?', type: 'question',
    });
    assert(q1Res.status === 201 && q2Res.status === 201 && q3Res.status === 201, 'all 3 questions must be posted');

    // Initial state: blocked on Q1.
    let runState = readRunJson(dataDir, runId);
    assert(runState.blockedReason?.commentId === q1Res.body.id, 'must be blocked on Q1 initially');

    // Resolve Q1 → blocked on Q2.
    await req('PATCH', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments/${q1Res.body.id}`, { resolved: true });
    await new Promise((r) => setTimeout(r, 100));
    runState = readRunJson(dataDir, runId);
    assert(runState.status === 'blocked',                                  'must still be blocked after Q1 resolved');
    assert(runState.blockedReason?.commentId === q2Res.body.id,
      `blockedReason must point to Q2, got ${runState.blockedReason?.commentId}`);

    // Resolve Q2 → blocked on Q3.
    await req('PATCH', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments/${q2Res.body.id}`, { resolved: true });
    await new Promise((r) => setTimeout(r, 100));
    runState = readRunJson(dataDir, runId);
    assert(runState.status === 'blocked',                                  'must still be blocked after Q2 resolved');
    assert(runState.blockedReason?.commentId === q3Res.body.id,
      `blockedReason must point to Q3, got ${runState.blockedReason?.commentId}`);

    // Resolve Q3 → pipeline unblocks.
    await req('PATCH', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments/${q3Res.body.id}`, { resolved: true });
    await new Promise((r) => setTimeout(r, 100));
    runState = readRunJson(dataDir, runId);
    assert(runState.status !== 'blocked',
      `run must be unblocked after all 3 questions resolved, got status=${runState.status}`);
  });

  // ── MQ-4: Answer out-of-order ─────────────────────────────────────────────
  suite('MQ-4: answering questions out-of-order — pipeline stays blocked until ALL resolved');

  await test('resolving Q2 first does not unblock the pipeline (Q1 still pending)', async () => {
    const { spaceId, taskId, runId } = await seedRunBetweenStages(req, dataDir);

    const q1Res = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'developer-agent', text: 'Q1: backend framework?', type: 'question',
    });
    const q2Res = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'developer-agent', text: 'Q2: frontend framework?', type: 'question',
    });
    assert(q1Res.status === 201 && q2Res.status === 201, 'both questions must be posted');

    // Resolve Q2 first (out of order).
    await req('PATCH', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments/${q2Res.body.id}`, { resolved: true });
    await new Promise((r) => setTimeout(r, 100));

    // Pipeline must still be blocked on Q1 (Q1 was first, still unresolved).
    const runState = readRunJson(dataDir, runId);
    assert(runState.status === 'blocked',
      `run must remain blocked since Q1 is unresolved, got status=${runState.status}`);
    assert(runState.blockedReason?.commentId === q1Res.body.id,
      `blockedReason must still point to Q1, got ${runState.blockedReason?.commentId}`);
  });

  await test('resolving Q2 then Q1 (out-of-order) ultimately unblocks the pipeline', async () => {
    const { spaceId, taskId, runId } = await seedRunBetweenStages(req, dataDir);

    const q1Res = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'developer-agent', text: 'Q1: sync or async?', type: 'question',
    });
    const q2Res = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'developer-agent', text: 'Q2: SQL or NoSQL?', type: 'question',
    });
    assert(q1Res.status === 201 && q2Res.status === 201, 'both questions must be posted');

    // Resolve in reverse order: Q2 first, then Q1.
    await req('PATCH', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments/${q2Res.body.id}`, { resolved: true });
    await new Promise((r) => setTimeout(r, 100));
    // Still blocked on Q1.
    let runState = readRunJson(dataDir, runId);
    assert(runState.status === 'blocked', 'still blocked after Q2 resolved (Q1 pending)');

    await req('PATCH', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments/${q1Res.body.id}`, { resolved: true });
    await new Promise((r) => setTimeout(r, 100));

    runState = readRunJson(dataDir, runId);
    assert(runState.status !== 'blocked',
      `pipeline must unblock after all questions resolved (even out-of-order), got ${runState.status}`);
  });

  // ── MQ-5: Idempotency ─────────────────────────────────────────────────────
  suite('MQ-5: resolving an already-resolved question is idempotent');

  await test('patching resolved=true twice on the same comment returns 200 both times', async () => {
    const { spaceId, taskId } = await seedRunBetweenStages(req, dataDir);

    const qRes = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'developer-agent', text: 'Q: idempotency test?', type: 'question',
    });
    assert(qRes.status === 201, `postQ: ${qRes.status}`);
    const qId = qRes.body.id;

    const patch1 = await req('PATCH', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments/${qId}`, { resolved: true });
    assert(patch1.status === 200, `first patch must be 200, got ${patch1.status}`);

    const patch2 = await req('PATCH', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments/${qId}`, { resolved: true });
    assert(patch2.status === 200, `second patch (idempotent) must be 200, got ${patch2.status}`);
    assert(patch2.body.resolved === true, 'comment must still be resolved after second patch');
  });

  // ── MQ-6: Notes do NOT block ──────────────────────────────────────────────
  suite('MQ-6: note comments interspersed with questions do not affect pipeline block state');

  await test('posting a note while blocked does not change the blockedReason', async () => {
    const { spaceId, taskId, runId } = await seedRunBetweenStages(req, dataDir);

    const qRes = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'senior-architect', text: 'Q: which database?', type: 'question',
    });
    assert(qRes.status === 201, `postQ: ${qRes.status}`);

    // Post a note.
    const noteRes = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'developer-agent',
      text:   'Assumption: I will use PostgreSQL unless told otherwise.',
      type:   'note',
    });
    assert(noteRes.status === 201, `postNote: ${noteRes.status}`);
    assert(noteRes.body.type === 'note', 'must create a note comment');

    // blockedReason must still point to the question, not the note.
    const runState = readRunJson(dataDir, runId);
    assert(runState.status === 'blocked', 'run must remain blocked after note is posted');
    assert(runState.blockedReason?.commentId === qRes.body.id,
      `blockedReason must still point to the question, got ${runState.blockedReason?.commentId}`);
  });

  await test('resolving the question after a note was posted still unblocks the pipeline', async () => {
    const { spaceId, taskId, runId } = await seedRunBetweenStages(req, dataDir);

    const qRes = await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'developer-agent', text: 'Q: event bus or direct calls?', type: 'question',
    });
    await req('POST', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`, {
      author: 'senior-architect', text: 'Assumption: favour direct HTTP for now.', type: 'note',
    });

    await req('PATCH', `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments/${qRes.body.id}`, { resolved: true });
    await new Promise((r) => setTimeout(r, 100));

    const runState = readRunJson(dataDir, runId);
    assert(runState.status !== 'blocked',
      `pipeline must unblock after question resolved (notes ignored), got ${runState.status}`);
  });

  // ── Teardown ──────────────────────────────────────────────────────────────
  // server.close is the cleanup function returned by startTestServer.
  await server.close();

  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailed tests:');
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
    process.exit(1);
  } else {
    console.log('All tests passed.');
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
