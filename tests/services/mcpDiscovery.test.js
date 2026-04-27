'use strict';

/**
 * Unit tests for src/services/mcpDiscovery.js
 *
 * Run: node tests/services/mcpDiscovery.test.js
 * (server does NOT need to be running — all I/O is against tmp dirs / tmp files)
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const {
  discoverMcpTools,
  _parseDotClaudeJson,
  _parseDotClaudeSettings,
  _parseMcpJson,
  toToolPrefix,
} = require('../../src/services/mcpDiscovery');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir;

function makeTmpDir() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-mcp-test-'));
}

function removeTmpDir() {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Write JSON to a file path, creating parent dirs as needed. */
function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
}

// ---------------------------------------------------------------------------
// Helper to override home dir for tests (used by _parseDotClaudeJson,
// _parseDotClaudeSettings which internally call os.homedir())
// ---------------------------------------------------------------------------

let originalHome;

function setFakeHome(dir) {
  originalHome = os.homedir;
  os.homedir = () => dir;
}

function restoreHome() {
  if (originalHome) {
    os.homedir = originalHome;
    originalHome = null;
  }
}

// ---------------------------------------------------------------------------
// toToolPrefix
// ---------------------------------------------------------------------------

describe('toToolPrefix', () => {
  it('plain server → mcp__name__*', () => {
    assert.equal(toToolPrefix('prism'), 'mcp__prism__*');
  });

  it('plugin → mcp__plugin_name__*', () => {
    assert.equal(toToolPrefix('playwright', true), 'mcp__plugin_playwright__*');
  });

  it('uppercased name is lowercased', () => {
    assert.equal(toToolPrefix('MyServer'), 'mcp__myserver__*');
  });

  it('special chars are replaced with _', () => {
    assert.equal(toToolPrefix('my-server'), 'mcp__my-server__*');
    assert.equal(toToolPrefix('my.server'), 'mcp__my_server__*');
  });
});

// ---------------------------------------------------------------------------
// _parseDotClaudeJson
// ---------------------------------------------------------------------------

describe('_parseDotClaudeJson', () => {
  before(() => makeTmpDir());
  after(() => { removeTmpDir(); restoreHome(); });

  it('returns [] when file does not exist', () => {
    setFakeHome(tmpDir);
    const results = _parseDotClaudeJson(null);
    assert.deepEqual(results, []);
  });

  it('returns [] when file is malformed JSON', () => {
    const fakeHome = path.join(tmpDir, 'home-malformed');
    fs.mkdirSync(fakeHome, { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.claude.json'), 'NOT_JSON', 'utf8');
    setFakeHome(fakeHome);
    const results = _parseDotClaudeJson(null);
    assert.deepEqual(results, []);
  });

  it('returns global mcpServers when present', () => {
    const fakeHome = path.join(tmpDir, 'home-global');
    writeJson(path.join(fakeHome, '.claude.json'), {
      mcpServers: { figma: { command: 'npx', args: ['@figma/mcp'] } },
    });
    setFakeHome(fakeHome);
    const results = _parseDotClaudeJson(null);
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'figma');
    assert.equal(results[0].toolPrefix, 'mcp__figma__*');
  });

  it('returns per-project mcpServers when workingDirectory matches', () => {
    const wd = '/home/user/myproject';
    const fakeHome = path.join(tmpDir, 'home-project');
    writeJson(path.join(fakeHome, '.claude.json'), {
      projects: {
        [wd]: {
          mcpServers: { 'my-tool': { command: 'npx', args: ['my-tool'] } },
        },
      },
    });
    setFakeHome(fakeHome);
    const results = _parseDotClaudeJson(wd);
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'my-tool');
  });

  it('does NOT return per-project server when workingDirectory does not match', () => {
    const wd = '/home/user/myproject';
    const fakeHome = path.join(tmpDir, 'home-no-match');
    writeJson(path.join(fakeHome, '.claude.json'), {
      projects: {
        [wd]: {
          mcpServers: { 'my-tool': {} },
        },
      },
    });
    setFakeHome(fakeHome);
    const results = _parseDotClaudeJson('/other/project');
    assert.deepEqual(results, []);
  });

  it('project entry overrides global entry with same id', () => {
    const wd = '/home/user/myproject';
    const fakeHome = path.join(tmpDir, 'home-override');
    writeJson(path.join(fakeHome, '.claude.json'), {
      mcpServers: { shared: {} },
      projects: {
        [wd]: {
          mcpServers: { shared: {} },
        },
      },
    });
    setFakeHome(fakeHome);
    const results = _parseDotClaudeJson(wd);
    // Deduplicated — appears only once
    assert.equal(results.filter((r) => r.id === 'shared').length, 1);
  });
});

// ---------------------------------------------------------------------------
// _parseDotClaudeSettings
// ---------------------------------------------------------------------------

describe('_parseDotClaudeSettings', () => {
  before(() => makeTmpDir());
  after(() => { removeTmpDir(); restoreHome(); });

  it('returns [] when file does not exist', () => {
    const fakeHome = path.join(tmpDir, 'home-no-settings');
    fs.mkdirSync(fakeHome, { recursive: true });
    setFakeHome(fakeHome);
    const results = _parseDotClaudeSettings();
    assert.deepEqual(results, []);
  });

  it('returns [] when file is malformed JSON', () => {
    const fakeHome = path.join(tmpDir, 'home-bad-settings');
    fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.claude', 'settings.json'), '!!!', 'utf8');
    setFakeHome(fakeHome);
    const results = _parseDotClaudeSettings();
    assert.deepEqual(results, []);
  });

  it('returns [] when enabledPlugins is absent', () => {
    const fakeHome = path.join(tmpDir, 'home-no-plugins');
    writeJson(path.join(fakeHome, '.claude', 'settings.json'), { theme: 'dark' });
    setFakeHome(fakeHome);
    const results = _parseDotClaudeSettings();
    assert.deepEqual(results, []);
  });

  it('parses boolean-true plugin entries', () => {
    const fakeHome = path.join(tmpDir, 'home-bool-plugins');
    writeJson(path.join(fakeHome, '.claude', 'settings.json'), {
      enabledPlugins: { playwright: true, figma: true },
    });
    setFakeHome(fakeHome);
    const results = _parseDotClaudeSettings();
    assert.equal(results.length, 2);
    const ids = results.map((r) => r.id).sort();
    assert.deepEqual(ids, ['figma', 'playwright']);
    assert.ok(results.every((r) => r.toolPrefix.startsWith('mcp__plugin_')));
  });

  it('ignores disabled plugins (enabled: false)', () => {
    const fakeHome = path.join(tmpDir, 'home-disabled-plugin');
    writeJson(path.join(fakeHome, '.claude', 'settings.json'), {
      enabledPlugins: {
        playwright: { enabled: true },
        stale: { enabled: false },
      },
    });
    setFakeHome(fakeHome);
    const results = _parseDotClaudeSettings();
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'playwright');
  });
});

// ---------------------------------------------------------------------------
// _parseMcpJson
// ---------------------------------------------------------------------------

describe('_parseMcpJson', () => {
  before(() => makeTmpDir());
  after(() => removeTmpDir());

  it('returns [] when workingDirectory is null', () => {
    const results = _parseMcpJson(null);
    assert.deepEqual(results, []);
  });

  it('returns [] when .mcp.json does not exist', () => {
    const results = _parseMcpJson(tmpDir);
    assert.deepEqual(results, []);
  });

  it('returns [] when .mcp.json is malformed', () => {
    fs.writeFileSync(path.join(tmpDir, '.mcp.json'), 'BROKEN', 'utf8');
    const results = _parseMcpJson(tmpDir);
    assert.deepEqual(results, []);
  });

  it('returns entries from mcpServers map', () => {
    writeJson(path.join(tmpDir, '.mcp.json'), {
      mcpServers: {
        'local-tool': { command: 'node', args: ['./mcp-server.js'] },
        'another':    { command: 'python', args: ['-m', 'mcp'] },
      },
    });
    const results = _parseMcpJson(tmpDir);
    assert.equal(results.length, 2);
    const ids = results.map((r) => r.id).sort();
    assert.deepEqual(ids, ['another', 'local-tool']);
    assert.ok(results.every((r) => r.source === '.mcp.json'));
  });

  it('returns [] when mcpServers key is missing', () => {
    writeJson(path.join(tmpDir, '.mcp.json'), { version: 1 });
    const results = _parseMcpJson(tmpDir);
    assert.deepEqual(results, []);
  });
});

// ---------------------------------------------------------------------------
// discoverMcpTools (integration)
// ---------------------------------------------------------------------------

describe('discoverMcpTools', () => {
  before(() => makeTmpDir());
  after(() => { removeTmpDir(); restoreHome(); });

  it('always includes the built-in prism server', () => {
    // Fake home with no files → only built-in
    const fakeHome = path.join(tmpDir, 'home-empty');
    fs.mkdirSync(fakeHome, { recursive: true });
    setFakeHome(fakeHome);

    const { servers } = discoverMcpTools(null);
    const prism = servers.find((s) => s.id === 'prism');
    assert.ok(prism, 'prism built-in should always be present');
    assert.equal(prism.source, 'built-in');
    assert.equal(prism.toolPrefix, 'mcp__prism__*');
  });

  it('later source (.mcp.json) overrides earlier source for same id', () => {
    const wd = path.join(tmpDir, 'project-override');
    fs.mkdirSync(wd, { recursive: true });

    const fakeHome = path.join(tmpDir, 'home-override2');
    writeJson(path.join(fakeHome, '.claude.json'), {
      mcpServers: { shared: {} },
    });
    setFakeHome(fakeHome);

    writeJson(path.join(wd, '.mcp.json'), {
      mcpServers: { shared: { command: 'local', args: [] } },
    });

    const { servers } = discoverMcpTools(wd);
    const matches = servers.filter((s) => s.id === 'shared');
    assert.equal(matches.length, 1, 'duplicate ids should be deduplicated');
    assert.equal(matches[0].source, '.mcp.json', '.mcp.json (highest priority) should win');
  });

  it('returns merged list when multiple sources contribute distinct ids', () => {
    const wd = path.join(tmpDir, 'project-merged');
    fs.mkdirSync(wd, { recursive: true });

    const fakeHome = path.join(tmpDir, 'home-merged');
    writeJson(path.join(fakeHome, '.claude.json'), {
      mcpServers: { figma: {} },
    });
    writeJson(path.join(fakeHome, '.claude', 'settings.json'), {
      enabledPlugins: { playwright: true },
    });
    setFakeHome(fakeHome);

    writeJson(path.join(wd, '.mcp.json'), {
      mcpServers: { 'local-db': { command: 'node', args: [] } },
    });

    const { servers } = discoverMcpTools(wd);
    const ids = servers.map((s) => s.id);
    assert.ok(ids.includes('prism'),      'should have built-in prism');
    assert.ok(ids.includes('figma'),      'should have figma from .claude.json');
    assert.ok(ids.includes('playwright'), 'should have playwright from settings.json');
    assert.ok(ids.includes('local-db'),   'should have local-db from .mcp.json');
  });

  it('does not throw when all external files are missing', () => {
    const fakeHome = path.join(tmpDir, 'home-all-missing');
    fs.mkdirSync(fakeHome, { recursive: true });
    setFakeHome(fakeHome);

    let result;
    assert.doesNotThrow(() => {
      result = discoverMcpTools('/nonexistent/path');
    });
    assert.ok(result.servers.length >= 1, 'at least built-in prism should be returned');
  });

  it('working-directory matching: includes project-specific server only for matching wd', () => {
    const wd = '/home/user/special-project';

    const fakeHome = path.join(tmpDir, 'home-wd-match');
    writeJson(path.join(fakeHome, '.claude.json'), {
      projects: {
        [wd]: { mcpServers: { 'special-tool': {} } },
      },
    });
    setFakeHome(fakeHome);

    // With matching wd — should include special-tool
    const { servers: withWd } = discoverMcpTools(wd);
    assert.ok(withWd.find((s) => s.id === 'special-tool'), 'should include special-tool when wd matches');

    // With different wd — should NOT include special-tool
    const { servers: withoutWd } = discoverMcpTools('/other/project');
    assert.ok(!withoutWd.find((s) => s.id === 'special-tool'), 'should NOT include special-tool when wd does not match');
  });
});
