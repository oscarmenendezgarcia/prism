'use strict';

/**
 * Unit tests for bin/pipeline.js — verb dispatcher + list mode.
 */

const { describe, it } = require('node:test');
const assert           = require('node:assert/strict');

const P = require('../bin/pipeline.js');

function bufWriter() {
  const chunks = [];
  return {
    write: (s) => { chunks.push(String(s)); return true; },
    text:  () => chunks.join(''),
  };
}

function mockDeps(over = {}) {
  const stdout = bufWriter();
  const stderr = bufWriter();
  const exits  = [];
  return {
    _stdout: stdout,
    _stderr: stderr,
    _exit:   (n) => exits.push(n),
    _now:    () => new Date('2026-07-21T12:00:00Z'),
    _resolveDataDir: () => ({ path: '/tmp/fake-data', mode: 'env' }),
    _listRuns: async () => [],
    _titleLookup: () => '',
    ...over,
    // expose captured state
    _captured: { stdout, stderr, exits },
  };
}

describe('bin/pipeline — formatAgo', () => {
  const now = new Date('2026-07-21T12:00:00Z');
  it('formats seconds', () => {
    assert.equal(P.formatAgo(new Date('2026-07-21T11:59:55Z'), now), '5s ago');
  });
  it('formats minutes', () => {
    assert.equal(P.formatAgo(new Date('2026-07-21T11:55:00Z'), now), '5m ago');
  });
  it('formats hours', () => {
    assert.equal(P.formatAgo(new Date('2026-07-21T09:00:00Z'), now), '3h ago');
  });
  it('formats days', () => {
    assert.equal(P.formatAgo(new Date('2026-07-19T12:00:00Z'), now), '2d ago');
  });
  it('returns empty string for invalid date', () => {
    assert.equal(P.formatAgo('not-a-date', now), '');
  });
});

describe('bin/pipeline — truncate + padRight', () => {
  it('padRight fills to width', () => {
    assert.equal(P.padRight('ab', 5), 'ab   ');
  });
  it('padRight is a no-op past width', () => {
    assert.equal(P.padRight('abcdef', 3), 'abcdef');
  });
  it('truncate appends ellipsis', () => {
    assert.equal(P.truncate('abcdefghij', 5), 'abcd…');
  });
  it('truncate keeps short strings intact', () => {
    assert.equal(P.truncate('ab', 5), 'ab');
  });
});

describe('bin/pipeline — formatRunRow', () => {
  it('renders runId shortened to 8 chars + agent name', () => {
    const now = new Date('2026-07-21T12:00:00Z');
    const row = P.formatRunRow(
      {
        runId: '615087e4-00b6-44f1-bc2f-d04b54387969',
        status: 'running',
        stages: ['a', 'b', 'c'],
        currentStage: 1,
        taskId: 'task-1',
        updatedAt: '2026-07-21T11:59:58Z',
      },
      (taskId) => taskId ? 'A very long task title that should be truncated eventually to fit' : '',
      now,
    );
    assert.equal(row.runId.trim(), '615087e4');
    assert.match(row.stage, /2\/3/);
    assert.match(row.stage, /^2\/3 {2}b/);
    assert.equal(row.updated.trim(), '2s ago');
    assert.ok(row.title.length <= 40);
    assert.match(row.title, /…$/);
  });
});

describe('bin/pipeline — list mode', () => {
  it('prints header + row for a single run and exits 0', async () => {
    const deps = mockDeps({
      _listRuns: async () => [{
        runId: 'abcdef123456', status: 'completed', stages: ['dev', 'qa'], currentStage: 1,
        updatedAt: '2026-07-21T11:59:00Z',
      }],
    });
    await P.run({}, [], deps);
    const out = deps._captured.stdout.text();
    assert.match(out, /RUN ID/);
    assert.match(out, /abcdef12/);
    assert.match(out, /completed/);
    assert.deepEqual(deps._captured.exits, [0]);
  });

  it('empty list writes "No runs yet." to stderr and exits 0', async () => {
    const deps = mockDeps({ _listRuns: async () => [] });
    await P.run({}, [], deps);
    assert.match(deps._captured.stderr.text(), /No runs yet\./);
    assert.deepEqual(deps._captured.exits, [0]);
  });

  it('rejects non-numeric --limit with exit 2', async () => {
    const deps = mockDeps();
    await P.run({ limit: 'twelve' }, [], deps);
    assert.match(deps._captured.stderr.text(), /--limit must be a positive integer/);
    assert.deepEqual(deps._captured.exits, [2]);
  });

  it('caps --limit at MAX_LIMIT', async () => {
    let capturedLimit = null;
    const deps = mockDeps({
      _listRuns: async (opts) => { capturedLimit = opts.limit; return []; },
    });
    await P.run({ limit: '9999' }, [], deps);
    assert.equal(capturedLimit, 100);
  });
});

describe('bin/pipeline — verb dispatch', () => {
  it('with only runId, dispatches to logs verb', async () => {
    let sawCall = null;
    // Monkey-patch VERB_HANDLERS to capture the invocation without touching pipeline-logs
    const original = P.VERB_HANDLERS.logs;
    P.VERB_HANDLERS.logs = (runId, flags, deps) => {
      sawCall = { runId, flags, deps };
      return Promise.resolve();
    };
    try {
      const deps = mockDeps();
      await P.run({ foo: 'bar' }, ['abc12345'], deps);
      assert.equal(sawCall.runId, 'abc12345');
      assert.equal(sawCall.flags.foo, 'bar');
    } finally {
      P.VERB_HANDLERS.logs = original;
    }
  });

  it('unknown verb writes to stderr and exits 2', async () => {
    const deps = mockDeps();
    await P.run({}, ['abc12345', 'bogus'], deps);
    assert.match(deps._captured.stderr.text(), /unknown verb 'bogus'/);
    assert.deepEqual(deps._captured.exits, [2]);
  });

  it('logs verb is invoked when explicit', async () => {
    let sawCall = null;
    const original = P.VERB_HANDLERS.logs;
    P.VERB_HANDLERS.logs = (runId) => { sawCall = runId; return Promise.resolve(); };
    try {
      const deps = mockDeps();
      await P.run({}, ['abc12345', 'logs'], deps);
      assert.equal(sawCall, 'abc12345');
    } finally {
      P.VERB_HANDLERS.logs = original;
    }
  });
});
