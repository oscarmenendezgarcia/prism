/**
 * Polls loadBoard() while the component is mounted.
 * Skips the fetch when isMutating is true to prevent flickering during
 * in-flight mutations.
 */

import { useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';

const POLL_INTERVAL_MS = 3000;

export function usePolling(): void {
  useEffect(() => {
    const id = setInterval(() => {
      const { isMutating, loadBoard, refreshSpaces } = useAppStore.getState();
      if (!isMutating) {
        loadBoard();
        refreshSpaces();
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, []);
}
