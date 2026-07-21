'use strict';

/**
 * Unit tests for src/utils/runResolver.js
 * Covers: prefix validation, ambiguity, listRuns ordering, HTTP fallback,
 * FS fallback, readStageLog, typed errors.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const R = require('../src/utils/runResolver.js');

function mkTmpDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-runres-'));
  fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
  return dir;
}

function writeRun(dataDir, runId, run) {
  const rdir = path.join(dataDir, 'runs', runId);
  fs.mkdirSync(rdir, { recursive: true });
  fs.writeFileSync(path.join(rdir, 'run.json'), JSON.stringify(run));
}

function writeRegistry(dataDir, entries) {
  fs.writeFileSync(path.join(dataDir, 'runs', 'runs.json'), JSON.stringify(entries));
}

describe('runResolver — typed errors', () => {
  it('rejects prefixes shorter than 8 chars with ShortPrefixError (exit 2)', async () => {
    await assert.rejects(
      R.resolveRun('abc', { dataDir: '/tmp/x' }),
      (err) => err instanceof R.ShortPrefixError && err.exitCode === 2
    );
  });

  it('ShortPrefixError message mentions minimum length', async () => {
    try { await R.resolveRun('short', { dataDir: '/tmp/x' }); assert.fail('should throw'); }
    catch (err) { assert.match(err.message, /at least 8/); }
  });

  it('rejects with RunNotFoundError when no runs match', async () => {
    const dir = mkTmpDataDir();
    writeRegistry(dir, []);
    try {
      await assert.rejects(
        R.resolveRun('abcdef1234', { dataDir: dir }),
        (err) => err instanceof R.RunNotFoundError && err.exitCode === 1
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects with AmbiguousRunError and exposes candidates', async () => {
    const dir = mkTmpDataDir();
    writeRegistry(dir, [
      { runId: '12345678aaaa', updatedAt: '2026-06-01T00:00:00Z' },
      { runId: '12345678bbbb', updatedAt: '2026-06-02T00:00:00Z' },
    ]);
    try {
      await assert.rejects(
        R.resolveRun('12345678', { dataDir: dir }),
        (err) =>
          err instanceof R.AmbiguousRunError &&
          err.exitCode === 2 &&
          Array.isArray(err.candidates) &&
          err.candidates.length === 2
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runResolver — listRuns', () => {
  it('reads FS registry when no serverUrl and no store', async () => {
    const dir = mkTmpDataDir();
    writeRegistry(dir, [
      { runId: 'aaaabbbb0001', updatedAt: '2026-06-01T00:00:00Z' },
      { runId: 'aaaabbbb0002', updatedAt: '2026-06-05T00:00:00Z' },
    ]);
    try {
      const runs = await R.listRuns({ dataDir: dir, _openStore: () => null });
      assert.equal(runs.length, 2);
      // Sorted by updatedAt desc
      assert.equal(runs[0].runId, 'aaaabbbb0002');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('respects the limit option', async () => {
    const dir = mkTmpDataDir();
    writeRegistry(dir, [
      { runId: 'aaaabbbb0001', updatedAt: '2026-06-01T00:00:00Z' },
      { runId: 'aaaabbbb0002', updatedAt: '2026-06-05T00:00:00Z' },
      { runId: 'aaaabbbb0003', updatedAt: '2026-06-06T00:00:00Z' },
    ]);
    try {
      const runs = await R.listRuns({ dataDir: dir, _openStore: () => null, limit: 2 });
      assert.equal(runs.length, 2);
      assert.equal(runs[0].runId, 'aaaabbbb0003');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses HTTP when serverUrl is provided', async () => {
    const calls = [];
    const _fetch = async (url) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => ([{ runId: 'httprun1234', updatedAt: '2026-07-01T00:00:00Z' }]),
      };
    };
    const runs = await R.listRuns({ dataDir: '/does/not/matter', serverUrl: 'http://x:1/', _fetch });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].runId, 'httprun1234');
    assert.equal(calls[0], 'http://x:1/api/v1/runs');
  });

  it('prefers the store when available', async () => {
    const dir = mkTmpDataDir();
    writeRegistry(dir, [{ runId: 'fromfsFS12345', updatedAt: '2026-01-01T00:00:00Z' }]);
    try {
      const runs = await R.listRuns({
        dataDir: dir,
        _openStore: () => ({
          listRuns: () => [{ runId: 'fromstore123', updatedAt: '2026-06-01T00:00:00Z' }],
          close: () => {},
        }),
      });
      assert.equal(runs[0].runId, 'fromstore123');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runResolver — resolveRun', () => {
  it('resolves via FS when prefix uniquely matches', async () => {
    const dir = mkTmpDataDir();
    const runId = 'uniqueid1abcd';
    writeRegistry(dir, [{ runId, updatedAt: '2026-06-01T00:00:00Z' }]);
    writeRun(dir, runId, { runId, status: 'completed', stages: ['a', 'b'] });
    try {
      const { run, source } = await R.resolveRun('uniqueid', {
        dataDir: dir, _openStore: () => null,
      });
      assert.equal(run.runId, runId);
      assert.equal(source, 'fs');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves via HTTP when serverUrl is set', async () => {
    const _fetch = async (url) => {
      if (url.endsWith('/api/v1/runs')) {
        return { ok: true, json: async () => [{ runId: 'httprunids12345', updatedAt: '2026-06-01T00:00:00Z' }] };
      }
      if (url.endsWith('/api/v1/runs/httprunids12345')) {
        return { ok: true, json: async () => ({ runId: 'httprunids12345', status: 'running', stages: ['a'] }) };
      }
      return { ok: false, status: 404 };
    };
    const { run, source } = await R.resolveRun('httprunids', {
      dataDir: '/tmp/nowhere', serverUrl: 'http://x:1', _fetch,
    });
    assert.equal(run.runId, 'httprunids12345');
    assert.equal(source, 'http');
  });
});

describe('runResolver — readStageLog', () => {
  it('returns { path } for FS mode', async () => {
    const res = await R.readStageLog('runid1', 2, { dataDir: '/tmp/root' });
    assert.equal(res.fromHttp, false);
    assert.equal(res.path, path.join('/tmp/root', 'runs', 'runid1', 'stage-2.log'));
  });

  it('returns { content, fromHttp } for HTTP mode', async () => {
    const _fetch = async () => ({ ok: true, text: async () => 'log body\n' });
    const res = await R.readStageLog('runid1', 0, { serverUrl: 'http://x:1', _fetch });
    assert.equal(res.fromHttp, true);
    assert.equal(res.content, 'log body\n');
  });

  it('throws StageNotAvailableError on HTTP 404', async () => {
    const _fetch = async () => ({ ok: false, status: 404 });
    await assert.rejects(
      R.readStageLog('runid1', 0, { serverUrl: 'http://x:1', _fetch }),
      (err) => err instanceof R.StageNotAvailableError && err.exitCode === 1
    );
  });
});
