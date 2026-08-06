'use strict';

/**
 * Tests for MODEL-3 base — cliAdapters (pluggable CLI-harness adapter registry).
 * node:test + assert
 */

const { describe, it } = require('node:test');
const assert           = require('node:assert/strict');

const cliAdapters = require('../src/services/cliAdapters');

// ---------------------------------------------------------------------------
// Registry lookup
// ---------------------------------------------------------------------------

describe('getAdapter', () => {
  it('returns the claude adapter by default (undefined cliTool)', () => {
    assert.equal(cliAdapters.getAdapter(undefined).name, 'claude');
    assert.equal(cliAdapters.getAdapter(null).name, 'claude');
  });

  it('returns the claude adapter for "claude"', () => {
    assert.equal(cliAdapters.getAdapter('claude').name, 'claude');
  });

  it('returns the opencode adapter for "opencode"', () => {
    assert.equal(cliAdapters.getAdapter('opencode').name, 'opencode');
  });

  it('throws CLI_ADAPTER_NOT_FOUND for an unknown cliTool', () => {
    assert.throws(() => cliAdapters.getAdapter('unknown-tool'), /CLI_ADAPTER_NOT_FOUND:unknown-tool/);
  });
});

describe('ADAPTERS', () => {
  it('registers claude and opencode', () => {
    assert.ok(cliAdapters.ADAPTERS.claude, 'claude adapter present');
    assert.ok(cliAdapters.ADAPTERS.opencode, 'opencode adapter present');
  });
});

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

describe('adapter contract', () => {
  it('each adapter exposes the full harness interface', () => {
    for (const name of ['claude', 'opencode']) {
      const a = cliAdapters.getAdapter(name);
      assert.equal(typeof a.resolveBinary, 'function', `${name}: resolveBinary`);
      assert.equal(typeof a.buildUnixCommand, 'function', `${name}: buildUnixCommand`);
      assert.equal(typeof a.buildWindowsCommand, 'function', `${name}: buildWindowsCommand`);
      assert.equal(typeof a.metaSource, 'function', `${name}: metaSource`);
      assert.equal(typeof a.needsPromptFile, 'boolean', `${name}: needsPromptFile`);
    }
  });

  it('claude does not need a prompt file; opencode does', () => {
    assert.equal(cliAdapters.getAdapter('claude').needsPromptFile, false);
    assert.equal(cliAdapters.getAdapter('opencode').needsPromptFile, true);
  });
});

// ---------------------------------------------------------------------------
// registerAdapter (dynamic harness extension)
// ---------------------------------------------------------------------------

describe('registerAdapter', () => {
  it('registers a new adapter and getAdapter returns it', () => {
    cliAdapters.registerAdapter('test-harness', {
      name:            'test-harness',
      needsPromptFile: false,
      resolveBinary() { return '/fake/test-harness'; },
      buildUnixCommand() { return 'echo test'; },
      buildWindowsCommand() { return 'echo test'; },
      metaSource() { return 'plain'; },
    });
    assert.equal(cliAdapters.getAdapter('test-harness').resolveBinary(), '/fake/test-harness');
  });

  it('rejects invalid registrations', () => {
    assert.throws(() => cliAdapters.registerAdapter('', {}), /non-empty string/);
    assert.throws(() => cliAdapters.registerAdapter('x', null), /must be an object/);
  });
});

// ---------------------------------------------------------------------------
// Sentinel wrappers
// ---------------------------------------------------------------------------

describe('wrapUnixSentinel', () => {
  it('includes the EXIT trap, DONE var, and cli line', () => {
    const cmd = cliAdapters.wrapUnixSentinel('claude -p hi', '/tmp/s.done');
    assert.ok(cmd.includes("_DONE='/tmp/s.done'"));
    assert.ok(cmd.includes('trap'));
    assert.ok(cmd.includes('claude -p hi'));
    assert.ok(cmd.includes('_EXIT=$?'));
  });

  it('injects preDoneLine after the cli line when provided', () => {
    const cmd = cliAdapters.wrapUnixSentinel('claude -p hi', '/tmp/s.done', 'pkill -f x');
    assert.ok(cmd.includes('claude -p hi'));
    assert.ok(cmd.includes('pkill -f x'));
    const cliIdx = cmd.indexOf('claude -p hi');
    const preIdx = cmd.indexOf('pkill -f x');
    assert.ok(preIdx > cliIdx, 'preDoneLine should come after the cli line');
  });
});

describe('wrapWindowsSentinel', () => {
  it('includes the cli line and done-file write', () => {
    const cmd = cliAdapters.wrapWindowsSentinel('claude -p hi', 'C:\\tmp\\s.done');
    assert.ok(cmd.includes('claude -p hi'));
    assert.ok(cmd.includes('if not exist'));
    assert.ok(cmd.includes('exit /B 0'));
  });
});
