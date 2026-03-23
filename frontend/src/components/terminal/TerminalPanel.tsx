/**
 * Terminal panel — xterm.js mount point with header, status, reconnect bar, and close button.
 * ADR-002: replaces the #terminal-panel aside in legacy index.html + terminal.js.
 * ADR-003 §8.10: replace all hardcoded border-[#333] / bg-[#252525] / hover:bg-[#333]
 *   with token-based classes. Terminal is always dark — static terminal.* tokens, no
 *   html.dark class dependence.
 * Width is now dynamic via usePanelResize (was fixed w-terminal / 420px).
 */

import React, { useState, useEffect } from 'react';
import '@xterm/xterm/css/xterm.css';
import { useTerminal } from '@/hooks/useTerminal';
import { useAppStore } from '@/stores/useAppStore';
import { usePanelResize } from '@/hooks/usePanelResize';
import type { TerminalStatus } from '@/types';

const statusDotClass: Record<TerminalStatus, string> = {
  connected:    'w-2 h-2 rounded-full bg-success',
  connecting:   'w-2 h-2 rounded-full bg-warning',
  disconnected: 'w-2 h-2 rounded-full bg-error',
};

const statusLabelClass: Record<TerminalStatus, string> = {
  connected:    'text-xs text-success',
  connecting:   'text-xs text-warning',
  disconnected: 'text-xs text-error',
};

const statusLabelText: Record<TerminalStatus, string> = {
  connected:    'Connected',
  connecting:   'Connecting...',
  disconnected: 'Disconnected',
};

export function TerminalPanel() {
  const setTerminalOpen    = useAppStore((s) => s.setTerminalOpen);
  const terminalOpen       = useAppStore((s) => s.terminalOpen);
  const setTerminalSender  = useAppStore((s) => s.setTerminalSender);

  const [status, setStatus]                     = useState<TerminalStatus>('connecting');
  const [reconnectAvailable, setReconnectAvail] = useState(false);
  const [_countdownSecs, setCountdownSecs]      = useState(0);

  const { width, handleMouseDown, minWidth, maxWidth } = usePanelResize({
    storageKey:   'prism:panel-width:terminal',
    defaultWidth: 420,
    minWidth:     280,
    maxWidth:     900,
  });

  const { containerRef, reconnectNow, sendInput } = useTerminal({
    panelOpen: terminalOpen,
    onStatusChange: (s: TerminalStatus) => {
      setStatus(s);
      // Register/deregister the terminal sender bridge as connection state changes.
      // This allows the agent launcher store to inject commands via sendInput.
      if (s === 'connected') {
        setTerminalSender(sendInput);
      } else {
        setTerminalSender(null);
      }
    },
    onReconnectAvailable: setReconnectAvail,
    onReconnectCountdown: setCountdownSecs,
  });

  // Clear terminal sender on unmount so stale references don't linger.
  useEffect(() => {
    return () => {
      setTerminalSender(null);
    };
  }, [setTerminalSender]);

  function closePanel() {
    setTerminalOpen(false);
  }

  return (
    <aside
      className="relative flex flex-col bg-terminal-bg border-l border-[rgba(255,255,255,0.08)] h-full shrink-0 w-[var(--panel-w)]"
      style={{ '--panel-w': `${width}px` } as React.CSSProperties}
      aria-label="Embedded terminal"
    >
      {/* Left-edge drag handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize terminal panel"
        aria-valuenow={width}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        onMouseDown={handleMouseDown}
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/40 transition-colors duration-150 z-10"
      />
      {/* Terminal header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[rgba(255,255,255,0.08)] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-terminal-text">Terminal</span>
          <div className="flex items-center gap-1.5">
            <div className={statusDotClass[status]} />
            <span className={statusLabelClass[status]}>{statusLabelText[status]}</span>
          </div>
        </div>
        <button
          onClick={closePanel}
          aria-label="Close terminal panel"
          className="w-7 h-7 flex items-center justify-center rounded text-terminal-text hover:bg-[rgba(255,255,255,0.08)] transition-colors duration-150"
        >
          <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
            close
          </span>
        </button>
      </div>

      {/* Reconnect bar */}
      {reconnectAvailable && (
        <div className="px-3 py-1.5 bg-[rgba(255,255,255,0.05)] border-b border-[rgba(255,255,255,0.08)] shrink-0">
          <button
            onClick={reconnectNow}
            aria-label="Reconnect now"
            className="text-xs text-warning hover:text-white transition-colors duration-150"
          >
            Reconnect now
          </button>
        </div>
      )}

      {/* xterm.js container */}
      <div
        ref={containerRef as React.RefObject<HTMLDivElement>}
        className="flex-1 overflow-hidden p-2 min-h-0"
      />
    </aside>
  );
}
