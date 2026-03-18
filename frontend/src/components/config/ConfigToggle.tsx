/**
 * Config panel toggle button in the header.
 * ADR-1 (Config Editor Panel): follows the exact TerminalToggle pattern.
 * Placement: between ThemeToggle and TerminalToggle (T-006).
 */

import React from 'react';
import { useAppStore } from '@/stores/useAppStore';

export function ConfigToggle() {
  const configPanelOpen  = useAppStore((s) => s.configPanelOpen);
  const toggleConfigPanel = useAppStore((s) => s.toggleConfigPanel);

  return (
    <button
      onClick={toggleConfigPanel}
      aria-label="Toggle configuration editor"
      aria-pressed={configPanelOpen}
      className={`w-10 h-10 flex items-center justify-center rounded-2xl transition-all duration-150 ease-apple ${
        configPanelOpen
          ? 'bg-primary/[0.15] text-primary'
          : 'bg-white/5 text-text-secondary hover:bg-white/10'
      }`}
    >
      <span className="material-symbols-outlined text-xl leading-none" aria-hidden="true">
        settings
      </span>
    </button>
  );
}
