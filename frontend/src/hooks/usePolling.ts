/**
 * Polls loadBoard() while the component is mounted.
 * Skips the fetch when isMutating is true to prevent flickering during
 * in-flight mutations (matching the setInterval behavior in legacy app.js).
 * ADR-002 §3.2: usePolling hook.
 *
 * Adaptive interval (bug fix):
 *   - 1000 ms when activeRun !== null  (faster detection of agent completion)
 *   - 3000 ms when activeRun === null  (normal idle cadence)
 * The interval is restarted whenever the activeRun presence changes so that
 * completion is detected promptly instead of waiting up to 3 seconds.
 */

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';

const POLL_INTERVAL_ACTIVE_MS = 1000;
const POLL_INTERVAL_IDLE_MS   = 3000;

export function usePolling(): void {
  // Track whether there is an active run so we can switch intervals.
  // useState drives a re-render when the run presence changes, which restarts
  // the setInterval effect below via its dependency on `intervalMs`.
  const [intervalMs, setIntervalMs] = useState<number>(() =>
    useAppStore.getState().activeRun !== null
      ? POLL_INTERVAL_ACTIVE_MS
      : POLL_INTERVAL_IDLE_MS
  );

  // Subscribe to activeRun changes and update the interval accordingly.
  useEffect(() => {
    return useAppStore.subscribe((state) => {
      const next = state.activeRun !== null
        ? POLL_INTERVAL_ACTIVE_MS
        : POLL_INTERVAL_IDLE_MS;
      setIntervalMs((prev) => (prev === next ? prev : next));
    });
  }, []);

  // The actual polling interval. Restarts whenever intervalMs changes.
  const intervalMsRef = useRef(intervalMs);
  useEffect(() => {
    intervalMsRef.current = intervalMs;
  });

  useEffect(() => {
    const id = setInterval(() => {
      // Always read the latest store state to avoid stale closures.
      const { isMutating, loadBoard } = useAppStore.getState();
      if (!isMutating) {
        loadBoard();
      }
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs]); // Restart the interval when the cadence changes
}
