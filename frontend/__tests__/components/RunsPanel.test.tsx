/**
 * Component tests for RunsPanel.
 * T-004 (runs-panel-unification): ACTIVOS/HISTORIAL sections, filter pills,
 * row expansion, close button, empty states.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RunsPanel } from '../../src/components/runs-panel/RunsPanel';
import { useRunHistoryStore } from '../../src/stores/useRunHistoryStore';
import { usePipelineLogStore } from '../../src/stores/usePipelineLogStore';
import { useAppStore } from '../../src/stores/useAppStore';
import type { AgentRunRecord } from '../../src/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
  getSpaces:     vi.fn().mockResolvedValue([]),
  getTasks:      vi.fn().mockResolvedValue({ todo: [], 'in-progress': [], done: [] }),
  getAgentRuns:  vi.fn().mockResolvedValue({ runs: [], total: 0 }),
  getBackendRun: vi.fn().mockResolvedValue({ stageStatuses: [] }),
  getStageEvents: vi.fn().mockResolvedValue({ events: [], nextSince: 0, complete: false }),
  getStageLog:   vi.fn().mockResolvedValue(''),
  getStagePrompt: vi.fn().mockResolvedValue(''),
  getStageMetrics: vi.fn().mockResolvedValue({}),
  getSystemInfo:  vi.fn().mockResolvedValue({ platform: 'linux', version: '0.0.0' }),
  getSettings:    vi.fn().mockResolvedValue({}),
  getAgents:      vi.fn().mockResolvedValue([]),
  getConfigFiles: vi.fn().mockResolvedValue([]),
  createAgentRun: vi.fn(), updateAgentRun: vi.fn(),
  startRun:       vi.fn(), deleteRun:      vi.fn(),
}));

// ResizeObserver required by some panel components
if (typeof ResizeObserver === 'undefined') {
  (global as any).ResizeObserver = class {
    observe()    {}
    unobserve()  {}
    disconnect() {}
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id:               `run-${Math.random().toString(36).slice(2)}`,
    taskId:           'task-1',
    taskTitle:        'feat: test feature',
    agentId:          'developer-agent',
    agentDisplayName: 'Developer',
    spaceId:          'space-1',
    spaceName:        'My Space',
    status:           'completed',
    startedAt:        new Date(Date.now() - 120000).toISOString(),
    completedAt:      new Date().toISOString(),
    durationMs:       120000,
    cliCommand:       'claude',
    promptPath:       '/tmp/prompt.md',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  useRunHistoryStore.setState({ runs: [], filter: 'all', taskIdFilter: null, loading: false });
  usePipelineLogStore.setState({
    runsPanelOpen: true,
    logPanelOpen:  true,
    unseenCount:   0,
    selectedStageIndex: 0,
    stageView: {},
    stageLogs: {},
    stageLoading: {},
    stageErrors: {},
  });
  useAppStore.setState({
    pipelineStates:           {},
    historicalPipelineStates: {},
    spaces:                   [],
    activeSpaceId:            '',
  } as any);
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('RunsPanel — empty state', () => {
  it('shows "No runs yet" when there are no runs', () => {
    useRunHistoryStore.setState({ runs: [], filter: 'all' });
    render(<RunsPanel />);
    expect(screen.getByText('No runs yet')).toBeInTheDocument();
  });

  it('shows "No running runs" when filter is running and no active runs', () => {
    useRunHistoryStore.setState({
      runs: [makeRun({ status: 'completed' })],
      filter: 'running',
    });
    render(<RunsPanel />);
    expect(screen.getByText('No running runs')).toBeInTheDocument();
  });

  it('shows loading state when loading is true and no runs', () => {
    useRunHistoryStore.setState({ runs: [], filter: 'all', loading: true });
    render(<RunsPanel />);
    expect(screen.getByText('Loading runs…')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ACTIVOS / HISTORIAL sections
// ---------------------------------------------------------------------------

describe('RunsPanel — sections', () => {
  it('shows ACTIVOS section for running runs', () => {
    const active = makeRun({ status: 'running', completedAt: null, durationMs: null });
    useRunHistoryStore.setState({ runs: [active] });
    render(<RunsPanel />);
    expect(screen.getByText(/activos/i)).toBeInTheDocument();
  });

  it('shows HISTORIAL section for completed runs', () => {
    const completed = makeRun({ status: 'completed' });
    useRunHistoryStore.setState({ runs: [completed] });
    render(<RunsPanel />);
    expect(screen.getByText(/historial/i)).toBeInTheDocument();
  });

  it('shows both sections when both active and historical runs exist', () => {
    const active    = makeRun({ status: 'running', completedAt: null, durationMs: null });
    const completed = makeRun({ status: 'completed', taskTitle: 'feat: done' });
    useRunHistoryStore.setState({ runs: [active, completed] });
    render(<RunsPanel />);
    expect(screen.getByText(/activos/i)).toBeInTheDocument();
    expect(screen.getByText(/historial/i)).toBeInTheDocument();
  });

  it('does NOT show ACTIVOS section when there are no active runs', () => {
    const completed = makeRun({ status: 'completed' });
    useRunHistoryStore.setState({ runs: [completed] });
    render(<RunsPanel />);
    // HISTORIAL should be present, ACTIVOS should not
    const sections = screen.queryAllByText(/activos/i);
    expect(sections.length).toBe(0);
  });

  it('does NOT show HISTORIAL section when there are no historical runs', () => {
    const active = makeRun({ status: 'running', completedAt: null, durationMs: null });
    useRunHistoryStore.setState({ runs: [active] });
    render(<RunsPanel />);
    const sections = screen.queryAllByText(/historial/i);
    expect(sections.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Filter pill bar
// ---------------------------------------------------------------------------

describe('RunsPanel — filter pills', () => {
  it('renders all filter options', () => {
    render(<RunsPanel />);
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Running' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Completed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelled' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Failed' })).toBeInTheDocument();
  });

  it('"All" pill is active by default', () => {
    render(<RunsPanel />);
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking a filter pill updates the store filter', () => {
    render(<RunsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Running' }));
    expect(useRunHistoryStore.getState().filter).toBe('running');
  });

  it('the active filter pill has aria-pressed=true', () => {
    useRunHistoryStore.setState({ filter: 'completed' });
    render(<RunsPanel />);
    expect(screen.getByRole('button', { name: 'Completed' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });
});

// ---------------------------------------------------------------------------
// Close button
// ---------------------------------------------------------------------------

describe('RunsPanel — close button', () => {
  it('close button sets runsPanelOpen to false', () => {
    usePipelineLogStore.setState({ runsPanelOpen: true, logPanelOpen: true });
    render(<RunsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /close runs panel/i }));
    expect(usePipelineLogStore.getState().runsPanelOpen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Run rows — expand / collapse [↗] button
// ---------------------------------------------------------------------------

describe('RunsPanel — run row expand button', () => {
  it('each run row has an expand/open button', async () => {
    const run = makeRun({ status: 'completed' });
    useRunHistoryStore.setState({ runs: [run] });
    render(<RunsPanel />);
    const expandBtns = screen.getAllByRole('button', { name: /open logs|collapse logs/i });
    expect(expandBtns.length).toBeGreaterThanOrEqual(1);
  });

  it('expand button has correct aria-label including task title', () => {
    const run = makeRun({ status: 'completed', taskTitle: 'feat: my task' });
    useRunHistoryStore.setState({ runs: [run] });
    render(<RunsPanel />);
    expect(
      screen.getByRole('button', { name: /open logs for feat: my task/i })
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task ID filter chip
// ---------------------------------------------------------------------------

describe('RunsPanel — taskIdFilter chip', () => {
  it('shows filter chip when taskIdFilter is set', () => {
    useRunHistoryStore.setState({ taskIdFilter: 'task-1', runs: [] });
    render(<RunsPanel />);
    expect(screen.getByText('Filtering by task')).toBeInTheDocument();
  });

  it('does not show filter chip when taskIdFilter is null', () => {
    useRunHistoryStore.setState({ taskIdFilter: null, runs: [] });
    render(<RunsPanel />);
    expect(screen.queryByText('Filtering by task')).toBeNull();
  });

  it('clicking clear filter button clears taskIdFilter', () => {
    useRunHistoryStore.setState({ taskIdFilter: 'task-1', runs: [] });
    render(<RunsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /clear task filter/i }));
    expect(useRunHistoryStore.getState().taskIdFilter).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Active run indicator dot in panel header
// ---------------------------------------------------------------------------

describe('RunsPanel — active run header dot', () => {
  it('shows pulsing indicator when a run is active', () => {
    const active = makeRun({ status: 'running', completedAt: null, durationMs: null });
    useRunHistoryStore.setState({ runs: [active] });
    render(<RunsPanel />);
    expect(screen.getByTitle('A pipeline run is currently active')).toBeInTheDocument();
  });

  it('does not show pulsing indicator when no runs are active', () => {
    const completed = makeRun({ status: 'completed' });
    useRunHistoryStore.setState({ runs: [completed] });
    render(<RunsPanel />);
    expect(screen.queryByTitle('A pipeline run is currently active')).toBeNull();
  });
});
