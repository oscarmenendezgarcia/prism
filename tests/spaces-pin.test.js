/**
 * Integration tests for Space Pinning (QOL-2).
 *
 * Covers:
 *   - PUT /api/v1/spaces/:id { pinned, pinnedRank } — without name
 *   - PUT /api/v1/spaces/:id {} — empty body (name falls back to existing)
 *   - PUT /api/v1/spaces/:id { pinned: false } — unpin
 *   - GET /api/v1/spaces — returns pinned spaces first (pinnedRank ASC), then non-pinned (createdAt ASC)
 *   - Migration: columns are auto-added (verified by running against a fresh DB)
 *
 * Run with: node tests/spaces-pin.test.js
 */

'use strict';

const http = require('http');
const { startTestServer } = require('./helpers/server');

// ---------------------------------------------------------------------------
// Minimal test runner
// ---------------------------------------------------------------------------

let passed   = 0;
let failed   = 0;
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

function request(port, method, urlPath, body) {
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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {

  // ── Suite: PUT pinned + pinnedRank (no name) ──────────────────────────────
  suite('PUT /spaces/:id — pin (no name)');

  await test('PUT with { pinned: true, pinnedRank: 0 } returns 200 with pinned space', async () => {
    const { port, close } = await startTestServer();
    try {
      const listRes = await request(port, 'GET', '/api/v1/spaces', undefined);
      const spaceId = listRes.body[0].id;

      const res = await request(port, 'PUT', `/api/v1/spaces/${spaceId}`, { pinned: true, pinnedRank: 0 });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.pinned === true,    'space.pinned should be true');
      assert(res.body.pinnedRank === 0,   'space.pinnedRank should be 0');
      // Name should be preserved (not cleared)
      assert(typeof res.body.name === 'string' && res.body.name.length > 0, 'name should be preserved');
    } finally {
      close();
    }
  });

  await test('PUT with {} (empty body) returns 200 — name falls back to existing', async () => {
    const { port, close } = await startTestServer();
    try {
      const listRes = await request(port, 'GET', '/api/v1/spaces', undefined);
      const space   = listRes.body[0];

      const res = await request(port, 'PUT', `/api/v1/spaces/${space.id}`, {});
      assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert(res.body.name === space.name, `Name should be "${space.name}", got "${res.body.name}"`);
    } finally {
      close();
    }
  });

  await test('PUT with { pinned: false } returns 200 with unpinned space', async () => {
    const { port, close } = await startTestServer();
    try {
      const listRes = await request(port, 'GET', '/api/v1/spaces', undefined);
      const spaceId = listRes.body[0].id;

      // First pin it
      await request(port, 'PUT', `/api/v1/spaces/${spaceId}`, { pinned: true, pinnedRank: 0 });

      // Then unpin
      const res = await request(port, 'PUT', `/api/v1/spaces/${spaceId}`, { pinned: false });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.pinned === false, 'space.pinned should be false after unpin');
    } finally {
      close();
    }
  });

  await test('PUT with { name: "New Name" } (no pinned) still works', async () => {
    const { port, close } = await startTestServer();
    try {
      const listRes = await request(port, 'GET', '/api/v1/spaces', undefined);
      const spaceId = listRes.body[0].id;

      const res = await request(port, 'PUT', `/api/v1/spaces/${spaceId}`, { name: 'Renamed Space' });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.name === 'Renamed Space', `Expected "Renamed Space", got "${res.body.name}"`);
    } finally {
      close();
    }
  });

  await test('PUT with unknown space ID returns 404', async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await request(port, 'PUT', '/api/v1/spaces/nonexistent-id', { pinned: true, pinnedRank: 0 });
      assert(res.status === 404, `Expected 404, got ${res.status}`);
    } finally {
      close();
    }
  });

  // ── Suite: GET list order ────────────────────────────────────────────────
  suite('GET /spaces — sort order (pinned first)');

  await test('pinned spaces appear before non-pinned in GET /spaces', async () => {
    const { port, close } = await startTestServer();
    try {
      // Create two additional spaces
      const r1 = await request(port, 'POST', '/api/v1/spaces', { name: 'Space B' });
      const r2 = await request(port, 'POST', '/api/v1/spaces', { name: 'Space C' });
      const idB = r1.body.id;
      const idC = r2.body.id;

      // Pin Space C at rank 0, leave Space B unpinned
      await request(port, 'PUT', `/api/v1/spaces/${idC}`, { pinned: true, pinnedRank: 0 });

      const listRes = await request(port, 'GET', '/api/v1/spaces', undefined);
      assert(Array.isArray(listRes.body), 'Should return an array');

      const spaces   = listRes.body;
      const pinnedSpaces   = spaces.filter((s) => s.pinned);
      const unpinnedSpaces = spaces.filter((s) => !s.pinned);

      // Pinned should come first
      assert(pinnedSpaces.length > 0, 'Should have at least one pinned space');
      assert(pinnedSpaces.every(p => !unpinnedSpaces.map(u => u.id).includes(p.id)), 'Sets should be distinct');

      // The first pinned space should be Space C (rank 0)
      const firstPinned = pinnedSpaces[0];
      assert(firstPinned.id === idC, `First pinned space should be Space C (${idC}), got ${firstPinned.id}`);

      // All pinned spaces should appear before all unpinned spaces in the response
      const pinnedIds  = new Set(pinnedSpaces.map(s => s.id));
      let seenUnpinned = false;
      for (const space of spaces) {
        if (!space.pinned) seenUnpinned = true;
        if (space.pinned && seenUnpinned) {
          throw new Error('A pinned space appeared after an unpinned space in the list');
        }
      }
    } finally {
      close();
    }
  });

  await test('pinned spaces are ordered by pinnedRank ASC', async () => {
    const { port, close } = await startTestServer();
    try {
      const r1 = await request(port, 'POST', '/api/v1/spaces', { name: 'Alpha' });
      const r2 = await request(port, 'POST', '/api/v1/spaces', { name: 'Beta' });
      const r3 = await request(port, 'POST', '/api/v1/spaces', { name: 'Gamma' });

      // Pin in reverse order so natural DB insertion order would be wrong
      await request(port, 'PUT', `/api/v1/spaces/${r3.body.id}`, { pinned: true, pinnedRank: 0 });
      await request(port, 'PUT', `/api/v1/spaces/${r2.body.id}`, { pinned: true, pinnedRank: 1 });
      await request(port, 'PUT', `/api/v1/spaces/${r1.body.id}`, { pinned: true, pinnedRank: 2 });

      const listRes = await request(port, 'GET', '/api/v1/spaces', undefined);
      const pinnedSpaces = listRes.body.filter((s) => s.pinned);

      assert(pinnedSpaces.length >= 3, `Expected at least 3 pinned spaces, got ${pinnedSpaces.length}`);
      assert(pinnedSpaces[0].id === r3.body.id, `Rank 0 should be Gamma (${r3.body.id}), got ${pinnedSpaces[0].id}`);
      assert(pinnedSpaces[1].id === r2.body.id, `Rank 1 should be Beta (${r2.body.id}), got ${pinnedSpaces[1].id}`);
      assert(pinnedSpaces[2].id === r1.body.id, `Rank 2 should be Alpha (${r1.body.id}), got ${pinnedSpaces[2].id}`);
    } finally {
      close();
    }
  });

  await test('migration: GET /spaces returns pinned: false for all existing spaces', async () => {
    const { port, close } = await startTestServer();
    try {
      const listRes = await request(port, 'GET', '/api/v1/spaces', undefined);
      assert(Array.isArray(listRes.body), 'Expected array');
      for (const space of listRes.body) {
        assert(
          Object.prototype.hasOwnProperty.call(space, 'pinned'),
          `Space "${space.name}" is missing pinned field`,
        );
        assert(
          space.pinned === false,
          `Space "${space.name}" should default to pinned=false, got ${space.pinned}`,
        );
      }
    } finally {
      close();
    }
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
    process.exit(1);
  } else {
    console.log('All tests passed.');
    process.exit(0);
  }
}

runTests();
