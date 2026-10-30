'use strict';

/**
 * A run whose worktree is gone must get it back or fail. It must never fall back
 * to the user's checkout.
 * Run with: node --test tests/worktree-restore.test.js
 */

const { describe, test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const { execFileSync } = require('child_process');

const { provision, teardown, restore } = require('../src/services/worktreeManager');

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-restore-'));
  execFileSync('git', ['init', '-q', repo]);
  git(repo, 'config', 'user.email', 'test@test.com');
  git(repo, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, 'README.md'), '# test\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'init');
  return repo;
}

describe('worktreeManager.restore()', () => {
  let repo;
  let meta;
  let runId;

  beforeEach(async () => {
    repo  = makeRepo();
    runId = crypto.randomUUID();
    meta  = await provision(repo, runId);
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('is a no-op while the worktree exists', async () => {
    assert.deepEqual(await restore(repo, meta), { restored: false });
  });

  test('recreates a removed worktree with the saved work', async () => {
    fs.writeFileSync(path.join(meta.path, 'kept.txt'), 'kept\n');
    await teardown(meta, { reason: 'interrupted', runId });
    assert.ok(!fs.existsSync(meta.path));

    assert.deepEqual(await restore(repo, meta), { restored: true });

    assert.equal(fs.readFileSync(path.join(meta.path, 'kept.txt'), 'utf8'), 'kept\n');
    assert.equal(git(meta.path, 'rev-parse', '--abbrev-ref', 'HEAD'), meta.branch);
  });

  test('recovers when the directory was deleted without git knowing', async () => {
    fs.rmSync(meta.path, { recursive: true, force: true });

    assert.deepEqual(await restore(repo, meta), { restored: true });
    assert.ok(fs.existsSync(path.join(meta.path, 'README.md')));
  });

  test('brings back work saved from a detached HEAD', async () => {
    git(meta.path, 'checkout', '-q', '--detach');
    fs.writeFileSync(path.join(meta.path, 'kept.txt'), 'kept\n');
    await teardown(meta, { reason: 'failed', runId });

    await restore(repo, meta);

    assert.equal(fs.readFileSync(path.join(meta.path, 'kept.txt'), 'utf8'), 'kept\n');
    assert.equal(git(meta.path, 'rev-parse', '--abbrev-ref', 'HEAD'), meta.branch);
  });

  test('fails rather than dropping saved work that diverged', async () => {
    git(meta.path, 'checkout', '-q', '--detach');
    fs.writeFileSync(path.join(meta.path, 'kept.txt'), 'kept\n');
    await teardown(meta, { reason: 'failed', runId });
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'other');
    git(repo, 'branch', '-f', meta.branch, 'HEAD');

    await assert.rejects(() => restore(repo, meta), /diverged/);
    assert.equal(git(repo, 'show', `${meta.branch}-saved:kept.txt`), 'kept');
  });

  test('uses the saved branch when the run branch is gone', async () => {
    git(meta.path, 'checkout', '-q', '--detach');
    fs.writeFileSync(path.join(meta.path, 'kept.txt'), 'kept\n');
    await teardown(meta, { reason: 'failed', runId });
    git(repo, 'branch', '-D', meta.branch);

    await restore(repo, meta);

    assert.equal(fs.readFileSync(path.join(meta.path, 'kept.txt'), 'utf8'), 'kept\n');
  });

  test('recreates an empty branch deleted on failure from its base commit', async () => {
    await teardown(meta, { reason: 'failed', runId, deleteBranch: true });

    assert.deepEqual(await restore(repo, meta), { restored: true });
    assert.equal(git(meta.path, 'rev-parse', 'HEAD'), meta.baseRef);
  });

  test('fails when the branch is checked out elsewhere', async () => {
    await teardown(meta, { reason: 'failed', runId });
    git(repo, 'checkout', '-q', meta.branch);

    await assert.rejects(() => restore(repo, meta), /worktree failed/);
    assert.ok(!fs.existsSync(meta.path));
  });

  test('brings back work left on another named branch', async () => {
    git(meta.path, 'checkout', '-q', '-b', 'fix');
    fs.writeFileSync(path.join(meta.path, 'kept.txt'), 'kept\n');
    await teardown(meta, { reason: 'failed', runId });

    await restore(repo, meta);

    assert.equal(fs.readFileSync(path.join(meta.path, 'kept.txt'), 'utf8'), 'kept\n');
    assert.equal(git(meta.path, 'rev-parse', '--abbrev-ref', 'HEAD'), meta.branch);
  });

  test('a saved ref that is merely behind the branch does not block the resume', async () => {
    git(meta.path, 'commit', '-q', '--allow-empty', '-m', 'agent');
    git(meta.path, 'checkout', '-q', '--detach', 'HEAD~1');
    await teardown(meta, { reason: 'failed', runId });

    assert.deepEqual(await restore(repo, meta), { restored: true });
    assert.equal(git(repo, 'branch', '--list', `${meta.branch}-saved`), '');
  });

  test('fails when the path exists but is not a worktree', async () => {
    await teardown(meta, { reason: 'failed', runId });
    fs.mkdirSync(meta.path, { recursive: true });

    await assert.rejects(() => restore(repo, meta), /not a worktree root/);
  });
});

describe('resuming a run through the API', () => {
  const saved = {};
  let server;
  let port;
  let dataDir;
  let agentsDir;
  let repo;

  const api = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const waitFor = async (check, what) => {
    for (let i = 0; i < 100; i++) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`timed out waiting for ${what}`);
  };

  /** Start a run that stays paused at its checkpoint, so nothing races the test. */
  const startRun = async () => {
    const { body: space } = await api('POST', '/api/v1/spaces', { name: `s-${crypto.randomUUID().slice(0, 8)}`, workingDirectory: repo });
    const { body: task } = await api('POST', `/api/v1/spaces/${space.id}/tasks`, { title: 'T', type: 'feature' });
    const { status, body: run } = await api('POST', '/api/v1/runs', {
      spaceId: space.id, taskId: task.id, stages: ['developer-agent', 'developer-agent'], checkpoints: [1],
    });
    assert.equal(status, 201, JSON.stringify(run));
    await waitFor(async () => (await api('GET', `/api/v1/runs/${run.runId}`)).body.status === 'paused', 'the checkpoint');
    return run;
  };

  before(async () => {
    for (const key of ['PIPELINE_AGENTS_DIR', 'PIPELINE_NO_SPAWN', 'PIPELINE_WORKTREE_ENABLED', 'KANBAN_API_URL']) {
      saved[key] = process.env[key];
    }
    dataDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-restore-data-'));
    agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-restore-agents-'));
    fs.writeFileSync(path.join(agentsDir, 'developer-agent.md'), '---\nname: developer-agent\ndescription: test\n---\nTest\n');
    process.env.PIPELINE_AGENTS_DIR       = agentsDir;
    process.env.PIPELINE_NO_SPAWN         = '1';
    process.env.PIPELINE_WORKTREE_ENABLED = '1';
    process.env.KANBAN_API_URL            = 'http://localhost:19999/api/v1';

    repo = makeRepo();
    const { startServer } = require('../server');
    server = startServer({ port: 0, dataDir, silent: true, agentsDir });
    await new Promise((resolve) => server.once('listening', resolve));
    port = server.address().port;
  });

  after(async () => {
    const { abortAll } = require('../src/services/pipelineManager');
    await abortAll(dataDir).catch(() => {});
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 300);
      server.close(() => { clearTimeout(timer); resolve(); });
    });
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const dir of [repo, dataDir, agentsDir]) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('restores the worktree and leaves the checkout alone', async () => {
    const run = await startRun();
    fs.writeFileSync(path.join(run.worktree.path, 'kept.txt'), 'kept\n');
    await teardown(run.worktree, { reason: 'interrupted', runId: run.runId });
    assert.ok(!fs.existsSync(run.worktree.path));

    const res = await api('POST', `/api/v1/runs/${run.runId}/resume`);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(fs.readFileSync(path.join(run.worktree.path, 'kept.txt'), 'utf8'), 'kept\n');
    assert.ok(!fs.existsSync(path.join(repo, 'kept.txt')), 'the checkout must not get the work');
    assert.equal(git(repo, 'status', '--porcelain', '--', '.', ':!.worktrees'), '');
  });

  test('resuming right after stopping does not lose the worktree to the pending removal', async () => {
    const run = await startRun();
    fs.writeFileSync(path.join(run.worktree.path, 'kept.txt'), 'kept\n');

    await api('POST', `/api/v1/runs/${run.runId}/stop`);
    const res = await api('POST', `/api/v1/runs/${run.runId}/resume`);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(fs.readFileSync(path.join(run.worktree.path, 'kept.txt'), 'utf8'), 'kept\n');
  });

  test('an invalid fromStage does not recreate the worktree', async () => {
    const run = await startRun();
    await teardown(run.worktree, { reason: 'interrupted', runId: run.runId });

    const res = await api('POST', `/api/v1/runs/${run.runId}/resume`, { fromStage: 99 });

    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.ok(!fs.existsSync(run.worktree.path));
  });

  test('answers 409 and keeps the run as it was when the worktree cannot come back', async () => {
    const run = await startRun();
    await teardown(run.worktree, { reason: 'interrupted', runId: run.runId });
    const original = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');
    git(repo, 'checkout', '-q', run.worktree.branch);

    const res = await api('POST', `/api/v1/runs/${run.runId}/resume`);
    git(repo, 'checkout', '-q', original);

    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'WORKTREE_UNAVAILABLE');
    assert.equal((await api('GET', `/api/v1/runs/${run.runId}`)).body.status, 'paused');
  });
});
