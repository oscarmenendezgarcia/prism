/**
 * Detects when an active agent run completes by watching board task state.
 * ADR-1 (Agent Launcher) §3.2: uses the existing 3-second polling cycle,
 * no new polling interval added.
 *
 * When the task associated with activeRun moves to the 'done' column:
 * - Calls clearActiveRun()
 * - Shows a completion toast
 * - If a pipeline is active and settings allow auto-advance, advances the pipeline
 *   (or shows a confirmation toast if confirmBetweenStages is true)
 */

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/useAppStore';

export function useAgentCompletion(): void {
  const prevTasksRef = useRef<string>('');

  useEffect(() => {
    return useAppStore.subscribe((state) => {
      const { activeRun, tasks, pipelineState, agentSettings, availableAgents } = state;

      if (!activeRun) return;

      // Serialize current done column task IDs for change detection.
      const doneTasks     = tasks['done'];
      const doneIds       = doneTasks.map((t) => t.id).sort().join(',');
      const prevDoneIds   = prevTasksRef.current;

      if (doneIds === prevDoneIds) return;
      prevTasksRef.current = doneIds;

      // Check if the active task has moved to done.
      const taskInDone = doneTasks.some((t) => t.id === activeRun.taskId);
      if (!taskInDone) return;

      // Task is done — clear active run.
      const agentDisplayName =
        availableAgents.find((a) => a.id === activeRun.agentId)?.displayName ??
        activeRun.agentId;

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
