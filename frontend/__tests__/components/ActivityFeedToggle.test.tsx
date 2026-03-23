/**
 * ActivityFeedToggle component tests.
 * ADR-1 (Activity Feed) — T-018 acceptance criteria.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Mock api/client (required by store) ──────────────────────────────────────
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
import { ActivityFeedToggle } from '../../src/components/activity/ActivityFeedToggle';

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    activityPanelOpen:   false,
    activityUnreadCount: 0,
  });
});

describe('ActivityFeedToggle — basic rendering', () => {
  it('renders the toggle button with accessible label', () => {
    render(<ActivityFeedToggle />);
    expect(screen.getByRole('button', { name: /toggle activity feed/i })).toBeInTheDocument();
  });

  it('renders the notifications icon', () => {
    render(<ActivityFeedToggle />);
    // Material Symbols icon text content
    expect(screen.getByText('notifications')).toBeInTheDocument();
  });

  it('aria-pressed is false when panel is closed', () => {
    useAppStore.setState({ activityPanelOpen: false });
    render(<ActivityFeedToggle />);
    const btn = screen.getByRole('button', { name: /toggle activity feed/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('aria-pressed is true when panel is open', () => {
    useAppStore.setState({ activityPanelOpen: true });
    render(<ActivityFeedToggle />);
    const btn = screen.getByRole('button', { name: /toggle activity feed/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('ActivityFeedToggle — badge', () => {
  it('does not show badge when unread count is 0', () => {
    useAppStore.setState({ activityPanelOpen: false, activityUnreadCount: 0 });
    render(<ActivityFeedToggle />);
    // Badge span has aria-hidden="true" — query by text content
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows badge with count when panel is closed and count > 0', () => {
    useAppStore.setState({ activityPanelOpen: false, activityUnreadCount: 3 });
    render(<ActivityFeedToggle />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('does not show badge when panel is open even if count > 0', () => {
    useAppStore.setState({ activityPanelOpen: true, activityUnreadCount: 5 });
    render(<ActivityFeedToggle />);
    expect(screen.queryByText('5')).not.toBeInTheDocument();
  });

  it('caps badge display at 99+', () => {
    useAppStore.setState({ activityPanelOpen: false, activityUnreadCount: 150 });
    render(<ActivityFeedToggle />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('shows exact count when count is exactly 99', () => {
    useAppStore.setState({ activityPanelOpen: false, activityUnreadCount: 99 });
    render(<ActivityFeedToggle />);
    expect(screen.getByText('99')).toBeInTheDocument();
  });

  it('includes unread count in aria-label when badge is shown', () => {
    useAppStore.setState({ activityPanelOpen: false, activityUnreadCount: 7 });
    render(<ActivityFeedToggle />);
    const btn = screen.getByRole('button', { name: /7 unread/i });
    expect(btn).toBeInTheDocument();
  });
});

describe('ActivityFeedToggle — interactions', () => {
  it('clicking calls toggleActivityPanel', () => {
    const mockToggle = vi.fn();
    useAppStore.setState({ toggleActivityPanel: mockToggle } as any);
    render(<ActivityFeedToggle />);
    fireEvent.click(screen.getByRole('button', { name: /toggle activity feed/i }));
    expect(mockToggle).toHaveBeenCalledOnce();
  });

  it('button has active style class when panel is open', () => {
    useAppStore.setState({ activityPanelOpen: true });
    render(<ActivityFeedToggle />);
    const btn = screen.getByRole('button', { name: /toggle activity feed/i });
    expect(btn.className).toContain('bg-primary');
  });

  it('button does not have active style when panel is closed', () => {
    useAppStore.setState({ activityPanelOpen: false });
    render(<ActivityFeedToggle />);
    const btn = screen.getByRole('button', { name: /toggle activity feed/i });
    expect(btn.className).not.toContain('bg-primary/[0.15]');
  });
});
