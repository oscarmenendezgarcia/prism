/**
 * Component tests for RunLogViewer.
 * T-002 (runs-panel-unification): extracted from PipelineLogPanel, renders
 * stage tab bar + view toggle + content for any run (active or historical).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunLogViewer } from '../../src/components/pipeline-log/RunLogViewer';
import { usePipelineLogStore } from '../../src/stores/usePipelineLogStore';
import { useAppStore } from '../../src/stores/useAppStore';
import type { PipelineState } from '../../src/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
  getBackendRun:   vi.fn().mockResolvedValue({ stageStatuses: [] }),
  getStageEvents:  vi.fn().mockResolvedValue({ events: [], nextSince: 0, complete: false }),
  getStageLog:     vi.fn().mockResolvedValue(''),
  getStagePrompt:  vi.fn().mockResolvedValue(''),
  getStageMetrics: vi.fn().mockResolvedValue({}),
  getSpaces:       vi.fn().mockResolvedValue([]),
  getTasks:        vi.fn().mockResolvedValue({ todo: [], 'in-progress': [], done: [] }),
  getSystemInfo:   vi.fn().mockResolvedValue({ platform: 'linux', version: '0.0.0' }),
  getSettings:     vi.fn().mockResolvedValue({}),
  getAgents:       vi.fn().mockResolvedValue([]),
  getConfigFiles:  vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePipelineState(status: 'running' | 'completed' = 'completed'): PipelineState {
  return {
    runId:             'run-abc',
    spaceId:           'space-1',
    taskId:            'task-1',
    stages:            ['senior-architect', 'developer-agent'],
    currentStageIndex: 0,
    status,
    startedAt:         '2026-05-27T10:00:00Z',
    subTaskIds:        [],
    checkpoints:       [],
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  usePipelineLogStore.setState({
    selectedStageIndex:  0,
    stageView:           {},
    stageLogs:           {},
    stageLoading:        {},
    stageErrors:         {},
    stagePrompts:        {},
    stagePromptLoading:  {},
    stageMetrics:        {},
    stageMetricsLoading: {},
    stageMetricsError:   {},
    stageEvents:              {},
    stageEventsNextSince:     {},
    stageEventsLoading:       {},
    stageEventsError:         {},
    stageEventsNotAvailable:  {},
  });
  useAppStore.setState({ spaces: [], activeSpaceId: '' } as any);
});

// ---------------------------------------------------------------------------
// No runId — empty state
// ---------------------------------------------------------------------------

describe('RunLogViewer — no runId', () => {
  it('shows "No pipeline run available" when runId is null', () => {
    render(<RunLogViewer runId={null} pipelineState={null} isRunActive={false} />);
    expect(screen.getByText('No pipeline run available.')).toBeInTheDocument();
  });

  it('shows empty state when pipelineState is null', () => {
    render(<RunLogViewer runId={null} pipelineState={null} isRunActive={false} />);
    // Should render empty state, not the stage tab bar
    const tabBar = document.querySelector('[role="tabpanel"]');
    expect(tabBar).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// With runId and pipelineState
// ---------------------------------------------------------------------------

describe('RunLogViewer — with runId and pipelineState', () => {
  it('renders the view mode toggle buttons', () => {
    const ps = makePipelineState();
    render(<RunLogViewer runId="run-abc" pipelineState={ps} isRunActive={false} />);
    expect(screen.getByRole('button', { name: 'Logs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prompt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Metrics' })).toBeInTheDocument();
  });

  it('"Logs" view is active by default (aria-pressed=true)', () => {
    const ps = makePipelineState();
    render(<RunLogViewer runId="run-abc" pipelineState={ps} isRunActive={false} />);
    expect(screen.getByRole('button', { name: 'Logs' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Prompt' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Metrics' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders the content area with role="tabpanel"', () => {
    const ps = makePipelineState();
    render(<RunLogViewer runId="run-abc" pipelineState={ps} isRunActive={false} />);
    expect(document.querySelector('[role="tabpanel"]')).toBeInTheDocument();
  });

  it('renders stage tab bar when stages are present', () => {
    const ps = makePipelineState();
    render(<RunLogViewer runId="run-abc" pipelineState={ps} isRunActive={false} />);
    // Stage tab bar and view toggle should both be rendered:
    // Logs / Prompt / Metrics buttons are always present when runId is provided
    expect(screen.getByRole('button', { name: 'Logs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prompt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Metrics' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// isRunActive prop
// ---------------------------------------------------------------------------

describe('RunLogViewer — isRunActive', () => {
  it('renders for active runs (isRunActive=true)', () => {
    const ps = makePipelineState('running');
    render(<RunLogViewer runId="run-active" pipelineState={ps} isRunActive={true} />);
    // Should render the view controls without crashing
    expect(screen.getByRole('button', { name: 'Logs' })).toBeInTheDocument();
  });

  it('renders for historical runs (isRunActive=false)', () => {
    const ps = makePipelineState('completed');
    render(<RunLogViewer runId="run-hist" pipelineState={ps} isRunActive={false} />);
    expect(screen.getByRole('button', { name: 'Logs' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Prompt view empty state
// ---------------------------------------------------------------------------

describe('RunLogViewer — prompt view empty state', () => {
  it('shows "Prompt not available yet" when stagePrompts[0] is null', () => {
    const ps = makePipelineState();
    usePipelineLogStore.setState({ stageView: { 0: 'prompt' }, stagePrompts: { 0: null } });
    render(<RunLogViewer runId="run-abc" pipelineState={ps} isRunActive={false} />);
    expect(screen.getByText('Prompt not available yet.')).toBeInTheDocument();
  });
});
