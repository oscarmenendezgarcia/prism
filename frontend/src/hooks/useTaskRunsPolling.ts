/**
 * Keeps the board's run states fresh: quickly while a run is live, slowly otherwise.
 */

import { useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { useTaskRunStore } from '@/stores/useTaskRunStore';

const ACTIVE_MS = 2_000;
const IDLE_MS   = 10_000;
const RECENT_MS = 15_000;

export function useTaskRunsPolling(): void {
  useEffect(() => { void useTaskRunStore.getState().loadHarnesses(); }, []);

  const spaceId = useAppStore((s) => s.activeSpaceId);
  // A question can be answered from anywhere, and a run saves its result just after it ends.
  const hasLiveRun = useTaskRunStore((s) =>
    Object.values(s.views).some((v) => v.status === 'working' || v.status === 'checking' || v.status === 'question'
      || Date.now() - new Date(v.updatedAt).getTime() < RECENT_MS));

  useEffect(() => {
    if (!spaceId) return undefined;
    const { load } = useTaskRunStore.getState();
    void load(spaceId);
    const id = setInterval(() => { void load(spaceId); }, hasLiveRun ? ACTIVE_MS : IDLE_MS);
    return () => clearInterval(id);
  }, [spaceId, hasLiveRun]);
}
