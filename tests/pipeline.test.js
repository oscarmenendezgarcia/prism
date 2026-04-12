/**
 * Pipeline feature tests — T-006 (unit) + T-007 (integration)
 *
 * Covers:
 *   agentResolver:
 *     - resolveAgent with subagent mode (default)
 *     - resolveAgent with headless mode
 *     - AgentNotFoundError when file does not exist
 *     - parseFrontmatter: model extraction, body extraction, missing frontmatter
 *
 *   pipelineManager (unit — no real spawn):
 *     - createRun: TASK_NOT_FOUND, TASK_NOT_IN_TODO, MAX_CONCURRENT_REACHED
 *     - createRun: happy path returns pending run with correct shape
 *     - createRun: AGENT_NOT_FOUND when stage agent file missing
 *     - getRun: returns null for unknown runId
 *     - deleteRun: removes run directory and registry entry
 *     - init: marks running runs as interrupted
 *
 *   REST integration (real server, real HTTP):
 *     - POST /api/v1/runs — 201 with run object
 *     - POST /api/v1/runs — 422 when task not in todo
 *     - POST /api/v1/runs — 404 when taskId unknown
 *     - POST /api/v1/runs — 400 missing spaceId
 *     - GET  /api/v1/runs/:runId — 200 with run
 *     - GET  /api/v1/runs/:runId — 404 unknown runId
 *     - GET  /api/v1/runs/:runId/stages/0/log — 404 log not yet available
 *     - DELETE /api/v1/runs/:runId — 200 { deleted: true }
 *     - DELETE /api/v1/runs/:runId — 404 unknown runId
 *
 * Run with: node tests/pipeline.test.js
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-pipeline-test-'));
}

/**
 * Write a mock agent .md file with optional frontmatter.
 *
 * @param {string} agentsDir
 * @param {string} agentId
 * @param {string} [model]
 * @param {string} [body]
 */
function writeAgentFile(agentsDir, agentId, model = 'sonnet', body = 'You are a test agent.') {
  fs.mkdirSync(agentsDir, { recursive: true });
  const content = `---\nmodel: ${model}\n---\n\n${body}`;
  fs.writeFileSync(path.join(agentsDir, `${agentId}.md`), content, 'utf8');
}

/**
 * Set up a minimal space directory with a task in 'todo'.
 *
 * @param {string} dataDir
 * @param {string} [spaceId]
 * @returns {{ spaceId: string, taskId: string }}
 */
function createSpaceWithTask(dataDir, spaceId = 'test-space-1') {
  const taskId  = crypto.randomUUID();
  const spaceDir = path.join(dataDir, 'spaces', spaceId);
  fs.mkdirSync(spaceDir, { recursive: true });
  const task = { id: taskId, title: 'Test task', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(spaceDir, 'todo.json'),        JSON.stringify([task]), 'utf8');
  fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([]),     'utf8');
  fs.writeFileSync(path.join(spaceDir, 'done.json'),        JSON.stringify([]),     'utf8');
  return { spaceId, taskId };
}

/**
 * HTTP request helper for integration tests.
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
        resolve({ status: res.statusCode, body: parsed });
      });
    });

    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// agentResolver unit tests
// ---------------------------------------------------------------------------

describe('agentResolver', () => {
  test('resolveAgent returns correct spec in subagent mode (default)', () => {
    const agentsDir = tmpDir();
    writeAgentFile(agentsDir, 'senior-architect', 'opus', 'You are the senior architect.');

    delete process.env.PIPELINE_AGENT_MODE;
    const { resolveAgent } = require('../src/services/agentResolver');

    const spec = resolveAgent('senior-architect', agentsDir);

    assert.equal(spec.agentId, 'senior-architect');
    assert.equal(spec.model, 'opus');
    assert.ok(spec.systemPrompt.includes('You are the senior architect.'));
    assert.deepEqual(spec.spawnArgs, [
      '--agent', 'senior-architect',
      '--print',
      '--output-format', 'stream-json',
      '--allowedTools', 'Bash Edit Write Read Glob Grep mcp__prism__* mcp__stitch__* mcp__figma__* mcp__plugin_playwright_playwright__*',
    ]);

    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  test('resolveAgent returns correct spawnArgs in headless mode', () => {
    const agentsDir = tmpDir();
    writeAgentFile(agentsDir, 'ux-api-designer', 'sonnet', 'You are the UX designer.');

    process.env.PIPELINE_AGENT_MODE = 'headless';
    // Invalidate require cache to pick up env change.
    delete require.cache[require.resolve('../src/services/agentResolver')];
    const { resolveAgent } = require('../src/services/agentResolver');

    const spec = resolveAgent('ux-api-designer', agentsDir);

    assert.equal(spec.spawnArgs[0], '-p');
    assert.ok(spec.spawnArgs[1].includes('You are the UX designer.'));
    assert.equal(spec.spawnArgs[2], '--model');
    assert.equal(spec.spawnArgs[3], 'sonnet');
    assert.equal(spec.spawnArgs[4], '--output-format');
    assert.equal(spec.spawnArgs[5], 'stream-json');
    assert.equal(spec.spawnArgs[6], '--enable-auto-mode');

    delete process.env.PIPELINE_AGENT_MODE;
    delete require.cache[require.resolve('../src/services/agentResolver')];
    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  test('resolveAgent throws AgentNotFoundError for missing agent file', () => {
    const agentsDir = tmpDir();
    delete process.env.PIPELINE_AGENT_MODE;
    delete require.cache[require.resolve('../src/services/agentResolver')];
    const { resolveAgent, AgentNotFoundError } = require('../src/services/agentResolver');

    assert.throws(
      () => resolveAgent('nonexistent-agent', agentsDir),
      (err) => {
        assert.ok(err instanceof AgentNotFoundError);
        assert.equal(err.code, 'AGENT_NOT_FOUND');
        assert.ok(err.message.includes('nonexistent-agent'));
        return true;
      }
    );

    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  test('parseFrontmatter extracts model and body correctly', () => {
    const { parseFrontmatter } = require('../src/services/agentResolver');

    const content = `---\nmodel: opus\n---\n\nYou are an architect.\n`;
    const result  = parseFrontmatter(content);

    assert.equal(result.model, 'opus');
    assert.ok(result.body.includes('You are an architect.'));
  });

  test('parseFrontmatter uses default model when none specified', () => {
    const { parseFrontmatter } = require('../src/services/agentResolver');

    const content = `---\ntype: agent\n---\n\nAgent body.`;
    const result  = parseFrontmatter(content, 'claude-3');

    assert.equal(result.model, 'claude-3');
  });

  test('parseFrontmatter handles file with no frontmatter', () => {
    const { parseFrontmatter } = require('../src/services/agentResolver');

    const content = `You are an agent without frontmatter.`;
    const result  = parseFrontmatter(content, 'sonnet');

    assert.equal(result.model, 'sonnet');
    assert.ok(result.body.includes('You are an agent without frontmatter.'));
  });
});

// ---------------------------------------------------------------------------
// pipelineManager unit tests
// ---------------------------------------------------------------------------

describe('pipelineManager — createRun validations', () => {
  test('createRun throws TASK_NOT_FOUND when task does not exist', async () => {
    const dataDir   = tmpDir();
    const agentsDir = tmpDir();
    writeAgentFile(agentsDir, 'senior-architect');

    process.env.PIPELINE_AGENTS_DIR  = agentsDir;
    process.env.PIPELINE_AGENT_MODE  = 'subagent';

    // Provide a space dir but with an empty todo column.
    const spaceId = 'space-no-task';
    const spaceDir = path.join(dataDir, 'spaces', spaceId);
    fs.mkdirSync(spaceDir, { recursive: true });
    fs.writeFileSync(path.join(spaceDir, 'todo.json'), '[]', 'utf8');

    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');

    await assert.rejects(
      () => pm.createRun({ spaceId, taskId: 'no-such-task', stages: ['senior-architect'], dataDir }),
      (err) => { assert.equal(err.code, 'TASK_NOT_FOUND'); return true; }
    );

    delete process.env.PIPELINE_AGENTS_DIR;
    fs.rmSync(dataDir,   { recursive: true, force: true });
    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  test('createRun throws TASK_NOT_IN_TODO when task is in wrong column', async () => {
    const dataDir   = tmpDir();
    const agentsDir = tmpDir();
    writeAgentFile(agentsDir, 'developer-agent');
    process.env.PIPELINE_AGENTS_DIR = agentsDir;

    // Put task in 'done', not 'todo'.
    const taskId  = crypto.randomUUID();
    const spaceId = 'space-task-done';
    const spaceDir = path.join(dataDir, 'spaces', spaceId);
    fs.mkdirSync(spaceDir, { recursive: true });
    const task = { id: taskId, title: 'Done task', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(spaceDir, 'todo.json'),        '[]', 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), '[]', 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'done.json'),        JSON.stringify([task]), 'utf8');

    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');

    await assert.rejects(
      () => pm.createRun({ spaceId, taskId, stages: ['developer-agent'], dataDir }),
      (err) => { assert.equal(err.code, 'TASK_NOT_IN_TODO'); return true; }
    );

    delete process.env.PIPELINE_AGENTS_DIR;
    fs.rmSync(dataDir,   { recursive: true, force: true });
    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  test('createRun throws MAX_CONCURRENT_REACHED when limit is 0', async () => {
    const dataDir   = tmpDir();
    const agentsDir = tmpDir();
    writeAgentFile(agentsDir, 'senior-architect');
    process.env.PIPELINE_AGENTS_DIR    = agentsDir;
    process.env.PIPELINE_MAX_CONCURRENT = '0';

    const { spaceId, taskId } = createSpaceWithTask(dataDir);

    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');

    await assert.rejects(
      () => pm.createRun({ spaceId, taskId, stages: ['senior-architect'], dataDir }),
      (err) => { assert.equal(err.code, 'MAX_CONCURRENT_REACHED'); return true; }
    );

    delete process.env.PIPELINE_AGENTS_DIR;
    delete process.env.PIPELINE_MAX_CONCURRENT;
    fs.rmSync(dataDir,   { recursive: true, force: true });
    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  test('createRun throws AGENT_NOT_FOUND when stage agent file is missing', async () => {
    const dataDir   = tmpDir();
    const agentsDir = tmpDir();
    // Do NOT write any agent file — directory exists but agent is missing.
    fs.mkdirSync(agentsDir, { recursive: true });
    process.env.PIPELINE_AGENTS_DIR    = agentsDir;
    process.env.PIPELINE_MAX_CONCURRENT = '5';

    const { spaceId, taskId } = createSpaceWithTask(dataDir);

    delete require.cache[require.resolve('../src/services/agentResolver')];
    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');

    await assert.rejects(
      () => pm.createRun({ spaceId, taskId, stages: ['ghost-agent'], dataDir }),
      (err) => { assert.equal(err.code, 'AGENT_NOT_FOUND'); return true; }
    );

    delete process.env.PIPELINE_AGENTS_DIR;
    fs.rmSync(dataDir,   { recursive: true, force: true });
    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  test('createRun happy path returns run with status pending and correct shape', async () => {
    const dataDir   = tmpDir();
    const agentsDir = tmpDir();
    writeAgentFile(agentsDir, 'senior-architect', 'opus');
    process.env.PIPELINE_AGENTS_DIR    = agentsDir;
    process.env.PIPELINE_MAX_CONCURRENT = '5';
    // Use a bogus KANBAN_API_URL so moveKanbanTask fails silently and does not hang.
    process.env.KANBAN_API_URL = 'http://localhost:19999/api/v1';

    const { spaceId, taskId } = createSpaceWithTask(dataDir);

    delete require.cache[require.resolve('../src/services/agentResolver')];
    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');

    let run;
    try {
      run = await pm.createRun({ spaceId, taskId, stages: ['senior-architect'], dataDir });

      assert.ok(typeof run.runId === 'string');
      assert.equal(run.spaceId, spaceId);
      assert.equal(run.taskId,  taskId);
      assert.equal(run.status,  'pending');
      assert.equal(run.stages.length, 1);
      assert.equal(run.stages[0], 'senior-architect');
      assert.equal(run.stageStatuses.length, 1);
      assert.equal(run.stageStatuses[0].status, 'pending');
      assert.ok(typeof run.createdAt === 'string');

      // Verify run.json was persisted.
      const runJsonFile = path.join(dataDir, 'runs', run.runId, 'run.json');
      assert.ok(fs.existsSync(runJsonFile), 'run.json should exist on disk');
      const persisted = JSON.parse(fs.readFileSync(runJsonFile, 'utf8'));
      assert.equal(persisted.runId, run.runId);

      // Verify registry entry.
      const registryFile = path.join(dataDir, 'runs', 'runs.json');
      assert.ok(fs.existsSync(registryFile), 'runs.json registry should exist');
      const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
      assert.ok(registry.some((r) => r.runId === run.runId));
    } finally {
      // Kill the spawned claude subprocess to prevent it from starting a
      // node server.js that inherits the test PIPELINE_AGENTS_DIR env var.
      if (run) await pm.abortAll(dataDir).catch(() => {});
      delete process.env.PIPELINE_AGENTS_DIR;
      delete process.env.PIPELINE_MAX_CONCURRENT;
      delete process.env.KANBAN_API_URL;
      fs.rmSync(dataDir,   { recursive: true, force: true });
      fs.rmSync(agentsDir, { recursive: true, force: true });
    }
  });
});

describe('pipelineManager — getRun, deleteRun, listRuns', () => {
  test('getRun returns null for unknown runId', async () => {
    const dataDir = tmpDir();
    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');

    const result = await pm.getRun('no-such-run', dataDir);
    assert.equal(result, null);

    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('deleteRun removes run directory and registry entry', async () => {
    const dataDir   = tmpDir();
    const agentsDir = tmpDir();
    writeAgentFile(agentsDir, 'senior-architect', 'opus');
    process.env.PIPELINE_AGENTS_DIR    = agentsDir;
    process.env.PIPELINE_MAX_CONCURRENT = '5';
    process.env.KANBAN_API_URL = 'http://localhost:19999/api/v1';

    const { spaceId, taskId } = createSpaceWithTask(dataDir);

    delete require.cache[require.resolve('../src/services/agentResolver')];
    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');

    try {
      const run     = await pm.createRun({ spaceId, taskId, stages: ['senior-architect'], dataDir });
      const runId   = run.runId;
      const runDirPath = path.join(dataDir, 'runs', runId);

      assert.ok(fs.existsSync(runDirPath), 'run directory should exist before delete');

      await pm.deleteRun(runId, dataDir);

      assert.ok(!fs.existsSync(runDirPath), 'run directory should be removed after delete');

      const registry = JSON.parse(fs.readFileSync(path.join(dataDir, 'runs', 'runs.json'), 'utf8'));
      assert.ok(!registry.some((r) => r.runId === runId), 'registry entry should be removed');
    } finally {
      delete process.env.PIPELINE_AGENTS_DIR;
      delete process.env.PIPELINE_MAX_CONCURRENT;
      delete process.env.KANBAN_API_URL;
      fs.rmSync(dataDir,   { recursive: true, force: true });
      fs.rmSync(agentsDir, { recursive: true, force: true });
    }
  });

  test('listRuns returns all registered runs', async () => {
    const dataDir = tmpDir();
    // Write two fake runs into the registry.
    const runsDir = path.join(dataDir, 'runs');
    fs.mkdirSync(runsDir, { recursive: true });
    const registry = [
      { runId: 'aaa', spaceId: 's1', taskId: 't1', status: 'completed', createdAt: new Date().toISOString() },
      { runId: 'bbb', spaceId: 's1', taskId: 't2', status: 'failed',    createdAt: new Date().toISOString() },
    ];
    fs.writeFileSync(path.join(runsDir, 'runs.json'), JSON.stringify(registry), 'utf8');

    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');

    const list = await pm.listRuns(dataDir);
    assert.equal(list.length, 2);
    assert.ok(list.some((r) => r.runId === 'aaa'));
    assert.ok(list.some((r) => r.runId === 'bbb'));

    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});

describe('pipelineManager — init() startup recovery', () => {
  test('init marks running runs as interrupted', () => {
    const dataDir = tmpDir();
    const runsDir = path.join(dataDir, 'runs');
    const runId   = 'run-was-running';
    const runDir  = path.join(runsDir, runId);
    fs.mkdirSync(runDir, { recursive: true });

    const runState = {
      runId,
      spaceId: 'space-1',
      taskId:  'task-1',
      stages:  ['developer-agent'],
      currentStage: 0,
      status:  'running',
      stageStatuses: [{ index: 0, agentId: 'developer-agent', status: 'running', exitCode: null, startedAt: new Date().toISOString(), finishedAt: null }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(runState), 'utf8');

    // Write registry with this run as 'running'.
    const registry = [{ runId, spaceId: 'space-1', taskId: 'task-1', status: 'running', createdAt: runState.createdAt }];
    fs.writeFileSync(path.join(runsDir, 'runs.json'), JSON.stringify(registry), 'utf8');

    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');
    pm.init(dataDir);

    const recovered = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
    assert.equal(recovered.status, 'interrupted');

    const registryAfter = JSON.parse(fs.readFileSync(path.join(runsDir, 'runs.json'), 'utf8'));
    assert.equal(registryAfter.find((r) => r.runId === runId).status, 'interrupted');

    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('init does not modify completed runs', () => {
    const dataDir = tmpDir();
    const runsDir = path.join(dataDir, 'runs');
    const runId   = 'run-already-done';
    const runDir  = path.join(runsDir, runId);
    fs.mkdirSync(runDir, { recursive: true });

    const runState = {
      runId,
      status: 'completed',
      spaceId: 's1', taskId: 't1',
      stages: [], stageStatuses: [],
      currentStage: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(runState), 'utf8');

    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');
    pm.init(dataDir);

    const after = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
    assert.equal(after.status, 'completed');

    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('init creates runs directory if it does not exist', () => {
    const dataDir = tmpDir();
    const runsDir = path.join(dataDir, 'runs');
    assert.ok(!fs.existsSync(runsDir), 'runs dir should not exist before init');

    delete require.cache[require.resolve('../src/services/pipelineManager')];
    const pm = require('../src/services/pipelineManager');
    pm.init(dataDir);

    assert.ok(fs.existsSync(runsDir), 'runs dir should be created by init');

    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// REST integration tests — T-007
// ---------------------------------------------------------------------------

describe('REST integration — pipeline endpoints', () => {
  const { startServer } = require('../server');

  let server;
  let port;
  let dataDir;
  let agentsDir;

  before(async () => {
    dataDir   = tmpDir();
    agentsDir = tmpDir();
    // Write all 4 default pipeline agents so createRun can validate them.
    for (const agentId of ['senior-architect', 'ux-api-designer', 'developer-agent', 'qa-engineer-e2e']) {
      writeAgentFile(agentsDir, agentId);
    }
    process.env.PIPELINE_AGENTS_DIR    = agentsDir;
    process.env.PIPELINE_MAX_CONCURRENT = '5';
    // Ensure pipelineManager uses a dead Kanban URL (no real kanban move needed in these tests).
    process.env.KANBAN_API_URL = 'http://localhost:19999/api/v1';

    // Invalidate all cached modules so the env vars are picked up.
    for (const key of Object.keys(require.cache)) {
      if (key.includes('/src/agentResolver') || key.includes('/src/pipelineManager')) {
        delete require.cache[key];
      }
    }

    await new Promise((resolve, reject) => {
      server = startServer({ port: 0, dataDir, silent: true });
      server.once('listening', () => { port = server.address().port; resolve(); });
      server.once('error', reject);
    });
  });

  after(async () => {
    // Kill all spawned claude processes before closing the server.
    // Without this, those subprocesses inherit PIPELINE_AGENTS_DIR and may
    // start a new node server.js with the test-temp agents dir in their env.
    try {
      const pm = require('../src/services/pipelineManager');
      await pm.abortAll(dataDir);
    } catch { /* best-effort */ }
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir,   { recursive: true, force: true });
    fs.rmSync(agentsDir, { recursive: true, force: true });
    delete process.env.PIPELINE_AGENTS_DIR;
    delete process.env.PIPELINE_MAX_CONCURRENT;
    delete process.env.KANBAN_API_URL;
  });

  // Helper: create a space with a task via spaceManager directly (bypasses HTTP).
  function setupSpace() {
    const { createSpaceManager } = require('../src/services/spaceManager');
    const sm      = createSpaceManager(dataDir);
    const result  = sm.createSpace(`test-space-${crypto.randomUUID().slice(0, 8)}`);
    const spaceId = result.space.id;

    // Add a task directly into the todo column.
    const taskId  = crypto.randomUUID();
    const todoPath = path.join(dataDir, 'spaces', spaceId, 'todo.json');
    const tasks    = JSON.parse(fs.readFileSync(todoPath, 'utf8'));
    tasks.push({ id: taskId, title: 'Pipeline test task', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    fs.writeFileSync(todoPath, JSON.stringify(tasks), 'utf8');

    return { spaceId, taskId };
  }

  test('POST /api/v1/runs returns 201 with run object for task in todo', async () => {
    const { spaceId, taskId } = setupSpace();
    const res = await request(port, 'POST', '/api/v1/runs', { spaceId, taskId, stages: ['senior-architect'] });

    assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.runId, 'response should have runId');
    assert.equal(res.body.spaceId, spaceId);
    assert.equal(res.body.taskId,  taskId);
    assert.equal(res.body.status,  'pending');
    assert.deepEqual(res.body.stages, ['senior-architect']);
  });

  test('POST /api/v1/runs returns 422 TASK_NOT_IN_TODO for task already in-progress', async () => {
    const { createSpaceManager } = require('../src/services/spaceManager');
    const sm       = createSpaceManager(dataDir);
    const result   = sm.createSpace(`space-inprog-${crypto.randomUUID().slice(0, 6)}`);
    const spaceId  = result.space.id;
    const taskId   = crypto.randomUUID();

    // Put task in in-progress column directly.
    const inProgressPath = path.join(dataDir, 'spaces', spaceId, 'in-progress.json');
    const tasks = JSON.parse(fs.readFileSync(inProgressPath, 'utf8'));
    tasks.push({ id: taskId, title: 'Running task', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    fs.writeFileSync(inProgressPath, JSON.stringify(tasks), 'utf8');

    const res = await request(port, 'POST', '/api/v1/runs', { spaceId, taskId, stages: ['senior-architect'] });

    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'TASK_NOT_IN_TODO');
  });

  test('POST /api/v1/runs returns 404 for unknown taskId', async () => {
    const { createSpaceManager } = require('../src/services/spaceManager');
    const sm      = createSpaceManager(dataDir);
    const result  = sm.createSpace(`space-notask-${crypto.randomUUID().slice(0, 6)}`);
    const spaceId = result.space.id;

    const res = await request(port, 'POST', '/api/v1/runs', { spaceId, taskId: 'no-such-task', stages: ['senior-architect'] });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'TASK_NOT_FOUND');
  });

  test('POST /api/v1/runs returns 400 when spaceId is missing', async () => {
    const res = await request(port, 'POST', '/api/v1/runs', { taskId: 'some-task' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  test('GET /api/v1/runs/:runId returns 200 with run object', async () => {
    const { spaceId, taskId } = setupSpace();
    const createRes = await request(port, 'POST', '/api/v1/runs', { spaceId, taskId, stages: ['senior-architect'] });
    assert.equal(createRes.status, 201);

    const runId  = createRes.body.runId;
    const getRes = await request(port, 'GET', `/api/v1/runs/${runId}`);

    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.runId,  runId);
    assert.equal(getRes.body.spaceId, spaceId);
  });

  test('GET /api/v1/runs/:runId returns 404 for unknown runId', async () => {
    const res = await request(port, 'GET', '/api/v1/runs/no-such-run-id');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'RUN_NOT_FOUND');
  });

  test('GET /api/v1/runs/:runId/stages/0/log returns 404 LOG_NOT_AVAILABLE for non-existent stage', async () => {
    // Test the LOG_NOT_AVAILABLE path by using a run that has 2 stages and
    // querying stage-1 which has not started yet (stage-0 may already have a log
    // file if a real claude process ran, but stage-1 will not yet exist).
    const { spaceId, taskId } = setupSpace();
    const createRes = await request(port, 'POST', '/api/v1/runs', { spaceId, taskId, stages: ['senior-architect', 'developer-agent'] });
    assert.equal(createRes.status, 201);

    const runId = createRes.body.runId;
    // stage-1 has not started yet — its log file does not exist yet.
    const res = await request(port, 'GET', `/api/v1/runs/${runId}/stages/1/log`);

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'LOG_NOT_AVAILABLE');
  });

  test('DELETE /api/v1/runs/:runId returns 200 { deleted: true }', async () => {
    const { spaceId, taskId } = setupSpace();
    const createRes = await request(port, 'POST', '/api/v1/runs', { spaceId, taskId, stages: ['senior-architect'] });
    assert.equal(createRes.status, 201);

    const runId  = createRes.body.runId;
    const delRes = await request(port, 'DELETE', `/api/v1/runs/${runId}`);

    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.deleted, true);
    assert.equal(delRes.body.runId, runId);

    // Verify it is gone.
    const getRes = await request(port, 'GET', `/api/v1/runs/${runId}`);
    assert.equal(getRes.status, 404);
  });

  test('DELETE /api/v1/runs/:runId returns 404 for unknown runId', async () => {
    const res = await request(port, 'DELETE', '/api/v1/runs/ghost-run-id');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'RUN_NOT_FOUND');
  });

  test('GET /api/v1/runs/:runId/stages/99/log returns 404 STAGE_NOT_FOUND', async () => {
    const { spaceId, taskId } = setupSpace();
    const createRes = await request(port, 'POST', '/api/v1/runs', { spaceId, taskId, stages: ['senior-architect'] });
    assert.equal(createRes.status, 201);

    const runId = createRes.body.runId;
    const res   = await request(port, 'GET', `/api/v1/runs/${runId}/stages/99/log`);

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'STAGE_NOT_FOUND');
  });

  test('GET /api/v1/runs/:runId/stages/0/log returns 200 text/plain when log exists', async () => {
    const { spaceId, taskId } = setupSpace();
    const createRes = await request(port, 'POST', '/api/v1/runs', { spaceId, taskId, stages: ['senior-architect'] });
    assert.equal(createRes.status, 201);

    const runId = createRes.body.runId;

    // Manually write a log file so we can test the happy path.
    const { runsDir: getRunsDir } = require('../src/services/pipelineManager');
    const logPath = path.join(getRunsDir(dataDir), runId, 'stage-0.log');
    fs.writeFileSync(logPath, 'Stage 0 output line 1\nStage 0 output line 2\n', 'utf8');

    const res = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}/api/v1/runs/${runId}/stages/0/log`, (httpRes) => {
        const chunks = [];
        httpRes.on('data', (c) => chunks.push(c));
        httpRes.on('end', () => resolve({ status: httpRes.statusCode, headers: httpRes.headers, body: Buffer.concat(chunks).toString('utf8') }));
      }).on('error', reject);
    });

    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/plain'));
    assert.ok(res.body.includes('Stage 0 output line 1'));
  });
});
