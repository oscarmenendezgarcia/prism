/**
 * Terminal toggle button in the header.
 * ADR-002: replaces #terminal-toggle-btn in legacy index.html.
 * ADR-003 §8 T-016: replace hover:bg-[#e8eaed] with hover:bg-surface token.
 * ADR-1 (multi-tab-terminal): reads panelOpen from useTerminalSessionStore.
 */

import React from 'react';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';

export function TerminalToggle() {
  const panelOpen    = useTerminalSessionStore((s) => s.panelOpen);
  const togglePanel  = useTerminalSessionStore((s) => s.togglePanel);

  return (
    <button
      onClick={togglePanel}
      aria-label="Toggle terminal panel"
      aria-pressed={panelOpen}
      className={`h-10 min-w-[72px] px-3 flex flex-col items-center justify-center gap-0.5 rounded-lg transition-all duration-150 ease-apple ${
        panelOpen
          ? 'bg-primary/[0.15] text-primary'
          : 'text-text-secondary hover:bg-surface-variant hover:text-text-primary'
      }`}
    >
      <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
        terminal
      </span>
      <span className="hidden sm:block text-[10px] font-medium leading-none">Terminal</span>
    </button>
  );
}
