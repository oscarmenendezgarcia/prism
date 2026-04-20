/**
 * Unit tests for PipelineLogToggle (embedded in Header.tsx).
 * ADR-1 (log-viewer) T-010: visibility when pipeline active/inactive, click toggles store.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '../../src/components/layout/Header';
import { useAppStore } from '../../src/stores/useAppStore';
import { usePipelineLogStore } from '../../src/stores/usePipelineLogStore';

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
  useAppStore.setState({ pipelineState: null, createModalOpen: false, agentSettingsPanelOpen: false } as any);
  usePipelineLogStore.setState({ logPanelOpen: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const BASE_PIPELINE_STATE = {
  spaceId:           'space-1',
  taskId:            'task-1',
  stages:            ['developer-agent'],
  currentStageIndex: 0,
  startedAt:         new Date().toISOString(),
  status:            'running' as const,
  subTaskIds:        [],
  checkpoints:       [],
  runId:             'run-1',
};

describe('PipelineLogToggle — visibility', () => {
  it('is visible but disabled when pipelineState is null', () => {
    useAppStore.setState({ pipelineState: null } as any);
    render(<Header />);
    const btn = screen.queryByRole('button', { name: /toggle pipeline log panel/i });
    expect(btn).not.toBeNull();
    expect(btn?.className).toContain('opacity-40');
    expect(btn?.className).toContain('pointer-events-none');
    expect(btn).toHaveAttribute('aria-disabled', 'true');
  });

  it('is rendered when pipelineState is non-null', () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    render(<Header />);
    expect(screen.getByRole('button', { name: /toggle pipeline log panel/i })).toBeInTheDocument();
  });
});

describe('PipelineLogToggle — click behaviour', () => {
  it('opens the log panel when clicked and panel is closed', () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    usePipelineLogStore.setState({ logPanelOpen: false });
    render(<Header />);

    fireEvent.click(screen.getByRole('button', { name: /toggle pipeline log panel/i }));

    expect(usePipelineLogStore.getState().logPanelOpen).toBe(true);
  });

  it('closes the log panel when clicked and panel is open', () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    usePipelineLogStore.setState({ logPanelOpen: true });
    render(<Header />);

    fireEvent.click(screen.getByRole('button', { name: /toggle pipeline log panel/i }));

    expect(usePipelineLogStore.getState().logPanelOpen).toBe(false);
  });

  it('reflects logPanelOpen state via aria-pressed', () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    usePipelineLogStore.setState({ logPanelOpen: true });
    render(<Header />);

    const btn = screen.getByRole('button', { name: /toggle pipeline log panel/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('has aria-pressed=false when log panel is closed', () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    usePipelineLogStore.setState({ logPanelOpen: false });
    render(<Header />);

    const btn = screen.getByRole('button', { name: /toggle pipeline log panel/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('uses the "article" Material Symbol icon', () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    render(<Header />);
    const btn = screen.getByRole('button', { name: /toggle pipeline log panel/i });
    expect(btn.textContent).toContain('article');
  });

  it('has w-9 h-9 icon-only size classes (Trend A redesign)', () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    render(<Header />);
    const btn = screen.getByRole('button', { name: /toggle pipeline log panel/i });
    expect(btn.className).toContain('w-9');
    expect(btn.className).toContain('h-9');
  });

  it('has items-center justify-center layout (Trend A redesign)', () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    render(<Header />);
    const btn = screen.getByRole('button', { name: /toggle pipeline log panel/i });
    expect(btn.className).toContain('items-center');
    expect(btn.className).toContain('justify-center');
  });

  it('uses rounded-lg instead of rounded-xl (Trend A wireframe spec)', () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    render(<Header />);
    const btn = screen.getByRole('button', { name: /toggle pipeline log panel/i });
    expect(btn.className).toContain('rounded-lg');
    expect(btn.className).not.toContain('rounded-xl');
  });

  it('renders icon-only — no text label (Trend A redesign)', () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    render(<Header />);
    const btn = screen.getByRole('button', { name: /toggle pipeline log panel/i });
    const icon = btn.querySelector('.material-symbols-outlined');
    expect(icon).toBeInTheDocument();
    const nonIconSpans = btn.querySelectorAll('span:not(.material-symbols-outlined):not([data-testid])');
    expect(nonIconSpans.length).toBe(0);
  });
});

describe('PipelineLogToggle — notification dot (T-5)', () => {
  it('does not show the dot when unseenCount is 0', () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    usePipelineLogStore.setState({ logPanelOpen: false, unseenCount: 0 });
    render(<Header />);
    expect(document.querySelector('[data-testid="logs-unseen-dot"]')).toBeNull();
  });

  it('shows the dot when unseenCount > 0 and panel is closed', () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    usePipelineLogStore.setState({ logPanelOpen: false, unseenCount: 3 });
    render(<Header />);
    expect(document.querySelector('[data-testid="logs-unseen-dot"]')).toBeInTheDocument();
  });

  it('does not show the dot when unseenCount > 0 but panel is open', () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    usePipelineLogStore.setState({ logPanelOpen: true, unseenCount: 5 });
    render(<Header />);
    expect(document.querySelector('[data-testid="logs-unseen-dot"]')).toBeNull();
  });

  it('dot disappears after clicking to open the panel (unseenCount reset to 0)', () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    usePipelineLogStore.setState({ logPanelOpen: false, unseenCount: 2 });
    render(<Header />);
    expect(document.querySelector('[data-testid="logs-unseen-dot"]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /toggle pipeline log panel/i }));

    expect(usePipelineLogStore.getState().unseenCount).toBe(0);
    expect(usePipelineLogStore.getState().logPanelOpen).toBe(true);
  });

  it('dot has the correct styling classes (absolute, red, rounded-full)', () => {
    useAppStore.setState({ pipelineState: BASE_PIPELINE_STATE } as any);
    usePipelineLogStore.setState({ logPanelOpen: false, unseenCount: 1 });
    render(<Header />);
    const dot = document.querySelector('[data-testid="logs-unseen-dot"]');
    expect(dot?.className).toContain('absolute');
    expect(dot?.className).toContain('bg-error');
    expect(dot?.className).toContain('rounded-full');
  });
});
