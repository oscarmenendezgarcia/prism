'use strict';

/**
 * tests/doctor.test.js — Unit + integration tests for `prism doctor`.
 *
 * Coverage:
 *   - src/utils/doctor/checks.js  — every check function, pass + fail
 *   - bin/doctor.js               — formatText, formatJson
 *   - bin/cli.js (integration)    — `prism doctor --json` exit code + shape
 *
 * Run with: node --test tests/doctor.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert                           = require('node:assert/strict');
const path                             = require('path');
const fs                               = require('fs');
const os                               = require('os');
const { spawnSync }                    = require('child_process');

const {
  checkNodeVersion,
  checkSpawnHelperExecutable,
  checkBetterSqlite3,
  checkClaudeCli,
  checkDataDirWritable,
  checkServerStatus,
  CHECKS,
} = require(path.join(__dirname, '..', 'src', 'utils', 'doctor', 'checks.js'));

const { formatText, formatJson } = require(path.join(__dirname, '..', 'bin', 'doctor.js'));

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-doctor-test-'));
}

function makeCtx(overrides = {}) {
  return {
    env:         process.env,
    packageRoot: path.resolve(__dirname, '..'),
    dataDir:     os.tmpdir(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. checkNodeVersion
// ---------------------------------------------------------------------------

describe('checkNodeVersion', () => {
  it('passes when major >= 20', () => {
    const result = checkNodeVersion(makeCtx({ deps: { nodeVersion: '23.9.0' } }));
    assert.equal(result.status, 'pass');
    assert.ok(result.message.includes('23.9.0'));
    assert.equal(result.name, 'node-version');
  });

  it('passes on boundary version 20.0.0', () => {
    const result = checkNodeVersion(makeCtx({ deps: { nodeVersion: '20.0.0' } }));
    assert.equal(result.status, 'pass');
  });

  it('fails when major < 20', () => {
    const result = checkNodeVersion(makeCtx({ deps: { nodeVersion: '18.17.0' } }));
    assert.equal(result.status, 'fail');
    assert.ok(result.message.includes('18.17.0'));
    assert.ok(result.message.includes('< 20'));
  });

  it('fails on Node 16', () => {
    const result = checkNodeVersion(makeCtx({ deps: { nodeVersion: '16.20.2' } }));
    assert.equal(result.status, 'fail');
  });

  it('uses real process.versions.node when no stub provided', () => {
    const result = checkNodeVersion(makeCtx());
    // The test environment runs Node 20+
    assert.equal(result.status, 'pass');
  });
});

// ---------------------------------------------------------------------------
// 2. checkSpawnHelperExecutable
// ---------------------------------------------------------------------------

describe('checkSpawnHelperExecutable', () => {
  it('passes on Windows (N/A)', () => {
    const result = checkSpawnHelperExecutable(makeCtx({ deps: { platform: 'win32', arch: 'x64' } }));
    assert.equal(result.status, 'pass');
    assert.ok(result.message.includes('N/A'));
  });

  it('passes when spawn-helper is absent (not installed)', () => {
    // Point packageRoot at a temp dir with no node_modules
    const tmp = makeTmp();
    try {
      const result = checkSpawnHelperExecutable(makeCtx({
        packageRoot: tmp,
        deps: { platform: 'linux', arch: 'x64' },
      }));
      assert.equal(result.status, 'pass');
      assert.ok(result.message.includes('absent'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('passes when spawn-helper exists and has executable bit', () => {
    const tmp = makeTmp();
    try {
      const helperDir = path.join(tmp, 'node_modules', 'node-pty', 'prebuilds', 'linux-x64');
      fs.mkdirSync(helperDir, { recursive: true });
      const helperPath = path.join(helperDir, 'spawn-helper');
      fs.writeFileSync(helperPath, '#!/bin/sh\n');
      fs.chmodSync(helperPath, 0o755);

      const result = checkSpawnHelperExecutable(makeCtx({
        packageRoot: tmp,
        deps: { platform: 'linux', arch: 'x64' },
      }));
      assert.equal(result.status, 'pass');
      assert.ok(result.message.includes('+x'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails when spawn-helper exists but lacks executable bit', () => {
    const tmp = makeTmp();
    try {
      const helperDir = path.join(tmp, 'node_modules', 'node-pty', 'prebuilds', 'linux-x64');
      fs.mkdirSync(helperDir, { recursive: true });
      const helperPath = path.join(helperDir, 'spawn-helper');
      fs.writeFileSync(helperPath, '#!/bin/sh\n');
      fs.chmodSync(helperPath, 0o644); // no execute bit

      const result = checkSpawnHelperExecutable(makeCtx({
        packageRoot: tmp,
        deps: { platform: 'linux', arch: 'x64' },
      }));
      assert.equal(result.status, 'fail');
      assert.ok(result.message.includes('not executable'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('uses injected fs stub for statSync', () => {
    // Stub fs so accessSync succeeds and statSync returns non-executable mode
    const stubFs = {
      constants: fs.constants,
      accessSync: () => undefined, // file "exists"
      statSync:   () => ({ mode: 0o644 }),
    };
    const result = checkSpawnHelperExecutable(makeCtx({
      packageRoot: '/fake',
      deps: { platform: 'linux', arch: 'x64', fs: stubFs },
    }));
    assert.equal(result.status, 'fail');
  });
});

// ---------------------------------------------------------------------------
// 3. checkBetterSqlite3
// ---------------------------------------------------------------------------

describe('checkBetterSqlite3', () => {
  it('passes with real better-sqlite3 (dependency must be installed)', () => {
    const result = checkBetterSqlite3(makeCtx());
    assert.equal(result.status, 'pass');
    assert.ok(result.message.includes(':memory:'));
  });

  it('fails when requireSqlite throws (native binary broken simulation)', () => {
    const ctx = makeCtx({
      deps: { requireSqlite: () => { throw new Error('Module not found: better-sqlite3.node'); } },
    });
    const result = checkBetterSqlite3(ctx);
    assert.equal(result.status, 'fail');
    assert.ok(result.message.includes('Module not found'));
  });

  it('fails when Database constructor throws', () => {
    const ctx = makeCtx({
      deps: {
        requireSqlite: () => {
          // Return a class whose constructor throws
          return class BadDatabase {
            constructor() { throw new Error('ABI mismatch'); }
          };
        },
      },
    });
    const result = checkBetterSqlite3(ctx);
    assert.equal(result.status, 'fail');
    assert.ok(result.message.includes('ABI mismatch'));
  });

  it('result name is "better-sqlite3"', () => {
    const result = checkBetterSqlite3(makeCtx());
    assert.equal(result.name, 'better-sqlite3');
  });
});

// ---------------------------------------------------------------------------
// 4. checkClaudeCli
// ---------------------------------------------------------------------------

describe('checkClaudeCli', () => {
  it('passes when spawnSync returns status 0 and a version string', () => {
    const ctx = makeCtx({
      deps: {
        spawnSync: () => ({ status: 0, stdout: '1.2.3 (Claude Code)\n', stderr: '', error: null }),
      },
    });
    const result = checkClaudeCli(ctx);
    assert.equal(result.status, 'pass');
    assert.ok(result.message.includes('1.2.3'));
  });

  it('fails when spawnSync returns status 127 (not found)', () => {
    const ctx = makeCtx({
      deps: {
        spawnSync: () => ({ status: 127, stdout: '', stderr: 'not found', error: null }),
      },
    });
    const result = checkClaudeCli(ctx);
    assert.equal(result.status, 'fail');
    assert.ok(result.message.includes('127'));
  });

  it('fails on ENOENT error (binary not in PATH)', () => {
    const ctx = makeCtx({
      deps: {
        spawnSync: () => ({
          status: null,
          stdout: '',
          stderr: '',
          error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
        }),
      },
    });
    const result = checkClaudeCli(ctx);
    assert.equal(result.status, 'fail');
    assert.ok(result.message.toLowerCase().includes('not found'));
  });

  it('fails on ETIMEDOUT error (process hangs)', () => {
    const ctx = makeCtx({
      deps: {
        spawnSync: () => ({
          status: null,
          stdout: '',
          stderr: '',
          error: Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }),
        }),
      },
    });
    const result = checkClaudeCli(ctx);
    assert.equal(result.status, 'fail');
    assert.ok(result.message.includes('timed out'));
  });

  it('fails on non-zero non-127 exit code', () => {
    const ctx = makeCtx({
      deps: {
        spawnSync: () => ({ status: 1, stdout: '', stderr: 'error', error: null }),
      },
    });
    const result = checkClaudeCli(ctx);
    assert.equal(result.status, 'fail');
  });

  it('result name is "claude-cli"', () => {
    const ctx = makeCtx({
      deps: { spawnSync: () => ({ status: 0, stdout: '1.0.0', error: null }) },
    });
    assert.equal(checkClaudeCli(ctx).name, 'claude-cli');
  });
});

// ---------------------------------------------------------------------------
// 5. checkDataDirWritable
// ---------------------------------------------------------------------------

describe('checkDataDirWritable', () => {
  it('passes for a writable temp directory', () => {
    const tmp = makeTmp();
    try {
      const result = checkDataDirWritable(makeCtx({ dataDir: tmp }));
      assert.equal(result.status, 'pass');
      assert.ok(result.message.includes(tmp));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('passes and creates dir when it does not exist yet', () => {
    const tmp  = makeTmp();
    const sub  = path.join(tmp, 'new-sub-dir');
    try {
      const result = checkDataDirWritable(makeCtx({ dataDir: sub }));
      assert.equal(result.status, 'pass');
      assert.ok(fs.existsSync(sub), 'directory should have been created');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails for a read-only directory (chmod 0o500)', function () {
    // Skip on root (where chmod is ignored) or CI environments that might not respect perms
    if (process.getuid && process.getuid() === 0) {
      this.skip('running as root — chmod restrictions not enforced');
      return;
    }
    const tmp = makeTmp();
    try {
      fs.chmodSync(tmp, 0o500); // read + execute, no write
      const result = checkDataDirWritable(makeCtx({ dataDir: tmp }));
      assert.equal(result.status, 'fail');
    } finally {
      fs.chmodSync(tmp, 0o700);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails when mkdirSync throws via stub', () => {
    const stubFs = {
      constants: { W_OK: fs.constants.W_OK },
      mkdirSync: () => { throw new Error('EROFS: read-only file system'); },
      accessSync: () => undefined,
    };
    const result = checkDataDirWritable(makeCtx({ deps: { fs: stubFs } }));
    assert.equal(result.status, 'fail');
    assert.ok(result.message.includes('EROFS'));
  });

  it('result name is "data-dir-writable"', () => {
    const tmp = makeTmp();
    try {
      assert.equal(checkDataDirWritable(makeCtx({ dataDir: tmp })).name, 'data-dir-writable');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 6. checkServerStatus
// ---------------------------------------------------------------------------

describe('checkServerStatus', () => {
  it('passes with message "stopped" when prism.pid is absent', () => {
    const tmp = makeTmp();
    try {
      const result = checkServerStatus(makeCtx({ dataDir: tmp }));
      assert.equal(result.status, 'pass');
      assert.ok(result.message.includes('stopped'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('passes with "server running" when pid file points to this process', () => {
    const tmp = makeTmp();
    try {
      fs.writeFileSync(path.join(tmp, 'prism.pid'), String(process.pid));
      const result = checkServerStatus(makeCtx({ dataDir: tmp }));
      assert.equal(result.status, 'pass');
      assert.ok(result.message.includes('server running'));
      assert.ok(result.message.includes(String(process.pid)));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails with "stale pid file" when pid file points to a dead PID', () => {
    const tmp        = makeTmp();
    const bogus_pid  = 2; // PID 2 should not be kill()'able from user-space; we stub it
    try {
      fs.writeFileSync(path.join(tmp, 'prism.pid'), String(bogus_pid));
      const ctx = makeCtx({
        dataDir: tmp,
        deps: {
          processKill: (pid, sig) => {
            if (sig === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
          },
        },
      });
      const result = checkServerStatus(ctx);
      assert.equal(result.status, 'fail');
      assert.ok(result.message.includes('stale pid file'));
      assert.ok(result.message.includes(String(bogus_pid)));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails when pid file contains invalid content', () => {
    const tmp = makeTmp();
    try {
      fs.writeFileSync(path.join(tmp, 'prism.pid'), 'not-a-number');
      const result = checkServerStatus(makeCtx({ dataDir: tmp }));
      assert.equal(result.status, 'fail');
      assert.ok(result.message.includes('invalid pid'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails when reading pid file throws a non-ENOENT error via stub', () => {
    const stubFs = {
      constants: fs.constants,
      readFileSync: () => { throw Object.assign(new Error('EIO: input/output error'), { code: 'EIO' }); },
    };
    const result = checkServerStatus(makeCtx({ deps: { fs: stubFs } }));
    assert.equal(result.status, 'fail');
    assert.ok(result.message.includes('EIO'));
  });

  it('result name is "server-status"', () => {
    const tmp = makeTmp();
    try {
      assert.equal(checkServerStatus(makeCtx({ dataDir: tmp })).name, 'server-status');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 7. CHECKS array
// ---------------------------------------------------------------------------

describe('CHECKS array', () => {
  it('contains exactly 6 check functions', () => {
    assert.equal(CHECKS.length, 6);
  });

  it('every entry is a function', () => {
    for (const fn of CHECKS) {
      assert.equal(typeof fn, 'function');
    }
  });

  it('all checks return valid result shapes given a real ctx', () => {
    const tmp = makeTmp();
    try {
      const ctx = makeCtx({ dataDir: tmp });
      for (const fn of CHECKS) {
        const r = fn(ctx);
        assert.ok(typeof r.name    === 'string' && r.name.length > 0,    `${fn.name}: name missing`);
        assert.ok(r.status === 'pass' || r.status === 'fail',             `${fn.name}: bad status`);
        assert.ok(typeof r.message === 'string' && r.message.length > 0, `${fn.name}: message missing`);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 8. formatText / formatJson (bin/doctor.js)
// ---------------------------------------------------------------------------

describe('formatText', () => {
  const passingResults = [
    { name: 'node-version',     status: 'pass', message: 'v23.9.0 (>= 20)' },
    { name: 'spawn-helper',     status: 'pass', message: 'executable (+x)' },
    { name: 'better-sqlite3',   status: 'pass', message: 'loads and opens :memory:' },
    { name: 'claude-cli',       status: 'pass', message: '1.2.3' },
    { name: 'data-dir-writable', status: 'pass', message: '/tmp/data' },
    { name: 'server-status',    status: 'pass', message: 'stopped' },
  ];
  const mixedResults = [
    ...passingResults.slice(0, 5),
    { name: 'server-status', status: 'fail', message: 'stale pid file (pid 9999 not alive)' },
  ];

  it('includes the header line', () => {
    assert.ok(formatText(passingResults).includes('prism doctor'));
  });

  it('prints "N/M checks passed." when all pass', () => {
    assert.ok(formatText(passingResults).includes('6/6 checks passed.'));
  });

  it('prints "N/M checks passed — K failed." on partial failure', () => {
    const out = formatText(mixedResults);
    assert.ok(out.includes('5/6 checks passed'));
    assert.ok(out.includes('1 failed'));
  });

  it('includes check names in output', () => {
    const out = formatText(passingResults);
    assert.ok(out.includes('node-version'));
    assert.ok(out.includes('claude-cli'));
  });

  it('includes check messages in output', () => {
    const out = formatText(passingResults);
    assert.ok(out.includes('v23.9.0'));
    assert.ok(out.includes('loads and opens :memory:'));
  });
});

describe('formatJson', () => {
  const results = [
    { name: 'node-version', status: 'pass', message: 'v23.9.0 (>= 20)' },
    { name: 'claude-cli',   status: 'fail', message: 'not found in PATH' },
  ];

  it('produces valid JSON', () => {
    const json = JSON.parse(formatJson(false, results));
    assert.equal(typeof json.ok, 'boolean');
    assert.ok(Array.isArray(json.checks));
  });

  it('sets ok=true when all pass', () => {
    const passing = [{ name: 'x', status: 'pass', message: 'ok' }];
    assert.equal(JSON.parse(formatJson(true, passing)).ok, true);
  });

  it('sets ok=false on failure', () => {
    assert.equal(JSON.parse(formatJson(false, results)).ok, false);
  });

  it('includes all check names in JSON output', () => {
    const json = JSON.parse(formatJson(false, results));
    const names = json.checks.map(c => c.name);
    assert.ok(names.includes('node-version'));
    assert.ok(names.includes('claude-cli'));
  });
});

// ---------------------------------------------------------------------------
// 9. Integration — bin/cli.js doctor --json
// ---------------------------------------------------------------------------

describe('integration: prism doctor --json', () => {
  function runCli(args, env = {}) {
    return spawnSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      timeout:  10000,
      env: { ...process.env, ...env },
    });
  }

  it('exits 0 and produces valid JSON in a healthy environment', () => {
    const tmp    = makeTmp();
    try {
      const result = runCli(['doctor', '--json', '--data-dir', tmp]);
      // May exit 0 or 1 depending on whether claude CLI is installed.
      // The critical assertion is that stdout is valid JSON with the correct shape.
      const json = JSON.parse(result.stdout.trim());
      assert.equal(typeof json.ok, 'boolean');
      assert.ok(Array.isArray(json.checks), 'checks must be an array');
      assert.equal(json.checks.length, 6, 'must have exactly 6 checks');

      for (const check of json.checks) {
        assert.ok(typeof check.name    === 'string', `name must be string in ${JSON.stringify(check)}`);
        assert.ok(check.status === 'pass' || check.status === 'fail');
        assert.ok(typeof check.message === 'string');
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('exit code matches ok field: 0 when ok=true, 1 when ok=false', () => {
    const tmp = makeTmp();
    try {
      const result = runCli(['doctor', '--json', '--data-dir', tmp]);
      const json   = JSON.parse(result.stdout.trim());
      const expectedExit = json.ok ? 0 : 1;
      assert.equal(result.status, expectedExit);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('node-version check always passes (we are on Node 20+)', () => {
    const tmp = makeTmp();
    try {
      const result = runCli(['doctor', '--json', '--data-dir', tmp]);
      const json   = JSON.parse(result.stdout.trim());
      const nvCheck = json.checks.find(c => c.name === 'node-version');
      assert.ok(nvCheck, 'node-version check should be present');
      assert.equal(nvCheck.status, 'pass');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('data-dir-writable check passes for --data-dir pointing to tmp dir', () => {
    const tmp = makeTmp();
    try {
      const result = runCli(['doctor', '--json', '--data-dir', tmp]);
      const json   = JSON.parse(result.stdout.trim());
      const wCheck = json.checks.find(c => c.name === 'data-dir-writable');
      assert.ok(wCheck, 'data-dir-writable check should be present');
      assert.equal(wCheck.status, 'pass');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('server-status is "stopped" when no prism.pid exists in --data-dir', () => {
    const tmp = makeTmp();
    try {
      const result = runCli(['doctor', '--json', '--data-dir', tmp]);
      const json   = JSON.parse(result.stdout.trim());
      const ssCheck = json.checks.find(c => c.name === 'server-status');
      assert.ok(ssCheck, 'server-status check should be present');
      assert.equal(ssCheck.status, 'pass');
      assert.ok(ssCheck.message.includes('stopped'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('text output contains the header line', () => {
    const tmp = makeTmp();
    try {
      const result = runCli(['doctor', '--data-dir', tmp, '--no-update-check'],
        { NO_COLOR: '1' });
      assert.ok(result.stdout.includes('prism doctor'), `stdout: ${result.stdout}`);
      assert.ok(result.stdout.includes('checks passed'), `stdout: ${result.stdout}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('doctor subcommand appears in --help output', () => {
    const result = runCli(['--help']);
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes('doctor'), 'help should list doctor subcommand');
  });
});
