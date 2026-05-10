'use strict';

/**
 * tests/update.test.js — Unit tests for bin/update.js
 *
 * Tests: already up to date, update available + confirm, decline,
 * non-TTY auto-confirm, npm failure, network failure.
 *
 * All external I/O is injected via flags._fetchFn, flags._spawnSync,
 * flags._isTTY, flags._inputStream, flags._exit.
 */

const { describe, it } = require('node:test');
const assert            = require('node:assert/strict');
const { Readable }      = require('stream');
const { run }           = require('../bin/update.js');

const { version: installedVersion } = require('../package.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock fetch that resolves with the given version string.
 */
function mockFetch(version) {
  return async () => ({
    json: async () => ({ version }),
  });
}

/**
 * Build a mock fetch that rejects immediately.
 */
function failFetch() {
  return () => Promise.reject(new Error('network error'));
}

/**
 * Build a mock spawnSync that returns a result object.
 */
function mockSpawn(status = 0) {
  return () => ({ status, pid: 12345 });
}

/**
 * Capture stdout and stderr during an async call.
 */
async function captureOutput(fn) {
  const stdout = [];
  const stderr = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => { stdout.push(chunk); return true; };
  process.stderr.write = (chunk) => { stderr.push(chunk); return true; };
  try {
    await fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return { stdout: stdout.join(''), stderr: stderr.join('') };
}

/**
 * Create a readable stream that emits a single line.
 */
function makeInputStream(line) {
  const stream = new Readable({ read() {} });
  stream.push(line + '\n');
  stream.push(null);
  return stream;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bin/update.js — run()', () => {

  // -------------------------------------------------------------------------
  // Already up to date
  // -------------------------------------------------------------------------
  it('prints "ya está en la última versión" and exits 0 when already up to date', async () => {
    let exitCode;
    const { stdout } = await captureOutput(() =>
      run({
        _fetchFn:    mockFetch(installedVersion),
        _spawnSync:  mockSpawn(0),
        _isTTY:      false,
        _exit:       code => { exitCode = code; },
      })
    );
    assert.equal(exitCode, 0, `expected exit 0, got ${exitCode}`);
    assert.ok(
      stdout.includes('ya está en la última versión'),
      `expected up-to-date message, got: ${stdout}`
    );
    assert.ok(stdout.includes(installedVersion), `expected version in message, got: ${stdout}`);
  });

  // -------------------------------------------------------------------------
  // Update available — user confirms (TTY)
  // -------------------------------------------------------------------------
  it('calls spawnSync with npm install when user confirms with "y"', async () => {
    const spawnCalls = [];
    let exitCode;

    await captureOutput(() =>
      run({
        _fetchFn:    mockFetch('99.9.9'),
        _spawnSync:  (...args) => { spawnCalls.push(args); return { status: 0 }; },
        _isTTY:      true,
        _inputStream: makeInputStream('y'),
        _exit:       code => { exitCode = code; },
      })
    );

    assert.equal(spawnCalls.length, 1, 'spawnSync should be called once');
    const [cmd, args, opts] = spawnCalls[0];
    assert.equal(cmd, 'npm');
    assert.deepEqual(args, ['install', '-g', 'prism-kanban@latest']);
    assert.equal(opts.stdio, 'inherit');
    assert.equal(exitCode, 0);
  });

  it('calls spawnSync when user confirms with "yes"', async () => {
    const spawnCalls = [];
    let exitCode;

    await captureOutput(() =>
      run({
        _fetchFn:    mockFetch('99.9.9'),
        _spawnSync:  (...args) => { spawnCalls.push(args); return { status: 0 }; },
        _isTTY:      true,
        _inputStream: makeInputStream('yes'),
        _exit:       code => { exitCode = code; },
      })
    );

    assert.equal(spawnCalls.length, 1);
    assert.equal(exitCode, 0);
  });

  it('calls spawnSync when user confirms with "Y" (uppercase)', async () => {
    const spawnCalls = [];
    let exitCode;

    await captureOutput(() =>
      run({
        _fetchFn:    mockFetch('99.9.9'),
        _spawnSync:  (...args) => { spawnCalls.push(args); return { status: 0 }; },
        _isTTY:      true,
        _inputStream: makeInputStream('Y'),
        _exit:       code => { exitCode = code; },
      })
    );

    assert.equal(spawnCalls.length, 1);
    assert.equal(exitCode, 0);
  });

  // -------------------------------------------------------------------------
  // Update available — user declines (TTY)
  // -------------------------------------------------------------------------
  it('prints "Cancelado." and exits 0 when user declines with "n"', async () => {
    const spawnCalls = [];
    let exitCode;

    const { stdout } = await captureOutput(() =>
      run({
        _fetchFn:    mockFetch('99.9.9'),
        _spawnSync:  (...args) => { spawnCalls.push(args); return { status: 0 }; },
        _isTTY:      true,
        _inputStream: makeInputStream('n'),
        _exit:       code => { exitCode = code; },
      })
    );

    assert.equal(spawnCalls.length, 0, 'spawnSync should NOT be called when user declines');
    assert.ok(stdout.includes('Cancelado.'), `expected "Cancelado.", got: ${stdout}`);
    assert.equal(exitCode, 0);
  });

  it('prints "Cancelado." and exits 0 when user just presses Enter (default N)', async () => {
    const spawnCalls = [];
    let exitCode;

    const { stdout } = await captureOutput(() =>
      run({
        _fetchFn:    mockFetch('99.9.9'),
        _spawnSync:  (...args) => { spawnCalls.push(args); return { status: 0 }; },
        _isTTY:      true,
        _inputStream: makeInputStream(''),
        _exit:       code => { exitCode = code; },
      })
    );

    assert.equal(spawnCalls.length, 0);
    assert.ok(stdout.includes('Cancelado.'));
    assert.equal(exitCode, 0);
  });

  // -------------------------------------------------------------------------
  // Non-TTY auto-confirm
  // -------------------------------------------------------------------------
  it('auto-confirms and calls spawnSync in non-TTY mode', async () => {
    const spawnCalls = [];
    let exitCode;

    await captureOutput(() =>
      run({
        _fetchFn:    mockFetch('99.9.9'),
        _spawnSync:  (...args) => { spawnCalls.push(args); return { status: 0 }; },
        _isTTY:      false,
        _exit:       code => { exitCode = code; },
      })
    );

    assert.equal(spawnCalls.length, 1, 'spawnSync should be called in non-TTY mode');
    assert.equal(exitCode, 0);
  });

  // -------------------------------------------------------------------------
  // Success message
  // -------------------------------------------------------------------------
  it('prints "✓ Actualizado a vX.Y.Z" on successful npm install', async () => {
    let exitCode;
    const { stdout } = await captureOutput(() =>
      run({
        _fetchFn:    mockFetch('99.9.9'),
        _spawnSync:  mockSpawn(0),
        _isTTY:      false,
        _exit:       code => { exitCode = code; },
      })
    );

    assert.ok(stdout.includes('✓ Actualizado a v99.9.9'), `expected success message, got: ${stdout}`);
    assert.equal(exitCode, 0);
  });

  // -------------------------------------------------------------------------
  // npm failure
  // -------------------------------------------------------------------------
  it('prints error and exits 1 when npm install returns non-zero exit code', async () => {
    let exitCode;
    const { stderr } = await captureOutput(() =>
      run({
        _fetchFn:    mockFetch('99.9.9'),
        _spawnSync:  mockSpawn(1),
        _isTTY:      false,
        _exit:       code => { exitCode = code; },
      })
    );

    assert.equal(exitCode, 1, `expected exit 1, got ${exitCode}`);
    assert.ok(stderr.includes('npm install falló'), `expected npm error message, got: ${stderr}`);
    assert.ok(stderr.includes('1'), `expected exit code 1 in message, got: ${stderr}`);
  });

  it('prints error and exits 1 when npm install returns exit code 127', async () => {
    let exitCode;
    const { stderr } = await captureOutput(() =>
      run({
        _fetchFn:    mockFetch('99.9.9'),
        _spawnSync:  mockSpawn(127),
        _isTTY:      false,
        _exit:       code => { exitCode = code; },
      })
    );

    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('127'));
  });

  // -------------------------------------------------------------------------
  // Network failure
  // -------------------------------------------------------------------------
  it('prints network error and exits 1 when fetch fails', async () => {
    let exitCode;
    const { stderr } = await captureOutput(() =>
      run({
        _fetchFn:    failFetch(),
        _spawnSync:  mockSpawn(0),
        _isTTY:      false,
        _exit:       code => { exitCode = code; },
      })
    );

    assert.equal(exitCode, 1, `expected exit 1, got ${exitCode}`);
    assert.ok(
      stderr.includes('no se pudo obtener la versión'),
      `expected network error message, got: ${stderr}`
    );
  });

  // -------------------------------------------------------------------------
  // Prompt formatting
  // -------------------------------------------------------------------------
  it('prints the confirmation prompt with installed and latest versions', async () => {
    const spawnCalls = [];
    let exitCode;

    const { stdout } = await captureOutput(() =>
      run({
        _fetchFn:    mockFetch('99.9.9'),
        _spawnSync:  (...args) => { spawnCalls.push(args); return { status: 0 }; },
        _isTTY:      true,
        _inputStream: makeInputStream('n'),
        _exit:       code => { exitCode = code; },
      })
    );

    assert.ok(
      stdout.includes(`v${installedVersion}`),
      `expected installed version in prompt, got: ${stdout}`
    );
    assert.ok(stdout.includes('v99.9.9'), `expected latest version in prompt, got: ${stdout}`);
    assert.ok(stdout.includes('[y/N]'), `expected [y/N] in prompt, got: ${stdout}`);
  });
});
