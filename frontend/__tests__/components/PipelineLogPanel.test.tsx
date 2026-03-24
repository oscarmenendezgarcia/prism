/**
 * Component tests for PipelineLogPanel.
 * ADR-1 (log-viewer) T-010: render, close button, stage selection, LogViewer content.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useAppStore } from '../../src/stores/useAppStore';
import { usePipelineLogStore } from '../../src/stores/usePipelineLogStore';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
  getStageLog:    vi.fn().mockResolvedValue(''),
  getBackendRun:  vi.fn().mockResolvedValue({ runId: 'run-1', status: 'running', stages: ['senior-architect'], stageStatuses: [], spaceId: 's', taskId: 't', createdAt: new Date().toISOString() }),
  LogNotAvailableError: class LogNotAvailableError extends Error {
    constructor() { super('LOG_NOT_AVAILABLE'); this.name = 'LogNotAvailableError'; }
  },
  // Other methods needed by useAppStore if it is imported transitively
  getSpaces: vi.fn().mockResolvedValue([]),
  getTasks: vi.fn().mockResolvedValue({ todo: [], 'in-progress': [], done: [] }),
  createTask: vi.fn(), moveTask: vi.fn(), deleteTask: vi.fn(),
  createSpace: vi.fn(), renameSpace: vi.fn(), deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
  createAgentRun: vi.fn(), updateAgentRun: vi.fn(), getAgentRuns: vi.fn().mockResolvedValue({ runs: [], total: 0 }),
  startRun: vi.fn(), deleteRun: vi.fn(),
  getAgents: vi.fn().mockResolvedValue([]),
  generatePrompt: vi.fn(), getSettings: vi.fn(), saveSettings: vi.fn(),
  getConfigFiles: vi.fn(), getConfigFile: vi.fn(), saveConfigFile: vi.fn(),
  getAgent: vi.fn(),
  updateTask: vi.fn(),
}));

// Mock usePanelResize to avoid localStorage complexities in tests.
vi.mock('../../src/hooks/usePanelResize', () => ({
  usePanelResize: () => ({
    width:           480,
    handleMouseDown: vi.fn(),
    minWidth:        320,
    maxWidth:        900,
  }),
}));

// Mock usePipelineLogPolling — we don't want real fetches in panel tests.
vi.mock('../../src/hooks/usePipelineLogPolling', () => ({
  usePipelineLogPolling: vi.fn(),
}));

import { PipelineLogPanel } from '../../src/components/pipeline-log/PipelineLogPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_PIPELINE_STATE = {
  spaceId:           'space-1',
  taskId:            'task-1',
  stages:            ['senior-architect', 'ux-api-designer', 'developer-agent', 'qa-engineer-e2e'] as any,
  currentStageIndex: 0,
  startedAt:         new Date().toISOString(),
  status:            'running' as const,
  subTaskIds:        [],
  checkpoints:       [],
  runId:             'run-1',
};

function resetStores() {
  useAppStore.setState({ pipelineState: null } as any);
  usePipelineLogStore.setState({
    logPanelOpen:       true,
    selectedStageIndex: 0,
    stageLogs:          {},
    stageLoading:       {},
    stageErrors:        {},
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStores();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderPanel() {
  return render(<PipelineLogPanel />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PipelineLogPanel — structural render', () => {
  it('renders as an aside with complementary role', async () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    await act(async () => { renderPanel(); });
    const aside = screen.getByRole('complementary', { name: /pipeline log viewer/i });
    expect(aside).toBeInTheDocument();
  });

  it('renders "Pipeline Logs" in the panel header', async () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    await act(async () => { renderPanel(); });
    expect(screen.getByText('Pipeline Logs')).toBeInTheDocument();
  });

  it('renders a close button', async () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    await act(async () => { renderPanel(); });
    expect(screen.getByRole('button', { name: /close pipeline log panel/i })).toBeInTheDocument();
  });

  it('renders StageTabBar when stages are available', async () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    await act(async () => { renderPanel(); });
    // 4 tabs = 4 stages
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });
});

describe('PipelineLogPanel — close button', () => {
  it('calls setLogPanelOpen(false) when close button is clicked', async () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    await act(async () => { renderPanel(); });

    const closeBtn = screen.getByRole('button', { name: /close pipeline log panel/i });
    fireEvent.click(closeBtn);

    expect(usePipelineLogStore.getState().logPanelOpen).toBe(false);
  });
});

describe('PipelineLogPanel — stage tab selection', () => {
  it('updates selectedStageIndex in the store when a tab is clicked', async () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    await act(async () => { renderPanel(); });

    const tabs = screen.getAllByRole('tab');
    fireEvent.click(tabs[2]); // Click "Dev" (index 2)

    expect(usePipelineLogStore.getState().selectedStageIndex).toBe(2);
  });
});

describe('PipelineLogPanel — no runId state', () => {
  it('shows "No active pipeline run." message when no runId in pipelineState', async () => {
    const stateWithoutRunId = { ...BASE_PIPELINE_STATE, runId: undefined };
    useAppStore.setState({ pipelineState: stateWithoutRunId } as any);
    await act(async () => { renderPanel(); });
    expect(screen.getByText('No active pipeline run.')).toBeInTheDocument();
  });
});

describe('PipelineLogPanel — log content routing', () => {
  it('shows "Waiting for output..." for the running stage with no log content', async () => {
    // Stage 0 is currentStageIndex=0 and pipeline status=running → derived status=running.
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    usePipelineLogStore.setState({ stageLogs: {}, stageErrors: {} });
    await act(async () => { renderPanel(); });
    // The LogViewer should render the running empty state.
    expect(screen.getByText('Waiting for output...')).toBeInTheDocument();
  });

  it('shows "Stage not started yet." for a pending stage (index > currentStageIndex)', async () => {
    // Stage 3 (QA) is pending while only stage 0 is running.
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    usePipelineLogStore.setState({
      selectedStageIndex: 3, // QA stage — not started
      stageLogs: {},
      stageErrors: {},
    });
    await act(async () => { renderPanel(); });
    expect(screen.getByText('Stage not started yet.')).toBeInTheDocument();
  });

  it('displays log content for the selected stage', async () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    usePipelineLogStore.setState({
      selectedStageIndex: 0,
      stageLogs: { 0: 'Hello from stage 0 log\nLine 2 of output' },
    });
    await act(async () => { renderPanel(); });
    expect(screen.getByText(/Hello from stage 0 log/)).toBeInTheDocument();
  });

  it('displays error message from stageErrors for the selected stage', async () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    usePipelineLogStore.setState({
      selectedStageIndex: 0,
      stageLogs:   {},
      stageErrors: { 0: 'Connection refused' },
    });
    await act(async () => { renderPanel(); });
    expect(screen.getByText('Connection refused')).toBeInTheDocument();
  });
});
