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
      className={`h-10 min-w-[72px] px-3 flex flex-col items-center justify-center gap-0.5 rounded-lg transition-all duration-150 ease-apple ${
        historyPanelOpen
          ? 'bg-primary/[0.15] text-primary'
          : 'text-text-secondary hover:bg-surface-variant hover:text-text-primary'
      }`}
    >
      <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
        history
      </span>
    </button>
  );
}
