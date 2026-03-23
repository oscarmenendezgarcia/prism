/**
 * Detects when an active agent run completes by watching board task state.
 * ADR-1 (Agent Launcher) §3.2: uses the existing 3-second polling cycle,
 * no new polling interval added.
 *
 * Completion is detected by checking whether the task is in the done column
 * AND its updatedAt timestamp is >= the run's startedAt timestamp. This
 * correctly handles pipeline stages 2-4 where the task ID was already in the
 * done column before the stage started (the old done-diff approach failed here).
 *
 * When the task associated with activeRun moves to the 'done' column:
 * - Calls clearActiveRun()
 * - Shows a completion toast
 * - If a pipeline is active and settings allow auto-advance, advances the pipeline
 *   (or shows a confirmation toast if confirmBetweenStages is true)
 */

import { useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { useRunHistoryStore } from '@/stores/useRunHistoryStore';

export function useAgentCompletion(): void {
  useEffect(() => {
    return useAppStore.subscribe((state) => {
      const { activeRun, tasks, pipelineState, agentSettings, availableAgents } = state;

      if (!activeRun) return;

      // Find the task in the done column.
      const doneTasks  = tasks['done'];
      const taskInDone = doneTasks.find((t) => t.id === activeRun.taskId);

      // Task not in done yet — nothing to do.
      if (!taskInDone) return;

      // Guard: only treat as completion if the task was updated AFTER the run
      // started. This prevents false-positive triggers when the task was already
      // in the done column at the beginning of a later pipeline stage.
      if (new Date(taskInDone.updatedAt) < new Date(activeRun.startedAt)) return;

      // Task is done — clear active run.
      const agentDisplayName =
        availableAgents.find((a) => a.id === activeRun.agentId)?.displayName ??
        activeRun.agentId;

      // ADR-1 (Agent Run History) §5.1: record completion in history store.
      const durationMs = Date.now() - Date.parse(activeRun.startedAt);
      const runs = useRunHistoryStore.getState().runs;
      const activeRecord = runs.find(
        (r) => r.status === 'running' && r.taskId === activeRun.taskId
      );
      if (activeRecord) {
        useRunHistoryStore.getState().recordRunFinished(activeRecord.id, 'completed', durationMs);
      }

      state.clearActiveRun();
      state.showToast(`Agent run completed: ${agentDisplayName}`);

      // Pipeline mode: decide whether to advance or confirm.
      if (!pipelineState || pipelineState.status !== 'running') return;

      const confirmBetween = agentSettings?.pipeline.confirmBetweenStages ?? true;
      const autoAdvance    = agentSettings?.pipeline.autoAdvance ?? true;

      if (!autoAdvance) return;

      if (confirmBetween) {
        const nextIdx = pipelineState.currentStageIndex + 1;
        if (nextIdx < pipelineState.stages.length) {
          const nextStage = pipelineState.stages[nextIdx];
          // Show a toast with actions — the user can invoke advancePipeline or abortPipeline
          // directly from the PipelineProgressBar. The toast is informational only.
          state.showToast(
            `Stage ${nextIdx} complete. Advance to stage ${nextIdx + 1} (${nextStage})?`
          );
        }
      } else {
        // Auto-advance without confirmation.
        state.advancePipeline();
      }
    });
  }, []);
}
