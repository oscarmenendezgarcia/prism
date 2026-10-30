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
