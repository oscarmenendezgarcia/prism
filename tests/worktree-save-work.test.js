'use strict';

/**
 * Removing a run's worktree must never lose what the agent wrote.
 * Run with: node --test tests/worktree-save-work.test.js
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const { execFileSync } = require('child_process');

const { provision, saveWork, teardown, reapOrphans } = require('../src/services/worktreeManager');

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

describe('worktreeManager — saving uncommitted work', () => {
  let repo;
  let meta;
  let runId;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-save-'));
    execFileSync('git', ['init', '-q', repo]);
    git(repo, 'config', 'user.email', 'test@test.com');
    git(repo, 'config', 'user.name', 'Test');
    fs.writeFileSync(path.join(repo, 'README.md'), '# test\n');
    fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.log\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'init');
    runId = crypto.randomUUID();
    meta  = await provision(repo, runId);
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('teardown commits modified and new files to the run branch', async () => {
    fs.writeFileSync(path.join(meta.path, 'README.md'), '# changed\n');
    fs.mkdirSync(path.join(meta.path, 'src'));
    fs.writeFileSync(path.join(meta.path, 'src', 'new.js'), 'module.exports = 1;\n');

    await teardown(meta, { reason: 'completed', runId });

    assert.ok(!fs.existsSync(meta.path), 'the worktree is removed once the work is safe');
    assert.equal(git(repo, 'show', `${meta.branch}:README.md`), '# changed');
    assert.equal(git(repo, 'show', `${meta.branch}:src/new.js`), 'module.exports = 1;');
    assert.match(git(repo, 'log', '-1', '--format=%s', meta.branch), /save uncommitted work \(completed\)/);
  });

  test('a clean worktree gets no extra commit', async () => {
    const before = git(repo, 'rev-parse', meta.branch);
    assert.deepEqual(await saveWork(meta), { saved: false, ref: null });
    assert.equal(git(repo, 'rev-parse', meta.branch), before);
  });

  test('gitignored files are not committed', async () => {
    fs.writeFileSync(path.join(meta.path, 'ignored.log'), 'noise\n');
    fs.writeFileSync(path.join(meta.path, 'kept.txt'), 'kept\n');

    await saveWork(meta);

    assert.equal(git(repo, 'show', `${meta.branch}:kept.txt`), 'kept');
    assert.throws(() => git(repo, 'cat-file', '-e', `${meta.branch}:ignored.log`));
  });

  test('a failing pre-commit hook cannot block the save', async () => {
    const hooks = path.join(repo, 'failing-hooks');
    fs.mkdirSync(hooks);
    fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    git(repo, 'config', 'core.hooksPath', hooks);
    fs.writeFileSync(path.join(meta.path, 'kept.txt'), 'kept\n');

    assert.deepEqual(await saveWork(meta), { saved: true, ref: null });
  });

  test('saves with no git identity configured', async () => {
    git(repo, 'config', '--unset', 'user.email');
    git(repo, 'config', '--unset', 'user.name');
    fs.writeFileSync(path.join(meta.path, 'kept.txt'), 'kept\n');

    assert.deepEqual(await saveWork(meta), { saved: true, ref: null });
    assert.equal(git(repo, 'log', '-1', '--format=%an', meta.branch), 'Prism');
  });

  test('the worktree stays on disk when the work cannot be saved', async () => {
    fs.writeFileSync(path.join(meta.path, 'kept.txt'), 'kept\n');
    const lock = path.join(repo, '.git', 'worktrees', path.basename(meta.path), 'index.lock');
    fs.writeFileSync(lock, '');

    await teardown(meta, { reason: 'failed', runId });

    assert.ok(fs.existsSync(path.join(meta.path, 'kept.txt')), 'the work must survive');
    fs.unlinkSync(lock);
    await teardown(meta, { reason: 'failed', runId });
    assert.ok(!fs.existsSync(meta.path), 'the next attempt saves and removes');
    assert.equal(git(repo, 'show', `${meta.branch}:kept.txt`), 'kept');
  });

  test('work on a detached HEAD stays reachable', async () => {
    git(meta.path, 'checkout', '-q', '--detach');
    fs.writeFileSync(path.join(meta.path, 'kept.txt'), 'kept\n');

    await teardown(meta, { reason: 'failed', runId });

    assert.equal(git(repo, 'show', `${meta.branch}-saved:kept.txt`), 'kept');
  });

  test('new files are saved even when status hides untracked files', async () => {
    git(repo, 'config', 'status.showUntrackedFiles', 'no');
    fs.writeFileSync(path.join(meta.path, 'kept.txt'), 'kept\n');

    await teardown(meta, { reason: 'failed', runId });

    assert.equal(git(repo, 'show', `${meta.branch}:kept.txt`), 'kept');
  });

  test('a directory that is not a worktree root never commits the parent checkout', async () => {
    const broken = path.join(repo, '.worktrees', 'run-broken0');
    fs.mkdirSync(broken, { recursive: true });
    fs.writeFileSync(path.join(repo, 'user-work.txt'), 'mine\n');
    const before = git(repo, 'rev-parse', 'HEAD');

    await assert.rejects(() => saveWork({ path: broken, branch: 'pipeline/run-broken0' }), /not a worktree root/);
    await teardown({ path: broken, branch: 'pipeline/run-broken0' }, { reason: 'orphan' });

    assert.equal(git(repo, 'rev-parse', 'HEAD'), before);
    assert.match(git(repo, 'status', '--porcelain'), /\?\? user-work\.txt/);
    assert.ok(fs.existsSync(broken), 'left for a human to inspect');
  });

  test('a worktree holding a nested repo is kept, not reduced to a gitlink', async () => {
    const nested = path.join(meta.path, 'sub');
    fs.mkdirSync(nested);
    execFileSync('git', ['init', '-q', nested]);
    git(nested, 'config', 'user.email', 'test@test.com');
    git(nested, 'config', 'user.name', 'Test');
    fs.writeFileSync(path.join(nested, 'a.txt'), 'a\n');
    git(nested, 'add', '.');
    git(nested, 'commit', '-qm', 'nested');

    await teardown(meta, { reason: 'failed', runId });

    assert.ok(fs.existsSync(path.join(nested, 'a.txt')), 'the nested work must survive');
  });

  test('a worktree with a dirty submodule is kept', async () => {
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-save-lib-'));
    try {
      execFileSync('git', ['init', '-q', lib]);
      git(lib, 'config', 'user.email', 'test@test.com');
      git(lib, 'config', 'user.name', 'Test');
      fs.writeFileSync(path.join(lib, 'lib.txt'), 'lib\n');
      git(lib, 'add', '.');
      git(lib, 'commit', '-qm', 'lib');
      git(meta.path, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', lib, 'vendor');
      git(meta.path, 'commit', '-qm', 'add submodule');
      fs.writeFileSync(path.join(meta.path, 'vendor', 'lib.txt'), 'edited\n');

      await teardown(meta, { reason: 'failed', runId });

      assert.equal(fs.readFileSync(path.join(meta.path, 'vendor', 'lib.txt'), 'utf8'), 'edited\n');
    } finally {
      fs.rmSync(lib, { recursive: true, force: true });
    }
  });

  test('deleteBranch keeps a branch that now holds saved work', async () => {
    fs.writeFileSync(path.join(meta.path, 'kept.txt'), 'kept\n');

    await teardown(meta, { reason: 'failed', runId, deleteBranch: true });

    assert.equal(git(repo, 'show', `${meta.branch}:kept.txt`), 'kept');
  });

  test('deleteBranch still deletes a branch with nothing to save', async () => {
    await teardown(meta, { reason: 'failed', runId, deleteBranch: true });

    assert.equal(git(repo, 'branch', '--list', meta.branch), '');
  });

  test('the startup sweep saves work from orphaned worktrees', async () => {
    fs.writeFileSync(path.join(meta.path, 'kept.txt'), 'kept\n');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-save-data-'));
    try {
      await reapOrphans(dataDir, [repo]);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }

    assert.ok(!fs.existsSync(meta.path));
    assert.equal(git(repo, 'show', `${meta.branch}:kept.txt`), 'kept');
  });
});
