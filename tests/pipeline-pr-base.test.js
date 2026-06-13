/**
 * MERGE-1 — PR base branch injection
 *
 * An isolated run is branched off run.worktree.baseBranch. buildStagePrompt
 * must announce that base branch so the developer-agent targets it with
 * `gh pr create --base <baseBranch>` — keeping the PR scoped to this run's
 * commits and merging back where the run came from (not the repo default).
 *
 * Kept in its own file so the pipelineManager module's _store stays null and
 * readRun() resolves the run from the run.json we write here.
 *
 * Run with: node --test tests/pipeline-pr-base.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const { provision, teardown } = require('../src/services/worktreeManager');
const { buildStagePrompt }    = require('../src/services/pipelineManager');

delete process.env.PIPELINE_RUNS_DIR;

function tmpDir(prefix = 'prism-prbase-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeTempRepo() {
  const dir = tmpDir('prism-repo-');
  execFileSync('git', ['init', dir], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@test.com'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n', 'utf8');
  execFileSync('git', ['-C', dir, 'add', '.'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'commit', '-m', 'init'], { stdio: 'ignore' });
  return dir;
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe('MERGE-1 — buildStagePrompt announces the PR base branch', () => {
  test('worktree run: prompt includes PR Base Branch + gh pr create --base hint', async () => {
    const dataDir  = tmpDir();
    const repoPath = makeTempRepo();
    const spaceId  = 'space-1';
    const taskId   = crypto.randomUUID();
    const spaceDir = path.join(dataDir, 'spaces', spaceId);
    fs.mkdirSync(spaceDir, { recursive: true });
    const task = { id: taskId, title: 'T', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(spaceDir, 'todo.json'), JSON.stringify([task]), 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([]), 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'done.json'), JSON.stringify([]), 'utf8');

    const runId = crypto.randomUUID();
    let meta;
    try {
      meta = await provision(repoPath, runId);
      // Persist the run so buildStagePrompt's readRun() can resolve its baseBranch.
      const runDirPath = path.join(dataDir, 'runs', runId);
      fs.mkdirSync(runDirPath, { recursive: true });
      fs.writeFileSync(path.join(runDirPath, 'run.json'), JSON.stringify({
        runId, spaceId, taskId, stages: ['developer-agent'], currentStage: 0,
        status: 'running', workingDirectory: repoPath, worktree: meta,
      }), 'utf8');

      const { promptText } = buildStagePrompt(
        dataDir, spaceId, taskId, 0, 'developer-agent', ['developer-agent'], meta.path, runId
      );

      assert.ok(
        promptText.includes(`PR Base Branch: ${meta.baseBranch}`),
        'prompt should announce the PR base branch'
      );
      assert.ok(
        promptText.includes(`gh pr create --base ${meta.baseBranch}`),
        'prompt should hint targeting the base branch with gh pr create --base'
      );
    } finally {
      if (meta) await teardown(meta, { reason: 'test_cleanup', runId });
      rmrf(dataDir);
      rmrf(repoPath);
    }
  });

  test('solo/direct call without a persisted run: no PR Base Branch line (no crash)', () => {
    const dataDir  = tmpDir();
    const repoPath = makeTempRepo();
    const spaceId  = 'space-1';
    const taskId   = crypto.randomUUID();
    const spaceDir = path.join(dataDir, 'spaces', spaceId);
    fs.mkdirSync(spaceDir, { recursive: true });
    const task = { id: taskId, title: 'T', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(spaceDir, 'todo.json'), JSON.stringify([task]), 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([]), 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'done.json'), JSON.stringify([]), 'utf8');

    try {
      const { promptText } = buildStagePrompt(
        dataDir, spaceId, taskId, 0, 'developer-agent', ['developer-agent'], repoPath, 'no-such-run'
      );
      assert.ok(!promptText.includes('PR Base Branch:'), 'no base-branch line when the run has no worktree');
    } finally {
      rmrf(dataDir);
      rmrf(repoPath);
    }
  });
});
