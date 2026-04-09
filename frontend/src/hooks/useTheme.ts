/**
 * useTheme — manages dark/light/system theme preference.
 * ADR-003: theme infrastructure for the Apple-inspired dual dark/light redesign.
 *
 * Behavior:
 *  - Reads 'prism-theme' from localStorage on mount. Defaults to 'system'.
 *  - 'system' follows prefers-color-scheme and responds to OS changes in real time.
 *  - 'dark' | 'light' are manual overrides that persist across reloads.
 *  - Applies/removes the 'dark' class on document.documentElement synchronously.
 *  - Cleans up matchMedia listener on unmount.
 *
 * Returns: { theme, resolvedTheme, setTheme }
 */

import { useState, useEffect, useCallback } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'prism-theme';

function getMediaQuery(): MediaQueryList {
  return window.matchMedia('(prefers-color-scheme: dark)');
}

function applyTheme(resolved: ResolvedTheme): void {
  if (resolved === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'dark') return 'dark';
  if (preference === 'light') return 'light';
  return getMediaQuery().matches ? 'dark' : 'light';
}

function readStoredTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light' || stored === 'system') {
      return stored;
    }
  } catch {
    // localStorage may be unavailable in restricted environments
  }
  return 'system';
}

export interface UseThemeResult {
  /** The stored preference: 'light' | 'dark' | 'system'. */
  theme: ThemePreference;
  /** The actual applied theme after resolving 'system' against OS preference. */
  resolvedTheme: ResolvedTheme;
  /** Set and persist the theme preference. */
  setTheme: (t: ThemePreference) => void;
}

const THEME_CHANGE_EVENT = 'prism-theme-change';

interface ThemeChangeDetail {
  theme: ThemePreference;
  resolved: ResolvedTheme;
}

export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<ThemePreference>(readStoredTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(readStoredTheme())
  );

  // Keep html class in sync whenever resolved theme changes
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  // When theme is 'system', listen to OS preference changes
  useEffect(() => {
    if (theme !== 'system') return;

    const mq = getMediaQuery();

    function handleChange(e: MediaQueryListEvent) {
      const next: ResolvedTheme = e.matches ? 'dark' : 'light';
      setResolvedTheme(next);
    }

    mq.addEventListener('change', handleChange);
    // Re-sync immediately in case it changed while the component was unmounted
    setResolvedTheme(mq.matches ? 'dark' : 'light');

    return () => mq.removeEventListener('change', handleChange);
  }, [theme]);

  // Sync with other hook instances in the same document (e.g. TerminalTab) when
  // the user changes the theme via ThemeToggle while they are already mounted.
  useEffect(() => {
    function handleThemeChange(e: Event) {
      const { theme: t, resolved } = (e as CustomEvent<ThemeChangeDetail>).detail;
      setThemeState(t);
      setResolvedTheme(resolved);
    }
    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
  }, []);

  const setTheme = useCallback((t: ThemePreference) => {
    try {
      if (t === 'system') {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, t);
      }
    } catch {
      // Ignore write failures (private browsing, quota exceeded, etc.)
    }
    const resolved = resolveTheme(t);
    setThemeState(t);
    setResolvedTheme(resolved);
    // Notify all other hook instances in the same document
    window.dispatchEvent(new CustomEvent<ThemeChangeDetail>(THEME_CHANGE_EVENT, { detail: { theme: t, resolved } }));
  }, []);

  return { theme, resolvedTheme, setTheme };
}
