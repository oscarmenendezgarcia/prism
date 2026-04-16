/**
 * Unit tests for the groupRuns() utility.
 * ADR-1 (pipeline-run-history-bridge) T-008.
 */

import { describe, it, expect } from 'vitest';
import { groupRuns, computeAggregateStatus } from '../../src/components/agent-run-history/groupRuns';
import type { AgentRunRecord } from '../../src/types';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let _counter = 0;
function makeRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  _counter++;
  return {
    id:               `run_${_counter}`,
    taskId:           'task-001',
    taskTitle:        'Test Task',
    agentId:          'developer-agent',
    agentDisplayName: 'Developer Agent',
    spaceId:          'space-1',
    spaceName:        'Prism',
    status:           'completed',
    startedAt:        new Date(Date.now() - _counter * 60000).toISOString(),
    completedAt:      new Date().toISOString(),
    durationMs:       1000,
    cliCommand:       '',
    promptPath:       '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeAggregateStatus
// ---------------------------------------------------------------------------

describe('computeAggregateStatus', () => {
  it('returns "running" when any stage is running', () => {
    expect(computeAggregateStatus([
      makeRun({ status: 'completed' }),
      makeRun({ status: 'running', completedAt: null, durationMs: null }),
    ])).toBe('running');
  });

  it('returns "failed" when any stage is failed and none running', () => {
    expect(computeAggregateStatus([
      makeRun({ status: 'completed' }),
      makeRun({ status: 'failed' }),
    ])).toBe('failed');
  });

  it('returns "cancelled" when any stage is cancelled and none running/failed', () => {
    expect(computeAggregateStatus([
      makeRun({ status: 'completed' }),
      makeRun({ status: 'cancelled' }),
    ])).toBe('cancelled');
  });

  it('returns "completed" when all stages are completed', () => {
    expect(computeAggregateStatus([
      makeRun({ status: 'completed' }),
      makeRun({ status: 'completed' }),
    ])).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// groupRuns
// ---------------------------------------------------------------------------

describe('groupRuns — empty input', () => {
  it('returns [] for empty input', () => {
    expect(groupRuns([])).toEqual([]);
  });
});

describe('groupRuns — all singles (no pipelineRunId)', () => {
  it('returns all runs as type=single when none have pipelineRunId', () => {
    const runs = [makeRun(), makeRun(), makeRun()];
    const groups = groupRuns(runs);
    expect(groups).toHaveLength(3);
    groups.forEach((g) => expect(g.type).toBe('single'));
  });

  it('preserves the run object on each single group', () => {
    const run = makeRun({ id: 'single-1' });
    const [group] = groupRuns([run]);
    expect(group.type).toBe('single');
    if (group.type === 'single') {
      expect(group.run.id).toBe('single-1');
    }
  });
});

describe('groupRuns — single-entry pipeline collapsed to single', () => {
  it('returns type=single for a pipeline group with only one entry', () => {
    const run = makeRun({ pipelineRunId: 'run-abc', stageIndex: 0 });
    const [group] = groupRuns([run]);
    expect(group.type).toBe('single');
    if (group.type === 'single') {
      expect(group.run.id).toBe(run.id);
    }
  });
});

describe('groupRuns — multi-stage pipeline group', () => {
  it('groups 3 entries with the same pipelineRunId into one pipeline group', () => {
    const pipelineRunId = 'run-xyz';
    const runs = [
      makeRun({ id: 'r1', pipelineRunId, stageIndex: 0, startedAt: new Date(Date.now() - 3000).toISOString() }),
      makeRun({ id: 'r2', pipelineRunId, stageIndex: 1, startedAt: new Date(Date.now() - 2000).toISOString() }),
      makeRun({ id: 'r3', pipelineRunId, stageIndex: 2, startedAt: new Date(Date.now() - 1000).toISOString() }),
    ];
    const groups = groupRuns(runs);
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe('pipeline');
    if (groups[0].type === 'pipeline') {
      expect(groups[0].stages).toHaveLength(3);
      expect(groups[0].pipelineRunId).toBe(pipelineRunId);
    }
  });

  it('sorts stages by stageIndex within the group', () => {
    const pipelineRunId = 'run-ord';
    // Provide them out of order.
    const runs = [
      makeRun({ id: 'r3', pipelineRunId, stageIndex: 2, startedAt: new Date(Date.now() - 1000).toISOString() }),
      makeRun({ id: 'r1', pipelineRunId, stageIndex: 0, startedAt: new Date(Date.now() - 3000).toISOString() }),
      makeRun({ id: 'r2', pipelineRunId, stageIndex: 1, startedAt: new Date(Date.now() - 2000).toISOString() }),
    ];
    const groups = groupRuns(runs);
    expect(groups[0].type).toBe('pipeline');
    if (groups[0].type === 'pipeline') {
      const indices = groups[0].stages.map((s) => s.stageIndex);
      expect(indices).toEqual([0, 1, 2]);
    }
  });

  it('computes aggregateStatus correctly for a mixed-status pipeline group', () => {
    const pipelineRunId = 'run-agg';
    const runs = [
      makeRun({ id: 'r1', pipelineRunId, stageIndex: 0, status: 'completed', startedAt: new Date(Date.now() - 3000).toISOString() }),
      makeRun({ id: 'r2', pipelineRunId, stageIndex: 1, status: 'running', completedAt: null, durationMs: null, startedAt: new Date(Date.now() - 2000).toISOString() }),
    ];
    const groups = groupRuns(runs);
    expect(groups[0].type).toBe('pipeline');
    if (groups[0].type === 'pipeline') {
      expect(groups[0].aggregateStatus).toBe('running');
    }
  });
});

describe('groupRuns — mixed singles and pipelines, newest-first order', () => {
  it('interleaves single and pipeline groups sorted by startedAt newest-first', () => {
    const now = Date.now();
    const pipelineRunId = 'run-mix';
    // Pipeline group starts 5 seconds ago.
    const p0 = makeRun({ id: 'p0', pipelineRunId, stageIndex: 0, startedAt: new Date(now - 5000).toISOString() });
    const p1 = makeRun({ id: 'p1', pipelineRunId, stageIndex: 1, startedAt: new Date(now - 4000).toISOString() });
    // Single run starts 2 seconds ago — should appear first (newest).
    const single = makeRun({ id: 's1', startedAt: new Date(now - 2000).toISOString() });

    const groups = groupRuns([p0, p1, single]);

    expect(groups).toHaveLength(2);
    expect(groups[0].type).toBe('single');
    if (groups[0].type === 'single') {
      expect(groups[0].run.id).toBe('s1');
    }
    expect(groups[1].type).toBe('pipeline');
  });
});
