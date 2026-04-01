/**
 * Integration tests for the Agent Launcher server endpoints.
 * T-022: GET /api/v1/agents, GET /api/v1/agents/:agentId,
 *        POST /api/v1/agent/prompt, GET /api/v1/settings, PUT /api/v1/settings.
 *
 * Strategy:
 *   - startTestServer() creates an isolated server on a random port with a
 *     temp data directory.
 *   - Agent files are written to a temp directory under os.tmpdir() and the
 *     AGENTS_DIR constant cannot be overridden, so we write real .md files
 *     to ~/.claude/agents/ with a unique test prefix and clean them up in
 *     teardown (identical strategy to config.test.js).
 *   - Tasks are created directly via the task API so prompt generation can
 *     find them.
 *   - Settings file (data/settings.json) lives in the per-test temp dataDir
 *     so there is no interference with the real settings.
 *
 * Run with: node tests/agent-launcher.test.js
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const http = require('http');
const { startTestServer } = require('./helpers/server');

// ---------------------------------------------------------------------------
// Minimal test runner (same pattern as config.test.js)
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

function suite(name) {
  console.log(`\n${name}`);
}

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
        path:     urlPath,
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
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });

      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  };
}

// ---------------------------------------------------------------------------
// Agent file helpers — write real files to ~/.claude/agents/ with test prefix
// ---------------------------------------------------------------------------

const AGENTS_DIR = path.join(os.homedir(), '.claude', 'agents');
const TEST_PREFIX = 'prism-test-agent-';

function ensureAgentsDir() {
  if (!fs.existsSync(AGENTS_DIR)) {
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
  }
}

function createTestAgent(stem, content = `# ${stem}\n\nTest agent content.`) {
  ensureAgentsDir();
  const filename = `${TEST_PREFIX}${stem}.md`;
  const absPath  = path.join(AGENTS_DIR, filename);
  fs.writeFileSync(absPath, content, 'utf8');
  return { filename, absPath, id: `${TEST_PREFIX}${stem}`, stem };
}

function removeTestAgent(filename) {
  const absPath = path.join(AGENTS_DIR, filename);
  try { fs.unlinkSync(absPath); } catch { /* already gone */ }
}

function removeAllTestAgents() {
  if (!fs.existsSync(AGENTS_DIR)) return;
  for (const f of fs.readdirSync(AGENTS_DIR)) {
    if (f.startsWith(TEST_PREFIX)) {
      try { fs.unlinkSync(path.join(AGENTS_DIR, f)); } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Task creation helper — uses POST /api/v1/spaces/:spaceId/tasks
// ---------------------------------------------------------------------------

async function createTaskViaApi(request, port, spaceId = 'default') {
  const response = await request('POST', `/api/v1/spaces/${spaceId}/tasks`, {
    title: 'Test task for prompt generation',
    type:  'chore',
  });
  return response.body;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  let server;
  let request;
  let port;

  // Set up a single server for all tests.
  server  = await startTestServer();
  port    = server.port;
  request = makeRequest(port);

  // Clean up any leftover test agents from a previous aborted run.
  removeAllTestAgents();

  // =========================================================================
  // GET /api/v1/agents
  // =========================================================================
  suite('GET /api/v1/agents — list agents');

  await test('returns 200 with empty array when no test agents exist', async () => {
    const res = await request('GET', '/api/v1/agents');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(Array.isArray(res.body), 'body should be an array');
    // There may be real agent files; we just verify it is an array.
  });

  await test('returns 200 and includes newly created test agent', async () => {
    const agent = createTestAgent('alpha');
    try {
      const res = await request('GET', '/api/v1/agents');
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const found = res.body.find((a) => a.id === agent.id);
      assert(found !== undefined, `agent ${agent.id} not found in response`);
      assert(found.name  === agent.filename,          `name mismatch: ${found.name}`);
      assert(typeof found.displayName === 'string',   'displayName must be a string');
      assert(typeof found.path        === 'string',   'path must be a string');
      assert(typeof found.sizeBytes   === 'number',   'sizeBytes must be a number');
    } finally {
      removeTestAgent(agent.filename);
    }
  });

  await test('id is derived from the filename stem (kebab-case)', async () => {
    const agent = createTestAgent('my-agent-foo');
    try {
      const res = await request('GET', '/api/v1/agents');
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const found = res.body.find((a) => a.id === `${TEST_PREFIX}my-agent-foo`);
      assert(found !== undefined, 'agent not found by kebab id');
    } finally {
      removeTestAgent(agent.filename);
    }
  });

  await test('reflects newly added agent without server restart', async () => {
    // First call — no beta agent.
    const res1 = await request('GET', '/api/v1/agents');
    const hadBefore = res1.body.some((a) => a.id.endsWith('beta'));
    assert(!hadBefore, 'beta agent should not exist before creation');

    const agent = createTestAgent('beta');
    try {
      // Second call — beta agent should now appear.
      const res2 = await request('GET', '/api/v1/agents');
      const hasBeta = res2.body.some((a) => a.id === agent.id);
      assert(hasBeta, 'beta agent should appear after file creation without restart');
    } finally {
      removeTestAgent(agent.filename);
    }
  });

  await test('returns 405 for non-GET methods', async () => {
    const res = await request('POST', '/api/v1/agents');
    assert(res.status === 405, `expected 405, got ${res.status}`);
  });

  // =========================================================================
  // GET /api/v1/agents/:agentId
  // =========================================================================
  suite('GET /api/v1/agents/:agentId — read agent');

  await test('returns 200 with id, name, displayName, content for existing agent', async () => {
    const content = '# Test Gamma Agent\n\nYou are the test agent.';
    const agent   = createTestAgent('gamma', content);
    try {
      const res = await request('GET', `/api/v1/agents/${agent.id}`);
      assert(res.status === 200,              `expected 200, got ${res.status}`);
      assert(res.body.id          === agent.id,       'id mismatch');
      assert(res.body.name        === agent.filename, 'name mismatch');
      assert(typeof res.body.displayName === 'string', 'displayName must be string');
      assert(res.body.content     === content,        'content must match file');
    } finally {
      removeTestAgent(agent.filename);
    }
  });

  await test('returns 404 AGENT_NOT_FOUND when file does not exist', async () => {
    const res = await request('GET', '/api/v1/agents/nonexistent-agent-xyz');
    assert(res.status === 404,                     `expected 404, got ${res.status}`);
    assert(res.body.error.code === 'AGENT_NOT_FOUND', `unexpected error code: ${res.body.error.code}`);
  });

  await test('returns 400 INVALID_AGENT_ID for non-kebab agentId', async () => {
    const res = await request('GET', '/api/v1/agents/UPPER_CASE');
    assert(res.status === 400,                      `expected 400, got ${res.status}`);
    assert(res.body.error.code === 'INVALID_AGENT_ID', `unexpected code: ${res.body.error.code}`);
  });

  await test('returns 400 INVALID_AGENT_ID for agentId with dots (path traversal attempt)', async () => {
    const res = await request('GET', '/api/v1/agents/..%2Fetc%2Fpasswd');
    // Either 400 (invalid ID) or 404 (not found after sanitising) is acceptable.
    assert(
      res.status === 400 || res.status === 404,
      `expected 400 or 404 for path traversal attempt, got ${res.status}`
    );
    // Must never be 200.
    assert(res.status !== 200, 'path traversal must not succeed with 200');
  });

  await test('returns 405 for non-GET methods', async () => {
    const agent = createTestAgent('delta');
    try {
      const res = await request('POST', `/api/v1/agents/${agent.id}`);
      assert(res.status === 405, `expected 405, got ${res.status}`);
    } finally {
      removeTestAgent(agent.filename);
    }
  });

  // =========================================================================
  // GET /api/v1/settings
  // =========================================================================
  suite('GET /api/v1/settings — read settings');

  await test('returns 200 with default settings when no settings file exists', async () => {
    const res = await request('GET', '/api/v1/settings');
    assert(res.status === 200,                      `expected 200, got ${res.status}`);
    assert(res.body.cli.tool            === 'claude',        'default cli.tool should be claude');
    assert(res.body.cli.binary          === 'claude',        'default cli.binary should be claude');
    assert(Array.isArray(res.body.cli.flags),                'cli.flags must be an array');
    assert(res.body.cli.promptFlag      === '-p',            'default promptFlag should be -p');
    assert(res.body.cli.fileInputMethod === 'cat-subshell',  'default fileInputMethod should be cat-subshell');
    assert(res.body.pipeline.autoAdvance         === true,   'default autoAdvance should be true');
    assert(res.body.pipeline.confirmBetweenStages === true,  'default confirmBetweenStages should be true');
    assert(Array.isArray(res.body.pipeline.stages),          'pipeline.stages must be an array');
    assert(res.body.pipeline.stages.length === 4,            'pipeline.stages should have 4 entries');
    assert(res.body.prompts.includeKanbanBlock === true,     'default includeKanbanBlock should be true');
    assert(res.body.prompts.includeGitBlock    === true,     'default includeGitBlock should be true');
    assert(res.body.prompts.workingDirectory   === '',       'default workingDirectory should be empty');
  });

  await test('returns 405 for non-GET/PUT methods', async () => {
    const res = await request('DELETE', '/api/v1/settings');
    assert(res.status === 405, `expected 405, got ${res.status}`);
  });

  // =========================================================================
  // PUT /api/v1/settings
  // =========================================================================
  suite('PUT /api/v1/settings — update settings');

  await test('returns 200 with merged settings on valid partial update', async () => {
    const res = await request('PUT', '/api/v1/settings', {
      cli: { tool: 'opencode', binary: 'opencode' },
    });
    assert(res.status === 200,                     `expected 200, got ${res.status}`);
    assert(res.body.cli.tool   === 'opencode',     `tool should be opencode, got ${res.body.cli.tool}`);
    assert(res.body.cli.binary === 'opencode',     `binary should be opencode, got ${res.body.cli.binary}`);
    // Fields not in partial should retain defaults.
    assert(res.body.cli.promptFlag === '-p',       'promptFlag should retain default');
    assert(res.body.pipeline.autoAdvance === true, 'pipeline.autoAdvance should retain default');
  });

  await test('persists settings so GET returns the updated values', async () => {
    await request('PUT', '/api/v1/settings', { prompts: { workingDirectory: '/tmp/test-project' } });
    const res = await request('GET', '/api/v1/settings');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(
      res.body.prompts.workingDirectory === '/tmp/test-project',
      `expected /tmp/test-project, got ${res.body.prompts.workingDirectory}`
    );
  });

  await test('deep-merges cli partial — unset fields keep defaults', async () => {
    // Reset first.
    await request('PUT', '/api/v1/settings', { cli: { tool: 'claude', binary: 'claude' } });
    // Update only fileInputMethod.
    await request('PUT', '/api/v1/settings', { cli: { fileInputMethod: 'stdin-redirect' } });
    const res = await request('GET', '/api/v1/settings');
    assert(res.body.cli.fileInputMethod === 'stdin-redirect', 'fileInputMethod should be updated');
    assert(res.body.cli.tool === 'claude', 'tool should retain previous value');
  });

  await test('returns 400 VALIDATION_ERROR for invalid cli.tool', async () => {
    const res = await request('PUT', '/api/v1/settings', { cli: { tool: 'bad-tool' } });
    assert(res.status === 400,                         `expected 400, got ${res.status}`);
    assert(res.body.error.code === 'VALIDATION_ERROR', `unexpected code: ${res.body.error.code}`);
    assert(res.body.error.field === 'cli.tool',        `expected field cli.tool, got ${res.body.error.field}`);
  });

  await test('returns 400 VALIDATION_ERROR for invalid cli.fileInputMethod', async () => {
    const res = await request('PUT', '/api/v1/settings', { cli: { fileInputMethod: 'pipe' } });
    assert(res.status === 400,                         `expected 400, got ${res.status}`);
    assert(res.body.error.code === 'VALIDATION_ERROR', `unexpected code: ${res.body.error.code}`);
  });

  await test('returns 400 VALIDATION_ERROR for empty body', async () => {
    const res = await request('PUT', '/api/v1/settings', null);
    assert(res.status === 400, `expected 400, got ${res.status}`);
    assert(res.body.error.code === 'VALIDATION_ERROR', `unexpected code: ${res.body.error.code}`);
  });

  // =========================================================================
  // POST /api/v1/agent/prompt
  // =========================================================================
  suite('POST /api/v1/agent/prompt — generate prompt');

  await test('returns 201 with promptPath, promptPreview, cliCommand, estimatedTokens', async () => {
    // Create a test agent file.
    const content = '# Test Architect\n\nYou are the test architect. Do great things.';
    const agent   = createTestAgent('prompt-test-arch', content);

    // Create a task to reference.
    const task = await createTaskViaApi(request, port, 'default');

    try {
      const res = await request('POST', '/api/v1/agent/prompt', {
        agentId: agent.id,
        taskId:  task.id,
        spaceId: 'default',
      });

      assert(res.status === 201,                       `expected 201, got ${res.status}`);
      assert(typeof res.body.promptPath    === 'string', 'promptPath must be a string');
      assert(typeof res.body.promptPreview === 'string', 'promptPreview must be a string');
      assert(typeof res.body.cliCommand    === 'string', 'cliCommand must be a string');
      assert(typeof res.body.estimatedTokens === 'number', 'estimatedTokens must be a number');
      assert(res.body.promptPath.endsWith('.md'),        'promptPath must end with .md');
      assert(res.body.promptPath.includes(task.id.slice(0, 8)), 'promptPath should include task id prefix');

      // Prompt file should exist on disk.
      assert(fs.existsSync(res.body.promptPath), `prompt file not found at ${res.body.promptPath}`);

      // CLI command should reference the prompt file.
      assert(
        res.body.cliCommand.includes(res.body.promptPath),
        'cliCommand should reference the prompt file path'
      );
    } finally {
      removeTestAgent(agent.filename);
    }
  });

  await test('promptPreview is first 500 chars of the assembled prompt', async () => {
    const agent = createTestAgent('prompt-test-preview', '# Preview Agent\n\nContent here.');
    const task  = await createTaskViaApi(request, port, 'default');

    try {
      const res = await request('POST', '/api/v1/agent/prompt', {
        agentId: agent.id,
        taskId:  task.id,
        spaceId: 'default',
      });

      assert(res.status === 201, `expected 201, got ${res.status}`);
      assert(res.body.promptPreview.length <= 500, 'promptPreview must be at most 500 chars');
      // Preview should start with the TASK CONTEXT header.
      assert(
        res.body.promptPreview.startsWith('## TASK CONTEXT'),
        `promptPreview should start with ## TASK CONTEXT, got: ${res.body.promptPreview.slice(0, 30)}`
      );
    } finally {
      removeTestAgent(agent.filename);
    }
  });

  await test('cliCommand uses claude tool by default', async () => {
    const agent = createTestAgent('prompt-test-cli', '# CLI Agent\n\nTest.');
    const task  = await createTaskViaApi(request, port, 'default');

    try {
      // Reset settings to default claude tool.
      await request('PUT', '/api/v1/settings', { cli: { tool: 'claude', binary: 'claude' } });

      const res = await request('POST', '/api/v1/agent/prompt', {
        agentId: agent.id,
        taskId:  task.id,
        spaceId: 'default',
      });

      assert(res.status === 201, `expected 201, got ${res.status}`);
      assert(
        res.body.cliCommand.startsWith('claude'),
        `cliCommand should start with 'claude', got: ${res.body.cliCommand.slice(0, 20)}`
      );
    } finally {
      removeTestAgent(agent.filename);
    }
  });

  await test('cliCommand uses opencode tool when settings.cli.tool is opencode', async () => {
    const agent = createTestAgent('prompt-test-opencode', '# OC Agent\n\nTest.');
    const task  = await createTaskViaApi(request, port, 'default');

    try {
      await request('PUT', '/api/v1/settings', { cli: { tool: 'opencode', binary: 'opencode' } });

      const res = await request('POST', '/api/v1/agent/prompt', {
        agentId: agent.id,
        taskId:  task.id,
        spaceId: 'default',
      });

      assert(res.status === 201, `expected 201, got ${res.status}`);
      assert(
        res.body.cliCommand.startsWith('opencode run'),
        `cliCommand should start with 'opencode run', got: ${res.body.cliCommand.slice(0, 30)}`
      );
    } finally {
      removeTestAgent(agent.filename);
      // Restore default settings.
      await request('PUT', '/api/v1/settings', { cli: { tool: 'claude', binary: 'claude' } });
    }
  });

  await test('prompt includes TASK CONTEXT section with task title', async () => {
    const agent = createTestAgent('prompt-test-ctx', '# Context Agent\n\nContent.');
    const task  = await createTaskViaApi(request, port, 'default');

    try {
      const res = await request('POST', '/api/v1/agent/prompt', {
        agentId: agent.id,
        taskId:  task.id,
        spaceId: 'default',
      });
      assert(res.status === 201, `expected 201, got ${res.status}`);

      // Read the prompt file and verify its contents.
      const promptContent = fs.readFileSync(res.body.promptPath, 'utf8');
      assert(promptContent.includes('## TASK CONTEXT'),       'prompt must include ## TASK CONTEXT');
      assert(promptContent.includes('## AGENT INSTRUCTIONS'), 'prompt must include ## AGENT INSTRUCTIONS');
      assert(promptContent.includes(task.title),              'prompt must include the task title');
    } finally {
      removeTestAgent(agent.filename);
    }
  });

  await test('prompt includes KANBAN INSTRUCTIONS when setting is enabled', async () => {
    await request('PUT', '/api/v1/settings', { prompts: { includeKanbanBlock: true } });
    const agent = createTestAgent('prompt-test-kanban', '# Kanban Agent\n\nContent.');
    const task  = await createTaskViaApi(request, port, 'default');

    try {
      const res = await request('POST', '/api/v1/agent/prompt', {
        agentId: agent.id,
        taskId:  task.id,
        spaceId: 'default',
      });
      const promptContent = fs.readFileSync(res.body.promptPath, 'utf8');
      assert(promptContent.includes('## KANBAN INSTRUCTIONS'), 'prompt must include kanban block');
    } finally {
      removeTestAgent(agent.filename);
    }
  });

  await test('prompt omits KANBAN INSTRUCTIONS when setting is disabled', async () => {
    await request('PUT', '/api/v1/settings', { prompts: { includeKanbanBlock: false } });
    const agent = createTestAgent('prompt-test-nokanban', '# NoKanban Agent\n\nContent.');
    const task  = await createTaskViaApi(request, port, 'default');

    try {
      const res = await request('POST', '/api/v1/agent/prompt', {
        agentId: agent.id,
        taskId:  task.id,
        spaceId: 'default',
      });
      const promptContent = fs.readFileSync(res.body.promptPath, 'utf8');
      assert(!promptContent.includes('## KANBAN INSTRUCTIONS'), 'prompt must omit kanban block when disabled');
    } finally {
      removeTestAgent(agent.filename);
      // Restore.
      await request('PUT', '/api/v1/settings', { prompts: { includeKanbanBlock: true } });
    }
  });

  await test('appends customInstructions when provided', async () => {
    const agent = createTestAgent('prompt-test-custom', '# Custom Agent\n\nContent.');
    const task  = await createTaskViaApi(request, port, 'default');

    try {
      const res = await request('POST', '/api/v1/agent/prompt', {
        agentId:            agent.id,
        taskId:             task.id,
        spaceId:            'default',
        customInstructions: 'Focus on performance above all else.',
      });
      const promptContent = fs.readFileSync(res.body.promptPath, 'utf8');
      assert(
        promptContent.includes('Focus on performance above all else.'),
        'custom instructions must appear in the prompt'
      );
    } finally {
      removeTestAgent(agent.filename);
    }
  });

  await test('returns 400 VALIDATION_ERROR when agentId is missing', async () => {
    const task = await createTaskViaApi(request, port, 'default');
    const res  = await request('POST', '/api/v1/agent/prompt', {
      taskId:  task.id,
      spaceId: 'default',
    });
    assert(res.status === 400,                         `expected 400, got ${res.status}`);
    assert(res.body.error.code === 'VALIDATION_ERROR', `unexpected code: ${res.body.error.code}`);
    assert(res.body.error.field === 'agentId',         `expected field agentId, got ${res.body.error.field}`);
  });

  await test('returns 400 VALIDATION_ERROR when taskId is missing', async () => {
    const agent = createTestAgent('prompt-test-missing-task', '# Agent\n\nContent.');
    try {
      const res = await request('POST', '/api/v1/agent/prompt', {
        agentId: agent.id,
        spaceId: 'default',
      });
      assert(res.status === 400,                         `expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', `unexpected code: ${res.body.error.code}`);
      assert(res.body.error.field === 'taskId',          `expected field taskId, got ${res.body.error.field}`);
    } finally {
      removeTestAgent(agent.filename);
    }
  });

  await test('returns 400 VALIDATION_ERROR when spaceId is missing', async () => {
    const agent = createTestAgent('prompt-test-missing-space', '# Agent\n\nContent.');
    try {
      const res = await request('POST', '/api/v1/agent/prompt', {
        agentId: agent.id,
        taskId:  'some-task-id',
      });
      assert(res.status === 400,                         `expected 400, got ${res.status}`);
      assert(res.body.error.code === 'VALIDATION_ERROR', `unexpected code: ${res.body.error.code}`);
      assert(res.body.error.field === 'spaceId',         `expected field spaceId, got ${res.body.error.field}`);
    } finally {
      removeTestAgent(agent.filename);
    }
  });

  await test('returns 404 AGENT_NOT_FOUND when agent file does not exist', async () => {
    const task = await createTaskViaApi(request, port, 'default');
    const res  = await request('POST', '/api/v1/agent/prompt', {
      agentId: 'nonexistent-agent-zzz',
      taskId:  task.id,
      spaceId: 'default',
    });
    assert(res.status === 404,                       `expected 404, got ${res.status}`);
    assert(res.body.error.code === 'AGENT_NOT_FOUND', `unexpected code: ${res.body.error.code}`);
  });

  await test('returns 404 TASK_NOT_FOUND when task does not exist in space', async () => {
    const agent = createTestAgent('prompt-test-notask', '# Agent\n\nContent.');
    try {
      const res = await request('POST', '/api/v1/agent/prompt', {
        agentId: agent.id,
        taskId:  'nonexistent-task-id-xyz',
        spaceId: 'default',
      });
      assert(res.status === 404,                        `expected 404, got ${res.status}`);
      assert(res.body.error.code === 'TASK_NOT_FOUND',  `unexpected code: ${res.body.error.code}`);
    } finally {
      removeTestAgent(agent.filename);
    }
  });

  await test('returns 405 for non-POST methods', async () => {
    const res = await request('GET', '/api/v1/agent/prompt');
    assert(res.status === 405, `expected 405, got ${res.status}`);
  });

  // =========================================================================
  // Teardown
  // =========================================================================
  removeAllTestAgents();
  await server.close();

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.error('\nFailures:');
    for (const f of failures) {
      console.error(`  - ${f.name}: ${f.error}`);
    }
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unexpected error running tests:', err);
  process.exit(1);
});
