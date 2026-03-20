/**
 * Terminal toggle button in the header.
 * ADR-002: replaces #terminal-toggle-btn in legacy index.html.
 * ADR-003 §8 T-016: replace hover:bg-[#e8eaed] with hover:bg-surface token.
 */

import React from 'react';
import { useAppStore } from '@/stores/useAppStore';

export function TerminalToggle() {
  const terminalOpen = useAppStore((s) => s.terminalOpen);
  const toggleTerminal = useAppStore((s) => s.toggleTerminal);

  return (
    <button
      onClick={toggleTerminal}
      aria-label="Toggle terminal panel"
      aria-pressed={terminalOpen}
      className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-150 ease-apple ${
        terminalOpen
          ? 'bg-primary/[0.15] text-primary'
          : 'text-text-secondary hover:bg-surface-variant hover:text-text-primary'
      }`}
    >
      <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
        terminal
      </span>
    </button>
  );
}
