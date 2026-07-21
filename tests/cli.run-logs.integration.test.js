'use strict';

/**
 * Integration tests for `prism run` — spawns the real CLI against a
 * temporary data-dir populated with fake run.json + stage-N.log files.
 *
 * No server is spawned; HTTP fallback is not exercised here (that path is
 * covered by unit tests with a mocked _fetch).
 */

const { describe, it } = require('node:test');
const assert           = require('node:assert/strict');
const fs               = require('fs');
const os               = require('os');
const path             = require('path');
const { spawnSync, spawn } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

function mkFixture({ runId, stages, stageContents, status = 'completed', currentStage = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-cli-run-'));
  const runsDir = path.join(dir, 'runs');
  const runDir  = path.join(runsDir, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const run = {
    runId,
    spaceId: 'space-x',
    taskId:  'task-x',
    stages,
    stageStatuses: stages.map((_, i) => ({
      status: currentStage === null
        ? 'completed'
        : (i < currentStage ? 'completed' : (i === currentStage ? 'running' : 'pending')),
    })),
    currentStage: currentStage === null ? stages.length - 1 : currentStage,
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run));
  fs.writeFileSync(path.join(runsDir, 'runs.json'), JSON.stringify([{
    runId, spaceId: run.spaceId, taskId: run.taskId, status: run.status,
    createdAt: run.createdAt, updatedAt: run.updatedAt,
  }]));

  for (let i = 0; i < stages.length; i++) {
    fs.writeFileSync(path.join(runDir, `stage-${i}.log`), stageContents[i] || '');
  }

  return { dir, runId, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout:  10_000,
    env: { ...process.env, PRISM_NO_UPDATE_CHECK: '1' },
    ...opts,
  });
}

describe('prism run list — list mode (integration)', () => {
  it('prints an empty-list message when no runs exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-cli-empty-'));
    try {
      const r = runCli(['run', 'list', '--data-dir', dir]);
      assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
      assert.match(r.stderr, /No runs yet\./);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists a fixture run with its short id and status', () => {
    const f = mkFixture({
      runId: 'abcdef12-3456-7890-abcd-ef1234567890',
      stages: ['architect', 'developer'],
      stageContents: ['s0', 's1'],
    });
    try {
      const r = runCli(['run', 'list', '--data-dir', f.dir]);
      assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
      assert.match(r.stdout, /RUN ID/);
      assert.match(r.stdout, /abcdef12/);
      assert.match(r.stdout, /completed/);
    } finally {
      f.cleanup();
    }
  });

  it('bare "prism run" (no subcommand) exits 2 with a hint at "run list"', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-cli-bare-'));
    try {
      const r = runCli(['run', '--data-dir', dir]);
      assert.equal(r.status, 2, `stdout=${r.stdout}\nstderr=${r.stderr}`);
      assert.match(r.stderr, /run list/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('prism run — logs print mode (integration)', () => {
  it('prints all stage headers and file bodies', () => {
    const f = mkFixture({
      runId: 'abcdef12aaaa1111bbbb2222cccc3333',
      stages: ['architect', 'developer', 'qa'],
      stageContents: ['STAGE_ZERO_BODY\n', 'STAGE_ONE_BODY\n', 'STAGE_TWO_BODY\n'],
    });
    try {
      const r = runCli(['run', 'abcdef12', 'logs', '--data-dir', f.dir]);
      assert.equal(r.status, 0, `stderr=${r.stderr}`);
      assert.equal((r.stdout.match(/━━━ Stage/g) || []).length, 3);
      assert.match(r.stdout, /STAGE_ZERO_BODY/);
      assert.match(r.stdout, /STAGE_ONE_BODY/);
      assert.match(r.stdout, /STAGE_TWO_BODY/);
    } finally {
      f.cleanup();
    }
  });

  it('default verb (no "logs") is print mode', () => {
    const f = mkFixture({
      runId: 'defaultverb1111222233334444555566',
      stages: ['solo'],
      stageContents: ['SOLO_BODY\n'],
    });
    try {
      const r = runCli(['run', 'defaultv', '--data-dir', f.dir]);
      assert.equal(r.status, 0, `stderr=${r.stderr}`);
      assert.match(r.stdout, /SOLO_BODY/);
    } finally {
      f.cleanup();
    }
  });

  it('--stage N restricts to one stage', () => {
    const f = mkFixture({
      runId: 'stagearg1111222233334444555566',
      stages: ['a', 'b', 'c'],
      stageContents: ['AA\n', 'BB\n', 'CC\n'],
    });
    try {
      const r = runCli(['run', 'stagearg', 'logs', '--stage', '1', '--data-dir', f.dir]);
      assert.equal(r.status, 0, `stderr=${r.stderr}`);
      assert.match(r.stdout, /BB/);
      assert.doesNotMatch(r.stdout, /AA/);
      assert.doesNotMatch(r.stdout, /CC/);
    } finally {
      f.cleanup();
    }
  });

  it('short prefix (<8 chars) exits 2', () => {
    const r = runCli(['run', 'abc', 'logs', '--data-dir', '/tmp']);
    assert.equal(r.status, 2, `stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stderr, /at least 8/);
  });

  it('unknown verb exits 2', () => {
    const f = mkFixture({
      runId: 'verbverb1111222233334444555566',
      stages: ['a'],
      stageContents: [''],
    });
    try {
      const r = runCli(['run', 'verbverb', 'bogus', '--data-dir', f.dir]);
      assert.equal(r.status, 2, `stderr=${r.stderr}`);
      assert.match(r.stderr, /unknown verb 'bogus'/);
    } finally {
      f.cleanup();
    }
  });

  it('non-existent runId exits 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-cli-none-'));
    fs.mkdirSync(path.join(dir, 'runs'));
    fs.writeFileSync(path.join(dir, 'runs', 'runs.json'), '[]');
    try {
      const r = runCli(['run', 'ghost1234', 'logs', '--data-dir', dir]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /not found/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('prism run logs -f — follow mode (integration)', () => {
  it('captures appended bytes to the current stage log and exits on terminal status', async () => {
    const runId = 'followrunaaaa1111bbbb2222cccc3333';
    const f = mkFixture({
      runId,
      stages: ['dev'],
      stageContents: ['INITIAL\n'],
      status: 'running',
      currentStage: 0,
    });
    try {
      const child = spawn(process.execPath, [
        CLI, 'run', runId.slice(0, 8), 'logs', '-f',
        '--poll-ms', '80',
        '--data-dir', f.dir,
      ], { env: { ...process.env, PRISM_NO_UPDATE_CHECK: '1' } });

      let stdout = '';
      child.stdout.on('data', (c) => { stdout += c.toString(); });
      let stderr = '';
      child.stderr.on('data', (c) => { stderr += c.toString(); });

      // Wait for initial header + body to be flushed
      await waitFor(() => stdout.includes('INITIAL'), 4000);

      // Append more bytes
      fs.appendFileSync(path.join(f.dir, 'runs', runId, 'stage-0.log'), 'APPENDED_ONE\n');
      await waitFor(() => stdout.includes('APPENDED_ONE'), 4000);

      // Mark the run as completed → follow should exit within grace + poll
      const runPath = path.join(f.dir, 'runs', runId, 'run.json');
      const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
      fs.appendFileSync(path.join(f.dir, 'runs', runId, 'stage-0.log'), 'FINAL_BYTES\n');
      run.status = 'completed';
      run.stageStatuses[0].status = 'completed';
      fs.writeFileSync(runPath, JSON.stringify(run));

      const exit = await new Promise((resolve) => {
        child.on('exit', (code) => resolve(code));
        setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* */ } resolve(-1); }, 5000);
      });

      assert.equal(exit, 0, `expected clean exit; got ${exit}\nstdout=${stdout}\nstderr=${stderr}`);
      assert.match(stdout, /INITIAL/);
      assert.match(stdout, /APPENDED_ONE/);
      assert.match(stdout, /FINAL_BYTES/);
    } finally {
      f.cleanup();
    }
  });
});

function waitFor(predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      let ok = false;
      try { ok = Boolean(predicate()); } catch { ok = false; }
      if (ok) return resolve();
      if (Date.now() >= deadline) return reject(new Error('waitFor timed out'));
      setTimeout(poll, 40);
    };
    poll();
  });
}
