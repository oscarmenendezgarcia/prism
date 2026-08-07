'use strict';

/**
 * Integration tests for autoTask routing through the harness adapters (MODEL-3).
 *
 * Verifies that Generate Tasks honours a non-claude cliTool end-to-end:
 * config resolution → buildArgs → spawn → output parsing. child_process.spawn
 * is mocked so no real CLI is required; the fake child emits a non-claude style
 * output (no claude stream-JSON), which exercises the JSON fallback parser.
 *
 * Also covers the regression guard: 'custom' cliTool is rejected with a clean
 * 502 (it has no binary / direct-spawn buildArgs), and a missing binary is a
 * clean 502 instead of an uncaught rejection.
 *
 * Run with: node --test tests/autotask-routing.test.js
 */

const { describe, it, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const child_process = require('node:child_process');
const { createStore } = require('../src/services/store');
const { handleAutoTaskGenerate } = require('../src/handlers/autoTask');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeChild({ stdout, code = 0 }) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {} };
  process.nextTick(() => {
    if (stdout) child.stdout.emit('data', stdout);
    child.stdout.emit('end');
    child.emit('close', code);
  });
  return child;
}

function makeRes() {
  return {
    _status: 0,
    _body: null,
    writeHead(status) { this._status = status; },
    end(payload) { this._body = payload ? JSON.parse(payload) : null; },
  };
}

function makeStore(tmpDir) {
  return createStore(':memory:');
}

function makeReq(prompt, preview = true) {
  const { EventEmitter } = require('node:events');
  const req = new EventEmitter();
  req.method = 'POST';
  process.nextTick(() => {
    req.emit('data', Buffer.from(JSON.stringify({ prompt, preview })));
    req.emit('end');
  });
  return req;
}

function setup(dataDir, stageModel) {
  fs.writeFileSync(
    path.join(dataDir, 'settings.json'),
    JSON.stringify({ pipeline: { stageModels: { autotask: stageModel } } }),
    'utf8',
  );
}

const NON_CLAUDE_OUTPUT =
  'Analyzing request...\n' +
  '{"tasks":[{"title":"Build auth","type":"feature","description":"Add login"},' +
  '{"title":"Write tests","type":"tech-debt","description":"Cover auth"}]}\n';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('autoTask routing — non-claude cliTool (hermes)', () => {
  let tmpDir;
  let store;
  let spaceId;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-autotask-test-'));
    store = makeStore(tmpDir);
    const ts = new Date().toISOString();
    const space = store.upsertSpace({ id: 'space-1', name: 'test-space', createdAt: ts, updatedAt: ts });
    spaceId = 'space-1';
    process.env.PIPELINE_AGENTS_DIR = path.join(tmpDir, 'agents');
    fs.mkdirSync(process.env.PIPELINE_AGENTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.PIPELINE_AGENTS_DIR, 'autotask.md'), '# autotask\nStub\n');
  });

  afterEach(() => {
    mock.restoreAll();
    delete process.env.PIPELINE_AGENTS_DIR;
    delete process.env.TAGGER_CLI;
    delete process.env.TAGGER_MODEL;
    try { store.close && store.close(); } catch { /* noop */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses tasks from non-claude output (hermes) end-to-end', async () => {
    setup(tmpDir, { cliTool: 'hermes', provider: 'local', model: 'deepseek-v4-flash' });

    let spawnedArgs = null;
    mock.method(child_process, 'spawn', (cmd, args) => {
      spawnedArgs = { cmd, args };
      return fakeChild({ stdout: NON_CLAUDE_OUTPUT });
    });

    const res = makeRes();
    await handleAutoTaskGenerate(makeReq('build a todo app'), res, spaceId, store, tmpDir, tmpDir);

    assert.equal(res._status, 200, 'hermes path should succeed');
    assert.ok(Array.isArray(res._body.tasks));
    assert.equal(res._body.tasks.length, 2);
    assert.equal(res._body.tasks[0].title, 'Build auth');
    // hermes buildArgs: chat -q <prompt> --cli -Q -m <model>
    assert.ok(spawnedArgs, 'spawn should have been called');
    assert.ok(spawnedArgs.args[0] === 'chat', 'hermes adapter should invoke `chat`');
    assert.ok(spawnedArgs.args.includes('--cli'));
    assert.ok(spawnedArgs.args.includes('-Q'));
  });

  it('rejects cliTool custom with a clean 502 (no uncaught crash)', async () => {
    setup(tmpDir, { cliTool: 'custom', provider: 'p', command: 'my-tool --model {model}' });

    const res = makeRes();
    await handleAutoTaskGenerate(makeReq('x'), res, spaceId, store, tmpDir, tmpDir);

    assert.equal(res._status, 502);
    assert.ok(res._body.error.message.includes('custom'));
  });

  it('rejects a missing binary with a clean 502 (no uncaught crash)', async () => {
    // opencode binary is not installed in the test env, so resolveCliBinary
    // throws BINARY_NOT_FOUND — the handler must turn that into a 502, not
    // reject the async handler uncaught.
    setup(tmpDir, { cliTool: 'opencode', provider: 'p', model: 'gb10/x' });

    const res = makeRes();
    await handleAutoTaskGenerate(makeReq('x'), res, spaceId, store, tmpDir, tmpDir);

    assert.equal(res._status, 502);
    assert.ok(res._body.error.message.includes('opencode'));
  });
});
