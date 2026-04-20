/**
 * TerminalPanel — multi-tab layout shell.
 * ADR-1 (multi-tab-terminal): refactored from single-session to multi-tab.
 * Blueprint §3.5: renders tab bar + one TerminalTab per session.
 * ADR-003 §8.10: terminal.* tokens, no html.dark class dependence.
 *
 * This component is a pure layout shell — it no longer contains a useTerminal
 * call or a containerRef. Each tab's lifecycle is managed by TerminalTab.
 * Width is dynamic via usePanelResize (unchanged).
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { TerminalTab } from '@/components/terminal/TerminalTab';
import { usePanelResize } from '@/hooks/usePanelResize';
import type { TerminalStatus } from '@/types';

const statusDotClass: Record<TerminalStatus, string> = {
  connected:    'w-2 h-2 rounded-full bg-success shrink-0',
  connecting:   'w-2 h-2 rounded-full bg-warning shrink-0',
  disconnected: 'w-2 h-2 rounded-full bg-error shrink-0',
};

export function TerminalPanel() {
  const sessions    = useTerminalSessionStore((s) => s.sessions);
  const activeId    = useTerminalSessionStore((s) => s.activeId);
  const panelOpen   = useTerminalSessionStore((s) => s.panelOpen);
  const closePanel  = useTerminalSessionStore((s) => s.closePanel);
  const addSession  = useTerminalSessionStore((s) => s.addSession);
  const removeSession = useTerminalSessionStore((s) => s.removeSession);
  const setActiveId = useTerminalSessionStore((s) => s.setActiveId);
  const renameSession = useTerminalSessionStore((s) => s.renameSession);

  const { width, handleMouseDown, minWidth, maxWidth } = usePanelResize({
    storageKey:   'prism:panel-width:terminal',
    defaultWidth: 420,
    minWidth:     280,
    maxWidth:     900,
  });

  // BUG-003: set CSS custom property imperatively on the DOM node to avoid
  // style={{}} (which violates the no-inline-styles rule in CLAUDE.md).
  // The --panel-w variable is consumed by the w-[var(--panel-w)] Tailwind class.
  const asideRef = useCallback(
    (node: HTMLElement | null) => {
      if (node) node.style.setProperty('--panel-w', `${width}px`);
    },
    [width],
  );

  const activeSession = sessions.find((s) => s.id === activeId);
  const activeStatus  = activeSession?.status ?? 'disconnected';
  const reconnectAvailable = activeStatus === 'disconnected';

  // ── Inline rename state ───────────────────────────────────────────────────

  const [renamingId, setRenamingId]       = useState<string | null>(null);
  const [renameValue, setRenameValue]     = useState('');
  const renameInputRef                    = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  function startRename(id: string, currentLabel: string) {
    setRenamingId(id);
    setRenameValue(currentLabel);
  }

  function commitRename() {
    if (renamingId) {
      renameSession(renamingId, renameValue);
      setRenamingId(null);
    }
  }

  function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') setRenamingId(null);
  }

  // ── Reconnect forwarding ──────────────────────────────────────────────────
  // Reconnect is initiated by calling reconnectNow on the active TerminalTab.
  // We surface a reconnect bar when the active session is disconnected; the
  // actual reconnect is triggered by refreshing the panel (re-mounting the tab).
  // For simplicity the reconnect bar shows a message; full reconnect-now
  // forwarding would require a ref from TerminalTab, which is out of scope for
  // this layout shell (see TerminalTab for the useTerminal lifecycle).

  const atCap = sessions.length >= 4;

  return (
    <aside
      ref={asideRef}
      className={`relative flex flex-col bg-terminal-bg border-l border-border h-full shrink-0 w-[var(--panel-w)]${panelOpen ? '' : ' hidden'}`}
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
      <div className="flex items-center justify-between h-10 px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[15px] leading-none text-primary" aria-hidden="true">
            terminal
          </span>
          <span className="text-xs font-semibold text-terminal-text tracking-wide">Terminal</span>
          <div className={`${statusDotClass[activeStatus]}`} aria-label={`Session ${activeStatus}`} />
        </div>
        <button
          onClick={closePanel}
          aria-label="Close terminal panel"
          className="w-7 h-7 flex items-center justify-center rounded-md text-terminal-text/50 hover:text-terminal-text hover:bg-white/5 transition-all duration-fast"
        >
          <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">
            close
          </span>
        </button>
      </div>

      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Terminal sessions"
        className="flex items-center gap-0.5 px-2 py-1.5 bg-surface border-b border-border shrink-0 overflow-x-auto"
      >
        <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto">
          {sessions.map((session) => {
            const isActive = session.id === activeId;
            return (
              <div
                key={session.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveId(session.id)}
                className={`group/tab flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] cursor-pointer select-none min-w-0 max-w-[160px] shrink-0 transition-all duration-fast ${
                  isActive
                    ? 'bg-primary/[0.12] text-primary'
                    : 'text-terminal-text/50 hover:bg-white/5 hover:text-terminal-text/80'
                }`}
              >
                <div className={statusDotClass[session.status]} />

                {renamingId === session.id ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={handleRenameKeyDown}
                    className="bg-transparent border-b border-primary outline-hidden text-[11px] text-terminal-text w-20 min-w-0"
                    maxLength={24}
                    aria-label="Rename session"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => { e.stopPropagation(); startRename(session.id, session.label); }}
                    className="truncate"
                    title={session.label}
                  >
                    {session.label}
                  </span>
                )}

                {sessions.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeSession(session.id); }}
                    aria-label={`Close ${session.label}`}
                    className="ml-1 shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded opacity-0 group-hover/tab:opacity-100 hover:bg-white/10 text-terminal-text/60 hover:text-terminal-text transition-all duration-fast"
                  >
                    <span className="material-symbols-outlined text-[11px] leading-none" aria-hidden="true">close</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Trailing add button */}
        <div className="flex items-center pl-1 border-l border-border shrink-0">
          <button
            onClick={() => !atCap && addSession()}
            disabled={atCap}
            aria-disabled={atCap}
            aria-label="Add terminal tab"
            title={atCap ? 'Maximum 4 tabs open' : 'New terminal tab'}
            className={`w-6 h-6 flex items-center justify-center rounded-md transition-all duration-fast ${
              atCap ? 'text-terminal-text/15 cursor-not-allowed' : 'text-terminal-text/40 hover:bg-white/5 hover:text-terminal-text/70 cursor-pointer'
            }`}
          >
            <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">add</span>
          </button>
        </div>
      </div>

      {/* Reconnect bar */}
      {reconnectAvailable && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-warning/[0.06] border-b border-warning/20 shrink-0">
          <span className="material-symbols-outlined text-[13px] leading-none text-warning" aria-hidden="true">
            wifi_off
          </span>
          <span className="text-[11px] text-warning font-medium">
            Session disconnected — reconnecting automatically…
          </span>
        </div>
      )}

      {/* One TerminalTab per session — all mounted, only active one is visible */}
      {/* terminal-glow: inset violet shimmer from Stitch S-09 */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden shadow-[inset_0_0_40px_rgba(124,109,250,0.03)]">
        {sessions.map((session) => (
          <TerminalTab
            key={session.id}
            sessionId={session.id}
            panelOpen={panelOpen}
            isActive={session.id === activeId}
          />
        ))}
      </div>
    </aside>
  );
}
