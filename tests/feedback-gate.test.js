'use strict';

/**
 * tests/feedback-gate.test.js — generic feedback gate test suite.
 *
 * The gate is agent-agnostic: any agent that declares a `gate:` block in its
 * frontmatter is a quality gate. It writes a machine-readable `prism-gate`
 * verdict into its artifact; the manager parses it and decides the back-edge.
 *
 * Covers:
 *   1. parseGateVerdict       — the one verdict parser.
 *   2. getAgentGateConfig     — reads `gate:` frontmatter (artifact + loopBackTo).
 *   3. evaluateFeedbackGate   — generic gate decision, incl. absence policy C
 *                               (missing verdict → missingVerdict, fail the run).
 *   4. buildFeedbackContextBlock — generic findings → developer prompt block.
 *   5. Integration            — the handleStageClose back-edge logic (simulated).
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-gate-test-'));
}

/** Write an agent .md that declares itself a gate. */
function writeGateAgent(dir, id, artifact, loopBackTo = '[developer-agent]') {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}.md`),
    `---\nname: ${id}\nmodel: sonnet\ngate:\n  artifact: ${artifact}\n  loopBackTo: ${loopBackTo}\n---\n\nTest gate agent.\n`,
    'utf8',
  );
}

/** Write a plain (non-gate) agent .md. */
function writePlainAgent(dir, id) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}.md`),
    `---\nname: ${id}\nmodel: sonnet\n---\n\nTest agent.\n`,
    'utf8',
  );
}

/** A verdict block as a gate agent would write it into its artifact. */
function gateBlock(pass, findings = []) {
  let b = '# Report\n\nSome prose.\n\n```prism-gate\n' + `pass: ${pass}\n`;
  if (findings.length) {
    b += 'findings:\n' + findings.map((f) => `  - ${f}`).join('\n') + '\n';
  }
  b += '```\n';
  return b;
}

function makeRun(overrides = {}) {
  return {
    runId:        crypto.randomUUID(),
    spaceId:      'test-space',
    taskId:       'test-task',
    stages:       ['developer-agent', 'code-reviewer'],
    currentStage: 2,
    status:       'running',
    stageStatuses: [
      { index: 0, agentId: 'developer-agent', status: 'completed', exitCode: 0 },
      { index: 1, agentId: 'code-reviewer',   status: 'completed', exitCode: 0 },
    ],
    loopCounts:         {},
    feedbackGates:      {},
    feedbackIterations: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. parseGateVerdict
// ---------------------------------------------------------------------------

describe('feedbackParser — parseGateVerdict', () => {
  const { parseGateVerdict } = require('../src/services/feedbackParser');

  test('pass: false with findings', () => {
    const r = parseGateVerdict(gateBlock('false', ['Fix the null check', 'Add a test']));
    assert.equal(r.pass, false);
    assert.deepEqual(r.findings, ['Fix the null check', 'Add a test']);
  });

  test('pass: true → no loop', () => {
    const r = parseGateVerdict(gateBlock('true'));
    assert.equal(r.pass, true);
    assert.deepEqual(r.findings, []);
  });

  test('no verdict block → pass: null', () => {
    const r = parseGateVerdict('Just a normal report with no gate block.');
    assert.equal(r.pass, null);
    assert.deepEqual(r.findings, []);
  });

  test('is case-insensitive on the pass value', () => {
    assert.equal(parseGateVerdict('```prism-gate\npass: FALSE\n```').pass, false);
    assert.equal(parseGateVerdict('```prism-gate\npass: True\n```').pass, true);
  });

  test('findings list stops at a non-bullet line', () => {
    const content = '```prism-gate\npass: false\nfindings:\n  - One\n  - Two\nnotes: ignored\n  - NotAFinding\n```';
    const r = parseGateVerdict(content);
    assert.deepEqual(r.findings, ['One', 'Two']);
  });

  test('never throws on non-string input', () => {
    for (const v of [null, undefined, 123, {}]) {
      assert.doesNotThrow(() => parseGateVerdict(v));
      assert.equal(parseGateVerdict(v).pass, null);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. getAgentGateConfig
// ---------------------------------------------------------------------------

describe('pipelineManager — getAgentGateConfig', () => {
  let agentsDir;
  let pm;

  before(() => {
    agentsDir = tmpDir();
    writeGateAgent(agentsDir, 'code-reviewer', 'review-report.md');
    writeGateAgent(agentsDir, 'qa-engineer-e2e', 'bugs.md', '[developer-agent, code-reviewer]');
    writePlainAgent(agentsDir, 'developer-agent');
    process.env.PIPELINE_AGENTS_DIR = agentsDir;
    pm = require('../src/services/pipelineManager');
  });

  after(() => {
    delete process.env.PIPELINE_AGENTS_DIR;
    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  test('reads artifact + loopBackTo from a gate agent', () => {
    assert.deepEqual(pm.getAgentGateConfig('code-reviewer'), {
      artifact: 'review-report.md',
      loopBackTo: ['developer-agent'],
    });
  });

  test('parses a multi-item loopBackTo', () => {
    assert.deepEqual(pm.getAgentGateConfig('qa-engineer-e2e').loopBackTo, ['developer-agent', 'code-reviewer']);
  });

  test('returns null for a non-gate agent', () => {
    assert.equal(pm.getAgentGateConfig('developer-agent'), null);
  });

  test('returns null for a missing agent file', () => {
    assert.equal(pm.getAgentGateConfig('does-not-exist'), null);
  });
});

// ---------------------------------------------------------------------------
// 3. evaluateFeedbackGate
// ---------------------------------------------------------------------------

describe('pipelineManager — evaluateFeedbackGate', () => {
  let dataDir;
  let agentsDir;
  let pm;

  before(() => {
    dataDir   = tmpDir();
    agentsDir = tmpDir();
    writeGateAgent(agentsDir, 'code-reviewer', 'review-report.md');
    writePlainAgent(agentsDir, 'developer-agent');
    process.env.PIPELINE_AGENTS_DIR = agentsDir;
    pm = require('../src/services/pipelineManager');
  });

  after(() => {
    delete process.env.PIPELINE_AGENTS_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  function taskWithArtifact(artifactName, content) {
    const spaceId = `sp-${crypto.randomUUID()}`;
    const taskId  = crypto.randomUUID();
    const spaceDir = path.join(dataDir, 'spaces', spaceId);
    fs.mkdirSync(spaceDir, { recursive: true });
    const attachments = [];
    if (artifactName !== null) {
      const filePath = path.join(spaceDir, artifactName);
      fs.writeFileSync(filePath, content, 'utf8');
      attachments.push({ name: artifactName, type: 'file', content: filePath });
    }
    const task = { id: taskId, title: 'T', type: 'feature', attachments,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([task]), 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'todo.json'), '[]', 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'done.json'), '[]', 'utf8');
    return { spaceId, taskId };
  }

  test('non-gate agent → not a gate, no missingVerdict', () => {
    const run = makeRun();
    const r = pm.evaluateFeedbackGate(dataDir, run, 0, 'developer-agent');
    assert.equal(r.triggered, false);
    assert.equal(r.gateResult, null);
    assert.equal(r.missingVerdict, false);
  });

  test('pass: false → triggered with findings + loopBackTo', () => {
    const { spaceId, taskId } = taskWithArtifact('review-report.md', gateBlock('false', ['Fix A', 'Fix B']));
    const run = makeRun({ spaceId, taskId });
    const r = pm.evaluateFeedbackGate(dataDir, run, 1, 'code-reviewer');
    assert.equal(r.triggered, true);
    assert.equal(r.missingVerdict, false);
    assert.deepEqual(r.loopBackTo, ['developer-agent']);
    assert.deepEqual(r.gateResult.findings, ['Fix A', 'Fix B']);
    assert.equal(r.gateResult.agentId, 'code-reviewer');
  });

  test('pass: true → not triggered', () => {
    const { spaceId, taskId } = taskWithArtifact('review-report.md', gateBlock('true'));
    const run = makeRun({ spaceId, taskId });
    const r = pm.evaluateFeedbackGate(dataDir, run, 1, 'code-reviewer');
    assert.equal(r.triggered, false);
    assert.equal(r.missingVerdict, false);
  });

  test('absence policy C: artifact present but NO verdict block → missingVerdict', () => {
    const { spaceId, taskId } = taskWithArtifact('review-report.md', '# Review\n\nLooks fine, no block.\n');
    const run = makeRun({ spaceId, taskId });
    const r = pm.evaluateFeedbackGate(dataDir, run, 1, 'code-reviewer');
    assert.equal(r.triggered, false);
    assert.equal(r.missingVerdict, true);
  });

  test('absence policy C: declared artifact missing entirely → missingVerdict', () => {
    const { spaceId, taskId } = taskWithArtifact(null, '');
    const run = makeRun({ spaceId, taskId });
    const r = pm.evaluateFeedbackGate(dataDir, run, 1, 'code-reviewer');
    assert.equal(r.missingVerdict, true);
  });
});

// ---------------------------------------------------------------------------
// 4. buildFeedbackContextBlock
// ---------------------------------------------------------------------------

describe('pipelineManager — buildFeedbackContextBlock', () => {
  const pm = require('../src/services/pipelineManager');

  test('renders findings under the gate agent header', () => {
    const run = makeRun({
      feedbackIterations: 1,
      feedbackGates: {
        '1': { agentId: 'code-reviewer', triggered: true, findings: ['Fix login', 'Add boundary'] },
      },
    });
    const block = pm.buildFeedbackContextBlock(run, 3);
    assert.ok(block.includes('FEEDBACK FROM code-reviewer'));
    assert.ok(block.includes('- Fix login'));
    assert.ok(block.includes('- Add boundary'));
  });

  test('works for ANY gate agent id (generic)', () => {
    const run = makeRun({
      feedbackIterations: 1,
      feedbackGates: { '2': { agentId: 'security-reviewer', triggered: true, findings: ['SQL injection in search'] } },
    });
    const block = pm.buildFeedbackContextBlock(run, 5);
    assert.ok(block.includes('FEEDBACK FROM security-reviewer'));
    assert.ok(block.includes('SQL injection in search'));
  });

  test('returns null before the first feedback iteration', () => {
    const run = makeRun({ feedbackIterations: 0, feedbackGates: {} });
    assert.equal(pm.buildFeedbackContextBlock(run, 3), null);
  });

  test('returns null when no triggered gate precedes the stage', () => {
    const run = makeRun({
      feedbackIterations: 1,
      feedbackGates: { '5': { agentId: 'code-reviewer', triggered: true, findings: ['x'] } },
    });
    assert.equal(pm.buildFeedbackContextBlock(run, 3), null); // gate at 5 is not < 3
  });
});

// ---------------------------------------------------------------------------
// 5. Integration — the handleStageClose back-edge decision logic
//    (handleStageClose is not exported; we drive evaluateFeedbackGate + the
//     same branch logic the manager runs, using the REAL injectLoopStages.)
// ---------------------------------------------------------------------------

describe('pipelineManager — back-edge integration', () => {
  let dataDir;
  let agentsDir;
  let pm;

  before(() => {
    dataDir   = tmpDir();
    agentsDir = tmpDir();
    writeGateAgent(agentsDir, 'code-reviewer', 'review-report.md');
    writePlainAgent(agentsDir, 'developer-agent');
    process.env.PIPELINE_AGENTS_DIR = agentsDir;
    pm = require('../src/services/pipelineManager');
  });

  after(() => {
    delete process.env.PIPELINE_AGENTS_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  function taskWithArtifact(content) {
    const spaceId = `sp-${crypto.randomUUID()}`;
    const taskId  = crypto.randomUUID();
    const spaceDir = path.join(dataDir, 'spaces', spaceId);
    fs.mkdirSync(spaceDir, { recursive: true });
    const filePath = path.join(spaceDir, 'review-report.md');
    fs.writeFileSync(filePath, content, 'utf8');
    const task = { id: taskId, title: 'T', type: 'feature',
      attachments: [{ name: 'review-report.md', type: 'file', content: filePath }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([task]), 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'todo.json'), '[]', 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'done.json'), '[]', 'utf8');
    return { spaceId, taskId };
  }

  // Mirror of handleStageClose Part 2b (manager-fallback path) using real helpers.
  function applyGate(run, stageIndex, agentId, stagesToInject = []) {
    const ev = pm.evaluateFeedbackGate(dataDir, run, stageIndex, agentId);
    if (ev.missingVerdict) { run.status = 'failed'; return ev; }
    if (ev.gateResult) run.feedbackGates[String(stageIndex)] = ev.gateResult;
    if (ev.triggered && stagesToInject.length === 0) {
      pm.injectLoopStages(run, [...ev.loopBackTo, agentId], agentId);
    }
    if (ev.triggered) run.feedbackIterations = (run.feedbackIterations || 0) + 1;
    return ev;
  }

  test('pass: false → manager injects [loopBackTo, agent] and counts an iteration', () => {
    const { spaceId, taskId } = taskWithArtifact(gateBlock('false', ['Fix it']));
    const run = makeRun({ spaceId, taskId, currentStage: 2 });
    const before = run.stages.length;
    applyGate(run, 1, 'code-reviewer');
    assert.equal(run.stages.length, before + 2);
    assert.equal(run.stages[2], 'developer-agent');
    assert.equal(run.stages[3], 'code-reviewer');
    assert.equal(run.feedbackIterations, 1);
    assert.equal(run.loopCounts['code-reviewer'], 1);
  });

  test('pass: true → no injection, no iteration', () => {
    const { spaceId, taskId } = taskWithArtifact(gateBlock('true'));
    const run = makeRun({ spaceId, taskId });
    const before = run.stages.length;
    applyGate(run, 1, 'code-reviewer');
    assert.equal(run.stages.length, before);
    assert.equal(run.feedbackIterations, 0);
  });

  test('no verdict block → run is failed (absence policy C)', () => {
    const { spaceId, taskId } = taskWithArtifact('# Review with no gate block\n');
    const run = makeRun({ spaceId, taskId });
    const ev = applyGate(run, 1, 'code-reviewer');
    assert.equal(ev.missingVerdict, true);
    assert.equal(run.status, 'failed');
    assert.equal(run.stages.length, 2); // no injection on a failed gate
  });

  test('no double-inject: agent wrote an inject file AND verdict is pass:false', () => {
    const { spaceId, taskId } = taskWithArtifact(gateBlock('false', ['Fix it']));
    const run = makeRun({ spaceId, taskId, currentStage: 2 });
    // Simulate the agent-driven inject already happened (stagesToInject non-empty),
    // so the manager fallback must NOT inject a second time.
    pm.injectLoopStages(run, ['developer-agent', 'code-reviewer'], 'code-reviewer');
    const afterAgentInject = run.stages.length;
    applyGate(run, 1, 'code-reviewer', ['developer-agent', 'code-reviewer']);
    assert.equal(run.stages.length, afterAgentInject, 'manager must not inject again');
  });
});
