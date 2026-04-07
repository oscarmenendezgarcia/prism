/**
 * Run History panel toggle button — displayed in the Header panel-toggle strip.
 * ADR-1 (Agent Run History) §6.4: mirrors TerminalToggle and ConfigToggle pattern.
 *
 * Uses the "history" Material Symbol icon.
 * Active state when historyPanelOpen is true.
 */

import React from 'react';
import { useRunHistoryStore, useHistoryPanelOpen } from '@/stores/useRunHistoryStore';

/**
 * Icon button that opens/closes the Run History panel.
 * Follows the exact same structure as TerminalToggle and ConfigToggle.
 */
export function RunHistoryToggle() {
  const historyPanelOpen = useHistoryPanelOpen();
  const toggleHistoryPanel = useRunHistoryStore((s) => s.toggleHistoryPanel);

  return (
    <button
      onClick={toggleHistoryPanel}
      aria-label="Toggle run history panel"
      aria-pressed={historyPanelOpen}
      className={`h-10 min-w-[72px] px-3 flex flex-col items-center justify-center gap-0.5 rounded-lg transition-all duration-150 ease-apple focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/50 ${
        historyPanelOpen
          ? 'bg-primary/[0.15] text-primary border border-primary/30'
          : 'text-text-secondary bg-white/[0.04] border border-white/[0.08] hover:bg-surface-variant hover:text-text-primary'
      }`}
    >
      <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
        history
      </span>
      <span className="hidden sm:block text-[10px] font-medium leading-none">History</span>
    </button>
  );
}
