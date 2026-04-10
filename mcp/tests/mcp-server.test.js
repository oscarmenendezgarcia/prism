/**
 * Integration tests for mcp-server.js
 *
 * Lifecycle:
 *  1. Start the Kanban REST server on TEST_KANBAN_PORT (3099).
 *  2. Spawn mcp-server.js as a child process with KANBAN_API_URL pointing
 *     to the test server.
 *  3. Send MCP JSON-RPC messages over the child's stdin.
 *  4. Read responses from the child's stdout.
 *  5. Assert correct JSON-RPC responses for the full CRUD lifecycle.
 *  6. Test the SERVER_UNAVAILABLE error path with the Kanban server stopped.
 *
 * Run: node --test mcp/tests/mcp-server.test.js
 *      (requires the Kanban server NOT already bound to port 3099)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const MCP_SERVER_PATH = join(__dirname, '..', 'mcp-server.js');
const SERVER_JS_PATH = join(PROJECT_ROOT, 'server.js');

const TEST_KANBAN_PORT = 3099;
const MCP_PROTOCOL_VERSION = '2025-11-25';

// Isolated temp data directory — prevents test runs from touching production data.
const TEST_DATA_DIR = join(tmpdir(), `kanban-test-${TEST_KANBAN_PORT}-${Date.now()}`);

// ---------------------------------------------------------------------------
// Kanban test server
// ---------------------------------------------------------------------------

let kanbanServer;

function startKanbanServer(port) {
  return new Promise((resolve, reject) => {
    // Spin up a real Kanban server instance on the test port.
    // We spawn it as a child process so it is completely isolated.
    const proc = spawn('node', [SERVER_JS_PATH], {
      env: { ...process.env, PORT: String(port), DATA_DIR: TEST_DATA_DIR },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', (data) => {
      if (data.toString().includes('running')) {
        resolve(proc);
      }
    });

    proc.on('error', reject);

    proc.stderr.on('data', (d) => {
      // Suppress Kanban server stderr in test output.
    });

    // Safety timeout
    setTimeout(() => reject(new Error('Kanban test server did not start in time')), 5000);
  });
}

// ---------------------------------------------------------------------------
// MCP child process management
// ---------------------------------------------------------------------------

let mcpProc;
let mcpStdoutBuffer = '';
let pendingResolvers = [];

function spawnMcpServer() {
  return new Promise((resolve, reject) => {
    mcpProc = spawn('node', [MCP_SERVER_PATH], {
      env: {
        ...process.env,
        KANBAN_API_URL: `http://localhost:${TEST_KANBAN_PORT}/api/v1`,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    mcpProc.stderr.on('data', (data) => {
      // Capture stderr for debugging; not asserted.
      const line = data.toString();
      if (line.includes('Starting prism')) {
        resolve(mcpProc);
      }
    });

    mcpProc.stdout.on('data', (chunk) => {
      mcpStdoutBuffer += chunk.toString();
      // MCP uses newline-delimited JSON over stdio.
      let nl;
      while ((nl = mcpStdoutBuffer.indexOf('\n')) !== -1) {
        const line = mcpStdoutBuffer.slice(0, nl).trim();
        mcpStdoutBuffer = mcpStdoutBuffer.slice(nl + 1);
        if (line.length === 0) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (pendingResolvers.length > 0) {
          const { resolve: res } = pendingResolvers.shift();
          res(parsed);
        }
      }
    });

    mcpProc.on('error', reject);
    setTimeout(() => reject(new Error('MCP server did not start in time')), 5000);
  });
}

/** Send a JSON-RPC message and wait for the next response from stdout. */
function rpc(method, params, id = 1) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for response to ${method}`)), 8000);
    pendingResolvers.push({
      resolve: (msg) => {
        clearTimeout(timer);
        resolve(msg);
      },
    });
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    mcpProc.stdin.write(message);
  });
}

/** Send a JSON-RPC notification (no response expected). */
function notify(method, params) {
  const message = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
  mcpProc.stdin.write(message);
}

// ---------------------------------------------------------------------------
// MCP handshake helpers
// ---------------------------------------------------------------------------

async function initialize() {
  const resp = await rpc('initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    clientInfo: { name: 'test-client', version: '1.0.0' },
  });
  assert.equal(resp.jsonrpc, '2.0');
  assert.ok(resp.result, 'initialize should return a result');
  // Send initialized notification (no response expected).
  notify('notifications/initialized', {});
  return resp;
}

async function callTool(name, args, id) {
  return rpc('tools/call', { name, arguments: args }, id);
}

// ---------------------------------------------------------------------------
// Suite lifecycle
// ---------------------------------------------------------------------------

before(async () => {
  kanbanServer = await startKanbanServer(TEST_KANBAN_PORT);
  // Small delay to let the Kanban server fully bind before the MCP server connects.
  await new Promise((r) => setTimeout(r, 200));
  await spawnMcpServer();
  await initialize();
});

after(() => {
  if (mcpProc && !mcpProc.killed) {
    mcpProc.stdin.end();
    mcpProc.kill('SIGTERM');
  }
  if (kanbanServer && !kanbanServer.killed) {
    kanbanServer.kill('SIGTERM');
  }
  // Clean up isolated test data directory.
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// Test 1: tools/list returns exactly 6 tools
// ---------------------------------------------------------------------------

describe('MCP handshake', () => {
  it('tools/list returns exactly 7 tools with correct names', async () => {
    const resp = await rpc('tools/list', {}, 100);
    assert.ok(resp.result, 'tools/list should return a result');
    const tools = resp.result.tools;
    assert.ok(Array.isArray(tools), 'tools should be an array');
    assert.equal(tools.length, 7);

    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'kanban_clear_board',
      'kanban_create_task',
      'kanban_delete_task',
      'kanban_get_task',
      'kanban_list_tasks',
      'kanban_move_task',
      'kanban_update_task',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Test 2-7: Full CRUD lifecycle
// ---------------------------------------------------------------------------

describe('CRUD lifecycle', () => {
  let createdTaskId;

  it('kanban_create_task creates a task and returns it with an ID', async () => {
    const resp = await callTool('kanban_create_task', {
      title: 'MCP Integration Test Task',
      type: 'task',
      description: 'Created by mcp-server.test.js',
      assigned: 'test-agent',
    }, 200);

    assert.ok(resp.result, 'should have result');
    assert.equal(resp.result.isError, undefined, 'should not be an error');
    assert.ok(Array.isArray(resp.result.content), 'content should be array');
    assert.equal(resp.result.content[0].type, 'text');

    const task = JSON.parse(resp.result.content[0].text);
    assert.ok(task.id, 'task should have an id');
    assert.equal(task.title, 'MCP Integration Test Task');
    assert.equal(task.type, 'task');
    assert.equal(task.assigned, 'test-agent');

    createdTaskId = task.id;
  });

  it('kanban_get_task finds the created task and includes column field', async () => {
    assert.ok(createdTaskId, 'need a task ID from previous test');

    const resp = await callTool('kanban_get_task', { id: createdTaskId }, 201);
    assert.ok(resp.result);
    assert.equal(resp.result.isError, undefined);

    const task = JSON.parse(resp.result.content[0].text);
    assert.equal(task.id, createdTaskId);
    assert.equal(task.column, 'todo');
    assert.equal(task.title, 'MCP Integration Test Task');
  });

  it('kanban_update_task updates the title of the task', async () => {
    assert.ok(createdTaskId);

    const resp = await callTool('kanban_update_task', {
      id: createdTaskId,
      title: 'Updated by MCP Test',
    }, 202);

    assert.ok(resp.result);
    assert.equal(resp.result.isError, undefined);

    const task = JSON.parse(resp.result.content[0].text);
    assert.equal(task.id, createdTaskId);
    assert.equal(task.title, 'Updated by MCP Test');
  });

  it('kanban_move_task moves the task to in-progress', async () => {
    assert.ok(createdTaskId);

    const resp = await callTool('kanban_move_task', {
      id: createdTaskId,
      to: 'in-progress',
    }, 203);

    assert.ok(resp.result);
    assert.equal(resp.result.isError, undefined);

    const task = JSON.parse(resp.result.content[0].text);
    assert.equal(task.id, createdTaskId);
  });

  it('kanban_list_tasks with column filter returns task in in-progress', async () => {
    assert.ok(createdTaskId);

    const resp = await callTool('kanban_list_tasks', { column: 'in-progress' }, 204);
    assert.ok(resp.result);
    assert.equal(resp.result.isError, undefined);

    const data = JSON.parse(resp.result.content[0].text);
    assert.ok(data['in-progress'], 'in-progress column should be present');
    const found = data['in-progress'].find((t) => t.id === createdTaskId);
    assert.ok(found, 'created task should be in in-progress column');
  });

  it('kanban_list_tasks with assigned filter returns only that agent tasks', async () => {
    assert.ok(createdTaskId);

    const resp = await callTool('kanban_list_tasks', { assigned: 'test-agent' }, 205);
    assert.ok(resp.result);
    assert.equal(resp.result.isError, undefined);

    const data = JSON.parse(resp.result.content[0].text);
    for (const tasks of Object.values(data)) {
      for (const task of tasks) {
        assert.equal(task.assigned, 'test-agent');
      }
    }
  });

  it('kanban_delete_task deletes the task and confirms deletion', async () => {
    assert.ok(createdTaskId);

    const resp = await callTool('kanban_delete_task', { id: createdTaskId }, 206);
    assert.ok(resp.result);
    assert.equal(resp.result.isError, undefined);

    const result = JSON.parse(resp.result.content[0].text);
    assert.equal(result.deleted, true);
    assert.equal(result.id, createdTaskId);
  });

  it('kanban_get_task returns error after task is deleted', async () => {
    assert.ok(createdTaskId);

    const resp = await callTool('kanban_get_task', { id: createdTaskId }, 207);
    assert.ok(resp.result);
    assert.equal(resp.result.isError, true, 'should be an error response');
    assert.match(resp.result.content[0].text, /TASK_NOT_FOUND/);
  });
});

// ---------------------------------------------------------------------------
// Test 8: kanban_clear_board tool
// ---------------------------------------------------------------------------

describe('kanban_clear_board', () => {
  it('clears the board and returns { deleted: N } where N >= 0', async () => {
    // Create a couple of tasks first so N > 0.
    const createResp = await callTool('kanban_create_task', {
      title: 'Clear-board integration test task',
      type: 'task',
      assigned: 'test-clear-agent',
    }, 300);
    assert.ok(createResp.result);
    assert.equal(createResp.result.isError, undefined);

    const clearResp = await callTool('kanban_clear_board', {}, 301);
    assert.ok(clearResp.result, 'should have result');
    assert.equal(clearResp.result.isError, undefined, 'should not be an error');
    assert.ok(Array.isArray(clearResp.result.content), 'content should be array');
    assert.equal(clearResp.result.content[0].type, 'text');

    const result = JSON.parse(clearResp.result.content[0].text);
    assert.ok(typeof result.deleted === 'number', 'deleted should be a number');
    assert.ok(result.deleted >= 1, `Expected at least 1 deleted task, got ${result.deleted}`);
  });

  it('board is empty after kanban_clear_board (verified via kanban_list_tasks)', async () => {
    // Board was cleared in the previous test; verify it is now empty.
    const listResp = await callTool('kanban_list_tasks', {}, 302);
    assert.ok(listResp.result);
    assert.equal(listResp.result.isError, undefined);

    const data = JSON.parse(listResp.result.content[0].text);
    assert.equal(data.todo.length, 0, 'todo should be empty');
    assert.equal(data['in-progress'].length, 0, 'in-progress should be empty');
    assert.equal(data.done.length, 0, 'done should be empty');
  });

  it('clearing an already-empty board returns { deleted: 0 } without error', async () => {
    const clearResp = await callTool('kanban_clear_board', {}, 303);
    assert.ok(clearResp.result);
    assert.equal(clearResp.result.isError, undefined, 'should not be an error');

    const result = JSON.parse(clearResp.result.content[0].text);
    assert.equal(result.deleted, 0, `Expected deleted=0, got ${result.deleted}`);
  });
});

// ---------------------------------------------------------------------------
// Test 9: Error path — Kanban server unavailable
// ---------------------------------------------------------------------------

describe('error handling', () => {
  let mcpProc2;

  it('returns isError: true with SERVER_UNAVAILABLE when Kanban server is down', async () => {
    // Spawn a second MCP server pointing at a port with nothing listening.
    const DEAD_PORT = 39198;
    let resolved = false;

    mcpProc2 = spawn('node', [MCP_SERVER_PATH], {
      env: {
        ...process.env,
        KANBAN_API_URL: `http://localhost:${DEAD_PORT}/api/v1`,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Collect stdout from proc2 separately.
    let buf2 = '';
    const getNextMessage2 = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout on proc2')), 8000);

      const tryParse = () => {
        const nl = buf2.indexOf('\n');
        if (nl !== -1) {
          clearTimeout(timer);
          const line = buf2.slice(0, nl).trim();
          buf2 = buf2.slice(nl + 1);
          resolve(JSON.parse(line));
        }
      };

      mcpProc2.stdout.on('data', (chunk) => {
        buf2 += chunk.toString();
        tryParse();
      });

      tryParse();
    });

    // Wait for MCP server 2 to start (it logs to stderr).
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('proc2 start timeout')), 5000);
      mcpProc2.stderr.on('data', (d) => {
        if (d.toString().includes('Starting prism')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    // Initialize proc2.
    mcpProc2.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    }) + '\n');

    const initResp = await getNextMessage2();
    assert.ok(initResp.result);

    mcpProc2.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

    // Call a tool — should fail with SERVER_UNAVAILABLE.
    mcpProc2.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'kanban_list_tasks', arguments: {} },
    }) + '\n');

    const toolResp = await getNextMessage2();
    assert.ok(toolResp.result, 'should have result even on error');
    assert.equal(toolResp.result.isError, true, 'isError should be true');
    assert.match(toolResp.result.content[0].text, /SERVER_UNAVAILABLE/);

    mcpProc2.stdin.end();
    mcpProc2.kill('SIGTERM');
  });
});
