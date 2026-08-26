/**
 * Polls loadBoard() while the component is mounted.
 * Skips the fetch when isMutating is true to prevent flickering during
 * in-flight mutations (matching the setInterval behavior in legacy app.js).
 * ADR-002 §3.2: usePolling hook.
 *
 * Adaptive interval:
 *   - 1000 ms when a run is active (activeRun !== null or any pipelineState running)
 *   - 3000 ms when idle
 *
 * On every idle tick, probes for externally-launched backend runs (e.g. via
 * MCP or CLI) so the log panel opens without a reload.  All runs with status
 * running/paused/blocked that are not yet in pipelineStates are attached —
 * paused and blocked are active states the header must surface (Continue /
 * question banner), so the filter mirrors RunIndicator's ACTIVE_STATUSES.
 *
 * When pipelineState has a runId, syncs currentStageIndex and status from
 * the backend so the UI reflects stage transitions without a full page reload.
 *
 * syncAllRunStatuses() additionally syncs every non-primary running entry in
 * pipelineStates so auto-dismiss fires for all completed runs, not just the
 * active one.
 */

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { listRuns, getBackendRun } from '@/api/client';
import { useRunHistoryStore } from '@/stores/useRunHistoryStore';
import type { PipelineStage, PipelineState } from '@/types';

const POLL_INTERVAL_ACTIVE_MS = 1000;
const POLL_INTERVAL_IDLE_MS   = 3000;

/** @internal exported for unit testing only */
export async function attachExternalRunIfAny(): Promise<void> {
  const { attachRun } = useAppStore.getState();
  try {
    const runs = await listRuns();
    // Only auto-attach runs that are actively in flight. Terminal states
    // (interrupted/failed/completed/cancelled) are historical noise from past
    // sessions — surfacing them on every page load floods the multi-run
    // indicator.  Paused and blocked are active states (a pause banner /
    // blocking question the header must show), matching RunIndicator's
    // ACTIVE_STATUSES.
    const activeStatuses = new Set(['running', 'paused', 'blocked']);
    const candidates = runs.filter((r) => activeStatuses.has(r.status));
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
        // running/paused/blocked map 1:1 so the header shows the right banner
        // (Continue / question) instead of collapsing everything onto
        // 'interrupted'. Anything else is terminal-ish → 'interrupted'.
        const frontendStatus: PipelineState['status'] =
          full.status === 'running' || full.status === 'paused' || full.status === 'blocked'
            ? full.status
            : 'interrupted';

        attachRun({
          spaceId:           full.spaceId,
          taskId:            full.taskId,
          stages:            full.stages as PipelineStage[],
          currentStageIndex: full.status === 'paused'
            ? full.pausedBeforeStage ?? full.currentStage ?? 0
            : full.currentStage ?? 0,
          startedAt:         full.createdAt,
          finishedAt:        undefined,
          status:            frontendStatus,
          runId:             full.runId,
          subTaskIds:        [],
          checkpoints:       full.checkpoints ?? [],
          pausedBeforeStage: full.status === 'paused' ? full.pausedBeforeStage : undefined,
          blockedReason:     full.status === 'blocked' ? full.blockedReason : undefined,
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

    const runId     = currentPs.runId;
    const newIdx    = run.currentStage ?? currentPs.currentStageIndex;
    const newStages = (run.stages ?? currentPs.stages) as PipelineStage[];
    const stageChanged  = newIdx !== currentPs.currentStageIndex;
    const stagesGrew    = newStages.length > currentPs.stages.length;

    // Updates both the deprecated pipelineState mirror AND pipelineStates[runId]
    // so that usePipelineState (which reads from pipelineStates via recomputeMirror)
    // sees the new status and RunIndicator's auto-dismiss fires correctly.
    const applyPatch = (patch: Partial<PipelineState>, extra: Record<string, unknown> = {}) => {
      const updated = { ...currentPs, ...patch };
      const { pipelineStates } = useAppStore.getState();
      useAppStore.setState({
        pipelineState:  updated,
        pipelineStates: { ...pipelineStates, [runId]: updated },
        ...extra,
      });
    };

    if (run.status === 'completed' && currentPs.status !== 'completed') {
      applyPatch(
        { status: 'completed', currentStageIndex: newIdx, stages: newStages, finishedAt: run.updatedAt },
        { activeRun: null },
      );
      const histRun = useRunHistoryStore.getState().runs.find((r) => r.id === runId);
      if (histRun?.status === 'running') {
        useRunHistoryStore.getState().recordRunFinished(runId, 'completed', Date.now() - Date.parse(currentPs.startedAt));
      }
    } else if ((run.status === 'failed' || run.status === 'cancelled') && currentPs.status === 'running') {
      applyPatch(
        { status: 'interrupted', currentStageIndex: newIdx, stages: newStages },
        { activeRun: null },
      );
      const histRun = useRunHistoryStore.getState().runs.find((r) => r.id === runId);
      if (histRun?.status === 'running') {
        useRunHistoryStore.getState().recordRunFinished(runId, 'failed', Date.now() - Date.parse(currentPs.startedAt));
      }
    } else if (run.status === 'interrupted' && currentPs.status !== 'interrupted') {
      applyPatch({ status: 'interrupted' }, { activeRun: null });
    } else if (run.status === 'paused' && currentPs.status !== 'paused') {
      applyPatch({
        status: 'paused',
        currentStageIndex: run.pausedBeforeStage ?? newIdx,
        pausedBeforeStage: run.pausedBeforeStage,
        stages: newStages,
      });
    } else if (run.status === 'blocked' && currentPs.status !== 'blocked') {
      // Pipeline is waiting for a question to be resolved before continuing.
      applyPatch({
        status: 'blocked',
        currentStageIndex: newIdx,
        stages: newStages,
        blockedReason: run.blockedReason,
      });
    } else if (run.status === 'running' && currentPs.status === 'blocked') {
      // Question was resolved — pipeline is running again; clear blockedReason.
      applyPatch({ status: 'running', blockedReason: undefined });
    } else if (stageChanged || stagesGrew) {
      // Stage advanced or loop injected — update index and stages.
      const { activeRun } = useAppStore.getState();
      applyPatch(
        { currentStageIndex: newIdx, stages: newStages },
        activeRun ? { activeRun: { ...activeRun, agentId: newStages[newIdx] ?? activeRun.agentId } } : {},
      );
    }
  } catch {
    // ignore
  }
}

/**
 * Sync status for all non-primary running entries in pipelineStates.
 *
 * syncPipelineState() already handles the primary run (pipelineState mirror)
 * with full detail (stage index, blocked/paused transitions).  This function
 * covers the remaining runs so their status transitions to 'completed' or
 * 'interrupted' as soon as the backend reports it — which triggers the
 * auto-dismiss timer in RunItemCompact and eventually removes them from the
 * MultiRunIndicator.
 *
 * Rules:
 *  - Only examines entries with status 'running' and a non-null runId.
 *  - Skips the primary run (already handled by syncPipelineState).
 *  - On terminal backend status → updates pipelineStates[runId].status.
 *  - On still-running backend status → no-op (keep waiting).
 *  - Per-run fetch failure → skip that run silently; continue others.
 *  - Re-reads state after each async fetch to avoid stale-closure races.
 *
 * @internal exported for unit testing only
 */
export async function syncAllRunStatuses(): Promise<void> {
  const state     = useAppStore.getState();
  const primaryId = state.pipelineState?.runId;

  const candidates = Object.entries(state.pipelineStates).filter(
    ([runId, ps]) =>
      ps.status === 'running' &&
      ps.runId != null &&
      runId !== primaryId,
  );

  if (candidates.length === 0) return;

  await Promise.allSettled(
    candidates.map(async ([runId]) => {
      try {
        const run = await getBackendRun(runId);

        // Only react to terminal statuses — skip if still running/paused/blocked.
        if (
          run.status !== 'completed' &&
          run.status !== 'failed'    &&
          run.status !== 'cancelled' &&
          run.status !== 'interrupted'
        ) {
          return;
        }

        // Re-read state after the async fetch to avoid stale-closure races.
        const fresh     = useAppStore.getState();
        const currentPs = fresh.pipelineStates[runId];
        // Guard: entry gone or already transitioned by another code path.
        if (!currentPs || currentPs.status !== 'running') return;

        const newStatus: PipelineState['status'] =
          run.status === 'completed' ? 'completed' : 'interrupted';

        const updatedEntry: PipelineState = {
          ...currentPs,
          status: newStatus,
          ...(run.updatedAt ? { finishedAt: run.updatedAt } : {}),
        };

        const newPipelineStates = { ...fresh.pipelineStates, [runId]: updatedEntry };
        // Sync the deprecated mirror only if this runId is currently active.
        const newMirror =
          fresh.activePipelineRunId === runId ? updatedEntry : fresh.pipelineState;

        useAppStore.setState({
          pipelineStates: newPipelineStates,
          pipelineState:  newMirror,
        });
      } catch {
        // Per-run fetch failure — skip silently.
      }
    }),
  );
}

export function usePolling(): void {
  const [intervalMs, setIntervalMs] = useState<number>(() => {
    const s = useAppStore.getState();
    const hasAnyRunning = Object.values(s.pipelineStates).some((ps) => ps.status === 'running');
    return (s.activeRun !== null || hasAnyRunning)
      ? POLL_INTERVAL_ACTIVE_MS
      : POLL_INTERVAL_IDLE_MS;
  });

  useEffect(() => {
    return useAppStore.subscribe((state) => {
      const hasAnyRunning = Object.values(state.pipelineStates).some((ps) => ps.status === 'running');
      const next = (state.activeRun !== null || hasAnyRunning)
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
        // Sync current stage and status from backend for the primary run.
        syncPipelineState();
      }
      // Sync status for all non-primary running entries so their auto-dismiss
      // fires as soon as the backend reports completion.
      syncAllRunStatuses();
      // Always probe for externally-launched runs (running, paused, blocked)
      // that are not yet in pipelineStates.  attachExternalRunIfAny is
      // idempotent — it skips runIds already present in pipelineStates.
      attachExternalRunIfAny();
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs]);
}
