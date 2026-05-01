/**
 * useGlobalSearch — cross-space task search hook.
 *
 * Owns query state, applies 250 ms debounce, aborts stale in-flight requests
 * via AbortController, and exposes typed results + status.
 *
 * ADR-1 (global-search): reuses useDebounce (already in codebase at 200 ms
 * default, overridden here to 250 ms per spec).
 */

import { useState, useEffect, useRef } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { searchTasks } from '@/api/client';
import type { SearchResult } from '@/types';

export type SearchStatus = 'idle' | 'loading' | 'error';

export interface GlobalSearchState {
  /** Current (live) query string. */
  query:    string;
  /** Update the search query. */
  setQuery: (q: string) => void;
  /** Ranked results from the latest completed request. */
  results:  SearchResult[];
  /** Current request lifecycle status. */
  status:   SearchStatus;
  /** Non-null when status === 'error'. */
  error:    Error | null;
}

const DEBOUNCE_MS = 250;

/**
 * Global search hook with debouncing and in-flight cancellation.
 *
 * @returns {GlobalSearchState}
 */
export function useGlobalSearch(): GlobalSearchState {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status,  setStatus]  = useState<SearchStatus>('idle');
  const [error,   setError]   = useState<Error | null>(null);

  const debouncedQuery = useDebounce(query, DEBOUNCE_MS);

  // Ref to the current AbortController so we can cancel stale requests.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = debouncedQuery.trim();

    // Empty query → reset to idle without firing a request.
    if (!trimmed) {
      abortRef.current?.abort();
      abortRef.current = null;
      setResults([]);
      setStatus('idle');
      setError(null);
      return;
    }

    // Cancel any previously in-flight request before issuing a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');
    setError(null);

    searchTasks(trimmed, 20, controller.signal)
      .then((res) => {
        setResults(res.results);
        setStatus('idle');
      })
      .catch((err: unknown) => {
        // AbortError is expected when a newer query supersedes this one — ignore it.
        if (err instanceof Error && err.name === 'AbortError') return;
        const wrapped = err instanceof Error ? err : new Error(String(err));
        console.error('[useGlobalSearch] fetch error:', wrapped.message);
        setError(wrapped);
        setStatus('error');
      });

    return () => {
      controller.abort();
    };
  }, [debouncedQuery]);

  // Abort any in-flight request when the hook unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return { query, setQuery, results, status, error };
}
