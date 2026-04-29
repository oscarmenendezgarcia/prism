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
  : new Set(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173']);

/** Default PTY dimensions used until the client sends a resize message. */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/** PTY output buffer flush threshold in bytes (4 KB). */
const OUTPUT_BUFFER_FLUSH_THRESHOLD = 4096;

/** Per-session ring buffer capacity in bytes (default 512 KB). */
const OUTPUT_RING_BUFFER_BYTES = parseInt(
  process.env.TERMINAL_OUTPUT_RING_BUFFER_BYTES, 10
) || 512 * 1024;

/** WS backpressure high-water mark: pause PTY when ws.bufferedAmount exceeds this. */
const WS_BACKPRESSURE_HIGH_WATERMARK = 1024 * 1024;   // 1 MB

/** WS backpressure low-water mark: resume PTY when ws.bufferedAmount drops below this. */
const WS_BACKPRESSURE_LOW_WATERMARK = 256 * 1024;     // 256 KB

/** Interval between bufferedAmount checks while a session is paused (ms). */
const BACKPRESSURE_POLL_INTERVAL_MS = 50;

/** Maximum input data length in characters (per api-spec.json). */
const MAX_INPUT_LENGTH = 4096;

/** Valid column range per api-spec.json (clamped, not rejected). */
const COLS_MIN = 1;
const COLS_MAX = 500;

/** Valid row range per api-spec.json (clamped, not rejected). */
const ROWS_MIN = 1;
const ROWS_MAX = 200;

// ---------------------------------------------------------------------------
// OutputRingBuffer — bounded per-session output buffer (T-001)
// ---------------------------------------------------------------------------

/**
 * A fixed-capacity circular byte buffer that retains the most-recent `capacity`
 * bytes of PTY output. When new data would exceed the cap, the oldest bytes are
 * silently discarded and a `trimmedSinceLastDrain` flag is set.
 *
 * Pre-allocates a single `Buffer.allocUnsafe(capacity)` per instance — no
 * per-chunk allocation.
 *
 * @internal — not part of the public module API; exported only for testing.
 */
class OutputRingBuffer {
  /**
   * @param {number} capacity - Maximum bytes to store. Must be > 0.
   */
  constructor(capacity) {
    this.capacity = capacity;
    this.buf = Buffer.allocUnsafe(capacity);
    /** Number of valid bytes currently stored (0 ≤ size ≤ capacity). */
    this.size = 0;
    /** Index of the next byte to write (wraps modulo capacity). */
    this.head = 0;
    /** True when at least one byte was dropped since the last drain(). */
    this.trimmedSinceLastDrain = false;
    /** Total bytes dropped since the last drain() — for logging only. */
    this.bytesDroppedSinceLastDrain = 0;
  }

  /**
   * Append `chunk` bytes to the ring. If appending would exceed capacity, the
   * oldest bytes are discarded. O(chunk.length) — no reallocation.
   *
   * @param {Buffer|string} chunk
   */
  append(chunk) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const n = data.length;
    if (n === 0) return;

    if (n > this.capacity) {
      // Incoming chunk alone exceeds capacity: keep only the last `capacity`
      // bytes of the chunk and discard everything already stored.
      this.bytesDroppedSinceLastDrain += this.size + (n - this.capacity);
      this.trimmedSinceLastDrain = true;
      data.copy(this.buf, 0, n - this.capacity, n);
      this.head = 0;
      this.size = this.capacity;
      return;
    }

    if (this.size + n > this.capacity) {
      // Partial overflow: evict the oldest bytes to make room.
      const overflow = this.size + n - this.capacity;
      this.bytesDroppedSinceLastDrain += overflow;
      this.trimmedSinceLastDrain = true;
      this.size -= overflow;
    }

    // Write n bytes at head, splitting across the wrap boundary if needed.
    const part1Len = Math.min(n, this.capacity - this.head);
    data.copy(this.buf, this.head, 0, part1Len);
    if (part1Len < n) {
      data.copy(this.buf, 0, part1Len, n);
    }
    this.head = (this.head + n) % this.capacity;
    this.size += n;
  }

  /**
   * Return all buffered bytes as a UTF-8 string in chronological order, then
   * reset the buffer to empty.
   *
   * @returns {{ data: string, trimmed: boolean, dropped: number }}
   */
  drain() {
    if (this.size === 0 && !this.trimmedSinceLastDrain) {
      return { data: '', trimmed: false, dropped: 0 };
    }

    let data = '';
    if (this.size > 0) {
      const tail = (this.head - this.size + this.capacity) % this.capacity;
      if (tail + this.size <= this.capacity) {
        // Contiguous region: [tail .. tail+size-1]
        data = this.buf.slice(tail, tail + this.size).toString('utf8');
      } else {
        // Wrapped: [tail .. capacity-1] ++ [0 .. head-1]
        data = Buffer.concat([
          this.buf.slice(tail, this.capacity),
          this.buf.slice(0, this.head),
        ]).toString('utf8');
      }
    }

    const trimmed = this.trimmedSinceLastDrain;
    const dropped = this.bytesDroppedSinceLastDrain;

    // Reset state.
    this.size = 0;
    this.head = 0;
    this.trimmedSinceLastDrain = false;
    this.bytesDroppedSinceLastDrain = 0;

    return { data, trimmed, dropped };
  }
}

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
// Backpressure controller (T-003)
// ---------------------------------------------------------------------------

/**
 * Inspect the WebSocket's internal send queue after a flush. If the queue has
 * grown past WS_BACKPRESSURE_HIGH_WATERMARK, pause the PTY so the shell stops
 * producing data. A polling interval resumes the PTY once the queue drains
 * below WS_BACKPRESSURE_LOW_WATERMARK.
 *
 * This protects against slow consumers (e.g. paused tabs) that cannot drain
 * ws.bufferedAmount fast enough. The ring buffer caps the server-side string
 * storage; this function caps the ws internal queue.
 *
 * @param {object} session - The active session object.
 * @internal — exported as `_checkBackpressure` for testing only.
 */
function checkBackpressure(session) {
  if (!session.ws || !session.pty || !session.alive || session.paused) return;

  const bufferedAmount = session.ws.bufferedAmount !== undefined
    ? session.ws.bufferedAmount
    : 0;

  if (bufferedAmount < WS_BACKPRESSURE_HIGH_WATERMARK) return;

  try {
    session.pty.pause();
  } catch (e) {
    // node-pty version may not support pause/resume — log once and skip.
    if (!session._backpressureWarnEmitted) {
      console.warn(
        `[terminal] backpressure: pid=${session.pty.pid} pause/resume not supported: ${e.message}`
      );
      session._backpressureWarnEmitted = true;
    }
    return;
  }

  session.paused = true;
  console.log(
    `[terminal] backpressure: pid=${session.pty.pid} event=paused bufferedAmount=${bufferedAmount}`
  );

  session.backpressureTimer = setInterval(() => {
    // Session may have been cleaned up while we were polling.
    if (!session.ws || !session.alive) {
      clearInterval(session.backpressureTimer);
      session.backpressureTimer = null;
      session.paused = false;
      return;
    }

    const current = session.ws.bufferedAmount !== undefined
      ? session.ws.bufferedAmount
      : 0;

    if (current <= WS_BACKPRESSURE_LOW_WATERMARK) {
      clearInterval(session.backpressureTimer);
      session.backpressureTimer = null;

      try {
        session.pty.resume();
      } catch {
        // Already cleaned up or not supported — ignore.
      }

      session.paused = false;
      console.log(
        `[terminal] backpressure: pid=${session.pty.pid} event=resumed bufferedAmount=${current}`
      );
    }
  }, BACKPRESSURE_POLL_INTERVAL_MS);
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
  // Uses the session's ring buffer (session.ring) to cap memory per session.
  let flushScheduled = false;

  function flushOutput() {
    flushScheduled = false;
    const { data, trimmed, dropped } = session.ring.drain();
    if (data.length === 0 && !trimmed) return;

    let payload = data;
    if (trimmed) {
      payload = '\r\n--- older output trimmed ---\r\n' + data;
      console.log(`[terminal] trim: pid=${pty.pid} dropped=${dropped} bytes`);
    }
    safeSend(session.ws, JSON.stringify({ type: 'output', data: payload }));
    checkBackpressure(session);
  }

  pty.onData((data) => {
    session.ring.append(data);
    if (session.ring.size >= OUTPUT_BUFFER_FLUSH_THRESHOLD) {
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

  // Clear any active backpressure polling timer.
  if (session.backpressureTimer) {
    clearInterval(session.backpressureTimer);
    session.backpressureTimer = null;
  }

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
    /** Bounded output ring buffer — persists across auto-respawns. */
    ring:  new OutputRingBuffer(OUTPUT_RING_BUFFER_BYTES),
    /** True while PTY is paused waiting for ws.bufferedAmount to drain. */
    paused: false,
    /** setInterval handle for bufferedAmount polling; null when idle. */
    backpressureTimer: null,
    /** Set to true once a pause/resume-not-supported warning has been logged. */
    _backpressureWarnEmitted: false,
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

/**
 * Test-only helper: drain `session.ring` and send an `output` message exactly
 * as the production `flushOutput` closure would. Allows unit tests to verify
 * sentinel emission without a real PTY or WebSocket server.
 *
 * @param {object} session - A mock session with .ring, .ws, .pty, .alive, etc.
 * @param {number} [pid=0] - PTY pid used in log messages.
 * @returns {{ payload: string, trimmed: boolean, dropped: number } | null}
 * @internal — exported for unit testing only.
 */
function flushOutputForTesting(session, pid = 0) {
  const { data, trimmed, dropped } = session.ring.drain();
  if (data.length === 0 && !trimmed) return null;
  let payload = data;
  if (trimmed) {
    payload = '\r\n--- older output trimmed ---\r\n' + data;
    console.log(`[terminal] trim: pid=${pid} dropped=${dropped} bytes`);
  }
  safeSend(session.ws, JSON.stringify({ type: 'output', data: payload }));
  checkBackpressure(session);
  return { payload, trimmed, dropped };
}

module.exports = {
  setupTerminalWebSocket,
  MAX_CONNECTIONS,
  // @internal — exported for unit testing only; not part of the public API.
  _OutputRingBuffer: OutputRingBuffer,
  _checkBackpressure: checkBackpressure,
  _flushOutputForTesting: flushOutputForTesting,
  _constants: {
    OUTPUT_RING_BUFFER_BYTES,
    WS_BACKPRESSURE_HIGH_WATERMARK,
    WS_BACKPRESSURE_LOW_WATERMARK,
    BACKPRESSURE_POLL_INTERVAL_MS,
  },
};
