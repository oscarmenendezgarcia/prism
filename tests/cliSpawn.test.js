'use strict';

/**
 * Tests for MODEL-2 — cliSpawn (shared CLI-tool resolution for agent spawns).
 * node:test + assert
 */

const { describe, it } = require('node:test');
const assert           = require('node:assert/strict');

const cliSpawn = require('../src/services/cliSpawn');

// ---------------------------------------------------------------------------
// shellEscape / cmdEscape
// ---------------------------------------------------------------------------

describe('shellEscape', () => {
  it('wraps a plain string in single quotes', () => {
    assert.equal(cliSpawn.shellEscape('hello'), "'hello'");
  });

  it('escapes embedded single quotes', () => {
    assert.equal(cliSpawn.shellEscape("it's"), "'it'\\''s'");
  });
});

describe('cmdEscape', () => {
  it('wraps a plain string in double quotes', () => {
    assert.equal(cliSpawn.cmdEscape('hello'), '"hello"');
  });

  it('doubles embedded double quotes', () => {
    assert.equal(cliSpawn.cmdEscape('say "hi"'), '"say ""hi"""');
  });
});

// ---------------------------------------------------------------------------
// resolveCliBinary
// ---------------------------------------------------------------------------

describe('resolveCliBinary', () => {
  it('resolves claude to a non-empty binary path/name', () => {
    const bin = cliSpawn.resolveCliBinary('claude');
    assert.ok(typeof bin === 'string' && bin.length > 0);
  });

  it('treats an undefined cliTool as claude (default)', () => {
    assert.equal(cliSpawn.resolveCliBinary(undefined), cliSpawn.resolveCliBinary('claude'));
  });

  it('throws BINARY_NOT_FOUND for an unknown cliTool', () => {
    assert.throws(
      () => cliSpawn.resolveCliBinary('custom'),
      /BINARY_NOT_FOUND:custom/
    );
  });

  it('caches the claude binary path across calls', () => {
    const first  = cliSpawn.resolveCliBinary('claude');
    const second = cliSpawn.resolveCliBinary('claude');
    assert.equal(first, second);
  });
});

// ---------------------------------------------------------------------------
// buildMergedPrompt
// ---------------------------------------------------------------------------

describe('buildMergedPrompt', () => {
  it('merges systemPrompt and task prompt with a separator', () => {
    const merged = cliSpawn.buildMergedPrompt({ systemPrompt: 'You are an architect.' }, 'Design the system.');
    assert.equal(merged, 'You are an architect.\n\n---\n\nDesign the system.');
  });

  it('returns the task prompt unchanged when agentSpec has no systemPrompt', () => {
    assert.equal(cliSpawn.buildMergedPrompt(null, 'Design the system.'), 'Design the system.');
    assert.equal(cliSpawn.buildMergedPrompt({}, 'Design the system.'), 'Design the system.');
    assert.equal(cliSpawn.buildMergedPrompt({ systemPrompt: '' }, 'Design the system.'), 'Design the system.');
  });

  it('trims the systemPrompt before merging', () => {
    const merged = cliSpawn.buildMergedPrompt({ systemPrompt: '  You are an architect.  \n' }, 'Design.');
    assert.equal(merged, 'You are an architect.\n\n---\n\nDesign.');
  });
});

// ---------------------------------------------------------------------------
// opencodeCliLine
// ---------------------------------------------------------------------------

describe('opencodeCliLine', () => {
  const opts = {
    binary:            '/opt/opencode/bin/opencode',
    model:              'vllm-local/qwen3.6-35b',
    mergedPromptPath:   '/tmp/run-1/stage-0-oc-prompt.md',
    logPath:            '/tmp/run-1/stage-0.log',
  };

  it('builds a unix-quoted invocation line', () => {
    const line = cliSpawn.opencodeCliLine({ ...opts, platform: 'unix' });
    assert.equal(
      line,
      "'/opt/opencode/bin/opencode' run --model 'vllm-local/qwen3.6-35b' --dangerously-skip-permissions --format default 'Proceed.' --file '/tmp/run-1/stage-0-oc-prompt.md' >> '/tmp/run-1/stage-0.log' 2>&1"
    );
  });

  it('builds a windows-quoted invocation line', () => {
    const line = cliSpawn.opencodeCliLine({ ...opts, platform: 'win32' });
    assert.equal(
      line,
      '"/opt/opencode/bin/opencode" run --model "vllm-local/qwen3.6-35b" --dangerously-skip-permissions --format default "Proceed." --file "/tmp/run-1/stage-0-oc-prompt.md" >> "/tmp/run-1/stage-0.log" 2>&1'
    );
  });

  it('defaults to unix quoting when platform is omitted', () => {
    const line = cliSpawn.opencodeCliLine(opts);
    assert.ok(line.startsWith("'/opt/opencode/bin/opencode'"));
  });
});
