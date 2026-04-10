/**
 * Generic debounce hook.
 * T-008: returns a debounced copy of `value` that only updates after `delay` ms
 * of inactivity. Default delay is 200 ms (matches SearchBar spec).
 *
 * Rapid consecutive value changes only propagate the last one, making this
 * safe to use with text inputs wired to expensive operations (Fuse.js search).
 */

import { useState, useEffect } from 'react';

/**
 * Returns a debounced value that trails the source by `delay` milliseconds.
 *
 * @param value  The live value to debounce.
 * @param delay  Debounce window in ms. Defaults to 200.
 */
export function useDebounce<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    // Cancel the previous timer on every change — only the last fires.
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
