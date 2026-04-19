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
      className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-fast ease-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        historyPanelOpen
          ? 'bg-primary/15 text-primary'
          : 'text-text-secondary hover:text-text-primary hover:bg-surface-variant'
      }`}
    >
      <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">
        history
      </span>
    </button>
  );
}
