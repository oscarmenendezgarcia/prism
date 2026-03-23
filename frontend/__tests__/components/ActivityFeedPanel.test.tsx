/**
 * ActivityFeedPanel component tests.
 * ADR-1 (Activity Feed) — T-018 acceptance criteria.
 *
 * The Zustand store is seeded directly via setState.
 * useActivityFeed is NOT called here — it is mounted in AppContent, not the panel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActivityEvent } from '../../src/types';

// ── Mock api/client (required by store initialisation) ────────────────────
vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(),
  getTasks: vi.fn(),
  createTask: vi.fn(),
  moveTask: vi.fn(),
  deleteTask: vi.fn(),
  createSpace: vi.fn(),
  renameSpace: vi.fn(),
  deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
  getConfigFiles: vi.fn(),
  getConfigFile: vi.fn(),
  saveConfigFile: vi.fn(),
  getAgents: vi.fn(),
  getAgent: vi.fn(),
  generatePrompt: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  getActivity: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
  getGlobalActivity: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
}));

import { useAppStore } from '../../src/stores/useAppStore';
import { ActivityFeedPanel } from '../../src/components/activity/ActivityFeedPanel';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id:        overrides.id        ?? 'evt-1',
    type:      overrides.type      ?? 'task.created',
    spaceId:   overrides.spaceId   ?? 'space-1',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    actor:     'system',
    payload:   overrides.payload   ?? { taskId: 'task-1', taskTitle: 'Test task' },
  };
}

function renderPanel(status: 'connected' | 'connecting' | 'disconnected' = 'connected') {
  return render(<ActivityFeedPanel status={status} />);
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    activityPanelOpen:   true,
    activityEvents:      [],
    activityFilter:      {},
    activityUnreadCount: 0,
    activityLoading:     false,
  });
});

// ---------------------------------------------------------------------------

describe('ActivityFeedPanel — header', () => {
  it('renders "Activity" title', () => {
    renderPanel();
    expect(screen.getByText('Activity')).toBeInTheDocument();
  });

  it('shows "Live" label when status is connected', () => {
    renderPanel('connected');
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('shows "Connecting…" label when status is connecting', () => {
    renderPanel('connecting');
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
  });

  it('shows "Disconnected" label when status is disconnected', () => {
    renderPanel('disconnected');
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('close button calls setActivityPanelOpen(false)', () => {
    const mockSet = vi.fn();
    useAppStore.setState({ setActivityPanelOpen: mockSet } as any);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /close activity panel/i }));
    expect(mockSet).toHaveBeenCalledWith(false);
  });
});

describe('ActivityFeedPanel — event list', () => {
  it('shows empty state when no events', () => {
    useAppStore.setState({ activityEvents: [] });
    renderPanel();
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });

  it('renders event descriptions from store', () => {
    useAppStore.setState({
      activityEvents: [makeEvent({ payload: { taskId: 't1', taskTitle: 'Hello world' } })],
    });
    renderPanel();
    expect(screen.getByText(/Hello world/)).toBeInTheDocument();
  });

  it('renders multiple events', () => {
    useAppStore.setState({
      activityEvents: [
        makeEvent({ id: 'e1', payload: { taskId: 't1', taskTitle: 'First task' } }),
        makeEvent({ id: 'e2', type: 'task.deleted', payload: { taskId: 't2', taskTitle: 'Second task' } }),
      ],
    });
    renderPanel();
    expect(screen.getByText(/First task/)).toBeInTheDocument();
    expect(screen.getByText(/Second task/)).toBeInTheDocument();
  });

  it('applies type filter — hides events that do not match', () => {
    useAppStore.setState({
      activityEvents: [
        makeEvent({ id: 'e1', type: 'task.created', payload: { taskId: 't1', taskTitle: 'Created task' } }),
        makeEvent({ id: 'e2', type: 'task.deleted', payload: { taskId: 't2', taskTitle: 'Deleted task' } }),
      ],
      activityFilter: { type: 'task.created' },
    });
    renderPanel();
    expect(screen.getByText(/Created task/)).toBeInTheDocument();
    expect(screen.queryByText(/Deleted task/)).not.toBeInTheDocument();
  });

  it('shows empty state hint to clear filter when filter is active', () => {
    useAppStore.setState({
      activityEvents: [makeEvent({ type: 'task.moved', payload: { taskId: 't1', taskTitle: 'Moved task', from: 'todo', to: 'done' } })],
      activityFilter: { type: 'task.deleted' }, // no match
    });
    renderPanel();
    expect(screen.getByText(/Try clearing the filter/)).toBeInTheDocument();
  });
});

describe('ActivityFeedPanel — filter dropdown', () => {
  it('renders the filter select with "All events" default', () => {
    renderPanel();
    const select = screen.getByRole('combobox', { name: /filter by event type/i });
    expect(select).toBeInTheDocument();
    expect((select as HTMLSelectElement).value).toBe('');
  });

  it('changing filter calls setActivityFilter with selected type', () => {
    const mockSetFilter = vi.fn();
    useAppStore.setState({ setActivityFilter: mockSetFilter } as any);
    renderPanel();

    const select = screen.getByRole('combobox', { name: /filter by event type/i });
    fireEvent.change(select, { target: { value: 'task.moved' } });

    expect(mockSetFilter).toHaveBeenCalledWith({ type: 'task.moved' });
  });

  it('changing filter to empty string calls setActivityFilter with undefined type', () => {
    const mockSetFilter = vi.fn();
    useAppStore.setState({
      activityFilter: { type: 'task.moved' },
      setActivityFilter: mockSetFilter,
    } as any);
    renderPanel();

    const select = screen.getByRole('combobox', { name: /filter by event type/i });
    fireEvent.change(select, { target: { value: '' } });

    expect(mockSetFilter).toHaveBeenCalledWith({ type: undefined });
  });
});

describe('ActivityFeedPanel — load more', () => {
  it('renders "Load more" button', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
  });

  it('Load more button calls loadActivityHistory', () => {
    const mockLoad = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ loadActivityHistory: mockLoad } as any);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    expect(mockLoad).toHaveBeenCalledWith();
  });

  it('Load more button is disabled while loading', () => {
    useAppStore.setState({ activityLoading: true });
    renderPanel();
    const btn = screen.getByRole('button', { name: /load more/i });
    expect(btn).toBeDisabled();
  });

  it('shows "Loading…" text while activityLoading is true', () => {
    useAppStore.setState({ activityLoading: true });
    renderPanel();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});

describe('ActivityFeedPanel — event descriptions', () => {
  it('describes task.moved with from/to', () => {
    useAppStore.setState({
      activityEvents: [
        makeEvent({ type: 'task.moved', payload: { taskId: 't1', taskTitle: 'Moved', from: 'todo', to: 'done' } }),
      ],
    });
    renderPanel();
    expect(screen.getByText(/todo → done/)).toBeInTheDocument();
  });

  it('describes board.cleared with count', () => {
    useAppStore.setState({
      activityEvents: [
        makeEvent({ type: 'board.cleared', payload: { deletedCount: 5 } }),
      ],
    });
    renderPanel();
    expect(screen.getByText(/5 tasks removed/)).toBeInTheDocument();
  });

  it('describes space.created with space name', () => {
    useAppStore.setState({
      activityEvents: [
        makeEvent({ type: 'space.created', payload: { spaceName: 'My Space' } }),
      ],
    });
    renderPanel();
    expect(screen.getByText(/My Space.*created/)).toBeInTheDocument();
  });
});
