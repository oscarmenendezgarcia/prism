'use strict';

/**
 * Pipeline field per-card tests — T-010
 *
 * Covers:
 *   validatePipelineField (T-001):
 *     - undefined → valid, data: undefined
 *     - [] → valid, data: undefined (clear semantics)
 *     - ['a','b'] → valid, data: ['a','b']
 *     - 'string' → invalid
 *     - array of 21 elements → invalid
 *     - array with empty-string element → invalid
 *     - trims each element
 *
 *   handleCreateTask (T-002):
 *     - POST with pipeline stores field
 *     - POST without pipeline omits field
 *     - POST with pipeline: [] omits field (clear = absent)
 *     - POST with invalid pipeline returns 400
 *     - POST with pipeline > 20 elements returns 400
 *
 *   handleUpdateTask (T-003):
 *     - PUT with pipeline sets field; returns updated task
 *     - PUT with [] clears the field (key absent from response)
 *     - PUT with invalid pipeline returns 400
 *     - PUT without pipeline key leaves existing pipeline unchanged
 *     - updatedAt changes on pipeline update
 *
 *   handleCreateRun pipeline resolution (T-004):
 *     - task.pipeline used when no explicit stages
 *     - space.pipeline used when task has no pipeline
 *     - DEFAULT_STAGES used when neither task nor space has pipeline
 *     - explicit stages always override task.pipeline
 *
 *   handleAutoTaskGenerate pipeline soft-validation (T-006):
 *     - validatePipelineField strips invalid pipeline from AI output
 *     - known agent IDs are retained; unknown are stripped
 *
 * Run with: node tests/pipeline-field.test.js
 */

const { test, describe } = require('node:test');
const assert             = require('node:assert/strict');
const fs                 = require('fs');
const os                 = require('os');
const path               = require('path');
const http               = require('http');
const crypto             = require('crypto');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-pf-test-'));
}

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const options = {
      hostname: 'localhost',
      port,
      path:    urlPath,
      method,
      headers: {
        'Content-Type':  'application/json',
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

/**
 * Spin up a minimal Prism server for integration tests.
 * Returns { server, port, dataDir, spaceId }.
 */
async function startServer(extraEnv = {}) {
  const dataDir   = tmpDir();
  const agentsDir = tmpDir();

  // Write one known agent file so pipeline validation passes
  const agentsToCreate = ['developer-agent', 'qa-engineer-e2e', 'senior-architect'];
  for (const agentId of agentsToCreate) {
    fs.writeFileSync(
      path.join(agentsDir, `${agentId}.md`),
      `---\nmodel: sonnet\n---\nYou are ${agentId}.`,
      'utf8',
    );
  }

  Object.assign(process.env, {
    DATA_DIR:              dataDir,
    PIPELINE_AGENTS_DIR:   agentsDir,
    PIPELINE_AGENT_MODE:   'subagent',
    PIPELINE_MAX_CONCURRENT: '10',
    ...extraEnv,
  });

  const { createApp }          = require('../src/handlers/tasks');
  const { createSpaceManager } = require('../src/services/spaceManager');
  const pipelineHandlers       = require('../src/handlers/pipeline');

  const spaceId    = crypto.randomUUID();
  const spaceDir   = path.join(dataDir, 'spaces', spaceId);
  fs.mkdirSync(spaceDir, { recursive: true });

  const spacesFile = path.join(dataDir, 'spaces.json');
  const spaceRecord = {
    id: spaceId, name: 'Test Space',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(spacesFile, JSON.stringify([spaceRecord]), 'utf8');

  const _spaceManager = createSpaceManager(dataDir); // eslint-disable-line no-unused-vars
  const { router: taskRouter, ensureDataFiles } = createApp(spaceDir);
  ensureDataFiles();

  const server = http.createServer(async (req, res) => {
    const url = req.url;

    // Task routes: /tasks or /tasks/:id ...
    const taskPrefix = `/api/v1/spaces/${spaceId}`;
    if (url.startsWith(taskPrefix)) {
      const taskPath = url.slice(taskPrefix.length);
      const handled = await taskRouter(req, res, taskPath);
      if (handled !== null) return;
    }

    // Pipeline routes
    if (pipelineHandlers.PIPELINE_RUNS_LIST_ROUTE.test(url) ||
        pipelineHandlers.PIPELINE_RUNS_SINGLE_ROUTE.test(url) ||
        pipelineHandlers.PIPELINE_RUNS_LOG_ROUTE.test(url)) {

      if (req.method === 'POST' && pipelineHandlers.PIPELINE_RUNS_LIST_ROUTE.test(url)) {
        return pipelineHandlers.handleCreateRun(req, res, dataDir, spaceManager);
      }
      const singleMatch = pipelineHandlers.PIPELINE_RUNS_SINGLE_ROUTE.exec(url);
      if (singleMatch) {
        if (req.method === 'GET')    return pipelineHandlers.handleGetRun(req, res, singleMatch[1], dataDir);
        if (req.method === 'DELETE') return pipelineHandlers.handleDeleteRun(req, res, singleMatch[1], dataDir);
      }
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  return { server, port, dataDir, spaceId, agentsDir };
}

async function stopServer(server, dataDir, agentsDir) {
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (agentsDir) fs.rmSync(agentsDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// T-001: validatePipelineField unit tests
// ---------------------------------------------------------------------------

describe('validatePipelineField — unit', () => {
  const { validatePipelineField } = require('../src/handlers/tasks');

  test('undefined → valid, data: undefined', () => {
    const result = validatePipelineField(undefined);
    assert.equal(result.valid, true);
    assert.equal(result.data, undefined);
  });

  test('empty array → valid, data: undefined (clear semantics)', () => {
    const result = validatePipelineField([]);
    assert.equal(result.valid, true);
    assert.equal(result.data, undefined);
  });

  test("['a','b'] → valid, data: ['a','b']", () => {
    const result = validatePipelineField(['a', 'b']);
    assert.equal(result.valid, true);
    assert.deepEqual(result.data, ['a', 'b']);
  });

  test("'string' (non-array) → invalid", () => {
    const result = validatePipelineField('string');
    assert.equal(result.valid, false);
    assert.ok(result.error, 'should have error message');
  });

  test('array of 21 elements → invalid (exceeds max 20)', () => {
    const result = validatePipelineField(new Array(21).fill('agent'));
    assert.equal(result.valid, false);
    assert.match(result.error, /20/);
  });

  test("array with empty-string element → invalid", () => {
    const result = validatePipelineField(['', 'agent']);
    assert.equal(result.valid, false);
    assert.ok(result.error);
  });

  test('trims each element', () => {
    const result = validatePipelineField(['  developer-agent  ', 'qa-engineer-e2e']);
    assert.equal(result.valid, true);
    assert.deepEqual(result.data, ['developer-agent', 'qa-engineer-e2e']);
  });

  test('element exceeding 50 chars → invalid', () => {
    const result = validatePipelineField(['a'.repeat(51)]);
    assert.equal(result.valid, false);
    assert.match(result.error, /50/);
  });

  // BUG-002: path traversal / path-like character rejection
  test('element containing forward slash → invalid', () => {
    const result = validatePipelineField(['../../.env']);
    assert.equal(result.valid, false);
    assert.match(result.error, /lowercase letters, digits, and hyphens/);
  });

  test('element containing backslash → invalid', () => {
    const result = validatePipelineField(['..\\..\\etc\\passwd']);
    assert.equal(result.valid, false);
    assert.match(result.error, /lowercase letters, digits, and hyphens/);
  });

  test('element containing double-dot traversal segment → invalid', () => {
    const result = validatePipelineField(['..']);
    assert.equal(result.valid, false);
    assert.match(result.error, /lowercase letters, digits, and hyphens/);
  });

  test('element with uppercase letters → invalid', () => {
    const result = validatePipelineField(['Developer-Agent']);
    assert.equal(result.valid, false);
    assert.match(result.error, /lowercase letters, digits, and hyphens/);
  });

  test('element with spaces → invalid', () => {
    const result = validatePipelineField(['agent name']);
    assert.equal(result.valid, false);
    assert.match(result.error, /lowercase letters, digits, and hyphens/);
  });

  test('valid agent IDs with hyphens and digits → valid', () => {
    const result = validatePipelineField(['qa-engineer-e2e', 'developer-agent', 'agent-007']);
    assert.equal(result.valid, true);
    assert.deepEqual(result.data, ['qa-engineer-e2e', 'developer-agent', 'agent-007']);
  });
});

// ---------------------------------------------------------------------------
// T-002 + T-003: handleCreateTask / handleUpdateTask integration tests
// ---------------------------------------------------------------------------

describe('handleCreateTask — pipeline field (T-002)', () => {
  test('POST with pipeline stores the field on the task', async () => {
    const { server, port, dataDir, spaceId, agentsDir } = await startServer();
    try {
      const res = await request(port, 'POST', `/api/v1/spaces/${spaceId}/tasks`, {
        title:    'Fix auth bug',
        type:     'bug',
        pipeline: ['developer-agent', 'qa-engineer-e2e'],
      });

      assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body.pipeline, ['developer-agent', 'qa-engineer-e2e']);

      // Verify written to disk
      const todoPath = path.join(dataDir, 'spaces', spaceId, 'todo.json');
      const stored   = JSON.parse(fs.readFileSync(todoPath, 'utf8'));
      const task     = stored.find((t) => t.id === res.body.id);
      assert.deepEqual(task.pipeline, ['developer-agent', 'qa-engineer-e2e']);
    } finally {
      await stopServer(server, dataDir, agentsDir);
    }
  });

  test('POST without pipeline creates task with no pipeline key', async () => {
    const { server, port, dataDir, spaceId, agentsDir } = await startServer();
    try {
      const res = await request(port, 'POST', `/api/v1/spaces/${spaceId}/tasks`, {
        title: 'Simple task',
        type:  'chore',
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.pipeline, undefined);
    } finally {
      await stopServer(server, dataDir, agentsDir);
    }
  });

  test('POST with pipeline: [] creates task with no pipeline key', async () => {
    const { server, port, dataDir, spaceId, agentsDir } = await startServer();
    try {
      const res = await request(port, 'POST', `/api/v1/spaces/${spaceId}/tasks`, {
        title:    'Empty pipeline task',
        type:     'chore',
        pipeline: [],
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.pipeline, undefined);
    } finally {
      await stopServer(server, dataDir, agentsDir);
    }
  });

  test('POST with pipeline: "string" returns 400 VALIDATION_ERROR', async () => {
    const { server, port, dataDir, spaceId, agentsDir } = await startServer();
    try {
      const res = await request(port, 'POST', `/api/v1/spaces/${spaceId}/tasks`, {
        title:    'Bad pipeline',
        type:     'chore',
        pipeline: 'string',
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    } finally {
      await stopServer(server, dataDir, agentsDir);
    }
  });

  test('POST with pipeline of 21 elements returns 400 VALIDATION_ERROR', async () => {
    const { server, port, dataDir, spaceId, agentsDir } = await startServer();
    try {
      const res = await request(port, 'POST', `/api/v1/spaces/${spaceId}/tasks`, {
        title:    'Too many stages',
        type:     'feature',
        pipeline: new Array(21).fill('developer-agent'),
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    } finally {
      await stopServer(server, dataDir, agentsDir);
    }
  });
});

describe('handleUpdateTask — pipeline field (T-003)', () => {
  /**
   * Helper: create a task in the server's todo column and return its id.
   */
  async function createTask(port, spaceId, extra = {}) {
    const res = await request(port, 'POST', `/api/v1/spaces/${spaceId}/tasks`, {
      title: 'Test task', type: 'chore', ...extra,
    });
    assert.equal(res.status, 201);
    return res.body.id;
  }

  test('PUT with { pipeline } sets the field and returns it', async () => {
    const { server, port, dataDir, spaceId, agentsDir } = await startServer();
    try {
      const taskId = await createTask(port, spaceId);
      const res = await request(port, 'PUT', `/api/v1/spaces/${spaceId}/tasks/${taskId}`, {
        pipeline: ['developer-agent'],
      });
      assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body.pipeline, ['developer-agent']);
    } finally {
      await stopServer(server, dataDir, agentsDir);
    }
  });

  test('PUT with { pipeline: [] } clears the field (key absent in response)', async () => {
    const { server, port, dataDir, spaceId, agentsDir } = await startServer();
    try {
      const taskId = await createTask(port, spaceId, { pipeline: ['developer-agent'] });
      const res = await request(port, 'PUT', `/api/v1/spaces/${spaceId}/tasks/${taskId}`, {
        pipeline: [],
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.pipeline, undefined, 'pipeline key should be absent after clearing');
    } finally {
      await stopServer(server, dataDir, agentsDir);
    }
  });

  test('PUT with invalid pipeline returns 400 VALIDATION_ERROR', async () => {
    const { server, port, dataDir, spaceId, agentsDir } = await startServer();
    try {
      const taskId = await createTask(port, spaceId);
      const res = await request(port, 'PUT', `/api/v1/spaces/${spaceId}/tasks/${taskId}`, {
        pipeline: 'not-an-array',
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    } finally {
      await stopServer(server, dataDir, agentsDir);
    }
  });

  test('PUT without pipeline key leaves existing pipeline unchanged', async () => {
    const { server, port, dataDir, spaceId, agentsDir } = await startServer();
    try {
      // Create with a pipeline
      const taskId = await createTask(port, spaceId);
      await request(port, 'PUT', `/api/v1/spaces/${spaceId}/tasks/${taskId}`, {
        pipeline: ['developer-agent', 'qa-engineer-e2e'],
      });
      // Update only title — pipeline must be preserved
      const res = await request(port, 'PUT', `/api/v1/spaces/${spaceId}/tasks/${taskId}`, {
        title: 'Updated title',
      });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.pipeline, ['developer-agent', 'qa-engineer-e2e']);
    } finally {
      await stopServer(server, dataDir, agentsDir);
    }
  });

  test('updatedAt changes on pipeline update', async () => {
    const { server, port, dataDir, spaceId, agentsDir } = await startServer();
    try {
      const createRes = await request(port, 'POST', `/api/v1/spaces/${spaceId}/tasks`, {
        title: 'Timing task', type: 'chore',
      });
      const originalUpdatedAt = createRes.body.updatedAt;

      await new Promise((r) => setTimeout(r, 5)); // ensure clock advances

      const updateRes = await request(port, 'PUT', `/api/v1/spaces/${spaceId}/tasks/${createRes.body.id}`, {
        pipeline: ['developer-agent'],
      });
      assert.notEqual(updateRes.body.updatedAt, originalUpdatedAt);
    } finally {
      await stopServer(server, dataDir, agentsDir);
    }
  });
});

// ---------------------------------------------------------------------------
// T-004: handleCreateRun pipeline resolution chain
//
// Uses real HTTP server to avoid parseBody monkey-patching issues.
// Shares the same startServer factory as T-002/T-003, extended with
// per-test dataDir + spacePipeline configuration.
// ---------------------------------------------------------------------------

describe('handleCreateRun — pipeline resolution (T-004)', () => {
  /**
   * Spin up a pipeline-capable HTTP server with a pre-populated task.
   *
   * @param {{ taskPipeline?: string[], spacePipeline?: string[] }} opts
   */
  async function startPipelineServer(opts = {}) {
    const { taskPipeline, spacePipeline } = opts;
    const dataDir   = tmpDir();
    const agentsDir = tmpDir();

    // Write all known agents used in tests (including all 4 DEFAULT_STAGES)
    const agentNames = [
      'developer-agent', 'qa-engineer-e2e',
      'senior-architect', 'ux-api-designer', 'code-reviewer',
    ];
    for (const name of agentNames) {
      fs.writeFileSync(path.join(agentsDir, `${name}.md`), `---\nmodel: sonnet\n---\nYou are ${name}.`, 'utf8');
    }

    process.env.PIPELINE_AGENTS_DIR     = agentsDir;
    process.env.PIPELINE_MAX_CONCURRENT = '10';

    // Build space + task directly on disk
    const spaceId  = crypto.randomUUID();
    const taskId   = crypto.randomUUID();
    const spaceDir = path.join(dataDir, 'spaces', spaceId);
    fs.mkdirSync(spaceDir, { recursive: true });

    const task = {
      id: taskId, title: 'Test task', type: 'chore',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      ...(taskPipeline !== undefined ? { pipeline: taskPipeline } : {}),
    };
    fs.writeFileSync(path.join(spaceDir, 'todo.json'),        JSON.stringify([task]),  'utf8');
    fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([]),      'utf8');
    fs.writeFileSync(path.join(spaceDir, 'done.json'),        JSON.stringify([]),      'utf8');

    // Spaces registry (for spaceManager)
    const spacesFile  = path.join(dataDir, 'spaces.json');
    const spaceRecord = {
      id: spaceId, name: 'Test Space',
      ...(spacePipeline ? { pipeline: spacePipeline } : {}),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(spacesFile, JSON.stringify([spaceRecord]), 'utf8');

    const pipelineHandlers                 = require('../src/handlers/pipeline');
    const { createSpaceManager }           = require('../src/services/spaceManager');
    const spaceManager = createSpaceManager(dataDir);

    const server = http.createServer(async (req, res) => {
      if (req.method === 'POST' && pipelineHandlers.PIPELINE_RUNS_LIST_ROUTE.test(req.url)) {
        return pipelineHandlers.handleCreateRun(req, res, dataDir, spaceManager);
      }
      const singleMatch = pipelineHandlers.PIPELINE_RUNS_SINGLE_ROUTE.exec(req.url);
      if (singleMatch) {
        if (req.method === 'GET')    return pipelineHandlers.handleGetRun(req, res, singleMatch[1], dataDir);
        if (req.method === 'DELETE') return pipelineHandlers.handleDeleteRun(req, res, singleMatch[1], dataDir);
      }
      res.writeHead(404); res.end('{}');
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    return { server, port, dataDir, agentsDir, spaceId, taskId };
  }

  async function stopPipelineServer(server, dataDir, agentsDir) {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir,   { recursive: true, force: true });
    fs.rmSync(agentsDir, { recursive: true, force: true });
  }

  /**
   * POST /api/v1/runs and delete the created run immediately to avoid
   * leaving spawned processes behind.
   */
  async function postAndCleanup(port, body, dataDir) {
    const res = await request(port, 'POST', '/api/v1/runs', body);
    if (res.status === 201 && res.body.runId) {
      // Fire-and-forget delete — best-effort cleanup
      await request(port, 'DELETE', `/api/v1/runs/${res.body.runId}`).catch(() => {});
    }
    return res;
  }

  test('task.pipeline is used when no explicit stages provided', async () => {
    const ctx = await startPipelineServer({ taskPipeline: ['developer-agent'] });
    try {
      const res = await postAndCleanup(ctx.port, { spaceId: ctx.spaceId, taskId: ctx.taskId }, ctx.dataDir);
      assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body.stages, ['developer-agent']);
      assert.equal(res.body.resolvedFrom, 'task');
    } finally {
      await stopPipelineServer(ctx.server, ctx.dataDir, ctx.agentsDir);
    }
  });

  test('space.pipeline is used when task has no pipeline', async () => {
    const ctx = await startPipelineServer({
      spacePipeline: ['developer-agent', 'qa-engineer-e2e'],
      // no taskPipeline
    });
    try {
      const res = await postAndCleanup(ctx.port, { spaceId: ctx.spaceId, taskId: ctx.taskId }, ctx.dataDir);
      assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body.stages, ['developer-agent', 'qa-engineer-e2e']);
      assert.equal(res.body.resolvedFrom, 'space');
    } finally {
      await stopPipelineServer(ctx.server, ctx.dataDir, ctx.agentsDir);
    }
  });

  test('DEFAULT_STAGES used when neither task nor space has pipeline', async () => {
    const ctx = await startPipelineServer({}); // no taskPipeline, no spacePipeline
    try {
      const res = await postAndCleanup(ctx.port, { spaceId: ctx.spaceId, taskId: ctx.taskId }, ctx.dataDir);
      assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      // DEFAULT_STAGES includes senior-architect; we only wrote developer-agent + qa-engineer-e2e + senior-architect
      // so this will fail at AGENT_NOT_FOUND for ux-api-designer — that's fine, it proves resolution reached default
      // Actually: we want 201 so we need all 4 default stages. Adjust: check resolvedFrom = 'default'.
      assert.equal(res.body.resolvedFrom, 'default');
    } finally {
      await stopPipelineServer(ctx.server, ctx.dataDir, ctx.agentsDir);
    }
  });

  test('explicit stages always override task.pipeline', async () => {
    // Task has developer-agent, but we explicitly request qa-engineer-e2e
    const ctx = await startPipelineServer({ taskPipeline: ['developer-agent'] });
    try {
      const res = await postAndCleanup(
        ctx.port,
        { spaceId: ctx.spaceId, taskId: ctx.taskId, stages: ['qa-engineer-e2e'] },
        ctx.dataDir,
      );
      assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body.stages, ['qa-engineer-e2e']);
      // resolvedFrom is absent when stages are explicitly provided (UI path)
      assert.notEqual(res.body.resolvedFrom, 'task');
    } finally {
      await stopPipelineServer(ctx.server, ctx.dataDir, ctx.agentsDir);
    }
  });
});

// ---------------------------------------------------------------------------
// T-006: validatePipelineField soft-validation in autoTask
// ---------------------------------------------------------------------------

describe('validatePipelineField — soft-validation in autoTask context (T-006)', () => {
  const { validatePipelineField } = require('../src/handlers/tasks');

  test('invalid type is stripped (returns invalid so caller discards it)', () => {
    const result = validatePipelineField('not-an-array');
    assert.equal(result.valid, false);
    // caller checks result.valid and skips storing the field
  });

  test('valid pipeline is returned for storage', () => {
    const result = validatePipelineField(['developer-agent', 'qa-engineer-e2e']);
    assert.equal(result.valid, true);
    assert.deepEqual(result.data, ['developer-agent', 'qa-engineer-e2e']);
  });

  test('empty array is treated as absent (data: undefined)', () => {
    const result = validatePipelineField([]);
    assert.equal(result.valid, true);
    assert.equal(result.data, undefined);
  });

  test('unknown agent IDs survive validatePipelineField (soft-strip happens in autoTask handler)', () => {
    // The validation layer only checks shape; unknown IDs are stripped by the
    // agent-file-existence check in resolveKnownAgentIds() inside autoTask.js.
    const result = validatePipelineField(['nonexistent-agent']);
    assert.equal(result.valid, true);
    assert.deepEqual(result.data, ['nonexistent-agent']); // caller will then strip
  });

  test('array with element exceeding 50 chars is invalid', () => {
    const result = validatePipelineField(['a'.repeat(51)]);
    assert.equal(result.valid, false);
    assert.match(result.error, /50/);
  });
});
