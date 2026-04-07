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
      className={`h-10 min-w-[72px] px-3 flex flex-col items-center justify-center gap-0.5 rounded-lg transition-all duration-150 ease-apple focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/50 ${
        configPanelOpen
          ? 'bg-primary/[0.15] text-primary border border-primary/30'
          : 'text-text-secondary bg-white/[0.04] border border-white/[0.08] hover:bg-surface-variant hover:text-text-primary'
      }`}
    >
      <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
        settings
      </span>
      <span className="hidden sm:block text-[10px] font-medium leading-none">Config</span>
    </button>
  );
}
