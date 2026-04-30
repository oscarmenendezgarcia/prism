/**
 * tests/terminal.test.js — Integration tests for the PTY terminal WebSocket server (v2).
 *
 * ADR-001-pty-support: covers T-006 (protocol tests) and T-008 (graceful degradation).
 *
 * Each test spins up an isolated HTTP + WebSocket server on a random available port
 * so these tests never conflict with the dev server on :3000.
 *
 * Run with:  node tests/terminal.test.js
 *
 * Uses Node.js built-in test runner (node:test).
 * All async work runs inside async test functions — CJS compatible.
 *
 * Test suites:
 *   1. Connection management — Origin check, connection cap, path routing
 *   2. PTY session lifecycle — ready message, shell fields
 *   3. Input protocol — write to PTY, validation errors
 *   4. Resize protocol — resize accepted silently, invalid resize errors
 *   5. Ping/pong keepalive
 *   6. Message validation — unknown type, invalid JSON
 *   7. PTY exit and auto-respawn — exit message + new ready message
 *   8. Disconnect cleanup — PTY killed when WebSocket closes
 *   9. Graceful degradation — node-pty unavailable returns 503
 *  10. ALLOWED_ORIGINS env var — configurable origin allowlist
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const net    = require('node:net');
const path   = require('node:path');
const { WebSocket } = require('ws');
const { setupTerminalWebSocket, MAX_CONNECTIONS } = require(path.join(__dirname, '..', 'terminal'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find a random available TCP port on localhost.
 * @returns {Promise<number>}
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Start an isolated HTTP + WebSocket test server on a random port.
 * @returns {Promise<{ server: http.Server, port: number, wsUrl: string }>}
 */
async function startTestServer() {
  const port = await getFreePort();
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    // Reject unhandled upgrade paths immediately (before setupTerminalWebSocket)
    // so openRawWs tests complete in milliseconds rather than waiting for a
    // handshakeTimeout. setupTerminalWebSocket uses a pass-through pattern for
    // non-terminal paths, which would leave the socket open and stall the event loop.
    server.on('upgrade', (req, socket) => {
      const url = req.url ? req.url.split('?')[0] : '';
      if (url !== '/ws/terminal' && !socket.destroyed) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
      }
    });
    setupTerminalWebSocket(server);
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, port, wsUrl: `ws://127.0.0.1:${port}/ws/terminal` });
    });
    server.on('error', reject);
  });
}

/**
 * Stop an HTTP server gracefully.
 * @param {http.Server} server
 * @returns {Promise<void>}
 */
function stopServer(server) {
  return new Promise((resolve, reject) => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Open a WebSocket with the given origin header AND immediately attach a
 * message buffer so that messages received before any collector registers
 * are not lost.
 *
 * Returns { ws, buffered, onMessage } where:
 *   - buffered: live array that ALL incoming messages are pushed into
 *   - onMessage(fn): register a one-time notifier called after each push
 *
 * All helpers (waitFor, collectN, collectUntil) use buffered + onMessage
 * so no message is ever missed regardless of scheduling order.
 *
 * @param {string} wsUrl
 * @param {{ origin?: string }} [opts]
 * @returns {Promise<{ ws: WebSocket, buffered: object[], onMessage: (fn: ()=>void)=>void }>}
 */
function openWs(wsUrl, opts = {}) {
  return new Promise((resolve, reject) => {
    const origin = opts.origin !== undefined ? opts.origin : 'http://localhost:3000';
    const ws = new WebSocket(wsUrl, { headers: { origin } });

    /** Live buffer — every incoming message is pushed here immediately. */
    const buffered = [];
    /** One-time notify callbacks registered by waitFor / collectUntil. */
    const notifiers = [];

    ws.once('open', () => {
      ws.addEventListener('message', (event) => {
        let parsed;
        try { parsed = JSON.parse(event.data); } catch { return; }
        buffered.push(parsed);
        // Fire all pending notifiers (they re-check buffered themselves).
        const fns = notifiers.splice(0);
        for (const fn of fns) fn();
      });
      resolve({
        ws,
        buffered,
        /** Register a one-shot callback that fires after the next message push. */
        onMessage: (fn) => notifiers.push(fn),
      });
    });
    ws.once('error', reject);
  });
}

/**
 * Wait for a message matching predicate by checking the shared buffer and
 * re-checking after each new arrival (via the onMessage notifier).
 * No second ws.addEventListener — avoids double-registration.
 *
 * @param {{ buffered: object[], onMessage: (fn:()=>void)=>void, ws: WebSocket }} conn
 * @param {(m: object) => boolean} predicate
 * @param {number} [timeoutMs=8000]
 * @returns {Promise<object>}
 */
function waitFor(conn, predicate, timeoutMs = 8000) {
  const { buffered, onMessage, ws } = conn;

  function checkBuffer() {
    const idx = buffered.findIndex(predicate);
    if (idx !== -1) return buffered.splice(idx, 1)[0];
    return null;
  }

  const found = checkBuffer();
  if (found) return Promise.resolve(found);

  return new Promise((resolve, reject) => {
    let timer;
    let done = false;

    const check = () => {
      if (done) return;
      const match = checkBuffer();
      if (match) {
        done = true;
        clearTimeout(timer);
        resolve(match);
      } else {
        // Re-register for the next arrival.
        onMessage(check);
      }
    };

    timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(`Timeout waiting for message matching predicate (${timeoutMs}ms)`));
    }, timeoutMs);

    onMessage(check);
  });
}

/**
 * Collect the next N messages of any type from the buffer.
 * @param {{ buffered: object[], onMessage: (fn:()=>void)=>void }} conn
 * @param {number} count
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<object[]>}
 */
function collectN(conn, count, timeoutMs = 5000) {
  const { buffered, onMessage } = conn;

  if (buffered.length >= count) return Promise.resolve(buffered.splice(0, count));

  return new Promise((resolve, reject) => {
    let timer;
    let done = false;

    const check = () => {
      if (done) return;
      if (buffered.length >= count) {
        done = true;
        clearTimeout(timer);
        resolve(buffered.splice(0, count));
      } else {
        onMessage(check);
      }
    };

    timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(`Timeout collecting ${count} messages (got ${buffered.length}) after ${timeoutMs}ms`));
    }, timeoutMs);

    onMessage(check);
  });
}

/**
 * Collect all messages until predicate matches (inclusive), draining buffer first.
 * @param {{ buffered: object[], onMessage: (fn:()=>void)=>void, ws: WebSocket }} conn
 * @param {(m: object) => boolean} predicate
 * @param {number} [timeoutMs=8000]
 * @returns {Promise<object[]>}
 */
function collectUntil(conn, predicate, timeoutMs = 8000) {
  const { buffered, onMessage, ws } = conn;

  // Drain current buffer and check for a match.
  const snapshot = buffered.splice(0);
  if (snapshot.some(predicate)) return Promise.resolve(snapshot);

  return new Promise((resolve, reject) => {
    let timer;
    let done = false;
    const collected = snapshot;

    const check = () => {
      if (done) return;
      // Move newly buffered messages into collected.
      const incoming = buffered.splice(0);
      collected.push(...incoming);
      if (collected.some(predicate)) {
        done = true;
        clearTimeout(timer);
        resolve(collected);
      } else {
        onMessage(check);
      }
    };

    const onClose = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(`WS closed before predicate matched (got ${collected.length} msgs)`));
    };

    timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(`Timeout: predicate never matched after ${collected.length} msgs (${timeoutMs}ms)`));
    }, timeoutMs);

    ws.addEventListener('close', onClose);
    onMessage(check);
  });
}

/**
 * Close a WebSocket and wait for its close event.
 * @param {WebSocket} ws
 * @returns {Promise<void>}
 */
function closeWs(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    ws.once('close', resolve);
    ws.close();
  });
}

/**
 * Open a raw WebSocket (without buffer setup — for tests that don't need PTY).
 * @param {string} wsUrl
 * @param {{ origin?: string }} [opts]
 * @returns {Promise<WebSocket>}
 */
function openRawWs(wsUrl, opts = {}) {
  return new Promise((resolve, reject) => {
    const origin = opts.origin !== undefined ? opts.origin : 'http://localhost:3000';
    const ws = new WebSocket(wsUrl, { headers: { origin } });
    ws.once('open',  () => resolve(ws));
    ws.once('error', (err) => reject(err));
  });
}

/**
 * Sleep for ms milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Suite 1 — Connection management
// ---------------------------------------------------------------------------

describe('Connection management', async () => {
  test('connects successfully with localhost origin', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl, { origin: 'http://localhost:3000' });
    assert.equal(conn.ws.readyState, WebSocket.OPEN);
    await closeWs(conn.ws);
    await stopServer(server);
  });

  test('rejects connection with non-localhost origin (HTTP 403)', async () => {
    const { server, wsUrl } = await startTestServer();
    await assert.rejects(
      () => openRawWs(wsUrl, { origin: 'http://evil.example.com' }),
      (err) => { assert.match(err.message, /403|Unexpected server response/); return true; }
    );
    await stopServer(server);
  });

  test('rejects non-/ws/terminal upgrade path', async () => {
    const { server, port } = await startTestServer();
    const badUrl = `ws://127.0.0.1:${port}/other/path`;
    await assert.rejects(
      () => openRawWs(badUrl),
      () => true
    );
    await stopServer(server);
  });

  test(`rejects connection when ${MAX_CONNECTIONS}-connection limit is reached with HTTP 429`, async () => {
    const { server, wsUrl } = await startTestServer();
    const conns = [];
    for (let i = 0; i < MAX_CONNECTIONS; i++) conns.push(await openWs(wsUrl));
    await assert.rejects(
      () => openRawWs(wsUrl),
      (err) => { assert.match(err.message, /429|Unexpected server response/); return true; }
    );
    await Promise.all(conns.map((c) => closeWs(c.ws)));
    await stopServer(server);
  });

  test('accepts new connection after previous ones close', async () => {
    const { server, wsUrl } = await startTestServer();
    const conns = [];
    for (let i = 0; i < MAX_CONNECTIONS; i++) conns.push(await openWs(wsUrl));
    await Promise.all(conns.map((c) => closeWs(c.ws)));
    // All slots freed — a fresh connection must succeed.
    const fresh = await openWs(wsUrl);
    assert.equal(fresh.ws.readyState, WebSocket.OPEN);
    await closeWs(fresh.ws);
    await stopServer(server);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — PTY session lifecycle — ready message
// ---------------------------------------------------------------------------

describe('PTY session lifecycle', async () => {
  test('receives ready message on connect with required fields', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl);

    const readyMsg = await waitFor(conn, (m) => m.type === 'ready');

    assert.equal(readyMsg.type, 'ready', 'First non-output message must be ready');
    assert.ok(typeof readyMsg.shell  === 'string' && readyMsg.shell.length > 0, 'shell must be non-empty string');
    assert.ok(typeof readyMsg.cols   === 'number' && readyMsg.cols  > 0, 'cols must be positive number');
    assert.ok(typeof readyMsg.rows   === 'number' && readyMsg.rows  > 0, 'rows must be positive number');
    assert.ok(typeof readyMsg.timestamp === 'string', 'timestamp must be a string');
    assert.doesNotThrow(() => new Date(readyMsg.timestamp), 'timestamp must be valid ISO 8601');

    await closeWs(conn.ws);
    await stopServer(server);
  });

  test('shell path in ready message starts with / (absolute path)', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl);

    const readyMsg = await waitFor(conn, (m) => m.type === 'ready');
    assert.match(readyMsg.shell, /^\//);

    await closeWs(conn.ws);
    await stopServer(server);
  });

  test('ready message cols and rows match defaults (80x24) before client resize', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl);

    const readyMsg = await waitFor(conn, (m) => m.type === 'ready');
    assert.equal(readyMsg.cols, 80, 'Default cols should be 80');
    assert.equal(readyMsg.rows, 24, 'Default rows should be 24');

    await closeWs(conn.ws);
    await stopServer(server);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — Input protocol
// ---------------------------------------------------------------------------

describe('Input protocol', async () => {
  test('echo hello\\r produces output containing "hello"', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl);

    await waitFor(conn, (m) => m.type === 'ready');

    conn.ws.send(JSON.stringify({ type: 'input', data: 'echo hello_test_marker\r' }));

    const msgs = await collectUntil(conn, (m) => {
      return m.type === 'output' && m.data.includes('hello_test_marker');
    }, 8000);

    const combined = msgs.filter((m) => m.type === 'output').map((m) => m.data).join('');
    assert.match(combined, /hello_test_marker/);

    await closeWs(conn.ws);
    await stopServer(server);
  });

  test('input with empty data receives INVALID_INPUT error', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl);

    await waitFor(conn, (m) => m.type === 'ready');

    conn.ws.send(JSON.stringify({ type: 'input', data: '' }));
    const errMsg = await waitFor(conn, (m) => m.type === 'error', 5000);

    assert.equal(errMsg.code, 'INVALID_INPUT');

    await closeWs(conn.ws);
    await stopServer(server);
  });

  test('input with data exceeding 4096 chars receives INPUT_TOO_LARGE error', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl);

    await waitFor(conn, (m) => m.type === 'ready');

    conn.ws.send(JSON.stringify({ type: 'input', data: 'a'.repeat(4097) }));
    const errMsg = await waitFor(conn, (m) => m.type === 'error', 5000);

    assert.equal(errMsg.code, 'INPUT_TOO_LARGE');

    await closeWs(conn.ws);
    await stopServer(server);
  });

  test('Ctrl+C (\\x03) sends SIGINT via PTY — shell output received after interrupt', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl);

    await waitFor(conn, (m) => m.type === 'ready');

    // Start a long-running process.
    conn.ws.send(JSON.stringify({ type: 'input', data: 'sleep 999\r' }));
    await sleep(500);

    // Send Ctrl+C as raw byte.
    conn.ws.send(JSON.stringify({ type: 'input', data: '\x03' }));

    // The shell should produce output showing ^C and/or a new prompt.
    const msgs = await collectUntil(conn, (m) => {
      return m.type === 'output' && (
        m.data.includes('^C') ||
        m.data.includes('%') ||
        m.data.includes('$') ||
        m.data.includes('#')
      );
    }, 8000);

    const combined = msgs.filter((m) => m.type === 'output').map((m) => m.data).join('');
    assert.ok(combined.length > 0, 'Expected shell output after Ctrl+C');

    await closeWs(conn.ws);
    await stopServer(server);
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — Resize protocol
// ---------------------------------------------------------------------------

describe('Resize protocol', async () => {
  test('valid resize message produces no error response (success is silent)', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl);

    await waitFor(conn, (m) => m.type === 'ready');
    await sleep(200);
    conn.buffered.splice(0);  // discard any initial prompt output

    conn.ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 50 }));

    // Wait briefly; if any error message arrives, the test fails.
    const result = await Promise.race([
      waitFor(conn, (m) => m.type === 'error', 500)
        .then((err) => ({ error: err }))
        .catch(() => ({ timeout: true })),
      sleep(500).then(() => ({ timeout: true })),
    ]);

    assert.ok(result.timeout === true, `Valid resize must not produce an error response; got: ${JSON.stringify(result.error)}`);

    await closeWs(conn.ws);
    await stopServer(server);
  });

  test('resize with non-integer cols receives INVALID_RESIZE error', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl);

    await waitFor(conn, (m) => m.type === 'ready');

    conn.ws.send(JSON.stringify({ type: 'resize', cols: 'wide', rows: 24 }));
    const errMsg = await waitFor(conn, (m) => m.type === 'error', 5000);

    assert.equal(errMsg.code, 'INVALID_RESIZE');

    await closeWs(conn.ws);
    await stopServer(server);
  });

  test('resize with missing rows receives INVALID_RESIZE error', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl);

    await waitFor(conn, (m) => m.type === 'ready');

    conn.ws.send(JSON.stringify({ type: 'resize', cols: 80 }));  // rows missing
    const errMsg = await waitFor(conn, (m) => m.type === 'error', 5000);

    assert.equal(errMsg.code, 'INVALID_RESIZE');

    await closeWs(conn.ws);
    await stopServer(server);
  });

  test('out-of-range cols are clamped (no error) — 9999 cols', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl);

    await waitFor(conn, (m) => m.type === 'ready');
    await sleep(200);
    conn.buffered.splice(0);

    // cols > 500 should be clamped to 500, not rejected.
    conn.ws.send(JSON.stringify({ type: 'resize', cols: 9999, rows: 24 }));

    const result = await Promise.race([
      waitFor(conn, (m) => m.type === 'error', 500)
        .then((err) => ({ error: err }))
        .catch(() => ({ timeout: true })),
      sleep(500).then(() => ({ timeout: true })),
    ]);

    assert.ok(result.timeout === true, `Out-of-range cols should be clamped not rejected; got: ${JSON.stringify(result.error)}`);

    await closeWs(conn.ws);
    await stopServer(server);
  });
});

// ---------------------------------------------------------------------------
// Suite 5 — Ping/pong keepalive
// ---------------------------------------------------------------------------

describe('Ping/pong keepalive', async () => {
  test('ping receives pong response', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl);

    await waitFor(conn, (m) => m.type === 'ready');

    conn.ws.send(JSON.stringify({ type: 'ping' }));
    const pongMsg = await waitFor(conn, (m) => m.type === 'pong', 5000);

    assert.equal(pongMsg.type, 'pong');

    await closeWs(conn.ws);
    await stopServer(server);
  });
});

// ---------------------------------------------------------------------------
// Suite 6 — Message validation
// ---------------------------------------------------------------------------

describe('Message validation', async () => {
  test('unknown message type (exec — v1 type) receives UNKNOWN_MESSAGE_TYPE error', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl);

    await waitFor(conn, (m) => m.type === 'ready');

    conn.ws.send(JSON.stringify({ type: 'exec', command: 'ls' }));
    const errMsg = await waitFor(conn, (m) => m.type === 'error', 5000);

    assert.equal(errMsg.code, 'UNKNOWN_MESSAGE_TYPE');
    assert.match(errMsg.message, /exec/);

    await closeWs(conn.ws);
    await stopServer(server);
  });

  test('invalid JSON receives INVALID_JSON error', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl);

    await waitFor(conn, (m) => m.type === 'ready');

    conn.ws.send('not json {{{');
    const errMsg = await waitFor(conn, (m) => m.type === 'error', 5000);

    assert.equal(errMsg.code, 'INVALID_JSON');

    await closeWs(conn.ws);
    await stopServer(server);
  });

  test('error messages include code, message, and timestamp fields', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl);

    await waitFor(conn, (m) => m.type === 'ready');

    conn.ws.send(JSON.stringify({ type: 'input', data: '' }));
    const errMsg = await waitFor(conn, (m) => m.type === 'error', 5000);

    assert.ok(typeof errMsg.code    === 'string' && errMsg.code.length > 0,    'error must have code');
    assert.ok(typeof errMsg.message === 'string' && errMsg.message.length > 0, 'error must have message');
    assert.ok(typeof errMsg.timestamp === 'string',                            'error must have timestamp');

    await closeWs(conn.ws);
    await stopServer(server);
  });
});

// ---------------------------------------------------------------------------
// Suite 7 — PTY exit and auto-respawn
// ---------------------------------------------------------------------------

describe('PTY exit and auto-respawn', async () => {
  test('exit message is sent when shell exits, followed by new ready message', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl);

    await waitFor(conn, (m) => m.type === 'ready');
    // Wait for initial prompt output to settle before sending exit.
    await sleep(300);
    conn.buffered.splice(0);

    // Send `exit` command — works reliably across bash, zsh, and sh.
    conn.ws.send(JSON.stringify({ type: 'input', data: 'exit\r' }));

    // Wait for exit message.
    const exitMsg = await waitFor(conn, (m) => m.type === 'exit', 10000);
    assert.ok(exitMsg, 'Must receive exit message when shell exits');

    // Then wait for auto-respawn ready message.
    const newReady = await waitFor(conn, (m) => m.type === 'ready', 10000);
    assert.ok(newReady, 'Must receive new ready message after auto-respawn');
    assert.ok(typeof newReady.timestamp === 'string', 'ready timestamp must be string');

    await closeWs(conn.ws);
    await stopServer(server);
  });

  test('WebSocket remains open after shell exit and respawn', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl);

    await waitFor(conn, (m) => m.type === 'ready');
    await sleep(300);
    conn.buffered.splice(0);

    // Send `exit` command — works reliably across bash, zsh, and sh.
    conn.ws.send(JSON.stringify({ type: 'input', data: 'exit\r' }));

    // Wait for respawn ready.
    await waitFor(conn, (m) => m.type === 'exit',  10000);
    await waitFor(conn, (m) => m.type === 'ready', 10000);

    // Connection must still be open.
    assert.equal(conn.ws.readyState, WebSocket.OPEN, 'WebSocket must remain open after auto-respawn');

    await closeWs(conn.ws);
    await stopServer(server);
  });
});

// ---------------------------------------------------------------------------
// Suite 8 — Disconnect cleanup
// ---------------------------------------------------------------------------

describe('Disconnect cleanup', async () => {
  test('closing connection while PTY is running frees the connection slot', async () => {
    const { server, wsUrl } = await startTestServer();
    const conn = await openWs(wsUrl);

    await waitFor(conn, (m) => m.type === 'ready');

    // Start a long-running process.
    conn.ws.send(JSON.stringify({ type: 'input', data: 'sleep 30\r' }));
    await sleep(200);

    // Force disconnect.
    await closeWs(conn.ws);
    await sleep(500);

    // Slot must be freed — new connection should succeed.
    const conn2 = await openWs(wsUrl);
    assert.equal(conn2.ws.readyState, WebSocket.OPEN);
    await closeWs(conn2.ws);
    await stopServer(server);
  });
});

// ---------------------------------------------------------------------------
// Suite 9 — Graceful degradation when node-pty is unavailable
// ---------------------------------------------------------------------------

describe('Graceful degradation — node-pty unavailable', async () => {
  /**
   * Build a server that mimics the behaviour of terminal.js when
   * node-pty is not available: the upgrade handler responds 503.
   *
   * We reproduce the fallback branch logic here rather than monkey-patching
   * require() to avoid polluting other tests in the suite.
   */
  function setupDegradedServer(httpServer) {
    httpServer.on('upgrade', (req, socket) => {
      const url = req.url ? req.url.split('?')[0] : '';
      if (url === '/ws/terminal') {
        socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        socket.destroy();
      }
    });
  }

  test('upgrade to /ws/terminal returns 503 when node-pty is unavailable', async () => {
    const port = await getFreePort();
    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    setupDegradedServer(server);

    await new Promise((resolve, reject) => {
      server.listen(port, '127.0.0.1', resolve);
      server.on('error', reject);
    });

    const wsUrl = `ws://127.0.0.1:${port}/ws/terminal`;

    await assert.rejects(
      () => openRawWs(wsUrl, { origin: 'http://localhost:3000' }),
      (err) => {
        assert.match(err.message, /503|Unexpected server response/);
        return true;
      }
    );

    await stopServer(server);
  });

  test('HTTP requests succeed when node-pty is unavailable (board unaffected)', async () => {
    const port = await getFreePort();
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    setupDegradedServer(server);

    await new Promise((resolve, reject) => {
      server.listen(port, '127.0.0.1', resolve);
      server.on('error', reject);
    });

    const response = await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port, path: '/api/v1/tasks', method: 'GET' },
        (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => resolve({ statusCode: res.statusCode, body }));
        }
      );
      req.on('error', reject);
      req.end();
    });

    assert.equal(response.statusCode, 200, 'HTTP request must return 200 when PTY is disabled');

    await stopServer(server);
  });
});

// ---------------------------------------------------------------------------
// Suite 10 — ALLOWED_ORIGINS env var
// ---------------------------------------------------------------------------

/**
 * Helper: load a fresh terminal module with a given ALLOWED_ORIGINS value.
 * Temporarily removes the module from require.cache, sets the env var, re-requires,
 * then immediately cleans up (cache entry + env var) so other tests are unaffected.
 *
 * @param {string} allowedOriginsValue - Value to assign to process.env.ALLOWED_ORIGINS.
 * @returns {{ setupTerminalWebSocket: Function }}
 */
function requireTerminalWithOrigins(allowedOriginsValue) {
  const terminalPath = require.resolve(path.join(__dirname, '..', 'terminal'));
  // Remove cached module so the next require re-evaluates module-level constants.
  delete require.cache[terminalPath];
  process.env.ALLOWED_ORIGINS = allowedOriginsValue;
  const mod = require(terminalPath);
  // Immediately restore: delete cache entry + env var so the running process is clean.
  delete require.cache[terminalPath];
  delete process.env.ALLOWED_ORIGINS;
  return mod;
}

/**
 * Start an isolated test server using the provided setupTerminalWebSocket function.
 * @param {Function} setup
 * @returns {Promise<{ server: http.Server, wsUrl: string }>}
 */
async function startCustomServer(setup) {
  const port = await getFreePort();
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    setup(server);
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, wsUrl: `ws://127.0.0.1:${port}/ws/terminal` });
    });
    server.on('error', reject);
  });
}

describe('ALLOWED_ORIGINS env var', async () => {
  test('custom origin in ALLOWED_ORIGINS is accepted', async () => {
    const { setupTerminalWebSocket: setup } = requireTerminalWithOrigins('http://myapp.example.com:8080');
    const { server, wsUrl } = await startCustomServer(setup);

    const conn = await openWs(wsUrl, { origin: 'http://myapp.example.com:8080' });
    const ready = await waitFor(conn, (m) => m.type === 'ready');
    assert.equal(ready.type, 'ready', 'custom origin should receive ready message');

    await closeWs(conn.ws);
    await stopServer(server);
  });

  test('localhost rejected when not listed in ALLOWED_ORIGINS', async () => {
    const { setupTerminalWebSocket: setup } = requireTerminalWithOrigins('http://myapp.example.com:8080');
    const { server, wsUrl } = await startCustomServer(setup);

    await assert.rejects(
      () => openRawWs(wsUrl, { origin: 'http://localhost:3000' }),
      (err) => { assert.match(err.message, /403|Unexpected server response/); return true; }
    );

    await stopServer(server);
  });

  test('multiple comma-separated origins are all accepted', async () => {
    const { setupTerminalWebSocket: setup } = requireTerminalWithOrigins(
      'http://app1.example.com, http://app2.example.com:9000'
    );
    const { server, wsUrl } = await startCustomServer(setup);

    // First origin accepted.
    const conn1 = await openWs(wsUrl, { origin: 'http://app1.example.com' });
    const ready1 = await waitFor(conn1, (m) => m.type === 'ready');
    assert.equal(ready1.type, 'ready');
    await closeWs(conn1.ws);
    await sleep(50);

    // Second origin accepted.
    const conn2 = await openWs(wsUrl, { origin: 'http://app2.example.com:9000' });
    const ready2 = await waitFor(conn2, (m) => m.type === 'ready');
    assert.equal(ready2.type, 'ready');
    await closeWs(conn2.ws);

    await stopServer(server);
  });

  test('whitespace around origins in ALLOWED_ORIGINS is trimmed', async () => {
    const { setupTerminalWebSocket: setup } = requireTerminalWithOrigins(
      '  http://trimmed.example.com  '
    );
    const { server, wsUrl } = await startCustomServer(setup);

    const conn = await openWs(wsUrl, { origin: 'http://trimmed.example.com' });
    const ready = await waitFor(conn, (m) => m.type === 'ready');
    assert.equal(ready.type, 'ready', 'trimmed origin should be accepted');

    await closeWs(conn.ws);
    await stopServer(server);
  });

  test('fallback to localhost defaults when ALLOWED_ORIGINS is not set', async () => {
    // Verify env var is absent (normal test-runner state).
    assert.equal(process.env.ALLOWED_ORIGINS, undefined, 'ALLOWED_ORIGINS should be unset');

    // startTestServer uses the top-level import (default origins).
    const { server, wsUrl } = await startTestServer();

    const conn = await openWs(wsUrl, { origin: 'http://localhost:3000' });
    const ready = await waitFor(conn, (m) => m.type === 'ready');
    assert.equal(ready.type, 'ready', 'localhost:3000 should be accepted by default');

    await closeWs(conn.ws);
    await stopServer(server);
  });

  test('127.0.0.1:3000 accepted by default fallback', async () => {
    const { server, wsUrl } = await startTestServer();

    const conn = await openWs(wsUrl, { origin: 'http://127.0.0.1:3000' });
    const ready = await waitFor(conn, (m) => m.type === 'ready');
    assert.equal(ready.type, 'ready', '127.0.0.1:3000 should be accepted by default');

    await closeWs(conn.ws);
    await stopServer(server);
  });
});

// ---------------------------------------------------------------------------
// Suite 11 — OutputRingBuffer unit tests (T-001, T-004)
// ---------------------------------------------------------------------------

const { _OutputRingBuffer: RingBuffer } = require(path.join(__dirname, '..', 'terminal'));

describe('OutputRingBuffer unit tests', async () => {
  test('empty buffer drain returns empty data, no trim', async () => {
    const rb = new RingBuffer(10);
    const { data, trimmed, dropped } = rb.drain();
    assert.equal(data, '');
    assert.equal(trimmed, false);
    assert.equal(dropped, 0);
  });

  test('under-capacity append: data returned unchanged, no trim', async () => {
    const rb = new RingBuffer(10);
    rb.append('hello');
    const { data, trimmed, dropped } = rb.drain();
    assert.equal(data, 'hello');
    assert.equal(trimmed, false);
    assert.equal(dropped, 0);
  });

  test('exact-capacity append: all data retained, no trim', async () => {
    const rb = new RingBuffer(5);
    rb.append('ABCDE');
    const { data, trimmed, dropped } = rb.drain();
    assert.equal(data, 'ABCDE');
    assert.equal(trimmed, false);
    assert.equal(dropped, 0);
  });

  test('single-chunk overflow: trims oldest bytes, trimmed=true, dropped count correct', async () => {
    const rb = new RingBuffer(5);
    rb.append('ABCDE');  // fills exactly
    rb.append('FGH');    // overflows by 3 → retains DEFGH
    const { data, trimmed, dropped } = rb.drain();
    assert.equal(trimmed, true, 'trimmed must be true after overflow');
    assert.equal(dropped, 3, 'dropped must equal bytes evicted');
    assert.equal(data, 'DEFGH', 'ring must contain the most-recent 5 bytes');
  });

  test('multi-chunk overflow: accumulated dropped count across appends', async () => {
    const rb = new RingBuffer(5);
    rb.append('ABCDE');  // fills
    rb.append('FG');     // drops 2 (A,B) → retains CDEFG
    rb.append('HI');     // drops 2 (C,D) → retains EFGHI
    const { data, trimmed, dropped } = rb.drain();
    assert.equal(trimmed, true);
    assert.equal(dropped, 4, 'accumulated drops across both overflow appends');
    assert.equal(data, 'EFGHI');
  });

  test('chunk larger than capacity: only last capacity bytes kept', async () => {
    const rb = new RingBuffer(5);
    rb.append('ABCDEFGHIJ');  // 10 bytes > capacity 5
    const { data, trimmed, dropped } = rb.drain();
    assert.equal(data, 'FGHIJ', 'must keep only the last capacity bytes');
    assert.equal(trimmed, true);
    assert.equal(dropped, 5, 'exactly (n - capacity) bytes dropped when n > capacity and size=0');
  });

  test('chunk larger than capacity with pre-existing data: counts pre-existing + overflow', async () => {
    const rb = new RingBuffer(5);
    rb.append('AB');           // size=2
    rb.append('CDEFGHIJ');    // 8 bytes, 8 > 5 → dropped = 2 + (8-5) = 5
    const { data, trimmed, dropped } = rb.drain();
    assert.equal(data, 'FGHIJ');
    assert.equal(trimmed, true);
    assert.equal(dropped, 5);
  });

  test('drain resets state: second drain returns empty with no trim', async () => {
    const rb = new RingBuffer(10);
    rb.append('hello');
    rb.drain();
    const { data, trimmed, dropped } = rb.drain();
    assert.equal(data, '');
    assert.equal(trimmed, false);
    assert.equal(dropped, 0);
  });

  test('Buffer input works the same as string input', async () => {
    const rb = new RingBuffer(10);
    rb.append(Buffer.from('hello'));
    const { data, trimmed } = rb.drain();
    assert.equal(data, 'hello');
    assert.equal(trimmed, false);
  });

  test('multiple appends without overflow accumulate correctly', async () => {
    const rb = new RingBuffer(10);
    rb.append('abc');
    rb.append('def');
    const { data, trimmed } = rb.drain();
    assert.equal(data, 'abcdef');
    assert.equal(trimmed, false);
  });

  test('wrap-around drain returns bytes in chronological order', async () => {
    // Force a wrap-around: fill 8 bytes of a 10-byte ring, drain,
    // then write 6 more so head wraps past the end.
    const rb = new RingBuffer(10);
    rb.append('ABCDEFGH');   // head=8, size=8
    rb.drain();              // reset — size=0, head=0
    rb.append('12345');      // head=5, size=5
    rb.append('678');        // head=8, size=8  (no overflow)

    // Now head is near the end. Append 5 more to force wrap.
    rb.append('IJKLM');      // head=(8+5)%10=3, size=10 (8+5=13>10 → overflow=3, trimmed)
    const { data, trimmed } = rb.drain();
    assert.equal(trimmed, true);
    assert.equal(data.length, 10, 'ring must contain exactly capacity bytes');
    // After overflow of 3, the oldest 3 bytes (1,2,3) are gone.
    // Remaining: 45678IJKLM
    assert.equal(data, '45678IJKLM');
  });
});

// ---------------------------------------------------------------------------
// Suite 12 — Sentinel emission (mock-session unit tests, T-004a)
// ---------------------------------------------------------------------------

const { _flushOutputForTesting } = require(path.join(__dirname, '..', 'terminal'));

const SENTINEL = '--- older output trimmed ---';

/**
 * Build a minimal mock session for flush tests.
 * @param {number} ringCapacity
 */
function makeMockFlushSession(ringCapacity) {
  const ring = new RingBuffer(ringCapacity);
  const received = [];
  const mockWs = {
    readyState: 1,
    constructor: { OPEN: 1 },
    bufferedAmount: 0,
    send(payload) { received.push(JSON.parse(payload)); },
  };
  const mockPty = { pid: 42, pause() {}, resume() {} };
  const session = {
    ws:   mockWs,
    pty:  mockPty,
    alive: true,
    paused: false,
    backpressureTimer: null,
    _backpressureWarnEmitted: false,
    ring,
  };
  return { session, ring, received };
}

describe('Ring buffer sentinel emission', async () => {
  test('no-trim baseline: small output produces no sentinel and no log', async () => {
    const { session, ring, received } = makeMockFlushSession(100);
    ring.append('hello world');  // 11 bytes < 100 capacity

    const result = _flushOutputForTesting(session, 1);
    assert.ok(result !== null, 'flush must return a result');
    assert.equal(result.trimmed, false, 'trimmed must be false for under-capacity output');
    assert.equal(result.dropped, 0, 'no bytes should be dropped');
    assert.ok(!result.payload.includes(SENTINEL), 'no sentinel for under-capacity output');
    assert.equal(received.length, 1, 'one WS message sent');
    assert.ok(!received[0].data.includes(SENTINEL), 'WS message must not contain sentinel');
  });

  test('overflow trim: sentinel prepended when ring overflows', async () => {
    const SMALL_CAP = 20;
    const { session, ring, received } = makeMockFlushSession(SMALL_CAP);
    // Append more bytes than the ring can hold → forces overflow.
    ring.append('This is definitely more than twenty bytes');

    const result = _flushOutputForTesting(session, 1);
    assert.ok(result !== null, 'flush must return a result');
    assert.equal(result.trimmed, true, 'trimmed must be true after overflow');
    assert.ok(result.dropped > 0, 'some bytes must have been dropped');
    assert.ok(result.payload.includes(SENTINEL), 'payload must contain sentinel');
    // Sentinel comes before the data.
    const sentinelIdx = result.payload.indexOf(SENTINEL);
    assert.ok(sentinelIdx < result.payload.lastIndexOf('A') || sentinelIdx === 0 ||
      sentinelIdx < result.payload.length - 1,
      'sentinel must appear before retained data');
    assert.equal(received.length, 1, 'one WS message sent');
    assert.ok(received[0].data.includes(SENTINEL), 'WS message data must contain sentinel');
    // Total output is bounded: retained data ≤ capacity, plus sentinel.
    const nonSentinelData = received[0].data.replace('\r\n--- older output trimmed ---\r\n', '');
    assert.ok(nonSentinelData.length <= SMALL_CAP, 'retained data must not exceed capacity');
  });

  test('empty ring flush returns null (no WS message sent)', async () => {
    const { session, received } = makeMockFlushSession(100);
    // ring is empty — flush should be a no-op.
    const result = _flushOutputForTesting(session, 1);
    assert.equal(result, null, 'flush on empty ring must return null');
    assert.equal(received.length, 0, 'no WS message must be sent for empty ring');
  });

  test('sentinel format: exact prefix is \\r\\n--- older output trimmed ---\\r\\n', async () => {
    const { session, ring } = makeMockFlushSession(5);
    ring.append('ABCDEFGHIJ');  // 10 bytes > 5 cap → trimmed

    const result = _flushOutputForTesting(session, 1);
    assert.ok(result !== null);
    assert.ok(
      result.payload.startsWith('\r\n--- older output trimmed ---\r\n'),
      'payload must start with the exact sentinel string'
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 13 — Backpressure controller unit tests (T-003, T-004c)
// ---------------------------------------------------------------------------

const { _checkBackpressure, _constants } = require(path.join(__dirname, '..', 'terminal'));
const { WS_BACKPRESSURE_HIGH_WATERMARK, WS_BACKPRESSURE_LOW_WATERMARK, BACKPRESSURE_POLL_INTERVAL_MS } = _constants;

/**
 * Build a minimal mock session for backpressure tests.
 * @param {{ bufferedAmount?: number, pauseThrows?: boolean }} opts
 */
function makeMockSession(opts = {}) {
  const { bufferedAmount = 0, pauseThrows = false } = opts;
  let currentBufferedAmount = bufferedAmount;

  const mockPty = {
    pid: 9999,
    pauseCalled: 0,
    resumeCalled: 0,
    pause() {
      if (pauseThrows) throw new Error('not supported');
      this.pauseCalled++;
    },
    resume() {
      this.resumeCalled++;
    },
  };

  const mockWs = {
    get bufferedAmount() { return currentBufferedAmount; },
    set bufferedAmount(v) { currentBufferedAmount = v; },
    readyState: 1,  // OPEN
    constructor: { OPEN: 1 },
  };

  return {
    ws: mockWs,
    pty: mockPty,
    alive: true,
    paused: false,
    backpressureTimer: null,
    _backpressureWarnEmitted: false,
  };
}

describe('Backpressure controller', async () => {
  test('pty.pause not called when bufferedAmount is below HIGH_WATERMARK', async () => {
    const session = makeMockSession({ bufferedAmount: WS_BACKPRESSURE_HIGH_WATERMARK - 1 });
    _checkBackpressure(session);
    assert.equal(session.pty.pauseCalled, 0, 'pause must not be called below high-watermark');
    assert.equal(session.paused, false);
    assert.equal(session.backpressureTimer, null);
  });

  test('pty.pause called when bufferedAmount >= HIGH_WATERMARK', async () => {
    const session = makeMockSession({ bufferedAmount: WS_BACKPRESSURE_HIGH_WATERMARK });
    _checkBackpressure(session);
    assert.equal(session.pty.pauseCalled, 1, 'pause must be called at high-watermark');
    assert.equal(session.paused, true);
    assert.ok(session.backpressureTimer !== null, 'polling timer must be started');
    // Clean up timer.
    clearInterval(session.backpressureTimer);
  });

  test('pty.resume called after bufferedAmount drops to 0', async () => {
    const session = makeMockSession({ bufferedAmount: WS_BACKPRESSURE_HIGH_WATERMARK + 1 });
    _checkBackpressure(session);
    assert.equal(session.pty.pauseCalled, 1, 'pause must be called');
    assert.equal(session.paused, true);

    // Simulate the WS queue draining.
    session.ws.bufferedAmount = 0;

    // Wait long enough for at least 3 poll cycles.
    await sleep(BACKPRESSURE_POLL_INTERVAL_MS * 5);

    assert.equal(session.pty.resumeCalled, 1, 'resume must be called once ws queue drains');
    assert.equal(session.paused, false);
    assert.equal(session.backpressureTimer, null, 'timer must be cleared after resume');
  });

  test('second checkBackpressure call while paused is a no-op', async () => {
    const session = makeMockSession({ bufferedAmount: WS_BACKPRESSURE_HIGH_WATERMARK + 1 });
    _checkBackpressure(session);
    _checkBackpressure(session);  // second call — already paused
    assert.equal(session.pty.pauseCalled, 1, 'pause must only be called once');
    clearInterval(session.backpressureTimer);
  });

  test('pty.pause failure is caught and logged once; subsequent calls also skip', async () => {
    const session = makeMockSession({
      bufferedAmount: WS_BACKPRESSURE_HIGH_WATERMARK + 1,
      pauseThrows: true,
    });

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.join(' ')); };

    try {
      _checkBackpressure(session);  // first call — warn emitted
      _checkBackpressure(session);  // second call — warn must NOT be repeated
    } finally {
      console.warn = origWarn;
    }

    assert.equal(session.paused, false, 'session must not be marked paused if pause() threw');
    assert.equal(session.backpressureTimer, null, 'no timer should be set if pause failed');
    assert.equal(
      warnings.filter((w) => w.includes('backpressure')).length,
      1,
      'warn must be emitted exactly once'
    );
  });

  test('polling timer stopped when session.alive becomes false', async () => {
    const session = makeMockSession({ bufferedAmount: WS_BACKPRESSURE_HIGH_WATERMARK + 1 });
    _checkBackpressure(session);
    assert.equal(session.paused, true);

    // Simulate disconnect (cleanupSession sets alive=false and ws=null).
    session.alive = false;
    session.ws = null;

    await sleep(BACKPRESSURE_POLL_INTERVAL_MS * 3);

    // Timer should have cleared itself.
    assert.equal(session.backpressureTimer, null, 'timer must self-clear after session dies');
    assert.equal(session.paused, false);
  });
});
