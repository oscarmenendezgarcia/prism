/**
 * Pure helper functions that construct synthetic PipelineState entries from
 * AgentRunRecord data. Used by openLogPanelForRun in useAppStore to allow the
 * PipelineLogPanel to display historical (completed) runs without any network
 * calls, since AgentRunRecord already carries all required fields.
 *
 * ADR-1 (run-history-pipeline-logs) §5: synthetic PipelineState construction.
 *
 * These functions are pure — no side effects, no store access.
 */

import type { AgentRunRecord, PipelineState, PipelineStage, RunStatus } from '@/types';
import { computeAggregateStatus } from '@/components/agent-run-history/groupRuns';

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

/**
 * Map AgentRunRecord.status (RunStatus) → PipelineState.status.
 *
 * BackendRun.status 'failed'    → 'failed'   (added T-001)
 * BackendRun.status 'cancelled' → 'aborted'
 * BackendRun.status 'running'   → 'running'
 * BackendRun.status 'completed' → 'completed'
 */
export function mapStatus(status: RunStatus): PipelineState['status'] {
  switch (status) {
    case 'running':   return 'running';
    case 'completed': return 'completed';
    case 'failed':    return 'failed';
    case 'cancelled': return 'aborted';
    default:          return 'aborted';
  }
}

// ---------------------------------------------------------------------------
// Stage selection
// ---------------------------------------------------------------------------

/**
 * Determine which stage index should be shown first when opening historical logs.
 * Priority:
 * 1. Currently running stage (for partially-done groups)
 * 2. Failed stage (most interesting for debugging)
 * 3. Last completed stage
 * 4. Last stage overall (fallback)
 */
export function lastNonPendingIndex(stages: AgentRunRecord[]): number {
  const runningIdx = stages.findIndex((s) => s.status === 'running');
  if (runningIdx !== -1) return runningIdx;

  const failedIdx = stages.findIndex((s) => s.status === 'failed');
  if (failedIdx !== -1) return failedIdx;

  for (let i = stages.length - 1; i >= 0; i--) {
    if (stages[i].status === 'completed') return i;
  }

  return stages.length - 1;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Build a synthetic PipelineState for a single AgentRunRecord.
 *
 * Used for:
 *  - Entries without pipelineRunId (standalone agent runs)
 *  - Groups with only 1 stage (groupRuns collapses them to 'single')
 *
 * Key = run.id (the backend runId for this agent run).
 */
export function buildSingleState(run: AgentRunRecord): PipelineState {
  return {
    spaceId:           run.spaceId,
    taskId:            run.taskId,
    taskTitle:         run.taskTitle,
    stages:            [run.agentId as PipelineStage],
    currentStageIndex: 0,
    startedAt:         run.startedAt,
    finishedAt:        run.completedAt ?? undefined,
    status:            mapStatus(run.status),
    runId:             run.id,
    subTaskIds:        [run.taskId],
    checkpoints:       [],
  };
}

/**
 * Build a synthetic PipelineState for a multi-stage pipeline group.
 *
 * Used for:
 *  - Groups with 2+ entries sharing the same pipelineRunId
 *
 * Key = pipelineRunId (the real backend run directory in data/runs/).
 *
 * NOTE: stageRunIds is intentionally omitted. The backend stores all stages
 * under a single directory data/runs/{pipelineRunId}/stage-N.log. The
 * AgentRunRecord.id (format: "{pipelineRunId}-{stageIndex}") is a DB key,
 * not a filesystem path. PipelineLogPanel's fallback already handles this:
 *   effectiveRunId = stageRunIds[idx] ?? runId   →  runId = pipelineRunId ✓
 *   effectiveStageIndex = selectedStageIndex      →  correct stage tab ✓
 */
export function buildPipelineGroupState(
  pipelineRunId: string,
  stages: AgentRunRecord[],
): PipelineState {
  const sorted = [...stages].sort((a, b) => (a.stageIndex ?? 0) - (b.stageIndex ?? 0));
  const first = sorted[0];

  const startMs = sorted
    .map((s) => Date.parse(s.startedAt))
    .reduce((min, t) => Math.min(min, t), Infinity);

  const allFinished = sorted.every((s) => s.completedAt !== null);
  let finishedAt: string | undefined;
  if (allFinished) {
    const maxMs = sorted
      .map((s) => Date.parse(s.completedAt!))
      .reduce((max, t) => Math.max(max, t), -Infinity);
    finishedAt = new Date(maxMs).toISOString();
  }

  const aggregateStatus = computeAggregateStatus(sorted);

  return {
    spaceId:           first.spaceId,
    taskId:            first.taskId,
    taskTitle:         first.taskTitle,
    stages:            sorted.map((s) => s.agentId as PipelineStage),
    currentStageIndex: lastNonPendingIndex(sorted),
    startedAt:         new Date(startMs).toISOString(),
    finishedAt,
    status:            mapStatus(aggregateStatus),
    runId:             pipelineRunId,
    subTaskIds:        sorted.map((s) => s.taskId),
    checkpoints:       [],
  };
}
