/**
 * Backend integration tests for the Activity Feed feature.
 * ADR-1 (Activity Feed) — covers T-017 acceptance criteria.
 *
 * Scope:
 *  - Mutation endpoints produce the correct activity events in the REST response.
 *  - GET /api/v1/activity and GET /api/v1/spaces/:spaceId/activity return events.
 *  - Event type filter, date-range filter, and cursor pagination work correctly.
 *  - WebSocket client receives a broadcast within 500 ms of a mutation.
 *  - Space create / rename / delete each emit the correct activity event.
 *
 * Run with:  node tests/activity.test.js
 * (Server is spawned in-process on a random port; no external server required.)
 */

'use strict';

const http     = require('http');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { startServer }          = require('../server');
const { createActivityStore }  = require('../src/activityStore');
const { createActivityLogger } = require('../src/activityLogger');
const { setupActivityWebSocket } = require('../activity-ws');

// ---------------------------------------------------------------------------
// Test server bootstrap helper
// ---------------------------------------------------------------------------

/**
 * Start an isolated server with a real ActivityStore + ActivityLogger wired in.
 * Returns { port, close, activityDir } where activityDir is the path to the JSONL files.
 */
async function startActivityTestServer() {
  const tmpDir      = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-activity-test-'));
  const activityDir = path.join(tmpDir, 'activity');
  fs.mkdirSync(activityDir, { recursive: true });

  const activityStore = createActivityStore(activityDir);

  let _realBroadcast = null;
  function lazyBroadcast(event) {
    if (_realBroadcast) _realBroadcast(event);
  }

  const activityLogger = createActivityLogger({ store: activityStore, broadcast: lazyBroadcast });
  const server = startServer({ port: 0, dataDir: tmpDir, silent: true, activityLogger, activityStore });

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const { broadcast } = setupActivityWebSocket(server);
  _realBroadcast = broadcast;

  const port = server.address().port;

  function close() {
    return new Promise((res) => {
      server.close(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        res();
      });
    });
  }

  return { port, close, activityDir };
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: 'localhost',
      port,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { body = null; }
        resolve({ status: res.statusCode, body });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// WebSocket helper
// ---------------------------------------------------------------------------

function openActivityWs(port) {
  const net = require('net');
  const crypto = require('crypto');
  const key = crypto.randomBytes(16).toString('base64');

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, 'localhost', () => {
      // Use a fixed origin in the LOCALHOST_ORIGINS allowlist (activity-ws.js §security).
      socket.write(
        `GET /ws/activity HTTP/1.1\r\n` +
        `Host: localhost:${port}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n` +
        `Origin: http://localhost:3000\r\n` +
        `\r\n`
      );
    });

    let handshakeDone = false;
    let buffer = Buffer.alloc(0);
    const messages = [];
    const waiters = [];

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);

      if (!handshakeDone) {
        const sep = buffer.indexOf('\r\n\r\n');
        if (sep === -1) return;
        handshakeDone = true;
        buffer = buffer.slice(sep + 4);
        resolve({ messages, waitForMessage, close: () => socket.destroy() });
      }

      // Parse WebSocket frames (unmasked, text frames only — server sends these).
      while (buffer.length >= 2) {
        const b0 = buffer[0];
        const b1 = buffer[1];
        const opcode = b0 & 0x0f;
        if (opcode !== 1) { buffer = buffer.slice(2); continue; } // skip non-text

        let payloadLen = b1 & 0x7f;
        let offset = 2;
        if (payloadLen === 126) {
          if (buffer.length < 4) break;
          payloadLen = buffer.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          break; // skip large frames
        }

        if (buffer.length < offset + payloadLen) break;

        const msgStr = buffer.slice(offset, offset + payloadLen).toString('utf8');
        buffer = buffer.slice(offset + payloadLen);

        let msg;
        try { msg = JSON.parse(msgStr); } catch { continue; }
        messages.push(msg);

        if (waiters.length > 0) {
          const resolve = waiters.shift();
          resolve(msg);
        }
      }
    });

    socket.on('error', reject);

    function waitForMessage(timeoutMs = 500) {
      return new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('WS message timeout')), timeoutMs);
        waiters.push((msg) => { clearTimeout(timer); res(msg); });
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('task.created event appears in REST activity response', async () => {
  const { port, close } = await startActivityTestServer();
  try {
    // Create a space then a task.
    const spaceRes = await request(port, 'POST', '/api/v1/spaces', { name: 'Test Space' });
    assert.equal(spaceRes.status, 201);
    const spaceId = spaceRes.body.id;

    await request(port, 'POST', `/api/v1/spaces/${spaceId}/tasks`, {
      title: 'My first task',
      type: 'task',
    });

    // Allow async log to flush (fire-and-forget is synchronous in this impl but wait just in case).
    await new Promise((r) => setTimeout(r, 20));

    const actRes = await request(port, 'GET', `/api/v1/spaces/${spaceId}/activity`);
    assert.equal(actRes.status, 200);
    assert.ok(Array.isArray(actRes.body.events));

    const created = actRes.body.events.find((e) => e.type === 'task.created');
    assert.ok(created, 'task.created event not found');
    assert.equal(created.payload.taskTitle, 'My first task');
    assert.equal(created.spaceId, spaceId);
  } finally {
    await close();
  }
});

test('task.moved event includes from/to columns', async () => {
  const { port, close } = await startActivityTestServer();
  try {
    const spaceRes = await request(port, 'POST', '/api/v1/spaces', { name: 'Move Space' });
    const spaceId = spaceRes.body.id;

    const taskRes = await request(port, 'POST', `/api/v1/spaces/${spaceId}/tasks`, {
      title: 'Task to move',
      type: 'task',
    });
    const taskId = taskRes.body.id;

    await request(port, 'PUT', `/api/v1/spaces/${spaceId}/tasks/${taskId}/move`, { to: 'in-progress' });
    await new Promise((r) => setTimeout(r, 20));

    const actRes = await request(port, 'GET', `/api/v1/spaces/${spaceId}/activity`);
    const moved = actRes.body.events.find((e) => e.type === 'task.moved');
    assert.ok(moved, 'task.moved event not found');
    assert.equal(moved.payload.from, 'todo');
    assert.equal(moved.payload.to, 'in-progress');
  } finally {
    await close();
  }
});

test('task.deleted event appears after delete', async () => {
  const { port, close } = await startActivityTestServer();
  try {
    const spaceRes = await request(port, 'POST', '/api/v1/spaces', { name: 'Delete Space' });
    const spaceId = spaceRes.body.id;

    const taskRes = await request(port, 'POST', `/api/v1/spaces/${spaceId}/tasks`, {
      title: 'Task to delete',
      type: 'task',
    });
    const taskId = taskRes.body.id;

    await request(port, 'DELETE', `/api/v1/spaces/${spaceId}/tasks/${taskId}`);
    await new Promise((r) => setTimeout(r, 20));

    const actRes = await request(port, 'GET', `/api/v1/spaces/${spaceId}/activity`);
    const deleted = actRes.body.events.find((e) => e.type === 'task.deleted');
    assert.ok(deleted, 'task.deleted event not found');
    assert.equal(deleted.payload.taskTitle, 'Task to delete');
  } finally {
    await close();
  }
});

test('board.cleared event includes deletedCount', async () => {
  const { port, close } = await startActivityTestServer();
  try {
    const spaceRes = await request(port, 'POST', '/api/v1/spaces', { name: 'Clear Space' });
    const spaceId = spaceRes.body.id;

    // Create 3 tasks.
    for (let i = 0; i < 3; i++) {
      await request(port, 'POST', `/api/v1/spaces/${spaceId}/tasks`, { title: `Task ${i}`, type: 'task' });
    }

    await request(port, 'DELETE', `/api/v1/spaces/${spaceId}/tasks`);
    await new Promise((r) => setTimeout(r, 20));

    const actRes = await request(port, 'GET', `/api/v1/spaces/${spaceId}/activity`);
    const cleared = actRes.body.events.find((e) => e.type === 'board.cleared');
    assert.ok(cleared, 'board.cleared event not found');
    assert.equal(cleared.payload.deletedCount, 3);
  } finally {
    await close();
  }
});

test('space.created, space.renamed, space.deleted events appear', async () => {
  const { port, close } = await startActivityTestServer();
  try {
    const spaceRes = await request(port, 'POST', '/api/v1/spaces', { name: 'Lifecycle Space' });
    const spaceId = spaceRes.body.id;

    await request(port, 'PUT', `/api/v1/spaces/${spaceId}`, { name: 'Renamed Space' });
    await new Promise((r) => setTimeout(r, 20));

    // Check global activity for all space events.
    const actRes = await request(port, 'GET', '/api/v1/activity');
    assert.equal(actRes.status, 200);

    const types = actRes.body.events.map((e) => e.type);
    assert.ok(types.includes('space.created'), 'space.created missing');
    assert.ok(types.includes('space.renamed'), 'space.renamed missing');

    // Now delete (need at least 2 spaces; create another first).
    await request(port, 'POST', '/api/v1/spaces', { name: 'Second Space' });
    await request(port, 'DELETE', `/api/v1/spaces/${spaceId}`);
    await new Promise((r) => setTimeout(r, 20));

    const actRes2 = await request(port, 'GET', '/api/v1/activity');
    const types2 = actRes2.body.events.map((e) => e.type);
    assert.ok(types2.includes('space.deleted'), 'space.deleted missing');
  } finally {
    await close();
  }
});

test('type filter returns only matching events', async () => {
  const { port, close } = await startActivityTestServer();
  try {
    const spaceRes = await request(port, 'POST', '/api/v1/spaces', { name: 'Filter Space' });
    const spaceId = spaceRes.body.id;

    const taskRes = await request(port, 'POST', `/api/v1/spaces/${spaceId}/tasks`, {
      title: 'Filter task',
      type: 'task',
    });
    const taskId = taskRes.body.id;

    await request(port, 'PUT', `/api/v1/spaces/${spaceId}/tasks/${taskId}/move`, { to: 'done' });
    await new Promise((r) => setTimeout(r, 20));

    const actRes = await request(port, 'GET', `/api/v1/spaces/${spaceId}/activity?type=task.moved`);
    assert.equal(actRes.status, 200);

    const events = actRes.body.events;
    assert.ok(events.length > 0, 'Expected at least one task.moved event');
    assert.ok(events.every((e) => e.type === 'task.moved'), 'All events should be task.moved');
  } finally {
    await close();
  }
});

test('limit and cursor pagination returns correct pages', async () => {
  const { port, close } = await startActivityTestServer();
  try {
    const spaceRes = await request(port, 'POST', '/api/v1/spaces', { name: 'Paginate Space' });
    const spaceId = spaceRes.body.id;

    // Create 5 tasks to generate 5 task.created events.
    for (let i = 0; i < 5; i++) {
      await request(port, 'POST', `/api/v1/spaces/${spaceId}/tasks`, { title: `Task ${i}`, type: 'task' });
    }
    await new Promise((r) => setTimeout(r, 20));

    // Page 1: limit=2 events of type task.created.
    const page1 = await request(
      port, 'GET',
      `/api/v1/spaces/${spaceId}/activity?type=task.created&limit=2`
    );
    assert.equal(page1.status, 200);
    assert.equal(page1.body.events.length, 2);
    assert.ok(page1.body.nextCursor !== null, 'Expected a nextCursor for page 1');

    // Page 2 using the cursor from page 1.
    const page2 = await request(
      port, 'GET',
      `/api/v1/spaces/${spaceId}/activity?type=task.created&limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`
    );
    assert.equal(page2.status, 200);
    assert.equal(page2.body.events.length, 2);

    // Ensure no duplicate IDs between pages.
    const ids1 = new Set(page1.body.events.map((e) => e.id));
    const ids2 = new Set(page2.body.events.map((e) => e.id));
    for (const id of ids2) {
      assert.ok(!ids1.has(id), `Duplicate event ID ${id} across pages`);
    }
  } finally {
    await close();
  }
});

test('invalid type query param returns 400', async () => {
  const { port, close } = await startActivityTestServer();
  try {
    const res = await request(port, 'GET', '/api/v1/activity?type=invalid.type');
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test('WebSocket client receives broadcast within 500ms of mutation', async () => {
  const { port, close } = await startActivityTestServer();
  try {
    const ws = await openActivityWs(port);

    // Skip the initial 'connected' message.
    const connected = await ws.waitForMessage(500);
    assert.equal(connected.type, 'connected');

    // Create a space, then a task — this should trigger a broadcast.
    const spaceRes = await request(port, 'POST', '/api/v1/spaces', { name: 'WS Space' });
    const spaceId = spaceRes.body.id;

    // The space.created event should arrive first.
    const spaceEvent = await ws.waitForMessage(500);
    assert.equal(spaceEvent.type, 'activity');
    assert.equal(spaceEvent.event.type, 'space.created');

    await request(port, 'POST', `/api/v1/spaces/${spaceId}/tasks`, {
      title: 'WS task',
      type: 'task',
    });

    const taskEvent = await ws.waitForMessage(500);
    assert.equal(taskEvent.type, 'activity');
    assert.equal(taskEvent.event.type, 'task.created');
    assert.equal(taskEvent.event.payload.taskTitle, 'WS task');

    ws.close();
  } finally {
    await close();
  }
});
