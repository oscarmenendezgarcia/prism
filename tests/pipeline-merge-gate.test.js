/**
 * Merge gate — minimal scaffolding
 *
 * When a run's final stage completes, the pipeline used to unconditionally move
 * the Kanban card to 'done'. That was silently lying: multiple cards sat in
 * 'done' for weeks with their PRs unmerged. The merge gate stops the auto-move
 * whenever the task has a GitHub PR URL attached. Runs without a PR (space
 * that is not a repo, or a repo without a remote) keep the pre-existing
 * auto-move behaviour.
 *
 * Meta: this test file is part of the first task ever to exercise the rule it
 * introduces — the very run that produces the PR for this feature must NOT
 * reach 'done' automatically.
 *
 * Run with: node --test tests/pipeline-merge-gate.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const http   = require('http');
const crypto = require('crypto');

delete process.env.PIPELINE_RUNS_DIR;

// Fresh require so the module-level _store is null and we exercise the legacy
// JSON path (the code paths agents actually hit in the pipeline's completion
// branch).
delete require.cache[require.resolve('../src/services/pipelineManager')];
const pm = require('../src/services/pipelineManager');

function tmpDir(prefix = 'prism-mergegate-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

function writeTaskWithAttachments(dataDir, spaceId, taskId, attachments) {
  const spaceDir = path.join(dataDir, 'spaces', spaceId);
  fs.mkdirSync(spaceDir, { recursive: true });
  const task = {
    id: taskId,
    title: 'T',
    type: 'chore',
    attachments,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(spaceDir, 'todo.json'), JSON.stringify([]), 'utf8');
  fs.writeFileSync(path.join(spaceDir, 'in-progress.json'), JSON.stringify([task]), 'utf8');
  fs.writeFileSync(path.join(spaceDir, 'done.json'), JSON.stringify([]), 'utf8');
}

// ---------------------------------------------------------------------------
// findPrUrlOnTask — pure detection logic
// ---------------------------------------------------------------------------

describe('findPrUrlOnTask — detection', () => {
  test('returns the URL when a link attachment points at a GitHub PR', () => {
    const dataDir = tmpDir();
    const spaceId = 's1';
    const taskId  = crypto.randomUUID();
    writeTaskWithAttachments(dataDir, spaceId, taskId, [
      { name: 'PR', type: 'link', content: 'https://github.com/foo/bar/pull/197' },
    ]);
    try {
      const url = pm.findPrUrlOnTask(dataDir, { spaceId, taskId });
      assert.equal(url, 'https://github.com/foo/bar/pull/197');
    } finally { rmrf(dataDir); }
  });

  test('tolerates trailing path, query, hash', () => {
    const dataDir = tmpDir();
    const spaceId = 's1';
    const taskId  = crypto.randomUUID();
    writeTaskWithAttachments(dataDir, spaceId, taskId, [
      { name: 'PR', type: 'link', content: 'https://github.com/foo/bar/pull/12/files?diff=split#top' },
    ]);
    try {
      const url = pm.findPrUrlOnTask(dataDir, { spaceId, taskId });
      assert.equal(url, 'https://github.com/foo/bar/pull/12/files?diff=split#top');
    } finally { rmrf(dataDir); }
  });

  test('returns null when there are no attachments', () => {
    const dataDir = tmpDir();
    const spaceId = 's1';
    const taskId  = crypto.randomUUID();
    writeTaskWithAttachments(dataDir, spaceId, taskId, []);
    try {
      assert.equal(pm.findPrUrlOnTask(dataDir, { spaceId, taskId }), null);
    } finally { rmrf(dataDir); }
  });

  test('ignores non-link attachments even if their content looks like a PR', () => {
    const dataDir = tmpDir();
    const spaceId = 's1';
    const taskId  = crypto.randomUUID();
    writeTaskWithAttachments(dataDir, spaceId, taskId, [
      // A stray text note that mentions a PR URL is not the same as an attached link.
      { name: 'notes', type: 'text', content: 'see https://github.com/foo/bar/pull/1' },
      { name: 'log',   type: 'file', content: '/tmp/log.txt' },
    ]);
    try {
      assert.equal(pm.findPrUrlOnTask(dataDir, { spaceId, taskId }), null);
    } finally { rmrf(dataDir); }
  });

  test('ignores non-PR GitHub URLs (issues, discussions, docs)', () => {
    const dataDir = tmpDir();
    const spaceId = 's1';
    const taskId  = crypto.randomUUID();
    writeTaskWithAttachments(dataDir, spaceId, taskId, [
      { name: 'issue', type: 'link', content: 'https://github.com/foo/bar/issues/42' },
      { name: 'docs',  type: 'link', content: 'https://github.com/foo/bar/blob/main/README.md' },
      { name: 'disc',  type: 'link', content: 'https://github.com/foo/bar/discussions/1' },
    ]);
    try {
      assert.equal(pm.findPrUrlOnTask(dataDir, { spaceId, taskId }), null);
    } finally { rmrf(dataDir); }
  });

  test('returns the first PR link when several attachments exist', () => {
    const dataDir = tmpDir();
    const spaceId = 's1';
    const taskId  = crypto.randomUUID();
    writeTaskWithAttachments(dataDir, spaceId, taskId, [
      { name: 'issue', type: 'link', content: 'https://github.com/foo/bar/issues/1' },
      { name: 'pr1',   type: 'link', content: 'https://github.com/foo/bar/pull/9' },
      { name: 'pr2',   type: 'link', content: 'https://github.com/foo/bar/pull/10' },
    ]);
    try {
      assert.equal(pm.findPrUrlOnTask(dataDir, { spaceId, taskId }), 'https://github.com/foo/bar/pull/9');
    } finally { rmrf(dataDir); }
  });

  test('returns null when the task cannot be found', () => {
    const dataDir = tmpDir();
    try {
      assert.equal(pm.findPrUrlOnTask(dataDir, { spaceId: 'nope', taskId: 'nope' }), null);
    } finally { rmrf(dataDir); }
  });
});

// ---------------------------------------------------------------------------
// executeNextStage completion — moveKanbanTask call is gated on the PR URL
// ---------------------------------------------------------------------------

/**
 * Spin up a tiny HTTP server that records every `/spaces/:spaceId/tasks/:taskId/move`
 * PUT it receives. Returned handle exposes { origin, moves, close() }.
 */
function startMockKanban() {
  const moves = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const match = /\/spaces\/([^/]+)\/tasks\/([^/]+)\/move$/.exec(req.url || '');
      if (req.method === 'PUT' && match) {
        let payload = null;
        try { payload = JSON.parse(body || '{}'); } catch { payload = { _rawBody: body }; }
        moves.push({ spaceId: match[1], taskId: match[2], to: payload.to });
      }
      res.statusCode = 204;
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        origin: `http://127.0.0.1:${port}/api/v1`,
        moves,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function writeRunAtLastStage(dataDir, runId, spaceId, taskId) {
  const runDirPath = path.join(dataDir, 'runs', runId);
  fs.mkdirSync(runDirPath, { recursive: true });
  const now = new Date().toISOString();
  const runState = {
    runId,
    spaceId,
    taskId,
    stages: ['developer-agent'],
    currentStage: 1, // past the end → completion branch
    status: 'running',
    stageStatuses: [
      { index: 0, agentId: 'developer-agent', status: 'completed', exitCode: 0, startedAt: now, finishedAt: now },
    ],
    checkpoints: [],
    createdAt: now,
    updatedAt: now,
  };
  fs.writeFileSync(path.join(runDirPath, 'run.json'), JSON.stringify(runState), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'runs', 'runs.json'),
    JSON.stringify([{ runId, spaceId, taskId, status: 'running', createdAt: now }]),
    'utf8'
  );
  return runState;
}

describe('executeNextStage completion — merge gate', () => {
  test('run with a PR-URL attachment does NOT auto-move the card to done', async () => {
    const kanban  = await startMockKanban();
    const dataDir = tmpDir();
    const prev    = process.env.KANBAN_API_URL;
    process.env.KANBAN_API_URL = kanban.origin;

    const spaceId = 's-merge-hold';
    const taskId  = crypto.randomUUID();
    const runId   = crypto.randomUUID();
    writeTaskWithAttachments(dataDir, spaceId, taskId, [
      { name: 'PR', type: 'link', content: 'https://github.com/foo/bar/pull/999' },
    ]);
    await writeRunAtLastStage(dataDir, runId, spaceId, taskId);

    try {
      await pm._executeNextStageForTest(dataDir, runId);

      // The run is marked completed…
      const finalRun = JSON.parse(fs.readFileSync(path.join(dataDir, 'runs', runId, 'run.json'), 'utf8'));
      assert.equal(finalRun.status, 'completed', 'run should be marked completed');
      // …but the Kanban card was never auto-moved to done.
      assert.equal(kanban.moves.length, 0, `expected no move calls, got ${JSON.stringify(kanban.moves)}`);
    } finally {
      if (prev === undefined) delete process.env.KANBAN_API_URL;
      else process.env.KANBAN_API_URL = prev;
      await kanban.close();
      rmrf(dataDir);
    }
  });

  test('run with no PR-URL attachment still auto-moves the card to done', async () => {
    const kanban  = await startMockKanban();
    const dataDir = tmpDir();
    const prev    = process.env.KANBAN_API_URL;
    process.env.KANBAN_API_URL = kanban.origin;

    const spaceId = 's-no-pr';
    const taskId  = crypto.randomUUID();
    const runId   = crypto.randomUUID();
    writeTaskWithAttachments(dataDir, spaceId, taskId, [
      // A non-PR link — must not gate.
      { name: 'notes', type: 'link', content: 'https://example.com/notes' },
    ]);
    await writeRunAtLastStage(dataDir, runId, spaceId, taskId);

    try {
      await pm._executeNextStageForTest(dataDir, runId);

      const finalRun = JSON.parse(fs.readFileSync(path.join(dataDir, 'runs', runId, 'run.json'), 'utf8'));
      assert.equal(finalRun.status, 'completed', 'run should be marked completed');
      assert.equal(kanban.moves.length, 1, 'expected exactly one move call');
      assert.deepEqual(
        kanban.moves[0],
        { spaceId, taskId, to: 'done' },
        'the single move call should target the completed task and set it to done',
      );
    } finally {
      if (prev === undefined) delete process.env.KANBAN_API_URL;
      else process.env.KANBAN_API_URL = prev;
      await kanban.close();
      rmrf(dataDir);
    }
  });
});
