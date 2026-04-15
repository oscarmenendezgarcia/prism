/**
 * Polls loadBoard() while the component is mounted.
 * Skips the fetch when isMutating is true to prevent flickering during
 * in-flight mutations (matching the setInterval behavior in legacy app.js).
 * ADR-002 §3.2: usePolling hook.
 *
 * Adaptive interval:
 *   - 1000 ms when activeRun !== null  (faster detection of agent completion)
 *   - 3000 ms when activeRun === null  (normal idle cadence)
 *
 * When idle (pipelineState === null), also probes for externally-launched
 * backend runs (e.g. via MCP or CLI) so the log panel opens without a reload.
 */

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { listRuns, getBackendRun } from '@/api/client';
import type { PipelineStage } from '@/types';

const POLL_INTERVAL_ACTIVE_MS = 1000;
const POLL_INTERVAL_IDLE_MS   = 3000;

async function attachExternalRunIfAny(): Promise<void> {
  const { pipelineState, attachRun } = useAppStore.getState();
  if (pipelineState !== null) return;
  try {
    const runs = await listRuns();
    const active = runs
      .filter((r) => r.status === 'running')
      .sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime())[0];
    if (!active) return;
    // Re-check pipelineState — may have been set by the time the fetch resolved.
    if (useAppStore.getState().pipelineState !== null) return;
    const full = await getBackendRun(active.runId);
    attachRun({
      spaceId:           full.spaceId,
      taskId:            full.taskId,
      stages:            full.stages as PipelineStage[],
      currentStageIndex: full.currentStage ?? 0,
      startedAt:         full.createdAt,
      finishedAt:        undefined,
      status:            'running',
      runId:             full.runId,
      subTaskIds:        [],
      checkpoints:       [],
    });
  } catch {
    // Network error or server not ready — silently skip.
  }
}

export function usePolling(): void {
  const [intervalMs, setIntervalMs] = useState<number>(() =>
    useAppStore.getState().activeRun !== null
      ? POLL_INTERVAL_ACTIVE_MS
      : POLL_INTERVAL_IDLE_MS
  );

  useEffect(() => {
    return useAppStore.subscribe((state) => {
      const next = state.activeRun !== null
        ? POLL_INTERVAL_ACTIVE_MS
        : POLL_INTERVAL_IDLE_MS;
      setIntervalMs((prev) => (prev === next ? prev : next));
    });
  }, []);

  const intervalMsRef = useRef(intervalMs);
  useEffect(() => {
    intervalMsRef.current = intervalMs;
  });

  useEffect(() => {
    // Probe immediately on mount so the log panel opens without waiting one tick.
    attachExternalRunIfAny();

    const id = setInterval(() => {
      const { isMutating, loadBoard } = useAppStore.getState();
      if (!isMutating) {
        loadBoard();
      }
      // When idle, also check for externally-launched runs.
      if (useAppStore.getState().pipelineState === null) {
        attachExternalRunIfAny();
      }
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs]);
}
