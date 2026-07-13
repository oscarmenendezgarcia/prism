/**
 * Tests for ConfigFileSidebar component.
 * ADR-1 (Config Editor Panel): file list grouped by scope with active highlight.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfigFileSidebar } from '../../src/components/config/ConfigFileSidebar';
import { useAppStore } from '../../src/stores/useAppStore';
import type { ConfigFile } from '../../src/types';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(), getTasks: vi.fn(), createTask: vi.fn(), moveTask: vi.fn(),
  deleteTask: vi.fn(), createSpace: vi.fn(), renameSpace: vi.fn(), deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(), getConfigFiles: vi.fn(), getConfigFile: vi.fn(),
  saveConfigFile: vi.fn(),
}));

const GLOBAL_FILE: ConfigFile = {
  id: 'global-claude-md',
  name: 'CLAUDE.md',
  scope: 'global',
  directory: '~/.claude',
  sizeBytes: 1000,
  modifiedAt: '2026-03-18T12:00:00.000Z',
};

const GLOBAL_FILE_2: ConfigFile = {
  id: 'global-rtk-md',
  name: 'RTK.md',
  scope: 'global',
  directory: '~/.claude',
  sizeBytes: 500,
  modifiedAt: '2026-03-18T10:00:00.000Z',
};

const PROJECT_FILE: ConfigFile = {
  id: 'project-claude-md',
  name: 'CLAUDE.md',
  scope: 'project',
  directory: './',
  sizeBytes: 2000,
  modifiedAt: '2026-03-18T11:00:00.000Z',
};

function resetStore(overrides = {}) {
  useAppStore.setState({
    configFiles: [],
    activeConfigFileId: null,
    configLoading: false,
    configDirty: false,
    ...overrides,
  });
}

beforeEach(() => {
  resetStore();
});

describe('ConfigFileSidebar — empty state', () => {
  it('shows "No config files found" when list is empty', () => {
    render(<ConfigFileSidebar onRequestSwitch={vi.fn()} />);
    expect(screen.getByText(/no config files found/i)).toBeInTheDocument();
  });

  it('shows spinner when loading with empty list', () => {
    resetStore({ configLoading: true, configFiles: [] });
    render(<ConfigFileSidebar onRequestSwitch={vi.fn()} />);
    // The spinner icon is rendered
    const icon = document.querySelector('.material-symbols-outlined');
    expect(icon?.textContent).toBe('progress_activity');
  });
});

describe('ConfigFileSidebar — file list', () => {
  beforeEach(() => {
    resetStore({ configFiles: [GLOBAL_FILE, GLOBAL_FILE_2, PROJECT_FILE] });
  });

  it('renders "Global" section heading', () => {
    render(<ConfigFileSidebar onRequestSwitch={vi.fn()} />);
    expect(screen.getByText(/global/i)).toBeInTheDocument();
  });

  it('renders "Project" section heading', () => {
    render(<ConfigFileSidebar onRequestSwitch={vi.fn()} />);
    expect(screen.getByText(/project/i)).toBeInTheDocument();
  });

  it('renders all file names', () => {
    render(<ConfigFileSidebar onRequestSwitch={vi.fn()} />);
    // CLAUDE.md appears twice (global + project)
    const claudeItems = screen.getAllByText('CLAUDE.md');
    expect(claudeItems.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('RTK.md')).toBeInTheDocument();
  });

  it('renders directory labels', () => {
    render(<ConfigFileSidebar onRequestSwitch={vi.fn()} />);
    const dirs = screen.getAllByText('~/.claude');
    expect(dirs.length).toBe(2);
    expect(screen.getByText('./')).toBeInTheDocument();
  });

  it('calls onRequestSwitch with the file ID when a file is clicked', () => {
    const onSwitch = vi.fn();
    render(<ConfigFileSidebar onRequestSwitch={onSwitch} />);
    // Click the RTK.md file button
    fireEvent.click(screen.getByText('RTK.md'));
    expect(onSwitch).toHaveBeenCalledWith('global-rtk-md');
  });

  it('calls onRequestSwitch with project file ID when project file clicked', () => {
    const onSwitch = vi.fn();
    render(<ConfigFileSidebar onRequestSwitch={onSwitch} />);
    // Click the project CLAUDE.md (second occurrence)
    const projectFileBtn = screen.getByText('./').closest('button');
    fireEvent.click(projectFileBtn!);
    expect(onSwitch).toHaveBeenCalledWith('project-claude-md');
  });
});

describe('ConfigFileSidebar — active file highlight', () => {
  it('highlights the active file with active classes', () => {
    resetStore({
      configFiles: [GLOBAL_FILE, GLOBAL_FILE_2],
      activeConfigFileId: 'global-rtk-md',
    });
    render(<ConfigFileSidebar onRequestSwitch={vi.fn()} />);
    // The RTK.md button should have the active class
    const rtkBtn = screen.getByText('RTK.md').closest('button');
    expect(rtkBtn?.className).toContain('text-primary');
  });

  it('does not highlight inactive files', () => {
    resetStore({
      configFiles: [GLOBAL_FILE, GLOBAL_FILE_2],
      activeConfigFileId: 'global-rtk-md',
    });
    render(<ConfigFileSidebar onRequestSwitch={vi.fn()} />);
    const claudeBtn = screen.getByText('CLAUDE.md').closest('button');
    // The inactive button should not have the primary active class
    expect(claudeBtn?.className).not.toContain('bg-primary');
  });

  it('sets aria-current="page" on the active file button', () => {
    resetStore({
      configFiles: [GLOBAL_FILE],
      activeConfigFileId: 'global-claude-md',
    });
    render(<ConfigFileSidebar onRequestSwitch={vi.fn()} />);
    const btn = screen.getByText('CLAUDE.md').closest('button');
    expect(btn).toHaveAttribute('aria-current', 'page');
  });
});

describe('ConfigFileSidebar — only global files', () => {
  it('renders Global section but no Project section when no project files', () => {
    resetStore({ configFiles: [GLOBAL_FILE] });
    render(<ConfigFileSidebar onRequestSwitch={vi.fn()} />);
    expect(screen.getByText(/global/i)).toBeInTheDocument();
    expect(screen.queryByText(/project/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// BUG-002: Agent-scope section coverage
// ---------------------------------------------------------------------------

const AGENT_FILE: ConfigFile = {
  id: 'agent-developer-agent-md',
  name: 'developer-agent.md',
  scope: 'agent',
  directory: '~/.claude/agents',
  sizeBytes: 6300,
  modifiedAt: '2026-03-18T09:00:00.000Z',
};

const AGENT_FILE_2: ConfigFile = {
  id: 'agent-senior-architect-md',
  name: 'senior-architect.md',
  scope: 'agent',
  directory: '~/.claude/agents',
  sizeBytes: 11400,
  modifiedAt: '2026-03-18T08:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Proposal D: agent-scope files are no longer shown in the Files sidebar.
// They moved to the "Agents & Routing" tab in ConfigPanel.
// ---------------------------------------------------------------------------

describe('ConfigFileSidebar — agent-scope section (Proposal D)', () => {
  it('does NOT render "Agents" section heading even when agent-scope files exist', () => {
    resetStore({ configFiles: [AGENT_FILE] });
    render(<ConfigFileSidebar onRequestSwitch={vi.fn()} />);
    // There is no "Agents" heading — agent files moved to the routing tab
    expect(screen.queryByText('Agents')).not.toBeInTheDocument();
  });

  it('does NOT render agent file names in the sidebar', () => {
    resetStore({ configFiles: [AGENT_FILE, AGENT_FILE_2] });
    render(<ConfigFileSidebar onRequestSwitch={vi.fn()} />);
    expect(screen.queryByText('developer-agent.md')).not.toBeInTheDocument();
    expect(screen.queryByText('senior-architect.md')).not.toBeInTheDocument();
  });

  it('renders an empty nav when only agent-scope files are provided (no Global/Project)', () => {
    resetStore({ configFiles: [AGENT_FILE] });
    render(<ConfigFileSidebar onRequestSwitch={vi.fn()} />);
    // configFiles.length > 0 so the empty-state div is not shown; the nav renders empty
    const nav = screen.getByRole('navigation', { name: /config files/i });
    expect(nav).toBeInTheDocument();
    // No section headings or file buttons inside
    expect(nav.querySelectorAll('button').length).toBe(0);
  });

  it('does not render "Agents" heading when no agent-scope files exist', () => {
    resetStore({ configFiles: [GLOBAL_FILE, PROJECT_FILE] });
    render(<ConfigFileSidebar onRequestSwitch={vi.fn()} />);
    expect(screen.queryByText('Agents')).not.toBeInTheDocument();
  });
});
