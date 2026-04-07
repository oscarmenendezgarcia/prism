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

  it('has h-10 min-w-[72px] px-3 size classes (T-4 redesign)', () => {
    render(<RunHistoryToggle />);
    const btn = screen.getByRole('button', { name: /toggle run history panel/i });
    expect(btn.className).toContain('h-10');
    expect(btn.className).toContain('min-w-[72px]');
    expect(btn.className).toContain('px-3');
  });

  it('has flex-col layout for icon+label column (T-4 redesign)', () => {
    render(<RunHistoryToggle />);
    const btn = screen.getByRole('button', { name: /toggle run history panel/i });
    expect(btn.className).toContain('flex-col');
    expect(btn.className).toContain('gap-0.5');
  });

  it('uses rounded-lg instead of rounded-xl (T-4 wireframe spec)', () => {
    render(<RunHistoryToggle />);
    const btn = screen.getByRole('button', { name: /toggle run history panel/i });
    expect(btn.className).toContain('rounded-lg');
    expect(btn.className).not.toContain('rounded-xl');
  });

  // T-5: text label tests
  it('renders "History" text label (T-5)', () => {
    render(<RunHistoryToggle />);
    const btn = screen.getByRole('button', { name: /toggle run history panel/i });
    const label = btn.querySelector('span:not(.material-symbols-outlined)');
    expect(label).toBeInTheDocument();
    expect(label?.textContent).toBe('History');
  });

  it('label has hidden sm:block classes for mobile-only visibility (T-5)', () => {
    render(<RunHistoryToggle />);
    const btn = screen.getByRole('button', { name: /toggle run history panel/i });
    const label = btn.querySelector('span:not(.material-symbols-outlined)');
    expect(label?.className).toContain('hidden');
    expect(label?.className).toContain('sm:block');
  });

  it('label has text-[10px] font-medium leading-none classes (T-5)', () => {
    render(<RunHistoryToggle />);
    const btn = screen.getByRole('button', { name: /toggle run history panel/i });
    const label = btn.querySelector('span:not(.material-symbols-outlined)');
    expect(label?.className).toContain('text-[10px]');
    expect(label?.className).toContain('font-medium');
    expect(label?.className).toContain('leading-none');
  });
});
