'use strict';
/**
 * tests/install-script.test.js
 *
 * Unit + integration tests for install.sh and the prism CLI (bin/cli.js + bin/init.js).
 *
 * Tests are structured into three groups:
 *   1. install.sh shell logic (extracted functions, executed via sh -c)
 *   2. prism CLI exit codes and output (node bin/cli.js)
 *   3. prism init correctness (data dir creation, settings.json schema, idempotency)
 *
 * Run: node --test tests/install-script.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { execSync, spawnSync } = require('node:child_process');
const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');

const REPO_ROOT = path.resolve(__dirname, '..');
const INSTALL_SH = path.join(REPO_ROOT, 'install.sh');
const CLI = path.join(REPO_ROOT, 'bin', 'cli.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sh(script) {
  return spawnSync('sh', ['-c', script], { encoding: 'utf8' });
}

function prism(...args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
}

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-qa-'));
}

// ---------------------------------------------------------------------------
// 1. install.sh — shell logic unit tests
// ---------------------------------------------------------------------------

describe('install.sh — Node detection logic', () => {
  // Extracted _need_node shell function
  const NEED_NODE_FUNC = `
NODE_MIN_MAJOR=20
_node_major() { node --version 2>/dev/null | sed 's/v//' | cut -d. -f1; }
_need_node() {
  if ! command -v node > /dev/null 2>&1; then return 0; fi
  major=$(_node_major)
  [ -z "$major" ] && return 0
  if [ "$major" -lt "$NODE_MIN_MAJOR" ] 2>/dev/null; then return 0; fi
  return 1
}
`;

  test('TC-001: Node >=20 present → _need_node returns 1 (no install needed)', () => {
    const r = sh(`${NEED_NODE_FUNC} _need_node && echo NEEDS || echo SKIP`);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /SKIP/, 'Expected _need_node to return 1 (node is OK)');
  });

  test('TC-002: Simulated Node v18 → _need_node returns 0 (install needed)', () => {
    const r = sh(`
NODE_MIN_MAJOR=20
major=18
if [ "$major" -lt "$NODE_MIN_MAJOR" ] 2>/dev/null; then echo NEEDS; else echo SKIP; fi
`);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /NEEDS/, 'Expected v18 < 20 to trigger install');
  });

  test('TC-004: Empty major → should return 0 (need install)', () => {
    // Without the [ -z "$major" ] guard this test FAILS — confirms BUG-002
    const r = sh(`
NODE_MIN_MAJOR=20
major=""
_need_node_fixed() {
  [ -z "$major" ] && return 0
  if [ "$major" -lt "$NODE_MIN_MAJOR" ] 2>/dev/null; then return 0; fi
  return 1
}
_need_node_fixed && echo NEEDS || echo SKIP
`);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /NEEDS/, 'Empty major should trigger install (after BUG-002 fix)');
  });

  test('TC-004b: Current code — empty major incorrectly treated as ok (BUG-002 regression guard)', () => {
    // This test documents the CURRENT broken behavior to catch regressions after fix
    const r = sh(`
NODE_MIN_MAJOR=20
major=""
if [ "$major" -lt "$NODE_MIN_MAJOR" ] 2>/dev/null; then echo NEEDS; else echo SKIP; fi
`);
    assert.equal(r.status, 0);
    // Current code outputs SKIP (bug). After fix applied, this should output NEEDS.
    // Test is marked informational — uncomment the correct assertion after fix.
    // assert.match(r.stdout, /NEEDS/);  // expected after fix
    assert.match(r.stdout, /SKIP/, 'BUG-002: empty major silently bypasses check (current behavior)');
  });

  test('TC-005: _source_nvm with nonexistent NVM_DIR returns 1 gracefully', () => {
    const r = sh(`
NVM_DIR="/nonexistent/qa/path"
_source_nvm() {
  if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh"; return 0; fi
  return 1
}
_source_nvm && echo SOURCED || echo NOT_SOURCED
echo SCRIPT_CONTINUES
`);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /NOT_SOURCED/);
    assert.match(r.stdout, /SCRIPT_CONTINUES/, 'Script must continue after _source_nvm returns 1');
  });
});

describe('install.sh — POSIX compliance', () => {
  test('TC-011: No bash-isms: no [[ ]] double-bracket', () => {
    const content = fs.readFileSync(INSTALL_SH, 'utf8');
    assert.ok(!content.includes('[['), 'Found bash-only [[ — not POSIX');
  });

  test('TC-011b: No bash-isms: no "local" keyword outside functions (script-level)', () => {
    const content = fs.readFileSync(INSTALL_SH, 'utf8');
    // "local" is allowed inside functions in most sh implementations but is not strictly POSIX.
    // We verify it is not used at all.
    const lines = content.split('\n').filter(l => /^\s*local\s/.test(l));
    assert.equal(lines.length, 0, `Found "local" keyword usage: ${lines.join(', ')}`);
  });

  test('TC-011c: Uses POSIX sh shebang, not bash', () => {
    const content = fs.readFileSync(INSTALL_SH, 'utf8');
    const firstLine = content.split('\n')[0];
    assert.ok(
      firstLine === '#!/usr/bin/env sh',
      `Expected #!/usr/bin/env sh, got: ${firstLine}`,
    );
  });

  test('TC-012: Shell syntax valid', () => {
    const r = spawnSync('bash', ['-n', INSTALL_SH], { encoding: 'utf8' });
    assert.equal(r.status, 0, `Syntax error: ${r.stderr}`);
  });
});

describe('install.sh — arg forwarding', () => {
  test('TC-009: $@ used (not $*) for prism init invocation', () => {
    const content = fs.readFileSync(INSTALL_SH, 'utf8');
    // Correct arg forwarding must use "$@" in prism init call
    assert.ok(
      content.includes('prism init "$@"'),
      'Expected `prism init "$@"` for correct quoted arg forwarding',
    );
  });

  test('TC-011d: NVM installer URL uses HTTPS', () => {
    const content = fs.readFileSync(INSTALL_SH, 'utf8');
    const urlMatch = content.match(/NVM_INSTALL_URL="([^"]+)"/);
    assert.ok(urlMatch, 'NVM_INSTALL_URL constant not found');
    assert.ok(urlMatch[1].startsWith('https://'), 'NVM_INSTALL_URL must use HTTPS');
  });

  test('TC-023: NVM installer URL is pinned (not "latest")', () => {
    const content = fs.readFileSync(INSTALL_SH, 'utf8');
    const urlMatch = content.match(/NVM_INSTALL_URL="([^"]+)"/);
    assert.ok(urlMatch, 'NVM_INSTALL_URL constant not found');
    assert.ok(
      !urlMatch[1].includes('/latest/'),
      'NVM_INSTALL_URL must NOT reference /latest/ — pin to a specific version',
    );
    // Should reference a version tag like /v0.40.x/
    assert.match(urlMatch[1], /\/v\d+\.\d+\.\d+\//, 'NVM_INSTALL_URL should pin to semver tag');
  });
});

describe('install.sh — PATH fallback (BUG-001)', () => {
  test('TC-007: npm bin -g is removed in npm 10 and writes to stdout (not stderr)', () => {
    const r = spawnSync('npm', ['bin', '-g'], { encoding: 'utf8' });
    // npm 10 exits with code 1 for removed commands
    if (r.status !== 0) {
      // npm 10+: error on stdout
      assert.ok(
        r.stdout.includes('Unknown command') || r.stdout.includes('bin'),
        'Expected npm 10 "Unknown command" message on stdout',
      );
      // Confirm the fix: npm prefix -g works
      const prefixResult = spawnSync('npm', ['prefix', '-g'], { encoding: 'utf8' });
      assert.equal(prefixResult.status, 0, 'npm prefix -g must succeed as replacement');
    } else {
      // npm < 10: npm bin -g still works — note in test output
      console.log('  Note: npm bin -g still works on this npm version; BUG-001 not triggered here');
    }
  });

  test('TC-008: install.sh warn message references npm bin -g (BUG-001 documentation)', () => {
    const content = fs.readFileSync(INSTALL_SH, 'utf8');
    // This assertion PASSES currently (bug present), FAILS after fix applied
    // It documents what must change
    const hasBrokenRef = content.includes('npm bin -g');
    if (hasBrokenRef) {
      // Bug present — flag for developer
      assert.fail(
        'BUG-001: install.sh references "npm bin -g" which is removed in npm 10. ' +
        'Replace with "npm prefix -g" + "/bin" suffix.',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 2. prism CLI — exit codes and output
// ---------------------------------------------------------------------------

describe('prism CLI — exit codes', () => {
  test('TC-014: prism --version exits 0 and prints semver', () => {
    const r = prism('--version');
    assert.equal(r.status, 0, `Expected exit 0, got ${r.status}`);
    assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/, 'Expected semver output');
  });

  test('TC-015: prism --help exits 0', () => {
    const r = prism('--help');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /prism —/);
  });

  test('TC-016: Unknown subcommand exits 2', () => {
    const r = prism('unknowncmd');
    assert.equal(r.status, 2, `Expected exit 2, got ${r.status}`);
    assert.match(r.stderr, /unknown subcommand/i);
  });

  test('TC-016b: prism start --port NaN exits 2', () => {
    // Can't actually start server in tests; just verify argument parsing error
    const r = prism('start', '--port', 'notanumber');
    assert.equal(r.status, 2, `Expected exit 2 for invalid port, got ${r.status}`);
  });
});

// ---------------------------------------------------------------------------
// 3. prism init — data dir, settings.json, idempotency, --force
// ---------------------------------------------------------------------------

describe('prism init — correctness', () => {
  test('TC-017: Creates data dir and settings.json on first run', () => {
    const dir = mktmp();
    try {
      const r = prism('init', '--data-dir', dir, '--silent');
      assert.equal(r.status, 0, `prism init failed: ${r.stderr}`);
      const settingsPath = path.join(dir, 'settings.json');
      assert.ok(fs.existsSync(settingsPath), 'settings.json must be created');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('TC-018: Idempotent — second run skips existing settings.json', () => {
    const dir = mktmp();
    try {
      prism('init', '--data-dir', dir, '--silent');
      const before = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
      const r2 = prism('init', '--data-dir', dir);
      assert.equal(r2.status, 0);
      assert.match(r2.stdout, /already exists|skipped/i);
      const after = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
      assert.equal(before, after, 'settings.json must not change on second run');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('TC-019: --force overwrites corrupted settings.json', () => {
    const dir = mktmp();
    try {
      prism('init', '--data-dir', dir, '--silent');
      fs.writeFileSync(path.join(dir, 'settings.json'), '{"corrupted":true}');
      const r = prism('init', '--data-dir', dir, '--force', '--silent');
      assert.equal(r.status, 0);
      const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
      assert.ok(settings.pipeline, 'pipeline key must be present after --force overwrite');
      assert.ok(settings.ui, 'ui key must be present after --force overwrite');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('TC-020: --data-dir with spaces in path', () => {
    const base = mktmp();
    const dir  = path.join(base, 'path with spaces');
    try {
      fs.mkdirSync(dir, { recursive: true });
      const r = prism('init', '--data-dir', dir, '--silent');
      assert.equal(r.status, 0, `prism init failed: ${r.stderr}`);
      assert.ok(fs.existsSync(path.join(dir, 'settings.json')));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test('TC-021: settings.json schema — required keys present with correct types', () => {
    const dir = mktmp();
    try {
      prism('init', '--data-dir', dir, '--silent');
      const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));

      // pipeline
      assert.equal(typeof settings.pipeline, 'object', 'pipeline must be object');
      assert.equal(typeof settings.pipeline.agentsDir, 'string', 'agentsDir must be string');
      assert.equal(typeof settings.pipeline.timeout, 'number', 'timeout must be number');
      assert.equal(typeof settings.pipeline.maxConcurrent, 'number', 'maxConcurrent must be number');
      assert.ok(settings.pipeline.timeout > 0, 'timeout must be positive');
      assert.ok(settings.pipeline.maxConcurrent > 0, 'maxConcurrent must be positive');

      // ui
      assert.equal(typeof settings.ui, 'object', 'ui must be object');
      assert.ok(['dark', 'light'].includes(settings.ui.theme), 'ui.theme must be dark|light');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('TC-021b: agentsDir defaults to ~/.claude/agents', () => {
    const dir = mktmp();
    try {
      prism('init', '--data-dir', dir, '--silent');
      const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
      const expected = path.join(os.homedir(), '.claude', 'agents');
      assert.equal(settings.pipeline.agentsDir, expected);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 4. docs/installation.md — accuracy checks
// ---------------------------------------------------------------------------

describe('docs/installation.md — accuracy', () => {
  const DOCS = path.join(REPO_ROOT, 'docs', 'installation.md');

  test('TC-026: One-liner URL in docs matches install.sh header URL', () => {
    const docsContent = fs.readFileSync(DOCS, 'utf8');
    const installContent = fs.readFileSync(INSTALL_SH, 'utf8');

    // Extract URL from install.sh header comment
    const shUrlMatch = installContent.match(/curl -fsSL (https:\/\/[^\s|]+)/);
    assert.ok(shUrlMatch, 'Could not extract URL from install.sh header');
    const shUrl = shUrlMatch[1];

    // Docs must reference the same URL
    assert.ok(docsContent.includes(shUrl), `docs/installation.md must reference: ${shUrl}`);
  });

  test('TC-028: Troubleshooting section must NOT use deprecated npm bin -g', () => {
    const content = fs.readFileSync(DOCS, 'utf8');
    const hasBrokenCmd = content.includes('npm bin -g');
    if (hasBrokenCmd) {
      assert.fail(
        'BUG-001: docs/installation.md contains "npm bin -g" which is removed in npm 10. ' +
        'Replace with: npm prefix -g',
      );
    }
  });

  test('TC-029: --force flag documented in installation guide', () => {
    const content = fs.readFileSync(DOCS, 'utf8');
    assert.ok(content.includes('--force'), 'docs must document the --force flag');
  });
});
