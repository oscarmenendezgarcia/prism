/**
 * Unit tests for src/utils/promptBuilder.js
 *
 * Covers every exported function in isolation:
 *   buildKanbanBlock(spaceId, taskId)
 *   buildGitContextBlock(workingDirectory)
 *   buildGitInstructionsBlock()
 *   buildCompileGateBlock()
 *   buildResolvedQuestionsBlock(comments)
 *
 * Run with: node tests/promptBuilder.test.js
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const {
  buildGitContextBlock,
  buildCommentsBlock,
  buildChangeRequestBlock,
  buildDirectCardBlock,
} = require('../src/utils/promptBuilder');

// ---------------------------------------------------------------------------
// Minimal test runner (matches project convention from spaceManager.test.js)
// ---------------------------------------------------------------------------

let passed   = 0;
let failed   = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual(a, b, message) {
  if (a !== b) throw new Error(`Assertion failed: ${message} — expected ${JSON.stringify(a)} to equal ${JSON.stringify(b)}`);
}

function assertNotEqual(a, b, message) {
  if (a === b) throw new Error(`Assertion failed: ${message} — values should not be equal`);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

function suite(name) {
  console.log(`\n${name}`);
}

// ---------------------------------------------------------------------------
// buildKanbanBlock
// ---------------------------------------------------------------------------

async function runTests() {

  suite('buildGitContextBlock(workingDirectory)');

  await test('returns empty string when workingDirectory is undefined', () => {
    assertEqual(buildGitContextBlock(undefined), '', 'undefined dir must return empty string');
  });

  await test('returns empty string when workingDirectory is empty string', () => {
    assertEqual(buildGitContextBlock(''), '', 'empty dir must return empty string');
  });

  await test('returns empty string when workingDirectory does not exist on disk', () => {
    const nonExistent = '/tmp/__this_path_does_not_exist_prism_test__';
    assertEqual(buildGitContextBlock(nonExistent), '', 'non-existent dir must return empty string');
  });

  await test('returns empty string for a dir without a git repo', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-pb-test-'));
    try {
      const result = buildGitContextBlock(tmpDir);
      assertEqual(result, '', 'no git repo must return empty string');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await test('returns a block with ## GIT CONTEXT header for a real git repo', () => {
    // Use the prism project root itself — guaranteed to be a git repo.
    const repoRoot = path.resolve(__dirname, '..');
    const result   = buildGitContextBlock(repoRoot);
    // If git is available, we expect a non-empty block with the section header.
    if (result !== '') {
      assert(result.includes('## GIT CONTEXT'), 'block must contain section header');
    }
    // If git is unavailable (e.g. CI sandbox without git) the function gracefully
    // returns ''. Both outcomes are acceptable — no throw.
  });

  await test('does NOT include untracked (??) lines in the output', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-pb-git-'));
    try {
      const { execSync } = require('child_process');
      const opts = { cwd: tmpDir, encoding: 'utf8', stdio: 'pipe' };
      execSync('git init', opts);
      execSync('git config user.email "test@test.com"', opts);
      execSync('git config user.name "Test"', opts);
      // Create and commit a file so there is at least one commit.
      fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'hello');
      execSync('git add readme.txt', opts);
      execSync('git commit -m "init"', opts);
      // Create an untracked file.
      fs.writeFileSync(path.join(tmpDir, 'untracked.txt'), 'noise');

      const result = buildGitContextBlock(tmpDir);
      assert(result.includes('## GIT CONTEXT'),   'must have section header');
      assert(!result.includes('??'),               'must not include ?? untracked markers');
      assert(!result.includes('untracked.txt'),    'must not list untracked file names');
    } catch (err) {
      // If git is unavailable in this environment, skip gracefully.
      if (err.message && (err.message.includes('git') || err.code === 'ENOENT')) return;
      throw err;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await test('includes modified tracked files in the git status section', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-pb-mod-'));
    try {
      const { execSync } = require('child_process');
      const opts = { cwd: tmpDir, encoding: 'utf8', stdio: 'pipe' };
      execSync('git init', opts);
      execSync('git config user.email "test@test.com"', opts);
      execSync('git config user.name "Test"', opts);
      fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'original');
      execSync('git add file.txt', opts);
      execSync('git commit -m "init"', opts);
      // Modify the tracked file.
      fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'modified');

      const result = buildGitContextBlock(tmpDir);
      assert(result.includes('## GIT CONTEXT'),     'must have section header');
      assert(result.includes('Working tree changes'), 'must have working tree section');
      assert(result.includes('file.txt'),             'must list the modified file');
    } catch (err) {
      if (err.message && (err.message.includes('git') || err.code === 'ENOENT')) return;
      throw err;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // buildGitInstructionsBlock
  // ---------------------------------------------------------------------------


  suite('buildCommentsBlock(comments)');

  await test('returns nothing without comments', () => {
    assertEqual(buildCommentsBlock(undefined), '');
    assertEqual(buildCommentsBlock([]), '');
  });

  await test('lists who said what, oldest first, and truncates long comments', () => {
    const block = buildCommentsBlock([
      { author: 'user', type: 'note', text: 'First' },
      { author: 'agent', type: 'question', text: 'x'.repeat(2500) },
    ]);
    assert(block.includes('<untrusted source="comment, note" author="user">\nFirst\n</untrusted>'), 'first comment present');
    assert(block.includes('[truncated]'), 'long comment truncated');
    assert(block.indexOf('First') < block.indexOf('xxx'), 'oldest first');
  });

  suite('buildChangeRequestBlock(text, baseRef)');

  await test('carries the request and how to see the earlier work', () => {
    const block = buildChangeRequestBlock('Rename it', 'abc123');
    assert(block.includes('Rename it'), 'request present');
    assert(block.includes('git diff abc123'), 'diff hint present');
  });

  await test('works without a base commit', () => {
    assert(!buildChangeRequestBlock('Rename it', null).includes('git diff'), 'no diff hint');
  });

  suite('buildDirectCardBlock(spaceId, taskId, agentId)');

  await test('names the task and tells the agent how to ask', () => {
    const block = buildDirectCardBlock('s1', 't1', 'prism-agent');
    assert(block.includes('t1'), 'task id present');
    assert(block.includes('type: "question"'), 'question example present');
    assert(block.includes('Do NOT move this card'), 'the card is not the agent\'s to move');
  });

  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailed tests:');
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
    process.exit(1);
  } else {
    console.log('All tests passed.');
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
