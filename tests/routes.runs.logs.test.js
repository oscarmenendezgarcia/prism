'use strict';

/**
 * Integration test — GET /api/v1/runs/:runId/logs
 *
 * Boots a real server, seeds a synthetic runs.json + run.json + stage log
 * fixture on disk under PIPELINE_RUNS_DIR, and asserts the wire contract
 * defined in blueprint.md §4.
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');

const { startTestServer } = require('./helpers/server');

const FULL_RUN_ID = 'deadbeef-1234-4567-89ab-cdef01234567';

function seedRun(runsDir) {
  fs.mkdirSync(runsDir, { recursive: true });
  const runDir = path.join(runsDir, FULL_RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });

  // runs.json registry (used by resolver's FS fallback).
  fs.writeFileSync(path.join(runsDir, 'runs.json'), JSON.stringify([
    {
      runId:      FULL_RUN_ID,
      spaceId:    'space-1',
      taskId:     'task-1',
      status:     'running',
      createdAt:  new Date().toISOString(),
      updatedAt:  new Date().toISOString(),
    },
  ]));

  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
    runId:        FULL_RUN_ID,
    spaceId:      'space-1',
    taskId:       'task-1',
    status:       'running',
    currentStage: 1,
    stages:       ['senior-architect', 'developer-agent'],
    stageStatuses: [
      { status: 'completed', cliTool: 'claude' },
      { status: 'running',   cliTool: 'opencode' },
    ],
  }));

  // Stage 0 log — stream-json (claude).
  fs.writeFileSync(path.join(runDir, 'stage-0.log'), [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-abcd1234', model: 'claude-sonnet-4-6' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'planning…' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/x' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'contents' }] }] } }),
  ].join('\n'));

  // Stage 1 log — ANSI-colored plain text (opencode).
  fs.writeFileSync(path.join(runDir, 'stage-1.log'),
    '\x1b[32m[opencode]\x1b[0m starting build…\n' +
    'building module A\n' +
    'building module B\n' +
    '\x1b[31m[error]\x1b[0m module C failed\n');
}

async function fetchJson(port, urlPath) {
  const res  = await fetch(`http://127.0.0.1:${port}${urlPath}`);
  const body = await res.json();
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------

test('GET /runs/:id/logs returns full payload with both stages normalized', async () => {
  const s = await startTestServer();
  try {
    seedRun(process.env.PIPELINE_RUNS_DIR);

    const t0 = Date.now();
    const { status, body } = await fetchJson(s.port, `/api/v1/runs/${FULL_RUN_ID}/logs`);
    const dt = Date.now() - t0;

    assert.equal(status, 200);
    assert.equal(body.runId,        FULL_RUN_ID);
    assert.equal(body.spaceId,      'space-1');
    assert.equal(body.taskId,       'task-1');
    assert.equal(body.status,       'running');
    assert.equal(body.currentStage, 1);
    assert.equal(body.stages.length, 2);

    const [s0, s1] = body.stages;
    assert.equal(s0.index,   0);
    assert.equal(s0.agentId, 'senior-architect');
    assert.equal(s0.cliTool, 'claude');
    assert.equal(s0.format,  'stream-json');
    assert.ok(s0.content.includes('[system] session=sess-abc'));
    assert.ok(s0.content.includes('[tool] Read('));
    assert.ok(s0.content.includes('[result] '));
    assert.ok(!s0.content.includes('{"type":')); // stream-json fully normalized

    assert.equal(s1.format,  'plain-text');
    assert.ok(!/\x1b\[/.test(s1.content));       // ANSI stripped
    assert.ok(s1.content.includes('[opencode]'));

    // SLA sanity — this fixture is tiny, so it should be well under 150ms.
    assert.ok(dt < 500, `duration ${dt}ms exceeded soft ceiling`);
  } finally {
    await s.close();
  }
});

test('GET /runs/:id/logs with stage=1 returns only stage 1', async () => {
  const s = await startTestServer();
  try {
    seedRun(process.env.PIPELINE_RUNS_DIR);
    const { status, body } = await fetchJson(s.port, `/api/v1/runs/${FULL_RUN_ID}/logs?stage=1`);
    assert.equal(status, 200);
    assert.equal(body.stages.length, 1);
    assert.equal(body.stages[0].index, 1);
  } finally {
    await s.close();
  }
});

test('short prefix (< 8 chars) → 400 BAD_REQUEST', async () => {
  const s = await startTestServer();
  try {
    const { status, body } = await fetchJson(s.port, '/api/v1/runs/abc/logs');
    assert.equal(status, 400);
    assert.equal(body.error.code, 'BAD_REQUEST');
  } finally {
    await s.close();
  }
});

test('path-traversal attempt in runId → 400 (never reaches FS)', async () => {
  const s = await startTestServer();
  try {
    // '..' contains a dot — RUN_ID_ALLOWED rejects it before the resolver ever runs.
    const { status } = await fetchJson(s.port, '/api/v1/runs/..%2Fetc%2Fpasswd/logs');
    assert.equal(status, 400);
  } finally {
    await s.close();
  }
});

test('unknown runId → 404 RUN_NOT_FOUND', async () => {
  const s = await startTestServer();
  try {
    seedRun(process.env.PIPELINE_RUNS_DIR);
    const { status, body } = await fetchJson(s.port, '/api/v1/runs/ffffffff-0000-0000-0000-000000000000/logs');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'RUN_NOT_FOUND');
  } finally {
    await s.close();
  }
});

test('ambiguous prefix → 409 AMBIGUOUS_RUN with candidates', async () => {
  const s = await startTestServer();
  try {
    const runsDir = process.env.PIPELINE_RUNS_DIR;
    fs.mkdirSync(runsDir, { recursive: true });
    const a = 'abcdef11-1111-1111-1111-111111111111';
    const b = 'abcdef11-2222-2222-2222-222222222222';
    fs.writeFileSync(path.join(runsDir, 'runs.json'), JSON.stringify([
      { runId: a, spaceId: 's', taskId: 't', status: 'running', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { runId: b, spaceId: 's', taskId: 't', status: 'running', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ]));

    const { status, body } = await fetchJson(s.port, '/api/v1/runs/abcdef11/logs');
    assert.equal(status, 409);
    assert.equal(body.error.code, 'AMBIGUOUS_RUN');
    assert.ok(Array.isArray(body.error.candidates));
    assert.equal(body.error.candidates.length, 2);
  } finally {
    await s.close();
  }
});

test('out-of-range stage → 400 BAD_REQUEST', async () => {
  const s = await startTestServer();
  try {
    seedRun(process.env.PIPELINE_RUNS_DIR);
    const { status, body } = await fetchJson(s.port, `/api/v1/runs/${FULL_RUN_ID}/logs?stage=99`);
    assert.equal(status, 400);
    assert.equal(body.error.code, 'BAD_REQUEST');
  } finally {
    await s.close();
  }
});

test('bad tail value → 400 BAD_REQUEST', async () => {
  const s = await startTestServer();
  try {
    seedRun(process.env.PIPELINE_RUNS_DIR);
    const { status } = await fetchJson(s.port, `/api/v1/runs/${FULL_RUN_ID}/logs?tail=0`);
    assert.equal(status, 400);
  } finally {
    await s.close();
  }
});

test('raw=true returns the file bytes untouched (stream-json still detected)', async () => {
  const s = await startTestServer();
  try {
    seedRun(process.env.PIPELINE_RUNS_DIR);
    const { status, body } = await fetchJson(s.port, `/api/v1/runs/${FULL_RUN_ID}/logs?stage=0&raw=true`);
    assert.equal(status, 200);
    const stage = body.stages[0];
    assert.equal(stage.format, 'stream-json');
    assert.ok(stage.content.includes('{"type":"system"'));
  } finally {
    await s.close();
  }
});
