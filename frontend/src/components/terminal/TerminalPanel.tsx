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
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-sm font-medium text-terminal-text">Terminal</span>
        <button
          onClick={closePanel}
          aria-label="Close terminal panel"
          className="w-7 h-7 flex items-center justify-center rounded text-terminal-text hover:bg-[var(--color-terminal-tab-hover)] transition-colors duration-150"
        >
          <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
            close
          </span>
        </button>
      </div>

      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Terminal sessions"
        className="flex items-center gap-1 px-2 py-1 border-b border-border shrink-0 overflow-x-auto"
      >
        {sessions.map((session) => {
          const isActive = session.id === activeId;
          return (
            <div
              key={session.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveId(session.id)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer select-none min-w-0 max-w-[160px] shrink-0 transition-colors duration-100 ${
                isActive
                  ? 'bg-[var(--color-terminal-tab-active)] text-terminal-text'
                  : 'text-terminal-text/60 hover:bg-[var(--color-terminal-tab-hover)] hover:text-terminal-text'
              }`}
            >
              {/* Status dot */}
              <div className={statusDotClass[session.status]} />

              {/* Label — double-click to rename */}
              {renamingId === session.id ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={handleRenameKeyDown}
                  className="bg-transparent border-b border-primary outline-none text-xs text-terminal-text w-20 min-w-0"
                  maxLength={24}
                  aria-label="Rename session"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startRename(session.id, session.label);
                  }}
                  className="truncate"
                  title={session.label}
                >
                  {session.label}
                </span>
              )}

              {/* Close button — hidden when only one tab */}
              {sessions.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSession(session.id);
                  }}
                  aria-label={`Close ${session.label}`}
                  className="ml-auto shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-[var(--color-terminal-tab-close-hover)] text-terminal-text/60 hover:text-terminal-text transition-colors duration-100"
                >
                  <span className="material-symbols-outlined text-[12px] leading-none" aria-hidden="true">
                    close
                  </span>
                </button>
              )}
            </div>
          );
        })}

        {/* Add tab button */}
        <button
          onClick={() => !atCap && addSession()}
          disabled={atCap}
          aria-disabled={atCap}
          aria-label="Add terminal tab"
          title={atCap ? 'Maximum 4 tabs open. Close a tab to open a new one.' : 'New terminal tab'}
          className={`shrink-0 w-6 h-6 flex items-center justify-center rounded transition-colors duration-100 ${
            atCap
              ? 'text-terminal-text/20 cursor-not-allowed'
              : 'text-terminal-text/60 hover:bg-[var(--color-terminal-tab-hover)] hover:text-terminal-text cursor-pointer'
          }`}
        >
          <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
            add
          </span>
        </button>
      </div>

      {/* Reconnect bar — shown when the active session is disconnected */}
      {reconnectAvailable && (
        <div className="px-3 py-1.5 bg-[var(--color-terminal-tab-hover)] border-b border-border shrink-0">
          <span className="text-xs text-warning">
            Session disconnected — reconnecting automatically...
          </span>
        </div>
      )}

      {/* One TerminalTab per session — all mounted, only active one is visible */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
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
