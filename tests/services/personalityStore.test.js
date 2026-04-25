'use strict';

/**
 * Unit tests for src/services/personalityStore.js
 *
 * Run: node tests/services/personalityStore.test.js
 * (server does NOT need to be running — all I/O is against a tmp dir)
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// We import the store AFTER overriding the data dir in each test.
const store = require('../../src/services/personalityStore');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir;

function makeTmpDir() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-store-test-'));
  store.setDataDir(tmpDir);
  store.invalidateCache();
}

function removeTmpDir() {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const SAMPLE_PERSONALITY = {
  agentId:     'senior-architect',
  displayName: 'The Architect',
  color:       '#7C3AED',
  persona:     'Calm, precise.',
  mcpTools:    ['mcp__prism__*'],
  avatar:      '🏛️',
  source:      'generated',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('personalityStore', () => {
  beforeEach(() => {
    makeTmpDir();
  });

  after(() => {
    removeTmpDir();
  });

  it('listAll returns [] when agents.json does not exist', () => {
    const result = store.listAll();
    assert.deepEqual(result, []);
  });

  it('get returns null when agent does not exist', () => {
    const result = store.get('nonexistent');
    assert.equal(result, null);
  });

  it('upsert creates agents.json and stores personality', async () => {
    const saved = await store.upsert(SAMPLE_PERSONALITY);

    assert.equal(saved.agentId, 'senior-architect');
    assert.equal(saved.displayName, 'The Architect');
    assert.equal(saved.color, '#7C3AED');
    assert.ok(saved.updatedAt, 'updatedAt should be set');

    const filePath = path.join(tmpDir, 'agents.json');
    assert.ok(fs.existsSync(filePath), 'agents.json should exist');

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.ok(raw['senior-architect'], 'record should be keyed by agentId');
  });

  it('get returns stored personality after upsert', async () => {
    await store.upsert(SAMPLE_PERSONALITY);
    const p = store.get('senior-architect');
    assert.equal(p.displayName, 'The Architect');
  });

  it('listAll returns all stored personalities', async () => {
    await store.upsert(SAMPLE_PERSONALITY);
    await store.upsert({ ...SAMPLE_PERSONALITY, agentId: 'developer-agent', displayName: 'Dev' });

    const list = store.listAll();
    assert.equal(list.length, 2);
    const ids = list.map((p) => p.agentId).sort();
    assert.deepEqual(ids, ['developer-agent', 'senior-architect']);
  });

  it('upsert overwrites existing personality', async () => {
    await store.upsert(SAMPLE_PERSONALITY);
    await store.upsert({ ...SAMPLE_PERSONALITY, displayName: 'Updated Architect' });
    const p = store.get('senior-architect');
    assert.equal(p.displayName, 'Updated Architect');
  });

  it('remove deletes a personality and returns true', async () => {
    await store.upsert(SAMPLE_PERSONALITY);
    const deleted = await store.remove('senior-architect');
    assert.equal(deleted, true);
    assert.equal(store.get('senior-architect'), null);
  });

  it('remove returns false for a nonexistent agentId', async () => {
    const deleted = await store.remove('nonexistent');
    assert.equal(deleted, false);
  });

  it('concurrent upserts for the same agentId are serialized', async () => {
    const results = await Promise.all([
      store.upsert({ ...SAMPLE_PERSONALITY, displayName: 'A' }),
      store.upsert({ ...SAMPLE_PERSONALITY, displayName: 'B' }),
      store.upsert({ ...SAMPLE_PERSONALITY, displayName: 'C' }),
    ]);
    // All should resolve without throwing
    assert.equal(results.length, 3);
    // The final stored value should be one of the three
    const p = store.get('senior-architect');
    assert.ok(['A', 'B', 'C'].includes(p.displayName));
  });

  it('uses tmp+rename atomic write pattern', async () => {
    await store.upsert(SAMPLE_PERSONALITY);
    // The .tmp file should NOT exist after a successful write
    const tmpPath = path.join(tmpDir, 'agents.json.tmp');
    assert.ok(!fs.existsSync(tmpPath), '.tmp file should be cleaned up after rename');
  });

  it('handles malformed agents.json gracefully', async () => {
    const filePath = path.join(tmpDir, 'agents.json');
    fs.writeFileSync(filePath, 'NOT_JSON!!!', 'utf8');
    store.invalidateCache();
    // listAll should not throw and return []
    const list = store.listAll();
    assert.deepEqual(list, []);
  });

  it('cache invalidation picks up external file changes', async () => {
    await store.upsert(SAMPLE_PERSONALITY);
    // Externally write a new agents.json
    const filePath = path.join(tmpDir, 'agents.json');
    const external = { 'developer-agent': { agentId: 'developer-agent', displayName: 'External', updatedAt: new Date().toISOString() } };
    // Force a different mtime by sleeping 5ms
    await new Promise((resolve) => setTimeout(resolve, 5));
    fs.writeFileSync(filePath, JSON.stringify(external), 'utf8');
    store.invalidateCache();
    const list = store.listAll();
    assert.equal(list.length, 1);
    assert.equal(list[0].displayName, 'External');
  });
});
