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

  // ---- Strict-parser stance (round 3) ------------------------------------
  // Every prior round of this PR produced the same class of bug: a verdict or
  // its findings vanished silently through some new mechanism. The parser now
  // REFUSES TO GUESS. When it cannot be certain, it returns pass:null and
  // lets Policy C fail the run loudly.
  //
  // The classic footgun (formerly "BUG-001"): both shipped gate agent .md
  // prompts contain a literal example `prism-gate` block as instructional
  // text. An agent that echoes any of its prompt into its artifact would
  // otherwise ship two disagreeing blocks. Under the new stance, disagreement
  // → pass:null → Policy C fires → the run fails loudly and the operator
  // knows the agent template is broken.
  test('strict: two disagreeing prism-gate blocks → pass:null (Policy C fails loud)', () => {
    const artifact = [
      '# Review report',
      '',
      'Example block echoed from the agent prompt template:',
      '',
      '```prism-gate',
      'pass: true',
      'findings:',
      '  - example finding from prompt',
      '```',
      '',
      'The agent then wrote its real verdict:',
      '',
      '```prism-gate',
      'pass: false',
      'findings:',
      '  - Real bug: race in login flow',
      '```',
    ].join('\n');

    const r = parseGateVerdict(artifact);
    assert.equal(r.pass, null, 'disagreeing blocks must NEVER be silently reconciled');
    assert.deepEqual(r.findings, []);
  });

  test('strict: two IDENTICAL prism-gate blocks → parse successfully (agreement is fine)', () => {
    // If the artifact contains the same verdict twice (rare but not a bug),
    // agreement is enough — return the verdict.
    const one = gateBlock('false', ['same bug']);
    const artifact = one + '\n' + one;
    const r = parseGateVerdict(artifact);
    assert.equal(r.pass, false);
    assert.deepEqual(r.findings, ['same bug']);
  });

  test('strict: single block still parses (regression guard on the regression)', () => {
    const r = parseGateVerdict(gateBlock('true', ['ok']));
    assert.equal(r.pass, true);
    assert.deepEqual(r.findings, ['ok']);
  });

  // ---- F1 (round 3) — fence-depth-aware block extraction -----------------
  // A finding containing a fenced repro snippet (which QA is explicitly
  // instructed to produce) must NOT terminate the outer prism-gate block.
  // The old parser closed on the first ``` after the opener and silently
  // dropped every finding past the nested fence. Reproduces the exact
  // artifact shape from the round-3 findings brief.
  test('F1: nested triple-backtick inside a finding does NOT truncate the block', () => {
    const content = [
      '````prism-gate',
      'pass: false',
      'findings:',
      '  - BUG-001: crash on empty submit. Repro:',
      '    ```bash',
      '    curl -X POST /api/x -d {}',
      '    ```',
      '  - BUG-002: session not invalidated',
      '  - BUG-003: race in handleStageClose',
      '````',
    ].join('\n');

    const r = parseGateVerdict(content);
    assert.equal(r.pass, false);
    assert.equal(r.findings.length, 3, 'all three findings must survive the nested fence');
    assert.equal(r.findings[1], 'BUG-002: session not invalidated');
    assert.equal(r.findings[2], 'BUG-003: race in handleStageClose');
  });

  test('F1: unbalanced prism-gate fence → pass:null (loud failure via Policy C)', () => {
    // Opening fence with NO matching closer of >= backtick length. Rather
    // than "return what we could parse so far", the strict parser refuses.
    const content = [
      '```prism-gate',
      'pass: false',
      'findings:',
      '  - Something',
      // No closing fence.
    ].join('\n');

    const r = parseGateVerdict(content);
    assert.equal(r.pass, null, 'unbalanced fence must never yield a partial verdict');
  });

  test('F1: pass: key missing → pass:null', () => {
    // Block present, but no `pass:` line at all. Strict parser refuses to
    // default to true or false.
    const content = '```prism-gate\nfindings:\n  - x\n```';
    const r = parseGateVerdict(content);
    assert.equal(r.pass, null);
  });

  // ---- BUG-002 regression -------------------------------------------------
  // LLM-written YAML routinely wraps long bullet text onto extra indented
  // lines. The old parser broke the list on the first non-bullet, non-blank
  // line — dropping every finding after the first wrapped one.
  test('BUG-002: indented continuation lines do NOT truncate the list', () => {
    const content = [
      '```prism-gate',
      'pass: false',
      'findings:',
      '  - BUG-001 (Critical): crash on empty submit',
      '    repro: POST /x with {} -> 500',
      '  - BUG-002 (High): session not invalidated',
      '```',
    ].join('\n');

    const r = parseGateVerdict(content);
    assert.equal(r.pass, false);
    assert.equal(r.findings.length, 2, 'two bullets, second must NOT be dropped');
    assert.equal(r.findings[0], 'BUG-001 (Critical): crash on empty submit repro: POST /x with {} -> 500');
    assert.equal(r.findings[1], 'BUG-002 (High): session not invalidated');
  });

  test('BUG-002: multi-line continuations under one bullet stay attached', () => {
    const content = [
      '```prism-gate',
      'pass: false',
      'findings:',
      '  - First finding',
      '    line two of first',
      '    line three of first',
      '  - Second finding',
      '```',
    ].join('\n');

    const r = parseGateVerdict(content);
    assert.equal(r.findings.length, 2);
    assert.equal(r.findings[0], 'First finding line two of first line three of first');
    assert.equal(r.findings[1], 'Second finding');
  });

  test('BUG-002: a non-bullet line at bullet-indent STILL ends the list', () => {
    // Preserves existing "notes: ignored ends the list" behavior — only
    // MORE-INDENTED lines are treated as continuations.
    const content = [
      '```prism-gate',
      'pass: false',
      'findings:',
      '  - One',
      '  - Two',
      '  notes: ignored',
      '  - NotAFinding',
      '```',
    ].join('\n');
    const r = parseGateVerdict(content);
    assert.deepEqual(r.findings, ['One', 'Two']);
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
});

// ---------------------------------------------------------------------------
// 6. F2 (round 3) — BEHAVIOURAL regression for the mid-eval crash window.
//    The round-2 fix for BUG-003 (persist stage.status='completed' before
//    gate eval) narrowed one race but opened another: a crash BETWEEN the
//    two writeRun calls would leave the stage 'completed' with the gate
//    never evaluated — and both `_processRunsOnStartup` and `resumeRun`
//    walked straight past the ungated stage as if it had passed.
//
//    Round-3 fix: stamp `stage.gatePending = true` alongside the completed
//    marker in the SAME write. On restart or manual resume, the recovery
//    path must re-invoke the gate rather than skipping past. These are
//    BEHAVIOURAL tests against the exported `applyFeedbackGate` — they do
//    NOT read source text, so refactors that preserve behaviour stay green.
// ---------------------------------------------------------------------------

describe('pipelineManager — F2 gatePending recovery (behavioural)', () => {
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
    pm.init(dataDir);
  });

  after(() => {
    delete process.env.PIPELINE_AGENTS_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  /** Persist a run with a completed-but-gatePending stage, as a mid-eval crash
   *  would leave it. Returns { runId, spaceId, taskId }. */
  function seedCrashedRun(verdictContent, opts = {}) {
    const spaceId = `sp-${crypto.randomUUID()}`;
    const taskId  = crypto.randomUUID();
    const spaceDir = path.join(dataDir, 'spaces', spaceId);
    fs.mkdirSync(spaceDir, { recursive: true });
    const filePath = path.join(spaceDir, 'review-report.md');
    fs.writeFileSync(filePath, verdictContent, 'utf8');
    const task = { id: taskId, title: 'T', type: 'feature',
      attachments: [{ name: 'review-report.md', type: 'file', content: filePath }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([task]), 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'todo.json'), '[]', 'utf8');
    fs.writeFileSync(path.join(spaceDir, 'done.json'), '[]', 'utf8');

    const runId = crypto.randomUUID();
    const runDirPath = path.join(dataDir, 'runs', runId);
    fs.mkdirSync(runDirPath, { recursive: true });
    const run = {
      runId,
      spaceId,
      taskId,
      stages: ['developer-agent', 'code-reviewer'],
      currentStage: 2,
      status: 'running',
      stageStatuses: [
        { index: 0, agentId: 'developer-agent', status: 'completed', exitCode: 0,
          startedAt: new Date(Date.now() - 2000).toISOString(),
          finishedAt: new Date(Date.now() - 1000).toISOString() },
        // The mid-eval crash: gate stage marked completed, gatePending still set.
        { index: 1, agentId: 'code-reviewer',   status: 'completed', exitCode: 0,
          gatePending: true,
          startedAt: new Date(Date.now() - 900).toISOString(),
          finishedAt: new Date(Date.now() - 100).toISOString() },
      ],
      loopCounts: {},
      feedbackGates: {},
      feedbackIterations: 0,
      ...opts,
    };
    fs.writeFileSync(path.join(runDirPath, 'run.json'), JSON.stringify(run), 'utf8');
    return { runId, spaceId, taskId };
  }

  function readRunFromDisk(runId) {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'runs', runId, 'run.json'), 'utf8'));
  }

  test('F2: crash mid-eval on pass:false → applyFeedbackGate re-injects the loop and clears gatePending', async () => {
    const { runId } = seedCrashedRun(gateBlock('false', ['Fix the missing validation']));
    const outcome = await pm.applyFeedbackGate(dataDir, runId, 1);
    const after = readRunFromDisk(runId);

    assert.equal(outcome, 'looped', 'must classify as a looped recovery');
    assert.equal(after.stageStatuses[1].gatePending, false, 'gatePending must be cleared after recovery');
    assert.equal(after.stages.length, 4, 'loop stages [developer-agent, code-reviewer] must be spliced in');
    assert.equal(after.stages[2], 'developer-agent');
    assert.equal(after.stages[3], 'code-reviewer');
    assert.equal(after.loopCounts['code-reviewer'], 1, 'loop counter bumped exactly once');
    assert.equal(after.feedbackIterations, 1);
    assert.equal(after.feedbackGates['1'].agentId, 'code-reviewer');
    assert.deepEqual(after.feedbackGates['1'].findings, ['Fix the missing validation']);
  });

  test('F2: crash mid-eval on pass:true → applyFeedbackGate clears gatePending, no injection', async () => {
    const { runId } = seedCrashedRun(gateBlock('true'));
    const outcome = await pm.applyFeedbackGate(dataDir, runId, 1);
    const after = readRunFromDisk(runId);

    assert.equal(outcome, 'passed');
    assert.equal(after.stageStatuses[1].gatePending, false);
    assert.equal(after.stages.length, 2, 'no loop stages spliced');
    assert.equal(after.status, 'running', 'run stays running (pass:true) — no Policy C fire');
  });

  test('F2: crash mid-eval on missing verdict → Policy C fires (run.status = failed) instead of silent pass', async () => {
    // The behaviour the round-3 findings brief specifically singles out: prior
    // to this fix, a crash in the eval window would leave the gate skipped
    // and the run would silently advance past a still-failing verdict.
    const { runId } = seedCrashedRun('# review with no gate block\n');
    const outcome = await pm.applyFeedbackGate(dataDir, runId, 1);
    const after = readRunFromDisk(runId);

    assert.equal(outcome, 'failed');
    assert.equal(after.status, 'failed', 'Policy C must terminate the run loudly');
    assert.equal(after.stageStatuses[1].failureReason, 'gate_no_verdict');
    assert.equal(after.stageStatuses[1].gatePending, false, 'gatePending cleared even on Policy C');
  });

  test('F2: applyFeedbackGate is idempotent — a duplicate call after recovery is a no-op', async () => {
    const { runId } = seedCrashedRun(gateBlock('false', ['Fix A']));
    await pm.applyFeedbackGate(dataDir, runId, 1);
    // Simulate a second delivery of the same recovery event (e.g. two
    // startup sweeps racing after a fast restart-restart cycle).
    const outcome2 = await pm.applyFeedbackGate(dataDir, runId, 1);
    const after = readRunFromDisk(runId);

    assert.equal(outcome2, 'passed', 'second call short-circuits (gatePending already cleared)');
    assert.equal(after.loopCounts['code-reviewer'], 1, 'counter must NOT double-increment');
    assert.equal(after.stages.length, 4, 'stages must NOT be spliced a second time');
    assert.equal(after.feedbackIterations, 1);
  });

  test('F2: applyFeedbackGate on a non-gate agent clears gatePending harmlessly', async () => {
    // A completed stage with gatePending: true whose agent has no `gate:`
    // frontmatter must still clear the flag — otherwise the stage would stay
    // recover-eligible forever.
    const { runId } = seedCrashedRun('irrelevant');
    // Overwrite the stage-1 agentId to a non-gate agent.
    const run = readRunFromDisk(runId);
    run.stages[1] = 'developer-agent';
    run.stageStatuses[1].agentId = 'developer-agent';
    fs.writeFileSync(path.join(dataDir, 'runs', runId, 'run.json'), JSON.stringify(run), 'utf8');

    const outcome = await pm.applyFeedbackGate(dataDir, runId, 1);
    const after = readRunFromDisk(runId);
    assert.equal(outcome, 'passed');
    assert.equal(after.stageStatuses[1].gatePending, false);
    assert.equal(after.stages.length, 2, 'no loop spliced for a non-gate agent');
  });
});

// ---------------------------------------------------------------------------
// 7. F3 (round 3) — getAgentGateConfig must honour project-scoped overrides.
//    The rest of pipelineManager already threads `run.workingDirectory` into
//    resolveAgent so `<workingDirectory>/.claude/agents/<id>.md` wins over the
//    global agents dir. Before this fix, only the feedback gate ignored the
//    override and silently fell back to the global (or NULL) — so a project
//    with a locally-overridden `code-reviewer.md` silently lost its gate.
// ---------------------------------------------------------------------------

describe('pipelineManager — F3 project-scoped agent override', () => {
  let globalDir;
  let projectDir;
  let pm;

  before(() => {
    globalDir  = tmpDir();
    projectDir = tmpDir();
    // Global: plain agent, NO gate.
    writePlainAgent(globalDir, 'code-reviewer');
    // Project: same agent id, WITH a gate declaration and a different artifact.
    writeGateAgent(path.join(projectDir, '.claude', 'agents'),
      'code-reviewer', 'project-review-report.md', '[developer-agent, code-reviewer]');
    process.env.PIPELINE_AGENTS_DIR = globalDir;
    pm = require('../src/services/pipelineManager');
  });

  after(() => {
    delete process.env.PIPELINE_AGENTS_DIR;
    fs.rmSync(globalDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test('F3: project .claude/agents/<id>.md wins over the global copy', () => {
    // Without workingDirectory, the global (non-gate) copy is read → null.
    assert.equal(pm.getAgentGateConfig('code-reviewer'), null);

    // With workingDirectory, the project (gate) copy wins.
    const cfg = pm.getAgentGateConfig('code-reviewer', projectDir);
    assert.deepEqual(cfg, {
      artifact: 'project-review-report.md',
      loopBackTo: ['developer-agent', 'code-reviewer'],
    });
  });

  test('F3: evaluateFeedbackGate reads workingDirectory off the run and finds the project gate', () => {
    // The run carries workingDirectory; the manager must pass it through.
    // We rely on the artifact being missing (no attachment) → missingVerdict,
    // which confirms the gate was found at all (a non-gate agent would return
    // { missingVerdict: false }).
    const run = makeRun({ workingDirectory: projectDir });
    const r = pm.evaluateFeedbackGate(tmpDir(), run, 1, 'code-reviewer');
    assert.equal(r.missingVerdict, true, 'project gate must be found and its missing artifact must fail loudly');
  });
});

// ---------------------------------------------------------------------------
// 8. F4 (round 3) — loopBackTo must accept BOTH YAML shapes; key-present-
//    but-unparseable must NOT silently fall back to the [developer-agent]
//    default. Undercuts the PR's own "zero pipeline changes to add a gate"
//    extensibility claim otherwise.
// ---------------------------------------------------------------------------

describe('pipelineManager — F4 loopBackTo YAML shapes', () => {
  let agentsDir;
  let pm;

  before(() => {
    agentsDir = tmpDir();
    process.env.PIPELINE_AGENTS_DIR = agentsDir;
    pm = require('../src/services/pipelineManager');
  });

  after(() => {
    delete process.env.PIPELINE_AGENTS_DIR;
    fs.rmSync(agentsDir, { recursive: true, force: true });
  });

  function writeGateAgentRaw(id, gateBody) {
    fs.writeFileSync(
      path.join(agentsDir, `${id}.md`),
      `---\nname: ${id}\nmodel: sonnet\ngate:\n${gateBody}---\n\nBody.\n`,
      'utf8',
    );
  }

  test('F4: inline flow-list loopBackTo: [a, b] parses (backward compat)', () => {
    writeGateAgentRaw('inline-gate',
      '  artifact: report.md\n  loopBackTo: [developer-agent, code-reviewer]\n');
    const cfg = pm.getAgentGateConfig('inline-gate');
    assert.deepEqual(cfg, { artifact: 'report.md', loopBackTo: ['developer-agent', 'code-reviewer'] });
  });

  test('F4: block-list loopBackTo (- item per line) now parses', () => {
    writeGateAgentRaw('block-gate',
      '  artifact: report.md\n  loopBackTo:\n    - developer-agent\n    - code-reviewer\n');
    const cfg = pm.getAgentGateConfig('block-gate');
    assert.deepEqual(cfg, { artifact: 'report.md', loopBackTo: ['developer-agent', 'code-reviewer'] });
  });

  test('F4: single-item block-list loopBackTo parses', () => {
    writeGateAgentRaw('block-one',
      '  artifact: report.md\n  loopBackTo:\n    - developer-agent\n');
    const cfg = pm.getAgentGateConfig('block-one');
    assert.deepEqual(cfg.loopBackTo, ['developer-agent']);
  });

  test('F4: unparseable loopBackTo shape → malformed → missingVerdict (Policy C fires, no silent default)', () => {
    writeGateAgentRaw('bad-gate',
      '  artifact: report.md\n  loopBackTo: not-a-yaml-list\n');
    const cfg = pm.getAgentGateConfig('bad-gate');
    assert.equal(cfg.malformed, true, 'must NOT silently default to [developer-agent]');

    // And evaluateFeedbackGate must surface this as missingVerdict.
    const run = makeRun();
    const r = pm.evaluateFeedbackGate(tmpDir(), run, 1, 'bad-gate');
    assert.equal(r.missingVerdict, true, 'malformed config must fail the run loudly, not substitute defaults');
  });

  test('F4: absent loopBackTo key → still uses the default [developer-agent]', () => {
    // The "no key at all" case is not ambiguous — the schema explicitly says
    // this defaults to developer-agent. Only key-present-but-unparseable is
    // malformed.
    writeGateAgentRaw('default-gate', '  artifact: report.md\n');
    const cfg = pm.getAgentGateConfig('default-gate');
    assert.deepEqual(cfg, { artifact: 'report.md', loopBackTo: ['developer-agent'] });
  });
});
