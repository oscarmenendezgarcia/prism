'use strict';

/**
 * Shared test doubles for the `prism run` / `prism run <runId> logs` CLI
 * unit tests (tests/cli.run.test.js, tests/cli.run-logs.test.js).
 */

function bufWriter(isTTY = false) {
  const chunks = [];
  return {
    write: (s) => { chunks.push(String(s)); return true; },
    text:  () => chunks.join(''),
    isTTY,
  };
}

/**
 * Build a deps object with buffered _stdout/_stderr, a capturing _exit, and
 * a fake _resolveDataDir. `over` is merged on top so callers can supply
 * command-specific defaults (e.g. _listRuns, _resolveRun) and per-test
 * overrides in one call.
 */
function mockDeps(over = {}) {
  const stdout = bufWriter();
  const stderr = bufWriter();
  const exits  = [];
  return {
    _stdout: stdout,
    _stderr: stderr,
    _exit:   (n) => exits.push(n),
    _resolveDataDir: () => ({ path: '/tmp/fake-data', mode: 'env' }),
    ...over,
    // expose captured state
    _captured: { stdout, stderr, exits },
  };
}

module.exports = { bufWriter, mockDeps };
