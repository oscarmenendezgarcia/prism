/**
 * Regression tests — bridgeUpdateRunFinished after resume
 * ADR runs-zombie-active-fix / T-002
 *
 * Reproduces the "zombie ACTIVE" bug:
 *   1. Stage records a "running" entry (id=`${runId}-${stageIndex}`).
 *   2. resumeRun's cleanup flips it to "cancelled".
 *   3. bridgeWriteRunStarted appends a NEW record with the SAME id.
 *   4. bridgeUpdateRunFinished("completed") MUST close the new (still-running)
 *      record, not the historical "cancelled" one.
 *
 * Run with: node --test tests/pipelineManager.resume.test.js
 */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const crypto   = require('crypto');

const {
  bridgeWriteRunStarted,
  bridgeUpdateRunFinished,
} = require('../src/services/pipelineManager');

const { readAgentRuns } = require('../src/handlers/agentRuns');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-resume-bridge-'));
}

function fakeRun(runId, stageIndex, agentId = 'senior-architect') {
  const stages = ['senior-architect', 'developer-agent', 'qa-engineer-e2e'];
  const stageStatuses = stages.map((_, i) => ({
    startedAt: i <= stageIndex ? new Date(Date.now() - (stages.length - i) * 1000).toISOString() : null,
  }));
  stageStatuses[stageIndex].startedAt = new Date().toISOString();
  return {
    runId,
    taskId:      crypto.randomUUID(),
    spaceId:     crypto.randomUUID(),
    stages,
    stageStatuses,
  };
}

test('resumed stage: findLastIndex closes the fresh running record, not the old cancelled one', () => {
  const dataDir    = tmpDir();
  const runId      = crypto.randomUUID();
  const stageIndex = 1;
  const entryId    = `${runId}-${stageIndex}`;

  const run = fakeRun(runId, stageIndex);

  // (1) First attempt writes a "running" record.
  bridgeWriteRunStarted(dataDir, run, stageIndex, 'Test task', 'Test space', 'claude', '/tmp/prompt.md');

  // (2) resumeRun's cleanup pass flips it to "cancelled" (simulated in-place).
  const records = readAgentRuns(dataDir);
  assert.equal(records.length, 1);
  records[0] = { ...records[0], status: 'cancelled', completedAt: new Date().toISOString() };
  fs.writeFileSync(
    path.join(dataDir, 'agent-runs.jsonl'),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  );

  // (3) Second attempt appends a new "running" record with the SAME id.
  bridgeWriteRunStarted(dataDir, run, stageIndex, 'Test task', 'Test space', 'claude', '/tmp/prompt.md');

  const afterResume = readAgentRuns(dataDir);
  assert.equal(afterResume.length, 2, 'both attempts recorded');
  assert.equal(afterResume[0].status, 'cancelled', 'first attempt preserved');
  assert.equal(afterResume[1].status, 'running',   'second attempt live');
  assert.equal(afterResume[0].id, entryId);
  assert.equal(afterResume[1].id, entryId);

  // (4) Stage finishes → close the RIGHT record.
  bridgeUpdateRunFinished(dataDir, runId, stageIndex, 'completed', new Date().toISOString(), 1234);

  const closed = readAgentRuns(dataDir);
  assert.equal(closed.length, 2, 'no records were added or removed');

  const completed = closed.filter((r) => r.id === entryId && r.status === 'completed');
  const stillRunning = closed.filter((r) => r.id === entryId && r.status === 'running');
  const cancelled = closed.filter((r) => r.id === entryId && r.status === 'cancelled');

  assert.equal(completed.length,    1, 'exactly one completed record for this stage');
  assert.equal(stillRunning.length, 0, 'no zombie running record survives');
  assert.equal(cancelled.length,    1, 'historical cancelled record preserved (audit)');
});

test('fresh run (no resume): single record flips running → completed', () => {
  const dataDir    = tmpDir();
  const runId      = crypto.randomUUID();
  const stageIndex = 0;
  const entryId    = `${runId}-${stageIndex}`;

  const run = fakeRun(runId, stageIndex);

  bridgeWriteRunStarted(dataDir, run, stageIndex, 'Fresh', 'Space', 'claude', '/tmp/p.md');

  let records = readAgentRuns(dataDir);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'running');

  bridgeUpdateRunFinished(dataDir, runId, stageIndex, 'completed', new Date().toISOString(), 42);

  records = readAgentRuns(dataDir);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, entryId);
  assert.equal(records[0].status, 'completed');
  assert.equal(records[0].durationMs, 42);
});

test('double-close is idempotent (second finish call finds no running record and no-ops)', () => {
  const dataDir    = tmpDir();
  const runId      = crypto.randomUUID();
  const stageIndex = 0;

  const run = fakeRun(runId, stageIndex);
  bridgeWriteRunStarted(dataDir, run, stageIndex, 'X', 'Y', 'claude', '/tmp/p.md');
  bridgeUpdateRunFinished(dataDir, runId, stageIndex, 'completed', new Date().toISOString(), 10);
  const snapshotAfterFirstClose = fs.readFileSync(path.join(dataDir, 'agent-runs.jsonl'), 'utf8');

  // Second close (e.g. stall watchdog + normal close race) must not alter the file.
  bridgeUpdateRunFinished(dataDir, runId, stageIndex, 'failed', new Date().toISOString(), 999);
  const snapshotAfterSecondClose = fs.readFileSync(path.join(dataDir, 'agent-runs.jsonl'), 'utf8');

  assert.equal(snapshotAfterSecondClose, snapshotAfterFirstClose,
    'second close must not overwrite the already-completed record');
});
