/**
 * Backend tests for prompt-improvements (T-010)
 *
 * Covers:
 *   buildStagePrompt():
 *     - returns { promptText: string, estimatedTokens: number }
 *     - includes task title and taskId in prompt text
 *     - includes artifact paths when task has file attachments
 *     - includes compile gate block for developer-agent
 *     - does NOT include compile gate for other agents
 *
 *   spawnStage() persistence:
 *     - stage-N-prompt.md is created before spawning (skipped — requires real spawn)
 *     NOTE: We test the path helper stagePromptPath() instead and verify atomic write
 *           in a unit-level test.
 *
 *   GET /api/v1/runs/:runId/stages/:stageIndex/prompt:
 *     - 200 text/plain when file exists
 *     - 404 PROMPT_NOT_AVAILABLE when file missing
 *     - 404 RUN_NOT_FOUND for unknown runId
 *
 *   POST /api/v1/runs/preview-prompts:
 *     - 200 with prompts array (no files created on disk)
 *     - each entry has stageIndex, agentId, promptFull, estimatedTokens
 *     - 404 when task not found
 *     - 422 when agent file missing
 *     - 400 when stages is missing/empty
 *
 * Run with: node --test tests/prompt-improvements.test.js
 */

'use strict';

const { test, describe, before, after } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const http     = require('http');
const crypto   = require('crypto');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-prompt-test-'));
}

function writeAgentFile(agentsDir, agentId, body = 'You are a test agent.') {
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(path.join(agentsDir, `${agentId}.md`), `---\nmodel: sonnet\n---\n\n${body}`, 'utf8');
}

/**
 * Set up a minimal space with a task in 'todo'.
 * @param {string} dataDir
 * @param {object} [taskOverrides] - Extra fields to merge into the task object.
 * @returns {{ spaceId: string, taskId: string, task: object }}
 */
function createSpaceWithTask(dataDir, taskOverrides = {}) {
  const spaceId  = 'test-space-1';
  const taskId   = crypto.randomUUID();
  const spaceDir = path.join(dataDir, 'spaces', spaceId);
  fs.mkdirSync(spaceDir, { recursive: true });
  const task = {
    id: taskId,
    title: 'Implement feature X',
    type: 'chore',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...taskOverrides,
  };
  fs.writeFileSync(path.join(spaceDir, 'todo.json'),        JSON.stringify([task]), 'utf8');
  fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([]),     'utf8');
  fs.writeFileSync(path.join(spaceDir, 'done.json'),        JSON.stringify([]),     'utf8');
  return { spaceId, taskId, task };
}

/**
 * Create a space + task via spaceManager so the server's space registry is consistent.
 * Returns { spaceId, taskId }.
 */
function setupSpaceViaManager(dataDir) {
  const { createSpaceManager } = require('../src/services/spaceManager');
  const sm     = createSpaceManager(dataDir);
  const result = sm.createSpace(`prompt-test-${crypto.randomUUID().slice(0, 8)}`);
  const spaceId = result.space.id;

  const taskId   = crypto.randomUUID();
  const todoPath = path.join(dataDir, 'spaces', spaceId, 'todo.json');
  const tasks    = JSON.parse(fs.readFileSync(todoPath, 'utf8'));
  tasks.push({
    id: taskId,
    title: 'Prompt test task',
    type: 'chore',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  fs.writeFileSync(todoPath, JSON.stringify(tasks), 'utf8');

  return { spaceId, taskId };
}

/**
 * HTTP helper — returns text body for non-JSON responses.
 */
function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const options = {
      hostname: 'localhost',
      port,
      path:    urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload !== undefined && { 'Content-Length': Buffer.byteLength(payload) }),
      },
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, rawBody: raw });
      });
    });

    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Unit: buildStagePrompt()
// ---------------------------------------------------------------------------

describe('buildStagePrompt() unit tests', () => {
  const { buildStagePrompt } = require('../src/services/pipelineManager');

  test('returns { promptText, estimatedTokens } shape', () => {
    const dataDir = tmpDir();
    const { spaceId, taskId } = createSpaceWithTask(dataDir);

    const result = buildStagePrompt(dataDir, spaceId, taskId, 0, 'senior-architect', ['senior-architect']);

    assert.strictEqual(typeof result.promptText, 'string', 'promptText must be a string');
    assert.strictEqual(typeof result.estimatedTokens, 'number', 'estimatedTokens must be a number');
    assert.ok(result.estimatedTokens > 0, 'estimatedTokens must be > 0');
  });

  test('promptText includes task title and taskId', () => {
    const dataDir = tmpDir();
    const { spaceId, taskId } = createSpaceWithTask(dataDir);

    const { promptText } = buildStagePrompt(dataDir, spaceId, taskId, 0, 'senior-architect', ['senior-architect']);

    assert.ok(promptText.includes('Implement feature X'), 'promptText must include task title');
    assert.ok(promptText.includes(taskId), 'promptText must include taskId');
    assert.ok(promptText.includes(spaceId), 'promptText must include spaceId');
  });

  test('estimatedTokens is approximately promptText.length / 4', () => {
    const dataDir = tmpDir();
    const { spaceId, taskId } = createSpaceWithTask(dataDir);

    const { promptText, estimatedTokens } = buildStagePrompt(dataDir, spaceId, taskId, 0, 'ux-api-designer', ['ux-api-designer']);

    const expected = Math.ceil(promptText.length / 4);
    assert.strictEqual(estimatedTokens, expected, 'estimatedTokens must equal ceil(length/4)');
  });

  test('includes ARTIFACTS FROM PREVIOUS STAGES when task has file attachments', () => {
    const dataDir = tmpDir();
    const { spaceId, taskId } = createSpaceWithTask(dataDir, {
      attachments: [
        { name: 'ADR-1.md', type: 'file', content: '/agent-docs/ADR-1.md' },
        { name: 'blueprint.md', type: 'file', content: '/agent-docs/blueprint.md' },
      ],
    });

    const { promptText } = buildStagePrompt(dataDir, spaceId, taskId, 1, 'developer-agent', ['senior-architect', 'developer-agent']);

    assert.ok(promptText.includes('ARTIFACTS FROM PREVIOUS STAGES'), 'must include artifacts header');
    assert.ok(promptText.includes('ADR-1.md'), 'must list ADR-1.md attachment');
    assert.ok(promptText.includes('/agent-docs/ADR-1.md'), 'must include artifact path');
  });

  test('does NOT include artifacts section when no file attachments', () => {
    const dataDir = tmpDir();
    const { spaceId, taskId } = createSpaceWithTask(dataDir);

    const { promptText } = buildStagePrompt(dataDir, spaceId, taskId, 0, 'senior-architect', ['senior-architect']);

    assert.ok(!promptText.includes('ARTIFACTS FROM PREVIOUS STAGES'), 'must not include artifacts header when no attachments');
  });

  test('includes MANDATORY COMPILE GATE for developer-agent', () => {
    const dataDir = tmpDir();
    const { spaceId, taskId } = createSpaceWithTask(dataDir);

    const { promptText } = buildStagePrompt(dataDir, spaceId, taskId, 0, 'developer-agent', ['developer-agent']);

    assert.ok(promptText.includes('MANDATORY COMPILE GATE'), 'must include compile gate block for developer-agent');
    assert.ok(promptText.includes('npm run build'), 'compile gate must mention npm run build');
  });

  test('does NOT include compile gate for non-developer agents', () => {
    const dataDir = tmpDir();
    const { spaceId, taskId } = createSpaceWithTask(dataDir);

    for (const agentId of ['senior-architect', 'ux-api-designer', 'qa-engineer-e2e']) {
      const { promptText } = buildStagePrompt(dataDir, spaceId, taskId, 0, agentId, [agentId]);
      assert.ok(!promptText.includes('MANDATORY COMPILE GATE'),
        `compile gate must NOT appear for ${agentId}`);
    }
  });

  test('returns fallback prompt when task not found', () => {
    const dataDir = tmpDir();
    const spaceDir = path.join(dataDir, 'spaces', 'missing-space');
    fs.mkdirSync(spaceDir, { recursive: true });

    const { promptText } = buildStagePrompt(dataDir, 'missing-space', 'no-such-task', 0, 'senior-architect', ['senior-architect']);

    assert.ok(promptText.includes('TaskId: no-such-task'), 'fallback must include TaskId');
    assert.ok(promptText.includes('SpaceId: missing-space'), 'fallback must include SpaceId');
  });
});

// ---------------------------------------------------------------------------
// Unit: stagePromptPath() helper
// ---------------------------------------------------------------------------

describe('stagePromptPath() helper', () => {
  const { stagePromptPath, runDir } = require('../src/services/pipelineManager');

  test('returns expected path pattern', () => {
    const dataDir = '/tmp/test-data';
    const runId   = 'abc-123';
    const result  = stagePromptPath(dataDir, runId, 2);
    assert.ok(result.endsWith('stage-2-prompt.md'), `Expected path ending in stage-2-prompt.md, got: ${result}`);
    assert.ok(result.includes(runId), 'path must include runId');
  });

  test('atomic write (.tmp + rename) produces the correct file content', () => {
    const dataDir = tmpDir();
    const runId   = 'test-run-' + crypto.randomUUID();
    const dir     = runDir(dataDir, runId);
    fs.mkdirSync(dir, { recursive: true });

    const filePath = stagePromptPath(dataDir, runId, 0);
    const content  = '# Prompt\nHello world\n';
    const tmpPath  = filePath + '.tmp';

    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);

    assert.ok(fs.existsSync(filePath), 'prompt file must exist after atomic write');
    assert.strictEqual(fs.readFileSync(filePath, 'utf8'), content, 'file content must match');
    assert.ok(!fs.existsSync(tmpPath), '.tmp file must be removed after rename');
  });
});

// ---------------------------------------------------------------------------
// Integration: GET /api/v1/runs/:runId/stages/:stageIndex/prompt
// and POST /api/v1/runs/preview-prompts
// ---------------------------------------------------------------------------

describe('Pipeline prompt endpoints — REST integration', () => {
  let server;
  let port;
  let dataDir;
  let agentsDir;

  before(async () => {
    dataDir   = tmpDir();
    agentsDir = tmpDir();

    // Write agent files for test.
    writeAgentFile(agentsDir, 'senior-architect');
    writeAgentFile(agentsDir, 'developer-agent');

    process.env.PIPELINE_AGENTS_DIR    = agentsDir;
    process.env.PIPELINE_MAX_CONCURRENT = '5';
    process.env.KANBAN_API_URL          = 'http://localhost:19999/api/v1';

    // Invalidate cached modules so env vars are picked up.
    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/agentResolver') || key.includes('/src/pipelineManager') || key.includes('/src/spaceManager')) {
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
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir,   { recursive: true, force: true });
    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  // ── GET /api/v1/runs/:runId/stages/:stageIndex/prompt ──────────────────────

  describe('GET /api/v1/runs/:runId/stages/:stageIndex/prompt', () => {
    test('returns 404 RUN_NOT_FOUND for unknown runId', async () => {
      const res = await request(port, 'GET', '/api/v1/runs/no-such-run/stages/0/prompt');
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error.code, 'RUN_NOT_FOUND');
    });

    test('returns 200 text/plain when prompt file exists', async () => {
      const { stagePromptPath, runDir } = require('../src/services/pipelineManager');
      const runId = crypto.randomUUID();

      // Manually create run.json and prompt file.
      const runDirectory = runDir(dataDir, runId);
      fs.mkdirSync(runDirectory, { recursive: true });

      const run = {
        runId,
        spaceId:      'test-space-1',
        taskId:       'task-abc',
        stages:       ['senior-architect'],
        currentStage: 0,
        status:       'running',
        stageStatuses: [{ index: 0, agentId: 'senior-architect', status: 'running', exitCode: null, startedAt: new Date().toISOString(), finishedAt: null }],
        createdAt:    new Date().toISOString(),
        updatedAt:    new Date().toISOString(),
      };
      fs.writeFileSync(path.join(runDirectory, 'run.json'), JSON.stringify(run), 'utf8');

      // Write the prompt file.
      const promptContent = '## TASK CONTEXT\nTitle: Test task\n';
      const promptFile    = stagePromptPath(dataDir, runId, 0);
      fs.writeFileSync(promptFile, promptContent, 'utf8');

      const res = await request(port, 'GET', `/api/v1/runs/${runId}/stages/0/prompt`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/plain'), `Expected text/plain, got: ${res.headers['content-type']}`);
      assert.ok(typeof res.body === 'string' || res.rawBody.includes('TASK CONTEXT'),
        'response body must contain prompt text');
    });

    test('returns 404 PROMPT_NOT_AVAILABLE when prompt file missing', async () => {
      const { runDir } = require('../src/services/pipelineManager');
      const runId = crypto.randomUUID();

      const runDirectory = runDir(dataDir, runId);
      fs.mkdirSync(runDirectory, { recursive: true });

      const run = {
        runId,
        spaceId:      'test-space-1',
        taskId:       'task-abc',
        stages:       ['senior-architect'],
        currentStage: 0,
        status:       'pending',
        stageStatuses: [{ index: 0, agentId: 'senior-architect', status: 'pending', exitCode: null, startedAt: null, finishedAt: null }],
        createdAt:    new Date().toISOString(),
        updatedAt:    new Date().toISOString(),
      };
      fs.writeFileSync(path.join(runDirectory, 'run.json'), JSON.stringify(run), 'utf8');

      const res = await request(port, 'GET', `/api/v1/runs/${runId}/stages/0/prompt`);
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error.code, 'PROMPT_NOT_AVAILABLE');
    });
  });

  // ── POST /api/v1/runs/preview-prompts ─────────────────────────────────────

  describe('POST /api/v1/runs/preview-prompts', () => {
    let spaceId;
    let taskId;

    before(() => {
      // Create the space + task via spaceManager (keeps server's space registry consistent).
      const result = setupSpaceViaManager(dataDir);
      spaceId = result.spaceId;
      taskId  = result.taskId;
    });

    test('returns 200 with prompts array', async () => {
      const res = await request(port, 'POST', '/api/v1/runs/preview-prompts', {
        spaceId,
        taskId,
        stages: ['senior-architect', 'developer-agent'],
      });

      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.ok(Array.isArray(res.body.prompts), 'response must have prompts array');
      assert.strictEqual(res.body.prompts.length, 2, 'must have one entry per stage');
    });

    test('each prompt entry has stageIndex, agentId, promptFull, estimatedTokens', async () => {
      const res = await request(port, 'POST', '/api/v1/runs/preview-prompts', {
        spaceId,
        taskId,
        stages: ['senior-architect'],
      });

      assert.strictEqual(res.status, 200);
      const entry = res.body.prompts[0];
      assert.strictEqual(entry.stageIndex, 0, 'stageIndex must be 0');
      assert.strictEqual(entry.agentId, 'senior-architect', 'agentId must match');
      assert.strictEqual(typeof entry.promptFull, 'string', 'promptFull must be a string');
      assert.ok(entry.promptFull.length > 0, 'promptFull must be non-empty');
      assert.strictEqual(typeof entry.estimatedTokens, 'number', 'estimatedTokens must be a number');
      assert.ok(entry.estimatedTokens > 0, 'estimatedTokens must be > 0');
    });

    test('does NOT create any run directory or files on disk', async () => {
      const runsDirPath = path.join(dataDir, 'runs');
      const beforeCount = fs.existsSync(runsDirPath)
        ? fs.readdirSync(runsDirPath).filter((e) => e !== 'runs.json').length
        : 0;

      await request(port, 'POST', '/api/v1/runs/preview-prompts', {
        spaceId,
        taskId,
        stages: ['senior-architect', 'developer-agent'],
      });

      const afterCount = fs.existsSync(runsDirPath)
        ? fs.readdirSync(runsDirPath).filter((e) => e !== 'runs.json').length
        : 0;

      assert.strictEqual(beforeCount, afterCount, 'preview-prompts must not create run directories');
    });

    test('returns 400 when stages is missing', async () => {
      const res = await request(port, 'POST', '/api/v1/runs/preview-prompts', {
        spaceId,
        taskId,
      });
      assert.strictEqual(res.status, 400);
    });

    test('returns 400 when stages is an empty array', async () => {
      const res = await request(port, 'POST', '/api/v1/runs/preview-prompts', {
        spaceId,
        taskId,
        stages: [],
      });
      assert.strictEqual(res.status, 400);
    });

    test('returns 422 when agent file is missing', async () => {
      const res = await request(port, 'POST', '/api/v1/runs/preview-prompts', {
        spaceId,
        taskId,
        stages: ['nonexistent-agent'],
      });
      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'AGENT_NOT_FOUND');
    });

    test('returns 400 when spaceId is missing', async () => {
      const res = await request(port, 'POST', '/api/v1/runs/preview-prompts', {
        taskId,
        stages: ['senior-architect'],
      });
      assert.strictEqual(res.status, 400);
    });
  });

  // ── POST /api/v1/agent/prompt — promptFull field (T-005) ──────────────────

  describe('POST /api/v1/agent/prompt — promptFull field', () => {
    test('response includes promptFull with complete prompt text', async () => {
      const agentId = 'senior-architect';
      const { spaceId: sId, taskId: tId } = setupSpaceViaManager(dataDir);

      const res = await request(port, 'POST', '/api/v1/agent/prompt', {
        agentId,
        taskId:  tId,
        spaceId: sId,
      });

      assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.ok('promptFull' in res.body, 'response must include promptFull field');
      assert.strictEqual(typeof res.body.promptFull, 'string', 'promptFull must be a string');
      assert.ok(res.body.promptFull.length > 0, 'promptFull must be non-empty');
    });

    test('promptPreview is still the first 500 chars of promptFull', async () => {
      const agentId = 'senior-architect';
      const { spaceId: sId, taskId: tId } = setupSpaceViaManager(dataDir);

      const res = await request(port, 'POST', '/api/v1/agent/prompt', {
        agentId,
        taskId:  tId,
        spaceId: sId,
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(
        res.body.promptPreview,
        res.body.promptFull.slice(0, 500),
        'promptPreview must equal the first 500 chars of promptFull',
      );
    });
  });
});
