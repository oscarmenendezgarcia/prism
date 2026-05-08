/**
 * Component tests for PipelineLogPanel.
 * ADR-1 (log-viewer) T-010: render, close button, stage selection, view toggle.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { useAppStore } from '../../src/stores/useAppStore';
import { usePipelineLogStore } from '../../src/stores/usePipelineLogStore';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
  getStageLog:    vi.fn().mockResolvedValue(''),
  getBackendRun:  vi.fn().mockResolvedValue({ runId: 'run-1', status: 'running', stages: ['senior-architect', 'ux-api-designer', 'developer-agent', 'qa-engineer-e2e'], stageStatuses: [], currentStage: 0, spaceId: 's', taskId: 't', createdAt: new Date().toISOString() }),
  getStagePrompt: vi.fn().mockResolvedValue('## TASK CONTEXT\nTitle: Test task\n'),
  getStageEvents: vi.fn().mockResolvedValue({ schemaVersion: 1, events: [], nextSince: 0, complete: true, stageStatus: 'running' }),
  LogNotAvailableError: class LogNotAvailableError extends Error {
    constructor() { super('LOG_NOT_AVAILABLE'); this.name = 'LogNotAvailableError'; }
  },
  PromptNotAvailableError: class PromptNotAvailableError extends Error {
    constructor() { super('PROMPT_NOT_AVAILABLE'); this.name = 'PromptNotAvailableError'; }
  },
  EventsNotAvailableError: class EventsNotAvailableError extends Error {
    constructor() { super('EVENTS_NOT_AVAILABLE'); this.name = 'EventsNotAvailableError'; }
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
  listRuns: vi.fn().mockResolvedValue([]),
  previewPipelinePrompts: vi.fn(),
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


import { PipelineLogPanel } from '../../src/components/pipeline-log/PipelineLogPanel';
import * as apiClient from '../../src/api/client';

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
    logPanelOpen:            true,
    selectedStageIndex:      0,
    stageView:               {},
    stagePrompts:            {},
    stagePromptLoading:      {},
    stageEvents:             {},
    stageEventsNextSince:    {},
    stageEventsLoading:      {},
    stageEventsError:        {},
    stageEventsNotAvailable: {},
  } as any);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStores();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
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
  it('shows "No pipeline runs yet." message when no runId in pipelineState', async () => {
    const stateWithoutRunId = { ...BASE_PIPELINE_STATE, runId: undefined };
    useAppStore.setState({ pipelineState: stateWithoutRunId } as any);
    await act(async () => { renderPanel(); });
    // T-008 updated the empty-state text from "No active pipeline run." to "No pipeline runs yet."
    expect(screen.getByText('No pipeline runs yet.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T-008: view toggle
// ---------------------------------------------------------------------------

describe('PipelineLogPanel — T-008 view toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fake timers conflict with waitFor — use real timers for these async tests.
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useFakeTimers();
  });

  it('renders "Logs", "Prompt" and "Metrics" toggle buttons when run is active', async () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    await act(async () => { renderPanel(); });

    expect(screen.getByRole('button', { name: /^Logs$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Prompt$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Metrics$/i })).toBeInTheDocument();
  });

  it('"Logs" button is active by default (aria-pressed=true)', async () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    await act(async () => { renderPanel(); });

    const logsBtn = screen.getByRole('button', { name: /^Logs$/i });
    expect(logsBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('"Prompt" button has aria-pressed=false by default', async () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    await act(async () => { renderPanel(); });

    const promptBtn = screen.getByRole('button', { name: /^Prompt$/i });
    expect(promptBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking "Prompt" button triggers getStagePrompt and shows content', async () => {
    const mockGetStagePrompt = vi.mocked(apiClient.getStagePrompt);
    mockGetStagePrompt.mockResolvedValue('## TASK CONTEXT\nTitle: Test task\n');

    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    await act(async () => { renderPanel(); });

    const promptBtn = screen.getByRole('button', { name: /^Prompt$/i });
    await act(async () => { fireEvent.click(promptBtn); });

    await waitFor(() => {
      expect(mockGetStagePrompt).toHaveBeenCalledWith('run-1', 0);
    });
  });

  it('shows "Prompt not available yet." when getStagePrompt throws PromptNotAvailableError', async () => {
    const { PromptNotAvailableError } = await import('../../src/api/client');
    const mockGetStagePrompt = vi.mocked(apiClient.getStagePrompt);
    mockGetStagePrompt.mockRejectedValue(new PromptNotAvailableError());

    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    usePipelineLogStore.setState({
      selectedStageIndex: 0,
      stageView:    {},
      stagePrompts: {},
      stagePromptLoading: {},
    });
    await act(async () => { renderPanel(); });

    const promptBtn = screen.getByRole('button', { name: /^Prompt$/i });
    await act(async () => { fireEvent.click(promptBtn); });

    await waitFor(() => {
      expect(screen.getByText('Prompt not available yet.')).toBeInTheDocument();
    });
  });
});
