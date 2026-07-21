'use strict';

/**
 * Unit tests for bin/run-logs.js — print mode (mocked deps).
 * Integration tests for follow mode live in cli.run-logs.integration.test.js.
 */

const { describe, it } = require('node:test');
const assert           = require('node:assert/strict');

const { bufWriter, mockDeps } = require('./helpers/cliDeps.js');

const L = require('../bin/run-logs.js');

describe('run-logs — stageHeader / stageFooter', () => {
  it('ANSI codes are absent when stream is not a TTY', () => {
    const h = L.stageHeader(1, 4, 'developer', 'running', { stream: bufWriter(false) });
    assert.ok(!/\x1b\[/.test(h), 'no ANSI when non-TTY');
    assert.match(h, /Stage 2 \/ 4/);
    assert.match(h, /developer/);
    assert.match(h, /running/);
  });

  it('ANSI codes are present when stream is a TTY', () => {
    const h = L.stageHeader(0, 2, 'architect', 'pending', { stream: bufWriter(true) });
    assert.match(h, /\x1b\[/);
  });

  it('stageFooter has same shape but different label emphasis', () => {
    const f = L.stageFooter(0, 2, 'a', 'completed', { stream: bufWriter(false) });
    assert.match(f, /Stage 1 \/ 2/);
    assert.match(f, /completed/);
  });
});

describe('run-logs — statusFor / normaliseStages', () => {
  it('statusFor returns "pending" when stageStatuses is missing', () => {
    assert.equal(L.statusFor({}, 0), 'pending');
  });

  it('statusFor returns the entry status when present', () => {
    assert.equal(L.statusFor({ stageStatuses: [{ status: 'done' }] }, 0), 'done');
  });

  it('normaliseStages handles missing arrays', () => {
    const n = L.normaliseStages({});
    assert.deepEqual(n.stages, []);
    assert.deepEqual(n.statuses, []);
  });
});

describe('run-logs — print mode (mocked)', () => {
  it('errors when runId is missing', async () => {
    const deps = mockDeps();
    await L.run('', {}, deps);
    assert.match(deps._captured.stderr.text(), /runId is required/);
    assert.deepEqual(deps._captured.exits, [2]);
  });

  it('prints one header per stage and each file content', async () => {
    const deps = mockDeps({
      _resolveRun: async () => ({
        run: {
          runId: 'runx1234abcd',
          stages: ['architect', 'developer'],
          stageStatuses: [{ status: 'completed' }, { status: 'running' }],
        },
        source: 'fs',
      }),
      _readStageLog: async (_runId, i) => ({ path: `/fake/stage-${i}.log`, fromHttp: false }),
      _readFile: async (p) => `LOG-${p}\n`,
    });
    await L.run('runx1234', {}, deps);
    const out = deps._captured.stdout.text();
    const headers = out.match(/━━━ Stage/g) || [];
    assert.equal(headers.length, 2);
    assert.match(out, /LOG-\/fake\/stage-0\.log/);
    assert.match(out, /LOG-\/fake\/stage-1\.log/);
    assert.deepEqual(deps._captured.exits, [0]);
  });

  it('--stage <n> restricts output to that stage', async () => {
    const deps = mockDeps({
      _resolveRun: async () => ({
        run: {
          runId: 'runx1234abcd',
          stages: ['a', 'b', 'c'],
          stageStatuses: [{ status: 'done' }, { status: 'done' }, { status: 'pending' }],
        },
      }),
      _readStageLog: async (_runId, i) => ({ path: `/x/stage-${i}.log`, fromHttp: false }),
      _readFile: async (p) => `body-${p}\n`,
    });
    await L.run('runx1234', { stage: '1' }, deps);
    const out = deps._captured.stdout.text();
    assert.equal((out.match(/━━━ Stage/g) || []).length, 1);
    assert.match(out, /body-\/x\/stage-1/);
    assert.doesNotMatch(out, /stage-0/);
  });

  it('--stage out of range exits 1', async () => {
    const deps = mockDeps({
      _resolveRun: async () => ({
        run: { runId: 'r', stages: ['a', 'b'], stageStatuses: [] },
      }),
    });
    await L.run('runx1234', { stage: '5' }, deps);
    assert.match(deps._captured.stderr.text(), /out of range/);
    assert.deepEqual(deps._captured.exits, [1]);
  });

  it('missing log file writes "(no log yet)" and continues', async () => {
    const deps = mockDeps({
      _resolveRun: async () => ({
        run: { runId: 'r', stages: ['a'], stageStatuses: [{ status: 'pending' }] },
      }),
      _readStageLog: async () => ({ path: '/does/not/exist.log', fromHttp: false }),
      _readFile: async () => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    });
    await L.run('runx1234', {}, deps);
    assert.match(deps._captured.stdout.text(), /\(no log yet\)/);
    assert.deepEqual(deps._captured.exits, [0]);
  });

  it('HTTP fallback path writes content instead of streaming', async () => {
    const deps = mockDeps({
      _resolveRun: async () => ({
        run: { runId: 'r', stages: ['a'], stageStatuses: [] },
      }),
      _readStageLog: async () => ({ content: 'HTTP LOG BODY\n', fromHttp: true }),
    });
    await L.run('runx1234', { serverUrl: 'http://x' }, deps);
    assert.match(deps._captured.stdout.text(), /HTTP LOG BODY/);
    assert.deepEqual(deps._captured.exits, [0]);
  });
});

describe('run-logs — follow mode flag validation', () => {
  it('rejects --poll-ms below range', async () => {
    const deps = mockDeps({
      _resolveRun: async () => ({ run: { runId: 'r', stages: ['a'], stageStatuses: [], currentStage: 0 } }),
    });
    await L.run('runx1234', { follow: true, pollMs: '10' }, deps);
    assert.match(deps._captured.stderr.text(), /--poll-ms must be between/);
    assert.deepEqual(deps._captured.exits, [2]);
  });

  it('rejects non-numeric --poll-ms', async () => {
    const deps = mockDeps({
      _resolveRun: async () => ({ run: { runId: 'r', stages: ['a'], stageStatuses: [], currentStage: 0 } }),
    });
    await L.run('runx1234', { follow: true, pollMs: 'abc' }, deps);
    assert.deepEqual(deps._captured.exits, [2]);
  });
});
