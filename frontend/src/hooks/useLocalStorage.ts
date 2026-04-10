/**
 * Generic hook for reading and writing a value to localStorage.
 * ADR-002: replaces direct localStorage calls in app.js and terminal.js.
 */

import { useState, useCallback } from 'react';

export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item !== null ? (JSON.parse(item) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T) => {
      try {
        setStoredValue(value);
        if (value === null || value === undefined) {
          window.localStorage.removeItem(key);
        } else {
          window.localStorage.setItem(key, JSON.stringify(value));
        }
      } catch {
        // Silently ignore storage errors (e.g. private browsing quota exceeded)
      }
    },
    [key]
  );

  return [storedValue, setValue];
}
