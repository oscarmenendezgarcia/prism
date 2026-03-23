/**
 * Tests for RunHistoryToggle component.
 * ADR-1 (Agent Run History) T-014.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRunHistoryStore } from '../../src/stores/useRunHistoryStore';

// ── Mock API client (required by store) ─────────────────────────────────────
vi.mock('../../src/api/client', () => ({
  getAgentRuns:   vi.fn().mockResolvedValue({ runs: [], total: 0 }),
  createAgentRun: vi.fn(),
  updateAgentRun: vi.fn(),
  getSpaces:      vi.fn(),
  getTasks:       vi.fn(),
  createTask:     vi.fn(),
  moveTask:       vi.fn(),
  deleteTask:     vi.fn(),
  createSpace:    vi.fn(),
  renameSpace:    vi.fn(),
  deleteSpace:    vi.fn(),
  getAttachmentContent: vi.fn(),
}));

import { RunHistoryToggle } from '../../src/components/agent-run-history/RunHistoryToggle';

beforeEach(() => {
  useRunHistoryStore.setState({
    historyPanelOpen: false,
  });
  vi.clearAllMocks();
});

describe('RunHistoryToggle', () => {
  it('renders a button with aria-label="Toggle run history panel"', () => {
    render(<RunHistoryToggle />);
    expect(screen.getByRole('button', { name: /toggle run history panel/i })).toBeInTheDocument();
  });

  it('renders the "history" Material Symbol icon', () => {
    const { container } = render(<RunHistoryToggle />);
    const icon = container.querySelector('.material-symbols-outlined');
    expect(icon?.textContent).toContain('history');
  });

  it('has aria-pressed=false when panel is closed', () => {
    useRunHistoryStore.setState({ historyPanelOpen: false });
    render(<RunHistoryToggle />);
    const btn = screen.getByRole('button', { name: /toggle run history panel/i });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('has aria-pressed=true when panel is open', () => {
    useRunHistoryStore.setState({ historyPanelOpen: true });
    render(<RunHistoryToggle />);
    const btn = screen.getByRole('button', { name: /toggle run history panel/i });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('applies active styling when historyPanelOpen is true', () => {
    useRunHistoryStore.setState({ historyPanelOpen: true });
    render(<RunHistoryToggle />);
    const btn = screen.getByRole('button', { name: /toggle run history panel/i });
    expect(btn.className).toContain('text-primary');
  });

  it('calls toggleHistoryPanel when clicked', () => {
    const mockToggle = vi.fn();
    useRunHistoryStore.setState({ toggleHistoryPanel: mockToggle } as any);

    render(<RunHistoryToggle />);
    fireEvent.click(screen.getByRole('button', { name: /toggle run history panel/i }));
    expect(mockToggle).toHaveBeenCalled();
  });
});
