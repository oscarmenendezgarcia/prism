/**
 * Unit tests for useAppStore.openLogPanelForRun.
 * T-003 acceptance criteria: fast path, hydration, 404 error toast, stageIndex selection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentRunRecord, PipelineState, PipelineStage } from '@/types';

// ── API mock ──────────────────────────────────────────────────────────────────
vi.mock('@/api/client', () => ({
  getBackendRun:     vi.fn(),
  resumeRun:         vi.fn(),
  deleteRun:         vi.fn().mockResolvedValue(undefined),
  getTasks:          vi.fn().mockResolvedValue({ todo: [], 'in-progress': [], done: [] }),
  getSpaces:         vi.fn().mockResolvedValue([]),
  getSystemInfo:     vi.fn().mockResolvedValue({ platform: 'linux', version: '0.0.0' }),
  generatePrompt:    vi.fn(),
  startRun:          vi.fn(),
  listRuns:          vi.fn().mockResolvedValue([]),
  getAgents:         vi.fn().mockResolvedValue([]),
  getConfigFiles:    vi.fn().mockResolvedValue([]),
  moveTask:          vi.fn().mockResolvedValue({}),
  createTask:        vi.fn().mockResolvedValue({}),
  deleteTask:        vi.fn().mockResolvedValue(undefined),
  getRunStagePrompt: vi.fn().mockResolvedValue({ prompt: '' }),
}));

import { useAppStore } from '@/stores/useAppStore';
import { usePipelineLogStore } from '@/stores/usePipelineLogStore';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAgentRunRecord(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id:               'run-abc',
    taskId:           'task-1',
    taskTitle:        'feat: test',
    agentId:          'developer-agent',
    agentDisplayName: 'Developer',
    spaceId:          'space-1',
    spaceName:        'My Space',
    status:           'completed',
    startedAt:        '2026-05-18T10:00:00.000Z',
    completedAt:      '2026-05-18T10:05:00.000Z',
    durationMs:       300000,
    cliCommand:       'claude',
    promptPath:       '/tmp/p.md',
    ...overrides,
  };
}

function makePipelineState(runId: string): PipelineState {
  return {
    runId,
    spaceId:           'space-1',
    taskId:            'task-1',
    stages:            ['senior-architect'] as PipelineStage[],
    currentStageIndex: 0,
    status:            'running',
    startedAt:         '2026-05-18T10:00:00.000Z',
    subTaskIds:        [],
    checkpoints:       [],
  };
}

// ── Reset helper ──────────────────────────────────────────────────────────────

beforeEach(() => {
  useAppStore.setState({
    pipelineStates:      {},
    activePipelineRunId: null,
    pipelineState:       null,
  });
  usePipelineLogStore.setState({
    logPanelOpen:       false,
    logPanelRunId:      null,
    selectedStageIndex: 0,
    stageLogs:          {},
    stageLoading:       {},
    stageErrors:        {},
    stageView:          {},
    stagePrompts:       {},
    stagePromptLoading: {},
    stageMetrics:       {},
    stageMetricsLoading: {},
    stageMetricsError:  {},
    stageEvents:             {},
    stageEventsNextSince:    {},
    stageEventsLoading:      {},
    stageEventsError:        {},
    stageEventsNotAvailable: {},
    unseenCount:        0,
  });
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('openLogPanelForRun — single kind', () => {
  it('hydrates pipelineState and opens log panel for a completed single run', async () => {
    const run = makeAgentRunRecord({ id: 'run-abc', status: 'completed' });

    await useAppStore.getState().openLogPanelForRun({ kind: 'single', run });

    // pipelineStates should contain the new synthetic entry
    const states = useAppStore.getState().pipelineStates;
    expect(states['run-abc']).toBeDefined();
    expect(states['run-abc'].status).toBe('completed');
    expect(states['run-abc'].stages).toEqual(['developer-agent']);

    // Log panel should be open
    expect(usePipelineLogStore.getState().logPanelOpen).toBe(true);
    expect(usePipelineLogStore.getState().logPanelRunId).toBe('run-abc');
    expect(usePipelineLogStore.getState().selectedStageIndex).toBe(0);
  });

  it('uses fast path when pipelineState already exists — does NOT recreate it', async () => {
    const existing = makePipelineState('run-abc');
    useAppStore.setState({
      pipelineStates:      { 'run-abc': existing },
      activePipelineRunId: 'run-abc',
      pipelineState:       existing,
    });

    const run = makeAgentRunRecord({ id: 'run-abc', status: 'failed' });
    await useAppStore.getState().openLogPanelForRun({ kind: 'single', run });

    // Should NOT have replaced the existing state (still 'running')
    const state = useAppStore.getState().pipelineStates['run-abc'];
    expect(state.status).toBe('running'); // unchanged
    expect(usePipelineLogStore.getState().logPanelOpen).toBe(true);
    expect(usePipelineLogStore.getState().logPanelRunId).toBe('run-abc');
  });

  it('does NOT change activePipelineRunId when a live run is already active', async () => {
    const liveRun = makePipelineState('live-run');
    useAppStore.setState({
      pipelineStates:      { 'live-run': liveRun },
      activePipelineRunId: 'live-run',
      pipelineState:       liveRun,
    });

    const historicalRun = makeAgentRunRecord({ id: 'hist-run', status: 'completed' });
    await useAppStore.getState().openLogPanelForRun({ kind: 'single', run: historicalRun });

    // activePipelineRunId must still be the live run
    expect(useAppStore.getState().activePipelineRunId).toBe('live-run');
    // Historical run is added to pipelineStates
    expect(useAppStore.getState().pipelineStates['hist-run']).toBeDefined();
    // Log panel shows the historical run
    expect(usePipelineLogStore.getState().logPanelRunId).toBe('hist-run');
  });

  it('calls clearStageLogs before opening panel', async () => {
    // Seed some stale logs
    usePipelineLogStore.setState({ stageLogs: { 0: 'old log content' } });

    const run = makeAgentRunRecord({ id: 'run-def' });
    await useAppStore.getState().openLogPanelForRun({ kind: 'single', run });

    expect(usePipelineLogStore.getState().stageLogs).toEqual({});
  });
});

describe('openLogPanelForRun — pipeline kind', () => {
  const PIPELINE_ID = 'pipe-xyz';

  const stages = [
    makeAgentRunRecord({ id: 'r0', agentId: 'senior-architect',  stageIndex: 0, pipelineRunId: PIPELINE_ID }),
    makeAgentRunRecord({ id: 'r1', agentId: 'ux-api-designer',   stageIndex: 1, pipelineRunId: PIPELINE_ID }),
    makeAgentRunRecord({ id: 'r2', agentId: 'developer-agent',   stageIndex: 2, pipelineRunId: PIPELINE_ID }),
  ];

  it('hydrates multi-stage pipelineState with correct stageRunIds', async () => {
    await useAppStore.getState().openLogPanelForRun({
      kind: 'pipeline',
      pipelineRunId: PIPELINE_ID,
      stages,
    });

    const state = useAppStore.getState().pipelineStates[PIPELINE_ID];
    expect(state).toBeDefined();
    expect(state.stages).toEqual(['senior-architect', 'ux-api-designer', 'developer-agent']);
    expect(state.stageRunIds).toEqual({ 0: 'r0', 1: 'r1', 2: 'r2' });
    expect(state.runId).toBe('r2');
  });

  it('preselects the requested stageIndex in the log panel', async () => {
    await useAppStore.getState().openLogPanelForRun({
      kind: 'pipeline',
      pipelineRunId: PIPELINE_ID,
      stages,
      stageIndex: 2,
    });

    expect(usePipelineLogStore.getState().selectedStageIndex).toBe(2);
    expect(usePipelineLogStore.getState().logPanelRunId).toBe(PIPELINE_ID);
  });

  it('defaults to stage 0 when no stageIndex provided', async () => {
    await useAppStore.getState().openLogPanelForRun({
      kind: 'pipeline',
      pipelineRunId: PIPELINE_ID,
      stages,
    });

    expect(usePipelineLogStore.getState().selectedStageIndex).toBe(0);
  });
});
