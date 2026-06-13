/**
 * Safe wrapper around window.localStorage.
 *
 * Some mobile / privacy browsers (older iOS Safari Private Mode, Firefox Focus,
 * DuckDuckGo, in-app webviews, …) throw on ANY localStorage access. When a
 * Zustand store reads storage directly inside its initializer, that throw
 * happens during module evaluation — which aborts the whole bundle and leaves
 * the user staring at a blank white page (desktop browsers are unaffected, so
 * the bug is invisible until someone opens the app on a restricted browser).
 *
 * These helpers degrade gracefully instead: a failed read returns null and a
 * failed write is a silent no-op, so the app still boots (just without
 * persisted UI preferences) when storage is unavailable.
 */
export const safeStorage = {
  getItem(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* storage unavailable (private mode / restricted browser) — ignore */
    }
  },
  removeItem(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* storage unavailable (private mode / restricted browser) — ignore */
    }
  },
};
