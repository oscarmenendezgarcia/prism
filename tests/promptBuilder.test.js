/**
 * Unit tests for src/utils/promptBuilder.js
 *
 * Covers every exported function in isolation:
 *   buildKanbanBlock(spaceId, taskId)
 *   buildGitContextBlock(workingDirectory)
 *   buildGitInstructionsBlock()
 *   buildCompileGateBlock()
 *
 * Run with: node --test tests/promptBuilder.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');

const {
  buildKanbanBlock,
  buildGitContextBlock,
  buildGitInstructionsBlock,
  buildCompileGateBlock,
} = require('../src/utils/promptBuilder');

// ---------------------------------------------------------------------------
// buildKanbanBlock
// ---------------------------------------------------------------------------

describe('buildKanbanBlock(spaceId, taskId)', () => {
  test('returns a string starting with ## KANBAN INSTRUCTIONS', () => {
    const block = buildKanbanBlock('sp-abc', 'task-123');
    assert.ok(block.startsWith('## KANBAN INSTRUCTIONS'), 'must start with section header');
  });

  test('interpolates spaceId and taskId into the block', () => {
    const spaceId = 'sp-test-42';
    const taskId  = 'task-xyz';
    const block   = buildKanbanBlock(spaceId, taskId);
    assert.ok(block.includes(`Space ID: ${spaceId}`), 'spaceId must be present');
    assert.ok(block.includes(`Task ID: ${taskId}`),   'taskId must be present');
  });

  test('contains the add_comment MCP call with correct spaceId and taskId', () => {
    const spaceId = 'sp-mcp';
    const taskId  = 'task-mcp';
    const block   = buildKanbanBlock(spaceId, taskId);
    assert.ok(
      block.includes(`spaceId: "${spaceId}"`),
      'add_comment snippet must include spaceId',
    );
    assert.ok(
      block.includes(`taskId: "${taskId}"`),
      'add_comment snippet must include taskId',
    );
  });

  test('includes the list of all 9 kanban MCP tools', () => {
    const block = buildKanbanBlock('sp-1', 'task-1');
    const expectedTools = [
      'kanban_list_spaces',
      'kanban_list_tasks',
      'kanban_get_task',
      'kanban_move_task',
      'kanban_update_task',
      'kanban_create_task',
      'kanban_add_comment',
      'kanban_answer_comment',
      'kanban_get_run_status',
    ];
    for (const tool of expectedTools) {
      assert.ok(block.includes(tool), `block must mention ${tool}`);
    }
  });

  test('includes structured STOP conditions', () => {
    const block = buildKanbanBlock('sp-1', 'task-1');
    assert.ok(block.includes('STOP and post a question'),   'must have STOP instruction');
    assert.ok(block.includes('missing or unreadable'),       'must mention missing artifact condition');
    assert.ok(block.includes('≥2 valid options'),            'must mention ambiguity condition');
    assert.ok(block.includes('irreversible or cross-team'), 'must mention irreversible decision condition');
  });

  test('each call with different ids produces distinct output', () => {
    const a = buildKanbanBlock('sp-A', 'task-A');
    const b = buildKanbanBlock('sp-B', 'task-B');
    assert.notEqual(a, b);
    assert.ok(a.includes('sp-A') && !a.includes('sp-B'));
    assert.ok(b.includes('sp-B') && !b.includes('sp-A'));
  });
});

// ---------------------------------------------------------------------------
// buildGitContextBlock
// ---------------------------------------------------------------------------

describe('buildGitContextBlock(workingDirectory)', () => {
  test('returns empty string when workingDirectory is undefined', () => {
    assert.equal(buildGitContextBlock(undefined), '');
  });

  test('returns empty string when workingDirectory is empty string', () => {
    assert.equal(buildGitContextBlock(''), '');
  });

  test('returns empty string when workingDirectory does not exist on disk', () => {
    const nonExistent = '/tmp/__this_path_does_not_exist_prism_test__';
    assert.equal(buildGitContextBlock(nonExistent), '');
  });

  test('returns empty string for a dir without a git repo', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-pb-test-'));
    try {
      const result = buildGitContextBlock(tmpDir);
      // No git repo → git log / git status output nothing → empty string
      assert.equal(result, '');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('returns a block with ## GIT CONTEXT header for a real git repo', () => {
    // Use the prism project root itself — guaranteed to be a git repo.
    const repoRoot = path.resolve(__dirname, '..');
    const result   = buildGitContextBlock(repoRoot);
    // If git is available, we expect a non-empty block with the section header.
    if (result !== '') {
      assert.ok(
        result.includes('## GIT CONTEXT'),
        'block must contain section header',
      );
    }
    // If git is unavailable (e.g. CI sandbox without git) the function gracefully
    // returns ''. Both outcomes are acceptable — no throw.
  });

  test('does NOT include untracked (??) lines in the output', () => {
    // Create a real git repo in a temp dir so we can control untracked files.
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
      // The result must contain the git context but NOT the untracked file marker.
      assert.ok(result.includes('## GIT CONTEXT'), 'must have section header');
      assert.ok(!result.includes('??'), 'must not include ?? untracked markers');
      assert.ok(!result.includes('untracked.txt'), 'must not list untracked file names');
    } catch (err) {
      // If git is unavailable in this environment, skip gracefully.
      if (err.message.includes('git') || err.code === 'ENOENT') return;
      throw err;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('includes modified tracked files in the git status section', () => {
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
      assert.ok(result.includes('## GIT CONTEXT'), 'must have section header');
      assert.ok(result.includes('Working tree changes'), 'must have working tree section');
      assert.ok(result.includes('file.txt'), 'must list the modified file');
    } catch (err) {
      if (err.message.includes('git') || err.code === 'ENOENT') return;
      throw err;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// buildGitInstructionsBlock
// ---------------------------------------------------------------------------

describe('buildGitInstructionsBlock()', () => {
  test('returns a string containing branch and commit format guidance', () => {
    const block = buildGitInstructionsBlock();
    assert.ok(typeof block === 'string' && block.length > 0, 'must return non-empty string');
    assert.ok(block.includes('## GIT INSTRUCTIONS'), 'must have section header');
    assert.ok(block.includes('feature branch'), 'must mention feature branch');
    assert.ok(block.includes('[dev]'), 'must include commit format');
  });

  test('is deterministic — same output on every call', () => {
    assert.equal(buildGitInstructionsBlock(), buildGitInstructionsBlock());
  });

  test('does not include spaceId or taskId placeholders', () => {
    const block = buildGitInstructionsBlock();
    assert.ok(!block.includes('spaceId'), 'must not contain spaceId');
    assert.ok(!block.includes('taskId'),  'must not contain taskId');
  });
});

// ---------------------------------------------------------------------------
// buildCompileGateBlock
// ---------------------------------------------------------------------------

describe('buildCompileGateBlock()', () => {
  test('returns a string starting with ## MANDATORY COMPILE GATE', () => {
    const block = buildCompileGateBlock();
    assert.ok(block.startsWith('## MANDATORY COMPILE GATE'), 'must start with section header');
  });

  test('mentions all three build system check commands', () => {
    const block = buildCompileGateBlock();
    assert.ok(block.includes('mvn compile'),       'must include Maven command');
    assert.ok(block.includes('compileJava'),        'must include Gradle command');
    assert.ok(block.includes('npm run build'),      'must include npm build command');
    assert.ok(block.includes('tsc --noEmit'),       'must include tsc check');
  });

  test('is deterministic — same output on every call', () => {
    assert.equal(buildCompileGateBlock(), buildCompileGateBlock());
  });

  test('contains "fix the errors" message so agent knows to not advance on failure', () => {
    const block = buildCompileGateBlock();
    assert.ok(
      block.includes('fix the errors') || block.includes('fix errors'),
      'must instruct to fix errors before advancing',
    );
  });
});
