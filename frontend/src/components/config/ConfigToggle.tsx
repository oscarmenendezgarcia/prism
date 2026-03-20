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
      className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-150 ease-apple ${
        configPanelOpen
          ? 'bg-primary/[0.15] text-primary'
          : 'text-text-secondary hover:bg-surface-variant hover:text-text-primary'
      }`}
    >
      <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
        settings
      </span>
    </button>
  );
}
