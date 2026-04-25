/**
 * ColorPicker — 16-swatch palette selector
 * ADR-1 (agent-personalities): shows the frozen CURATED_PALETTE and calls
 * onChange with the selected hex string.
 */

import React from 'react';

export const CURATED_PALETTE = [
  '#7C3AED', '#2563EB', '#0EA5E9', '#0D9488', // lint-ok: palette swatches are the feature itself — they cannot be design tokens
  '#16A34A', '#65A30D', '#CA8A04', '#EA580C', // lint-ok: palette swatches are the feature itself — they cannot be design tokens
  '#DC2626', '#DB2777', '#9333EA', '#475569', // lint-ok: palette swatches are the feature itself — they cannot be design tokens
  '#0F766E', '#1D4ED8', '#A16207', '#BE123C', // lint-ok: palette swatches are the feature itself — they cannot be design tokens
] as const;

export type PaletteColor = typeof CURATED_PALETTE[number];

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  /** Disable all swatches (e.g. while saving). */
  disabled?: boolean;
}

export function ColorPicker({ value, onChange, disabled = false }: ColorPickerProps) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Agent color palette">
      {CURATED_PALETTE.map((color) => {
        const isSelected = value.toUpperCase() === color.toUpperCase();
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={`Color ${color}`}
            title={color}
            disabled={disabled}
            onClick={() => onChange(color)}
            className={[
              'w-7 h-7 rounded-md transition-all duration-fast focus:outline-none',
              'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary',
              isSelected ? 'ring-2 ring-offset-2 ring-white scale-110' : 'hover:scale-105',
              disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
            ].filter(Boolean).join(' ')}
            style={{ backgroundColor: color }} // lint-ok: dynamic swatch color cannot be a Tailwind token — it renders one of 16 user-selected hex values
          >
            {isSelected && (
              <span className="flex items-center justify-center w-full h-full">
                <span className="material-symbols-outlined text-white text-[14px] leading-none" aria-hidden="true">
                  check
                </span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
