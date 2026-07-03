/**
 * MODEL-2: opencode CLI adapter — unit + integration tests
 *
 * Covers:
 *   modelConfigResolver:
 *     - VALID_CLI_TOOLS now includes 'opencode'
 *     - opencode model must contain '/' separator
 *     - provider is open-ended for opencode (not whitelisted)
 *
 *   pipelineManager helpers (unit — no spawn):
 *     - resolveCliBinary('claude') returns CLAUDE_BIN
 *     - resolveCliBinary('opencode') resolves to ~/.opencode/bin/opencode
 *     - resolveCliBinary('opencode') throws BINARY_NOT_FOUND when missing
 *     - resolveCliBinary('opencode') caches result on second call
 *     - buildOpencodePromptFile writes correct content and returns path
 *     - buildOpencodePromptFile falls back to task-prompt-only when agentSpec is null
 *     - buildOpencodeUnixShellCommand output structure (flags, sentinel pattern)
 *     - buildOpencodeWindowsShellCommand output structure
 *
 *   Integration (PIPELINE_NO_SPAWN=1):
 *     - opencode stage: stageStatuses[i].cliTool = 'opencode' in run.json
 *     - opencode stage: stage-N-oc-prompt.md written in run directory
 *
 *   Integration (no PIPELINE_NO_SPAWN — binary-missing path):
 *     - stageStatuses[i].failureReason === 'binary_missing' when opencode not found (AT-05)
 *
 * Run with: node --test tests/pipelineManager.opencode.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-oc-test-'));
}

function writeAgentFile(agentsDir, agentId, model = 'claude-sonnet-4-5', body = 'You are a test agent.') {
  fs.mkdirSync(agentsDir, { recursive: true });
  const content = `---\nmodel: ${model}\n---\n\n${body}`;
  fs.writeFileSync(path.join(agentsDir, `${agentId}.md`), content, 'utf8');
}

function createSpaceWithTask(dataDir, spaceId = 'test-space-oc') {
  const taskId   = crypto.randomUUID();
  const spaceDir = path.join(dataDir, 'spaces', spaceId);
  fs.mkdirSync(spaceDir, { recursive: true });
  const task = {
    id: taskId, title: 'OC test task', type: 'feature',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(spaceDir, 'todo.json'),        JSON.stringify([task]), 'utf8');
  fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([]),     'utf8');
  fs.writeFileSync(path.join(spaceDir, 'done.json'),        JSON.stringify([]),     'utf8');
  return { spaceId, taskId };
}

/**
 * Fresh require of pipelineManager (avoid module cache pollution).
 * cliSpawn.js owns the CLAUDE_BIN/OPENCODE_BIN caches (MODEL-2 — shared with
 * folioBootstrap.js), so it must be cleared too or binary-resolution tests
 * that rely on a fresh PATH/HOME probe will see a stale cached path.
 */
function freshPM() {
  delete require.cache[require.resolve('../src/services/pipelineManager')];
  delete require.cache[require.resolve('../src/services/agentResolver')];
  delete require.cache[require.resolve('../src/services/modelConfigResolver')];
  delete require.cache[require.resolve('../src/services/cliSpawn')];
  return require('../src/services/pipelineManager');
}

// ---------------------------------------------------------------------------
// modelConfigResolver — MODEL-2 constants
// ---------------------------------------------------------------------------

describe('modelConfigResolver MODEL-2', () => {
  const { validateStageModelConfig, VALID_CLI_TOOLS, VALID_PROVIDERS } =
    require('../src/services/modelConfigResolver');

  test('VALID_CLI_TOOLS includes opencode', () => {
    assert.ok(VALID_CLI_TOOLS.includes('opencode'), 'expected opencode in VALID_CLI_TOOLS');
  });

  test('VALID_CLI_TOOLS includes custom', () => {
    assert.ok(VALID_CLI_TOOLS.includes('custom'), 'expected custom in VALID_CLI_TOOLS');
  });

  test('VALID_PROVIDERS whitelist still applies to claude cliTool', () => {
    const result = validateStageModelConfig({ cliTool: 'claude', provider: 'gemini' });
    assert.equal(result.valid, false);
  });

  test('accepts opencode with provider/model format', () => {
    const result = validateStageModelConfig({
      cliTool: 'opencode', provider: 'vllm-local', model: 'vllm-local/nvidia/Qwen3.6-35B',
    });
    assert.equal(result.valid, true);
  });

  test('rejects opencode model without slash', () => {
    const result = validateStageModelConfig({ cliTool: 'opencode', model: 'no-slash-model' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('provider>/<model')));
  });

  test('accepts opencode without model (no slash constraint)', () => {
    const result = validateStageModelConfig({ cliTool: 'opencode' });
    assert.equal(result.valid, true);
  });
});

// ---------------------------------------------------------------------------
// resolveCliBinary — unit tests
// ---------------------------------------------------------------------------

describe('resolveCliBinary', () => {
  test('resolveCliBinary(claude) returns a non-empty string (CLAUDE_BIN)', () => {
    const pm = freshPM();
    const binary = pm._resolveCliBinaryForTest('claude');
    assert.ok(typeof binary === 'string' && binary.length > 0);
  });

  test('resolveCliBinary(opencode) finds ~/.opencode/bin/opencode when installed', () => {
    const home = os.homedir();
    const defaultPath = path.join(home, '.opencode', 'bin', 'opencode');
    if (!fs.existsSync(defaultPath)) {
      // opencode not installed — skip this test (not a failure).
      return;
    }
    const pm = freshPM();
    const binary = pm._resolveCliBinaryForTest('opencode');
    assert.ok(typeof binary === 'string' && binary.length > 0);
  });

  test('resolveCliBinary(opencode) throws BINARY_NOT_FOUND when PATH and default path miss', () => {
    // Patch PATH to an empty dir so `which opencode` fails.
    const emptyDir = tmpDir();
    const origPath = process.env.PATH;
    // Also use a non-existent HOME so the default path probe fails.
    const origHome = process.env.HOME;
    process.env.PATH = emptyDir;
    process.env.HOME = path.join(emptyDir, 'no-such-home');

    try {
      // Fresh require so OPENCODE_BIN is not cached from a prior test.
      const pm = freshPM();
      assert.throws(
        () => pm._resolveCliBinaryForTest('opencode'),
        (err) => {
          assert.ok(err.message.includes('BINARY_NOT_FOUND:opencode'), `got: ${err.message}`);
          return true;
        }
      );
    } finally {
      process.env.PATH = origPath;
      process.env.HOME = origHome;
    }

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  test('resolveCliBinary(opencode) caches result on second call', () => {
    const home = os.homedir();
    const defaultPath = path.join(home, '.opencode', 'bin', 'opencode');
    if (!fs.existsSync(defaultPath)) {
      // Cannot test caching without the binary present.
      return;
    }
    const pm = freshPM();
    const first  = pm._resolveCliBinaryForTest('opencode');
    const second = pm._resolveCliBinaryForTest('opencode');
    assert.equal(first, second, 'second call should return cached value');
  });
});

// ---------------------------------------------------------------------------
// buildOpencodePromptFile — unit tests
// ---------------------------------------------------------------------------

describe('buildOpencodePromptFile', () => {
  test('writes agent system prompt + separator + task prompt', () => {
    const dir      = tmpDir();
    const runDirP  = dir;
    const taskPath = path.join(dir, 'stage-0-prompt.md');
    const taskContent = 'Task: implement the feature.';
    fs.writeFileSync(taskPath, taskContent, 'utf8');

    const pm = freshPM();
    const agentSpec = { systemPrompt: 'You are a developer agent.' };
    const outPath = pm._buildOpencodePromptFileForTest(agentSpec, taskPath, runDirP, 0);

    assert.ok(fs.existsSync(outPath), 'merged prompt file should exist');
    const content = fs.readFileSync(outPath, 'utf8');
    assert.ok(content.includes('You are a developer agent.'), 'should include system prompt');
    assert.ok(content.includes('---'), 'should include separator');
    assert.ok(content.includes(taskContent), 'should include task prompt');
    assert.ok(content.indexOf('You are a developer agent.') < content.indexOf('---'),
      'system prompt should precede separator');
    assert.ok(content.indexOf('---') < content.indexOf(taskContent),
      'separator should precede task prompt');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('falls back to task-prompt-only when agentSpec is null', () => {
    const dir      = tmpDir();
    const taskPath = path.join(dir, 'stage-1-prompt.md');
    const taskContent = 'Task prompt only.';
    fs.writeFileSync(taskPath, taskContent, 'utf8');

    const pm = freshPM();
    const outPath = pm._buildOpencodePromptFileForTest(null, taskPath, dir, 1);

    assert.ok(fs.existsSync(outPath));
    const content = fs.readFileSync(outPath, 'utf8');
    assert.ok(content.includes(taskContent));
    // No separator when agentSpec is null.
    assert.ok(!content.includes('---'), 'should not include separator for null agentSpec');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('file is named stage-N-oc-prompt.md with correct N', () => {
    const dir      = tmpDir();
    const taskPath = path.join(dir, 'stage-3-prompt.md');
    fs.writeFileSync(taskPath, 'Task.', 'utf8');

    const pm = freshPM();
    const outPath = pm._buildOpencodePromptFileForTest({ systemPrompt: 'Agent.' }, taskPath, dir, 3);

    assert.ok(outPath.endsWith('stage-3-oc-prompt.md'), `expected stage-3-oc-prompt.md, got ${outPath}`);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('returns absolute path of written file', () => {
    const dir      = tmpDir();
    const taskPath = path.join(dir, 'stage-0-prompt.md');
    fs.writeFileSync(taskPath, 'T.', 'utf8');

    const pm = freshPM();
    const outPath = pm._buildOpencodePromptFileForTest({ systemPrompt: 'A.' }, taskPath, dir, 0);

    assert.ok(path.isAbsolute(outPath), 'should return absolute path');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Shell command builders — unit tests
// ---------------------------------------------------------------------------

describe('buildOpencodeUnixShellCommand', () => {
  test('includes binary path, --model flag, --dangerously-skip-permissions, --format default, --file, and Proceed.', () => {
    const pm = freshPM();
    const cmd = pm._buildOpencodeUnixShellCommandForTest({
      binary:           '/home/user/.opencode/bin/opencode',
      model:            'vllm-local/nvidia/Qwen3.6-35B',
      mergedPromptPath: '/tmp/stage-0-oc-prompt.md',
      logPath:          '/tmp/stage-0.log',
      doneFile:         '/tmp/stage-0.done',
    });
    assert.ok(cmd.includes('opencode'), 'should contain binary name');
    assert.ok(cmd.includes('--model'), 'should include --model flag');
    assert.ok(cmd.includes('Qwen3.6-35B'), 'should include model name');
    assert.ok(cmd.includes('--dangerously-skip-permissions'), 'should include permissions flag');
    assert.ok(cmd.includes('--format default'), 'should include format flag');
    assert.ok(cmd.includes('--file'), 'should include --file flag');
    assert.ok(cmd.includes('stage-0-oc-prompt.md'), 'should include merged prompt path');
    assert.ok(cmd.includes('Proceed.'), 'should include trigger message');
    assert.ok(cmd.includes('stage-0.log'), 'should include log path');
    assert.ok(cmd.includes('_EXIT='), 'should include EXIT sentinel pattern');
    assert.ok(cmd.includes('trap'), 'should include EXIT trap');
  });

  test('all path arguments are shell-escaped (single-quoted)', () => {
    const pm = freshPM();
    const cmd = pm._buildOpencodeUnixShellCommandForTest({
      binary:           '/path/to/opencode',
      model:            'vllm-local/model',
      mergedPromptPath: "/tmp/run dir/stage-0-oc-prompt.md",
      logPath:          '/tmp/stage-0.log',
      doneFile:         '/tmp/stage-0.done',
    });
    // Space in mergedPromptPath should be inside single quotes.
    assert.ok(cmd.includes("'"), 'should use single-quote escaping');
  });
});

describe('buildOpencodeWindowsShellCommand', () => {
  test('includes binary, --model, --dangerously-skip-permissions, --format default, --file, Proceed., and done-file write', () => {
    const pm = freshPM();
    const cmd = pm._buildOpencodeWindowsShellCommandForTest({
      binary:           'C:\\opencode\\opencode.exe',
      model:            'vllm-local/nvidia/Qwen3.6-35B',
      mergedPromptPath: 'C:\\tmp\\stage-0-oc-prompt.md',
      logPath:          'C:\\tmp\\stage-0.log',
      doneFile:         'C:\\tmp\\stage-0.done',
    });
    assert.ok(cmd.includes('opencode'), 'should contain binary');
    assert.ok(cmd.includes('--model'), 'should include --model');
    assert.ok(cmd.includes('--dangerously-skip-permissions'));
    assert.ok(cmd.includes('--format default'));
    assert.ok(cmd.includes('--file'));
    assert.ok(cmd.includes('Proceed.'));
    assert.ok(cmd.includes('!ERRORLEVEL!'), 'should use ERRORLEVEL for exit code');
    assert.ok(cmd.includes('stage-0.done'), 'should reference done file');
  });
});

// ---------------------------------------------------------------------------
// Integration: PIPELINE_NO_SPAWN=1 with cliTool=opencode
// ---------------------------------------------------------------------------

describe('pipelineManager integration — opencode stage (PIPELINE_NO_SPAWN=1)', () => {
  test('stageStatuses[i].cliTool is opencode and stage-N-oc-prompt.md exists in run dir', async () => {
    const dataDir   = tmpDir();
    const agentsDir = tmpDir();
    writeAgentFile(agentsDir, 'developer-agent');

    process.env.PIPELINE_AGENTS_DIR   = agentsDir;
    process.env.PIPELINE_AGENT_MODE   = 'subagent';
    process.env.PIPELINE_NO_SPAWN     = '1';
    process.env.PIPELINE_MAX_CONCURRENT = '5';

    const { spaceId, taskId } = createSpaceWithTask(dataDir);

    // Write settings.json with opencode stageModels override.
    // Note: in PIPELINE_NO_SPAWN mode _store is null, so settings-level overrides
    // are the reliable path (readSettings reads from disk; task-level needs _store).
    const settingsPath = path.join(dataDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      pipeline: {
        stageModels: {
          'developer-agent': { cliTool: 'opencode', provider: 'vllm-local', model: 'vllm-local/nvidia/Qwen3.6-35B' },
        },
      },
    }), 'utf8');

    const pm = freshPM();

    // Give the run directory space to be created.
    const run = await pm.createRun({
      spaceId,
      taskId,
      stages: ['developer-agent'],
      dataDir,
    });

    // Wait for stage to complete (PIPELINE_NO_SPAWN writes done sentinel immediately).
    await new Promise(resolve => setTimeout(resolve, 200));

    // Read the persisted run.json.
    const runJsonData = fs.readFileSync(
      path.join(dataDir, 'runs', run.runId, 'run.json'), 'utf8',
    );
    const persistedRun = JSON.parse(runJsonData);

    // cliTool should be 'opencode' from the task-level stageModels override.
    assert.equal(
      persistedRun.stageStatuses[0].cliTool,
      'opencode',
      'stageStatuses[0].cliTool should be opencode',
    );

    // stage-0-oc-prompt.md should exist in the run directory.
    const promptFile = path.join(dataDir, 'runs', run.runId, 'stage-0-oc-prompt.md');
    assert.ok(fs.existsSync(promptFile), 'stage-0-oc-prompt.md should exist in run dir');

    // Clean up.
    delete process.env.PIPELINE_AGENTS_DIR;
    delete process.env.PIPELINE_AGENT_MODE;
    delete process.env.PIPELINE_NO_SPAWN;
    delete process.env.PIPELINE_MAX_CONCURRENT;
    fs.rmSync(dataDir,   { recursive: true, force: true });
    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  test('claude stage is unchanged — no stage-N-oc-prompt.md written', async () => {
    const dataDir   = tmpDir();
    const agentsDir = tmpDir();
    writeAgentFile(agentsDir, 'developer-agent');

    process.env.PIPELINE_AGENTS_DIR    = agentsDir;
    process.env.PIPELINE_AGENT_MODE    = 'subagent';
    process.env.PIPELINE_NO_SPAWN      = '1';
    process.env.PIPELINE_MAX_CONCURRENT = '5';

    // No stageModels override — defaults to claude.
    const taskId   = crypto.randomUUID();
    const spaceId  = 'test-claude-default';
    const spaceDir = path.join(dataDir, 'spaces', spaceId);
    fs.mkdirSync(spaceDir, { recursive: true });
    const task = {
      id: taskId, title: 'Claude default task', type: 'chore',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(spaceDir, 'todo.json'),        JSON.stringify([task]), 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([]),     'utf8');
    fs.writeFileSync(path.join(spaceDir, 'done.json'),        JSON.stringify([]),     'utf8');

    fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ pipeline: {} }), 'utf8');

    const pm = freshPM();
    const run = await pm.createRun({
      spaceId, taskId, stages: ['developer-agent'], dataDir,
    });

    await new Promise(resolve => setTimeout(resolve, 200));

    // No oc-prompt file for claude stages.
    const promptFile = path.join(dataDir, 'runs', run.runId, 'stage-0-oc-prompt.md');
    assert.ok(!fs.existsSync(promptFile), 'stage-0-oc-prompt.md should NOT exist for claude stage');

    delete process.env.PIPELINE_AGENTS_DIR;
    delete process.env.PIPELINE_AGENT_MODE;
    delete process.env.PIPELINE_NO_SPAWN;
    delete process.env.PIPELINE_MAX_CONCURRENT;
    fs.rmSync(dataDir,   { recursive: true, force: true });
    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  test('stageStatuses[i].failureReason is "binary_missing" when opencode binary not found', async () => {
    // Binary resolution runs AFTER the PIPELINE_NO_SPAWN guard, so we must NOT
    // set PIPELINE_NO_SPAWN — we need it to reach the resolveCliBinary() call.
    // Binary resolution throws before any spawn attempt, so no process is launched.
    const dataDir   = tmpDir();
    const agentsDir = tmpDir();
    writeAgentFile(agentsDir, 'developer-agent');

    // Spoof PATH and HOME so neither 'which opencode' nor the fallback
    // ~/.opencode/bin/opencode path resolves.
    const emptyDir  = tmpDir();
    const origPath  = process.env.PATH;
    const origHome  = process.env.HOME;
    process.env.PATH = emptyDir;
    process.env.HOME = path.join(emptyDir, 'no-such-home');

    process.env.PIPELINE_AGENTS_DIR    = agentsDir;
    process.env.PIPELINE_AGENT_MODE    = 'subagent';
    process.env.PIPELINE_MAX_CONCURRENT = '5';
    // Note: PIPELINE_NO_SPAWN is intentionally NOT set here.

    const { spaceId, taskId } = createSpaceWithTask(dataDir);

    fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
      pipeline: {
        stageModels: {
          'developer-agent': { cliTool: 'opencode', provider: 'vllm-local', model: 'vllm-local/model' },
        },
      },
    }), 'utf8');

    // Fresh PM so OPENCODE_BIN cache is not poisoned by a prior test that found the binary.
    const pm = freshPM();
    const run = await pm.createRun({
      spaceId, taskId, stages: ['developer-agent'], dataDir,
    });

    // Give the pipeline time to attempt the stage and fail on binary resolution.
    await new Promise(resolve => setTimeout(resolve, 400));

    const persistedRun = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'runs', run.runId, 'run.json'), 'utf8'),
    );

    assert.equal(
      persistedRun.stageStatuses[0].status,
      'failed',
      'stageStatuses[0].status should be failed',
    );
    assert.equal(
      persistedRun.stageStatuses[0].failureReason,
      'binary_missing',
      'stageStatuses[0].failureReason should be binary_missing (AT-05)',
    );
    assert.equal(
      persistedRun.stageStatuses[0].exitCode,
      -1,
      'stageStatuses[0].exitCode should be -1',
    );
    assert.equal(persistedRun.status, 'failed', 'run.status should be failed');

    // Restore env.
    process.env.PATH = origPath;
    process.env.HOME = origHome;
    delete process.env.PIPELINE_AGENTS_DIR;
    delete process.env.PIPELINE_AGENT_MODE;
    delete process.env.PIPELINE_MAX_CONCURRENT;
    fs.rmSync(dataDir,   { recursive: true, force: true });
    fs.rmSync(agentsDir, { recursive: true, force: true });
    fs.rmSync(emptyDir,  { recursive: true, force: true });
  });
});
