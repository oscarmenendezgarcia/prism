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

const { describe, it, after } = require('node:test');
const assert           = require('node:assert/strict');
const fs               = require('fs');
const net              = require('net');
const os               = require('os');
const path             = require('path');
const { spawnSync }    = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
const PKG = require('../package.json');

// `prism init` registers MCP and installs agents under $HOME, so init tests get
// a throwaway one. Without --no-start they would also leave a detached server.
const INIT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-cli-home-'));
after(() => fs.rmSync(INIT_HOME, { recursive: true, force: true }));

function runCli(args, opts = {}) {
  const isInit = args[0] === 'init';
  return spawnSync(process.execPath, [CLI, ...args, ...(isInit ? ['--no-start', '--no-update-check'] : [])], {
    encoding: 'utf8',
    timeout:  5000,
    ...(isInit ? { env: { ...process.env, HOME: INIT_HOME } } : {}),
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

  it('init without --no-start starts the server on the data dir it was given, even if relative', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-cli-start-'));
    const port = await new Promise((resolve) => {
      const probe = net.createServer().listen(0, '127.0.0.1', () => {
        const { port: free } = probe.address();
        probe.close(() => resolve(free));
      });
    });
    try {
      const result = spawnSync(process.execPath, [CLI, 'init', '--data-dir', path.basename(tmp), '--port', String(port), '--no-update-check'], {
        encoding: 'utf8',
        timeout:  20000,
        cwd:      path.dirname(tmp),
        env:      { ...process.env, HOME: INIT_HOME, PIPELINE_AGENTS_DIR: path.join(INIT_HOME, 'agents') },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`ready on port ${port}`));
      assert.ok(fs.existsSync(path.join(tmp, 'prism.db')), 'the server must open its database in --data-dir');
    } finally {
      const pidFile = path.join(tmp, 'prism.pid');
      if (fs.existsSync(pidFile)) {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
        try {
          process.kill(pid);
          // kill(pid, 0) throws once the process is gone, which ends the wait.
          for (let i = 0; i < 100; i++) {
            process.kill(pid, 0);
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } catch { /* gone */ }
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('init --no-start does not start a server', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-cli-nostart-'));
    try {
      const result = runCli(['init', '--data-dir', tmp]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /not started/);
      assert.ok(!fs.existsSync(path.join(tmp, 'prism.pid')), 'prism.pid must not be written');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('init is idempotent (running twice does not overwrite settings.json)', () => {
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
