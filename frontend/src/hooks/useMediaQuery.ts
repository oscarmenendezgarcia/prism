/**
 * Reactive media query hook.
 * Returns true when the given CSS media query matches the current viewport.
 * Falls back to false in SSR or environments without window.matchMedia.
 */
import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const getMatches = (): boolean => {
    if (typeof window === 'undefined') return false;
    if (typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  };

  const [matches, setMatches] = useState<boolean>(getMatches);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const mql = window.matchMedia(query);
    const handleChange = (e: MediaQueryListEvent) => setMatches(e.matches);

    mql.addEventListener('change', handleChange);
    // Re-sync after mount in case the viewport changed between render and effect.
    setMatches(mql.matches);

    return () => mql.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
}
