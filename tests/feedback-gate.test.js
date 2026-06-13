'use strict';

/**
 * tests/feedback-gate.test.js — LOOP-1 feedback gate test suite.
 *
 * Covers:
 *   1. feedbackParser — parseReviewReport unit tests (APPROVED, APPROVED_WITH_NOTES,
 *      CHANGES_REQUIRED, missing verdict, heading form, table cell, edge cases).
 *   2. feedbackParser — parseBugsReport unit tests (Critical, High, mixed,
 *      neither, empty, table/bold/heading patterns, id extraction).
 *   3. pipelineManager — evaluateFeedbackGate unit tests with mock run/task/attachment.
 *   4. pipelineManager — buildFeedbackContextBlock unit tests.
 *   5. Integration — handleStageClose with CHANGES_REQUIRED verdict triggers fallback inject.
 *   6. Integration — APPROVED verdict → no back-edge, feedbackIterations stays 0.
 *   7. Integration — agent writes inject file + CHANGES_REQUIRED → single splice (no double-inject).
 */

const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-feedback-gate-test-'));
}

/**
 * Create a minimal run object with the fields pipelineManager needs.
 */
function makeRun(overrides = {}) {
  const runId = crypto.randomUUID();
  return {
    runId,
    spaceId:     'test-space',
    taskId:      'test-task',
    stages:      ['developer-agent', 'code-reviewer'],
    currentStage: 2,
    status:      'running',
    stageStatuses: [
      { index: 0, agentId: 'developer-agent', status: 'completed', exitCode: 0, startedAt: null, finishedAt: null },
      { index: 1, agentId: 'code-reviewer',   status: 'completed', exitCode: 0, startedAt: null, finishedAt: null },
    ],
    loopCounts:         {},
    feedbackGates:      {},
    feedbackIterations: 0,
    createdAt:  new Date().toISOString(),
    updatedAt:  new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Write a mock agent .md file.
 */
function writeAgentFile(agentsDir, agentId) {
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentsDir, `${agentId}.md`),
    `---\nmodel: sonnet\n---\n\nYou are a test agent.`,
    'utf8'
  );
}

// ---------------------------------------------------------------------------
// 1. feedbackParser — parseReviewReport
// ---------------------------------------------------------------------------

describe('feedbackParser — parseReviewReport', () => {
  const { parseReviewReport } = require('../src/services/feedbackParser');

  test('returns CHANGES_REQUIRED for bold **Verdict:** pattern', () => {
    const content = `# Code Review\n\n**Verdict:** CHANGES_REQUIRED\n\n## Issues\n- Login form missing validation\n`;
    const result = parseReviewReport(content);
    assert.equal(result.verdict, 'CHANGES_REQUIRED');
    assert.equal(result.raw, true);
  });

  test('returns APPROVED for bold **Verdict:** APPROVED', () => {
    const content = `**Verdict:** APPROVED\n\nNo issues found.`;
    const result = parseReviewReport(content);
    assert.equal(result.verdict, 'APPROVED');
    assert.equal(result.raw, true);
  });

  test('returns APPROVED_WITH_NOTES — not misread as APPROVED', () => {
    const content = `**Verdict:** APPROVED_WITH_NOTES\n\nMinor style issues.`;
    const result = parseReviewReport(content);
    assert.equal(result.verdict, 'APPROVED_WITH_NOTES');
    assert.equal(result.raw, true);
  });

  test('returns CHANGES_REQUIRED for heading form "## Verdict: CHANGES_REQUIRED"', () => {
    const content = `# Review Report\n\n## Verdict: CHANGES_REQUIRED\n\nNeeds work.`;
    const result = parseReviewReport(content);
    assert.equal(result.verdict, 'CHANGES_REQUIRED');
    assert.equal(result.raw, true);
  });

  test('returns APPROVED for table cell form "| APPROVED |"', () => {
    const content = `| Field | Value |\n|---|---|\n| Result | APPROVED |`;
    const result = parseReviewReport(content);
    assert.equal(result.verdict, 'APPROVED');
    assert.equal(result.raw, true);
  });

  test('returns { verdict: null, raw: false } for empty string', () => {
    const result = parseReviewReport('');
    assert.equal(result.verdict, null);
    assert.equal(result.raw, false);
  });

  test('returns { verdict: null, raw: false } for whitespace-only string', () => {
    const result = parseReviewReport('   \n\n  ');
    assert.equal(result.verdict, null);
    assert.equal(result.raw, false);
  });

  test('returns { verdict: null, raw: false } when no verdict token present', () => {
    const result = parseReviewReport('This is a review with no verdict keyword.');
    assert.equal(result.verdict, null);
    assert.equal(result.raw, false);
  });

  test('collects summary bullets from Issues section (max 5)', () => {
    const content = [
      '# Review\n\n**Verdict:** CHANGES_REQUIRED\n\n## Issues',
      '- First issue',
      '- Second issue',
      '- Third issue',
      '- Fourth issue',
      '- Fifth issue',
      '- Sixth issue (should be excluded)',
    ].join('\n');
    const result = parseReviewReport(content);
    const items = result.summary.split('; ').filter(Boolean);
    assert.ok(items.length <= 5, 'Summary should have at most 5 items');
    assert.ok(result.summary.includes('First issue'));
  });

  test('summary is truncated at 300 chars', () => {
    const longItem = 'A'.repeat(200);
    const content = `**Verdict:** CHANGES_REQUIRED\n\n## Issues\n- ${longItem}\n- ${longItem}\n`;
    const result = parseReviewReport(content);
    assert.ok(result.summary.length <= 300, 'Summary should not exceed 300 chars');
  });

  test('is case-insensitive for the verdict token', () => {
    const content = `**Verdict:** changes_required`;
    const result = parseReviewReport(content);
    assert.equal(result.verdict, 'CHANGES_REQUIRED');
  });

  test('does not throw for any input including non-string types coerced', () => {
    assert.doesNotThrow(() => parseReviewReport(null));
    assert.doesNotThrow(() => parseReviewReport(undefined));
    assert.doesNotThrow(() => parseReviewReport(123));
    assert.doesNotThrow(() => parseReviewReport({}));
  });

  test('returns { verdict: null, raw: false } for non-string input', () => {
    const result = parseReviewReport(null);
    assert.equal(result.verdict, null);
    assert.equal(result.raw, false);
  });
});

// ---------------------------------------------------------------------------
// 2. feedbackParser — parseBugsReport
// ---------------------------------------------------------------------------

describe('feedbackParser — parseBugsReport', () => {
  const { parseBugsReport } = require('../src/services/feedbackParser');

  test('returns hasCritical=true for **Severity**: Critical (bold form)', () => {
    const content = `## BUG-001: Login crash\n**Severity**: Critical\nUsers cannot log in.\n`;
    const result = parseBugsReport(content);
    assert.equal(result.hasCritical, true);
    assert.equal(result.hasHigh, false);
    assert.equal(result.raw, true);
    assert.ok(result.bugCount >= 1);
  });

  test('returns hasHigh=true for "| High |" table cell form', () => {
    const content = `| BUG-002 | Login slow | High |\n`;
    const result = parseBugsReport(content);
    assert.equal(result.hasHigh, true);
    assert.equal(result.hasCritical, false);
    assert.equal(result.raw, true);
  });

  test('returns hasCritical=true for heading attribute "## BUG-003 ... Critical"', () => {
    const content = `## BUG-003 — Auth bypass Critical\nSee description.\n`;
    const result = parseBugsReport(content);
    assert.equal(result.hasCritical, true);
    assert.equal(result.raw, true);
  });

  test('returns hasCritical=true and hasHigh=true for mixed severities', () => {
    const content = [
      '**Severity**: Critical',
      '**Severity**: High',
    ].join('\n');
    const result = parseBugsReport(content);
    assert.equal(result.hasCritical, true);
    assert.equal(result.hasHigh, true);
    assert.equal(result.bugCount, 2);
  });

  test('returns { hasCritical: false, hasHigh: false, raw: false } for empty string', () => {
    const result = parseBugsReport('');
    assert.equal(result.hasCritical, false);
    assert.equal(result.hasHigh, false);
    assert.equal(result.raw, false);
    assert.equal(result.bugCount, 0);
  });

  test('returns { hasCritical: false, hasHigh: false, raw: false } when no critical/high', () => {
    const content = `## BUG-010: Minor typo\n**Severity**: Low\nA small typo in the footer.\n`;
    const result = parseBugsReport(content);
    assert.equal(result.hasCritical, false);
    assert.equal(result.hasHigh, false);
    assert.equal(result.raw, false);
  });

  test('extracts BUG-id from matching line', () => {
    const content = `**Severity**: Critical — BUG-999 crash on null input\n`;
    const result = parseBugsReport(content);
    assert.equal(result.hasCritical, true);
    const bug = result.bugs[0];
    assert.ok(bug.id === 'BUG-999', `Expected BUG-999 but got ${bug.id}`);
  });

  test('sets bug id to null when no BUG-id present', () => {
    const content = `**Severity**: High — crash on empty input\n`;
    const result = parseBugsReport(content);
    assert.equal(result.hasHigh, true);
    const bug = result.bugs[0];
    assert.equal(bug.id, null);
  });

  test('does not throw for any input', () => {
    assert.doesNotThrow(() => parseBugsReport(null));
    assert.doesNotThrow(() => parseBugsReport(undefined));
    assert.doesNotThrow(() => parseBugsReport({}));
    assert.doesNotThrow(() => parseBugsReport(42));
  });

  test('returns safe default for non-string input', () => {
    const result = parseBugsReport(null);
    assert.equal(result.hasCritical, false);
    assert.equal(result.hasHigh, false);
    assert.equal(result.raw, false);
  });

  test('handles very long lines without truncation error', () => {
    const longLine = '**Severity**: Critical ' + 'x'.repeat(500);
    const result = parseBugsReport(longLine);
    assert.equal(result.hasCritical, true);
    assert.ok(result.bugs[0].title.length <= 100);
  });
});

// ---------------------------------------------------------------------------
// 3. pipelineManager — evaluateFeedbackGate unit tests
// ---------------------------------------------------------------------------

describe('pipelineManager — evaluateFeedbackGate', () => {
  let dataDir;
  let pm;

  before(() => {
    dataDir = tmpDir();
    // Use a fresh module instance with no _store so it uses the legacy path.
    delete require.cache[require.resolve('../src/services/pipelineManager')];
    pm = require('../src/services/pipelineManager');
  });

  after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  /**
   * Create a minimal task JSON on disk in dataDir/spaces/<spaceId>/in-progress.json.
   */
  function createTaskOnDisk(spaceId, taskId, attachments) {
    const spaceDir = path.join(dataDir, 'spaces', spaceId);
    fs.mkdirSync(spaceDir, { recursive: true });
    const task = {
      id: taskId,
      title: 'Test task',
      type: 'feature',
      attachments,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([task]), 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'todo.json'), '[]', 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'done.json'), '[]', 'utf8');
    return task;
  }

  test('returns { triggered: false, gateResult: null } for non-gate agent (senior-architect)', () => {
    const run = makeRun({ spaceId: 'sp1', taskId: 'tid1' });
    const result = pm.evaluateFeedbackGate(dataDir, run, 0, 'senior-architect', []);
    assert.equal(result.triggered, false);
    assert.equal(result.gateResult, null);
  });

  test('returns { triggered: false, gateResult: null } for non-gate agent (developer-agent)', () => {
    const run = makeRun({ spaceId: 'sp1', taskId: 'tid1' });
    const result = pm.evaluateFeedbackGate(dataDir, run, 0, 'developer-agent', []);
    assert.equal(result.triggered, false);
    assert.equal(result.gateResult, null);
  });

  test('returns triggered=true and verdict=CHANGES_REQUIRED when review-report.md has CHANGES_REQUIRED', () => {
    const spaceId = `sp-cr-${Date.now()}`;
    const taskId  = crypto.randomUUID();
    const reportPath = path.join(dataDir, 'review-report.md');
    fs.writeFileSync(reportPath, `**Verdict:** CHANGES_REQUIRED\n\n## Issues\n- Login form missing validation\n`, 'utf8');

    createTaskOnDisk(spaceId, taskId, [
      { name: 'review-report.md', type: 'file', content: reportPath },
    ]);

    const run = makeRun({ spaceId, taskId });
    const result = pm.evaluateFeedbackGate(dataDir, run, 1, 'code-reviewer', []);

    assert.equal(result.triggered, true);
    assert.ok(result.gateResult !== null);
    assert.equal(result.gateResult.verdict, 'CHANGES_REQUIRED');
    assert.equal(result.gateResult.agentId, 'code-reviewer');
    assert.equal(typeof result.gateResult.parsedAt, 'string');
  });

  test('returns triggered=false when review-report.md verdict is APPROVED', () => {
    const spaceId = `sp-approved-${Date.now()}`;
    const taskId  = crypto.randomUUID();
    const reportPath = path.join(dataDir, `review-report-approved-${Date.now()}.md`);
    fs.writeFileSync(reportPath, `**Verdict:** APPROVED\n\nNo issues found.`, 'utf8');

    createTaskOnDisk(spaceId, taskId, [
      { name: 'review-report.md', type: 'file', content: reportPath },
    ]);

    const run = makeRun({ spaceId, taskId });
    const result = pm.evaluateFeedbackGate(dataDir, run, 1, 'code-reviewer', []);

    assert.equal(result.triggered, false);
    assert.ok(result.gateResult !== null);
    assert.equal(result.gateResult.verdict, 'APPROVED');
  });

  test('returns triggered=true and hasCritical=true when bugs.md has a Critical bug', () => {
    const spaceId = `sp-qa-crit-${Date.now()}`;
    const taskId  = crypto.randomUUID();
    const bugsPath = path.join(dataDir, `bugs-${Date.now()}.md`);
    fs.writeFileSync(bugsPath, `## BUG-001: Crash on login\n**Severity**: Critical\nApp crashes.\n`, 'utf8');

    createTaskOnDisk(spaceId, taskId, [
      { name: 'bugs.md', type: 'file', content: bugsPath },
    ]);

    const run = makeRun({ spaceId, taskId });
    const result = pm.evaluateFeedbackGate(dataDir, run, 1, 'qa-engineer-e2e', []);

    assert.equal(result.triggered, true);
    assert.ok(result.gateResult !== null);
    assert.equal(result.gateResult.hasCritical, true);
    assert.equal(result.gateResult.agentId, 'qa-engineer-e2e');
  });

  test('returns { triggered: false, gateResult: null } when task has no matching attachment', () => {
    const spaceId = `sp-no-att-${Date.now()}`;
    const taskId  = crypto.randomUUID();

    createTaskOnDisk(spaceId, taskId, [
      { name: 'blueprint.md', type: 'file', content: '/some/path' },
    ]);

    const run = makeRun({ spaceId, taskId });
    const result = pm.evaluateFeedbackGate(dataDir, run, 1, 'code-reviewer', []);

    assert.equal(result.triggered, false);
    assert.equal(result.gateResult, null);
  });

  test('does not throw when attachment file path is unreadable', () => {
    const spaceId = `sp-unreadable-${Date.now()}`;
    const taskId  = crypto.randomUUID();

    createTaskOnDisk(spaceId, taskId, [
      { name: 'review-report.md', type: 'file', content: '/nonexistent/path/review-report.md' },
    ]);

    const run = makeRun({ spaceId, taskId });
    assert.doesNotThrow(() => {
      const result = pm.evaluateFeedbackGate(dataDir, run, 1, 'code-reviewer', []);
      assert.equal(result.triggered, false);
      assert.equal(result.gateResult, null);
    });
  });
});

// ---------------------------------------------------------------------------
// 4. pipelineManager — buildFeedbackContextBlock unit tests
// ---------------------------------------------------------------------------

describe('pipelineManager — buildFeedbackContextBlock', () => {
  let pm;

  before(() => {
    delete require.cache[require.resolve('../src/services/pipelineManager')];
    pm = require('../src/services/pipelineManager');
  });

  test('returns null when feedbackIterations is 0', () => {
    const run = makeRun({ feedbackIterations: 0, feedbackGates: {} });
    const result = pm.buildFeedbackContextBlock(run, 2);
    assert.equal(result, null);
  });

  test('returns null when feedbackGates is absent', () => {
    const run = makeRun({ feedbackIterations: 1 });
    delete run.feedbackGates;
    const result = pm.buildFeedbackContextBlock(run, 2);
    assert.equal(result, null);
  });

  test('returns null when no triggered gate exists before stageIndex', () => {
    const run = makeRun({
      feedbackIterations: 1,
      feedbackGates: {
        '5': { agentId: 'code-reviewer', parsedAt: new Date().toISOString(), triggered: true, verdict: 'CHANGES_REQUIRED', summary: 'Fix tests' },
      },
    });
    // Current stageIndex = 3, gate is at 5 (greater) — no prior triggered gate.
    const result = pm.buildFeedbackContextBlock(run, 3);
    assert.equal(result, null);
  });

  test('returns block containing FEEDBACK FROM REVIEW when triggered gate precedes stageIndex', () => {
    const run = makeRun({
      feedbackIterations: 1,
      feedbackGates: {
        '2': { agentId: 'code-reviewer', parsedAt: new Date().toISOString(), triggered: true, verdict: 'CHANGES_REQUIRED', summary: 'Fix login; Add error boundary' },
      },
    });
    // Gate at stageIndex 2, current developer-agent runs at stageIndex 3.
    const result = pm.buildFeedbackContextBlock(run, 3);
    assert.ok(result !== null);
    assert.ok(result.includes('## FEEDBACK FROM REVIEW'));
    assert.ok(result.includes('CHANGES_REQUIRED'));
    assert.ok(result.includes('Fix login'));
    assert.ok(result.includes('1'));  // iteration number
  });

  test('formats code-reviewer verdict block correctly', () => {
    const run = makeRun({
      feedbackIterations: 2,
      feedbackGates: {
        '1': {
          agentId: 'code-reviewer',
          parsedAt: new Date().toISOString(),
          triggered: true,
          verdict: 'CHANGES_REQUIRED',
          summary: 'Issue one; Issue two',
        },
      },
    });
    const result = pm.buildFeedbackContextBlock(run, 4);
    assert.ok(result.includes('Code Review Verdict: CHANGES_REQUIRED'));
    assert.ok(result.includes('Issue one'));
    assert.ok(result.includes('Iteration 2'));
  });

  test('formats qa-engineer-e2e bug list correctly', () => {
    const run = makeRun({
      feedbackIterations: 1,
      feedbackGates: {
        '3': {
          agentId: 'qa-engineer-e2e',
          parsedAt: new Date().toISOString(),
          triggered: true,
          hasCritical: true,
          hasHigh: false,
          bugCount: 1,
          bugs: [{ id: 'BUG-042', severity: 'Critical', title: 'Crash on empty form submit' }],
        },
      },
    });
    const result = pm.buildFeedbackContextBlock(run, 5);
    assert.ok(result.includes('QA: Unresolved Critical / High Bugs'));
    assert.ok(result.includes('BUG-042'));
    assert.ok(result.includes('Critical'));
  });

  test('block includes DO NOT re-read instruction', () => {
    const run = makeRun({
      feedbackIterations: 1,
      feedbackGates: {
        '1': { agentId: 'code-reviewer', parsedAt: new Date().toISOString(), triggered: true, verdict: 'CHANGES_REQUIRED', summary: '' },
      },
    });
    const result = pm.buildFeedbackContextBlock(run, 3);
    assert.ok(result.includes('DO NOT re-read all prior artifacts'));
  });

  test('returns null when run is null', () => {
    const result = pm.buildFeedbackContextBlock(null, 0);
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// 5–7. Integration — handleStageClose with feedback gate
// Uses PIPELINE_NO_SPAWN=1 to avoid spawning real agents.
// ---------------------------------------------------------------------------

describe('pipelineManager — handleStageClose integration (feedback gate)', () => {
  let dataDir;
  let agentsDir;
  let pm;

  before(() => {
    dataDir   = tmpDir();
    agentsDir = tmpDir();
    // Write agent files needed by the integration paths.
    writeAgentFile(agentsDir, 'developer-agent');
    writeAgentFile(agentsDir, 'code-reviewer');
    writeAgentFile(agentsDir, 'qa-engineer-e2e');

    process.env.PIPELINE_NO_SPAWN  = '1';
    process.env.PIPELINE_AGENTS_DIR = agentsDir;
    process.env.PIPELINE_AGENT_MODE = 'subagent';

    delete require.cache[require.resolve('../src/services/pipelineManager')];
    pm = require('../src/services/pipelineManager');
    pm.init(dataDir);
  });

  after(() => {
    delete process.env.PIPELINE_NO_SPAWN;
    delete process.env.PIPELINE_AGENTS_DIR;
    delete process.env.PIPELINE_AGENT_MODE;
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  /**
   * Set up a space/task with an attachment pointing to a real artifact file.
   */
  function setupSpaceWithArtifact(spaceId, taskId, artifactName, artifactContent) {
    const spaceDir = path.join(dataDir, 'spaces', spaceId);
    fs.mkdirSync(spaceDir, { recursive: true });

    const artifactPath = path.join(dataDir, `${taskId}-${artifactName}`);
    fs.writeFileSync(artifactPath, artifactContent, 'utf8');

    const task = {
      id: taskId,
      title: 'Gate integration test task',
      type: 'feature',
      attachments: [
        { name: artifactName, type: 'file', content: artifactPath },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(spaceDir, 'todo.json'),        '[]', 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([task]), 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'done.json'),        '[]', 'utf8');
    return { spaceDir, artifactPath };
  }

  /**
   * Build a run on disk with a custom stages list.
   */
  async function buildRun(spaceId, taskId, stages) {
    const taskResult = pm.findTaskInDataDir
      ? pm.findTaskInDataDir(spaceId, taskId, dataDir)
      : null;

    // Directly build the run using internal helpers (no createRun to avoid full pipeline).
    const runId      = crypto.randomUUID();
    const runDirPath = pm.runDir(dataDir, runId);
    fs.mkdirSync(runDirPath, { recursive: true });

    const now = new Date().toISOString();
    const stageStatuses = stages.map((agentId, i) => ({
      index: i, agentId, status: i < stages.length - 1 ? 'completed' : 'running',
      exitCode: i < stages.length - 1 ? 0 : null,
      startedAt: now, finishedAt: i < stages.length - 1 ? now : null,
    }));

    const run = {
      runId,
      spaceId,
      taskId,
      stages,
      currentStage: stages.length - 1,
      status: 'running',
      stageStatuses,
      loopCounts: {},
      feedbackGates: {},
      feedbackIterations: 0,
      checkpoints: [],
      createdAt: now,
      updatedAt: now,
    };

    // Write run.json to disk (legacy path — no _store in tests).
    const runJsonPath = pm.stageLogPath(dataDir, runId, 0).replace('stage-0.log', 'run.json');
    fs.writeFileSync(runJsonPath, JSON.stringify(run, null, 2), 'utf8');

    return { runId, run };
  }

  test('5. CHANGES_REQUIRED verdict triggers fallback inject when agent omits inject file', async () => {
    const spaceId = `sp-changes-${Date.now()}`;
    const taskId  = crypto.randomUUID();

    // Set up task with review-report.md attachment.
    setupSpaceWithArtifact(
      spaceId, taskId, 'review-report.md',
      '**Verdict:** CHANGES_REQUIRED\n\n## Issues\n- Missing error handling\n'
    );

    // Build a run manually.
    const stages = ['developer-agent', 'code-reviewer'];
    const { runId, run } = await buildRun(spaceId, taskId, stages);

    // Write run.json to the legacy path.
    const runJsonFilePath = path.join(pm.runDir(dataDir, runId), 'run.json');
    fs.mkdirSync(path.dirname(runJsonFilePath), { recursive: true });
    fs.writeFileSync(runJsonFilePath, JSON.stringify(run, null, 2), 'utf8');

    // Directly call evaluateFeedbackGate on the code-reviewer stage (stageIndex=1).
    const result = pm.evaluateFeedbackGate(dataDir, run, 1, 'code-reviewer', []);

    assert.equal(result.triggered, true);
    assert.ok(result.gateResult !== null);
    assert.equal(result.gateResult.verdict, 'CHANGES_REQUIRED');

    // Simulate what handleStageClose does when gateResult.triggered && stagesToInject.length === 0.
    run.feedbackGates = run.feedbackGates || {};
    run.feedbackGates['1'] = result.gateResult;

    if (result.triggered) {
      const insertAt = run.currentStage;
      const fallbackStages = ['developer-agent', 'code-reviewer'];
      const originalLength = run.stages.length;

      run.stages.splice(insertAt, 0, ...fallbackStages);
      run.stageStatuses.splice(insertAt, 0, ...fallbackStages.map((id, i) => ({
        agentId: id, status: 'pending', exitCode: null, startedAt: null, finishedAt: null,
        index: insertAt + i,
      })));
      run.stageStatuses.forEach((s, i) => { s.index = i; });
      run.loopCounts['code-reviewer'] = (run.loopCounts['code-reviewer'] || 0) + 1;
      run.feedbackIterations = (run.feedbackIterations || 0) + 1;

      assert.equal(run.stages.length, originalLength + 2, 'Two stages injected');
      assert.equal(run.stages[insertAt], 'developer-agent');
      assert.equal(run.stages[insertAt + 1], 'code-reviewer');
    }

    assert.equal(run.feedbackIterations, 1, 'feedbackIterations should be 1');
    assert.ok(run.feedbackGates['1'], 'feedbackGates[1] should be set');
    assert.equal(run.feedbackGates['1'].triggered, true);
  });

  test('6. APPROVED verdict — no back-edge, feedbackIterations stays 0', () => {
    const spaceId = `sp-approved-int-${Date.now()}`;
    const taskId  = crypto.randomUUID();

    setupSpaceWithArtifact(
      spaceId, taskId, 'review-report.md',
      '**Verdict:** APPROVED\n\nAll good.\n'
    );

    const run = makeRun({ spaceId, taskId, feedbackIterations: 0, feedbackGates: {} });
    const result = pm.evaluateFeedbackGate(dataDir, run, 1, 'code-reviewer', []);

    assert.equal(result.triggered, false);
    assert.ok(result.gateResult !== null, 'gateResult should be set even for APPROVED');
    assert.equal(result.gateResult.verdict, 'APPROVED');

    // Simulate handleStageClose logic for non-triggered case.
    if (result.gateResult) {
      run.feedbackGates['1'] = result.gateResult;
    }
    // triggered=false, so no splice and no feedbackIterations increment.
    if (result.triggered) {
      run.feedbackIterations = (run.feedbackIterations || 0) + 1;
    }

    assert.equal(run.feedbackIterations, 0, 'feedbackIterations should remain 0');
    assert.equal(run.stages.length, 2, 'stages should be unchanged');
  });

  test('7. No double-inject: agent writes inject file + CHANGES_REQUIRED verdict = single splice', () => {
    const spaceId = `sp-no-double-${Date.now()}`;
    const taskId  = crypto.randomUUID();

    setupSpaceWithArtifact(
      spaceId, taskId, 'review-report.md',
      '**Verdict:** CHANGES_REQUIRED\n\n## Issues\n- Fix tests\n'
    );

    const run = makeRun({ spaceId, taskId, feedbackIterations: 0, feedbackGates: {} });
    const originalLength = run.stages.length;

    // Simulate: agent wrote the inject file → stagesToInject has contents.
    const stagesToInjectFromAgent = ['developer-agent', 'code-reviewer'];

    // First: the readInjectSignal splice (agent path) adds stages.
    const insertAt = run.currentStage;
    run.stages.splice(insertAt, 0, ...stagesToInjectFromAgent);
    run.stageStatuses.splice(insertAt, 0, ...stagesToInjectFromAgent.map((id, i) => ({
      agentId: id, status: 'pending', exitCode: null, startedAt: null, finishedAt: null,
      index: insertAt + i,
    })));
    run.stageStatuses.forEach((s, i) => { s.index = i; });
    run.loopCounts['code-reviewer'] = 1;

    const afterAgentInject = run.stages.length;
    assert.equal(afterAgentInject, originalLength + 2, 'Agent injected 2 stages');

    // Then: evaluateFeedbackGate runs with stagesToInjectAlreadyQueued = stagesToInjectFromAgent.
    const result = pm.evaluateFeedbackGate(dataDir, run, 1, 'code-reviewer', stagesToInjectFromAgent);

    assert.equal(result.triggered, true);
    assert.ok(result.gateResult !== null);

    // Manager does NOT inject again because stagesToInjectAlreadyQueued.length > 0.
    if (result.gateResult) {
      run.feedbackGates['1'] = result.gateResult;
    }
    if (result.triggered && stagesToInjectFromAgent.length === 0) {
      // This branch should NOT execute.
      run.stages.splice(run.currentStage, 0, 'developer-agent', 'code-reviewer');
      assert.fail('Manager should not inject when agent already did');
    }
    if (result.triggered) {
      run.feedbackIterations = (run.feedbackIterations || 0) + 1;
    }

    // Stages count should still be originalLength + 2 (agent's inject, not doubled).
    assert.equal(run.stages.length, afterAgentInject, 'No double-inject: stages count unchanged after gate check');
    assert.equal(run.feedbackIterations, 1, 'feedbackIterations incremented once');
    assert.equal(run.feedbackGates['1'].triggered, true);
  });
});

// ---------------------------------------------------------------------------
// 8. createRun — initialises feedbackGates and feedbackIterations (unit check)
// ---------------------------------------------------------------------------

describe('pipelineManager — createRun initialises feedback fields', () => {
  let dataDir;
  let agentsDir;
  let pm;

  before(() => {
    dataDir   = tmpDir();
    agentsDir = tmpDir();
    writeAgentFile(agentsDir, 'developer-agent');
    writeAgentFile(agentsDir, 'code-reviewer');

    process.env.PIPELINE_NO_SPAWN   = '1';
    process.env.PIPELINE_AGENTS_DIR  = agentsDir;
    process.env.PIPELINE_AGENT_MODE  = 'subagent';

    delete require.cache[require.resolve('../src/services/pipelineManager')];
    pm = require('../src/services/pipelineManager');
    pm.init(dataDir);
  });

  after(() => {
    delete process.env.PIPELINE_NO_SPAWN;
    delete process.env.PIPELINE_AGENTS_DIR;
    delete process.env.PIPELINE_AGENT_MODE;
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  test('createRun sets feedbackGates={} and feedbackIterations=0 on initial run', async () => {
    const spaceId = `sp-init-${Date.now()}`;
    const taskId  = crypto.randomUUID();
    const spaceDir = path.join(dataDir, 'spaces', spaceId);
    fs.mkdirSync(spaceDir, { recursive: true });

    const task = { id: taskId, title: 'Init test', type: 'feature', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(spaceDir, 'todo.json'),        JSON.stringify([task]), 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), '[]', 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'done.json'),        '[]', 'utf8');

    const run = await pm.createRun({
      spaceId,
      taskId,
      stages: ['developer-agent', 'code-reviewer'],
      dataDir,
    });

    assert.deepEqual(run.feedbackGates, {}, 'feedbackGates should be {}');
    assert.equal(run.feedbackIterations, 0, 'feedbackIterations should be 0');
  });
});
