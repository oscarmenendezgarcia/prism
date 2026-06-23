'use strict';

/**
 * Tests for MODEL-1 — CliAdapter
 * node:test + assert
 */

const { describe, it } = require('node:test');
const assert           = require('node:assert/strict');

const {
  shellEscape,
  cmdEscape,
  buildUnixShellCommand,
  buildWindowsShellCommand,
} = require('../src/services/cliAdapter');

// ---------------------------------------------------------------------------
// shellEscape
// ---------------------------------------------------------------------------

describe('shellEscape', () => {
  it('wraps a simple string in single quotes', () => {
    assert.equal(shellEscape('hello'), "'hello'");
  });

  it('escapes embedded single quotes', () => {
    assert.equal(shellEscape("it's"), "'it'\\''s'");
  });

  it('handles empty string', () => {
    assert.equal(shellEscape(''), "''");
  });
});

// ---------------------------------------------------------------------------
// cmdEscape
// ---------------------------------------------------------------------------

describe('cmdEscape', () => {
  it('wraps a simple string in double quotes', () => {
    assert.equal(cmdEscape('hello'), '"hello"');
  });

  it('escapes embedded double quotes', () => {
    assert.equal(cmdEscape('say "hi"'), '"say ""hi"""');
  });
});

// ---------------------------------------------------------------------------
// buildUnixShellCommand
// ---------------------------------------------------------------------------

describe('buildUnixShellCommand', () => {
  const opts = {
    binary:     '/usr/local/bin/claude',
    finalArgs:  ['--permission-mode', 'bypassPermissions'],
    promptPath: '/tmp/prompt.txt',
    logPath:    '/tmp/stage-0.log',
    doneFile:   '/tmp/stage-0.done',
  };

  it('produces a semicolon-separated sh command string', () => {
    const cmd = buildUnixShellCommand(opts);
    assert.ok(typeof cmd === 'string');
    const parts = cmd.split('; ');
    assert.equal(parts.length, 5);
  });

  it('starts with _DONE assignment', () => {
    const cmd = buildUnixShellCommand(opts);
    assert.ok(cmd.startsWith('_DONE='));
  });

  it('includes the EXIT trap', () => {
    const cmd = buildUnixShellCommand(opts);
    assert.ok(cmd.includes("trap '"));
    assert.ok(cmd.includes('EXIT'));
  });

  it('includes the binary path', () => {
    const cmd = buildUnixShellCommand(opts);
    assert.ok(cmd.includes('/usr/local/bin/claude'));
  });

  it('includes prompt redirection (< promptPath)', () => {
    const cmd = buildUnixShellCommand(opts);
    assert.ok(cmd.includes('< '));
    assert.ok(cmd.includes('/tmp/prompt.txt'));
  });

  it('ends with _EXIT=$?', () => {
    const cmd = buildUnixShellCommand(opts);
    assert.ok(cmd.endsWith('_EXIT=$?'));
  });

  it('includes the done file path', () => {
    const cmd = buildUnixShellCommand(opts);
    assert.ok(cmd.includes('/tmp/stage-0.done'));
  });

  it('escapes args with single quotes', () => {
    const cmd = buildUnixShellCommand({ ...opts, finalArgs: ['--model', 'claude-opus-4-5'] });
    assert.ok(cmd.includes("'--model'"));
    assert.ok(cmd.includes("'claude-opus-4-5'"));
  });
});

// ---------------------------------------------------------------------------
// buildWindowsShellCommand
// ---------------------------------------------------------------------------

describe('buildWindowsShellCommand', () => {
  const opts = {
    binary:     'C:\\Users\\test\\claude.exe',
    finalArgs:  ['--permission-mode', 'bypassPermissions'],
    promptPath: 'C:\\tmp\\prompt.txt',
    logPath:    'C:\\tmp\\stage-0.log',
    doneFile:   'C:\\tmp\\stage-0.done',
  };

  it('produces an ampersand-separated cmd.exe command', () => {
    const cmd = buildWindowsShellCommand(opts);
    assert.ok(typeof cmd === 'string');
    const parts = cmd.split(' & ');
    assert.equal(parts.length, 4);
  });

  it('includes ERRORLEVEL capture', () => {
    const cmd = buildWindowsShellCommand(opts);
    assert.ok(cmd.includes('ERRORLEVEL'));
  });

  it('includes done file sentinel write', () => {
    const cmd = buildWindowsShellCommand(opts);
    assert.ok(cmd.includes('C:\\tmp\\stage-0.done') || cmd.includes('"C:\\tmp\\stage-0.done"'));
  });

  it('ends with exit /B 0', () => {
    const cmd = buildWindowsShellCommand(opts);
    assert.ok(cmd.includes('exit /B 0'));
  });
});
