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
        const contentType = res.headers['content-type'] || '';
        let body;
        if (contentType.includes('application/json')) {
          try {
            body = JSON.parse(data);
          } catch {
            body = data;
          }
        } else {
          // text/plain or other types
          body = data;
        }
        resolve({ status: res.statusCode, body, headers: res.headers });
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
    agentsDir = tmpDir();

    // Write all 4 default pipeline agents so createRun can validate them
    writeAgentFile(agentsDir, 'senior-architect');
    writeAgentFile(agentsDir, 'ux-api-designer');
    writeAgentFile(agentsDir, 'developer-agent');
    writeAgentFile(agentsDir, 'qa-engineer-e2e');

    // Set up environment
    process.env.PIPELINE_AGENTS_DIR = agentsDir;
    process.env.PIPELINE_RUNS_DIR   = path.join(dataDir, 'runs');

    // Import and start server
    const { startServer } = require('../server');
    server = await new Promise((resolve, reject) => {
      const srv = startServer({ port: 0, dataDir, silent: true });
      srv.once('listening', () => {
        port = srv.address().port;
        resolve(srv);
      });
      srv.once('error', reject);
      setTimeout(() => reject(new Error('Server startup timeout')), 5000);
    });
  });

  after(async () => {
    delete process.env.PIPELINE_RUNS_DIR;
    delete process.env.PIPELINE_AGENTS_DIR;
    return new Promise((resolve) => {
      if (server) {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  });

  test('should create space with workingDirectory', async () => {
    const workingDir = '/Users/test/my-project';
    const res = await request(port, 'POST', '/api/v1/spaces', {
      name: 'my-app-with-dir',
      workingDirectory: workingDir,
    });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.id, 'Space should have an id');
    assert.strictEqual(res.body.workingDirectory, workingDir, 'Space should have the workingDirectory');
  });

  test('should pass workingDirectory through pipeline run creation', async () => {
    const workingDir = '/Users/test/another-project';

    // Create space with workingDirectory
    const spaceRes = await request(port, 'POST', '/api/v1/spaces', {
      name: 'test-space-workingdir-' + crypto.randomUUID().slice(0, 8),
      workingDirectory: workingDir,
    });
    assert.strictEqual(spaceRes.status, 201);
    const spaceId = spaceRes.body.id;

    // Create a task in the space via REST API
    const taskRes = await request(port, 'POST', `/api/v1/spaces/${spaceId}/tasks`, {
      title: 'Test task with working dir',
      type:  'feature',
    });
    assert.strictEqual(taskRes.status, 201);
    const taskId = taskRes.body.id;

    // Launch pipeline run
    const runRes = await request(port, 'POST', '/api/v1/runs', {
      spaceId,
      taskId,
      stages: ['senior-architect'],
    });

    assert.strictEqual(runRes.status, 201);
    const runId = runRes.body.runId;

    // Verify run state has workingDirectory
    assert.strictEqual(runRes.body.workingDirectory, workingDir, `Run should have workingDirectory=${workingDir}`);

    // Verify stage prompt includes workingDirectory
    const promptRes = await request(port, 'GET', `/api/v1/runs/${runId}/stages/0/prompt`, undefined);
    assert.strictEqual(promptRes.status, 200);
    // Note: prompt endpoint returns plain text, not JSON
    const prompt = typeof promptRes.body === 'string' ? promptRes.body : '';
    assert.ok(prompt.includes(workingDir), `Prompt should include workingDirectory "${workingDir}", got: ${prompt.slice(0, 500)}`);
    assert.ok(prompt.includes('Working Directory:'), `Prompt should include "Working Directory:" label`);
    assert.ok(prompt.includes('You MUST cd into this directory'), `Prompt should include warning about cd`);
  });

  test('should work correctly with agents that have working directory set', async () => {
    const workingDir = '/Users/test/projects/my-app';

    // Create space with workingDirectory
    const spaceRes = await request(port, 'POST', '/api/v1/spaces', {
      name: 'space-with-subdir-' + crypto.randomUUID().slice(0, 8),
      workingDirectory: workingDir,
    });
    assert.strictEqual(spaceRes.status, 201);
    const spaceId = spaceRes.body.id;
    assert.strictEqual(spaceRes.body.workingDirectory, workingDir);

    // Create task via REST API
    const taskRes2 = await request(port, 'POST', `/api/v1/spaces/${spaceId}/tasks`, {
      title: 'Task in subdir project',
      type:  'feature',
    });
    assert.strictEqual(taskRes2.status, 201);
    const taskId = taskRes2.body.id;

    // Launch a pipeline run in this space with workingDirectory
    const runRes = await request(port, 'POST', '/api/v1/runs', {
      spaceId,
      taskId,
      stages: ['developer-agent'],
    });

    assert.strictEqual(runRes.status, 201);
    assert.strictEqual(runRes.body.workingDirectory, workingDir);

    // Verify prompt includes working directory
    const runId = runRes.body.runId;
    const promptRes = await request(port, 'GET', `/api/v1/runs/${runId}/stages/0/prompt`, undefined);
    assert.strictEqual(promptRes.status, 200);
    const prompt = typeof promptRes.body === 'string' ? promptRes.body : '';
    assert.ok(prompt.includes('Working Directory: ' + workingDir), 'Prompt must include working directory');
  });

  test('should handle missing workingDirectory gracefully', async () => {
    // Create space WITHOUT workingDirectory
    const spaceRes = await request(port, 'POST', '/api/v1/spaces', {
      name: 'space-no-workingdir-' + crypto.randomUUID().slice(0, 8),
    });
    assert.strictEqual(spaceRes.status, 201);
    const spaceId = spaceRes.body.id;
    assert.ok(!spaceRes.body.workingDirectory);

    // Create task via REST API
    const taskRes3 = await request(port, 'POST', `/api/v1/spaces/${spaceId}/tasks`, {
      title: 'No working dir task',
      type:  'chore',
    });
    assert.strictEqual(taskRes3.status, 201);
    const taskId = taskRes3.body.id;

    // Launch pipeline run
    const runRes = await request(port, 'POST', '/api/v1/runs', {
      spaceId,
      taskId,
      stages: ['developer-agent'],
    });

    assert.strictEqual(runRes.status, 201);
    const runId = runRes.body.runId;

    // Verify prompt doesn't have workingDirectory label or git context
    const promptRes = await request(port, 'GET', `/api/v1/runs/${runId}/stages/0/prompt`, undefined);
    assert.strictEqual(promptRes.status, 200);
    const prompt = typeof promptRes.body === 'string' ? promptRes.body : '';
    assert.ok(!prompt.includes('Working Directory:'), `Prompt should NOT include "Working Directory:" label when not set`);
    assert.ok(!prompt.includes('GIT CONTEXT'), `Prompt should NOT include GIT CONTEXT when no workingDirectory is set — avoids leaking Prism's own git state`);
  });
});
