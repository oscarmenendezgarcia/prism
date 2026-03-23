/**
 * activity-ws.js — Activity Feed WebSocket Server
 *
 * ADR-1 (Activity Feed) §Decision 1: WebSocket endpoint at /ws/activity using
 * the existing ws npm package in noServer mode, following the same pattern
 * as terminal.js.
 *
 * Protocol:
 *   Server → Client: { type: "connected", timestamp: ISO }     (on open)
 *                    { type: "activity",  event: ActivityEvent } (on mutation)
 *                    { type: "pong" }                           (response to ping)
 *   Client → Server: { type: "ping" }                          (keep-alive)
 *
 * Security:
 *   - Localhost-only origin check (LOCALHOST_ORIGINS set).
 *   - Max 10 concurrent connections; 11th gets HTTP 429.
 *   - maxPayload: 8192 bytes (events are small, < 2 KB).
 *
 * Usage (after server.listen()):
 *   const { setupActivityWebSocket } = require('./activity-ws');
 *   const { broadcast } = setupActivityWebSocket(httpServer);
 */

'use strict';

const { WebSocketServer } = require('ws');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max concurrent activity WebSocket connections. */
const MAX_CONNECTIONS = 10;

/** Max WS message payload in bytes. Activity events are small. */
const MAX_PAYLOAD = 8192;

/** Allowed Origin header values — localhost only (dev tool). */
const LOCALHOST_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',  // Vite dev server
  'http://127.0.0.1:5173',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Send a JSON payload to a WebSocket if it is open.
 * @param {import('ws').WebSocket} ws
 * @param {object} data
 */
function safeSend(ws, data) {
  if (ws && ws.readyState === ws.constructor.OPEN) {
    try {
      ws.send(JSON.stringify(data));
    } catch (err) {
      console.warn(JSON.stringify({
        timestamp: new Date().toISOString(),
        level:     'warn',
        component: 'activity-ws',
        event:     'send_error',
        error:     err.message,
      }));
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attach an Activity WebSocket server (noServer mode) to the existing HTTP server.
 * Only upgrade requests at /ws/activity are handled; all other paths are ignored
 * (passed through to other upgrade handlers).
 *
 * @param {import('http').Server} httpServer
 * @returns {{ broadcast: (event: object) => void }}
 */
function setupActivityWebSocket(httpServer) {
  let activeConnections = 0;

  /** Set of currently connected WebSocket clients. */
  const clients = new Set();

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD,
  });

  // ── Connection handler ───────────────────────────────────────────────────

  wss.on('connection', (ws, req) => {
    const remoteAddr = req.socket ? req.socket.remoteAddress : 'unknown';

    console.log(JSON.stringify({
      timestamp:  new Date().toISOString(),
      level:      'info',
      component:  'activity-ws',
      event:      'ws_connected',
      remoteAddr,
      activeConnections,
    }));

    clients.add(ws);

    // Send connected confirmation immediately.
    safeSend(ws, { type: 'connected', timestamp: new Date().toISOString() });

    ws.on('message', (rawData) => {
      let parsed;
      try {
        parsed = JSON.parse(rawData.toString());
      } catch {
        // Malformed message — ignore silently (activity WS is server-push heavy).
        return;
      }

      if (parsed.type === 'ping') {
        safeSend(ws, { type: 'pong' });
      }
      // All other client messages are ignored (no client-side filtering over WS).
    });

    ws.on('close', () => {
      clients.delete(ws);
      activeConnections -= 1;

      console.log(JSON.stringify({
        timestamp:  new Date().toISOString(),
        level:      'info',
        component:  'activity-ws',
        event:      'ws_disconnected',
        remoteAddr,
        activeConnections,
      }));
    });

    ws.on('error', (err) => {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level:     'error',
        component: 'activity-ws',
        event:     'ws_error',
        error:     err.message,
      }));
    });
  });

  // ── Upgrade handler ──────────────────────────────────────────────────────

  httpServer.on('upgrade', (req, socket, head) => {
    const url = req.url ? req.url.split('?')[0] : '';

    // Only handle /ws/activity; leave all other paths for other upgrade handlers.
    if (url !== '/ws/activity') return;

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

  // ── broadcast function ───────────────────────────────────────────────────

  /**
   * Broadcast an activity event to all currently connected clients.
   * Per-client errors are caught individually so one bad client does not
   * interrupt delivery to others.
   *
   * @param {object} event - ActivityEvent object.
   */
  function broadcast(event) {
    const message = { type: 'activity', event };

    let sent = 0;
    for (const ws of clients) {
      try {
        safeSend(ws, message);
        sent++;
      } catch (err) {
        console.warn(JSON.stringify({
          timestamp: new Date().toISOString(),
          level:     'warn',
          component: 'activity-ws',
          event:     'broadcast_client_error',
          error:     err.message,
        }));
      }
    }

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level:     'info',
      component: 'activity-ws',
      event:     'broadcast_sent',
      eventType: event.type,
      clientCount: sent,
    }));
  }

  return { broadcast };
}

module.exports = { setupActivityWebSocket };
