'use strict';

/**
 * Unit tests for bin/stop.js
 *
 * All OS interactions (process.kill, process.exit, polling) are injected so
 * tests run fully in-process without spawning any real server.
 *
 * Run with: node --test tests/cli.stop.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

const {
  run,
  readPidFile,
  isPidAlive,
  removePidFile,
  waitForExit,
} = require(path.join(__dirname, '..', 'bin', 'stop.js'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh temp dir for each test case. */
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-stop-test-'));
}

/** Write a PID file into `dir`. */
function writePid(dir, pid) {
  fs.writeFileSync(path.join(dir, 'prism.pid'), String(pid) + '\n', 'utf8');
}

/**
 * Build a full deps object for run().
 * All defaults are safe no-ops; tests override what they need.
 */
function buildDeps(overrides = {}) {
  const captured = {
    signals:  [],  // { pid, signal }
    exitCode: null,
    stdout:   '',
    stderr:   '',
  };

  const defaults = {
    _isPidAlive:    () => false,
    _sendSignal:    (pid, signal) => { captured.signals.push({ pid, signal }); },
    _waitForExit:   async () => true,
    _removePidFile: () => {},
    _readPidFile:   () => null,
    _exit:          (code) => { captured.exitCode = code; },
    _stdout:        { write: (msg) => { captured.stdout += msg; } },
    _stderr:        { write: (msg) => { captured.stderr += msg; } },
    pollIntervalMs: 1,
    timeoutMs:      100,
  };

  return { deps: { ...defaults, ...overrides }, captured };
}

// ---------------------------------------------------------------------------
// readPidFile — unit tests
// ---------------------------------------------------------------------------

describe('readPidFile()', () => {
  it('returns null when file does not exist', () => {
    const dir = makeTmpDir();
    try {
      assert.equal(readPidFile(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the parsed PID for a valid file', () => {
    const dir = makeTmpDir();
    try {
      writePid(dir, 12345);
      assert.equal(readPidFile(dir), 12345);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for a file containing a non-numeric string', () => {
    const dir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(dir, 'prism.pid'), 'not-a-number\n', 'utf8');
      assert.equal(readPidFile(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for a file containing zero', () => {
    const dir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(dir, 'prism.pid'), '0\n', 'utf8');
      assert.equal(readPidFile(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('trims whitespace before parsing', () => {
    const dir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(dir, 'prism.pid'), '  99999  \n', 'utf8');
      assert.equal(readPidFile(dir), 99999);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// isPidAlive — unit tests
// ---------------------------------------------------------------------------

describe('isPidAlive()', () => {
  it('returns true for the current process PID', () => {
    assert.equal(isPidAlive(process.pid), true);
  });

  it('returns false for a clearly non-existent PID (very large number)', () => {
    // PID 999999999 almost certainly does not exist on any OS
    // (max PID on Linux is typically 4_194_304; on macOS ~99999)
    assert.equal(isPidAlive(999999999), false);
  });

  it('returns false for non-integer input', () => {
    assert.equal(isPidAlive(null), false);
    assert.equal(isPidAlive('hello'), false);
    assert.equal(isPidAlive(1.5), false);
  });

  it('returns false for zero or negative PID', () => {
    assert.equal(isPidAlive(0), false);
    assert.equal(isPidAlive(-1), false);
  });
});

// ---------------------------------------------------------------------------
// removePidFile — unit tests
// ---------------------------------------------------------------------------

describe('removePidFile()', () => {
  it('removes an existing prism.pid file', () => {
    const dir = makeTmpDir();
    try {
      writePid(dir, 1234);
      removePidFile(dir);
      assert.equal(fs.existsSync(path.join(dir, 'prism.pid')), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not throw when file does not exist (ENOENT silenced)', () => {
    const dir = makeTmpDir();
    try {
      assert.doesNotThrow(() => removePidFile(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// waitForExit — unit tests
// ---------------------------------------------------------------------------

describe('waitForExit()', () => {
  it('returns true immediately when PID is already gone', async () => {
    // Use a definitely-dead PID so the first isPidAlive() call returns false
    const result = await waitForExit(999999999, 1000, 1);
    assert.equal(result, true);
  });

  it('returns false when the PID never disappears within the timeout', async () => {
    // Use our own PID — it is alive for the duration of the test
    const result = await waitForExit(process.pid, 50, 5);
    assert.equal(result, false);
  });
});

// ---------------------------------------------------------------------------
// run() — PID file absent / process already dead
// ---------------------------------------------------------------------------

describe('run() — no PID file', () => {
  it('prints "not running" and exits 0 when no PID file exists', async () => {
    const dir = makeTmpDir();
    try {
      const { deps, captured } = buildDeps({
        _readPidFile: () => null,
      });
      await run({ dataDir: dir }, deps);
      assert.ok(captured.stdout.includes('not running'), `stdout: ${captured.stdout}`);
      assert.equal(captured.exitCode, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('run() — stale PID', () => {
  it('prints stale message and exits 0 when PID file points to dead process', async () => {
    const dir = makeTmpDir();
    try {
      writePid(dir, 999999999);
      const removedPaths = [];
      const { deps, captured } = buildDeps({
        _readPidFile:   (d) => readPidFile(d),
        _isPidAlive:    () => false,
        _removePidFile: (d) => { removedPaths.push(d); },
      });
      await run({ dataDir: dir }, deps);
      assert.ok(
        captured.stdout.includes('not running') && captured.stdout.includes('stale'),
        `expected "not running" and "stale" in stdout, got: "${captured.stdout}"`
      );
      assert.equal(captured.exitCode, 0);
      // PID file cleanup must have been requested
      assert.equal(removedPaths.length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removes the actual PID file on disk when PID is stale', async () => {
    const dir = makeTmpDir();
    try {
      writePid(dir, 999999999);
      const { deps } = buildDeps({
        _readPidFile:  (d) => readPidFile(d),
        _isPidAlive:   () => false,
        // Use the real removePidFile so we can verify the file disappears
        _removePidFile: removePidFile,
      });
      await run({ dataDir: dir }, deps);
      assert.equal(
        fs.existsSync(path.join(dir, 'prism.pid')),
        false,
        'stale prism.pid should be deleted'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// run() — PID alive → SIGTERM flow
// ---------------------------------------------------------------------------

describe('run() — PID alive, graceful SIGTERM', () => {
  it('sends SIGTERM when the process is alive', async () => {
    const dir = makeTmpDir();
    try {
      writePid(dir, 12345);
      const { deps, captured } = buildDeps({
        _readPidFile:  (d) => readPidFile(d),
        _isPidAlive:   () => true,
        _waitForExit:  async () => true,
      });
      await run({ dataDir: dir }, deps);
      assert.equal(captured.signals.length, 1, 'exactly one signal should be sent');
      assert.equal(captured.signals[0].pid, 12345);
      assert.equal(captured.signals[0].signal, 'SIGTERM');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 after clean graceful shutdown', async () => {
    const dir = makeTmpDir();
    try {
      writePid(dir, 12345);
      const { deps, captured } = buildDeps({
        _readPidFile:  (d) => readPidFile(d),
        _isPidAlive:   () => true,
        _waitForExit:  async () => true,
      });
      await run({ dataDir: dir }, deps);
      assert.equal(captured.exitCode, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removes the PID file after clean graceful shutdown', async () => {
    const dir = makeTmpDir();
    try {
      writePid(dir, 12345);
      const removedPaths = [];
      const { deps } = buildDeps({
        _readPidFile:   (d) => readPidFile(d),
        _isPidAlive:    () => true,
        _waitForExit:   async () => true,
        _removePidFile: (d) => { removedPaths.push(d); },
      });
      await run({ dataDir: dir }, deps);
      assert.equal(removedPaths.length, 1, 'PID file should be removed after stop');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 and prints timeout message when process does not stop in time', async () => {
    const dir = makeTmpDir();
    try {
      writePid(dir, 12345);
      const { deps, captured } = buildDeps({
        _readPidFile:  (d) => readPidFile(d),
        _isPidAlive:   () => true,
        _waitForExit:  async () => false,  // simulate timeout
      });
      await run({ dataDir: dir }, deps);
      assert.equal(captured.exitCode, 1);
      assert.ok(
        captured.stderr.includes('Timeout') || captured.stderr.includes('timeout'),
        `expected "Timeout" in stderr, got: "${captured.stderr}"`
      );
      assert.ok(
        captured.stderr.includes('--force'),
        `expected "--force" hint in stderr, got: "${captured.stderr}"`
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does NOT remove PID file after timeout (process might still be running)', async () => {
    const dir = makeTmpDir();
    try {
      writePid(dir, 12345);
      const removedPaths = [];
      const { deps } = buildDeps({
        _readPidFile:   (d) => readPidFile(d),
        _isPidAlive:    () => true,
        _waitForExit:   async () => false,
        _removePidFile: (d) => { removedPaths.push(d); },
      });
      await run({ dataDir: dir }, deps);
      assert.equal(removedPaths.length, 0, 'PID file must not be removed after timeout');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// run() — --force → SIGKILL path
// ---------------------------------------------------------------------------

describe('run() — --force (SIGKILL)', () => {
  it('sends SIGKILL instead of SIGTERM when --force is set', async () => {
    const dir = makeTmpDir();
    try {
      writePid(dir, 12345);
      const { deps, captured } = buildDeps({
        _readPidFile: (d) => readPidFile(d),
        _isPidAlive:  () => true,
      });
      await run({ dataDir: dir, force: true }, deps);
      assert.equal(captured.signals.length, 1, 'exactly one signal should be sent');
      assert.equal(captured.signals[0].signal, 'SIGKILL');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not call _waitForExit when --force is set', async () => {
    const dir = makeTmpDir();
    try {
      writePid(dir, 12345);
      let waitCalled = false;
      const { deps } = buildDeps({
        _readPidFile: (d) => readPidFile(d),
        _isPidAlive:  () => true,
        _waitForExit: async () => { waitCalled = true; return true; },
      });
      await run({ dataDir: dir, force: true }, deps);
      assert.equal(waitCalled, false, '_waitForExit must not be called with --force');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removes PID file and exits 0 after forced kill', async () => {
    const dir = makeTmpDir();
    try {
      writePid(dir, 12345);
      const removedPaths = [];
      const { deps, captured } = buildDeps({
        _readPidFile:   (d) => readPidFile(d),
        _isPidAlive:    () => true,
        _removePidFile: (d) => { removedPaths.push(d); },
      });
      await run({ dataDir: dir, force: true }, deps);
      assert.equal(captured.exitCode, 0);
      assert.equal(removedPaths.length, 1, 'PID file should be removed after forced stop');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// CLI integration smoke test — `prism stop` appears in --help output
// ---------------------------------------------------------------------------

describe('cli.js --help', () => {
  const { spawnSync } = require('child_process');
  const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

  it('--help output mentions "stop"', () => {
    const result = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes('stop'), 'help output must mention "stop"');
  });

  it('unknown subcommand "deploy" still exits 2', () => {
    const result = spawnSync(process.execPath, [CLI, 'deploy'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 2);
  });
});
