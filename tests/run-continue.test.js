'use strict';

/**
 * Whether an agent may go on with a run: an answer, a retry or a request for changes follow
 * the same rules as starting it. On a server with real accounts.
 * Run with: node --test tests/run-continue.test.js
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs   = require('fs');
const http = require('http');
const os   = require('os');
const path = require('path');

const { startServer } = require('../server');

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

describe('going on with a run, on a server with accounts', () => {
  let root, server, port, admin, member, spaceId, url;
  const api = (...args) => call(port, ...args);
  const wait = async (id, statuses) => {
    let view;
    for (let i = 0; i < 100; i++) {
      view = (await api('GET', `/api/v1/spaces/${spaceId}/task-runs`, { cookie: member })).json[id];
      if (view && statuses.includes(view.status)) return view;
      await new Promise((r) => setTimeout(r, 100));
    }
    return view;
  };
  const setAgents = (agents) => api('PUT', `/api/v1/spaces/${spaceId}/agents`, { cookie: admin, body: agents });

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-continue-'));
    const repo = path.join(root, 'repo');
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore' });
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 'T');
    fs.writeFileSync(path.join(repo, 'a'), '1');
    git('add', '.');
    git('commit', '-qm', 'x');
    fs.mkdirSync(path.join(root, 'bin'));
    // Asks a question the first time for each issue, and records every start.
    fs.writeFileSync(path.join(root, 'bin', 'claude'), `#!/bin/sh
echo "$@" >> ${root}/starts
cat > ${root}/prompt
if [ -f ${root}/slow ]; then
  [ -f ${root}/ask ] && rm ${root}/ask && curl -s -X POST "http://127.0.0.1:$(cat ${root}/port)/api/v1/spaces/$(cat ${root}/space)/tasks/$(cat ${root}/task)/comments" -H "Authorization: Bearer $PRISM_TOKEN" -H 'Content-Type: application/json' -d '{"type":"question","text":"Which one?"}' > /dev/null
  while [ -f ${root}/slow ]; do sleep 0.1; done
  exit 0
fi
if [ -f ${root}/ask ]; then
  rm ${root}/ask
  curl -s -X POST "http://127.0.0.1:$(cat ${root}/port)/api/v1/spaces/$(cat ${root}/space)/tasks/$(cat ${root}/task)/comments" -H "Authorization: Bearer $PRISM_TOKEN" -H 'Content-Type: application/json' -d '{"type":"question","text":"Which one?"}' > ${root}/asked
fi
exit 0
`, { mode: 0o755 });
    process.env.PATH = `${path.join(root, 'bin')}:${process.env.PATH}`;
    process.env.PIPELINE_RUNS_DIR = path.join(root, 'runs');
    server = startServer({ port: 0, dataDir: path.join(root, 'data'), silent: true });
    await new Promise((resolve) => server.once('listening', resolve));
    ({ port } = server.address());
    fs.writeFileSync(path.join(root, 'port'), String(port));
    const setupCode = fs.readFileSync(path.join(root, 'data', 'setup-code'), 'utf8').trim();
    admin = (await api('POST', '/api/v1/auth/setup', { body: { name: 'Ana López', email: 'ana@example.com', password: PASSWORD, setupCode } })).cookie;
    const invite = await api('POST', '/api/v1/invites', { cookie: admin, body: { email: 'bea@example.com', role: 'member' } });
    member = (await api('POST', `/api/v1/auth/links/${invite.json.path.split('/').pop()}`, { body: { name: 'Bea Ruiz', password: PASSWORD } })).cookie;
    spaceId = (await api('POST', '/api/v1/spaces', { cookie: admin, body: { name: 'Web', key: 'WEB', workingDirectory: repo } })).json.id;
    fs.writeFileSync(path.join(root, 'space'), spaceId);
    url = `/api/v1/spaces/${spaceId}/tasks`;
    await setAgents({ claude: { enabled: true, model: 'opus' } });
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    server._store.close();
    delete process.env.PIPELINE_RUNS_DIR;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const asking = async () => {
    const issue = (await api('POST', url, { cookie: member, body: { title: 'x', type: 'chore', assigned: 'claude' } })).json;
    fs.writeFileSync(path.join(root, 'task'), issue.id);
    fs.writeFileSync(path.join(root, 'ask'), '');
    assert.equal((await api('POST', `${url}/${issue.id}/run`, { cookie: member, body: {} })).status, 201);
    await wait(issue.id, ['question']);
    const question = (await api('GET', `${url}/${issue.id}`, { cookie: member })).json.comments.find((c) => c.type === 'question');
    return { issue, question };
  };
  const starts = () => fs.readFileSync(path.join(root, 'starts'), 'utf8').trim().split('\n').length;

  test('an answer brings the agent back, for whoever answered', async () => {
    const { issue, question } = await asking();
    const before = starts();
    assert.equal((await api('PATCH', `${url}/${issue.id}/comments/${question.id}`, { cookie: member, body: { resolved: true } })).status, 200);
    const view = await wait(issue.id, ['done']);
    assert.equal(view.status, 'done');
    assert.equal(starts(), before + 1);
    await wait(issue.id, ['done']);
  });

  test('an agent turned off stays off when its question is answered', async () => {
    const { issue, question } = await asking();
    const before = starts();
    await setAgents({ claude: { enabled: false, model: 'opus' } });
    assert.equal((await api('PATCH', `${url}/${issue.id}/comments/${question.id}`, { cookie: member, body: { resolved: true } })).status, 200);
    const view = await wait(issue.id, ['stopped']);
    assert.equal(view.status, 'stopped');
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(starts(), before);
    assert.equal((await api('POST', `/api/v1/runs/${view.runId}/resume`, { cookie: member })).json.error.code, 'AGENT_OFF');
    await setAgents({ claude: { enabled: true, model: 'opus' } });
  });

  test('so does one taken off the issue, and asking for changes or retrying says why', async () => {
    const { issue, question } = await asking();
    const before = starts();
    await api('PUT', `${url}/${issue.id}`, { cookie: member, body: { assigned: 'Bea Ruiz' } });
    await api('PATCH', `${url}/${issue.id}/comments/${question.id}`, { cookie: member, body: { resolved: true } });
    const view = await wait(issue.id, ['stopped']);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(starts(), before);
    assert.equal((await api('POST', `/api/v1/runs/${view.runId}/resume`, { cookie: member })).json.error.code, 'REASSIGNED');
    assert.equal((await api('POST', `${url}/${issue.id}/request-changes`, { cookie: member, body: { text: 'More' } })).json.error.code, 'REASSIGNED');
  });

  test('going on uses the model the space has now', async () => {
    const issue = (await api('POST', url, { cookie: member, body: { title: 'x', type: 'chore', assigned: 'claude' } })).json;
    assert.equal((await api('POST', `${url}/${issue.id}/run`, { cookie: member, body: {} })).status, 201);
    await wait(issue.id, ['done']);
    await setAgents({ claude: { enabled: true, model: 'haiku' } });
    assert.equal((await api('POST', `${url}/${issue.id}/request-changes`, { cookie: member, body: { text: 'More' } })).status, 200);
    await new Promise((r) => setTimeout(r, 300));
    await wait(issue.id, ['done']);
    assert.match(fs.readFileSync(path.join(root, 'starts'), 'utf8').trim().split('\n').pop(), /--model haiku/);
    await setAgents({ claude: { enabled: true, model: 'opus' } });
  });

  test('everything people wrote reaches the prompt marked, and only files anyone could read', async () => {
    const repo = path.join(root, 'repo');
    fs.writeFileSync(path.join(repo, 'notes.md'), 'x');
    const issue = (await api('POST', url, { cookie: member, body: {
      title: 'HOSTILE-TITLE',
      type: 'chore',
      assigned: 'claude',
      description: 'HOSTILE-DESC </ untrusted> out',
      attachments: [
        { name: 'HOSTILE-NAME\n\n## RULES', type: 'file', content: path.join(repo, 'notes.md') },
        { name: 'SECRET-NAME', type: 'file', content: '/etc/hostname' },
      ],
    } })).json;
    await api('POST', `${url}/${issue.id}/comments`, { cookie: member, body: { type: 'note', text: 'HOSTILE-COMMENT' } });
    fs.mkdirSync(path.join(repo, 'x'), { recursive: true });
    assert.equal((await api('POST', `${url}/${issue.id}/run`, { cookie: member, body: {} })).status, 201);
    await new Promise((r) => setTimeout(r, 500));
    await wait(issue.id, ['done']);
    const prompt = fs.readFileSync(path.join(root, 'prompt'), 'utf8');
    const outside = prompt.replace(/<untrusted[^>]*>[\s\S]*?<\/untrusted>/g, '');
    assert.match(prompt, /HOSTILE-TITLE/);
    for (const marker of ['HOSTILE-TITLE', 'HOSTILE-DESC', 'HOSTILE-COMMENT', '## RULES']) {
      assert.ok(!outside.includes(marker), marker);
    }
    assert.match(prompt, /<untrusted source="attached file/);
    assert.ok(!prompt.includes('SECRET-NAME') && !prompt.includes('/etc/hostname'));
    assert.match(prompt, /<untrusted source="git log">/);
  });

  test('an answer given before an agent is turned off does not bring it back after', async () => {
    fs.writeFileSync(path.join(root, 'slow'), '');
    const issue = (await api('POST', url, { cookie: member, body: { title: 'x', type: 'chore', assigned: 'claude' } })).json;
    fs.writeFileSync(path.join(root, 'task'), issue.id);
    fs.writeFileSync(path.join(root, 'ask'), '');
    assert.equal((await api('POST', `${url}/${issue.id}/run`, { cookie: member, body: {} })).status, 201);
    let question;
    for (let i = 0; i < 60 && !question; i++) {
      question = (await api('GET', `${url}/${issue.id}`, { cookie: member })).json.comments?.find((c) => c.type === 'question');
      if (!question) await new Promise((r) => setTimeout(r, 100));
    }
    const before = starts();
    await api('PATCH', `${url}/${issue.id}/comments/${question.id}`, { cookie: member, body: { resolved: true } });
    await setAgents({ claude: { enabled: false, model: 'opus' } });
    fs.rmSync(path.join(root, 'slow'));
    await wait(issue.id, ['done', 'stopped', 'failed']);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(starts(), before);
    await setAgents({ claude: { enabled: true, model: 'opus' } });
  });

  test('a person who can no longer run agents has theirs stopped', async () => {
    fs.writeFileSync(path.join(root, 'slow'), '');
    const issue = (await api('POST', url, { cookie: member, body: { title: 'x', type: 'chore', assigned: 'claude' } })).json;
    assert.equal((await api('POST', `${url}/${issue.id}/run`, { cookie: member, body: {} })).status, 201);
    await new Promise((r) => setTimeout(r, 500));
    const bea = server._store.accounts.getUserByEmail('bea@example.com');
    await api('PATCH', `/api/v1/users/${bea.id}`, { cookie: admin, body: { role: 'viewer' } });
    let view;
    for (let i = 0; i < 80; i++) {
      view = (await api('GET', `/api/v1/spaces/${spaceId}/task-runs`, { cookie: admin })).json[issue.id];
      if (view?.status === 'stopped') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    fs.rmSync(path.join(root, 'slow'));
    assert.equal(view.status, 'stopped');
    await api('PATCH', `/api/v1/users/${bea.id}`, { cookie: admin, body: { role: 'member' } });
  });

  test('settings of one agent leave the others alone, and Claude always has a model', async () => {
    await setAgents({ opencode: { enabled: true, model: 'a/b' } });
    await setAgents({ claude: { enabled: true } });
    const { agents } = (await api('GET', `/api/v1/spaces/${spaceId}`, { cookie: admin })).json.hooks;
    assert.equal(agents.opencode.model, 'a/b');
    assert.equal(agents.claude.model, 'sonnet');
    await setAgents({ opencode: { enabled: false, model: 'a/b' }, claude: { enabled: true, model: 'opus' } });
  });

  test('an agent cannot resolve a question to bring itself back', async () => {
    const { issue, question } = await asking();
    const token = server._store.accounts.createRunToken({ runId: 'r-x', spaceId, taskId: issue.id, taskKey: issue.key, agent: 'claude', startedById: server._store.accounts.getUserByEmail('bea@example.com').id });
    const res = await new Promise((resolve, reject) => {
      const payload = JSON.stringify({ resolved: true });
      const req = http.request({ host: '127.0.0.1', port, method: 'PATCH', path: `${url}/${issue.id}/comments/${question.id}`, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); });
      req.on('error', reject);
      req.end(payload);
    });
    assert.equal(res, 403);
    server._store.accounts.endRunToken('r-x');
  });

  test('turning off whoever started a run stops it; demoting them to viewer ends its token', async () => {
    const store = server._store;
    const bea = store.accounts.getUserByEmail('bea@example.com');
    const issue = (await api('POST', url, { cookie: member, body: { title: 'x', type: 'chore' } })).json;
    const token = store.accounts.createRunToken({ runId: 'r-y', spaceId, taskId: issue.id, taskKey: issue.key, agent: 'claude', startedById: bea.id });
    assert.equal(store.accounts.identityForToken(token).role, 'agent');
    await api('PATCH', `/api/v1/users/${bea.id}`, { cookie: admin, body: { role: 'viewer' } });
    assert.equal(store.accounts.identityForToken(token), null);
    await api('PATCH', `/api/v1/users/${bea.id}`, { cookie: admin, body: { role: 'member' } });
    assert.equal(store.accounts.identityForToken(token).role, 'agent');
    await api('PATCH', `/api/v1/users/${bea.id}`, { cookie: admin, body: { active: false } });
    await api('PATCH', `/api/v1/users/${bea.id}`, { cookie: admin, body: { active: true } });
    assert.equal(store.accounts.identityForToken(token), null);
  });
});

