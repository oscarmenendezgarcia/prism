'use strict';

/**
 * Assigning people and agents, and which agent a run uses, on a server with real accounts.
 * Run with: node --test tests/assignees.test.js
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs   = require('fs');
const http = require('http');
const os   = require('os');
const path = require('path');

const { startServer } = require('../server');
const { createStore } = require('../src/services/store');
const { agentFromOldName } = require('../src/utils/agents');

const PASSWORD = 'correct horse battery';

function call(port, method, url, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path: url,
      headers: {
        ...(payload && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
        ...(cookie && { Cookie: cookie }),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('assigning', () => {
  let root, server, port, admin, member, memberId, space, url, prevPath;
  const api = (...args) => call(port, ...args);

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-assign-'));
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore' });
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 'T');
    fs.writeFileSync(path.join(repo, 'a'), '1');
    git('add', '.');
    git('commit', '-qm', 'x');
    // An agent that does nothing, and says which model it was asked for.
    fs.mkdirSync(path.join(root, 'bin'));
    fs.writeFileSync(path.join(root, 'bin', 'claude'), `#!/bin/sh\necho "$@" > ${root}/args\nexit 0\n`, { mode: 0o755 });
    prevPath = process.env.PATH;
    process.env.PATH = `${path.join(root, 'bin')}:${process.env.PATH}`;
    process.env.PIPELINE_RUNS_DIR = path.join(root, 'runs');

    server = startServer({ port: 0, dataDir: path.join(root, 'data'), silent: true });
    await new Promise((resolve) => server.once('listening', resolve));
    ({ port } = server.address());
    const setupCode = fs.readFileSync(path.join(root, 'data', 'setup-code'), 'utf8').trim();
    const a = await api('POST', '/api/v1/auth/setup', { body: { name: 'Ana López', email: 'ana@example.com', password: PASSWORD, setupCode } });
    admin = a.cookie;
    const invite = await api('POST', '/api/v1/invites', { cookie: admin, body: { email: 'bea@example.com', role: 'member' } });
    const m = await api('POST', `/api/v1/auth/links/${invite.json.path.split('/').pop()}`, { body: { name: 'Bea Ruiz', password: PASSWORD } });
    member = m.cookie;
    memberId = m.json.user.id;
    space = (await api('POST', '/api/v1/spaces', { cookie: admin, body: { name: 'Web', key: 'WEB', workingDirectory: repo } })).json;
    url = `/api/v1/spaces/${space.id}/tasks`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    server._store.close();
    process.env.PATH = prevPath;
    delete process.env.PIPELINE_RUNS_DIR;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const create = (body = {}) => api('POST', url, { cookie: member, body: { title: 'x', type: 'chore', ...body } });
  const setAgents = (agents, cookie = admin) => api('PUT', `/api/v1/spaces/${space.id}/agents`, { cookie, body: agents });

  test('to someone on the team, or to nobody', async () => {
    assert.equal((await create({ assigned: 'Ana López' })).status, 201);
    assert.equal((await create({ assigned: 'Nobody Here' })).status, 400);
    const issue = (await create()).json;
    assert.equal((await api('PUT', `${url}/${issue.id}`, { cookie: member, body: { assigned: 'Bea Ruiz' } })).status, 200);
    assert.equal((await api('PUT', `${url}/${issue.id}`, { cookie: member, body: { assigned: 'Nobody Here' } })).status, 400);
    assert.equal((await api('PUT', `${url}/${issue.id}`, { cookie: member, body: { assigned: '' } })).status, 200);
  });

  test('agents start off, and only an admin turns them on', async () => {
    assert.equal((await create({ assigned: 'claude' })).status, 400);
    assert.equal((await setAgents({ claude: { enabled: true, model: 'sonnet' } }, member)).status, 403);
    assert.equal((await create({ assigned: 'claude' })).status, 400);
  });

  test('a bad setting is refused', async () => {
    assert.equal((await setAgents({ robot: { enabled: true } })).status, 400);
    assert.equal((await setAgents({ claude: { enabled: 'yes' } })).status, 400);
    assert.equal((await setAgents({ claude: { enabled: true, model: 'a b; rm -rf' } })).status, 400);
    assert.equal((await setAgents({ opencode: { enabled: true } })).status, 400);
    assert.equal((await setAgents({ opencode: { enabled: true, model: 'noslash' } })).status, 400);
  });

  test('a person cannot be run; an agent that is on can, with the model of the space', async () => {
    const person = (await create({ assigned: 'Bea Ruiz' })).json;
    assert.equal((await setAgents({ claude: { enabled: true, model: 'opus' } })).status, 200);
    const run = await api('POST', `${url}/${person.id}/run`, { cookie: member, body: {} });
    assert.equal(run.status, 409);
    assert.equal(run.json.error.code, 'NOT_ASSIGNED_TO_AGENT');

    const issue = (await create({ assigned: 'claude' })).json;
    // What the request says does not matter.
    const started = await api('POST', `${url}/${issue.id}/run`, { cookie: member, body: { cliTool: 'hermes', model: 'evil/model' } });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    assert.equal(started.json.agentConfig.cliTool, 'claude');
    assert.equal(started.json.agentConfig.model, 'opus');
  });

  test('saving the rest of the settings keeps which agents are on', async () => {
    for (let i = 0; i < 50; i++) {
      const res = await api('PUT', `/api/v1/spaces/${space.id}/hooks`, { cookie: admin, body: { checkCommand: 'true', autoPr: false } });
      if (res.status === 200) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const seen = (await api('GET', `/api/v1/spaces/${space.id}`, { cookie: member })).json;
    assert.equal(seen.hooks.checkCommand, 'true');
    assert.equal(seen.hooks.agents.claude.enabled, true);
    await api('PUT', `/api/v1/spaces/${space.id}/hooks`, { cookie: admin, body: {} });
  });

  test('an agent turned off stops: no new runs, and what was assigned stays', async () => {
    const issue = (await create({ assigned: 'claude' })).json;
    assert.equal((await setAgents({ claude: { enabled: false, model: 'opus' } })).status, 200);
    const run = await api('POST', `${url}/${issue.id}/run`, { cookie: member, body: {} });
    assert.equal(run.status, 403);
    assert.equal(run.json.error.code, 'AGENT_OFF');
    // Changing something else about the issue still works, with its assignee as it is.
    assert.equal((await api('PUT', `${url}/${issue.id}`, { cookie: member, body: { assigned: 'claude', title: 'y' } })).status, 200);
    assert.equal((await setAgents({ claude: { enabled: true, model: 'opus' } })).status, 200);
  });

  test('nobody can take the name of an agent', async () => {
    const invite = await api('POST', '/api/v1/invites', { cookie: admin, body: { email: 'c@example.com', role: 'member' } });
    const token = invite.json.path.split('/').pop();
    assert.equal((await api('POST', `/api/v1/auth/links/${token}`, { body: { name: 'Claude', password: PASSWORD } })).status, 400);
    assert.equal((await api('POST', `/api/v1/auth/links/${token}`, { body: { name: 'Carla', password: PASSWORD } })).status, 200);
  });

  test('only an admin sees where agents are installed', async () => {
    const asMember = (await api('GET', '/api/v1/harnesses', { cookie: member })).json.harnesses;
    assert.ok(asMember.every((h) => h.path === null));
    const asAdmin = (await api('GET', '/api/v1/harnesses', { cookie: admin })).json.harnesses;
    assert.ok(asAdmin.some((h) => h.path !== null));
  });

  test('a name from before accounts stays until someone says who it was', async () => {
    const issue = (await create()).json;
    const db = new (require('better-sqlite3'))(path.join(root, 'data', 'prism.db'));
    db.prepare('UPDATE tasks SET assigned = ? WHERE id = ?').run(JSON.stringify('Beatriz'), issue.id);
    db.close();

    // It can stay while other fields change, and be changed, but not be given back.
    assert.equal((await api('PUT', `${url}/${issue.id}`, { cookie: member, body: { title: 'z', assigned: 'Beatriz' } })).status, 200);
    const unlinked = (await api('GET', '/api/v1/assignees/unlinked', { cookie: admin })).json;
    assert.deepEqual(unlinked, ['Beatriz']);

    const claim = (id, name, cookie = admin) => api('POST', `/api/v1/users/${id}/claim-assignee`, { cookie, body: { name } });
    assert.equal((await claim(memberId, 'Beatriz', member)).status, 403);
    assert.equal((await claim('nobody', 'Beatriz')).status, 404);
    assert.equal((await claim(memberId, 'Ana López')).status, 400);
    assert.equal((await claim(memberId, 'claude')).status, 400);
    assert.deepEqual((await claim(memberId, 'Beatriz')).json, { moved: 1 });

    assert.equal((await api('GET', `${url}/${issue.id}`, { cookie: member })).json.assigned, 'Bea Ruiz');
    assert.deepEqual((await api('GET', '/api/v1/assignees/unlinked', { cookie: admin })).json, []);
  });
});

describe('upgrading', () => {
  for (const [old, agent] of [
    ['Claude Code', 'claude'], ['claude-code', 'claude'], ['claude', 'claude'], ['developer-agent', 'claude'], ['Sonnet', 'claude'],
    ['opencode', 'opencode'], ['Hermes', 'hermes'], ['pi', 'pi'],
    ['Ana López', null], ['Piero', null], ['agent smith', null], ['Sales Agent', null], ['Bond-Agent', null], ['Pi', null], [5, null], [['claude'], null],
  ]) {
    test(`"${old}" means ${agent ?? 'a person'}`, () => assert.equal(agentFromOldName(old), agent));
  }

  test('names the agents in old issues by their id, once, and leaves people alone', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-upgrade-'));
    try {
      const first = createStore(dir);
      first.close();
      const db = new (require('better-sqlite3'))(path.join(dir, 'prism.db'));
      const add = db.prepare(`INSERT INTO tasks (id, space_id, column, status_id, number, title, type, assigned, rank, created_at, updated_at) VALUES (?, 'default', 'todo', 'todo', ?, 't', 'chore', ?, 1, 'x', 'x')`);
      db.pragma('foreign_keys = OFF');
      db.prepare(`INSERT OR IGNORE INTO spaces (id, name, created_at, updated_at) VALUES ('default', 'G', 'x', 'x')`).run();
      add.run('a', 1, JSON.stringify('Claude Code'));
      add.run('b', 2, JSON.stringify('Ana López'));
      add.run('c', 3, JSON.stringify('developer-agent'));
      db.prepare(`UPDATE tasks SET assigned = 'not json' WHERE id = 'b'`).run();
      add.run('d', 4, JSON.stringify('Sales Agent'));
      add.run('e', 5, JSON.stringify('Ana López'));
      db.pragma('user_version = 3');
      db.close();

      const store = createStore(dir);
      store.close();
      const after = new (require('better-sqlite3'))(path.join(dir, 'prism.db'), { readonly: true });
      const assigned = (id) => JSON.parse(after.prepare('SELECT assigned FROM tasks WHERE id = ?').get(id).assigned);
      assert.equal(assigned('a'), 'claude');
      assert.equal(assigned('e'), 'Ana López');
      assert.equal(assigned('d'), 'Sales Agent');
      assert.equal(after.prepare(`SELECT assigned FROM tasks WHERE id = 'b'`).get().assigned, 'not json');
      assert.equal(assigned('c'), 'claude');
      after.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('names that read as an agent', () => {
  test('are refused for people, also the first one', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-names-'));
    const server = startServer({ port: 0, dataDir: root, silent: true });
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();
    const setupCode = fs.readFileSync(path.join(root, 'setup-code'), 'utf8').trim();
    try {
      const body = (name) => ({ name, email: 'a@b.c', password: PASSWORD, setupCode });
      for (const name of ['claude', 'Claude Code', 'Hermes', 'Claude Code, started by Olga']) {
        assert.equal((await call(port, 'POST', '/api/v1/auth/setup', { body: body(name) })).status, 400, name);
      }
      assert.equal((await call(port, 'POST', '/api/v1/auth/setup', { body: body('Ana') })).status, 201);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      server._store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
