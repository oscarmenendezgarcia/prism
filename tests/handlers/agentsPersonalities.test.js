'use strict';

/**
 * Integration tests for src/handlers/agentsPersonalities.js
 *
 * Run: node tests/handlers/agentsPersonalities.test.js
 * (starts its own isolated test server — no pre-existing server required)
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { startTestServer } = require('../helpers/server');

// ---------------------------------------------------------------------------
// Minimal test runner
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
      const payload = body ? JSON.stringify(body) : undefined;
      const options = {
        hostname: 'localhost',
        port,
        path: urlPath,
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
          let json = null;
          try { json = JSON.parse(data); } catch { /* non-JSON response */ }
          resolve({ status: res.statusCode, body: json, raw: data });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  };
}

// ---------------------------------------------------------------------------
// Test personality payload
// ---------------------------------------------------------------------------

const VALID_PERSONALITY = {
  displayName: 'Test Architect',
  color:       '#7C3AED',
  persona:     'Systematic and methodical.',
  mcpTools:    ['mcp__prism__*'],
  avatar:      '🏛️',
  source:      'manual',
};

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

async function runTests() {
  // Start a single server for all tests (agents dir has stub .md files)
  let port, agentsDir, close;
  try {
    ({ port, agentsDir, close } = await startTestServer());
  } catch (err) {
    console.error('Failed to start test server:', err.message);
    process.exit(1);
  }

  const request = makeRequest(port);

  // ── GET /api/v1/agents-personalities ──────────────────────────────────────
  suite('GET /api/v1/agents-personalities');

  await test('returns 200 and an empty array when no personalities exist', async () => {
    const { status, body } = await request('GET', '/api/v1/agents-personalities');
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(body), 'body should be an array');
    assert(body.length === 0, 'should be empty initially');
  });

  // ── PUT /api/v1/agents-personalities/:agentId ─────────────────────────────
  suite('PUT /api/v1/agents-personalities/:agentId');

  await test('creates a personality and returns 200 with saved record', async () => {
    const { status, body } = await request('PUT', '/api/v1/agents-personalities/senior-architect', VALID_PERSONALITY);
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.agentId === 'senior-architect', 'agentId should match');
    assert(body.displayName === 'Test Architect', 'displayName should be saved');
    assert(body.color === '#7C3AED', 'color should be saved');
    assert(typeof body.updatedAt === 'string', 'updatedAt should be set');
  });

  await test('returns 400 with INVALID_AGENT_ID for non-kebab-case id', async () => {
    const { status, body } = await request('PUT', '/api/v1/agents-personalities/SENIOR_ARCH', VALID_PERSONALITY);
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error.code === 'INVALID_AGENT_ID', `expected INVALID_AGENT_ID, got ${body.error?.code}`);
  });

  await test('returns 400 with VALIDATION_ERROR when displayName is empty', async () => {
    const { status, body } = await request('PUT', '/api/v1/agents-personalities/senior-architect', {
      ...VALID_PERSONALITY,
      displayName: '   ',
    });
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${body.error?.code}`);
  });

  await test('returns 400 with VALIDATION_ERROR when color is not in palette', async () => {
    const { status, body } = await request('PUT', '/api/v1/agents-personalities/senior-architect', {
      ...VALID_PERSONALITY,
      color: '#AABBCC',
    });
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${body.error?.code}`);
  });

  await test('returns 400 with VALIDATION_ERROR when mcpTools has invalid entry', async () => {
    const { status, body } = await request('PUT', '/api/v1/agents-personalities/senior-architect', {
      ...VALID_PERSONALITY,
      mcpTools: ['not-valid'],
    });
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${body.error?.code}`);
  });

  await test('returns 400 with INVALID_AGENT_ID when agent .md file does not exist', async () => {
    const { status, body } = await request('PUT', '/api/v1/agents-personalities/ghost-agent', VALID_PERSONALITY);
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error.code === 'INVALID_AGENT_ID', `expected INVALID_AGENT_ID for missing agent file, got ${body.error?.code}`);
  });

  await test('updates an existing personality on second upsert', async () => {
    await request('PUT', '/api/v1/agents-personalities/senior-architect', VALID_PERSONALITY);
    const { status, body } = await request('PUT', '/api/v1/agents-personalities/senior-architect', {
      ...VALID_PERSONALITY,
      displayName: 'Updated Architect',
    });
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.displayName === 'Updated Architect', 'displayName should be updated');
  });

  // ── GET /api/v1/agents-personalities/:agentId ─────────────────────────────
  suite('GET /api/v1/agents-personalities/:agentId');

  await test('returns 200 with personality after upsert', async () => {
    await request('PUT', '/api/v1/agents-personalities/senior-architect', VALID_PERSONALITY);
    const { status, body } = await request('GET', '/api/v1/agents-personalities/senior-architect');
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.agentId === 'senior-architect', 'agentId should match');
  });

  await test('returns 404 when personality does not exist', async () => {
    const { status, body } = await request('GET', '/api/v1/agents-personalities/developer-agent');
    assert(status === 404, `expected 404, got ${status}`);
    assert(body.error.code === 'NOT_FOUND', `expected NOT_FOUND, got ${body.error?.code}`);
  });

  await test('returns 400 for invalid agentId in GET', async () => {
    const { status, body } = await request('GET', '/api/v1/agents-personalities/INVALID__ID');
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error.code === 'INVALID_AGENT_ID', `expected INVALID_AGENT_ID, got ${body.error?.code}`);
  });

  // ── GET /api/v1/agents-personalities (list after insert) ─────────────────
  suite('GET /api/v1/agents-personalities — list after inserts');

  await test('listAll reflects all upserted personalities', async () => {
    await request('PUT', '/api/v1/agents-personalities/senior-architect', VALID_PERSONALITY);
    await request('PUT', '/api/v1/agents-personalities/developer-agent', {
      ...VALID_PERSONALITY,
      displayName: 'The Dev',
    });
    const { status, body } = await request('GET', '/api/v1/agents-personalities');
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(body), 'body should be array');
    const ids = body.map((p) => p.agentId).sort();
    assert(ids.includes('senior-architect'), 'should include senior-architect');
    assert(ids.includes('developer-agent'), 'should include developer-agent');
  });

  // ── DELETE /api/v1/agents-personalities/:agentId ──────────────────────────
  suite('DELETE /api/v1/agents-personalities/:agentId');

  await test('returns 204 and removes personality', async () => {
    await request('PUT', '/api/v1/agents-personalities/ux-api-designer', VALID_PERSONALITY);
    const { status } = await request('DELETE', '/api/v1/agents-personalities/ux-api-designer');
    assert(status === 204, `expected 204, got ${status}`);

    const { status: getStatus, body } = await request('GET', '/api/v1/agents-personalities/ux-api-designer');
    assert(getStatus === 404, 'GET after DELETE should return 404');
    assert(body.error.code === 'NOT_FOUND', `code should be NOT_FOUND, got ${body.error?.code}`);
  });

  await test('returns 404 when deleting non-existent personality', async () => {
    const { status, body } = await request('DELETE', '/api/v1/agents-personalities/nobody');
    assert(status === 404, `expected 404, got ${status}`);
    assert(body.error.code === 'NOT_FOUND', `expected NOT_FOUND, got ${body.error?.code}`);
  });

  await test('returns 400 for invalid agentId in DELETE', async () => {
    const { status, body } = await request('DELETE', '/api/v1/agents-personalities/INVALID__ID');
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error.code === 'INVALID_AGENT_ID', `expected INVALID_AGENT_ID, got ${body.error?.code}`);
  });

  // ── GET /api/v1/agents-personalities/mcp-tools ────────────────────────────
  suite('GET /api/v1/agents-personalities/mcp-tools');

  await test('returns 200 with servers array containing at least prism', async () => {
    const { status, body } = await request('GET', '/api/v1/agents-personalities/mcp-tools');
    assert(status === 200, `expected 200, got ${status}`);
    assert(body && Array.isArray(body.servers), 'body.servers should be an array');
    const prism = body.servers.find((s) => s.id === 'prism');
    assert(prism, 'should always include built-in prism server');
  });

  await test('accepts workingDirectory query parameter', async () => {
    const { status, body } = await request('GET', '/api/v1/agents-personalities/mcp-tools?workingDirectory=/tmp');
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(body.servers), 'body.servers should be an array');
  });

  // ── POST /api/v1/agents-personalities/generate — validation only ──────────
  suite('POST /api/v1/agents-personalities/generate — validation');

  await test('returns 400 VALIDATION_ERROR when agentId is missing', async () => {
    const { status, body } = await request('POST', '/api/v1/agents-personalities/generate', {});
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${body.error?.code}`);
  });

  await test('returns 400 INVALID_AGENT_ID when agentId has invalid format', async () => {
    const { status, body } = await request('POST', '/api/v1/agents-personalities/generate', { agentId: 'INVALID__ID' });
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error.code === 'INVALID_AGENT_ID', `expected INVALID_AGENT_ID, got ${body.error?.code}`);
  });

  await test('returns 400 INVALID_JSON for malformed body', async () => {
    const res = await new Promise((resolve) => {
      const raw = 'NOT_JSON';
      const opts = {
        hostname: 'localhost', port, method: 'POST',
        path: '/api/v1/agents-personalities/generate',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) },
      };
      const req = http.request(opts, (r) => {
        let d = '';
        r.on('data', (c) => { d += c; });
        r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(d) }));
      });
      req.write(raw);
      req.end();
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
    assert(res.body.error.code === 'INVALID_JSON', `expected INVALID_JSON, got ${res.body.error?.code}`);
  });

  // ── validatePersonalityInput — unit level ─────────────────────────────────
  suite('validatePersonalityInput (unit)');

  const { validatePersonalityInput } = require('../../src/handlers/agentsPersonalities');

  await test('returns valid=true for a well-formed payload', () => {
    const { valid, errors } = validatePersonalityInput(VALID_PERSONALITY);
    assert(valid === true, `expected valid=true, errors: ${errors.join(', ')}`);
  });

  await test('returns error when displayName exceeds 60 chars', () => {
    const { valid, errors } = validatePersonalityInput({ ...VALID_PERSONALITY, displayName: 'x'.repeat(61) });
    assert(valid === false, 'should be invalid');
    assert(errors.some((e) => e.includes('60')), 'error should mention 60 char limit');
  });

  await test('returns error when displayName contains newlines', () => {
    const { valid, errors } = validatePersonalityInput({ ...VALID_PERSONALITY, displayName: 'Hello\nWorld' });
    assert(valid === false, 'should be invalid');
    assert(errors.some((e) => e.toLowerCase().includes('newline')), 'error should mention newlines');
  });

  await test('returns error when persona exceeds 600 chars', () => {
    const { valid, errors } = validatePersonalityInput({ ...VALID_PERSONALITY, persona: 'x'.repeat(601) });
    assert(valid === false, 'should be invalid');
    assert(errors.some((e) => e.includes('600')), 'error should mention 600 char limit');
  });

  await test('returns error when mcpTools is not an array', () => {
    const { valid, errors } = validatePersonalityInput({ ...VALID_PERSONALITY, mcpTools: 'mcp__prism__*' });
    assert(valid === false, 'should be invalid');
    assert(errors.some((e) => e.toLowerCase().includes('array')), 'error should mention array');
  });

  await test('returns error when mcpTools entry does not match pattern', () => {
    const { valid, errors } = validatePersonalityInput({ ...VALID_PERSONALITY, mcpTools: ['not-valid'] });
    assert(valid === false, 'should be invalid');
    assert(errors.some((e) => e.includes('mcp__')), 'error should mention mcp__ pattern');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────

  await close();

  // ── Results ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Tests: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
  if (failures.length > 0) {
    console.error('\nFailed tests:');
    for (const f of failures) {
      console.error(`  • ${f.name}`);
      console.error(`    ${f.error}`);
    }
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
