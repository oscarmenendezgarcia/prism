/**
 * ThemeToggle — cycles through system -> light -> dark -> system.
 * ADR-003 §4A.5: the only new component added by the visual redesign.
 *
 * Icons (Material Symbols):
 *   system  → brightness_auto
 *   light   → light_mode
 *   dark    → dark_mode
 *
 * Pure UI component — all theme logic is delegated to useTheme hook.
 */

import React from 'react';
import { useTheme } from '@/hooks/useTheme';
import type { ThemePreference } from '@/hooks/useTheme';

const CYCLE: ThemePreference[] = ['system', 'light', 'dark'];

const ICON: Record<ThemePreference, string> = {
  system: 'brightness_auto',
  light: 'light_mode',
  dark: 'dark_mode',
};

const LABEL: Record<ThemePreference, string> = {
  system: 'Switch to light mode',
  light: 'Switch to dark mode',
  dark: 'Switch to system mode',
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  function handleClick() {
    const currentIndex = CYCLE.indexOf(theme);
    const nextIndex = (currentIndex + 1) % CYCLE.length;
    setTheme(CYCLE[nextIndex]);
  }

  return (
    <button
      onClick={handleClick}
      aria-label={LABEL[theme]}
      title={LABEL[theme]}
      className="inline-flex items-center justify-center w-9 h-10 rounded-xl text-text-secondary hover:bg-surface-variant hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 ease-apple leading-none"
    >
      <span
        className="material-symbols-outlined text-lg leading-none transition-opacity duration-150"
        aria-hidden="true"
      >
        {ICON[theme]}
      </span>
    </button>
  );
}
