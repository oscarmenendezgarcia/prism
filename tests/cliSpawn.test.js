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

  it('resolves pi to a real path, never the bare fallback name', () => {
    // Either pi is installed (real path) or genuinely missing (throws
    // BINARY_NOT_FOUND:pi so the pipeline fallback can activate). It must never
    // return the bare 'pi' name, which would silently mask a missing binary.
    try {
      const bin = cliSpawn.resolveCliBinary('pi');
      assert.ok(typeof bin === 'string' && bin.length > 0);
      assert.notEqual(bin, 'pi');
    } catch (err) {
      assert.ok(err.message.includes('BINARY_NOT_FOUND:pi'));
    }
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

// ---------------------------------------------------------------------------
// piCliLine
// ---------------------------------------------------------------------------

describe('piCliLine', () => {
  const opts = {
    binary:          '/opt/homebrew/bin/pi',
    model:           'gb10/deepseek-v4-flash',
    mergedPromptPath: '/tmp/run-1/stage-0-pi-prompt.md',
    logPath:         '/tmp/run-1/stage-0.log',
  };

  it('builds a unix-quoted print-mode invocation with stdin redirect', () => {
    const line = cliSpawn.piCliLine({ ...opts, platform: 'unix' });
    assert.equal(
      line,
      "'/opt/homebrew/bin/pi' -p --model 'gb10/deepseek-v4-flash' < '/tmp/run-1/stage-0-pi-prompt.md' >> '/tmp/run-1/stage-0.log' 2>&1"
    );
  });

  it('builds a windows-quoted invocation line', () => {
    const line = cliSpawn.piCliLine({ ...opts, platform: 'win32' });
    assert.equal(
      line,
      '"/opt/homebrew/bin/pi" -p --model "gb10/deepseek-v4-flash" < "/tmp/run-1/stage-0-pi-prompt.md" >> "/tmp/run-1/stage-0.log" 2>&1'
    );
  });

  it('defaults to unix quoting when platform is omitted', () => {
    const line = cliSpawn.piCliLine(opts);
    assert.ok(line.startsWith("'/opt/homebrew/bin/pi'"));
  });
});

// ---------------------------------------------------------------------------
// hermesCliLine
// ---------------------------------------------------------------------------

describe('hermesCliLine', () => {
  const opts = {
    binary:           '/opt/homebrew/bin/hermes',
    model:            'deepseek-v4-flash',
    mergedPromptPath: '/tmp/run-1/stage-0-hermes-prompt.md',
    logPath:          '/tmp/run-1/stage-0.log',
  };

  it('builds a unix-quoted headless chat invocation with cat-subshell query', () => {
    const line = cliSpawn.hermesCliLine({ ...opts, platform: 'unix' });
    assert.ok(line.startsWith("'/opt/homebrew/bin/hermes' chat"));
    assert.ok(line.includes('-q "$(cat '), 'should use cat-subshell for the query');
    assert.ok(line.includes("-m 'deepseek-v4-flash'"), 'should include the model flag');
    assert.ok(line.includes('--cli -Q'), 'should include headless quiet flags');
    assert.ok(line.endsWith(" >> '/tmp/run-1/stage-0.log' 2>&1"));
  });

  it('omits the model flag when model is not provided', () => {
    const { model, ...noModel } = opts;
    const line = cliSpawn.hermesCliLine({ ...noModel, platform: 'unix' });
    assert.ok(!line.includes('-m '), 'should not include -m when model omitted');
  });

  it('builds a windows-quoted invocation line (best-effort, path literal)', () => {
    const line = cliSpawn.hermesCliLine({ ...opts, platform: 'win32' });
    assert.ok(line.startsWith('"'));
    assert.ok(line.includes('-q '), 'should include the query flag');
    assert.ok(line.includes('--cli -Q'));
  });
});
