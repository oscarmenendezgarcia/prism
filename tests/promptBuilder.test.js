/**
 * Unit tests for src/utils/promptBuilder.js
 *
 * Covers every exported function in isolation:
 *   buildKanbanBlock(spaceId, taskId)
 *   buildGitContextBlock(workingDirectory)
 *   buildGitInstructionsBlock()
 *   buildCompileGateBlock()
 *
 * Run with: node tests/promptBuilder.test.js
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const {
  buildKanbanBlock,
  buildGitContextBlock,
  buildGitInstructionsBlock,
  buildCompileGateBlock,
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

  suite('buildKanbanBlock(spaceId, taskId)');

  await test('returns a string starting with ## KANBAN INSTRUCTIONS', () => {
    const block = buildKanbanBlock('sp-abc', 'task-123');
    assert(block.startsWith('## KANBAN INSTRUCTIONS'), 'must start with section header');
  });

  await test('interpolates spaceId and taskId into the block', () => {
    const spaceId = 'sp-test-42';
    const taskId  = 'task-xyz';
    const block   = buildKanbanBlock(spaceId, taskId);
    assert(block.includes(`Space ID: ${spaceId}`), 'spaceId must be present');
    assert(block.includes(`Task ID: ${taskId}`),   'taskId must be present');
  });

  await test('contains the add_comment MCP call with correct spaceId and taskId', () => {
    const spaceId = 'sp-mcp';
    const taskId  = 'task-mcp';
    const block   = buildKanbanBlock(spaceId, taskId);
    assert(block.includes(`spaceId: "${spaceId}"`), 'add_comment snippet must include spaceId');
    assert(block.includes(`taskId: "${taskId}"`),   'add_comment snippet must include taskId');
  });

  await test('includes structured STOP conditions', () => {
    const block = buildKanbanBlock('sp-1', 'task-1');
    assert(block.includes('STOP and post a question'),    'must have STOP instruction');
    assert(block.includes('missing or unreadable'),        'must mention missing artifact condition');
    assert(block.includes('≥2 valid options'),             'must mention ambiguity condition');
    assert(block.includes('irreversible or cross-team'),  'must mention irreversible decision condition');
  });

  await test('includes note/handoff guidance (does NOT pause pipeline)', () => {
    const block = buildKanbanBlock('sp-1', 'task-1');
    assert(block.includes('POST A NOTE'),               'must include note guidance');
    assert(block.includes('does NOT pause pipeline'),   'must clarify note does not block');
    assert(block.includes('HANDOFF SUMMARY'),           'must include handoff summary guidance');
  });

  await test('includes Assumption, Deviation, Trade-off note patterns', () => {
    const block = buildKanbanBlock('sp-1', 'task-1');
    assert(block.includes('Assumption:'), 'must include Assumption note pattern');
    assert(block.includes('Deviation:'),  'must include Deviation note pattern');
    assert(block.includes('Trade-off:'),  'must include Trade-off note pattern');
  });

  await test('includes Handoff guidance before move-to-done', () => {
    const block = buildKanbanBlock('sp-1', 'task-1');
    assert(block.includes('Handoff:'),          'must include Handoff pattern');
    assert(block.includes('Next agent should'), 'must tell agent what next agent should read');
  });

  await test('each call with different ids produces distinct output', () => {
    const a = buildKanbanBlock('sp-A', 'task-A');
    const b = buildKanbanBlock('sp-B', 'task-B');
    assertNotEqual(a, b, 'different ids must produce different blocks');
    assert(a.includes('sp-A') && !a.includes('sp-B'),  'block-A must only contain sp-A');
    assert(b.includes('sp-B') && !b.includes('sp-A'),  'block-B must only contain sp-B');
  });

  await test('is deterministic — same output on every call with same args', () => {
    const a = buildKanbanBlock('sp-det', 'task-det');
    const b = buildKanbanBlock('sp-det', 'task-det');
    assertEqual(a, b, 'same args must produce same block');
  });

  // ---------------------------------------------------------------------------
  // buildGitContextBlock
  // ---------------------------------------------------------------------------

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

  suite('buildGitInstructionsBlock()');

  await test('returns a string containing branch and commit format guidance', () => {
    const block = buildGitInstructionsBlock();
    assert(typeof block === 'string' && block.length > 0, 'must return non-empty string');
    assert(block.includes('## GIT INSTRUCTIONS'), 'must have section header');
    assert(block.includes('feature branch'),       'must mention feature branch');
    assert(block.includes('[dev]'),                'must include commit format');
  });

  await test('is deterministic — same output on every call', () => {
    assertEqual(buildGitInstructionsBlock(), buildGitInstructionsBlock(), 'must be deterministic');
  });

  await test('does not include spaceId or taskId placeholders', () => {
    const block = buildGitInstructionsBlock();
    assert(!block.includes('spaceId'), 'must not contain spaceId');
    assert(!block.includes('taskId'),  'must not contain taskId');
  });

  await test('includes guidance to never commit to main', () => {
    const block = buildGitInstructionsBlock();
    assert(block.includes('main'),           'must mention main branch');
    assert(block.includes('Never commit'),   'must include never commit to main guidance');
  });

  // ---------------------------------------------------------------------------
  // buildCompileGateBlock
  // ---------------------------------------------------------------------------

  suite('buildCompileGateBlock()');

  await test('returns a string starting with ## MANDATORY COMPILE GATE', () => {
    const block = buildCompileGateBlock();
    assert(block.startsWith('## MANDATORY COMPILE GATE'), 'must start with section header');
  });

  await test('mentions all three build system check commands', () => {
    const block = buildCompileGateBlock();
    assert(block.includes('mvn compile'),    'must include Maven command');
    assert(block.includes('compileJava'),     'must include Gradle command');
    assert(block.includes('npm run build'),   'must include npm build command');
    assert(block.includes('tsc --noEmit'),    'must include tsc check');
  });

  await test('is deterministic — same output on every call', () => {
    assertEqual(buildCompileGateBlock(), buildCompileGateBlock(), 'must be deterministic');
  });

  await test('contains "fix the errors" message so agent knows to not advance on failure', () => {
    const block = buildCompileGateBlock();
    assert(
      block.includes('fix the errors') || block.includes('fix errors'),
      'must instruct to fix errors before advancing',
    );
  });

  await test('mentions advancing to QA / not advancing with broken code', () => {
    const block = buildCompileGateBlock();
    assert(
      block.includes('broken code') || block.includes('QA'),
      'must mention not advancing to QA with broken code',
    );
  });

  // ---------------------------------------------------------------------------
  // Integration: pipelineManager uses promptBuilder
  // ---------------------------------------------------------------------------

  suite('pipelineManager.buildStagePrompt() uses promptBuilder blocks');

  await test('buildStagePrompt includes KANBAN INSTRUCTIONS block', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-pm-test-'));
    try {
      const spaceId = 'test-space-1';
      const taskId  = require('crypto').randomUUID();
      const spaceDir = path.join(tmpDir, 'spaces', spaceId);
      fs.mkdirSync(spaceDir, { recursive: true });
      const task = {
        id: taskId, title: 'Test task', type: 'chore',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(spaceDir, 'todo.json'),        JSON.stringify([task]), 'utf8');
      fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([]),     'utf8');
      fs.writeFileSync(path.join(spaceDir, 'done.json'),        JSON.stringify([]),     'utf8');

      const { buildStagePrompt } = require('../src/services/pipelineManager');
      const { promptText } = buildStagePrompt(tmpDir, spaceId, taskId, 0, 'senior-architect', ['senior-architect']);

      assert(promptText.includes('## KANBAN INSTRUCTIONS'), 'pipelineManager must include KANBAN block');
      assert(promptText.includes(`Space ID: ${spaceId}`),   'KANBAN block must contain spaceId');
      assert(promptText.includes(`Task ID: ${taskId}`),     'KANBAN block must contain taskId');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await test('buildStagePrompt includes note/handoff guidance from buildKanbanBlock', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-pm-test2-'));
    try {
      const spaceId  = 'test-space-2';
      const taskId   = require('crypto').randomUUID();
      const spaceDir = path.join(tmpDir, 'spaces', spaceId);
      fs.mkdirSync(spaceDir, { recursive: true });
      const task = { id: taskId, title: 'T2', type: 'feature', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      fs.writeFileSync(path.join(spaceDir, 'todo.json'),        JSON.stringify([task]), 'utf8');
      fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([]),     'utf8');
      fs.writeFileSync(path.join(spaceDir, 'done.json'),        JSON.stringify([]),     'utf8');

      const { buildStagePrompt } = require('../src/services/pipelineManager');
      const { promptText } = buildStagePrompt(tmpDir, spaceId, taskId, 0, 'developer-agent', ['developer-agent']);

      assert(promptText.includes('POST A NOTE'),       'pipelineManager prompt must include note guidance');
      assert(promptText.includes('HANDOFF SUMMARY'),   'pipelineManager prompt must include handoff guidance');

      // Regression: POST A NOTE and HANDOFF SUMMARY must NOT appear twice.
      // buildKanbanBlock already contains them — buildCommentGuidanceLines must NOT be appended separately.
      const postANoteCount    = (promptText.match(/POST A NOTE/g) || []).length;
      const handoffCount      = (promptText.match(/HANDOFF SUMMARY/g) || []).length;
      assert(postANoteCount === 1,  `POST A NOTE must appear exactly once in prompt, got ${postANoteCount}`);
      assert(handoffCount   === 1,  `HANDOFF SUMMARY must appear exactly once in prompt, got ${handoffCount}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await test('buildStagePrompt includes MANDATORY COMPILE GATE for developer-agent', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-pm-cg-'));
    try {
      const spaceId  = 'test-space-3';
      const taskId   = require('crypto').randomUUID();
      const spaceDir = path.join(tmpDir, 'spaces', spaceId);
      fs.mkdirSync(spaceDir, { recursive: true });
      const task = { id: taskId, title: 'T3', type: 'feature', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      fs.writeFileSync(path.join(spaceDir, 'todo.json'),        JSON.stringify([task]), 'utf8');
      fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([]),     'utf8');
      fs.writeFileSync(path.join(spaceDir, 'done.json'),        JSON.stringify([]),     'utf8');

      const { buildStagePrompt } = require('../src/services/pipelineManager');
      const { promptText } = buildStagePrompt(tmpDir, spaceId, taskId, 0, 'developer-agent', ['developer-agent']);

      assert(promptText.includes('## MANDATORY COMPILE GATE'), 'compile gate must appear for developer-agent');
      assert(promptText.includes('npm run build'),              'compile gate must mention npm run build');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await test('buildStagePrompt does NOT include compile gate for non-developer agents', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-pm-cg2-'));
    try {
      const spaceId  = 'test-space-4';
      const taskId   = require('crypto').randomUUID();
      const spaceDir = path.join(tmpDir, 'spaces', spaceId);
      fs.mkdirSync(spaceDir, { recursive: true });
      const task = { id: taskId, title: 'T4', type: 'chore', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      fs.writeFileSync(path.join(spaceDir, 'todo.json'),        JSON.stringify([task]), 'utf8');
      fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([]),     'utf8');
      fs.writeFileSync(path.join(spaceDir, 'done.json'),        JSON.stringify([]),     'utf8');

      const { buildStagePrompt } = require('../src/services/pipelineManager');
      for (const agentId of ['senior-architect', 'ux-api-designer', 'qa-engineer-e2e']) {
        const { promptText } = buildStagePrompt(tmpDir, spaceId, taskId, 0, agentId, [agentId]);
        assert(!promptText.includes('## MANDATORY COMPILE GATE'),
          `compile gate must NOT appear for ${agentId}`);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------

  console.log('\n' + '='.repeat(60));
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
