/**
 * TerminalTab — one xterm.js instance for a single PTY session.
 * ADR-1 (multi-tab-terminal): mounts a dedicated useTerminal hook per session.
 * Each tab connects via /ws/terminal?sessionId=<id> — the server creates one PTY
 * per WebSocket connection. The sessionId is a client-side routing token only.
 *
 * Visibility is controlled entirely by the `isActive` prop (CSS hidden class),
 * so all tabs stay mounted simultaneously and preserve their scrollback buffers.
 */

import React, { useRef, useLayoutEffect, useCallback } from 'react';
import '@xterm/xterm/css/xterm.css';
import { useTerminal } from '@/hooks/useTerminal';
import { useTheme } from '@/hooks/useTheme';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { useAppStore } from '@/stores/useAppStore';
import type { TerminalStatus } from '@/types';

interface TerminalTabProps {
  /** The session UUID — used as ?sessionId= in the WebSocket URL. */
  sessionId: string;
  /** Whether the entire terminal panel is visible (controls xterm.js lazy init). */
  panelOpen: boolean;
  /** Whether this tab is the currently selected one. Controls CSS visibility. */
  isActive: boolean;
}

const WS_BASE = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/terminal`;

export function TerminalTab({ sessionId, panelOpen, isActive }: TerminalTabProps) {
  const { resolvedTheme } = useTheme();

  // Stable ref to the sendInput function — updated each render via layout effect.
  // This allows onStatusChange (a callback capture) to always close over the
  // latest version without being recreated on every render.
  const sendInputRef = useRef<(data: string) => boolean>(() => false);

  const handleStatusChange = useCallback(
    (status: TerminalStatus) => {
      const { updateStatus, registerSender } = useTerminalSessionStore.getState();
      updateStatus(sessionId, status);
      if (status === 'connected') {
        registerSender(sessionId, sendInputRef.current);
      } else {
        registerSender(sessionId, null);
      }
    },
    [sessionId],
  );

  const handleProcessExit = useCallback(() => {
    // Mirror the original TerminalPanel behaviour: clear the active agent run
    // when the PTY shell exits.
    useAppStore.getState().clearActiveRun();
  }, []);

  const { containerRef, sendInput } = useTerminal({
    panelOpen,
    wsUrl: `${WS_BASE}?sessionId=${sessionId}`,
    onStatusChange: handleStatusChange,
    onReconnectAvailable: () => {
      // Reconnect availability is surfaced at the TerminalPanel level by reading
      // the active session's status from useTerminalSessionStore.
    },
    onReconnectCountdown: () => {
      // Countdown display is delegated to TerminalPanel.
    },
    onProcessExit: handleProcessExit,
    resolvedTheme,
  });

  // Keep sendInputRef in sync so that handleStatusChange always registers the
  // current sendInput even if React re-renders between connection events.
  useLayoutEffect(() => {
    sendInputRef.current = sendInput;
  });

  return (
    <div
      ref={containerRef as React.RefObject<HTMLDivElement>}
      className={isActive ? 'flex-1 overflow-hidden p-2 min-h-0' : 'hidden'}
    />
  );
}
