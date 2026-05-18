/**
 * Unit tests for pipelineStateFromRun helpers.
 * T-002 acceptance criteria: buildSingleState, buildPipelineGroupState, mapStatus.
 *
 * Tests are pure — no store access, no mocks required.
 */

import { describe, it, expect } from 'vitest';
import type { AgentRunRecord } from '@/types';
import {
  mapStatus,
  lastNonPendingIndex,
  buildSingleState,
  buildPipelineGroupState,
} from '@/stores/pipelineStateFromRun';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id:               'run-1',
    taskId:           'task-1',
    taskTitle:        'feat: example',
    agentId:          'developer-agent',
    agentDisplayName: 'Developer',
    spaceId:          'space-1',
    spaceName:        'My Space',
    status:           'completed',
    startedAt:        '2026-05-18T10:00:00.000Z',
    completedAt:      '2026-05-18T10:05:00.000Z',
    durationMs:       300000,
    cliCommand:       'claude',
    promptPath:       '/tmp/prompt.md',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// mapStatus
// ---------------------------------------------------------------------------

describe('mapStatus', () => {
  it('maps running → running', () => {
    expect(mapStatus('running')).toBe('running');
  });

  it('maps completed → completed', () => {
    expect(mapStatus('completed')).toBe('completed');
  });

  it('maps failed → failed', () => {
    expect(mapStatus('failed')).toBe('failed');
  });

  it('maps cancelled → aborted', () => {
    expect(mapStatus('cancelled')).toBe('aborted');
  });
});

// ---------------------------------------------------------------------------
// lastNonPendingIndex
// ---------------------------------------------------------------------------

describe('lastNonPendingIndex', () => {
  it('returns index of the running stage when present', () => {
    const stages = [
      makeRun({ id: 'r0', stageIndex: 0, status: 'completed' }),
      makeRun({ id: 'r1', stageIndex: 1, status: 'running' }),
      makeRun({ id: 'r2', stageIndex: 2, status: 'completed' }),
    ];
    expect(lastNonPendingIndex(stages)).toBe(1);
  });

  it('returns index of the failed stage when no running stage', () => {
    const stages = [
      makeRun({ id: 'r0', stageIndex: 0, status: 'completed' }),
      makeRun({ id: 'r1', stageIndex: 1, status: 'failed' }),
      makeRun({ id: 'r2', stageIndex: 2, status: 'cancelled' }),
    ];
    expect(lastNonPendingIndex(stages)).toBe(1);
  });

  it('returns the last completed stage when all done', () => {
    const stages = [
      makeRun({ id: 'r0', stageIndex: 0, status: 'completed' }),
      makeRun({ id: 'r1', stageIndex: 1, status: 'completed' }),
      makeRun({ id: 'r2', stageIndex: 2, status: 'completed' }),
    ];
    expect(lastNonPendingIndex(stages)).toBe(2);
  });

  it('falls back to last stage index when no completed stages', () => {
    const stages = [
      makeRun({ id: 'r0', stageIndex: 0, status: 'cancelled' }),
      makeRun({ id: 'r1', stageIndex: 1, status: 'cancelled' }),
    ];
    expect(lastNonPendingIndex(stages)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildSingleState
// ---------------------------------------------------------------------------

describe('buildSingleState', () => {
  it('builds a valid PipelineState for a completed single run', () => {
    const run = makeRun({
      id:          'run-abc',
      agentId:     'senior-architect',
      status:      'completed',
      startedAt:   '2026-05-18T09:00:00.000Z',
      completedAt: '2026-05-18T09:10:00.000Z',
    });

    const state = buildSingleState(run);

    expect(state.stages).toEqual(['senior-architect']);
    expect(state.currentStageIndex).toBe(0);
    expect(state.status).toBe('completed');
    expect(state.runId).toBe('run-abc');
    expect(state.spaceId).toBe('space-1');
    expect(state.taskId).toBe('task-1');
    expect(state.taskTitle).toBe('feat: example');
    expect(state.startedAt).toBe('2026-05-18T09:00:00.000Z');
    expect(state.finishedAt).toBe('2026-05-18T09:10:00.000Z');
    expect(state.stageRunIds).toBeUndefined();
    expect(state.subTaskIds).toEqual(['task-1']);
    expect(state.checkpoints).toEqual([]);
  });

  it('sets finishedAt to undefined when completedAt is null (still running)', () => {
    const run = makeRun({ status: 'running', completedAt: null, durationMs: null });
    const state = buildSingleState(run);
    expect(state.finishedAt).toBeUndefined();
    expect(state.status).toBe('running');
  });

  it('maps failed status correctly', () => {
    const run = makeRun({ status: 'failed' });
    const state = buildSingleState(run);
    expect(state.status).toBe('failed');
  });

  it('maps cancelled status to aborted', () => {
    const run = makeRun({ status: 'cancelled' });
    const state = buildSingleState(run);
    expect(state.status).toBe('aborted');
  });
});

// ---------------------------------------------------------------------------
// buildPipelineGroupState
// ---------------------------------------------------------------------------

describe('buildPipelineGroupState', () => {
  const PIPELINE_RUN_ID = 'pipe-xyz';

  const makeStages = (statuses: Array<{ id: string; agentId: string; status: AgentRunRecord['status']; stageIndex: number }>) =>
    statuses.map((s) =>
      makeRun({
        id:               s.id,
        agentId:          s.agentId,
        status:           s.status,
        stageIndex:       s.stageIndex,
        pipelineRunId:    PIPELINE_RUN_ID,
        completedAt:      s.status === 'running' ? null : '2026-05-18T10:05:00.000Z',
        durationMs:       s.status === 'running' ? null : 300000,
      })
    );

  it('builds a valid PipelineState for an all-completed pipeline group', () => {
    const stages = makeStages([
      { id: 'r0', agentId: 'senior-architect', status: 'completed', stageIndex: 0 },
      { id: 'r1', agentId: 'ux-api-designer',  status: 'completed', stageIndex: 1 },
      { id: 'r2', agentId: 'developer-agent',  status: 'completed', stageIndex: 2 },
    ]);

    const state = buildPipelineGroupState(PIPELINE_RUN_ID, stages);

    expect(state.stages).toEqual(['senior-architect', 'ux-api-designer', 'developer-agent']);
    expect(state.status).toBe('completed');
    expect(state.runId).toBe(PIPELINE_RUN_ID); // backend dir, not stage run id
    expect(state.stageRunIds).toBeUndefined(); // omitted — PipelineLogPanel uses backend-native fallback
    expect(state.subTaskIds).toEqual(['task-1', 'task-1', 'task-1']);
    expect(state.checkpoints).toEqual([]);
    expect(state.finishedAt).toBeDefined();
    // currentStageIndex should be last completed (2)
    expect(state.currentStageIndex).toBe(2);
  });

  it('sorts stages by stageIndex regardless of input order', () => {
    const stages = makeStages([
      { id: 'r2', agentId: 'developer-agent',  status: 'completed', stageIndex: 2 },
      { id: 'r0', agentId: 'senior-architect', status: 'completed', stageIndex: 0 },
      { id: 'r1', agentId: 'ux-api-designer',  status: 'completed', stageIndex: 1 },
    ]);

    const state = buildPipelineGroupState(PIPELINE_RUN_ID, stages);

    expect(state.stages).toEqual(['senior-architect', 'ux-api-designer', 'developer-agent']);
    expect(state.stageRunIds).toBeUndefined();
  });

  it('handles mixed running + completed pipeline (currentStageIndex = running stage)', () => {
    const stages = makeStages([
      { id: 'r0', agentId: 'senior-architect', status: 'completed', stageIndex: 0 },
      { id: 'r1', agentId: 'ux-api-designer',  status: 'running',   stageIndex: 1 },
    ]);

    const state = buildPipelineGroupState(PIPELINE_RUN_ID, stages);

    expect(state.status).toBe('running');
    expect(state.currentStageIndex).toBe(1);
    expect(state.finishedAt).toBeUndefined(); // not all finished
  });

  it('handles all-failed pipeline (aggregate = failed, currentStageIndex = failed stage)', () => {
    const stages = makeStages([
      { id: 'r0', agentId: 'senior-architect', status: 'completed', stageIndex: 0 },
      { id: 'r1', agentId: 'developer-agent',  status: 'failed',    stageIndex: 1 },
    ]);

    const state = buildPipelineGroupState(PIPELINE_RUN_ID, stages);

    expect(state.status).toBe('failed');
    expect(state.currentStageIndex).toBe(1); // points to failed stage
  });
});
