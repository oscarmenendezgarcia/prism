/**
 * Tests for RunHistoryPanel component.
 * ADR-1 (Agent Run History) T-014.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRunHistoryStore } from '../../src/stores/useRunHistoryStore';
import type { AgentRunRecord } from '../../src/types';

// ── Mock API client — panel never makes real HTTP calls in tests ─────────────
vi.mock('../../src/api/client', () => ({
  getAgentRuns:  vi.fn().mockResolvedValue({ runs: [], total: 0 }),
  createAgentRun: vi.fn(),
  updateAgentRun: vi.fn(),
  getSpaces:     vi.fn(),
  getTasks:      vi.fn(),
  createTask:    vi.fn(),
  moveTask:      vi.fn(),
  deleteTask:    vi.fn(),
  createSpace:   vi.fn(),
  renameSpace:   vi.fn(),
  deleteSpace:   vi.fn(),
  getAttachmentContent: vi.fn(),
}));

// ── Mock usePanelResize — no real mouse/localStorage in unit tests ─────────
vi.mock('../../src/hooks/usePanelResize', () => ({
  usePanelResize: vi.fn().mockReturnValue({
    width:           360,
    handleMouseDown: vi.fn(),
    minWidth:        280,
    maxWidth:        640,
  }),
}));

import { RunHistoryPanel } from '../../src/components/agent-run-history/RunHistoryPanel';

function makeRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id:               'run_001',
    taskId:           'task-001',
    taskTitle:        'Test Task',
    agentId:          'developer-agent',
    agentDisplayName: 'Developer Agent',
    spaceId:          'default',
    spaceName:        'Prism',
    status:           'running',
    startedAt:        new Date(Date.now() - 30000).toISOString(),
    completedAt:      null,
    durationMs:       null,
    cliCommand:       'claude ...',
    promptPath:       '/tmp/prompt.md',
    ...overrides,
  };
}

beforeEach(() => {
  // Reset store to clean state before each test
  useRunHistoryStore.setState({
    runs:             [],
    filter:           'all',
    taskIdFilter:     null,
    loading:          false,
    historyPanelOpen: true,
  });
  vi.clearAllMocks();
});

describe('RunHistoryPanel — structure', () => {
  it('renders with role="complementary"', () => {
    render(<RunHistoryPanel />);
    expect(screen.getByRole('complementary')).toBeInTheDocument();
  });

  it('has aria-label="Agent run history"', () => {
    render(<RunHistoryPanel />);
    expect(screen.getByRole('complementary', { name: /agent run history/i })).toBeInTheDocument();
  });

  it('renders "Run History" header', () => {
    render(<RunHistoryPanel />);
    expect(screen.getByText('Run History')).toBeInTheDocument();
  });

  it('renders close button', () => {
    render(<RunHistoryPanel />);
    expect(screen.getByRole('button', { name: /close run history panel/i })).toBeInTheDocument();
  });
});

describe('RunHistoryPanel — empty state', () => {
  it('shows empty state when no runs and filter is all', () => {
    render(<RunHistoryPanel />);
    expect(screen.getByText('No runs yet')).toBeInTheDocument();
  });

  it('shows filter-specific empty message when filter set but no matching runs', () => {
    useRunHistoryStore.setState({ filter: 'running' });
    render(<RunHistoryPanel />);
    expect(screen.getByText('No running runs')).toBeInTheDocument();
  });
});

describe('RunHistoryPanel — run list', () => {
  it('renders a RunHistoryEntry for each run', () => {
    useRunHistoryStore.setState({
      runs: [
        makeRun({ id: 'run_a', agentDisplayName: 'Senior Architect' }),
        makeRun({ id: 'run_b', agentDisplayName: 'Developer Agent' }),
      ],
    });
    render(<RunHistoryPanel />);
    expect(screen.getByText('Senior Architect')).toBeInTheDocument();
    expect(screen.getByText('Developer Agent')).toBeInTheDocument();
  });

  it('shows the list as a ul with role="list"', () => {
    useRunHistoryStore.setState({
      runs: [makeRun()],
    });
    render(<RunHistoryPanel />);
    expect(screen.getByRole('list')).toBeInTheDocument();
  });
});

describe('RunHistoryPanel — filter pills', () => {
  it('renders all five filter pills', () => {
    render(<RunHistoryPanel />);
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Running' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Completed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelled' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Failed' })).toBeInTheDocument();
  });

  it('clicking a filter pill updates the store filter', () => {
    useRunHistoryStore.setState({
      runs: [
        makeRun({ id: 'run_r', status: 'running' }),
        makeRun({ id: 'run_c', status: 'completed', completedAt: new Date().toISOString(), durationMs: 1000 }),
      ],
    });
    render(<RunHistoryPanel />);

    // Click "Completed" filter
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
    expect(useRunHistoryStore.getState().filter).toBe('completed');
  });

  it('active filter pill has aria-pressed=true', () => {
    useRunHistoryStore.setState({ filter: 'running' });
    render(<RunHistoryPanel />);
    const runningBtn = screen.getByRole('button', { name: 'Running' });
    expect(runningBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('inactive filter pills have aria-pressed=false', () => {
    render(<RunHistoryPanel />);
    const runningBtn = screen.getByRole('button', { name: 'Running' });
    expect(runningBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('filtering hides runs that do not match', () => {
    useRunHistoryStore.setState({
      filter: 'completed',
      runs: [
        makeRun({ id: 'run_r', status: 'running', agentDisplayName: 'Agent Running' }),
        makeRun({ id: 'run_c', status: 'completed', completedAt: new Date().toISOString(), durationMs: 1000, agentDisplayName: 'Agent Completed' }),
      ],
    });
    render(<RunHistoryPanel />);
    expect(screen.getByText('Agent Completed')).toBeInTheDocument();
    expect(screen.queryByText('Agent Running')).not.toBeInTheDocument();
  });
});

describe('RunHistoryPanel — active run indicator', () => {
  it('shows pulsing dot in header when a run is active', () => {
    useRunHistoryStore.setState({
      runs: [makeRun({ status: 'running' })],
    });
    const { container } = render(<RunHistoryPanel />);
    const dot = container.querySelector('.animate-ping');
    expect(dot).toBeInTheDocument();
  });

  it('does NOT show pulsing dot when no active runs', () => {
    useRunHistoryStore.setState({
      runs: [makeRun({ status: 'completed', completedAt: new Date().toISOString(), durationMs: 1000 })],
    });
    const { container } = render(<RunHistoryPanel />);
    const dot = container.querySelector('.animate-ping');
    expect(dot).not.toBeInTheDocument();
  });
});

describe('RunHistoryPanel — taskIdFilter chip', () => {
  it('does not render the task filter chip when taskIdFilter is null', () => {
    render(<RunHistoryPanel />);
    expect(screen.queryByText('Filtering by task')).not.toBeInTheDocument();
  });

  it('renders the task filter chip when taskIdFilter is set', () => {
    useRunHistoryStore.setState({ taskIdFilter: 'task-001' });
    render(<RunHistoryPanel />);
    expect(screen.getByText('Filtering by task')).toBeInTheDocument();
  });

  it('clicking the X on the chip calls clearTaskIdFilter', () => {
    const mockClear = vi.fn();
    useRunHistoryStore.setState({ taskIdFilter: 'task-001', clearTaskIdFilter: mockClear } as any);
    render(<RunHistoryPanel />);
    fireEvent.click(screen.getByLabelText('Clear task filter'));
    expect(mockClear).toHaveBeenCalled();
  });

  it('shows task-specific empty message when taskIdFilter is set and no runs match', () => {
    useRunHistoryStore.setState({ taskIdFilter: 'task-001' });
    render(<RunHistoryPanel />);
    expect(screen.getByText('No runs for this task')).toBeInTheDocument();
  });
});

describe('RunHistoryPanel — close button', () => {
  it('calls toggleHistoryPanel when close button is clicked', () => {
    const mockToggle = vi.fn();
    useRunHistoryStore.setState({ toggleHistoryPanel: mockToggle } as any);

    render(<RunHistoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: /close run history panel/i }));
    expect(mockToggle).toHaveBeenCalled();
  });
});
