/**
 * Tests for ConfigEditor component.
 * ADR-1 (Config Editor Panel): textarea editor with dirty state and save.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfigEditor } from '../../src/components/config/ConfigEditor';
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
  sizeBytes: 100,
  modifiedAt: '2026-03-18T12:00:00.000Z',
};

function resetStore(overrides = {}) {
  useAppStore.setState({
    configFiles: [],
    activeConfigFileId: null,
    activeConfigContent: '',
    activeConfigOriginal: '',
    configDirty: false,
    configLoading: false,
    configSaving: false,
    ...overrides,
  });
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

describe('ConfigEditor — empty state (no file selected)', () => {
  it('shows "Select a file to edit" when no file is selected', () => {
    render(<ConfigEditor />);
    expect(screen.getByText(/select a file to edit/i)).toBeInTheDocument();
  });

  it('does not render a textarea when no file is selected', () => {
    render(<ConfigEditor />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('ConfigEditor — file loaded', () => {
  beforeEach(() => {
    resetStore({
      configFiles: [GLOBAL_FILE],
      activeConfigFileId: 'global-claude-md',
      activeConfigContent: '# My Config\n',
      activeConfigOriginal: '# My Config\n',
      configDirty: false,
    });
  });

  it('renders a textarea with the file content', () => {
    render(<ConfigEditor />);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeInTheDocument();
    expect((textarea as HTMLTextAreaElement).value).toBe('# My Config\n');
  });

  it('textarea has aria-label referencing the file name', () => {
    render(<ConfigEditor />);
    expect(screen.getByLabelText(/edit claude\.md/i)).toBeInTheDocument();
  });

  it('shows the file name in the mini-header', () => {
    render(<ConfigEditor />);
    expect(screen.getByText('CLAUDE.md')).toBeInTheDocument();
  });

  it('shows the "global" scope badge', () => {
    render(<ConfigEditor />);
    expect(screen.getByText('global')).toBeInTheDocument();
  });

  it('Save button is disabled when not dirty', () => {
    render(<ConfigEditor />);
    const saveBtn = screen.getByRole('button', { name: /save file/i });
    expect(saveBtn).toBeDisabled();
  });

  it('does not show "Unsaved changes" when not dirty', () => {
    render(<ConfigEditor />);
    // The span is present but visually hidden via opacity-0
    const indicator = screen.getByText(/unsaved changes/i);
    expect(indicator.className).toContain('opacity-0');
  });
});

describe('ConfigEditor — dirty state', () => {
  beforeEach(() => {
    resetStore({
      configFiles: [GLOBAL_FILE],
      activeConfigFileId: 'global-claude-md',
      activeConfigContent: '# Modified\n',
      activeConfigOriginal: '# Original\n',
      configDirty: true,
    });
  });

  it('shows "Unsaved changes" indicator when dirty', () => {
    render(<ConfigEditor />);
    const indicator = screen.getByText(/unsaved changes/i);
    expect(indicator.className).not.toContain('opacity-0');
  });

  it('Save button is enabled when dirty', () => {
    render(<ConfigEditor />);
    const saveBtn = screen.getByRole('button', { name: /save file/i });
    expect(saveBtn).not.toBeDisabled();
  });

  it('clicking Save button calls saveConfigFile from store', () => {
    const mockSave = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ saveConfigFile: mockSave } as any);
    render(<ConfigEditor />);
    fireEvent.click(screen.getByRole('button', { name: /save file/i }));
    expect(mockSave).toHaveBeenCalledOnce();
  });
});

describe('ConfigEditor — saving state', () => {
  it('Save button is disabled while saving', () => {
    resetStore({
      configFiles: [GLOBAL_FILE],
      activeConfigFileId: 'global-claude-md',
      activeConfigContent: '# Modified\n',
      activeConfigOriginal: '# Original\n',
      configDirty: true,
      configSaving: true,
    });
    render(<ConfigEditor />);
    const saveBtn = screen.getByRole('button', { name: /save file/i });
    expect(saveBtn).toBeDisabled();
  });
});

describe('ConfigEditor — textarea change', () => {
  it('calls setConfigContent when textarea value changes', () => {
    const mockSetContent = vi.fn();
    resetStore({
      configFiles: [GLOBAL_FILE],
      activeConfigFileId: 'global-claude-md',
      activeConfigContent: '# Original\n',
      activeConfigOriginal: '# Original\n',
      configDirty: false,
    });
    useAppStore.setState({ setConfigContent: mockSetContent } as any);
    render(<ConfigEditor />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '# Changed\n' } });
    expect(mockSetContent).toHaveBeenCalledWith('# Changed\n');
  });
});

describe('ConfigEditor — Ctrl+S shortcut', () => {
  it('calls saveConfigFile when Ctrl+S is pressed and dirty', () => {
    const mockSave = vi.fn().mockResolvedValue(undefined);
    resetStore({
      configFiles: [GLOBAL_FILE],
      activeConfigFileId: 'global-claude-md',
      activeConfigContent: '# Modified\n',
      activeConfigOriginal: '# Original\n',
      configDirty: true,
      configSaving: false,
    });
    useAppStore.setState({ saveConfigFile: mockSave } as any);
    render(<ConfigEditor />);
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    expect(mockSave).toHaveBeenCalledOnce();
  });

  it('does not call saveConfigFile when Ctrl+S pressed but not dirty', () => {
    const mockSave = vi.fn().mockResolvedValue(undefined);
    resetStore({
      configFiles: [GLOBAL_FILE],
      activeConfigFileId: 'global-claude-md',
      activeConfigContent: '# Original\n',
      activeConfigOriginal: '# Original\n',
      configDirty: false,
      configSaving: false,
    });
    useAppStore.setState({ saveConfigFile: mockSave } as any);
    render(<ConfigEditor />);
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    expect(mockSave).not.toHaveBeenCalled();
  });
});
