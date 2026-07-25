/**
 * Unit tests — startup agent-runs backfill
 * ADR runs-zombie-active-fix / T-004
 *
 * Run with: node --test tests/agentRuns.backfill.test.js
 */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const crypto   = require('crypto');

const { runBackfill } = require('../src/services/agentRunsBackfill');
const { readAgentRuns, writeAgentRuns } = require('../src/handlers/agentRuns');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prism-backfill-'));
}

function mkRecord(overrides = {}) {
  return {
    id:               overrides.id || crypto.randomUUID(),
    pipelineRunId:    overrides.pipelineRunId || crypto.randomUUID(),
    stageIndex:       overrides.stageIndex ?? 0,
    taskId:           'task-1',
    taskTitle:        'T',
    agentId:          'senior-architect',
    agentDisplayName: 'Senior Architect',
    spaceId:          'space-1',
    spaceName:        'Space',
    status:           'running',
    startedAt:        new Date().toISOString(),
    completedAt:      null,
    durationMs:       null,
    cliCommand:       'claude',
    promptPath:       '/tmp/p',
    ...overrides,
  };
}

function fakeStore(runs) {
  const list = [...runs];
  return { listRuns: () => list };
}

test('empty jsonl file is a safe no-op', () => {
  const dataDir = tmpDir();
  const res = runBackfill({ dataDir, store: fakeStore([]) });
  assert.deepEqual(res, { changed: 0, scanned: 0 });
  assert.equal(fs.existsSync(path.join(dataDir, 'agent-runs.jsonl')), false);
});

test('running record + terminal parent → flipped to cancelled', () => {
  const dataDir = tmpDir();
  const runId = crypto.randomUUID();
  writeAgentRuns(dataDir, [mkRecord({ pipelineRunId: runId, completedAt: null })]);
  const finishedAt = '2026-07-25T09:00:00.000Z';
  const store = fakeStore([{ runId, status: 'completed', finishedAt }]);

  const res = runBackfill({ dataDir, store });

  assert.equal(res.changed, 1);
  assert.equal(res.scanned, 1);
  const [rec] = readAgentRuns(dataDir);
  assert.equal(rec.status, 'cancelled');
  assert.equal(rec.completedAt, finishedAt, 'uses parent finishedAt when record has none');
});

test('running record + non-terminal parent → untouched', () => {
  const dataDir = tmpDir();
  const runId = crypto.randomUUID();
  writeAgentRuns(dataDir, [mkRecord({ pipelineRunId: runId })]);
  const store = fakeStore([{ runId, status: 'running' }]);

  const res = runBackfill({ dataDir, store });
  assert.equal(res.changed, 0);
  assert.equal(readAgentRuns(dataDir)[0].status, 'running');
});

test('running record + missing parent → untouched (defensive)', () => {
  const dataDir = tmpDir();
  writeAgentRuns(dataDir, [mkRecord({ pipelineRunId: 'ghost-parent' })]);
  const store = fakeStore([]);

  const res = runBackfill({ dataDir, store });
  assert.equal(res.changed, 0);
  assert.equal(readAgentRuns(dataDir)[0].status, 'running');
});

test('non-running records are not touched even when parent is terminal', () => {
  const dataDir = tmpDir();
  const runId = crypto.randomUUID();
  writeAgentRuns(dataDir, [
    mkRecord({ pipelineRunId: runId, status: 'completed', completedAt: '2026-01-01T00:00:00.000Z' }),
    mkRecord({ pipelineRunId: runId, status: 'cancelled', completedAt: '2026-01-01T00:00:00.000Z' }),
    mkRecord({ pipelineRunId: runId, status: 'failed',    completedAt: '2026-01-01T00:00:00.000Z' }),
  ]);
  const store = fakeStore([{ runId, status: 'completed', finishedAt: '2026-01-01T00:00:00.000Z' }]);

  const res = runBackfill({ dataDir, store });
  assert.equal(res.changed, 0);
});

test('idempotent — second invocation makes zero writes', () => {
  const dataDir = tmpDir();
  const runId = crypto.randomUUID();
  writeAgentRuns(dataDir, [mkRecord({ pipelineRunId: runId })]);
  const store = fakeStore([{ runId, status: 'failed', finishedAt: '2026-07-25T09:00:00.000Z' }]);

  const first  = runBackfill({ dataDir, store });
  const snap   = fs.readFileSync(path.join(dataDir, 'agent-runs.jsonl'), 'utf8');
  const second = runBackfill({ dataDir, store });
  const snap2  = fs.readFileSync(path.join(dataDir, 'agent-runs.jsonl'), 'utf8');

  assert.equal(first.changed, 1);
  assert.equal(second.changed, 0);
  assert.equal(snap, snap2);
});

test('record missing pipelineRunId is skipped defensively', () => {
  const dataDir = tmpDir();
  const rec = mkRecord();
  delete rec.pipelineRunId;
  writeAgentRuns(dataDir, [rec]);
  const store = fakeStore([]);

  const res = runBackfill({ dataDir, store });
  assert.equal(res.changed, 0);
  assert.equal(readAgentRuns(dataDir)[0].status, 'running');
});

test('all four terminal parent statuses trigger backfill', () => {
  for (const status of ['completed', 'failed', 'interrupted', 'cancelled']) {
    const dataDir = tmpDir();
    const runId = crypto.randomUUID();
    writeAgentRuns(dataDir, [mkRecord({ pipelineRunId: runId })]);
    const store = fakeStore([{ runId, status, finishedAt: '2026-07-25T09:00:00.000Z' }]);
    const res = runBackfill({ dataDir, store });
    assert.equal(res.changed, 1, `parent status '${status}' should trigger backfill`);
    assert.equal(readAgentRuns(dataDir)[0].status, 'cancelled');
  }
});

test('non-fatal on read/write error — returns error object, does not throw', () => {
  const dataDir = tmpDir();
  const runId = crypto.randomUUID();
  writeAgentRuns(dataDir, [mkRecord({ pipelineRunId: runId })]);
  const brokenStore = { listRuns: () => { throw new Error('db unavailable'); } };

  const res = runBackfill({ dataDir, store: brokenStore });
  assert.equal(res.changed, 0);
  assert.match(res.error, /db unavailable/);
});
