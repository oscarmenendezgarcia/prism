/**
 * QA Integration tests: MCP kanban_add_comment + kanban_answer_comment
 * end-to-end flows via the REST API.
 *
 * Covers the full lifecycle:
 *   1. Question comment → auto-block pipeline run (between stages)
 *   2. Answer comment (PATCH resolved=true) → auto-unblock when no questions remain
 *   3. Multiple questions — unblock only when ALL are resolved
 *   4. Note comment → no blocking
 *   5. Edge cases: missing fields, unknown task/space, answer with bad commentId
 *
 * Run: node --test tests/mcp-comment-pipeline.test.js
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
// Helper: seed a fake run in the test server's data directory
// ---------------------------------------------------------------------------

/**
 * Write a fake run.json + registry entry directly into dataDir/runs/<runId>/.
 * This lets us test auto-block/unblock without spawning an actual Claude agent.
 */
function seedRun(dataDir, runId, overrides = {}) {
  const now      = new Date().toISOString();
  const runsDir  = path.join(dataDir, 'runs');
  const runDirP  = path.join(runsDir, runId);
  fs.mkdirSync(runDirP, { recursive: true });

  const run = {
    runId,
    spaceId: overrides.spaceId ?? 'test-space',
    taskId:  overrides.taskId  ?? 'test-task',
    stages:  ['developer-agent', 'qa-engineer-e2e'],
    currentStage: overrides.currentStage ?? 0,
    status:  overrides.status  ?? 'running',
    stageStatuses: [
      {
        index: 0,
        agentId:    'developer-agent',
        status:     overrides.stage0Status ?? 'pending',
        exitCode:   null,
        startedAt:  null,
        finishedAt: null,
      },
      {
        index: 1,
        agentId:    'qa-engineer-e2e',
        status:     'pending',
        exitCode:   null,
        startedAt:  null,
        finishedAt: null,
      },
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  fs.writeFileSync(path.join(runDirP, 'run.json'), JSON.stringify(run, null, 2), 'utf8');

  // Update the registry
  const registryPath = path.join(runsDir, 'runs.json');
  let registry = [];
  if (fs.existsSync(registryPath)) {
    try { registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')); } catch {}
  }
  const idx     = registry.findIndex((r) => r.runId === runId);
  const summary = {
    runId,
    spaceId:   run.spaceId,
    taskId:    run.taskId,
    status:    run.status,
    createdAt: run.createdAt,
  };
  if (idx === -1) registry.push(summary);
  else registry[idx] = summary;
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');

  return run;
}

// ---------------------------------------------------------------------------
// Main test runner
// ---------------------------------------------------------------------------

async function run() {
  const { port, agentsDir, close } = await startTestServer();
  const dataDir = path.dirname(agentsDir);
  const req     = makeRequest(port);

  // ── Shared setup: create a space + task used across most suites ────────────
  const spRes = await req('POST', '/api/v1/spaces', { name: 'mcp-comment-test' });
  assert(spRes.status === 201, `space create: ${spRes.status}`);
  const spaceId = spRes.body.id;

  const tkRes = await req('POST', `/api/v1/spaces/${spaceId}/tasks`, {
    title: 'Task for comment-pipeline QA',
    type:  'feature',
  });
  assert(tkRes.status === 201, `task create: ${tkRes.status}`);
  const taskId = tkRes.body.id;

  const commentsUrl     = `/api/v1/spaces/${spaceId}/tasks/${taskId}/comments`;
  const runListUrl      = '/api/v1/runs';

  // ═══════════════════════════════════════════════════════════════════════════
  // TC-001–TC-004: note comment — no pipeline blocking
  // ═══════════════════════════════════════════════════════════════════════════

  suite('TC-001–TC-004: note comment — happy path, no pipeline blocking');

  const runId_note = crypto.randomUUID();
  seedRun(dataDir, runId_note, { spaceId, taskId, status: 'running', stage0Status: 'pending' });

  let noteCommentId;
  await test('TC-001 POST type=note creates comment (201)', async () => {
    const res = await req('POST', commentsUrl, {
      text:   'Just a note — no blocking expected.',
      type:   'note',
      author: 'qa-agent',
    });
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.id, 'Expected id in response');
    assert(res.body.type === 'note', `Expected type=note, got ${res.body.type}`);
    assert(res.body.resolved === false, 'Expected resolved=false');
    noteCommentId = res.body.id;
  });

  await test('TC-002 run status remains "running" after note comment', async () => {
    const runsRes = await req('GET', runListUrl);
    const registry = Array.isArray(runsRes.body) ? runsRes.body : [];
    const run = registry.find((r) => r.runId === runId_note);
    assert(run, 'Run not found in registry');
    assert(run.status === 'running', `Expected running, got ${run.status}`);
  });

  await test('TC-003 task includes comment in GET response', async () => {
    const tasksRes = await req('GET', `/api/v1/spaces/${spaceId}/tasks`);
    assert(tasksRes.status === 200, `Expected 200, got ${tasksRes.status}`);
    const allTasks = [
      ...(tasksRes.body.todo         || []),
      ...(tasksRes.body['in-progress'] || []),
      ...(tasksRes.body.done         || []),
    ];
    const task = allTasks.find((t) => t.id === taskId);
    assert(task, 'Task not found in GET /tasks');
    assert(Array.isArray(task.comments), 'Expected comments array on task');
    const note = task.comments.find((c) => c.id === noteCommentId);
    assert(note, 'Note comment not found in task.comments');
  });

  await test('TC-004 note comment does not set resolved field to true initially', async () => {
    const tasksRes = await req('GET', `/api/v1/spaces/${spaceId}/tasks`);
    const allTasks = [
      ...(tasksRes.body.todo || []),
      ...(tasksRes.body['in-progress'] || []),
      ...(tasksRes.body.done || []),
    ];
    const task = allTasks.find((t) => t.id === taskId);
    const note = task.comments.find((c) => c.id === noteCommentId);
    assert(note.resolved === false, `Expected resolved=false, got ${note.resolved}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TC-005–TC-008: question comment — auto-blocks pipeline (between stages)
  // ═══════════════════════════════════════════════════════════════════════════

  suite('TC-005–TC-008: question comment → auto-block pipeline (between stages)');

  // Create a fresh task for this test suite to avoid comment-count pollution
  const tkQ = await req('POST', `/api/v1/spaces/${spaceId}/tasks`, {
    title: 'Task for question-block flow',
    type:  'chore',
  });
  assert(tkQ.status === 201, `task create: ${tkQ.status}`);
  const taskId_Q  = tkQ.body.id;
  const commUrl_Q = `/api/v1/spaces/${spaceId}/tasks/${taskId_Q}/comments`;

  const runId_Q = crypto.randomUUID();
  // stage0Status: 'pending' so blockRunByComment fires (not mid-execution)
  seedRun(dataDir, runId_Q, {
    spaceId,
    taskId:      taskId_Q,
    status:      'running',
    stage0Status: 'pending',
  });

  let questionCommentId;
  await test('TC-005 POST type=question creates comment (201)', async () => {
    const res = await req('POST', commUrl_Q, {
      text:   'What is the correct API base path?',
      type:   'question',
      author: 'developer-agent',
    });
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.type === 'question', `Expected type=question`);
    assert(res.body.resolved === false, 'Expected resolved=false');
    questionCommentId = res.body.id;
  });

  await test('TC-006 run status transitions to "blocked" after question comment', async () => {
    const runsRes = await req('GET', runListUrl);
    const registry = Array.isArray(runsRes.body) ? runsRes.body : [];
    const run = registry.find((r) => r.runId === runId_Q);
    assert(run, 'Run not found in registry');
    assert(run.status === 'blocked', `Expected blocked, got ${run.status}`);
  });

  await test('TC-007 run detail has blockedReason with correct commentId', async () => {
    const runRes = await req('GET', `/api/v1/runs/${runId_Q}`);
    assert(runRes.status === 200, `Expected 200, got ${runRes.status}`);
    assert(runRes.body.status === 'blocked', `Expected blocked, got ${runRes.body.status}`);
    assert(runRes.body.blockedReason, 'Expected blockedReason on run');
    assert(
      runRes.body.blockedReason.commentId === questionCommentId,
      `blockedReason.commentId mismatch: expected ${questionCommentId}, got ${runRes.body.blockedReason.commentId}`,
    );
  });

  await test('TC-008 PATCH /block on already-blocked run is idempotent (200)', async () => {
    const res = await req('POST', `/api/v1/runs/${runId_Q}/block`, {});
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.status === 'blocked', `Expected blocked, got ${res.body.status}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TC-009–TC-012: answer comment → auto-unblock pipeline
  // ═══════════════════════════════════════════════════════════════════════════

  suite('TC-009–TC-012: PATCH resolved=true → auto-unblock pipeline (single question)');

  let answerCommentId;
  await test('TC-009 POST type=answer with parentId creates answer comment (201)', async () => {
    const res = await req('POST', commUrl_Q, {
      text:     'The base path is /api/v1',
      type:     'answer',
      author:   'user',
      parentId: questionCommentId,
    });
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.type === 'answer', `Expected type=answer`);
    assert(res.body.parentId === questionCommentId, 'Expected parentId to match question');
    answerCommentId = res.body.id;
  });

  await test('TC-010 run remains blocked until question is marked resolved', async () => {
    const runsRes = await req('GET', runListUrl);
    const registry = Array.isArray(runsRes.body) ? runsRes.body : [];
    const run = registry.find((r) => r.runId === runId_Q);
    assert(run, 'Run not found');
    // Answer comment alone does NOT unblock — the question must be PATCH resolved=true
    assert(run.status === 'blocked', `Expected still-blocked after answer-only, got ${run.status}`);
  });

  await test('TC-011 PATCH resolved=true on question unblocks run (no remaining questions)', async () => {
    const patchRes = await req('PATCH', `${commUrl_Q}/${questionCommentId}`, { resolved: true });
    assert(patchRes.status === 200, `Expected 200, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`);
    assert(patchRes.body.resolved === true, 'Expected resolved=true in response');

    // Wait a tick for setImmediate(executeNextStage) in unblockRunByComment to fire
    await new Promise((r) => setTimeout(r, 50));

    const runsRes = await req('GET', runListUrl);
    const registry = Array.isArray(runsRes.body) ? runsRes.body : [];
    const run = registry.find((r) => r.runId === runId_Q);
    assert(run, 'Run not found after unblock');
    // After unblocking, the run resumes. Since stage0Status was 'pending',
    // executeNextStage will be called and the stage may be spawned (and fail fast
    // as a stub). Either 'running' or a terminal state is acceptable post-unblock.
    assert(
      run.status !== 'blocked',
      `Expected non-blocked status after resolving question, got ${run.status}`,
    );
  });

  await test('TC-012 resolved question has resolved=true persisted on task', async () => {
    const tasksRes = await req('GET', `/api/v1/spaces/${spaceId}/tasks`);
    const allTasks = [
      ...(tasksRes.body.todo || []),
      ...(tasksRes.body['in-progress'] || []),
      ...(tasksRes.body.done || []),
    ];
    const task = allTasks.find((t) => t.id === taskId_Q);
    assert(task, 'Task not found');
    const q = (task.comments || []).find((c) => c.id === questionCommentId);
    assert(q, 'Question comment not found');
    assert(q.resolved === true, `Expected resolved=true, got ${q.resolved}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TC-013–TC-016: multiple questions — only unblock when ALL resolved
  // ═══════════════════════════════════════════════════════════════════════════

  suite('TC-013–TC-016: multiple questions → only unblock when ALL resolved');

  const tkMQ = await req('POST', `/api/v1/spaces/${spaceId}/tasks`, {
    title: 'Task for multiple-questions flow',
    type:  'feature',
  });
  assert(tkMQ.status === 201, `task create: ${tkMQ.status}`);
  const taskId_MQ  = tkMQ.body.id;
  const commUrl_MQ = `/api/v1/spaces/${spaceId}/tasks/${taskId_MQ}/comments`;

  const runId_MQ = crypto.randomUUID();
  seedRun(dataDir, runId_MQ, {
    spaceId,
    taskId:      taskId_MQ,
    status:      'running',
    stage0Status: 'pending',
  });

  let q1Id, q2Id;

  await test('TC-013 first question blocks the run', async () => {
    const r1 = await req('POST', commUrl_MQ, {
      text: 'First question?', type: 'question', author: 'agent-a',
    });
    assert(r1.status === 201, `Expected 201, got ${r1.status}`);
    q1Id = r1.body.id;

    const runsRes = await req('GET', runListUrl);
    const reg = Array.isArray(runsRes.body) ? runsRes.body : [];
    const run = reg.find((r) => r.runId === runId_MQ);
    assert(run && run.status === 'blocked', `Expected blocked, got ${run?.status}`);
  });

  await test('TC-014 second question posted on blocked run keeps it blocked', async () => {
    const r2 = await req('POST', commUrl_MQ, {
      text: 'Second question?', type: 'question', author: 'agent-b',
    });
    assert(r2.status === 201, `Expected 201, got ${r2.status}`);
    q2Id = r2.body.id;

    const runsRes = await req('GET', runListUrl);
    const reg = Array.isArray(runsRes.body) ? runsRes.body : [];
    const run = reg.find((r) => r.runId === runId_MQ);
    assert(run && run.status === 'blocked', `Expected still blocked, got ${run?.status}`);
  });

  await test('TC-015 resolving first question does not unblock run (second still open)', async () => {
    const patchRes = await req('PATCH', `${commUrl_MQ}/${q1Id}`, { resolved: true });
    assert(patchRes.status === 200, `PATCH q1 expected 200, got ${patchRes.status}`);

    await new Promise((r) => setTimeout(r, 30));

    const runsRes = await req('GET', runListUrl);
    const reg = Array.isArray(runsRes.body) ? runsRes.body : [];
    const run = reg.find((r) => r.runId === runId_MQ);
    assert(run && run.status === 'blocked', `Expected still blocked, got ${run?.status}`);
  });

  await test('TC-016 resolving second question unblocks run (all resolved)', async () => {
    const patchRes = await req('PATCH', `${commUrl_MQ}/${q2Id}`, { resolved: true });
    assert(patchRes.status === 200, `PATCH q2 expected 200, got ${patchRes.status}`);

    await new Promise((r) => setTimeout(r, 50));

    const runsRes = await req('GET', runListUrl);
    const reg = Array.isArray(runsRes.body) ? runsRes.body : [];
    const run = reg.find((r) => r.runId === runId_MQ);
    assert(run, 'Run not found');
    assert(
      run.status !== 'blocked',
      `Expected non-blocked after all questions resolved, got ${run.status}`,
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TC-017–TC-019: question comment with NO active run — safe (no crash)
  // ═══════════════════════════════════════════════════════════════════════════

  suite('TC-017–TC-019: question comment with no active run — graceful');

  const tkNoRun = await req('POST', `/api/v1/spaces/${spaceId}/tasks`, {
    title: 'Task with no active pipeline',
    type:  'chore',
  });
  assert(tkNoRun.status === 201, `task create: ${tkNoRun.status}`);
  const taskId_NoRun  = tkNoRun.body.id;
  const commUrl_NoRun = `/api/v1/spaces/${spaceId}/tasks/${taskId_NoRun}/comments`;

  let noRunQuestionId;
  await test('TC-017 POST type=question succeeds even with no active run (201)', async () => {
    const res = await req('POST', commUrl_NoRun, {
      text:   'No pipeline exists — should still create comment.',
      type:   'question',
      author: 'qa',
    });
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    noRunQuestionId = res.body.id;
  });

  await test('TC-018 comment is persisted on task (no-run case)', async () => {
    const tasksRes = await req('GET', `/api/v1/spaces/${spaceId}/tasks`);
    const allTasks = [
      ...(tasksRes.body.todo || []),
      ...(tasksRes.body['in-progress'] || []),
      ...(tasksRes.body.done || []),
    ];
    const task = allTasks.find((t) => t.id === taskId_NoRun);
    assert(task, 'Task not found');
    const q = (task.comments || []).find((c) => c.id === noRunQuestionId);
    assert(q, 'Question comment not found on task');
  });

  await test('TC-019 PATCH resolved=true on comment with no run succeeds (200)', async () => {
    const res = await req('PATCH', `${commUrl_NoRun}/${noRunQuestionId}`, { resolved: true });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.resolved === true, 'Expected resolved=true');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TC-020–TC-024: edge cases and validation — MCP tool schema gaps
  // ═══════════════════════════════════════════════════════════════════════════

  suite('TC-020–TC-024: edge cases and validation');

  await test('TC-020 POST answer type without parentId is accepted (API level)', async () => {
    // The MCP tool kanban_add_comment allows type=answer but has no parentId param.
    // At the REST API level, parentId is optional. This creates a dangling answer.
    const res = await req('POST', commentsUrl, {
      text:   'Answer without a parent link — MCP tool misuse path.',
      type:   'answer',
      author: 'user',
      // no parentId
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.body.type === 'answer', 'Expected type=answer');
    assert(res.body.parentId === undefined, 'Expected no parentId (dangling answer)');
  });

  await test('TC-021 POST comment to unknown taskId returns 404 TASK_NOT_FOUND', async () => {
    const res = await req('POST', `/api/v1/spaces/${spaceId}/tasks/nonexistent-id/comments`, {
      text: 'x', type: 'note', author: 'user',
    });
    assert(res.status === 404, `Expected 404, got ${res.status}`);
    assert(res.body.error?.code === 'TASK_NOT_FOUND', `Expected TASK_NOT_FOUND, got ${JSON.stringify(res.body)}`);
  });

  await test('TC-022 POST comment to unknown spaceId returns 404 SPACE_NOT_FOUND', async () => {
    const res = await req('POST', '/api/v1/spaces/nonexistent-space/tasks/any-task/comments', {
      text: 'x', type: 'note', author: 'user',
    });
    assert(res.status === 404, `Expected 404, got ${res.status}`);
    assert(res.body.error?.code === 'SPACE_NOT_FOUND', `Expected SPACE_NOT_FOUND, got ${JSON.stringify(res.body)}`);
  });

  await test('TC-023 POST question without author returns 400 VALIDATION_ERROR', async () => {
    const res = await req('POST', commentsUrl, {
      text: 'Missing author', type: 'question',
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error?.code === 'VALIDATION_ERROR', `Expected VALIDATION_ERROR`);
  });

  await test('TC-024 PATCH unknown commentId returns 404 COMMENT_NOT_FOUND', async () => {
    const res = await req('PATCH', `${commentsUrl}/nonexistent-comment-id`, { resolved: true });
    assert(res.status === 404, `Expected 404, got ${res.status}`);
    assert(res.body.error?.code === 'COMMENT_NOT_FOUND', `Expected COMMENT_NOT_FOUND, got ${JSON.stringify(res.body)}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TC-025–TC-026: question posted during active stage — handleStageClose guard
  // ═══════════════════════════════════════════════════════════════════════════

  suite('TC-025–TC-026: question posted while stage is running — run stays running until stage exits');

  const tkActive = await req('POST', `/api/v1/spaces/${spaceId}/tasks`, {
    title: 'Task for mid-execution question test',
    type:  'feature',
  });
  assert(tkActive.status === 201, `task create: ${tkActive.status}`);
  const taskId_Active   = tkActive.body.id;
  const commUrl_Active  = `/api/v1/spaces/${spaceId}/tasks/${taskId_Active}/comments`;

  const runId_Active = crypto.randomUUID();
  // stage0Status: 'running' → blockRunByComment skips; handleStageClose catches it
  seedRun(dataDir, runId_Active, {
    spaceId,
    taskId:      taskId_Active,
    status:      'running',
    stage0Status: 'running',
  });

  await test('TC-025 question comment while stage is mid-execution: comment created (201)', async () => {
    const res = await req('POST', commUrl_Active, {
      text:   'Question during active execution.',
      type:   'question',
      author: 'agent-x',
    });
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  await test('TC-026 run status NOT immediately blocked when stage is mid-execution', async () => {
    // blockRunByComment intentionally skips when stage is 'running';
    // the block will be applied in handleStageClose when the stage exits.
    const runsRes = await req('GET', runListUrl);
    const reg = Array.isArray(runsRes.body) ? runsRes.body : [];
    const run = reg.find((r) => r.runId === runId_Active);
    assert(run, 'Run not found');
    // The run remains 'running' until the stage finishes.
    assert(run.status === 'running', `Expected running (deferred block), got ${run.status}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TC-027–TC-033: targetAgent field — cross-agent-questions (T-009)
  // ═══════════════════════════════════════════════════════════════════════════

  suite('TC-027–TC-033: targetAgent field on comments (cross-agent-questions)');

  // Create a fresh task for targetAgent tests
  const tkTargetAgent = await req('POST', `/api/v1/spaces/${spaceId}/tasks`, {
    title: 'Task for targetAgent tests',
    type:  'feature',
    pipeline: ['developer-agent', 'qa-engineer-e2e'],
  });
  assert(tkTargetAgent.status === 201, `task create: ${tkTargetAgent.status}`);
  const taskId_ta  = tkTargetAgent.body.id;
  const commUrl_ta = `/api/v1/spaces/${spaceId}/tasks/${taskId_ta}/comments`;

  await test('TC-027 POST question + valid targetAgent → 201, targetAgent in response', async () => {
    const res = await req('POST', commUrl_ta, {
      text:        'What is the primary color token?',
      type:        'question',
      author:      'developer-agent',
      targetAgent: 'developer-agent',
    });
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.targetAgent === 'developer-agent', `Expected targetAgent='developer-agent', got '${res.body.targetAgent}'`);
    assert(res.body.needsHuman === false, `Expected needsHuman=false, got ${res.body.needsHuman}`);
    assert(res.body.type === 'question', 'Expected type=question');
  });

  await test('TC-028 POST note + targetAgent → 400 VALIDATION_ERROR', async () => {
    const res = await req('POST', commUrl_ta, {
      text:        'A note with targetAgent (invalid)',
      type:        'note',
      author:      'developer-agent',
      targetAgent: 'qa-engineer-e2e',
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error?.code === 'VALIDATION_ERROR', `Expected VALIDATION_ERROR, got ${JSON.stringify(res.body.error)}`);
    assert(res.body.error.message.includes('targetAgent'), 'Error message should mention targetAgent');
  });

  await test('TC-029 POST answer + targetAgent → 400 VALIDATION_ERROR', async () => {
    const res = await req('POST', commUrl_ta, {
      text:        'An answer with targetAgent (invalid)',
      type:        'answer',
      author:      'qa-engineer-e2e',
      targetAgent: 'developer-agent',
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error?.code === 'VALIDATION_ERROR', `Expected VALIDATION_ERROR, got ${JSON.stringify(res.body.error)}`);
  });

  await test('TC-030 POST question + empty targetAgent → 400 VALIDATION_ERROR', async () => {
    const res = await req('POST', commUrl_ta, {
      text:        'Question with empty targetAgent',
      type:        'question',
      author:      'developer-agent',
      targetAgent: '',
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(res.body.error?.code === 'VALIDATION_ERROR', `Expected VALIDATION_ERROR, got ${JSON.stringify(res.body.error)}`);
  });

  await test('TC-031 POST question without targetAgent → 201, backward compat, needsHuman=false', async () => {
    const res = await req('POST', commUrl_ta, {
      text:   'A question without targetAgent',
      type:   'question',
      author: 'developer-agent',
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.body.targetAgent === undefined, 'targetAgent should be absent');
    assert(res.body.needsHuman === false, `Expected needsHuman=false, got ${res.body.needsHuman}`);
  });

  await test('TC-032 PATCH needsHuman=true → 200, field persisted', async () => {
    // Create a question comment first
    const cRes = await req('POST', commUrl_ta, {
      text:        'A question to escalate to human',
      type:        'question',
      author:      'developer-agent',
      targetAgent: 'qa-engineer-e2e',
    });
    assert(cRes.status === 201, `Create comment: ${cRes.status}`);
    const needsHumanCommentId = cRes.body.id;

    const res = await req('PATCH', `${commUrl_ta}/${needsHumanCommentId}`, { needsHuman: true });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.needsHuman === true, `Expected needsHuman=true, got ${res.body.needsHuman}`);
    assert(typeof res.body.updatedAt === 'string', 'updatedAt should be set');
  });

  await test('TC-033 end-to-end: question + targetAgent not in run.stages → comment.targetAgent persists', async () => {
    // Create a task and seed a run where targetAgent (ux-api-designer) is NOT in stages
    const taskRes2 = await req('POST', `/api/v1/spaces/${spaceId}/tasks`, {
      title: 'E2E targetAgent validation task',
      type:  'feature',
      pipeline: ['developer-agent'],
    });
    assert(taskRes2.status === 201, `task create: ${taskRes2.status}`);
    const taskId_e2e  = taskRes2.body.id;
    const commUrl_e2e = `/api/v1/spaces/${spaceId}/tasks/${taskId_e2e}/comments`;

    // Seed a run with only developer-agent in stages
    const runId_e2e = crypto.randomUUID();
    seedRun(dataDir, runId_e2e, {
      spaceId,
      taskId:       taskId_e2e,
      status:       'running',
      stage0Status: 'pending',
      stages:       ['developer-agent'],
      stageStatuses: [{
        index: 0, agentId: 'developer-agent', status: 'pending',
        exitCode: null, startedAt: null, finishedAt: null,
      }],
      currentStage: 0,
    });

    // Post question with targetAgent that's NOT in the run's stages
    const questionRes = await req('POST', commUrl_e2e, {
      text:        'What font does the wireframe use?',
      type:        'question',
      author:      'developer-agent',
      targetAgent: 'ux-api-designer',  // NOT in ['developer-agent']
    });
    assert(questionRes.status === 201, `question create: ${questionRes.status}`);
    assert(questionRes.body.targetAgent === 'ux-api-designer', 'targetAgent should be in response');
    assert(questionRes.body.needsHuman === false, 'needsHuman starts as false');

    // Allow pipelineManager time to process block + resolver validation
    await new Promise((r) => setTimeout(r, 600));

    // Verify run is now blocked
    const runState = await req('GET', `/api/v1/runs/${runId_e2e}`);
    assert(runState.status === 200, `GET run: ${runState.status}`);
    assert(runState.body.status === 'blocked', `Expected blocked, got ${runState.body.status}`);
    assert(runState.body.blockedReason?.commentId === questionRes.body.id, 'blockedReason should point to the question');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Teardown
  // ─────────────────────────────────────────────────────────────────────────

  await close();

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  ✗ ${f.name}`);
      console.log(`    ${f.error}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Unexpected test suite error:', err);
  process.exit(1);
});
