/**
 * FolioToggle — Header button that opens/closes the Folio panel.
 * Follows the TerminalToggle / ConfigToggle pattern.
 * Icon: "menu_book" (Material Symbols), label: "Folio".
 */

import React from 'react';
import { useAppStore } from '@/stores/useAppStore';

export function FolioToggle() {
  const folioOpen   = useAppStore((s) => s.folioOpen);
  const toggleFolio = useAppStore((s) => s.toggleFolio);

  return (
    <button
      type="button"
      onClick={toggleFolio}
      aria-label="Toggle Folio"
      aria-pressed={folioOpen}
      className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-fast ease-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        folioOpen
          ? 'bg-primary/15 text-primary'
          : 'text-text-secondary hover:text-text-primary hover:bg-surface-variant'
      }`}
    >
      <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">
        menu_book
      </span>
    </button>
  );
}
