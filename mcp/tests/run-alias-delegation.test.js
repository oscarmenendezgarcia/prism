/**
 * Delegation test for the run-vs-pipeline rename (ADR-1
 * mcp-pipeline-run-rename).
 *
 * Verifies that:
 *   1. All 6 run-related tools are registered on the MCP server:
 *      canonical: kanban_start_run, kanban_stop_run, kanban_resume_run,
 *                 kanban_get_run_status
 *      aliases:   kanban_start_pipeline, kanban_stop_pipeline,
 *                 kanban_resume_pipeline
 *   2. Deprecated tool descriptions begin with '[DEPRECATED'.
 *   3. Invoking either the canonical name OR the deprecated alias hits the
 *      SAME REST endpoint with byte-identical request bodies (proving both
 *      share one handler closure).
 *   4. The deprecation WARN line is emitted on alias invocation only.
 *
 * Isolation: this test does NOT depend on the real Kanban server. It spins
 * up a tiny mock HTTP server that records incoming requests and returns
 * canned JSON responses — that is all `kanban-client.js` needs.
 *
 * Run: node --test mcp/tests/run-alias-delegation.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname       = dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_PATH = join(__dirname, '..', 'mcp-server.js');
const MCP_PROTOCOL_VERSION = '2025-11-25';

// ---------------------------------------------------------------------------
// Mock Kanban HTTP server
// ---------------------------------------------------------------------------

/**
 * Records requests keyed by `${method} ${path}`. Returns 200 with the mocked
 * JSON body the corresponding run endpoint would return.
 */
function startMockKanban() {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({
        method: req.method,
        path:   req.url,
        body:   body.length ? JSON.parse(body) : null,
      });
      res.setHeader('content-type', 'application/json');
      // Canned response — enough for kanban-client.js to parse.
      if (req.method === 'POST' && req.url === '/api/v1/runs') {
        res.end(JSON.stringify({ runId: 'run-mock-1', status: 'pending' }));
      } else if (req.url.endsWith('/stop') || req.url.endsWith('/resume')) {
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.end(JSON.stringify({ ok: true }));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, requests });
    });
  });
}

// ---------------------------------------------------------------------------
// MCP child helpers (self-contained — no shared state with mcp-server.test.js)
// ---------------------------------------------------------------------------

function spawnMcp(kanbanPort) {
  const proc = spawn('node', [MCP_SERVER_PATH], {
    env: { ...process.env, KANBAN_API_URL: `http://127.0.0.1:${kanbanPort}/api/v1` },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stderr = { buffer: '' };
  proc.stderr.on('data', (chunk) => { stderr.buffer += chunk.toString(); });

  const stdout = { buffer: '', pending: [] };
  proc.stdout.on('data', (chunk) => {
    stdout.buffer += chunk.toString();
    let nl;
    while ((nl = stdout.buffer.indexOf('\n')) !== -1) {
      const line = stdout.buffer.slice(0, nl).trim();
      stdout.buffer = stdout.buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const waiter = stdout.pending.shift();
      if (waiter) waiter(msg);
    }
  });

  return { proc, stderr, stdout };
}

function rpc(child, method, params, id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Surface what the server has actually said on stderr — helps diagnose
      // silent hangs (schema-validation errors, uninitialized handshake, etc.).
      reject(new Error(
        `Timeout waiting for ${method} id=${id}. stderr tail:\n${child.stderr.buffer.slice(-800)}\nstdout tail:\n${child.stdout.buffer.slice(-800)}`,
      ));
    }, 4000);
    child.stdout.pending.push((msg) => { clearTimeout(timer); resolve(msg); });
    child.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

function notify(child, method, params) {
  child.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

async function waitForBoot(child) {
  // Wait for the "Starting prism" log line on stderr.
  const deadline = Date.now() + 5000;
  while (!child.stderr.buffer.includes('Starting prism')) {
    if (Date.now() > deadline) throw new Error('MCP server boot timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function initialize(child) {
  await rpc(child, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    clientInfo: { name: 'delegation-test', version: '1.0.0' },
  }, 1);
  notify(child, 'notifications/initialized', {});
}

// ---------------------------------------------------------------------------
// Fixture setup — one MCP server + one mock Kanban shared across `it` blocks
// ---------------------------------------------------------------------------

const RUN_CANONICAL   = ['kanban_start_run', 'kanban_stop_run', 'kanban_resume_run', 'kanban_get_run_status'];
const RUN_DEPRECATED  = ['kanban_start_pipeline', 'kanban_stop_pipeline', 'kanban_resume_pipeline'];

describe('MCP run-tool rename — canonical + deprecated alias delegation', () => {
  let mock, child;

  it('boots the MCP server against a mock Kanban', async () => {
    mock  = await startMockKanban();
    child = spawnMcp(mock.port);
    await waitForBoot(child);
    await initialize(child);
    assert.ok(child.proc.pid, 'child MCP process should be running');
  });

  it('registers all 6 run-related tools (4 canonical + 3 deprecated aliases)', async () => {
    const resp = await rpc(child, 'tools/list', {}, 100);
    const names = resp.result.tools.map((t) => t.name);
    for (const n of [...RUN_CANONICAL, ...RUN_DEPRECATED]) {
      assert.ok(names.includes(n), `missing tool: ${n}`);
    }
  });

  it('marks deprecated tools with a [DEPRECATED prefix in their description', async () => {
    const resp = await rpc(child, 'tools/list', {}, 101);
    const byName = Object.fromEntries(resp.result.tools.map((t) => [t.name, t]));
    for (const n of RUN_DEPRECATED) {
      assert.ok(
        byName[n].description.startsWith('[DEPRECATED'),
        `${n} description should start with [DEPRECATED, got: ${byName[n].description.slice(0, 40)}`,
      );
    }
    for (const n of RUN_CANONICAL) {
      assert.ok(
        !byName[n].description.startsWith('[DEPRECATED'),
        `${n} description must NOT start with [DEPRECATED`,
      );
    }
  });

  // -- start: canonical then alias, assert identical HTTP body -------------

  it('kanban_start_run and kanban_start_pipeline hit POST /runs with identical bodies', async () => {
    mock.requests.length = 0;
    const args = { spaceId: 'sp-1', taskId: 't-1', stages: ['a', 'b'] };

    await rpc(child, 'tools/call', { name: 'kanban_start_run', arguments: args }, 200);
    await rpc(child, 'tools/call', { name: 'kanban_start_pipeline', arguments: args }, 201);

    assert.equal(mock.requests.length, 2, 'both calls should reach the mock Kanban');
    assert.deepEqual(mock.requests[0], mock.requests[1], 'canonical and alias must produce the same HTTP request');
    assert.equal(mock.requests[0].method, 'POST');
    assert.equal(mock.requests[0].path,   '/api/v1/runs');
    assert.deepEqual(mock.requests[0].body, args);
  });

  // -- stop ---------------------------------------------------------------

  it('kanban_stop_run and kanban_stop_pipeline hit POST /runs/:runId/stop with identical bodies', async () => {
    mock.requests.length = 0;
    const args = { runId: 'run-xyz' };

    await rpc(child, 'tools/call', { name: 'kanban_stop_run', arguments: args }, 210);
    await rpc(child, 'tools/call', { name: 'kanban_stop_pipeline', arguments: args }, 211);

    assert.equal(mock.requests.length, 2);
    assert.deepEqual(mock.requests[0], mock.requests[1]);
    assert.equal(mock.requests[0].method, 'POST');
    assert.equal(mock.requests[0].path,   '/api/v1/runs/run-xyz/stop');
    assert.deepEqual(mock.requests[0].body, {});
  });

  // -- resume -------------------------------------------------------------

  it('kanban_resume_run and kanban_resume_pipeline hit POST /runs/:runId/resume with identical bodies', async () => {
    mock.requests.length = 0;
    const args = { runId: 'run-xyz', fromStage: 2 };

    await rpc(child, 'tools/call', { name: 'kanban_resume_run', arguments: args }, 220);
    await rpc(child, 'tools/call', { name: 'kanban_resume_pipeline', arguments: args }, 221);

    assert.equal(mock.requests.length, 2);
    assert.deepEqual(mock.requests[0], mock.requests[1]);
    assert.equal(mock.requests[0].method, 'POST');
    assert.equal(mock.requests[0].path,   '/api/v1/runs/run-xyz/resume');
    assert.deepEqual(mock.requests[0].body, { fromStage: 2 });
  });

  // -- log-line telemetry -------------------------------------------------

  it('emits deprecated_tool_call WARN on alias invocation, silent on canonical', async () => {
    // Snapshot stderr before a canonical-only call.
    const before = child.stderr.buffer.length;
    await rpc(child, 'tools/call', { name: 'kanban_start_run', arguments: { spaceId: 's', taskId: 't' } }, 300);
    const afterCanonical = child.stderr.buffer.slice(before);
    assert.ok(
      !afterCanonical.includes('deprecated_tool_call'),
      'canonical tool must NOT emit a deprecation warning',
    );

    // Now call each alias and assert exactly one line per call.
    const cases = [
      ['kanban_start_pipeline',  'kanban_start_run',  { spaceId: 's', taskId: 't' }],
      ['kanban_stop_pipeline',   'kanban_stop_run',   { runId: 'r' }],
      ['kanban_resume_pipeline', 'kanban_resume_run', { runId: 'r' }],
    ];
    for (const [i, [oldName, newName, args]] of cases.entries()) {
      const mark = child.stderr.buffer.length;
      await rpc(child, 'tools/call', { name: oldName, arguments: args }, 400 + i);
      const line = child.stderr.buffer.slice(mark);
      const expected = `deprecated_tool_call name=${oldName} replacement=${newName}`;
      assert.ok(
        line.includes(expected),
        `alias ${oldName} should emit WARN line \`${expected}\`; got:\n${line}`,
      );
    }
  });

  it('shuts down cleanly', async () => {
    child.proc.stdin.end();
    child.proc.kill('SIGTERM');
    await once(child.proc, 'exit').catch(() => {});
    await new Promise((r) => mock.server.close(r));
    assert.ok(true);
  });
});
