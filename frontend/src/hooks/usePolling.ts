/**
 * Polls loadBoard() while the component is mounted.
 * Skips the fetch when isMutating is true to prevent flickering during
 * in-flight mutations (matching the setInterval behavior in legacy app.js).
 * ADR-002 §3.2: usePolling hook.
 *
 * Adaptive interval:
 *   - 1000 ms when a run is active (activeRun !== null or pipelineState running)
 *   - 3000 ms when idle
 *
 * On every idle tick, probes for externally-launched backend runs (e.g. via
 * MCP or CLI) so the log panel opens without a reload.  All runs with status
 * running/interrupted/failed that are not yet in pipelineStates are attached.
 *
 * When pipelineState has a runId, syncs currentStageIndex and status from
 * the backend so the UI reflects stage transitions without a full page reload.
 */

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { listRuns, getBackendRun } from '@/api/client';
import { useRunHistoryStore } from '@/stores/useRunHistoryStore';
import type { PipelineStage } from '@/types';

const POLL_INTERVAL_ACTIVE_MS = 1000;
const POLL_INTERVAL_IDLE_MS   = 3000;

/** @internal exported for unit testing only */
export async function attachExternalRunIfAny(): Promise<void> {
  const { attachRun } = useAppStore.getState();
  try {
    const runs = await listRuns();
    // Collect all runs that are still active on the backend side.
    const candidates = runs.filter(
      (r) => r.status === 'running' || r.status === 'interrupted' || r.status === 'failed',
    );
    if (candidates.length === 0) return;

    for (const candidate of candidates) {
      // Skip runs that are already tracked in pipelineStates (re-read on every
      // iteration — a previous loop iteration may have just attached one).
      if (useAppStore.getState().pipelineStates[candidate.runId]) continue;

      try {
        const full = await getBackendRun(candidate.runId);
        // Re-check after the async fetch to avoid a TOCTOU race.
        if (useAppStore.getState().pipelineStates[full.runId]) continue;

        // Map backend status to the frontend PipelineState status vocabulary.
        const frontendStatus: 'running' | 'interrupted' =
          full.status === 'running' ? 'running' : 'interrupted';

        attachRun({
          spaceId:           full.spaceId,
          taskId:            full.taskId,
          stages:            full.stages as PipelineStage[],
          currentStageIndex: full.currentStage ?? 0,
          startedAt:         full.createdAt,
          finishedAt:        undefined,
          status:            frontendStatus,
          runId:             full.runId,
          subTaskIds:        [],
          checkpoints:       full.checkpoints ?? [],
        });
      } catch {
        // Individual fetch failure — skip this run, try the next one.
      }
    }
  } catch {
    // Network error or server not ready — silently skip.
  }
}

/**
 * Sync pipelineState from the backend run when a runId is present.
 * Updates currentStageIndex, stages (loop injection), and terminal status.
 */
async function syncPipelineState(): Promise<void> {
  const ps = useAppStore.getState().pipelineState;
  if (!ps?.runId) return;
  if (ps.status === 'completed' || ps.status === 'aborted') return;

  try {
    const run = await getBackendRun(ps.runId);
    // Re-read in case state changed while awaiting.
    const currentPs = useAppStore.getState().pipelineState;
    if (!currentPs?.runId || currentPs.runId !== ps.runId) return;

    const newIdx    = run.currentStage ?? currentPs.currentStageIndex;
    const newStages = (run.stages ?? currentPs.stages) as PipelineStage[];
    const stageChanged  = newIdx !== currentPs.currentStageIndex;
    const stagesGrew    = newStages.length > currentPs.stages.length;

    if (run.status === 'completed' && currentPs.status !== 'completed') {
      useAppStore.setState({
        pipelineState: { ...currentPs, status: 'completed', currentStageIndex: newIdx, stages: newStages, finishedAt: run.updatedAt },
        activeRun: null,
      });
      const histRun = useRunHistoryStore.getState().runs.find((r) => r.id === currentPs.runId);
      if (histRun?.status === 'running') {
        useRunHistoryStore.getState().recordRunFinished(currentPs.runId!, 'completed', Date.now() - Date.parse(currentPs.startedAt));
      }
    } else if ((run.status === 'failed' || run.status === 'cancelled') && currentPs.status === 'running') {
      useAppStore.setState({
        pipelineState: { ...currentPs, status: 'interrupted', currentStageIndex: newIdx, stages: newStages },
        activeRun: null,
      });
      const histRun = useRunHistoryStore.getState().runs.find((r) => r.id === currentPs.runId);
      if (histRun?.status === 'running') {
        useRunHistoryStore.getState().recordRunFinished(currentPs.runId!, 'failed', Date.now() - Date.parse(currentPs.startedAt));
      }
    } else if (run.status === 'interrupted' && currentPs.status !== 'interrupted') {
      useAppStore.setState({ pipelineState: { ...currentPs, status: 'interrupted' }, activeRun: null });
    } else if (run.status === 'paused' && currentPs.status !== 'paused') {
      useAppStore.setState({
        pipelineState: {
          ...currentPs,
          status: 'paused',
          currentStageIndex: run.pausedBeforeStage ?? newIdx,
          pausedBeforeStage: run.pausedBeforeStage,
          stages: newStages,
        },
      });
    } else if (run.status === 'blocked' && currentPs.status !== 'blocked') {
      // Pipeline is waiting for a question to be resolved before continuing.
      useAppStore.setState({
        pipelineState: {
          ...currentPs,
          status: 'blocked',
          currentStageIndex: newIdx,
          stages: newStages,
          blockedReason: run.blockedReason,
        },
      });
    } else if (run.status === 'running' && currentPs.status === 'blocked') {
      // Question was resolved — pipeline is running again; clear blockedReason.
      useAppStore.setState({
        pipelineState: {
          ...currentPs,
          status: 'running',
          blockedReason: undefined,
        },
      });
    } else if (stageChanged || stagesGrew) {
      // Stage advanced or loop injected — update index and stages.
      const { activeRun } = useAppStore.getState();
      useAppStore.setState({
        pipelineState: { ...currentPs, currentStageIndex: newIdx, stages: newStages },
        ...(activeRun ? { activeRun: { ...activeRun, agentId: newStages[newIdx] ?? activeRun.agentId } } : {}),
      });
    }
  } catch {
    // ignore
  }
}

export function usePolling(): void {
  const [intervalMs, setIntervalMs] = useState<number>(() => {
    const s = useAppStore.getState();
    return (s.activeRun !== null || s.pipelineState?.status === 'running')
      ? POLL_INTERVAL_ACTIVE_MS
      : POLL_INTERVAL_IDLE_MS;
  });

  useEffect(() => {
    return useAppStore.subscribe((state) => {
      const next = (state.activeRun !== null || state.pipelineState?.status === 'running')
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
      const { isMutating, loadBoard, pipelineState } = useAppStore.getState();
      if (!isMutating) {
        loadBoard();
      }
      if (pipelineState?.runId) {
        // Sync current stage and status from backend.
        syncPipelineState();
      }
      // Always probe for externally-launched runs (running, interrupted, failed)
      // that are not yet in pipelineStates.  attachExternalRunIfAny is idempotent
      // — it skips runIds already present in pipelineStates.
      attachExternalRunIfAny();
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs]);
}
