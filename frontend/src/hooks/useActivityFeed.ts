/**
 * useActivityFeed — manages the /ws/activity WebSocket connection lifecycle.
 *
 * ADR-1 (Activity Feed): real-time event push via WebSocket.
 *
 * Responsibilities:
 * - Connect to /ws/activity on mount (proxied through Vite in dev).
 * - Auto-reconnect with exponential backoff: 1 → 2 → 4 → 8 → 16 → 30s cap.
 * - Parse incoming 'activity' messages and push to Zustand store.
 * - Send a ping every 30 seconds to keep the connection alive.
 * - Clean up on unmount (close socket, clear timers).
 *
 * Design note: the WebSocket URL is constructed relative to the current host so
 * the same code works in production (port 3000) and through the Vite dev proxy
 * (port 5173). The existing Vite proxy entry '/ws' is a prefix match that covers
 * '/ws/activity', so no additional proxy config is needed (T-013 verified).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import type { ActivityEvent, ActivityStatus } from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS_PATH         = '/ws/activity';
const PING_INTERVAL   = 30_000;  // ms between keep-alive pings
const BACKOFF_INITIAL = 1_000;   // ms — first retry delay
const BACKOFF_MAX     = 30_000;  // ms — backoff ceiling

// ---------------------------------------------------------------------------
// Helper — build WebSocket URL relative to the current host
// ---------------------------------------------------------------------------

function buildWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${WS_PATH}`;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UseActivityFeedReturn {
  /** Current WebSocket connection status. */
  status: ActivityStatus;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

/**
 * Mount once in AppContent so events accumulate regardless of panel visibility.
 * Returns the live connection status for display in UI indicators.
 */
export function useActivityFeed(): UseActivityFeedReturn {
  const addActivityEvent = useAppStore((s) => s.addActivityEvent);

  const [status, setStatus] = useState<ActivityStatus>('disconnected');

  // Mutable refs — never trigger re-renders.
  const wsRef          = useRef<WebSocket | null>(null);
  const backoffRef     = useRef<number>(BACKOFF_INITIAL);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer      = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmountedRef   = useRef<boolean>(false);

  // ---------------------------------------------------------------------------
  // Ping helpers
  // ---------------------------------------------------------------------------

  const stopPing = useCallback((): void => {
    if (pingTimer.current !== null) {
      clearInterval(pingTimer.current);
      pingTimer.current = null;
    }
  }, []);

  const startPing = useCallback((ws: WebSocket): void => {
    stopPing();
    pingTimer.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, PING_INTERVAL);
  }, [stopPing]);

  // ---------------------------------------------------------------------------
  // Connect (defined via ref so it can self-reference in onclose without
  // recreating on every render — the stable ref breaks the dependency cycle).
  // ---------------------------------------------------------------------------

  const connectRef = useRef<() => void>(() => { /* filled in below */ });

  const connect = useCallback((): void => {
    if (unmountedRef.current) return;

    if (reconnectTimer.current !== null) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }

    const ws = new WebSocket(buildWsUrl());
    wsRef.current = ws;
    setStatus('connecting');

    ws.onopen = (): void => {
      if (unmountedRef.current) { ws.close(); return; }
      backoffRef.current = BACKOFF_INITIAL; // reset on successful connection
      setStatus('connected');
      startPing(ws);
    };

    ws.onmessage = (event: MessageEvent): void => {
      if (unmountedRef.current) return;
      let msg: { type: string; event?: ActivityEvent };
      try {
        msg = JSON.parse(event.data as string) as { type: string; event?: ActivityEvent };
      } catch {
        return; // ignore unparseable frames
      }
      if (msg.type === 'activity' && msg.event) {
        addActivityEvent(msg.event);
      }
      // 'connected' and 'pong' frames are informational — no store action.
    };

    ws.onerror = (): void => {
      // onerror always precedes onclose; close handler schedules reconnect.
    };

    ws.onclose = (): void => {
      stopPing();
      wsRef.current = null;
      if (unmountedRef.current) return;

      setStatus('disconnected');

      // Exponential backoff — double until BACKOFF_MAX, then hold.
      const delay        = backoffRef.current;
      backoffRef.current = Math.min(delay * 2, BACKOFF_MAX);

      reconnectTimer.current = setTimeout((): void => {
        reconnectTimer.current = null;
        connectRef.current();
      }, delay);
    };
  }, [addActivityEvent, startPing, stopPing]);

  // Keep the ref in sync with the stable callback.
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // ---------------------------------------------------------------------------
  // Mount / unmount lifecycle
  // ---------------------------------------------------------------------------

  useEffect(() => {
    unmountedRef.current = false;
    connect();

    return (): void => {
      unmountedRef.current = true;

      stopPing();

      if (reconnectTimer.current !== null) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }

      if (wsRef.current) {
        // Null out onclose before closing to prevent a spurious reconnect attempt.
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  // connect and stopPing are stable (useCallback with stable deps).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status };
}
