'use strict';

/**
 * tests/agent-sync.test.js
 *
 * Unit tests for src/services/agentSync.js and the installAgents
 * manifest integration in bin/init.js.
 *
 * All tests use isolated temporary directories — no writes to ~/.claude/agents.
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const { syncAgents, readManifest, writeManifest, computeHash } =
  require('../src/services/agentSync');

const { installAgents } = require('../bin/init');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temp directory, run `fn(dir)`, then clean up.
 * Always removes the temp dir even if `fn` throws.
 */
async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sync-test-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Create a minimal agents/ source tree inside `rootDir`.
 * Returns the path to the agents/ subdirectory.
 *
 * @param {string}  rootDir       - package root to place agents/ inside
 * @param {Object}  files         - { filename: content } map
 * @returns {string}              - path to the agents/ dir
 */
function makeAgentsDir(rootDir, files) {
  const agentsDir = path.join(rootDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(agentsDir, name), content, 'utf8');
  }
  return agentsDir;
}

/** Convenience: compute hash of a string */
function h(str) {
  return computeHash(Buffer.from(str, 'utf8'));
}

// ---------------------------------------------------------------------------
// TC-001: empty agentsDir → all agents installed, manifest created
// ---------------------------------------------------------------------------

test('TC-001: empty agentsDir — all agents installed, manifest created', async () => {
  await withTempDir(async (tmp) => {
    const pkgRoot  = path.join(tmp, 'pkg');
    const destDir  = path.join(tmp, 'dest');

    makeAgentsDir(pkgRoot, {
      'agent-a.md': '# Agent A',
      'agent-b.md': '# Agent B',
    });
    fs.mkdirSync(destDir, { recursive: true });

    const result = syncAgents({
      packageRoot:  pkgRoot,
      agentsDir:    destDir,
      prismVersion: '1.1.0',
    });

    assert.deepEqual(result.synced.sort(),   ['agent-a.md', 'agent-b.md']);
    assert.deepEqual(result.skipped,         []);
    assert.deepEqual(result.noChange,        []);
    assert.deepEqual(result.errors,          []);

    // Files copied
    assert.equal(fs.readFileSync(path.join(destDir, 'agent-a.md'), 'utf8'), '# Agent A');
    assert.equal(fs.readFileSync(path.join(destDir, 'agent-b.md'), 'utf8'), '# Agent B');

    // Manifest created with correct hashes
    const manifest = readManifest(destDir);
    assert.equal(manifest.managed['agent-a.md'].hash, h('# Agent A'));
    assert.equal(manifest.managed['agent-b.md'].hash, h('# Agent B'));
    assert.equal(manifest.managed['agent-a.md'].prismVersion, '1.1.0');
  });
});

// ---------------------------------------------------------------------------
// TC-002: second call with unchanged source → all noChange, no disk writes
// ---------------------------------------------------------------------------

test('TC-002: idempotent — second call with unchanged source → all noChange', async () => {
  await withTempDir(async (tmp) => {
    const pkgRoot = path.join(tmp, 'pkg');
    const destDir = path.join(tmp, 'dest');

    makeAgentsDir(pkgRoot, { 'agent-a.md': '# Agent A' });
    fs.mkdirSync(destDir, { recursive: true });

    // First call installs
    syncAgents({ packageRoot: pkgRoot, agentsDir: destDir, prismVersion: '1.1.0' });

    // Record mtime before second call
    const mtimeBefore = fs.statSync(path.join(destDir, 'agent-a.md')).mtimeMs;
    const manifestMtimeBefore = fs.statSync(path.join(destDir, '.prism-manifest.json')).mtimeMs;

    const result = syncAgents({ packageRoot: pkgRoot, agentsDir: destDir, prismVersion: '1.1.0' });

    assert.deepEqual(result.synced,    []);
    assert.deepEqual(result.skipped,   []);
    assert.deepEqual(result.noChange,  ['agent-a.md']);
    assert.deepEqual(result.errors,    []);

    // No files rewritten — mtime should not change
    const mtimeAfter         = fs.statSync(path.join(destDir, 'agent-a.md')).mtimeMs;
    const manifestMtimeAfter = fs.statSync(path.join(destDir, '.prism-manifest.json')).mtimeMs;
    assert.equal(mtimeAfter, mtimeBefore, 'agent file must not be rewritten');
    assert.equal(manifestMtimeAfter, manifestMtimeBefore, 'manifest must not be rewritten');
  });
});

// ---------------------------------------------------------------------------
// TC-003: source agent changed (simulate v2) → file updated, manifest updated
// ---------------------------------------------------------------------------

test('TC-003: source updated → file and manifest updated', async () => {
  await withTempDir(async (tmp) => {
    const pkgRoot = path.join(tmp, 'pkg');
    const destDir = path.join(tmp, 'dest');

    makeAgentsDir(pkgRoot, { 'agent-a.md': '# Agent A v1' });
    fs.mkdirSync(destDir, { recursive: true });

    // First install (v1)
    syncAgents({ packageRoot: pkgRoot, agentsDir: destDir, prismVersion: '1.1.0' });

    // Simulate Prism upgrade: source changes to v2
    fs.writeFileSync(path.join(pkgRoot, 'agents', 'agent-a.md'), '# Agent A v2', 'utf8');

    const logs  = [];
    const result = syncAgents({
      packageRoot: pkgRoot,
      agentsDir:   destDir,
      prismVersion: '1.2.0',
      log: (msg) => logs.push(msg),
    });

    assert.deepEqual(result.synced,   ['agent-a.md']);
    assert.deepEqual(result.noChange, []);
    assert.deepEqual(result.skipped,  []);
    assert.deepEqual(result.errors,   []);

    assert.equal(fs.readFileSync(path.join(destDir, 'agent-a.md'), 'utf8'), '# Agent A v2');

    const manifest = readManifest(destDir);
    assert.equal(manifest.managed['agent-a.md'].hash, h('# Agent A v2'));
    assert.equal(manifest.managed['agent-a.md'].prismVersion, '1.2.0');

    assert.ok(logs.some(l => l.includes('updated: agent-a.md')));
  });
});

// ---------------------------------------------------------------------------
// TC-004: user edits dest agent → skipped on next sync
// ---------------------------------------------------------------------------

test('TC-004: user-edited dest → skipped on subsequent sync', async () => {
  await withTempDir(async (tmp) => {
    const pkgRoot = path.join(tmp, 'pkg');
    const destDir = path.join(tmp, 'dest');

    makeAgentsDir(pkgRoot, { 'agent-a.md': '# Agent A v1' });
    fs.mkdirSync(destDir, { recursive: true });

    // Install
    syncAgents({ packageRoot: pkgRoot, agentsDir: destDir, prismVersion: '1.1.0' });

    // User edits the destination file
    fs.writeFileSync(path.join(destDir, 'agent-a.md'), '# My Custom Agent A', 'utf8');

    // Simulate Prism upgrade
    fs.writeFileSync(path.join(pkgRoot, 'agents', 'agent-a.md'), '# Agent A v2', 'utf8');

    const logs  = [];
    const result = syncAgents({
      packageRoot: pkgRoot,
      agentsDir:   destDir,
      prismVersion: '1.2.0',
      log: (msg) => logs.push(msg),
    });

    assert.deepEqual(result.skipped,  ['agent-a.md']);
    assert.deepEqual(result.synced,   []);
    assert.deepEqual(result.noChange, []);

    // File must remain user's version
    assert.equal(
      fs.readFileSync(path.join(destDir, 'agent-a.md'), 'utf8'),
      '# My Custom Agent A',
    );

    assert.ok(logs.some(l => l.includes('skipped (user-modified): agent-a.md')));
  });
});

// ---------------------------------------------------------------------------
// TC-005: no manifest, src == dest → noChange, manifest created
// ---------------------------------------------------------------------------

test('TC-005: no manifest, src == dest → noChange, manifest baseline written', async () => {
  await withTempDir(async (tmp) => {
    const pkgRoot = path.join(tmp, 'pkg');
    const destDir = path.join(tmp, 'dest');

    makeAgentsDir(pkgRoot, { 'agent-a.md': '# Agent A' });
    fs.mkdirSync(destDir, { recursive: true });

    // Pre-populate dest (no manifest)
    fs.writeFileSync(path.join(destDir, 'agent-a.md'), '# Agent A', 'utf8');

    const result = syncAgents({ packageRoot: pkgRoot, agentsDir: destDir, prismVersion: '1.1.0' });

    assert.deepEqual(result.noChange,  ['agent-a.md']);
    assert.deepEqual(result.synced,    []);
    assert.deepEqual(result.skipped,   []);

    // Manifest should be created
    const manifest = readManifest(destDir);
    assert.equal(manifest.managed['agent-a.md'].hash, h('# Agent A'));
  });
});

// ---------------------------------------------------------------------------
// TC-006: no manifest, src != dest → file updated (migration bias)
// ---------------------------------------------------------------------------

test('TC-006: no manifest, src != dest → migration-bias update', async () => {
  await withTempDir(async (tmp) => {
    const pkgRoot = path.join(tmp, 'pkg');
    const destDir = path.join(tmp, 'dest');

    makeAgentsDir(pkgRoot, { 'agent-a.md': '# Agent A v2' });
    fs.mkdirSync(destDir, { recursive: true });

    // Pre-populate dest with old version, no manifest
    fs.writeFileSync(path.join(destDir, 'agent-a.md'), '# Agent A v1', 'utf8');

    const logs  = [];
    const result = syncAgents({
      packageRoot: pkgRoot,
      agentsDir:   destDir,
      prismVersion: '1.1.0',
      log: (msg) => logs.push(msg),
    });

    assert.deepEqual(result.synced,   ['agent-a.md']);
    assert.deepEqual(result.noChange, []);
    assert.deepEqual(result.skipped,  []);

    assert.equal(
      fs.readFileSync(path.join(destDir, 'agent-a.md'), 'utf8'),
      '# Agent A v2',
    );

    assert.ok(logs.some(l => l.includes('first-sync updated: agent-a.md')));
  });
});

// ---------------------------------------------------------------------------
// TC-007: missing agents/ source dir → returns empty result, no throw
// ---------------------------------------------------------------------------

test('TC-007: missing agents/ source dir → empty result, no throw', async () => {
  await withTempDir(async (tmp) => {
    const pkgRoot = path.join(tmp, 'pkg');
    const destDir = path.join(tmp, 'dest');

    // Do NOT create agents/ dir
    fs.mkdirSync(pkgRoot,  { recursive: true });
    fs.mkdirSync(destDir,  { recursive: true });

    const result = syncAgents({ packageRoot: pkgRoot, agentsDir: destDir });

    assert.deepEqual(result.synced,    []);
    assert.deepEqual(result.skipped,   []);
    assert.deepEqual(result.noChange,  []);
    assert.deepEqual(result.errors,    []);
  });
});

// ---------------------------------------------------------------------------
// TC-008: malformed manifest JSON → treated as empty, sync proceeds
// ---------------------------------------------------------------------------

test('TC-008: malformed manifest JSON → treated as empty, sync proceeds', async () => {
  await withTempDir(async (tmp) => {
    const pkgRoot = path.join(tmp, 'pkg');
    const destDir = path.join(tmp, 'dest');

    makeAgentsDir(pkgRoot, { 'agent-a.md': '# Agent A' });
    fs.mkdirSync(destDir, { recursive: true });

    // Write corrupt manifest
    fs.writeFileSync(
      path.join(destDir, '.prism-manifest.json'),
      '{ this is NOT valid JSON <<<',
      'utf8',
    );

    const logs  = [];
    const result = syncAgents({
      packageRoot: pkgRoot,
      agentsDir:   destDir,
      prismVersion: '1.1.0',
      log: (msg) => logs.push(msg),
    });

    // With no baseline, dest doesn't exist → Case 1 (install)
    assert.deepEqual(result.synced,  ['agent-a.md']);
    assert.deepEqual(result.errors,  []);
    assert.ok(logs.some(l => l.includes('WARNING')));
  });
});

// ---------------------------------------------------------------------------
// TC-009: per-file read error → that file in errors[], others processed
// ---------------------------------------------------------------------------

test('TC-009: per-file I/O error → pushed to errors[], others processed normally', async () => {
  await withTempDir(async (tmp) => {
    const pkgRoot = path.join(tmp, 'pkg');
    const destDir = path.join(tmp, 'dest');

    makeAgentsDir(pkgRoot, {
      'agent-a.md': '# Agent A',
      'agent-b.md': '# Agent B',
    });
    fs.mkdirSync(destDir, { recursive: true });

    // Make agent-a unreadable by replacing the file with a directory of the same name
    // (readFileSync on a directory throws EISDIR)
    fs.rmSync(path.join(pkgRoot, 'agents', 'agent-a.md'));
    fs.mkdirSync(path.join(pkgRoot, 'agents', 'agent-a.md'));

    const result = syncAgents({ packageRoot: pkgRoot, agentsDir: destDir });

    // agent-a errored, agent-b processed normally
    assert.ok(result.errors.includes('agent-a.md'), 'agent-a.md should be in errors');
    assert.ok(
      result.synced.includes('agent-b.md') || result.noChange.includes('agent-b.md'),
      'agent-b.md should be processed',
    );
  });
});

// ---------------------------------------------------------------------------
// TC-010: prism init → .prism-manifest.json created for all agents
// ---------------------------------------------------------------------------

test('TC-010: prism init installAgents → manifest created with correct hashes', async () => {
  await withTempDir(async (tmp) => {
    const pkgRoot  = path.join(tmp, 'pkg');
    const homedir  = path.join(tmp, 'home');
    const destDir  = path.join(homedir, '.claude', 'agents');

    makeAgentsDir(pkgRoot, {
      'agent-a.md': '# Agent A',
      'agent-b.md': '# Agent B',
    });

    const result = installAgents(pkgRoot, homedir, { prismVersion: '1.1.0' });

    assert.deepEqual(result.installed.sort(), ['agent-a.md', 'agent-b.md']);
    assert.deepEqual(result.skipped,          []);

    const manifest = readManifest(destDir);
    assert.equal(manifest.managed['agent-a.md'].hash, h('# Agent A'));
    assert.equal(manifest.managed['agent-b.md'].hash, h('# Agent B'));
    assert.equal(manifest.managed['agent-a.md'].prismVersion, '1.1.0');
  });
});

// ---------------------------------------------------------------------------
// TC-011: prism init idempotent — running twice leaves manifest consistent
// ---------------------------------------------------------------------------

test('TC-011: prism init idempotent → manifest consistent after two runs', async () => {
  await withTempDir(async (tmp) => {
    const pkgRoot = path.join(tmp, 'pkg');
    const homedir = path.join(tmp, 'home');
    const destDir = path.join(homedir, '.claude', 'agents');

    makeAgentsDir(pkgRoot, { 'agent-a.md': '# Agent A' });

    const r1 = installAgents(pkgRoot, homedir, { prismVersion: '1.1.0' });
    const r2 = installAgents(pkgRoot, homedir, { prismVersion: '1.1.0' });

    assert.deepEqual(r1.installed, ['agent-a.md']);
    assert.deepEqual(r2.skipped,   ['agent-a.md']);

    const manifest = readManifest(destDir);
    assert.equal(manifest.managed['agent-a.md'].hash, h('# Agent A'));
  });
});

// ---------------------------------------------------------------------------
// TC-012: startServer options.agentsDir → sync targets that directory
// ---------------------------------------------------------------------------

test('TC-012: startServer options.agentsDir → agent sync targets injected dir', async () => {
  await withTempDir(async (tmp) => {
    const agentsDir  = path.join(tmp, 'custom-agents');
    const dataDir    = path.join(tmp, 'data');

    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(dataDir,   { recursive: true });

    // Start server with custom agentsDir pointing to our temp dir
    const { startServer } = require('../server');
    const server = startServer({ port: 0, dataDir, agentsDir, silent: true });

    await new Promise((resolve) => server.once('listening', resolve));

    // Close the server cleanly
    await new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    if (server._store) {
      try { server._store.close(); } catch { /* ignore */ }
    }

    // Manifest should have been written in the custom agentsDir (not ~/.claude/agents)
    const manifestPath = path.join(agentsDir, '.prism-manifest.json');
    assert.ok(
      fs.existsSync(manifestPath),
      `manifest should exist at ${manifestPath}`,
    );

    // And at least one agent should appear in managed entries
    const manifest = readManifest(agentsDir);
    const entries  = Object.keys(manifest.managed);
    assert.ok(entries.length > 0, 'manifest should have at least one entry');
  });
});
