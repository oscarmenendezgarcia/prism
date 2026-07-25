'use strict';

/**
 * Tests for src/services/runLogReader.js
 *
 * Uses in-memory `_fs`, `_resolveRun`, and `_normalize` stubs so no real
 * files or resolver logic is exercised.
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');

const { readRunLogs, BadRequestError } = require('../src/services/runLogReader');
const runResolver = require('../src/utils/runResolver');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFs(files) {
  return {
    existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFileSync: (p) => {
      if (!Object.prototype.hasOwnProperty.call(files, p)) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return files[p];
    },
  };
}

const DEFAULT_RUN = {
  runId:        'abcdef1234567890',
  spaceId:      'space-1',
  taskId:       'task-1',
  status:       'running',
  currentStage: 1,
  stages:       ['senior-architect', 'developer-agent'],
  stageStatuses: [
    { status: 'completed', cliTool: 'claude' },
    { status: 'running',   cliTool: 'opencode' },
  ],
};

function stubResolve(run = DEFAULT_RUN) {
  return async (_prefix, _opts) => ({ run, source: 'fs' });
}

function stubNormalize(spec) {
  // spec is a synchronous mapper from (text, opts) → normalized-shape override.
  return (text, opts) => {
    const defaults = {
      format:    'plain-text',
      content:   text,
      bytesIn:   Buffer.byteLength(text, 'utf8'),
      linesOut:  text.split('\n').length,
      truncated: false,
    };
    return spec ? { ...defaults, ...spec(text, opts) } : defaults;
  };
}

const DATA = '/tmp/data';
const runDir = path.join(DATA, 'runs', DEFAULT_RUN.runId);
const stage0Path = path.join(runDir, 'stage-0.log');
const stage1Path = path.join(runDir, 'stage-1.log');

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

test('returns all stages when stage omitted', async () => {
  const _fs = makeFs({
    [stage0Path]: '{"type":"system","subtype":"init"}',
    [stage1Path]: 'plain output line',
  });

  const result = await readRunLogs({
    runId:       'abcdef12',
    dataDir:     DATA,
    _fs,
    _resolveRun: stubResolve(),
    _normalize:  stubNormalize(),
  });

  assert.equal(result.runId,       'abcdef1234567890');
  assert.equal(result.spaceId,     'space-1');
  assert.equal(result.taskId,      'task-1');
  assert.equal(result.status,      'running');
  assert.equal(result.currentStage, 1);
  assert.equal(result.stages.length, 2);
  assert.equal(result.stages[0].agentId, 'senior-architect');
  assert.equal(result.stages[0].cliTool, 'claude');
  assert.equal(result.stages[0].status,  'completed');
  assert.equal(result.stages[1].agentId, 'developer-agent');
});

test('returns only the requested stage when stage supplied', async () => {
  const _fs = makeFs({
    [stage0Path]: 'a',
    [stage1Path]: 'b',
  });
  const result = await readRunLogs({
    runId: 'abcdef12', stage: 1, dataDir: DATA,
    _fs, _resolveRun: stubResolve(), _normalize: stubNormalize(),
  });
  assert.equal(result.stages.length, 1);
  assert.equal(result.stages[0].index, 1);
  assert.equal(result.stages[0].content, 'b');
});

test('missing stage log → content:"(no log yet)" and bytes:0', async () => {
  const _fs = makeFs({ [stage0Path]: 'a' }); // stage 1 missing
  const result = await readRunLogs({
    runId: 'abcdef12', dataDir: DATA,
    _fs, _resolveRun: stubResolve(), _normalize: stubNormalize(),
  });
  assert.equal(result.stages[1].content, '(no log yet)');
  assert.equal(result.stages[1].bytes, 0);
  assert.equal(result.stages[1].truncated, false);
});

test('propagates tail/raw/maxBytes options to normalizer', async () => {
  const seen = [];
  const _normalize = (text, opts) => {
    seen.push(opts);
    return { format: 'plain-text', content: text, linesOut: 1, truncated: false };
  };
  const _fs = makeFs({ [stage0Path]: 'x', [stage1Path]: 'y' });
  await readRunLogs({
    runId: 'abcdef12', dataDir: DATA, tail: 42, raw: true, maxBytes: 1024,
    _fs, _resolveRun: stubResolve(), _normalize,
  });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].tail, 42);
  assert.equal(seen[0].raw, true);
  assert.equal(seen[0].maxBytes, 1024);
});

test('stage-object form: run.stages[i] as {agentId} still resolves', async () => {
  const run = {
    ...DEFAULT_RUN,
    stages: [{ agentId: 'senior-architect' }, { agentId: 'developer-agent' }],
  };
  const _fs = makeFs({ [stage0Path]: 'x', [stage1Path]: 'y' });
  const result = await readRunLogs({
    runId: 'abcdef12', dataDir: DATA,
    _fs, _resolveRun: stubResolve(run), _normalize: stubNormalize(),
  });
  assert.equal(result.stages[0].agentId, 'senior-architect');
  assert.equal(result.stages[1].agentId, 'developer-agent');
});

// ---------------------------------------------------------------------------
// Validation & error paths
// ---------------------------------------------------------------------------

test('out-of-range stage → BadRequestError', async () => {
  const _fs = makeFs({});
  await assert.rejects(
    () => readRunLogs({
      runId: 'abcdef12', stage: 99, dataDir: DATA,
      _fs, _resolveRun: stubResolve(), _normalize: stubNormalize(),
    }),
    (err) => err instanceof BadRequestError && err.code === 'BAD_REQUEST'
  );
});

test('missing dataDir → BadRequestError', async () => {
  await assert.rejects(
    () => readRunLogs({ runId: 'abcdef12' }),
    (err) => err instanceof BadRequestError
  );
});

test('propagates RunNotFoundError from resolver unchanged', async () => {
  const _resolveRun = async () => {
    throw new runResolver.RunNotFoundError('abcdef12');
  };
  await assert.rejects(
    () => readRunLogs({
      runId: 'abcdef12', dataDir: DATA,
      _fs: makeFs({}), _resolveRun, _normalize: stubNormalize(),
    }),
    (err) => err instanceof runResolver.RunNotFoundError
  );
});

test('propagates AmbiguousRunError from resolver unchanged', async () => {
  const _resolveRun = async () => {
    throw new runResolver.AmbiguousRunError('abcdef12', [
      { runId: 'abcdef1200000000' }, { runId: 'abcdef1211111111' },
    ]);
  };
  await assert.rejects(
    () => readRunLogs({
      runId: 'abcdef12', dataDir: DATA,
      _fs: makeFs({}), _resolveRun, _normalize: stubNormalize(),
    }),
    (err) => err instanceof runResolver.AmbiguousRunError
  );
});

test('propagates ShortPrefixError from resolver unchanged', async () => {
  const _resolveRun = async () => {
    throw new runResolver.ShortPrefixError('abc');
  };
  await assert.rejects(
    () => readRunLogs({
      runId: 'abc', dataDir: DATA,
      _fs: makeFs({}), _resolveRun, _normalize: stubNormalize(),
    }),
    (err) => err instanceof runResolver.ShortPrefixError
  );
});

test('read error surfaces as internal error', async () => {
  const _fs = {
    existsSync: () => true,
    readFileSync: () => { throw new Error('boom'); },
  };
  await assert.rejects(
    () => readRunLogs({
      runId: 'abcdef12', dataDir: DATA,
      _fs, _resolveRun: stubResolve(), _normalize: stubNormalize(),
    }),
    (err) => err.code === 'INTERNAL' && /boom/.test(err.message)
  );
});
