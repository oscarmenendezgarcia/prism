/**
 * Component tests for AgentSettingsPanel.
 * BUG-002: zero coverage — these tests cover:
 *   - renders when open=true, hides when open=false
 *   - shows Custom binary input only when 'custom' tool is selected
 *   - Save Settings button calls saveSettings
 *   - Cancel button closes the panel without saving
 *   - pipeline toggles update local draft state
 *   - working directory input reflects settings
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentSettingsPanel } from '../../src/components/agent-launcher/AgentSettingsPanel';
import { useAppStore } from '../../src/stores/useAppStore';
import type { AgentSettings } from '../../src/types';

// ---------------------------------------------------------------------------
// Mock the API client
// ---------------------------------------------------------------------------

vi.mock('../../src/api/client', () => ({
  getSpaces:            vi.fn(),
  getTasks:             vi.fn(),
  createTask:           vi.fn(),
  moveTask:             vi.fn(),
  deleteTask:           vi.fn(),
  createSpace:          vi.fn(),
  renameSpace:          vi.fn(),
  deleteSpace:          vi.fn(),
  getAttachmentContent: vi.fn(),
  getAgents:            vi.fn(),
  generatePrompt:       vi.fn(),
  getSettings:          vi.fn(),
  saveSettings:         vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: AgentSettings = {
  cli: {
    tool:            'claude',
    binary:          'claude',
    flags:           ['-p'],
    promptFlag:      '-p',
    fileInputMethod: 'cat-subshell',
  },
  pipeline: {
    autoAdvance:          true,
    confirmBetweenStages: true,
    stages: ['senior-architect', 'ux-api-designer', 'developer-agent', 'qa-engineer-e2e'],
  },
    prompts: {
      includeKanbanBlock: true,
      includeGitBlock:    true,
      workingDirectory:   '',
      customInstructions: '',
    },
};

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

function resetStore(overrides: Record<string, unknown> = {}) {
  useAppStore.setState({
    agentSettingsPanelOpen:    false,
    agentSettings:             DEFAULT_SETTINGS,
    setAgentSettingsPanelOpen: vi.fn((open: boolean) =>
      useAppStore.setState({ agentSettingsPanelOpen: open } as any)
    ),
    saveSettings:              vi.fn(),
    ...overrides,
  } as any);
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentSettingsPanel — visibility', () => {
  it('renders nothing when panel is closed', () => {
    resetStore({ agentSettingsPanelOpen: false });
    const { container } = render(<AgentSettingsPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the panel when open=true', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    expect(screen.getByRole('complementary', { name: /agent launcher settings/i })).toBeInTheDocument();
  });

  it('shows "Agent Settings" heading', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    expect(screen.getByText('Agent Settings')).toBeInTheDocument();
  });

  it('renders a drag handle with role=separator for panel resize', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    const handle = screen.getByRole('separator', { name: /resize panel/i });
    expect(handle).toBeInTheDocument();
  });

  it('<aside> uses inline style width instead of a hardcoded w-[480px] class', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    const aside = screen.getByRole('complementary', { name: /agent launcher settings/i });
    expect(aside).toHaveStyle({ width: '480px' });
    expect(aside.className).not.toContain('w-[480px]');
  });
});

describe('AgentSettingsPanel — loading state', () => {
  it('shows loading message when agentSettings is null', () => {
    resetStore({ agentSettingsPanelOpen: true, agentSettings: null });
    render(<AgentSettingsPanel />);
    expect(screen.getByText('Loading settings...')).toBeInTheDocument();
  });
});

describe('AgentSettingsPanel — CLI tool selection', () => {
  it('renders all three CLI tool radio options', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    expect(screen.getByRole('radio', { name: /claude code/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /opencode/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /custom/i })).toBeInTheDocument();
  });

  it('does NOT show custom binary input when tool is claude', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    expect(screen.queryByLabelText(/binary path/i)).toBeNull();
  });

  it('shows custom binary input when Custom radio is selected', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    fireEvent.click(screen.getByRole('radio', { name: /custom/i }));
    expect(screen.getByLabelText(/binary path/i)).toBeInTheDocument();
  });

  it('hides custom binary input when switching back to claude', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    fireEvent.click(screen.getByRole('radio', { name: /custom/i }));
    fireEvent.click(screen.getByRole('radio', { name: /claude code/i }));
    expect(screen.queryByLabelText(/binary path/i)).toBeNull();
  });
});

describe('AgentSettingsPanel — prompt delivery method', () => {
  it('renders all three file input method options', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    expect(screen.getByDisplayValue('cat-subshell')).toBeInTheDocument();
    expect(screen.getByDisplayValue('stdin-redirect')).toBeInTheDocument();
    expect(screen.getByDisplayValue('flag-file')).toBeInTheDocument();
  });

  it('cat-subshell is selected by default', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    expect(screen.getByDisplayValue('cat-subshell')).toBeChecked();
  });
});

describe('AgentSettingsPanel — pipeline section', () => {
  it('renders Auto-advance stages toggle', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    expect(screen.getByRole('switch', { name: /auto-advance stages/i })).toBeInTheDocument();
  });

  it('renders Confirm between stages toggle', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    expect(screen.getByRole('switch', { name: /confirm between stages/i })).toBeInTheDocument();
  });

  it('auto-advance toggle reflects settings value (true → aria-checked="true")', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    expect(screen.getByRole('switch', { name: /auto-advance stages/i }))
      .toHaveAttribute('aria-checked', 'true');
  });

  it('clicking auto-advance toggle flips its aria-checked state locally', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    const toggle = screen.getByRole('switch', { name: /auto-advance stages/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('shows stage order list', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    expect(screen.getByText('Stage order (read-only)')).toBeInTheDocument();
    // Four stages rendered
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(4);
  });
});

describe('AgentSettingsPanel — working directory input', () => {
  it('renders working directory input', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    expect(screen.getByLabelText(/working directory/i)).toBeInTheDocument();
  });

  it('reflects the settings workingDirectory value', () => {
    resetStore({
      agentSettingsPanelOpen: true,
      agentSettings: {
        ...DEFAULT_SETTINGS,
        prompts: { ...DEFAULT_SETTINGS.prompts, workingDirectory: '/home/user/project' },
      },
    });
    render(<AgentSettingsPanel />);
    expect(screen.getByLabelText(/working directory/i)).toHaveValue('/home/user/project');
  });
});

describe('AgentSettingsPanel — custom instructions', () => {
  it('renders custom instructions textarea', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    expect(screen.getByPlaceholderText(/e.g. Always use TypeScript/i)).toBeInTheDocument();
  });

  it('reflects the settings customInstructions value', () => {
    resetStore({
      agentSettingsPanelOpen: true,
      agentSettings: {
        ...DEFAULT_SETTINGS,
        prompts: { ...DEFAULT_SETTINGS.prompts, customInstructions: 'Use markdown formatting.' },
      },
    });
    render(<AgentSettingsPanel />);
    expect(screen.getByPlaceholderText(/e.g. Always use TypeScript/i)).toHaveValue('Use markdown formatting.');
  });

  it('renders MarkdownViewer when custom instructions contain content', () => {
    resetStore({
      agentSettingsPanelOpen: true,
      agentSettings: {
        ...DEFAULT_SETTINGS,
        prompts: { ...DEFAULT_SETTINGS.prompts, customInstructions: '# Heading\n\n**Bold text**' },
      },
    });
    render(<AgentSettingsPanel />);
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument();
  });

  it('does NOT render MarkdownViewer when custom instructions are empty', () => {
    resetStore({
      agentSettingsPanelOpen: true,
      agentSettings: {
        ...DEFAULT_SETTINGS,
        prompts: { ...DEFAULT_SETTINGS.prompts, customInstructions: '' },
      },
    });
    render(<AgentSettingsPanel />);
    expect(screen.queryByText('Heading')).not.toBeInTheDocument();
    expect(screen.queryByText('Bold text')).not.toBeInTheDocument();
  });

  it('includes customInstructions in save', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    resetStore({
      agentSettingsPanelOpen: true,
      saveSettings: saveFn,
      agentSettings: {
        ...DEFAULT_SETTINGS,
        prompts: { ...DEFAULT_SETTINGS.prompts, customInstructions: 'Custom note.' },
      },
    });
    render(<AgentSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => {
      expect(saveFn).toHaveBeenCalledWith(
        expect.objectContaining({
          prompts: expect.objectContaining({ customInstructions: 'Custom note.' }),
        })
      );
    });
  });
});

describe('AgentSettingsPanel — Save Settings', () => {
  it('renders Save Settings button', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    expect(screen.getByRole('button', { name: /save settings/i })).toBeInTheDocument();
  });

  it('clicking Save Settings calls saveSettings from store', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    resetStore({ agentSettingsPanelOpen: true, saveSettings: saveFn });
    render(<AgentSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(saveFn).toHaveBeenCalledOnce());
  });

  it('calls saveSettings with the current cli/pipeline/prompts draft', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    resetStore({ agentSettingsPanelOpen: true, saveSettings: saveFn });
    render(<AgentSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => {
      expect(saveFn).toHaveBeenCalledWith(
        expect.objectContaining({
          cli:      expect.objectContaining({ tool: 'claude' }),
          pipeline: expect.objectContaining({ autoAdvance: true }),
          prompts:  expect.objectContaining({ includeKanbanBlock: true }),
        })
      );
    });
  });

  it('button shows "Saving..." while save is in-flight', async () => {
    let resolve: (v: undefined) => void = () => {};
    const saveFn = vi.fn(() => new Promise<undefined>((r) => { resolve = r; }));
    resetStore({ agentSettingsPanelOpen: true, saveSettings: saveFn });
    render(<AgentSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(screen.getByText('Saving...')).toBeInTheDocument());
    resolve(undefined);
    await waitFor(() => expect(screen.queryByText('Saving...')).toBeNull());
  });
});

describe('AgentSettingsPanel — Cancel button', () => {
  it('renders Cancel button', () => {
    resetStore({ agentSettingsPanelOpen: true });
    render(<AgentSettingsPanel />);
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
  });

  it('clicking Cancel sets agentSettingsPanelOpen to false without calling saveSettings', () => {
    const saveFn = vi.fn();
    const setOpenFn = vi.fn((open: boolean) =>
      useAppStore.setState({ agentSettingsPanelOpen: open } as any)
    );
    resetStore({
      agentSettingsPanelOpen:    true,
      saveSettings:              saveFn,
      setAgentSettingsPanelOpen: setOpenFn,
    });
    render(<AgentSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(saveFn).not.toHaveBeenCalled();
    expect(setOpenFn).toHaveBeenCalledWith(false);
  });

  it('clicking the X (close) button also closes without saving', () => {
    const saveFn = vi.fn();
    const setOpenFn = vi.fn((open: boolean) =>
      useAppStore.setState({ agentSettingsPanelOpen: open } as any)
    );
    resetStore({
      agentSettingsPanelOpen:    true,
      saveSettings:              saveFn,
      setAgentSettingsPanelOpen: setOpenFn,
    });
    render(<AgentSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /close agent settings panel/i }));
    expect(saveFn).not.toHaveBeenCalled();
    expect(setOpenFn).toHaveBeenCalledWith(false);
  });
});
