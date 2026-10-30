'use strict';

/**
 * Direct task runs, end to end: a real server process, a real git repo, and a fake
 * `claude` on PATH that does what a control file says.
 * Run with: node --test tests/task-runs.test.js
 */

const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const net    = require('net');
const os     = require('os');
const path   = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const git  = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

const FAKE_CLAUDE = `#!/bin/sh
W="$FAKE_AGENT_DIR"
n=$(ls "$W/prompts" | wc -l)
cat > "$W/prompts/$n"
pwd > "$W/last-cwd"
mode=$(cat "$W/mode" 2>/dev/null)
echo "output of turn $n"
case "$mode" in
  fail) exit 3 ;;
  block) echo $$ > "$W/agent-pid"; sleep 60 & wait ;;
  question)
    echo ok > "$W/mode"
    curl -s -X POST "$KANBAN_API_URL/spaces/$PRISM_TEST_SPACE/tasks/$PRISM_TEST_TASK/comments" \\
      -H 'Content-Type: application/json' \\
      -d '{"author":"claude","type":"question","text":"Which one?"}' > /dev/null
    exit 0 ;;
  nested)
    git init -q nested && cd nested && git config user.email a@a && git config user.name a \\
      && echo x > x && git add . && git commit -qm x && echo y > x
    exit 0 ;;
  *) echo "work $n" >> agent-work.txt; exit 0 ;;
esac
`;

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

describe('direct task runs', () => {
  let work;
  let repo;
  let agentDir;
  let api;
  let server;
  let port;
  let space;
  let taskCounter = 0;
  let env;

  const startServer = async () => {
    server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${api}/spaces`)).ok) return;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('server did not start');
  };

  const stopServer = () => new Promise((resolve) => {
    server.once('exit', resolve);
    server.kill('SIGTERM');
  });

  const call = async (method, url, body) => {
    const res = await fetch(`${api}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json };
  };

  const makeTask = async () => {
    const { json } = await call('POST', `/spaces/${space}/tasks`, { title: `task ${++taskCounter}`, type: 'feature' });
    return json.id;
  };

  const view = async (taskId) => (await call('GET', `/spaces/${space}/task-runs`)).json[taskId];

  const waitFor = async (taskId, status) => {
    let last;
    for (let i = 0; i < 150; i++) {
      last = await view(taskId);
      if (last?.status === status) return last;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(`task never reached '${status}': ${JSON.stringify(last)}`);
  };

  const columnOf = async (taskId) => {
    const { json } = await call('GET', `/spaces/${space}/tasks`);
    return Object.keys(json).find((col) => Array.isArray(json[col]) && json[col].some((t) => t.id === taskId));
  };

  const setMode = (mode) => fs.writeFileSync(path.join(agentDir, 'mode'), mode);
  const prompts = () => fs.readdirSync(path.join(agentDir, 'prompts')).length;
  const lastPrompt = () => fs.readFileSync(path.join(agentDir, 'prompts', String(prompts() - 1)), 'utf8');
  const setHook = (hook) => call('PUT', `/spaces/${space}/hooks`, { hooks: hook ? [hook] : [] });

  before(async () => {
    work     = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-task-runs-'));
    repo     = path.join(work, 'repo');
    agentDir = path.join(work, 'agent');
    const bin = path.join(work, 'bin');
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(agentDir, 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 });

    execFileSync('git', ['init', '-q', repo]);
    git(repo, 'config', 'user.email', 't@t');
    git(repo, 'config', 'user.name', 'T');
    fs.writeFileSync(path.join(repo, 'README.md'), '# r\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'init');

    port = await freePort();
    api  = `http://127.0.0.1:${port}/api/v1`;
    env  = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      PORT: String(port),
      DATA_DIR: path.join(work, 'data'),
      PIPELINE_AGENTS_DIR: path.join(work, 'agents'),
      KANBAN_API_URL: api,
      FAKE_AGENT_DIR: agentDir,
      PRISM_HOOK_TIMEOUT_MS: '10000',
      PRISM_FOLIO_INJECTION: 'off',
    };
    await startServer();
    space = (await call('POST', '/spaces', { name: 'runs', workingDirectory: repo })).json.id;
  });

  after(async () => {
    await stopServer();
    fs.rmSync(work, { recursive: true, force: true });
  });

  beforeEach(async () => {
    setMode('ok');
    await setHook(null);
  });

  test('runs the task in a worktree, keeps it, closes the card and exposes the diff', async () => {
    const taskId = await makeTask();
    const { status, json: run } = await call('POST', `/spaces/${space}/tasks/${taskId}/run`, {});
    assert.equal(status, 201);
    assert.equal(run.stages[0], 'prism-agent');

    const done = await waitFor(taskId, 'done');
    assert.equal(fs.readFileSync(path.join(agentDir, 'last-cwd'), 'utf8').trim(), fs.realpathSync(run.worktree.path));
    assert.equal(await columnOf(taskId), 'done');

    // Worktree kept, work committed on the run branch, checkout untouched.
    assert.ok(fs.existsSync(path.join(run.worktree.path, 'agent-work.txt')));
    assert.match(git(repo, 'show', `${run.worktree.branch}:agent-work.txt`), /work/);
    assert.ok(!fs.existsSync(path.join(repo, 'agent-work.txt')));
    assert.equal(git(repo, 'status', '--porcelain'), '', 'the worktrees directory is excluded');

    assert.equal(done.result.fileCount, 1);
    assert.equal(done.result.additions, 1);
    assert.equal(done.result.deletions, 0);
    assert.equal(done.result.branch, run.worktree.branch);
    assert.equal(done.result.saveError, null);
    assert.equal(done.cliTool, 'claude');

    const { json: diff } = await call('GET', `/runs/${run.runId}/diff`);
    assert.deepEqual(diff.files.map((f) => f.path), ['agent-work.txt']);
    const { json: file } = await call('GET', `/runs/${run.runId}/diff?path=agent-work.txt`);
    assert.match(file.patch, /\+work/);
    assert.equal((await call('GET', `/runs/${run.runId}/diff?path=README.md`)).status, 404);

    const prompt = lastPrompt();
    assert.match(prompt, /YOUR CARD IN PRISM/);
    assert.doesNotMatch(prompt, /todo → in-progress/);
    assert.doesNotMatch(prompt, /LastStage/);
  });

  test('refuses a second run, a bad harness and an unsafe model', async () => {
    const taskId = await makeTask();
    const bad = [
      { cliTool: 'custom' },
      { cliTool: 'opencode' },
      { cliTool: 'claude', model: 'x; rm -rf /' },
      { model: 'sonnet' },
    ];
    for (const body of bad) {
      assert.equal((await call('POST', `/spaces/${space}/tasks/${taskId}/run`, body)).status, 400, JSON.stringify(body));
    }
    setMode('block');
    assert.equal((await call('POST', `/spaces/${space}/tasks/${taskId}/run`, {})).status, 201);
    assert.equal((await call('POST', `/spaces/${space}/tasks/${taskId}/run`, {})).status, 409);
    const { runId } = await waitFor(taskId, 'working');
    await call('POST', `/runs/${runId}/stop`);
    await waitFor(taskId, 'stopped');
  });

  test('needs a git repository', async () => {
    const plain = path.join(work, 'plain');
    fs.mkdirSync(plain);
    const { json: other } = await call('POST', '/spaces', { name: 'plain', workingDirectory: plain });
    const { json: task } = await call('POST', `/spaces/${other.id}/tasks`, { title: 'x', type: 'feature' });
    const res = await call('POST', `/spaces/${other.id}/tasks/${task.id}/run`, {});
    assert.equal(res.status, 422);
    assert.equal(res.json.error.code, 'NOT_A_GIT_REPO');

    const { json: none } = await call('POST', '/spaces', { name: 'nowd' });
    const { json: task2 } = await call('POST', `/spaces/${none.id}/tasks`, { title: 'x', type: 'feature' });
    assert.equal((await call('POST', `/spaces/${none.id}/tasks/${task2.id}/run`, {})).status, 422);
  });

  test('a detached HEAD runs in a worktree, never in the checkout', async () => {
    const detached = path.join(work, 'detached');
    execFileSync('git', ['clone', '-q', repo, detached]);
    git(detached, 'checkout', '-q', '--detach');
    const { json: other } = await call('POST', '/spaces', { name: 'detached', workingDirectory: detached });
    const { json: task } = await call('POST', `/spaces/${other.id}/tasks`, { title: 'x', type: 'feature' });
    const { status, json: run } = await call('POST', `/spaces/${other.id}/tasks/${task.id}/run`, {});
    assert.equal(status, 201);
    assert.equal(run.worktree.baseBranch, null);
    for (let i = 0; i < 100 && !fs.existsSync(path.join(run.worktree.path, 'agent-work.txt')); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(!fs.existsSync(path.join(detached, 'agent-work.txt')));
  });

  test('a passing hook closes the card and sees the worktree and the run', async () => {
    await setHook({ name: 'Check', command: 'test -f agent-work.txt && echo "$PRISM_TASK_ID" > hook-saw.txt' });
    const taskId = await makeTask();
    const { json: run } = await call('POST', `/spaces/${space}/tasks/${taskId}/run`, {});
    const done = await waitFor(taskId, 'done');
    assert.equal(done.hook.status, 'passed');
    assert.equal(await columnOf(taskId), 'done');
    // What the hook changed is saved too.
    assert.equal(git(repo, 'show', `${run.worktree.branch}:hook-saw.txt`), taskId);
    assert.equal(done.result.fileCount, 2);
  });

  test('a failing hook leaves the card open, and retrying runs only the hook', async () => {
    const flag = path.join(work, 'hook-passes');
    await setHook({ name: 'Tests', command: `echo boom; test -f ${flag}` });
    const taskId = await makeTask();
    const { json: run } = await call('POST', `/spaces/${space}/tasks/${taskId}/run`, {});
    const failed = await waitFor(taskId, 'failed');
    assert.deepEqual(failed.failure, { kind: 'hook', exitCode: 1, timedOut: false });
    assert.match(failed.hook.outputTail, /boom/);
    assert.equal(await columnOf(taskId), 'in-progress');
    assert.equal(failed.result.fileCount, 1, 'the result is visible even though the hook failed');

    const agentTurns = prompts();
    fs.writeFileSync(flag, '');
    assert.equal((await call('POST', `/runs/${run.runId}/resume`)).status, 200);
    const done = await waitFor(taskId, 'done');
    assert.equal(done.hook.status, 'passed');
    assert.equal(prompts(), agentTurns, 'the agent did not run again');
    assert.equal(await columnOf(taskId), 'done');
    fs.rmSync(flag);
  });

  test('a hook that outlives its timeout fails', async () => {
    await setHook({ name: 'Slow', command: 'sleep 30' });
    const baseEnv = env;
    await stopServer();
    env = { ...env, PRISM_HOOK_TIMEOUT_MS: '300' };
    await startServer();
    env = baseEnv;
    const taskId = await makeTask();
    await call('POST', `/spaces/${space}/tasks/${taskId}/run`, {});
    const failed = await waitFor(taskId, 'failed');
    assert.equal(failed.failure.timedOut, true);
    await stopServer();
    await startServer();
  });

  test('stopping during the hook stops it, and the hook does not close the card later', async () => {
    await setHook({ name: 'Slow', command: `echo $$ > ${path.join(work, 'hook-pid')}; sleep 30` });
    const taskId = await makeTask();
    const { json: run } = await call('POST', `/spaces/${space}/tasks/${taskId}/run`, {});
    await waitFor(taskId, 'checking');
    for (let i = 0; i < 50 && !fs.existsSync(path.join(work, 'hook-pid')); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await call('POST', `/runs/${run.runId}/stop`);
    const stopped = await waitFor(taskId, 'stopped');
    assert.equal(stopped.hook.status, 'interrupted');
    assert.equal(await columnOf(taskId), 'in-progress');
    const pid = Number(fs.readFileSync(path.join(work, 'hook-pid'), 'utf8'));
    await new Promise((r) => setTimeout(r, 300));
    assert.throws(() => process.kill(pid, 0), 'the hook is gone');
    fs.rmSync(path.join(work, 'hook-pid'));
  });

  test('nothing can close, delete or change the checks of a task while its agent runs', async () => {
    setMode('block');
    const taskId = await makeTask();
    const { json: run } = await call('POST', `/spaces/${space}/tasks/${taskId}/run`, {});
    await waitFor(taskId, 'working');

    assert.equal((await call('PUT', `/spaces/${space}/tasks/${taskId}/move`, { to: 'done' })).status, 409);
    assert.equal((await call('PUT', `/spaces/${space}/tasks/${taskId}/move`, { to: 'todo' })).status, 409);
    assert.equal((await call('DELETE', `/spaces/${space}/tasks/${taskId}`)).status, 409);
    assert.equal((await setHook({ name: 'x', command: 'true' })).status, 409);
    assert.equal((await call('POST', `/spaces/${space}/tasks/${taskId}/request-changes`, { text: 'x' })).status, 409);
    assert.equal((await call('POST', `/spaces/${space}/tasks/${taskId}/close`)).status, 409);

    fs.writeFileSync(path.join(run.worktree.path, 'half-done.txt'), 'half\n');
    await call('POST', `/runs/${run.runId}/stop`);
    await waitFor(taskId, 'stopped');
    for (let i = 0; i < 100 && !(await view(taskId)).result; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal((await view(taskId)).result.fileCount, 1, 'what the stopped agent wrote is on the card');
    assert.equal(git(repo, 'show', `${run.worktree.branch}:half-done.txt`), 'half');
  });

  test('a failed agent shows why, and the card stays open', async () => {
    setMode('fail');
    const taskId = await makeTask();
    await call('POST', `/spaces/${space}/tasks/${taskId}/run`, {});
    const failed = await waitFor(taskId, 'failed');
    assert.equal(failed.failure.kind, 'agent');
    assert.equal(failed.failure.exitCode, 3);
    assert.equal(await columnOf(taskId), 'in-progress');
  });

  test('asking for changes relaunches the agent in the same worktree with the request', async () => {
    const taskId = await makeTask();
    const { json: run } = await call('POST', `/spaces/${space}/tasks/${taskId}/run`, {});
    await waitFor(taskId, 'done');
    await call('POST', `/spaces/${space}/tasks/${taskId}/comments`, { author: 'user', type: 'note', text: 'A remark on the side' });

    const res = await call('POST', `/spaces/${space}/tasks/${taskId}/request-changes`, { text: 'Rename the thing' });
    assert.equal(res.status, 200);

    const done = await waitFor(taskId, 'done');
    assert.equal(done.iteration, 2);
    assert.equal(fs.readFileSync(path.join(agentDir, 'last-cwd'), 'utf8').trim(), fs.realpathSync(run.worktree.path));
    assert.equal(done.result.additions, 2, 'the second turn added to the first');
    assert.equal(await columnOf(taskId), 'done');

    const prompt = lastPrompt();
    assert.match(prompt, /CHANGES REQUESTED/);
    assert.match(prompt, /Rename the thing/);
    assert.match(prompt, /A remark on the side/);
    assert.ok(prompt.includes(run.worktree.baseRef));

    const { json: task } = await call('GET', `/spaces/${space}/tasks/${taskId}`);
    assert.ok(task.comments.some((c) => c.changeRequest && c.text === 'Rename the thing'));
  });

  test('asking for changes after a failed hook shows the agent the failure', async () => {
    await setHook({ name: 'Tests', command: 'echo three tests broke; exit 1' });
    const taskId = await makeTask();
    await call('POST', `/spaces/${space}/tasks/${taskId}/run`, {});
    await waitFor(taskId, 'failed');
    await call('POST', `/spaces/${space}/tasks/${taskId}/request-changes`, { text: 'Fix them' });
    await waitFor(taskId, 'failed');
    assert.match(lastPrompt(), /FAILED CHECK/);
    assert.match(lastPrompt(), /three tests broke/);
  });

  test('a question pauses the card and the answer relaunches the agent', async () => {
    setMode('question');
    const taskId = await makeTask();
    // The fake agent needs the ids to post its question.
    const baseEnv = env;
    await stopServer();
    env = { ...env, PRISM_TEST_SPACE: space, PRISM_TEST_TASK: taskId };
    await startServer();

    await call('POST', `/spaces/${space}/tasks/${taskId}/run`, {});
    const asked = await waitFor(taskId, 'question');
    assert.equal(asked.result, null);

    const { json: task } = await call('GET', `/spaces/${space}/tasks/${taskId}`);
    const question = task.comments.find((c) => c.type === 'question');
    assert.equal((await call('POST', `/spaces/${space}/tasks/${taskId}/request-changes`, { text: 'x' })).status, 409);

    await call('POST', `/spaces/${space}/tasks/${taskId}/comments`, { author: 'user', type: 'answer', parentId: question.id, text: 'The first' });
    await call('PATCH', `/spaces/${space}/tasks/${taskId}/comments/${question.id}`, { resolved: true });

    await waitFor(taskId, 'done');
    assert.match(lastPrompt(), /ANSWERS TO YOUR QUESTIONS/);
    assert.match(lastPrompt(), /The first/);

    await stopServer();
    env = baseEnv;
    await startServer();
  });

  test('closing removes the worktree and keeps the branch; changes bring it back', async () => {
    const taskId = await makeTask();
    const { json: run } = await call('POST', `/spaces/${space}/tasks/${taskId}/run`, {});
    await waitFor(taskId, 'done');

    assert.equal((await call('POST', `/spaces/${space}/tasks/${taskId}/close`)).status, 200);
    assert.ok(!fs.existsSync(run.worktree.path));
    assert.ok((await view(taskId)).closedAt);
    assert.match(git(repo, 'show', `${run.worktree.branch}:agent-work.txt`), /work/);
    assert.equal((await call('GET', `/runs/${run.runId}/diff`)).json.files.length, 1, 'the diff survives closing');

    await call('POST', `/spaces/${space}/tasks/${taskId}/request-changes`, { text: 'One more' });
    const done = await waitFor(taskId, 'done');
    assert.ok(fs.existsSync(run.worktree.path));
    assert.equal(done.closedAt, null);
    assert.equal(done.result.additions, 2);
  });

  test('work that cannot be saved is reported and its worktree stays', async () => {
    setMode('nested');
    const taskId = await makeTask();
    const { json: run } = await call('POST', `/spaces/${space}/tasks/${taskId}/run`, {});
    const done = await waitFor(taskId, 'done');
    assert.match(done.result.saveError, /Nested repository|Could not save/);

    const res = await call('POST', `/spaces/${space}/tasks/${taskId}/close`);
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, 'WORKTREE_KEPT');
    assert.ok(fs.existsSync(run.worktree.path));
    assert.equal((await view(taskId)).closedAt, null);
  });

  test('deleting a finished task removes its worktree and keeps its branch', async () => {
    const taskId = await makeTask();
    const { json: run } = await call('POST', `/spaces/${space}/tasks/${taskId}/run`, {});
    await waitFor(taskId, 'done');
    assert.equal((await call('DELETE', `/spaces/${space}/tasks/${taskId}`)).status, 200);
    for (let i = 0; i < 50 && fs.existsSync(run.worktree.path); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(!fs.existsSync(run.worktree.path));
    assert.match(git(repo, 'show', `${run.worktree.branch}:agent-work.txt`), /work/);
  });

  test('a restart does not remove the worktree of a finished task', async () => {
    const taskId = await makeTask();
    const { json: run } = await call('POST', `/spaces/${space}/tasks/${taskId}/run`, {});
    await waitFor(taskId, 'done');

    // The sweep only looks at repos of active runs, so keep one active across the restart.
    setMode('block');
    const other = await makeTask();
    await call('POST', `/spaces/${space}/tasks/${other}/run`, {});
    await waitFor(other, 'working');
    await stopServer();
    await startServer();
    await new Promise((r) => setTimeout(r, 500));

    assert.ok(fs.existsSync(run.worktree.path));
    const { runId } = await view(other);
    await call('POST', `/runs/${runId}/stop`);
    await waitFor(other, 'stopped');
  });

  test('hooks are validated', async () => {
    for (const hook of [{ name: '', command: 'x' }, { name: 'x', command: '' }, { name: 'x'.repeat(61), command: 'x' }]) {
      assert.equal((await setHook(hook)).status, 400);
    }
    const two = [{ name: 'a', command: 'a' }, { name: 'b', command: 'b' }];
    assert.equal((await call('PUT', `/spaces/${space}/hooks`, { hooks: two })).status, 400);
    const { json } = await setHook({ name: ' Check ', command: ' true ' });
    assert.deepEqual(json.hooks, [{ name: 'Check', command: 'true' }]);
    const { json: reread } = await call('GET', `/spaces/${space}`);
    assert.deepEqual(reread.hooks, [{ name: 'Check', command: 'true' }]);
  });
});
