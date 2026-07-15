/**
 * Unit tests for RunsToggle (replaces PipelineLogToggle).
 * T-005 (runs-panel-unification): visibility, click toggles runsPanelOpen,
 * notification dot (unseenCount), active-run dot.
 *
 * Renamed from PipelineLogToggle.test.tsx — the old toggle was removed and
 * replaced by RunsToggle which merges RunHistoryToggle + PipelineLogToggle.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '../../src/components/layout/Header';
import { useAppStore } from '../../src/stores/useAppStore';
import { usePipelineLogStore } from '../../src/stores/usePipelineLogStore';
import { useRunHistoryStore } from '../../src/stores/useRunHistoryStore';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(), getTasks: vi.fn(), createTask: vi.fn(), moveTask: vi.fn(),
  deleteTask: vi.fn(), createSpace: vi.fn(), renameSpace: vi.fn(), deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
  createAgentRun: vi.fn(), updateAgentRun: vi.fn(), getAgentRuns: vi.fn().mockResolvedValue({ runs: [], total: 0 }),
  startRun: vi.fn(), getBackendRun: vi.fn(), deleteRun: vi.fn(),
  getAgents: vi.fn().mockResolvedValue([]), generatePrompt: vi.fn(),
  getSettings: vi.fn(), saveSettings: vi.fn(), updateTask: vi.fn(),
  getConfigFiles: vi.fn(), getConfigFile: vi.fn(), saveConfigFile: vi.fn(), getAgent: vi.fn(),
}));

function setupMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  setupMatchMedia();
  useAppStore.setState({ pipelineState: null, createModalOpen: false } as any);
  usePipelineLogStore.setState({ runsPanelOpen: false, logPanelOpen: false, unseenCount: 0 });
  useRunHistoryStore.setState({ runs: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// RunsToggle — visibility (always visible, never disabled)
// ---------------------------------------------------------------------------

describe('RunsToggle — visibility', () => {
  it('is visible regardless of pipeline state', () => {
    useAppStore.setState({ pipelineState: null } as any);
    render(<Header />);
    const btn = screen.queryByRole('button', { name: /toggle runs panel/i });
    expect(btn).not.toBeNull();
    // Never disabled — Runs panel is always accessible
    expect(btn?.getAttribute('aria-disabled')).toBeNull();
  });

  it('is always rendered — even when no runs exist', () => {
    render(<Header />);
    expect(screen.getByRole('button', { name: /toggle runs panel/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RunsToggle — click behaviour
// ---------------------------------------------------------------------------

describe('RunsToggle — click behaviour', () => {
  it('opens the runs panel when clicked and panel is closed', () => {
    usePipelineLogStore.setState({ runsPanelOpen: false });
    render(<Header />);

    fireEvent.click(screen.getByRole('button', { name: /toggle runs panel/i }));

    expect(usePipelineLogStore.getState().runsPanelOpen).toBe(true);
    // Deprecated alias should also be true
    expect(usePipelineLogStore.getState().logPanelOpen).toBe(true);
  });

  it('closes the runs panel when clicked and panel is open', () => {
    usePipelineLogStore.setState({ runsPanelOpen: true, logPanelOpen: true });
    render(<Header />);

    fireEvent.click(screen.getByRole('button', { name: /toggle runs panel/i }));

    expect(usePipelineLogStore.getState().runsPanelOpen).toBe(false);
    expect(usePipelineLogStore.getState().logPanelOpen).toBe(false);
  });

  it('reflects runsPanelOpen state via aria-pressed (open)', () => {
    usePipelineLogStore.setState({ runsPanelOpen: true, logPanelOpen: true });
    render(<Header />);
    const btn = screen.getByRole('button', { name: /toggle runs panel/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('has aria-pressed=false when runs panel is closed', () => {
    usePipelineLogStore.setState({ runsPanelOpen: false, logPanelOpen: false });
    render(<Header />);
    const btn = screen.getByRole('button', { name: /toggle runs panel/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('uses the "account_tree" Material Symbol icon', () => {
    render(<Header />);
    const btn = screen.getByRole('button', { name: /toggle runs panel/i });
    expect(btn.textContent).toContain('account_tree');
  });

  it('has w-9 h-9 icon-only size classes', () => {
    render(<Header />);
    const btn = screen.getByRole('button', { name: /toggle runs panel/i });
    expect(btn.className).toContain('w-9');
    expect(btn.className).toContain('h-9');
  });

  it('has items-center justify-center layout', () => {
    render(<Header />);
    const btn = screen.getByRole('button', { name: /toggle runs panel/i });
    expect(btn.className).toContain('items-center');
    expect(btn.className).toContain('justify-center');
  });

  it('uses rounded-lg shape', () => {
    render(<Header />);
    const btn = screen.getByRole('button', { name: /toggle runs panel/i });
    expect(btn.className).toContain('rounded-lg');
    expect(btn.className).not.toContain('rounded-xl');
  });

  it('resets unseenCount to 0 when panel is opened', () => {
    usePipelineLogStore.setState({ runsPanelOpen: false, unseenCount: 3 });
    render(<Header />);

    fireEvent.click(screen.getByRole('button', { name: /toggle runs panel/i }));

    expect(usePipelineLogStore.getState().unseenCount).toBe(0);
    expect(usePipelineLogStore.getState().runsPanelOpen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RunsToggle — notification dot (unseenCount)
// ---------------------------------------------------------------------------

describe('RunsToggle — notification dot', () => {
  it('does not show the dot when unseenCount is 0', () => {
    usePipelineLogStore.setState({ runsPanelOpen: false, unseenCount: 0 });
    render(<Header />);
    expect(document.querySelector('[data-testid="runs-unseen-dot"]')).toBeNull();
  });

  it('shows the dot when unseenCount > 0 and panel is closed', () => {
    usePipelineLogStore.setState({ runsPanelOpen: false, unseenCount: 3 });
    render(<Header />);
    expect(document.querySelector('[data-testid="runs-unseen-dot"]')).toBeInTheDocument();
  });

  it('does not show the dot when unseenCount > 0 but panel is open', () => {
    usePipelineLogStore.setState({ runsPanelOpen: true, logPanelOpen: true, unseenCount: 5 });
    render(<Header />);
    expect(document.querySelector('[data-testid="runs-unseen-dot"]')).toBeNull();
  });

  it('dot disappears after clicking to open the panel', () => {
    usePipelineLogStore.setState({ runsPanelOpen: false, unseenCount: 2 });
    render(<Header />);
    expect(document.querySelector('[data-testid="runs-unseen-dot"]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /toggle runs panel/i }));

    expect(usePipelineLogStore.getState().unseenCount).toBe(0);
    expect(usePipelineLogStore.getState().runsPanelOpen).toBe(true);
  });

  it('dot has the correct styling classes (absolute, red, rounded-full)', () => {
    usePipelineLogStore.setState({ runsPanelOpen: false, unseenCount: 1 });
    render(<Header />);
    const dot = document.querySelector('[data-testid="runs-unseen-dot"]');
    expect(dot?.className).toContain('absolute');
    expect(dot?.className).toContain('bg-error');
    expect(dot?.className).toContain('rounded-full');
  });
});

// ---------------------------------------------------------------------------
// RunsToggle — active-run indicator
// ---------------------------------------------------------------------------

describe('RunsToggle — active-run indicator', () => {
  it('does not show active dot when no runs are running', () => {
    useRunHistoryStore.setState({ runs: [] });
    usePipelineLogStore.setState({ runsPanelOpen: false, unseenCount: 0 });
    render(<Header />);
    // Neither unseen dot nor active dot should be visible
    expect(document.querySelector('[aria-label="Active run"]')).toBeNull();
    expect(document.querySelector('[data-testid="runs-unseen-dot"]')).toBeNull();
  });

  it('shows active dot when at least one run is running', () => {
    useRunHistoryStore.setState({
      runs: [
        {
          id: 'r1', taskId: 't1', taskTitle: 'Task', agentId: 'dev', agentDisplayName: 'Dev',
          spaceId: 's1', spaceName: 'Space', status: 'running', startedAt: new Date().toISOString(),
          completedAt: null, durationMs: null, cliCommand: 'claude', promptPath: '/tmp/p.md',
        },
      ],
    });
    usePipelineLogStore.setState({ runsPanelOpen: false, unseenCount: 0 });
    render(<Header />);
    expect(document.querySelector('[title="A pipeline run is currently active"]')).toBeInTheDocument();
  });
});
