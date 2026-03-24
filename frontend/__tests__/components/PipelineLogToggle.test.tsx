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
  it('is not rendered when pipelineState is null', () => {
    useAppStore.setState({ pipelineState: null } as any);
    render(<Header />);
    expect(screen.queryByRole('button', { name: /toggle pipeline log panel/i })).toBeNull();
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
});
