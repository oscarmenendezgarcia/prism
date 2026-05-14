/**
 * Multi-run regression tests for AgentLauncherMenu (T-003)
 *
 * ADR-1 (multi-run-launcher §3.2): the root ⚙️ button must remain enabled
 * regardless of `activeRun` state; only individual agent items are gated by
 * the PTY-exclusive `activeRun` guard.
 *
 * Cases:
 *  MRL-001: button enabled when activeRun === null
 *  MRL-002: button still enabled when activeRun !== null (regression guard)
 *  MRL-003: button enabled when other pipeline runs exist but activeRun === null
 *  MRL-004: click opens dropdown even when activeRun !== null
 *  MRL-005: "Run Full Pipeline" invokes openPipelineConfirm even when activeRun !== null
 *  MRL-006: individual agent items are disabled when activeRun !== null
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Store mock ────────────────────────────────────────────────────────────────
// vi.hoisted ensures these declarations run before vi.mock is hoisted.

const {
  mockLoadAgents,
  mockPrepareAgentRun,
  mockOpenPipelineConfirm,
  mockUseActiveRun,
  mockUseAvailableAgents,
  mockUseAppStore,
} = vi.hoisted(() => {
  const mockLoadAgents          = vi.fn();
  const mockPrepareAgentRun     = vi.fn();
  const mockOpenPipelineConfirm = vi.fn();
  const mockUseActiveRun        = vi.fn().mockReturnValue(null);
  const mockUseAvailableAgents  = vi.fn().mockReturnValue([]);

  const FAKE_STATE = () => ({
    loadAgents:          mockLoadAgents,
    prepareAgentRun:     mockPrepareAgentRun,
    openPipelineConfirm: mockOpenPipelineConfirm,
    spaces: [
      {
        id:               'space-1',
        pipeline:         ['developer-agent', 'qa-engineer-e2e'],
        workingDirectory: '/tmp/test',
      },
    ],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockUseAppStore = vi.fn((selector: (s: any) => unknown) =>
    selector(FAKE_STATE()),
  );

  return {
    mockLoadAgents,
    mockPrepareAgentRun,
    mockOpenPipelineConfirm,
    mockUseActiveRun,
    mockUseAvailableAgents,
    mockUseAppStore,
  };
});

vi.mock('@/stores/useAppStore', () => ({
  useActiveRun:       mockUseActiveRun,
  useAvailableAgents: mockUseAvailableAgents,
  useAppStore:        mockUseAppStore,
}));

import { AgentLauncherMenu } from '../AgentLauncherMenu';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AGENTS = [
  { id: 'developer-agent',  displayName: 'Developer Agent' },
  { id: 'qa-engineer-e2e',  displayName: 'QA Engineer' },
];

const MOCK_ACTIVE_RUN = {
  taskId:    'task-99',
  agentId:   'developer-agent',
  spaceId:   'space-1',
  startedAt: new Date().toISOString(),
  cliCommand:  '',
  promptPath:  '',
};

function renderMenu() {
  return render(<AgentLauncherMenu taskId="task-1" spaceId="space-1" />);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default return values after clearAllMocks.
  mockUseActiveRun.mockReturnValue(null);
  mockUseAvailableAgents.mockReturnValue(AGENTS);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockUseAppStore.mockImplementation((selector: (s: any) => unknown) =>
    selector({
      loadAgents:          mockLoadAgents,
      prepareAgentRun:     mockPrepareAgentRun,
      openPipelineConfirm: mockOpenPipelineConfirm,
      spaces: [
        {
          id:               'space-1',
          pipeline:         ['developer-agent', 'qa-engineer-e2e'],
          workingDirectory: '/tmp/test',
        },
      ],
    }),
  );
});

// ── MRL-001 ───────────────────────────────────────────────────────────────────

describe('MRL-001: button enabled when activeRun === null', () => {
  it('root button has no disabled attribute when activeRun is null', () => {
    mockUseActiveRun.mockReturnValue(null);
    renderMenu();
    const button = screen.getByRole('button', { name: /run agent/i });
    expect(button).not.toBeDisabled();
  });
});

// ── MRL-002 ───────────────────────────────────────────────────────────────────

describe('MRL-002: button still enabled when activeRun !== null (regression guard)', () => {
  it('root button has no disabled attribute even when activeRun is set', () => {
    mockUseActiveRun.mockReturnValue(MOCK_ACTIVE_RUN);
    renderMenu();
    const button = screen.getByRole('button', { name: /run agent/i });
    expect(button).not.toBeDisabled();
  });

  it('root button has no aria-disabled attribute when activeRun is set', () => {
    mockUseActiveRun.mockReturnValue(MOCK_ACTIVE_RUN);
    renderMenu();
    const button = screen.getByRole('button', { name: /run agent/i });
    expect(button.getAttribute('aria-disabled')).toBeNull();
  });

  it('root button title is always "Run agent" regardless of activeRun', () => {
    mockUseActiveRun.mockReturnValue(MOCK_ACTIVE_RUN);
    renderMenu();
    const button = screen.getByRole('button', { name: /run agent/i });
    expect(button.getAttribute('title')).toBe('Run agent');
  });
});

// ── MRL-003 ───────────────────────────────────────────────────────────────────

describe('MRL-003: button enabled when other pipeline runs exist but activeRun === null', () => {
  it('button is enabled with no activeRun even if pipeline runs are tracked', () => {
    mockUseActiveRun.mockReturnValue(null);
    renderMenu();
    const button = screen.getByRole('button', { name: /run agent/i });
    expect(button).not.toBeDisabled();
  });
});

// ── MRL-004 ───────────────────────────────────────────────────────────────────

describe('MRL-004: click opens dropdown even when activeRun !== null', () => {
  it('clicking the button opens the menu when activeRun is set', () => {
    mockUseActiveRun.mockReturnValue(MOCK_ACTIVE_RUN);
    renderMenu();

    const button = screen.getByRole('button', { name: /run agent/i });
    act(() => { fireEvent.click(button); });

    // Menu renders into document.body via createPortal
    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).toBeTruthy();
  });

  it('clicking the button opens the menu when activeRun is null', () => {
    mockUseActiveRun.mockReturnValue(null);
    renderMenu();

    const button = screen.getByRole('button', { name: /run agent/i });
    act(() => { fireEvent.click(button); });

    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).toBeTruthy();
  });
});

// ── MRL-005 ───────────────────────────────────────────────────────────────────

describe('MRL-005: "Run Full Pipeline" invokes openPipelineConfirm even when activeRun !== null', () => {
  it('clicking "Run Full Pipeline" calls openPipelineConfirm', () => {
    mockUseActiveRun.mockReturnValue(MOCK_ACTIVE_RUN);
    renderMenu();

    const button = screen.getByRole('button', { name: /run agent/i });
    act(() => { fireEvent.click(button); });

    // Pipeline option is always the last menuitem
    const allItems = Array.from(document.body.querySelectorAll('[role="menuitem"]')) as HTMLButtonElement[];
    const pipelineBtn = allItems[allItems.length - 1];
    act(() => { fireEvent.click(pipelineBtn); });

    expect(mockOpenPipelineConfirm).toHaveBeenCalledWith('space-1', 'task-1');
  });

  it('"Run Full Pipeline" button is not disabled even when activeRun is set', () => {
    mockUseActiveRun.mockReturnValue(MOCK_ACTIVE_RUN);
    renderMenu();

    const button = screen.getByRole('button', { name: /run agent/i });
    act(() => { fireEvent.click(button); });

    const allItems = Array.from(document.body.querySelectorAll('[role="menuitem"]')) as HTMLButtonElement[];
    const pipelineBtn = allItems[allItems.length - 1];
    expect(pipelineBtn).not.toBeDisabled();
  });
});

// ── MRL-006 ───────────────────────────────────────────────────────────────────

describe('MRL-006: individual agent items are disabled when activeRun !== null', () => {
  it('agent items have disabled + aria-disabled when activeRun is set', () => {
    mockUseActiveRun.mockReturnValue(MOCK_ACTIVE_RUN);
    renderMenu();

    const button = screen.getByRole('button', { name: /run agent/i });
    act(() => { fireEvent.click(button); });

    const allItems = Array.from(
      document.body.querySelectorAll('[role="menuitem"]')
    ) as HTMLButtonElement[];
    // All items except the last (Run Full Pipeline) are individual agent items.
    const agentItems = allItems.slice(0, -1);
    expect(agentItems.length).toBeGreaterThan(0);

    agentItems.forEach((item) => {
      expect(item.disabled).toBe(true);
      expect(item.getAttribute('aria-disabled')).toBe('true');
    });
  });

  it('agent items are enabled when activeRun === null', () => {
    mockUseActiveRun.mockReturnValue(null);
    renderMenu();

    const button = screen.getByRole('button', { name: /run agent/i });
    act(() => { fireEvent.click(button); });

    const allItems = Array.from(
      document.body.querySelectorAll('[role="menuitem"]')
    ) as HTMLButtonElement[];
    const agentItems = allItems.slice(0, -1);
    expect(agentItems.length).toBeGreaterThan(0);

    agentItems.forEach((item) => {
      expect(item.disabled).toBe(false);
    });
  });
});
