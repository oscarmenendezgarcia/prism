'use strict';

/**
 * E2E test — agent-realistic invocation of `kanban_get_run_logs` (T-007).
 *
 * Spins up the real HTTP server (the same one the MCP tool's
 * `kanban-client.js` talks to) with a synthetic run fixture containing:
 *   - stage 0: a `claude` (stream-json) log
 *   - stage 1: an `opencode` (ANSI plain-text) log
 *
 * Exercises the endpoint the way an agent actually would: resolving an
 * 8-char runId prefix, reading all stages at once, and using `tail` to
 * shrink output. This complements tests/routes.runs.logs.test.js (contract
 * shape) and mcp/tests/mcp-server.test.js (MCP registration + single-stage
 * smoke test) by asserting the full two-format, prefix-resolved, tail-N
 * journey described in blueprint.md and ADR-1.md.
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');

const { startTestServer } = require('./helpers/server');

// Full runId is 36 chars; agents commonly pass just the leading 8.
const FULL_RUN_ID = 'a1b2c3d4-1111-4567-89ab-cdef01234567';
const PREFIX8     = FULL_RUN_ID.slice(0, 8);

function seedTwoFormatRun(runsDir) {
  fs.mkdirSync(runsDir, { recursive: true });
  const runDir = path.join(runsDir, FULL_RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });

  fs.writeFileSync(path.join(runsDir, 'runs.json'), JSON.stringify([
    {
      runId:     FULL_RUN_ID,
      spaceId:   'space-e2e',
      taskId:    'task-e2e',
      status:    'in-progress',
      createdAt: '2026-07-21T00:00:00Z',
      updatedAt: '2026-07-21T00:00:00Z',
    },
  ]));

  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
    runId:        FULL_RUN_ID,
    spaceId:      'space-e2e',
    taskId:       'task-e2e',
    status:       'in-progress',
    currentStage: 1,
    stages:       ['senior-architect', 'developer-agent'],
    stageStatuses: [
      { status: 'completed',   cliTool: 'claude' },
      { status: 'in-progress', cliTool: 'opencode' },
    ],
  }));

  // Stage 0 — claude stream-json: system.init, thinking, tool_use, tool_result,
  // and a handful of plain text lines so tail:N has something to trim.
  const streamJsonLines = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-e2e01', model: 'claude-e2e-model' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'Deciding how to approach the blueprint…' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/agent-docs/blueprint.md' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '# Blueprint contents…' }] }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Blueprint looks good, proceeding.' }] } }),
    JSON.stringify({ type: 'result', result: 'Stage complete.' }),
  ];
  fs.writeFileSync(path.join(runDir, 'stage-0.log'), streamJsonLines.join('\n') + '\n');

  // Stage 1 — opencode ANSI-colored plain text, already legible.
  const opencodeLines = [
    '\x1b[36m[opencode]\x1b[0m booting session…',
    'reading tasks.json',
    'writing src/utils/streamJsonNormalizer.js',
    '\x1b[32m[opencode]\x1b[0m tests passing (44/44)',
    'done.',
  ];
  fs.writeFileSync(path.join(runDir, 'stage-1.log'), opencodeLines.join('\n') + '\n');
}

async function fetchJson(port, urlPath) {
  const res  = await fetch(`http://127.0.0.1:${port}${urlPath}`);
  const body = await res.json();
  return { status: res.status, body };
}

test('agent journey: resolve 8-char prefix, read all stages, both formats normalized', async () => {
  const s = await startTestServer();
  try {
    seedTwoFormatRun(process.env.PIPELINE_RUNS_DIR);

    const { status, body } = await fetchJson(s.port, `/api/v1/runs/${PREFIX8}/logs`);

    assert.equal(status, 200);
    assert.equal(body.runId, FULL_RUN_ID, 'prefix must resolve to the full runId');
    assert.equal(body.stages.length, 2);

    const [claudeStage, opencodeStage] = body.stages;

    // stream-json stage — no raw JSON events should leak into content.
    assert.equal(claudeStage.format, 'stream-json');
    assert.ok(!claudeStage.content.includes('{"type":'), 'raw stream-json must be fully normalized');
    assert.match(claudeStage.content, /\[thinking\]/, 'expected a [thinking] marker');
    assert.match(claudeStage.content, /\[tool\] Read\(/, 'expected a [tool] marker');
    assert.match(claudeStage.content, /\[result\] /, 'expected a [result] marker');
    assert.match(claudeStage.content, /\[result-final\] Stage complete\./, 'expected the final [result-final] summary');

    // plain-text stage — ANSI stripped, content passed through legibly.
    assert.equal(opencodeStage.format, 'plain-text');
    assert.ok(!/\x1b\[[0-9;]*[A-Za-z]/.test(opencodeStage.content), 'ANSI escapes must be stripped');
    assert.ok(opencodeStage.content.includes('[opencode]'), 'plain text content preserved verbatim (minus ANSI)');
    assert.ok(opencodeStage.content.includes('tests passing (44/44)'));
  } finally {
    await s.close();
  }
});

test('agent journey: tail:5 shrinks normalized content to at most 5 lines per stage', async () => {
  const s = await startTestServer();
  try {
    seedTwoFormatRun(process.env.PIPELINE_RUNS_DIR);

    const { status, body } = await fetchJson(s.port, `/api/v1/runs/${PREFIX8}/logs?tail=5`);
    assert.equal(status, 200);

    for (const stage of body.stages) {
      const lineCount = stage.content.split('\n').length;
      assert.ok(lineCount <= 5, `stage ${stage.index} content has ${lineCount} lines, expected <= 5`);
    }

    // The stream-json stage's normalized output has more than 5 lines
    // ([system], [thinking], [tool], [result], text, [result-final]), so
    // tail:5 must actually have trimmed something (not a no-op).
    const claudeStage = body.stages.find((st) => st.index === 0);
    assert.ok(!claudeStage.content.includes('[system] session='), 'tail:5 should have dropped the earliest [system] line');
  } finally {
    await s.close();
  }
});

test('agent journey: stage filter zooms into a single stage without the other', async () => {
  const s = await startTestServer();
  try {
    seedTwoFormatRun(process.env.PIPELINE_RUNS_DIR);

    const { status, body } = await fetchJson(s.port, `/api/v1/runs/${PREFIX8}/logs?stage=1`);
    assert.equal(status, 200);
    assert.equal(body.stages.length, 1);
    assert.equal(body.stages[0].index, 1);
    assert.equal(body.stages[0].format, 'plain-text');
  } finally {
    await s.close();
  }
});
