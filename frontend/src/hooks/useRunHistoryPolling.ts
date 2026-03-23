/**
 * Polls the run history at an adaptive cadence matching usePolling.
 * ADR-1 (Agent Run History) §2.3: 1 s when a run is active, 3 s otherwise.
 *
 * Mounted once in App.tsx alongside usePolling() and useAgentCompletion().
 * Skips fetches when isMutating is true to match usePolling's skip guard.
 */

import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { useRunHistoryStore } from '@/stores/useRunHistoryStore';

const POLL_INTERVAL_ACTIVE_MS = 1000;
const POLL_INTERVAL_IDLE_MS   = 3000;

/**
 * Polls useRunHistoryStore.loadRuns() at an adaptive interval.
 * Interval is 1 s when an agent run is active, 3 s when idle.
 * Mirrors the exact pattern used by usePolling.
 */
export function useRunHistoryPolling(): void {
  // Derive initial cadence from current store state to avoid a double-render.
  const [intervalMs, setIntervalMs] = useState<number>(() =>
    useAppStore.getState().activeRun !== null
      ? POLL_INTERVAL_ACTIVE_MS
      : POLL_INTERVAL_IDLE_MS
  );

  // Subscribe to activeRun changes to switch cadence dynamically.
  useEffect(() => {
    return useAppStore.subscribe((state) => {
      const next = state.activeRun !== null
        ? POLL_INTERVAL_ACTIVE_MS
        : POLL_INTERVAL_IDLE_MS;
      setIntervalMs((prev) => (prev === next ? prev : next));
    });
  }, []);

  // The actual polling effect. Restarts when intervalMs changes (same as usePolling).
  useEffect(() => {
    const id = setInterval(() => {
      // Always read latest state to avoid stale closures.
      const { isMutating } = useAppStore.getState();
      if (!isMutating) {
        useRunHistoryStore.getState().loadRuns();
      }
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs]);
}
