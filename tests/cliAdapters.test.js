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

  it('returns the pi adapter for "pi"', () => {
    assert.equal(cliAdapters.getAdapter('pi').name, 'pi');
  });

  it('returns the hermes adapter for "hermes"', () => {
    assert.equal(cliAdapters.getAdapter('hermes').name, 'hermes');
  });

  it('throws CLI_ADAPTER_NOT_FOUND for an unknown cliTool', () => {
    assert.throws(() => cliAdapters.getAdapter('unknown-tool'), /CLI_ADAPTER_NOT_FOUND:unknown-tool/);
  });
});

describe('ADAPTERS', () => {
  it('registers claude, opencode, pi, and hermes', () => {
    assert.ok(cliAdapters.ADAPTERS.claude, 'claude adapter present');
    assert.ok(cliAdapters.ADAPTERS.opencode, 'opencode adapter present');
    assert.ok(cliAdapters.ADAPTERS.pi, 'pi adapter present');
    assert.ok(cliAdapters.ADAPTERS.hermes, 'hermes adapter present');
  });
});

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

describe('adapter contract', () => {
  it('each adapter exposes the full harness interface', () => {
    for (const name of ['claude', 'opencode', 'pi', 'hermes']) {
      const a = cliAdapters.getAdapter(name);
      assert.equal(typeof a.resolveBinary, 'function', `${name}: resolveBinary`);
      assert.equal(typeof a.buildUnixCommand, 'function', `${name}: buildUnixCommand`);
      assert.equal(typeof a.buildWindowsCommand, 'function', `${name}: buildWindowsCommand`);
      assert.equal(typeof a.metaSource, 'function', `${name}: metaSource`);
      assert.equal(typeof a.needsPromptFile, 'boolean', `${name}: needsPromptFile`);
    }
  });

  it('claude does not need a prompt file; opencode, pi, and hermes do', () => {
    assert.equal(cliAdapters.getAdapter('claude').needsPromptFile, false);
    assert.equal(cliAdapters.getAdapter('opencode').needsPromptFile, true);
    assert.equal(cliAdapters.getAdapter('pi').needsPromptFile, true);
    assert.equal(cliAdapters.getAdapter('hermes').needsPromptFile, true);
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

  it('injects preDoneLine after the cli line and after _EXIT=$? capture', () => {
    const cmd = cliAdapters.wrapUnixSentinel('claude -p hi', '/tmp/s.done', 'pkill -f x');
    assert.ok(cmd.includes('claude -p hi'));
    assert.ok(cmd.includes('pkill -f x'));
    const cliIdx = cmd.indexOf('claude -p hi');
    const exitIdx = cmd.indexOf('_EXIT=$?');
    const preIdx = cmd.indexOf('pkill -f x');
    // cli runs → _EXIT captures the CLI's real exit code → cleanup runs after
    assert.ok(preIdx > cliIdx, 'preDoneLine should come after the cli line');
    assert.ok(exitIdx < preIdx, '_EXIT=$? must be captured before preDoneLine so the CLI exit code is preserved');
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

// ---------------------------------------------------------------------------
// custom adapter
// ---------------------------------------------------------------------------

describe('custom adapter', () => {
  it('is registered and needs no prompt file', () => {
    assert.equal(cliAdapters.getAdapter('custom').name, 'custom');
    assert.equal(cliAdapters.getAdapter('custom').needsPromptFile, false);
  });

  it('resolveBinary returns null (no single binary)', () => {
    assert.equal(cliAdapters.getAdapter('custom').resolveBinary(), null);
  });

  it('builds a unix command with placeholders substituted', () => {
    const cmd = cliAdapters.getAdapter('custom').buildUnixCommand({
      command:    'my-tool --model {model} < {prompt} >> {log}',
      model:      'deepseek-v4-flash',
      promptPath: '/tmp/stage-0-prompt.md',
      logPath:    '/tmp/stage-0.log',
      doneFile:   '/tmp/stage-0.done',
    });
    assert.ok(cmd.includes('--model deepseek-v4-flash'));
    assert.ok(cmd.includes('< /tmp/stage-0-prompt.md'));
    assert.ok(cmd.includes('>> /tmp/stage-0.log'));
    assert.ok(cmd.includes('_EXIT='), 'should include EXIT sentinel');
  });

  it('metaSource is plain', () => {
    assert.equal(cliAdapters.getAdapter('custom').metaSource(), 'plain');
  });
});

describe('expandCustomCommand', () => {
  it('substitutes all known placeholders', () => {
    const out = cliAdapters.expandCustomCommand(
      'my-tool -m {model} < {prompt} >> {log} # {done}',
      { model: 'm', prompt: 'p', log: 'l', done: 'd' },
    );
    assert.equal(out, 'my-tool -m m < p >> l # d');
  });

  it('leaves unknown braces untouched', () => {
    const out = cliAdapters.expandCustomCommand('my-tool {wat}', { model: 'm' });
    assert.equal(out, 'my-tool {wat}');
  });

  it('substitutes missing values with empty string', () => {
    const out = cliAdapters.expandCustomCommand('{prompt}{model}', { model: 'm' });
    assert.equal(out, 'm');
  });
});

// ---------------------------------------------------------------------------
// buildArgs (direct-spawn invocation, used by autoTask)
// ---------------------------------------------------------------------------

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

describe('buildArgs — claude', () => {
  it('builds claude print-mode args with stdin prompt', () => {
    const { args, stdin } = cliAdapters.getAdapter('claude').buildArgs({
      model: 'claude-sonnet-4-5', systemPrompt: 'You classify.', prompt: 'Classify these',
    });
    assert.ok(args.includes('--print'));
    assert.ok(args.includes('--system-prompt'));
    assert.ok(args.includes('--model'));
    assert.ok(args.includes('claude-sonnet-4-5'));
    assert.equal(stdin, 'Classify these');
  });
});

describe('buildArgs — pi', () => {
  it('builds pi print-mode args with merged prompt on stdin', () => {
    const { args, stdin } = cliAdapters.getAdapter('pi').buildArgs({
      model: 'gb10/deepseek-v4-flash', systemPrompt: 'Sys.', prompt: 'Task.',
    });
    assert.deepEqual(args, ['-p', '--model', 'gb10/deepseek-v4-flash']);
    assert.ok(stdin.includes('Sys.'), 'stdin should carry the system prompt');
    assert.ok(stdin.includes('Task.'), 'stdin should carry the task prompt');
  });
});

describe('buildArgs — hermes', () => {
  it('builds hermes chat args with -q prompt and optional -m', () => {
    const { args, stdin } = cliAdapters.getAdapter('hermes').buildArgs({
      model: 'deepseek-v4-flash', systemPrompt: 'Sys.', prompt: 'Task.',
    });
    assert.ok(args.includes('chat'));
    assert.ok(args.includes('-q'));
    assert.ok(args.includes('--cli'));
    assert.ok(args.includes('-Q'));
    assert.ok(args.includes('-m'));
    assert.equal(stdin, null);
  });

  it('omits -m when model is absent', () => {
    const { args } = cliAdapters.getAdapter('hermes').buildArgs({
      systemPrompt: 'Sys.', prompt: 'Task.',
    });
    assert.ok(!args.includes('-m'));
  });
});

describe('buildArgs — opencode', () => {
  it('writes a merged prompt temp file and lists it in cleanup', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-test-'));
    try {
      const { args, stdin, cleanup } = cliAdapters.getAdapter('opencode').buildArgs({
        model: 'vllm-local/qwen', systemPrompt: 'Sys.', prompt: 'Task.', tmpDir,
      });
      assert.ok(args.includes('run'));
      assert.ok(args.includes('--model'));
      assert.ok(args.includes('--file'));
      assert.equal(stdin, null);
      assert.ok(Array.isArray(cleanup) && cleanup.length === 1, 'should return one temp file');
      assert.ok(fs.existsSync(cleanup[0]), 'temp prompt file should exist');
      assert.ok(fs.readFileSync(cleanup[0], 'utf8').includes('Sys.'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// buildLauncherCommand (Launcher preview)
// ---------------------------------------------------------------------------

describe('buildLauncherCommand', () => {
  const opts = { binary: '/usr/local/bin/claude', promptPath: '/tmp/p.md' };

  it('builds a claude command with cat-subshell by default', () => {
    const cmd = cliAdapters.buildLauncherCommand({ ...opts, cliTool: 'claude' });
    assert.ok(cmd.startsWith('/usr/local/bin/claude'));
    assert.ok(cmd.includes('"$(cat /tmp/p.md)"'));
  });

  it('builds an opencode run command', () => {
    const cmd = cliAdapters.buildLauncherCommand({ ...opts, cliTool: 'opencode' });
    assert.ok(cmd.includes('run'));
  });

  it('builds a pi command with --model and stdin redirect', () => {
    const cmd = cliAdapters.buildLauncherCommand({
      cliTool: 'pi', binary: '/opt/bin/pi', model: 'gb10/deepseek-v4-flash', promptPath: '/tmp/p.md',
    });
    assert.ok(cmd.startsWith('/opt/bin/pi -p'));
    assert.ok(cmd.includes('--model gb10/deepseek-v4-flash'));
    assert.ok(cmd.includes('< "/tmp/p.md"'), 'pi reads the prompt from stdin regardless of fileInputMethod');
  });

  it('builds a hermes command with --cli -Q and -q cat-subshell', () => {
    const cmd = cliAdapters.buildLauncherCommand({
      cliTool: 'hermes', binary: '/opt/bin/hermes', model: 'deepseek-v4-flash', promptPath: '/tmp/p.md',
    });
    assert.ok(cmd.includes('chat'));
    assert.ok(cmd.includes('--cli -Q'));
    assert.ok(cmd.includes('-q "$(cat /tmp/p.md)"'), 'hermes takes the prompt via -q cat-subshell');
  });

  it('honours fileInputMethod stdin-redirect', () => {
    const cmd = cliAdapters.buildLauncherCommand({
      cliTool: 'claude', binary: 'claude', promptPath: '/tmp/p.md', fileInputMethod: 'stdin-redirect',
    });
    assert.ok(cmd.includes('< "/tmp/p.md"'));
  });
});
