'use strict';

/**
 * Unit tests for bin/status.js
 *
 * The PID file and the HTTP probe are both injected, so tests run fully
 * in-process without a real server, socket, or process table.
 *
 * Run with: node --test tests/cli.status.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

const {
  run,
  readPidFile,
  isPidAlive,
  resolvePort,
  buildStatus,
  fetchActiveRunCount,
  formatText,
  formatJson,
} = require(path.join(__dirname, '..', 'bin', 'status.js'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-status-test-'));
}

function writePid(dir, pid) {
  fs.writeFileSync(path.join(dir, 'prism.pid'), String(pid) + '\n', 'utf8');
}

/**
 * Build a full deps object for run(). All defaults are safe no-ops; each test
 * overrides only what it needs. Captures stdout/stderr/exit for assertions.
 */
function buildDeps(overrides = {}) {
  const captured = { exitCode: null, stdout: '', stderr: '' };

  const defaults = {
    _readPidFile:         () => null,
    _isPidAlive:          () => false,
    _fetchActiveRunCount: async () => ({ count: null }),
    _exit:   (code) => { captured.exitCode = code; },
    _stdout: { write: (msg) => { captured.stdout += msg; } },
    _stderr: { write: (msg) => { captured.stderr += msg; } },
  };

  return { deps: { ...defaults, ...overrides }, captured };
}

// ---------------------------------------------------------------------------
// re-exported PID helpers
// ---------------------------------------------------------------------------

describe('status.js re-exports PID helpers from stop.js', () => {
  it('exports readPidFile and isPidAlive', () => {
    assert.equal(typeof readPidFile, 'function');
    assert.equal(typeof isPidAlive, 'function');
  });

  it('isPidAlive returns true for the current process', () => {
    assert.equal(isPidAlive(process.pid), true);
  });

  it('isPidAlive returns false for a clearly dead PID', () => {
    assert.equal(isPidAlive(999999999), false);
  });
});

// ---------------------------------------------------------------------------
// resolvePort — precedence flag > env > default
// ---------------------------------------------------------------------------

describe('resolvePort()', () => {
  it('returns the --port flag when set (as integer)', () => {
    assert.equal(resolvePort({ port: '4100' }, { PORT: '5000' }), 4100);
  });

  it('falls back to the PORT env when no flag is set', () => {
    assert.equal(resolvePort({}, { PORT: '5000' }), 5000);
  });

  it('falls back to 3000 when neither flag nor env is set', () => {
    assert.equal(resolvePort({}, {}), 3000);
  });

  it('ignores a non-numeric flag and falls through to env', () => {
    assert.equal(resolvePort({ port: 'abc' }, { PORT: '5000' }), 5000);
  });

  it('ignores a non-numeric flag and env, returning the default', () => {
    assert.equal(resolvePort({ port: 'abc' }, { PORT: 'xyz' }), 3000);
  });

  it('ignores an empty-string env PORT', () => {
    assert.equal(resolvePort({}, { PORT: '' }), 3000);
  });

  it('always returns an integer', () => {
    assert.equal(Number.isInteger(resolvePort({ port: '8080' }, {})), true);
  });
});

// ---------------------------------------------------------------------------
// buildStatus — pure assembler
// ---------------------------------------------------------------------------

describe('buildStatus()', () => {
  it('assembles a running status with a numeric activeRuns (api reachable)', () => {
    const s = buildStatus({
      running: true, pid: 4242, port: 3000, version: '1.2.0',
      activeRuns: 2, dataDir: '/tmp/prism',
    });
    assert.deepEqual(s, {
      running: true,
      pid: 4242,
      port: 3000,
      version: '1.2.0',
      activeRuns: 2,
      dataDir: '/tmp/prism',
      sqlitePath: path.join('/tmp/prism', 'prism.db'),
      api: 'reachable',
    });
  });

  it('sets sqlitePath to <dataDir>/prism.db', () => {
    const s = buildStatus({
      running: true, pid: 1, port: 3000, version: '1.0.0',
      activeRuns: 0, dataDir: '/var/data/prism',
    });
    assert.equal(s.sqlitePath, path.join('/var/data/prism', 'prism.db'));
  });

  it('treats activeRuns=0 as reachable (not unknown)', () => {
    const s = buildStatus({
      running: true, pid: 1, port: 3000, version: '1.0.0',
      activeRuns: 0, dataDir: '/tmp/p',
    });
    assert.equal(s.activeRuns, 0);
    assert.equal(s.api, 'reachable');
  });

  it('maps a null activeRuns to api "unreachable"', () => {
    const s = buildStatus({
      running: true, pid: 1, port: 3000, version: '1.0.0',
      activeRuns: null, dataDir: '/tmp/p',
    });
    assert.equal(s.activeRuns, null);
    assert.equal(s.api, 'unreachable');
  });

  it('coerces a missing pid to null', () => {
    const s = buildStatus({
      running: false, pid: undefined, port: 3000, version: '1.0.0',
      activeRuns: null, dataDir: '/tmp/p',
    });
    assert.equal(s.pid, null);
  });

  it('is pure — does not touch fs/http/process', () => {
    // Calling with a bogus dataDir must not throw or perform I/O.
    assert.doesNotThrow(() => buildStatus({
      running: false, pid: null, port: 1, version: 'x',
      activeRuns: null, dataDir: '/nonexistent/xyz',
    }));
  });
});

// ---------------------------------------------------------------------------
// fetchActiveRunCount — time-boxed HTTP + client-side count
// ---------------------------------------------------------------------------

describe('fetchActiveRunCount()', () => {
  it('counts only status==="running" entries client-side', async () => {
    const _fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ([
        { status: 'running' },
        { status: 'completed' },
        { status: 'running' },
        { status: 'interrupted' },
      ]),
    });
    const res = await fetchActiveRunCount(3000, { _fetch });
    assert.deepEqual(res, { count: 2 });
  });

  it('returns count 0 when no runs are running', async () => {
    const _fetch = async () => ({
      ok: true, status: 200, json: async () => ([{ status: 'completed' }]),
    });
    assert.deepEqual(await fetchActiveRunCount(3000, { _fetch }), { count: 0 });
  });

  it('sends the request to 127.0.0.1:<port>/api/v1/runs?status=running', async () => {
    let capturedUrl = null;
    const _fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => ([]) };
    };
    await fetchActiveRunCount(4321, { _fetch });
    assert.equal(capturedUrl, 'http://127.0.0.1:4321/api/v1/runs?status=running');
  });

  it('returns { count: null } on a non-200 response (never throws)', async () => {
    const _fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const res = await fetchActiveRunCount(3000, { _fetch });
    assert.equal(res.count, null);
  });

  it('returns { count: null } on a network error (connection refused)', async () => {
    const _fetch = async () => { throw new Error('ECONNREFUSED'); };
    const res = await fetchActiveRunCount(3000, { _fetch });
    assert.equal(res.count, null);
    assert.ok(res.reason.includes('ECONNREFUSED'));
  });

  it('returns { count: null } on a non-array body', async () => {
    const _fetch = async () => ({ ok: true, status: 200, json: async () => ({ runs: [] }) });
    const res = await fetchActiveRunCount(3000, { _fetch });
    assert.equal(res.count, null);
  });

  it('returns { count: null } when no fetch implementation is available', async () => {
    // Simulate an old runtime with no global fetch (and none injected).
    const original = globalThis.fetch;
    globalThis.fetch = undefined;
    try {
      const res = await fetchActiveRunCount(3000);
      assert.equal(res.count, null);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('aborts and degrades to null when the request exceeds the timeout', async () => {
    // A fetch that rejects on abort, honoring the AbortController signal.
    const _fetch = (url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const res = await fetchActiveRunCount(3000, { _fetch, timeoutMs: 10 });
    assert.equal(res.count, null);
  });
});

// ---------------------------------------------------------------------------
// formatters
// ---------------------------------------------------------------------------

describe('formatJson()', () => {
  it('serializes the status to a single-line JSON string', () => {
    const s = buildStatus({
      running: true, pid: 7, port: 3000, version: '1.0.0',
      activeRuns: 1, dataDir: '/tmp/p',
    });
    const parsed = JSON.parse(formatJson(s));
    assert.deepEqual(parsed, s);
    assert.equal(formatJson(s).includes('\n'), false);
  });
});

describe('formatText()', () => {
  it('renders a running summary with pid/port/version/active-runs/sqlite', () => {
    const s = buildStatus({
      running: true, pid: 4242, port: 3000, version: '1.2.0',
      activeRuns: 2, dataDir: '/tmp/prism',
    });
    const txt = formatText(s);
    assert.ok(txt.includes('running'));
    assert.ok(txt.includes('4242'));
    assert.ok(txt.includes('3000'));
    assert.ok(txt.includes('1.2.0'));
    assert.ok(txt.includes('Active runs'));
    assert.ok(txt.includes(path.join('/tmp/prism', 'prism.db')));
  });

  it('renders "unknown" active runs when the API was unreachable', () => {
    const s = buildStatus({
      running: true, pid: 4242, port: 3000, version: '1.2.0',
      activeRuns: null, dataDir: '/tmp/prism',
    });
    const txt = formatText(s);
    assert.ok(txt.includes('unknown'));
    assert.ok(txt.includes('3000'));
  });

  it('renders a stopped summary with "not running" and no pid/port', () => {
    const s = buildStatus({
      running: false, pid: null, port: 3000, version: '1.2.0',
      activeRuns: null, dataDir: '/tmp/prism',
    });
    const txt = formatText(s);
    assert.ok(txt.includes('not running'));
    assert.ok(txt.includes('1.2.0'));
    assert.ok(txt.includes(path.join('/tmp/prism', 'prism.db')));
  });
});

// ---------------------------------------------------------------------------
// run() — stopped cases (no server)
// ---------------------------------------------------------------------------

describe('run() — no PID file', () => {
  it('prints "not running", exits 1, JSON has running:false', async () => {
    const dir = makeTmpDir();
    try {
      const { deps, captured } = buildDeps({ _readPidFile: () => null });
      await run({ dataDir: dir, json: true }, deps);
      const parsed = JSON.parse(captured.stdout.trim());
      assert.equal(parsed.running, false);
      assert.equal(parsed.pid, null);
      assert.equal(parsed.activeRuns, null);
      assert.equal(parsed.api, 'unreachable');
      assert.equal(captured.exitCode, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints readable "not running" text and exits 1 (no --json)', async () => {
    const dir = makeTmpDir();
    try {
      const { deps, captured } = buildDeps({ _readPidFile: () => null });
      await run({ dataDir: dir }, deps);
      assert.ok(captured.stdout.includes('not running'), `stdout: ${captured.stdout}`);
      assert.equal(captured.exitCode, 1);
      assert.equal(captured.stderr, '');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('run() — stale PID', () => {
  it('treats a dead PID as stopped and exits 1', async () => {
    const dir = makeTmpDir();
    try {
      writePid(dir, 999999999);
      const { deps, captured } = buildDeps({
        _readPidFile: (d) => readPidFile(d),
        _isPidAlive:  () => false,
      });
      await run({ dataDir: dir }, deps);
      assert.ok(captured.stdout.includes('not running'));
      assert.equal(captured.exitCode, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('run() — malformed PID file', () => {
  it('treats an unparseable PID file as stopped and exits 1', async () => {
    const dir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(dir, 'prism.pid'), 'not-a-number\n', 'utf8');
      const { deps, captured } = buildDeps({
        _readPidFile: (d) => readPidFile(d),   // real reader -> null for garbage
      });
      await run({ dataDir: dir }, deps);
      assert.ok(captured.stdout.includes('not running'));
      assert.equal(captured.exitCode, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// run() — running cases
// ---------------------------------------------------------------------------

describe('run() — PID alive + API reachable', () => {
  it('reports running, exits 0, activeRuns=N, api reachable (JSON)', async () => {
    const dir = makeTmpDir();
    try {
      writePid(dir, 12345);
      const { deps, captured } = buildDeps({
        _readPidFile:         (d) => readPidFile(d),
        _isPidAlive:          () => true,
        _fetchActiveRunCount: async () => ({ count: 3 }),
      });
      await run({ dataDir: dir, json: true }, deps);
      const parsed = JSON.parse(captured.stdout.trim());
      assert.equal(parsed.running, true);
      assert.equal(parsed.pid, 12345);
      assert.equal(parsed.activeRuns, 3);
      assert.equal(parsed.api, 'reachable');
      assert.equal(parsed.sqlitePath, path.join(dir, 'prism.db'));
      assert.equal(captured.exitCode, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a readable text summary when running', async () => {
    const dir = makeTmpDir();
    try {
      writePid(dir, 12345);
      const { deps, captured } = buildDeps({
        _readPidFile:         (d) => readPidFile(d),
        _isPidAlive:          () => true,
        _fetchActiveRunCount: async () => ({ count: 1 }),
      });
      await run({ dataDir: dir }, deps);
      assert.ok(captured.stdout.includes('running'));
      assert.ok(captured.stdout.includes('12345'));
      assert.equal(captured.exitCode, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('probes the port given via --port', async () => {
    const dir = makeTmpDir();
    try {
      writePid(dir, 12345);
      const { deps, captured } = buildDeps({
        _readPidFile:         (d) => readPidFile(d),
        _isPidAlive:          () => true,
        _fetchActiveRunCount: async () => ({ count: 0 }),
      });
      await run({ dataDir: dir, port: '8080', json: true }, deps);
      const parsed = JSON.parse(captured.stdout.trim());
      assert.equal(parsed.port, 8080);
      assert.equal(captured.exitCode, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('run() — PID alive + API unreachable', () => {
  it('reports running (exit 0) with activeRuns null and api unreachable', async () => {
    const dir = makeTmpDir();
    try {
      writePid(dir, 12345);
      const { deps, captured } = buildDeps({
        _readPidFile:         (d) => readPidFile(d),
        _isPidAlive:          () => true,
        _fetchActiveRunCount: async () => ({ count: null, reason: 'ECONNREFUSED' }),
      });
      await run({ dataDir: dir, json: true }, deps);
      const parsed = JSON.parse(captured.stdout.trim());
      assert.equal(parsed.running, true);
      assert.equal(parsed.activeRuns, null);
      assert.equal(parsed.api, 'unreachable');
      assert.equal(captured.exitCode, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('text output shows "unknown" for active runs when unreachable', async () => {
    const dir = makeTmpDir();
    try {
      writePid(dir, 12345);
      const { deps, captured } = buildDeps({
        _readPidFile:         (d) => readPidFile(d),
        _isPidAlive:          () => true,
        _fetchActiveRunCount: async () => ({ count: null }),
      });
      await run({ dataDir: dir }, deps);
      assert.ok(captured.stdout.includes('unknown'), `stdout: ${captured.stdout}`);
      assert.equal(captured.exitCode, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// CLI integration smoke test — `prism status` appears in --help output
// ---------------------------------------------------------------------------

describe('cli.js --help', () => {
  const { spawnSync } = require('child_process');
  const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

  it('--help output mentions "status"', () => {
    const result = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes('status'), 'help output must mention "status"');
  });
});
