/**
 * Pipeline + Working Directory Test — BUG-004
 *
 * Verifies that when a space has a workingDirectory, agents receive it in the prompt
 * and can still use Kanban MCP tools independently.
 *
 * Scenario:
 *   1. Create space "my-app" with workingDirectory="/Users/you/my-app"
 *   2. Create a task in the space
 *   3. Launch a pipeline run
 *   4. Verify the stage prompt includes the workingDirectory
 *   5. Verify the run state has workingDirectory persisted
 *
 * Run with: node tests/pipeline-workingdir.test.js
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
// Helpers (copied from pipeline.test.js)
// ---------------------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-workingdir-test-'));
}

function writeAgentFile(agentsDir, agentId, model = 'sonnet', body = 'You are a test agent.') {
  fs.mkdirSync(agentsDir, { recursive: true });
  const content = `---\nmodel: ${model}\n---\n\n${body}`;
  fs.writeFileSync(path.join(agentsDir, `${agentId}.md`), content, 'utf8');
}

function createSpaceWithTask(dataDir, spaceId = 'test-space-1') {
  const taskId   = crypto.randomUUID();
  const spaceDir = path.join(dataDir, 'spaces', spaceId);
  fs.mkdirSync(spaceDir, { recursive: true });
  const task = { id: taskId, title: 'Test task', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(spaceDir, 'todo.json'),        JSON.stringify([task]), 'utf8');
  fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([]),     'utf8');
  fs.writeFileSync(path.join(spaceDir, 'done.json'),        JSON.stringify([]),     'utf8');
  return { spaceId, taskId };
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
        'Content-Type': 'application/json',
        ...(payload !== undefined && { 'Content-Length': Buffer.byteLength(payload) }),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, body: json, headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Pipeline + Working Directory (BUG-004)', () => {
  let dataDir, agentsDir, port, server;

  before(async () => {
    dataDir   = tmpDir();
    agentsDir = path.join(dataDir, 'agents');

    // Write mock agents
    writeAgentFile(agentsDir, 'senior-architect');
    writeAgentFile(agentsDir, 'developer-agent');

    // Set up environment
    process.env.PIPELINE_AGENTS_DIR = agentsDir;
    process.env.PIPELINE_RUNS_DIR   = path.join(dataDir, 'runs');
    process.env.DATA_DIR            = dataDir;

    // Import and start server
    const serverModule = require('../server.js');
    port = 9999;
    server = await new Promise((resolve, reject) => {
      const srv = serverModule.listen(port, () => resolve(srv));
      setTimeout(() => reject(new Error('Server startup timeout')), 5000);
    });
  });

  after(async () => {
    return new Promise((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
  });

  test('should create space with workingDirectory', async () => {
    const workingDir = '/Users/test/my-project';
    const res = await request(port, 'POST', '/api/v1/spaces', {
      name: 'my-app',
      workingDirectory: workingDir,
    });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.space);
    assert.strictEqual(res.body.space.workingDirectory, workingDir);
  });

  test('should pass workingDirectory through pipeline run creation', async () => {
    const workingDir = '/Users/test/another-project';

    // Create space with workingDirectory
    const spaceRes = await request(port, 'POST', '/api/v1/spaces', {
      name: 'test-space-workingdir',
      workingDirectory: workingDir,
    });
    const spaceId = spaceRes.body.space.id;

    // Create a task in the space
    const taskId = crypto.randomUUID();
    const spaceDir = path.join(dataDir, 'spaces', spaceId);
    fs.mkdirSync(spaceDir, { recursive: true });
    const task = { id: taskId, title: 'Test task with working dir', type: 'feature', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(spaceDir, 'todo.json'), JSON.stringify([task]), 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([]), 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'done.json'), JSON.stringify([]), 'utf8');

    // Launch pipeline run
    const runRes = await request(port, 'POST', '/api/v1/runs', {
      spaceId,
      taskId,
      stages: ['senior-architect'],
    });

    assert.strictEqual(runRes.status, 201);
    const runId = runRes.body.runId;

    // Verify run state has workingDirectory
    assert.ok(runRes.body.workingDirectory === workingDir, `Expected workingDirectory=${workingDir}, got ${runRes.body.workingDirectory}`);

    // Verify stage prompt includes workingDirectory
    const promptRes = await request(port, 'GET', `/api/v1/runs/${runId}/stages/0/prompt`, undefined);
    assert.strictEqual(promptRes.status, 200);
    const prompt = promptRes.body.text || '';
    assert.ok(prompt.includes(workingDir), `Prompt should include workingDirectory "${workingDir}"`);
    assert.ok(prompt.includes('Working Directory:'), `Prompt should include "Working Directory:" label`);
    assert.ok(prompt.includes('You MUST cd into this directory'), `Prompt should include warning about cd`);
  });

  test('should allow kanban operations while working in subdirectory', async () => {
    const workingDir = '/Users/test/projects/my-app';

    // Create space with workingDirectory
    const spaceRes = await request(port, 'POST', '/api/v1/spaces', {
      name: 'space-with-subdir',
      workingDirectory: workingDir,
    });
    const spaceId = spaceRes.body.space.id;

    // Create and update task
    const taskId = crypto.randomUUID();
    const spaceDir = path.join(dataDir, 'spaces', spaceId);
    fs.mkdirSync(spaceDir, { recursive: true });
    const task = { id: taskId, title: 'Task in subdir', type: 'bug', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(spaceDir, 'todo.json'), JSON.stringify([task]), 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([]), 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'done.json'), JSON.stringify([]), 'utf8');

    // Move task to in-progress (simulating agent work)
    const moveRes = await request(port, 'PATCH', `/api/v1/tasks/${taskId}`, {
      spaceId,
      column: 'in-progress',
    });
    assert.strictEqual(moveRes.status, 200);
    assert.strictEqual(moveRes.body.task.title, 'Task in subdir');

    // Update task with attachment (simulating agent saving artifact)
    const updateRes = await request(port, 'PATCH', `/api/v1/tasks/${taskId}`, {
      spaceId,
      title: 'Task in subdir (updated)',
      description: 'Agent updated this while working in ' + workingDir,
      attachments: [
        { name: 'ADR.md', type: 'text', content: '# Architecture Decision Record\n\nDecided to work in subdirectory.' },
      ],
    });
    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.body.task.description, 'Agent updated this while working in ' + workingDir);
    assert.ok(updateRes.body.task.attachments.length > 0);

    // Verify task is readable (kanban still works)
    const getRes = await request(port, 'GET', `/api/v1/tasks/${taskId}?spaceId=${spaceId}`, undefined);
    assert.strictEqual(getRes.status, 200);
    assert.ok(getRes.body.task);
  });

  test('should handle missing workingDirectory gracefully', async () => {
    // Create space WITHOUT workingDirectory
    const spaceRes = await request(port, 'POST', '/api/v1/spaces', {
      name: 'space-no-workingdir',
    });
    const spaceId = spaceRes.body.space.id;
    assert.ok(!spaceRes.body.space.workingDirectory);

    // Create task
    const taskId = crypto.randomUUID();
    const spaceDir = path.join(dataDir, 'spaces', spaceId);
    fs.mkdirSync(spaceDir, { recursive: true });
    const task = { id: taskId, title: 'No working dir task', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(spaceDir, 'todo.json'), JSON.stringify([task]), 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([]), 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'done.json'), JSON.stringify([]), 'utf8');

    // Launch pipeline run
    const runRes = await request(port, 'POST', '/api/v1/runs', {
      spaceId,
      taskId,
      stages: ['developer-agent'],
    });

    assert.strictEqual(runRes.status, 201);
    const runId = runRes.body.runId;

    // Verify prompt doesn't have workingDirectory label
    const promptRes = await request(port, 'GET', `/api/v1/runs/${runId}/stages/0/prompt`, undefined);
    assert.strictEqual(promptRes.status, 200);
    const prompt = promptRes.body.text || '';
    assert.ok(!prompt.includes('Working Directory:'), `Prompt should NOT include "Working Directory:" label when not set`);
  });
});
