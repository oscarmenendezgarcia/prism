/**
 * Component tests for PreferencesView — the "Preferences" tab in ConfigPanel.
 * Ports the CLI/pipeline/prompts coverage that used to live in
 * AgentSettingsPanel.test.tsx, plus the new Theme section and the
 * onDirtyChange/Save-Reset footer that replaced the slide-over's Save/Cancel.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PreferencesView } from '../../src/components/config/PreferencesView';
import { useAppStore } from '../../src/stores/useAppStore';
import type { AgentSettings } from '../../src/types';

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

function mockMatchMedia(matches = false) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({
      matches,
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

function resetStore(overrides: Record<string, unknown> = {}) {
  useAppStore.setState({
    agentSettings: DEFAULT_SETTINGS,
    saveSettings:  vi.fn(),
    ...overrides,
  } as any);
}

function renderView(onDirtyChange = vi.fn()) {
  return { onDirtyChange, ...render(<PreferencesView onDirtyChange={onDirtyChange} />) };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  mockMatchMedia(false);
  resetStore();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PreferencesView — loading state', () => {
  it('shows loading message when agentSettings is null', () => {
    resetStore({ agentSettings: null });
    renderView();
    expect(screen.getByText('Loading settings…')).toBeInTheDocument();
  });
});

describe('PreferencesView — theme section', () => {
  it('renders a Theme heading and the theme toggle button', () => {
    renderView();
    expect(screen.getByText('Theme')).toBeInTheDocument();
    expect(screen.getByLabelText(/switch to/i)).toBeInTheDocument();
  });
});

describe('PreferencesView — prompt delivery method', () => {
  it('renders all three file input method options, cat-subshell selected by default', () => {
    renderView();
    expect(screen.getByDisplayValue('cat-subshell')).toBeChecked();
    expect(screen.getByDisplayValue('stdin-redirect')).toBeInTheDocument();
    expect(screen.getByDisplayValue('flag-file')).toBeInTheDocument();
  });

  it('does not render an AI Provider / CLI tool picker — CLI routing lives in Agents & Routing now', () => {
    renderView();
    expect(screen.queryByText('AI Provider')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /claude code/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/binary path/i)).not.toBeInTheDocument();
  });

  it('selecting a prompt delivery method marks the view dirty', () => {
    const { onDirtyChange } = renderView();
    fireEvent.click(screen.getByDisplayValue('stdin-redirect'));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });
});

describe('PreferencesView — pipeline section', () => {
  it('renders Auto-advance and Confirm between stages toggles reflecting settings', () => {
    renderView();
    expect(screen.getByRole('switch', { name: /auto-advance stages/i }))
      .toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /confirm between stages/i }))
      .toHaveAttribute('aria-checked', 'true');
  });

  it('clicking auto-advance toggle flips its aria-checked state and marks dirty', () => {
    const { onDirtyChange } = renderView();
    const toggle = screen.getByRole('switch', { name: /auto-advance stages/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('shows stage order list', () => {
    renderView();
    expect(screen.getByText('Default stage order')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(4);
  });
});

describe('PreferencesView — working directory input', () => {
  it('reflects the settings workingDirectory value', () => {
    resetStore({
      agentSettings: {
        ...DEFAULT_SETTINGS,
        prompts: { ...DEFAULT_SETTINGS.prompts, workingDirectory: '/home/user/project' },
      },
    });
    renderView();
    expect(screen.getByLabelText(/working directory/i)).toHaveValue('/home/user/project');
  });
});

describe('PreferencesView — custom instructions', () => {
  it('renders MarkdownViewer only when custom instructions contain content', () => {
    resetStore({
      agentSettings: {
        ...DEFAULT_SETTINGS,
        prompts: { ...DEFAULT_SETTINGS.prompts, customInstructions: '# Heading' },
      },
    });
    renderView();
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument();
  });

  it('does NOT render MarkdownViewer when custom instructions are empty', () => {
    renderView();
    expect(screen.queryByRole('heading', { name: 'Heading' })).not.toBeInTheDocument();
  });
});

describe('PreferencesView — Save / Reset footer', () => {
  it('Save and Reset are disabled when there are no local edits', () => {
    renderView();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^reset$/i })).toBeDisabled();
  });

  it('editing a field enables Save/Reset and calls onDirtyChange(true)', () => {
    const { onDirtyChange } = renderView();
    fireEvent.click(screen.getByRole('switch', { name: /auto-advance stages/i }));
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^reset$/i })).toBeEnabled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('clicking Save calls saveSettings with the current cli/pipeline/prompts draft', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    resetStore({ saveSettings: saveFn });
    renderView();
    fireEvent.click(screen.getByRole('switch', { name: /auto-advance stages/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      expect(saveFn).toHaveBeenCalledWith(
        expect.objectContaining({
          cli:      expect.objectContaining({ tool: 'claude' }),
          pipeline: expect.objectContaining({ autoAdvance: false }),
          prompts:  expect.objectContaining({ includeKanbanBlock: true }),
        })
      );
    });
  });

  it('Save button shows "Saving…" while save is in-flight, then clears dirty', async () => {
    let resolve: (v: undefined) => void = () => {};
    const saveFn = vi.fn(() => new Promise<undefined>((r) => { resolve = r; }));
    const onDirtyChange = vi.fn();
    resetStore({ saveSettings: saveFn });
    render(<PreferencesView onDirtyChange={onDirtyChange} />);
    fireEvent.click(screen.getByRole('switch', { name: /auto-advance stages/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByText('Saving…')).toBeInTheDocument());
    resolve(undefined);
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it('clicking Reset restores the last-saved draft without calling saveSettings', () => {
    const saveFn = vi.fn();
    resetStore({ saveSettings: saveFn });
    renderView();
    const toggle = screen.getByRole('switch', { name: /auto-advance stages/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('button', { name: /^reset$/i }));
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(saveFn).not.toHaveBeenCalled();
  });
});
