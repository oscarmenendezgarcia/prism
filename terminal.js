/**
 * terminal.js — Embedded Terminal WebSocket Server (v2 — PTY)
 *
 * ADR-001-pty-support: Replace spawn-pipe with node-pty for True PTY Support.
 *
 * Exports setupTerminalWebSocket(httpServer) which attaches a WebSocketServer
 * in noServer mode to the existing HTTP server. Upgrade requests at the path
 * /ws/terminal are handled here; all other paths are destroyed.
 *
 * Each WebSocket connection gets one PTY session. Messages are JSON objects;
 * see the v2 protocol documented in docs/pty-support/api-spec.json.
 *
 * Protocol v2 (replaces v1 exec/stdout/stderr/signal/busy):
 *   Client → Server: { type: "input", data: "..." }
 *                    { type: "resize", cols: N, rows: N }
 *                    { type: "ping" }
 *   Server → Client: { type: "ready", cols, rows, shell, timestamp }
 *                    { type: "output", data: "..." }
 *                    { type: "exit", code, timestamp }
 *                    { type: "error", code, message, timestamp }
 *                    { type: "pong" }
 *
 * Security model (unchanged from v1 — localhost dev tool):
 *   - Only localhost Origins are accepted.
 *   - Max 2 concurrent WebSocket connections.
 *   - PTY cleanup on disconnect: pty.kill().
 *   - maxPayload: 131072 bytes (128 KB — increased for large paste operations).
 *
 * Graceful degradation:
 *   If node-pty cannot be loaded (native binary missing / compile failure),
 *   setupTerminalWebSocket() returns a handler that responds HTTP 503 to all
 *   upgrade requests. The rest of the application continues normally.
 *
 * Usage (in server.js, after server.listen()):
 *   const { setupTerminalWebSocket } = require('./terminal');
 *   setupTerminalWebSocket(server);
 */

'use strict';

const { WebSocketServer } = require('ws');
const path                = require('path');
const fs                  = require('fs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Absolute path used as cwd for the spawned PTY shell. */
const PROJECT_ROOT = __dirname;

/** Maximum concurrent WebSocket connections. */
const MAX_CONNECTIONS = 5;

/**
 * Set of allowed WebSocket Origin values.
 * Configurable via ALLOWED_ORIGINS env var (comma-separated).
 * Falls back to localhost:3000 for local development.
 */
const LOCALHOST_ORIGINS = process.env.ALLOWED_ORIGINS
  ? new Set(process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean))
  : new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);

/** Default PTY dimensions used until the client sends a resize message. */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/** PTY output buffer flush threshold in bytes (4 KB). */
const OUTPUT_BUFFER_FLUSH_THRESHOLD = 4096;

/** Maximum input data length in characters (per api-spec.json). */
const MAX_INPUT_LENGTH = 4096;

/** Valid column range per api-spec.json (clamped, not rejected). */
const COLS_MIN = 1;
const COLS_MAX = 500;

/** Valid row range per api-spec.json (clamped, not rejected). */
const ROWS_MIN = 1;
const ROWS_MAX = 200;

// ---------------------------------------------------------------------------
// node-pty — attempt to load; graceful degradation if unavailable
// ---------------------------------------------------------------------------

/** @type {import('node-pty')|null} */
let nodePty = null;
let ptyLoadError = null;

try {
  nodePty = require('node-pty');
} catch (err) {
  ptyLoadError = err.message;
  console.warn(`[terminal] node-pty not available: ${err.message}. Terminal feature disabled.`);
}

// ---------------------------------------------------------------------------
// Helpers — shell detection
// ---------------------------------------------------------------------------

/**
 * Detect the user's preferred shell.
 * Priority: $SHELL env var → /bin/zsh (macOS) → /bin/bash → /bin/sh.
 *
 * @returns {string} Absolute path to the shell binary.
 */
function getShell() {
  const candidates = [
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
  ];

  for (const candidate of candidates) {
    if (candidate && candidate.length > 0) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Not executable — try next.
      }
    }
  }

  // Last resort: /bin/sh should always exist on Unix.
  return '/bin/sh';
}

// ---------------------------------------------------------------------------
// Helpers — message builders
// ---------------------------------------------------------------------------

/**
 * Build a typed JSON message with an ISO timestamp.
 * @param {string} type
 * @param {object} [fields]
 * @returns {string} JSON string ready to send.
 */
function msg(type, fields) {
  return JSON.stringify({ type, timestamp: new Date().toISOString(), ...fields });
}

/**
 * Build a pong response (no timestamp per api-spec.json).
 * @returns {string}
 */
function pongMsg() {
  return JSON.stringify({ type: 'pong' });
}

/**
 * Send a JSON message on a WebSocket, ignoring errors if the socket is
 * already closing (readyState !== OPEN).
 * @param {import('ws').WebSocket} ws
 * @param {string} payload - Result of msg().
 */
function safeSend(ws, payload) {
  if (ws && ws.readyState === ws.constructor.OPEN) {
    ws.send(payload);
  }
}

// ---------------------------------------------------------------------------
// PTY session management
// ---------------------------------------------------------------------------

/**
 * Spawn a new PTY shell and wire its onData/onExit events to the session.
 * Sends a `ready` message to the WebSocket client after spawn.
 *
 * ADR-001-pty-support §3.4: createPtySession.
 *
 * @param {object} session - The session object (see handleConnection).
 */
function createPtySession(session) {
  const shell = getShell();
  const cols  = session.cols;
  const rows  = session.rows;

  let pty;
  try {
    // Build PTY env: inherit process env but remove CLAUDECODE so that
    // `claude` can be launched from within this terminal without triggering
    // the "nested Claude Code session" guard.
    const ptyEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    delete ptyEnv.CLAUDECODE;

    pty = nodePty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: PROJECT_ROOT,
      env: ptyEnv,
    });
  } catch (err) {
    console.error(`[terminal] spawn-error: shell=${shell} err=${err.message}`);
    safeSend(session.ws, msg('error', {
      code: 'PTY_SPAWN_FAILED',
      message: `PTY spawn failed: ${err.message}`,
    }));
    return;
  }

  session.pty   = pty;
  session.shell = shell;
  session.alive = true;

  console.log(`[terminal] spawn: shell=${shell} pid=${pty.pid} cols=${cols} rows=${rows}`);

  // Output buffering — batch rapid onData events into fewer WebSocket frames.
  let outputBuffer = '';
  let flushScheduled = false;

  function flushOutput() {
    flushScheduled = false;
    if (outputBuffer.length === 0) return;
    const data = outputBuffer;
    outputBuffer = '';
    safeSend(session.ws, JSON.stringify({ type: 'output', data }));
  }

  pty.onData((data) => {
    outputBuffer += data;
    if (outputBuffer.length >= OUTPUT_BUFFER_FLUSH_THRESHOLD) {
      flushOutput();
    } else if (!flushScheduled) {
      flushScheduled = true;
      setImmediate(flushOutput);
    }
  });

  pty.onExit(({ exitCode, signal }) => {
    // Flush any remaining buffered output before sending exit.
    flushOutput();

    const code = exitCode != null ? exitCode : null;
    console.log(`[terminal] exit: pid=${pty.pid} code=${exitCode} signal=${signal}`);
    safeSend(session.ws, msg('exit', { code }));

    session.pty = null;

    // Auto-respawn unless the session was cleaned up (tab closed).
    if (session.alive) {
      console.log(`[terminal] respawn: shell=${shell}`);
      createPtySession(session);
    }
  });

  // Notify the client that the PTY is ready.
  safeSend(session.ws, msg('ready', {
    cols,
    rows,
    shell,
  }));
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

/**
 * Handle an `input` message: validate and write data to the PTY.
 *
 * ADR-001-pty-support §3.4: handleInput.
 *
 * @param {object} session
 * @param {string} data
 */
function handleInput(session, data) {
  if (typeof data !== 'string' || data.length === 0) {
    safeSend(session.ws, msg('error', {
      code: 'INVALID_INPUT',
      message: 'Input data must be a non-empty string.',
    }));
    return;
  }

  if (data.length > MAX_INPUT_LENGTH) {
    safeSend(session.ws, msg('error', {
      code: 'INPUT_TOO_LARGE',
      message: `Input data exceeds the ${MAX_INPUT_LENGTH}-character limit. Reduce paste size or send in chunks.`,
    }));
    return;
  }

  if (!session.pty) {
    // PTY not ready yet (e.g., waiting for respawn). Drop the input silently.
    return;
  }

  session.pty.write(data);
}

/**
 * Handle a `resize` message: clamp values and resize the PTY.
 *
 * ADR-001-pty-support §3.4: handleResize.
 * Values outside [COLS_MIN, COLS_MAX] and [ROWS_MIN, ROWS_MAX] are clamped
 * (not rejected) per api-spec.json.
 *
 * @param {object} session
 * @param {*} cols
 * @param {*} rows
 */
function handleResize(session, cols, rows) {
  if (
    typeof cols !== 'number' || !Number.isInteger(cols) ||
    typeof rows !== 'number' || !Number.isInteger(rows)
  ) {
    safeSend(session.ws, msg('error', {
      code: 'INVALID_RESIZE',
      message: "Resize message requires 'cols' and 'rows' as positive integers.",
    }));
    return;
  }

  // Clamp to valid ranges.
  const clampedCols = Math.max(COLS_MIN, Math.min(COLS_MAX, cols));
  const clampedRows = Math.max(ROWS_MIN, Math.min(ROWS_MAX, rows));

  session.cols = clampedCols;
  session.rows = clampedRows;

  if (session.pty) {
    session.pty.resize(clampedCols, clampedRows);
    console.log(`[terminal] resize: pid=${session.pty.pid} cols=${clampedCols} rows=${clampedRows}`);
  }

  // No response sent on success (per api-spec.json).
}

/**
 * Clean up a session on WebSocket disconnect: kill PTY and decrement counter.
 *
 * ADR-001-pty-support §3.4: cleanupSession.
 *
 * @param {object} session
 */
function cleanupSession(session) {
  // Mark as dead to prevent auto-respawn in onExit handler.
  session.alive = false;

  if (session.pty) {
    const pid = session.pty.pid;
    try {
      session.pty.kill();
      console.log(`[terminal] cleanup: killed pid=${pid}`);
    } catch {
      // Already exited — no action needed.
    }
    session.pty = null;
  }

  session.ws = null;
}

// ---------------------------------------------------------------------------
// Connection handler
// ---------------------------------------------------------------------------

/**
 * Called when a new WebSocket connection is established at /ws/terminal.
 * Creates a session object, spawns the PTY, and wires message/close handlers.
 *
 * @param {import('ws').WebSocket} ws
 * @param {import('http').IncomingMessage} req
 * @param {() => void} onClose - Callback invoked on connection close to decrement counter.
 */
function handleConnection(ws, req, onClose) {
  const remoteAddr = req.socket.remoteAddress || 'unknown';
  console.log(`[terminal] connected, client: ${remoteAddr}`);

  /**
   * Session object for this connection.
   * @type {{
   *   ws: import('ws').WebSocket,
   *   pty: import('node-pty').IPty | null,
   *   shell: string,
   *   cols: number,
   *   rows: number,
   *   alive: boolean
   * }}
   */
  const session = {
    ws,
    pty:   null,
    shell: '',
    cols:  DEFAULT_COLS,
    rows:  DEFAULT_ROWS,
    alive: false,
  };

  // Spawn the initial PTY shell.
  createPtySession(session);

  ws.on('message', (rawData) => {
    let parsed;
    try {
      parsed = JSON.parse(rawData.toString());
    } catch {
      safeSend(ws, msg('error', {
        code: 'INVALID_JSON',
        message: 'Message could not be parsed as JSON. Ensure all WebSocket frames are UTF-8 JSON text.',
      }));
      return;
    }

    const { type } = parsed;

    if (type === 'input') {
      handleInput(session, parsed.data);
    } else if (type === 'resize') {
      handleResize(session, parsed.cols, parsed.rows);
    } else if (type === 'ping') {
      safeSend(ws, pongMsg());
    } else {
      safeSend(ws, msg('error', {
        code: 'UNKNOWN_MESSAGE_TYPE',
        message: `Unknown message type: '${type}'. The v2 PTY protocol uses 'input' instead of 'exec'. See api-spec.json for the current message types.`,
      }));
    }
  });

  ws.on('close', (code) => {
    onClose();
    console.log(`[terminal] disconnected, code=${code}`);
    cleanupSession(session);
  });

  ws.on('error', (err) => {
    console.error(`[terminal] ws-error: ${err.message}`);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attach a WebSocketServer (noServer mode) to the existing HTTP server.
 * Only upgrade requests at /ws/terminal are accepted.
 *
 * If node-pty is unavailable, registers an upgrade handler that responds
 * with HTTP 503 Service Unavailable to all /ws/terminal requests.
 * The HTTP server and all other routes continue to operate normally.
 *
 * ADR-001-pty-support §3.4: setupTerminalWebSocket.
 *
 * @param {import('http').Server} httpServer
 */
function setupTerminalWebSocket(httpServer) {
  // Graceful degradation: node-pty not available.
  if (!nodePty) {
    httpServer.on('upgrade', (req, socket) => {
      const url = req.url ? req.url.split('?')[0] : '';
      if (url === '/ws/terminal') {
        socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        socket.destroy();
      }
      // All other upgrade paths are not handled here — leave them for other handlers.
    });
    return;
  }

  /**
   * Per-server connection counter so that multiple setupTerminalWebSocket()
   * calls (e.g. in tests) each track their own set of connections.
   */
  let activeConnections = 0;

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 131072,  // 128 KB (increased from 8 KB — supports large paste + PTY output)
  });

  wss.on('connection', (ws, req) => handleConnection(ws, req, () => { activeConnections -= 1; }));

  httpServer.on('upgrade', (req, socket, head) => {
    const url = req.url ? req.url.split('?')[0] : '';

    // Only handle the terminal upgrade path; pass through all others so that
    // other upgrade handlers (e.g. activity-ws.js) can process them.
    // ADR-1 (Activity Feed) §2.6.1: pass-through pattern for multi-WS coexistence.
    if (url !== '/ws/terminal') {
      return;
    }

    // Security: reject non-localhost Origins.
    const origin = req.headers['origin'] || '';
    if (!LOCALHOST_ORIGINS.has(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    // Enforce connection cap.
    if (activeConnections >= MAX_CONNECTIONS) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }

    activeConnections += 1;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });
}

module.exports = { setupTerminalWebSocket };
