/**
 * Component tests for AgentRoutingView.
 *
 * Tests:
 *   - renders empty state when no stages configured
 *   - renders a card per pipeline stage
 *   - scope switch (Global / Space) updates badge sources
 *   - search filters by agent name, model, skill
 *   - empty search state when nothing matches
 *   - Save calls saveSettings on global scope
 *   - Save is disabled when not dirty
 *   - Reset clears local overrides
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentRoutingView } from '../../src/components/config/AgentRoutingView';
import { useAppStore } from '../../src/stores/useAppStore';
import type { AgentSettings, Space } from '../../src/types';

// ---------------------------------------------------------------------------
// Mock API client
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
  getSpaces:            vi.fn().mockResolvedValue([]),
  getTasks:             vi.fn().mockResolvedValue({ todo: [], 'in-progress': [], done: [] }),
  createTask:           vi.fn(),
  moveTask:             vi.fn(),
  deleteTask:           vi.fn(),
  createSpace:          vi.fn(),
  renameSpace:          vi.fn().mockResolvedValue({}),
  deleteSpace:          vi.fn(),
  getAttachmentContent: vi.fn(),
  getAgents:            vi.fn().mockResolvedValue([]),
  generatePrompt:       vi.fn(),
  getSettings:          vi.fn(),
  saveSettings:         vi.fn().mockResolvedValue({}),
  getAgent:             vi.fn().mockResolvedValue({
    id: 'ux-api-designer',
    name: 'ux-api-designer.md',
    displayName: 'UX / API Designer',
    path: '/agents/ux-api-designer.md',
    sizeBytes: 100,
    content: '---\nmodel: claude-sonnet-4-5\neffort: medium\nskills:\n  - ui-ux-pro-max\n---\n# Agent body',
  }),
  getConfigFiles:       vi.fn().mockResolvedValue([]),
  getConfigFile:        vi.fn(),
  saveConfigFile:       vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: AgentSettings = {
  cli: {
    tool: 'claude', binary: 'claude', flags: ['-p'],
    promptFlag: '-p', fileInputMethod: 'cat-subshell',
  },
  pipeline: {
    autoAdvance: true,
    confirmBetweenStages: true,
    stages: ['ux-api-designer', 'developer-agent'],
    stageModels: {},
  },
  prompts: {
    includeKanbanBlock: true,
    includeGitBlock: true,
    workingDirectory: '',
    customInstructions: '',
  },
};

const SPACE_WITH_MODELS: Space = {
  id: 'space-1',
  name: 'Prism',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  stageModels: {},
};

function setup(overrides: {
  stages?: string[];
  stageModels?: Record<string, { provider: 'claude'; model: string; cliTool: 'claude' }>;
  spaces?: Space[];
  activeSpaceId?: string;
} = {}) {
  const settings: AgentSettings = {
    ...DEFAULT_SETTINGS,
    pipeline: {
      ...DEFAULT_SETTINGS.pipeline,
      stages: overrides.stages ?? DEFAULT_SETTINGS.pipeline.stages,
      stageModels: overrides.stageModels ?? {},
    },
  };

  useAppStore.setState({
    agentSettings:   settings,
    spaces:          overrides.spaces ?? [SPACE_WITH_MODELS],
    activeSpaceId:   overrides.activeSpaceId ?? 'space-1',
    saveSettings:    vi.fn().mockResolvedValue(undefined),
    showToast:       vi.fn(),
    renameSpace:     vi.fn().mockResolvedValue(undefined),
  });
}

function renderView(onDirtyChange = vi.fn()) {
  return render(<AgentRoutingView onDirtyChange={onDirtyChange} />);
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('AgentRoutingView — empty state', () => {
  it('shows a loading skeleton (not the empty state) while the registry is still fetching', () => {
    // No pipeline stages AND no registry agents yet — the panel is mid-fetch here, not empty.
    setup({ stages: [] });
    renderView();
    expect(screen.queryByText(/no agents found/i)).toBeNull();
  });

  it('shows empty state once the registry has loaded and there are still no agents', async () => {
    // No pipeline stages AND no registry agents (getAgents mock returns [])
    setup({ stages: [] });
    renderView();
    await waitFor(() => {
      expect(screen.getByText(/no agents found/i)).toBeDefined();
    });
  });
});

describe('AgentRoutingView — non-pipeline agents (registry union)', () => {
  it('renders a card for a registry agent that is not a pipeline stage', () => {
    setup({ stages: ['developer-agent'] });
    // Registry includes a non-pipeline agent — name comes from the registry, not a hardcoded map
    useAppStore.setState({
      availableAgents: [
        { id: 'developer-agent',    name: 'developer-agent.md',    displayName: 'Developer Agent',    path: '/a/developer-agent.md',    sizeBytes: 1 },
        { id: 'folio-consolidator', name: 'folio-consolidator.md', displayName: 'Folio Consolidator', path: '/a/folio-consolidator.md', sizeBytes: 1 },
      ],
    });
    renderView();
    expect(screen.getByText('Folio Consolidator')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('AgentRoutingView — renders agents', () => {
  beforeEach(() => setup());

  it('renders one card per stage', () => {
    renderView();
    // Each card has a data-testid
    expect(document.querySelector('[data-testid="agent-card-ux-api-designer"]')).toBeDefined();
    expect(document.querySelector('[data-testid="agent-card-developer-agent"]')).toBeDefined();
  });

  it('shows the ScopeSelector', () => {
    renderView();
    expect(screen.getByRole('radiogroup', { name: /model routing scope/i })).toBeDefined();
  });

  it('shows the search input', () => {
    renderView();
    expect(screen.getByPlaceholderText(/search agent/i)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Search filter
// ---------------------------------------------------------------------------

describe('AgentRoutingView — search filter', () => {
  beforeEach(() => setup());

  it('filters out non-matching cards', () => {
    renderView();
    const search = screen.getByRole('textbox', { name: /search agents/i });
    fireEvent.change(search, { target: { value: 'developer' } });
    expect(document.querySelector('[data-testid="agent-card-developer-agent"]')).toBeDefined();
    expect(document.querySelector('[data-testid="agent-card-ux-api-designer"]')).toBeNull();
  });

  it('shows empty search state when nothing matches', () => {
    renderView();
    const search = screen.getByRole('textbox', { name: /search agents/i });
    fireEvent.change(search, { target: { value: 'zzz-no-match' } });
    expect(screen.getByText(/no agents match/i)).toBeDefined();
  });

  it('restores all cards when search is cleared', () => {
    renderView();
    const search = screen.getByRole('textbox', { name: /search agents/i });
    fireEvent.change(search, { target: { value: 'developer' } });
    fireEvent.change(search, { target: { value: '' } });
    expect(document.querySelector('[data-testid="agent-card-ux-api-designer"]')).toBeDefined();
  });

  it('shows × clear button in search row when search has text', () => {
    renderView();
    const search = screen.getByRole('textbox', { name: /search agents/i });
    fireEvent.change(search, { target: { value: 'developer' } });
    expect(screen.getByRole('button', { name: /clear search/i })).toBeDefined();
  });

  it('hides × clear button when search is empty', () => {
    renderView();
    // No text typed — button should not be present
    expect(screen.queryByRole('button', { name: /clear search/i })).toBeNull();
  });

  it('clicking × button clears the search and restores all cards', () => {
    renderView();
    const search = screen.getByRole('textbox', { name: /search agents/i });
    fireEvent.change(search, { target: { value: 'developer' } });
    expect(document.querySelector('[data-testid="agent-card-ux-api-designer"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /clear search/i }));
    expect(document.querySelector('[data-testid="agent-card-ux-api-designer"]')).toBeDefined();
  });

  it('shows helper text in empty search state', () => {
    renderView();
    const search = screen.getByRole('textbox', { name: /search agents/i });
    fireEvent.change(search, { target: { value: 'zzz-no-match' } });
    expect(screen.getByText(/try searching by agent name, model, or skill/i)).toBeDefined();
  });

  it('shows "Clear search" link button in empty search state', () => {
    renderView();
    const search = screen.getByRole('textbox', { name: /search agents/i });
    fireEvent.change(search, { target: { value: 'zzz-no-match' } });
    // Both the × button (in search row) and the link button (in empty state) have name "Clear search"
    const clearBtns = screen.getAllByRole('button', { name: /clear search/i });
    expect(clearBtns.length).toBeGreaterThanOrEqual(1);
    // Click the last one (the prominent "Clear search" in empty state)
    fireEvent.click(clearBtns[clearBtns.length - 1]);
    // Search should be cleared — all cards visible
    expect(document.querySelector('[data-testid="agent-card-ux-api-designer"]')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Save / dirty state
// ---------------------------------------------------------------------------

describe('AgentRoutingView — Save / Reset', () => {
  it('Save button is disabled when not dirty', () => {
    setup();
    renderView();
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn.hasAttribute('disabled')).toBe(true);
  });

  it('calls saveSettings when Save is clicked after editing a model', async () => {
    setup();
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ saveSettings, showToast: vi.fn() });

    renderView();
    // Expand ux-api-designer card
    const card = document.querySelector('[data-testid="agent-card-ux-api-designer"]');
    fireEvent.click(card!.querySelector('button')!);

    // Click a preset chip
    const opusChip = screen.getByText('opus-4-8');
    fireEvent.click(opusChip);

    // Save should now be enabled
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalled();
    });
  });

  it('calls onDirtyChange(true) when model is changed', () => {
    setup();
    const onDirtyChange = vi.fn();
    renderView(onDirtyChange);

    const card = document.querySelector('[data-testid="agent-card-ux-api-designer"]');
    fireEvent.click(card!.querySelector('button')!);
    fireEvent.click(screen.getByText('opus-4-8'));

    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it('Reset re-disables the Save button', () => {
    setup();
    renderView();

    const card = document.querySelector('[data-testid="agent-card-ux-api-designer"]');
    fireEvent.click(card!.querySelector('button')!);
    fireEvent.click(screen.getByText('opus-4-8'));

    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(saveBtn.hasAttribute('disabled')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scope selector
// ---------------------------------------------------------------------------

describe('AgentRoutingView — scope selector', () => {
  it('Space option is disabled when no active space matches', () => {
    setup({ spaces: [], activeSpaceId: '' });
    renderView();
    const spaceBtn = screen.getByRole('radio', { name: /space/i });
    expect(spaceBtn.hasAttribute('disabled')).toBe(true);
  });

  it('Space option is enabled when an active space is present', () => {
    setup({ spaces: [SPACE_WITH_MODELS], activeSpaceId: 'space-1' });
    renderView();
    const spaceBtn = screen.getByRole('radio', { name: /space · prism/i });
    expect(spaceBtn.hasAttribute('disabled')).toBe(false);
  });
});
