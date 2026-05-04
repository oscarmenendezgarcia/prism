'use strict';

/**
 * Smoke tests for bin/cli.js
 *
 * Tests exit codes and output for:
 *   - prism --version  → 0
 *   - prism --help     → 0
 *   - prism            → 0 (no subcommand prints usage)
 *   - prism <unknown>  → 2
 *
 * Run with: node --test tests/cli.test.js
 */

const { describe, it } = require('node:test');
const assert           = require('node:assert/strict');
const path             = require('path');
const { spawnSync }    = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
const PKG = require('../package.json');

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout:  5000,
    ...opts,
  });
}

describe('bin/cli.js', () => {
  // -------------------------------------------------------------------------
  // --version
  // -------------------------------------------------------------------------
  it('--version prints package.json version and exits 0', () => {
    const result = runCli(['--version']);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`);
    assert.ok(
      result.stdout.trim() === PKG.version,
      `expected "${PKG.version}", got "${result.stdout.trim()}"`
    );
  });

  it('-v prints package.json version and exits 0', () => {
    const result = runCli(['-v']);
    assert.equal(result.status, 0);
    assert.ok(result.stdout.trim() === PKG.version);
  });

  // -------------------------------------------------------------------------
  // --help
  // -------------------------------------------------------------------------
  it('--help prints usage to stdout and exits 0', () => {
    const result = runCli(['--help']);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`);
    assert.ok(result.stdout.includes('prism'), 'help output should mention "prism"');
    assert.ok(result.stdout.includes('start'), 'help output should mention "start"');
    assert.ok(result.stdout.includes('init'),  'help output should mention "init"');
  });

  it('-h prints usage to stdout and exits 0', () => {
    const result = runCli(['-h']);
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes('start'));
  });

  // -------------------------------------------------------------------------
  // No subcommand
  // -------------------------------------------------------------------------
  it('no subcommand prints usage to stdout and exits 0', () => {
    const result = runCli([]);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`);
    assert.ok(result.stdout.includes('start'));
  });

  // -------------------------------------------------------------------------
  // Unknown subcommand
  // -------------------------------------------------------------------------
  it('unknown subcommand writes to stderr and exits 2', () => {
    const result = runCli(['bogus']);
    assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
    assert.ok(result.stderr.includes('bogus'), 'stderr should mention the unknown subcommand');
  });

  it('unknown subcommand "deploy" exits 2', () => {
    const result = runCli(['deploy']);
    assert.equal(result.status, 2);
  });

  // -------------------------------------------------------------------------
  // init subcommand (smoke — no server required)
  // -------------------------------------------------------------------------
  it('init with --data-dir pointing to a temp dir exits 0', () => {
    const os   = require('os');
    const fs   = require('fs');
    const tmp  = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-cli-init-'));
    try {
      const result = runCli(['init', '--data-dir', tmp, '--silent']);
      assert.equal(result.status, 0, `expected exit 0\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

      // settings.json must be created
      assert.ok(
        fs.existsSync(path.join(tmp, 'settings.json')),
        'settings.json must be created by prism init'
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('init is idempotent (running twice does not overwrite settings.json)', () => {
    const os   = require('os');
    const fs   = require('fs');
    const tmp  = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-cli-idempotent-'));
    try {
      runCli(['init', '--data-dir', tmp, '--silent']);

      const settingsPath = path.join(tmp, 'settings.json');
      const mtimeBefore  = fs.statSync(settingsPath).mtimeMs;

      // Small sleep so mtime would differ if the file was overwritten
      const deadline = Date.now() + 50;
      while (Date.now() < deadline) { /* spin */ }

      runCli(['init', '--data-dir', tmp, '--silent']);
      const mtimeAfter = fs.statSync(settingsPath).mtimeMs;

      assert.equal(mtimeBefore, mtimeAfter, 'settings.json should not be overwritten on second init');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('init --force overwrites existing settings.json', () => {
    const os   = require('os');
    const fs   = require('fs');
    const tmp  = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-cli-force-'));
    try {
      runCli(['init', '--data-dir', tmp, '--silent']);

      const settingsPath = path.join(tmp, 'settings.json');
      // Corrupt the file
      fs.writeFileSync(settingsPath, '{}');

      runCli(['init', '--data-dir', tmp, '--silent', '--force']);

      const content = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      assert.ok(content.pipeline, '--force should restore default settings with pipeline key');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
