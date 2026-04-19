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
      className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-fast ease-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        panelOpen
          ? 'bg-primary/15 text-primary'
          : 'text-text-secondary hover:text-text-primary hover:bg-surface-variant'
      }`}
    >
      <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">
        terminal
      </span>
    </button>
  );
}
