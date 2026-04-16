/**
 * groupRuns — cluster flat AgentRunRecord[] by pipelineRunId.
 *
 * ADR-1 (pipeline-run-history-bridge) §3.5 B:
 * - Entries without pipelineRunId → { type: 'single' }
 * - Entries sharing a pipelineRunId:
 *   - Only 1 entry → { type: 'single' } (collapsed single-entry pipeline)
 *   - 2+ entries    → { type: 'pipeline', stages, aggregateStatus }
 * - Output order: newest-first (by earliest startedAt in each group).
 */

import type { AgentRunRecord, RunStatus } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunGroup =
  | { type: 'single'; run: AgentRunRecord }
  | {
      type: 'pipeline';
      pipelineRunId: string;
      stages: AgentRunRecord[];
      aggregateStatus: RunStatus;
    };

// ---------------------------------------------------------------------------
// Aggregate status
// ---------------------------------------------------------------------------

/**
 * Compute aggregate status for a group of stage records.
 * - Any running stage → 'running'
 * - Any failed stage  → 'failed'
 * - Any cancelled     → 'cancelled'
 * - All completed     → 'completed'
 * - Otherwise         → 'running' (pending stages count as still in progress)
 */
export function computeAggregateStatus(stages: AgentRunRecord[]): RunStatus {
  if (stages.some((s) => s.status === 'running'))   return 'running';
  if (stages.some((s) => s.status === 'failed'))    return 'failed';
  if (stages.some((s) => s.status === 'cancelled')) return 'cancelled';
  if (stages.every((s) => s.status === 'completed')) return 'completed';
  return 'running'; // pending stages still count as in progress
}

// ---------------------------------------------------------------------------
// Main utility
// ---------------------------------------------------------------------------

/**
 * Group a flat list of AgentRunRecord entries by pipelineRunId.
 *
 * @param runs - Flat list of records, assumed newest-first from the API.
 * @returns    - Interleaved list of RunGroup items, newest-first.
 */
export function groupRuns(runs: AgentRunRecord[]): RunGroup[] {
  const pipelineMap = new Map<string, AgentRunRecord[]>();
  const singles: Array<{ run: AgentRunRecord; startedAt: number }> = [];

  for (const run of runs) {
    if (run.pipelineRunId) {
      if (!pipelineMap.has(run.pipelineRunId)) {
        pipelineMap.set(run.pipelineRunId, []);
      }
      pipelineMap.get(run.pipelineRunId)!.push(run);
    } else {
      singles.push({ run, startedAt: Date.parse(run.startedAt) });
    }
  }

  // Build pipeline group objects sorted by stageIndex.
  const pipelineGroups = [...pipelineMap.entries()].map(([pipelineRunId, stages]) => {
    const sorted = [...stages].sort((a, b) => (a.stageIndex ?? 0) - (b.stageIndex ?? 0));
    const earliestStart = Math.min(...sorted.map((s) => Date.parse(s.startedAt)));
    return { pipelineRunId, stages: sorted, earliestStart };
  });

  // Merge singles and pipeline groups newest-first (by startedAt).
  const allItems: Array<{ startedAt: number; group: RunGroup }> = [
    ...singles.map(({ run, startedAt }) => ({
      startedAt,
      group: { type: 'single' as const, run },
    })),
    ...pipelineGroups.map(({ pipelineRunId, stages, earliestStart }) => {
      if (stages.length === 1) {
        return {
          startedAt: earliestStart,
          group: { type: 'single' as const, run: stages[0] },
        };
      }
      return {
        startedAt: earliestStart,
        group: {
          type:            'pipeline' as const,
          pipelineRunId,
          stages,
          aggregateStatus: computeAggregateStatus(stages),
        },
      };
    }),
  ];

  allItems.sort((a, b) => b.startedAt - a.startedAt);
  return allItems.map((item) => item.group);
}
