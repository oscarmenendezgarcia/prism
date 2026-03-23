/**
 * Tests for useRunHistoryStore Zustand store.
 * ADR-1 (Agent Run History) T-014.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock API client — factory must not reference top-level variables ─────────
// (vi.mock is hoisted to the top; use a local vi.fn() pattern)
vi.mock('../../src/api/client', () => ({
  getAgentRuns:        vi.fn(),
  createAgentRun:      vi.fn(),
  updateAgentRun:      vi.fn(),
  getSpaces:           vi.fn(),
  getTasks:            vi.fn(),
  createTask:          vi.fn(),
  moveTask:            vi.fn(),
  deleteTask:          vi.fn(),
  createSpace:         vi.fn(),
  renameSpace:         vi.fn(),
  deleteSpace:         vi.fn(),
  getAttachmentContent: vi.fn(),
}));

import * as apiClient from '../../src/api/client';
import { useRunHistoryStore } from '../../src/stores/useRunHistoryStore';
import type { AgentRunRecord } from '../../src/types';

const mockGetAgentRuns   = vi.mocked(apiClient.getAgentRuns);
const mockCreateAgentRun = vi.mocked(apiClient.createAgentRun);
const mockUpdateAgentRun = vi.mocked(apiClient.updateAgentRun);

function makeRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id:               'run_100_test',
    taskId:           'task-001',
    taskTitle:        'Test Task',
    agentId:          'developer-agent',
    agentDisplayName: 'Developer Agent',
    spaceId:          'default',
    spaceName:        'Prism',
    status:           'running',
    startedAt:        new Date().toISOString(),
    completedAt:      null,
    durationMs:       null,
    cliCommand:       'claude ...',
    promptPath:       '/tmp/prompt.md',
    ...overrides,
  };
}

beforeEach(() => {
  useRunHistoryStore.setState({
    runs:             [],
    filter:           'all',
    loading:          false,
    historyPanelOpen: false,
  });
  vi.clearAllMocks();
});

describe('useRunHistoryStore — loadRuns', () => {
  it('populates runs[] with API response', async () => {
    const mockRuns = [makeRun({ id: 'run_a' }), makeRun({ id: 'run_b' })];
    mockGetAgentRuns.mockResolvedValueOnce({ runs: mockRuns, total: 2 });

    await useRunHistoryStore.getState().loadRuns();

    const { runs } = useRunHistoryStore.getState();
    expect(runs).toHaveLength(2);
    expect(runs[0].id).toBe('run_a');
  });

  it('sets loading false after fetch completes', async () => {
    mockGetAgentRuns.mockResolvedValueOnce({ runs: [], total: 0 });

    await useRunHistoryStore.getState().loadRuns();

    expect(useRunHistoryStore.getState().loading).toBe(false);
  });

  it('handles API errors without throwing', async () => {
    mockGetAgentRuns.mockRejectedValueOnce(new Error('Network error'));

    // Should not throw
    await expect(useRunHistoryStore.getState().loadRuns()).resolves.toBeUndefined();
    expect(useRunHistoryStore.getState().loading).toBe(false);
  });
});

describe('useRunHistoryStore — recordRunStarted', () => {
  it('prepends new run to runs[] optimistically', async () => {
    mockCreateAgentRun.mockResolvedValueOnce({ id: 'run_new' });
    useRunHistoryStore.setState({ runs: [makeRun({ id: 'run_existing' })] });

    const newRun = makeRun({ id: 'run_new', agentDisplayName: 'New Agent' });
    const { status: _s, completedAt: _c, durationMs: _d, reason: _r, ...payload } = newRun;
    await useRunHistoryStore.getState().recordRunStarted(payload);

    const { runs } = useRunHistoryStore.getState();
    expect(runs[0].id).toBe('run_new');
    expect(runs[0].status).toBe('running');
    expect(runs).toHaveLength(2);
  });

  it('calls createAgentRun with the record payload', async () => {
    mockCreateAgentRun.mockResolvedValueOnce({ id: 'run_x' });

    const run = makeRun({ id: 'run_x' });
    const { status: _s, completedAt: _c, durationMs: _d, reason: _r, ...payload } = run;
    await useRunHistoryStore.getState().recordRunStarted(payload);

    expect(mockCreateAgentRun).toHaveBeenCalledWith(expect.objectContaining({
      id:     'run_x',
      taskId: 'task-001',
    }));
  });

  it('still prepends the run even when API call fails', async () => {
    mockCreateAgentRun.mockRejectedValueOnce(new Error('Network error'));

    const run = makeRun({ id: 'run_fail' });
    const { status: _s, completedAt: _c, durationMs: _d, reason: _r, ...payload } = run;
    await useRunHistoryStore.getState().recordRunStarted(payload);

    // Optimistic update should still be in place
    const { runs } = useRunHistoryStore.getState();
    expect(runs.find((r) => r.id === 'run_fail')).toBeTruthy();
  });
});

describe('useRunHistoryStore — recordRunFinished', () => {
  it('updates the matching run status in runs[]', async () => {
    mockUpdateAgentRun.mockResolvedValueOnce({ id: 'run_100_test', status: 'completed' });
    useRunHistoryStore.setState({ runs: [makeRun({ id: 'run_100_test' })] });

    await useRunHistoryStore.getState().recordRunFinished('run_100_test', 'completed', 5000);

    const run = useRunHistoryStore.getState().runs.find((r) => r.id === 'run_100_test');
    expect(run?.status).toBe('completed');
    expect(run?.durationMs).toBe(5000);
    expect(run?.completedAt).toBeTruthy();
  });

  it('calls updateAgentRun with correct patch', async () => {
    mockUpdateAgentRun.mockResolvedValueOnce({ id: 'run_x', status: 'cancelled' });
    useRunHistoryStore.setState({ runs: [makeRun({ id: 'run_x' })] });

    await useRunHistoryStore.getState().recordRunFinished('run_x', 'cancelled', 3000);

    expect(mockUpdateAgentRun).toHaveBeenCalledWith('run_x', expect.objectContaining({
      status:     'cancelled',
      durationMs: 3000,
    }));
  });

  it('handles runs not in list gracefully (no crash)', async () => {
    mockUpdateAgentRun.mockResolvedValueOnce({ id: 'run_ghost', status: 'failed' });

    await expect(
      useRunHistoryStore.getState().recordRunFinished('run_ghost', 'failed', 0)
    ).resolves.toBeUndefined();
  });
});

describe('useRunHistoryStore — setFilter', () => {
  it('updates filter state', () => {
    useRunHistoryStore.getState().setFilter('running');
    expect(useRunHistoryStore.getState().filter).toBe('running');
  });

  it('can be set back to all', () => {
    useRunHistoryStore.getState().setFilter('completed');
    useRunHistoryStore.getState().setFilter('all');
    expect(useRunHistoryStore.getState().filter).toBe('all');
  });
});

describe('useRunHistoryStore — toggleHistoryPanel', () => {
  it('toggles historyPanelOpen from false to true', () => {
    useRunHistoryStore.setState({ historyPanelOpen: false });
    useRunHistoryStore.getState().toggleHistoryPanel();
    expect(useRunHistoryStore.getState().historyPanelOpen).toBe(true);
  });

  it('toggles historyPanelOpen from true to false', () => {
    useRunHistoryStore.setState({ historyPanelOpen: true });
    useRunHistoryStore.getState().toggleHistoryPanel();
    expect(useRunHistoryStore.getState().historyPanelOpen).toBe(false);
  });
});
