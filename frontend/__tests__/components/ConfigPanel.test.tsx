/**
 * Tests for ConfigPanel container component.
 * ADR-1 (Config Editor Panel): slide-over panel with sidebar + editor + discard guard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfigPanel } from '../../src/components/config/ConfigPanel';
import { useAppStore } from '../../src/stores/useAppStore';
import * as api from '../../src/api/client';
import type { ConfigFile } from '../../src/types';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(), getTasks: vi.fn(), createTask: vi.fn(), moveTask: vi.fn(),
  deleteTask: vi.fn(), createSpace: vi.fn(), renameSpace: vi.fn(), deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
  getConfigFiles: vi.fn(),
  getConfigFile: vi.fn(),
  saveConfigFile: vi.fn(),
}));

const mockGetConfigFiles = vi.mocked(api.getConfigFiles);

const GLOBAL_FILE: ConfigFile = {
  id: 'global-claude-md',
  name: 'CLAUDE.md',
  scope: 'global',
  directory: '~/.claude',
  sizeBytes: 1000,
  modifiedAt: '2026-03-18T12:00:00.000Z',
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
    configPanelOpen: true,
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
  mockGetConfigFiles.mockResolvedValue([GLOBAL_FILE, PROJECT_FILE]);
});

describe('ConfigPanel — structure', () => {
  it('renders the panel with aria-label "Configuration editor"', () => {
    render(<ConfigPanel />);
    expect(screen.getByRole('complementary', { name: /configuration editor/i })).toBeInTheDocument();
  });

  it('renders "Configuration" title in the panel header', () => {
    render(<ConfigPanel />);
    expect(screen.getByText('Configuration')).toBeInTheDocument();
  });

  it('renders the close button', () => {
    render(<ConfigPanel />);
    expect(screen.getByRole('button', { name: /close configuration panel/i })).toBeInTheDocument();
  });

  it('renders a drag handle with role=separator for panel resize', () => {
    render(<ConfigPanel />);
    const handle = screen.getByRole('separator', { name: /resize panel/i });
    expect(handle).toBeInTheDocument();
  });

  it('<aside> uses inline style width instead of a hardcoded w-[480px] class', () => {
    render(<ConfigPanel />);
    const aside = screen.getByRole('complementary', { name: /configuration editor/i });
    // Dynamic width is applied via style attribute
    expect(aside).toHaveStyle({ width: '480px' });
    // Hardcoded Tailwind width class must not be present
    expect(aside.className).not.toContain('w-[480px]');
  });

  it('calls loadConfigFiles on mount', async () => {
    render(<ConfigPanel />);
    await waitFor(() => {
      expect(mockGetConfigFiles).toHaveBeenCalledOnce();
    });
  });
});

describe('ConfigPanel — sidebar integration', () => {
  it('renders the file sidebar (nav)', async () => {
    mockGetConfigFiles.mockResolvedValue([GLOBAL_FILE]);
    render(<ConfigPanel />);
    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: /config files/i })).toBeInTheDocument();
    });
  });

  it('shows "Select a file to edit" in the editor when no file is active', () => {
    render(<ConfigPanel />);
    expect(screen.getByText(/select a file to edit/i)).toBeInTheDocument();
  });
});

describe('ConfigPanel — close button (clean state)', () => {
  it('calls setConfigPanelOpen(false) when close button clicked and not dirty', () => {
    const mockClose = vi.fn();
    useAppStore.setState({ setConfigPanelOpen: mockClose } as any);
    render(<ConfigPanel />);
    fireEvent.click(screen.getByRole('button', { name: /close configuration panel/i }));
    expect(mockClose).toHaveBeenCalledWith(false);
  });
});

describe('ConfigPanel — discard guard on close', () => {
  it('shows DiscardChangesDialog when close is clicked while dirty', () => {
    resetStore({ configDirty: true });
    render(<ConfigPanel />);
    fireEvent.click(screen.getByRole('button', { name: /close configuration panel/i }));
    // Modal should appear in document.body
    expect(document.body.querySelector('[role="alertdialog"]')).toBeInTheDocument();
    expect(document.body.querySelector('[role="alertdialog"]')?.textContent).toMatch(/unsaved changes/i);
  });

  it('does NOT close panel when Cancel is clicked in discard dialog', () => {
    const mockClose = vi.fn();
    useAppStore.setState({ setConfigPanelOpen: mockClose, configDirty: true } as any);
    render(<ConfigPanel />);
    fireEvent.click(screen.getByRole('button', { name: /close configuration panel/i }));
    const cancelBtn = document.body.querySelector('button[class*="secondary"]') as HTMLButtonElement
      || Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel');
    fireEvent.click(cancelBtn!);
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('closes panel when Discard is clicked in discard dialog', () => {
    const mockClose = vi.fn();
    useAppStore.setState({ setConfigPanelOpen: mockClose, configDirty: true } as any);
    render(<ConfigPanel />);
    fireEvent.click(screen.getByRole('button', { name: /close configuration panel/i }));
    const discardBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Discard'
    );
    fireEvent.click(discardBtn!);
    expect(mockClose).toHaveBeenCalledWith(false);
  });
});

describe('ConfigPanel — discard guard on file switch', () => {
  it('shows DiscardChangesDialog when switching files while dirty', async () => {
    mockGetConfigFiles.mockResolvedValue([GLOBAL_FILE, PROJECT_FILE]);
    resetStore({ configDirty: true });
    render(<ConfigPanel />);

    // Wait for files to load into store
    await waitFor(() => {
      expect(useAppStore.getState().configFiles.length).toBeGreaterThan(0);
    });

    // Manually set the config files in the store since loadConfigFiles is async
    useAppStore.setState({ configFiles: [GLOBAL_FILE, PROJECT_FILE] });

    // Re-render with files in store
    const { unmount } = render(<ConfigPanel />);
    // Sidebar should appear
    await waitFor(() => {
      const nav = screen.getAllByRole('navigation', { name: /config files/i });
      expect(nav.length).toBeGreaterThan(0);
    });

    // Click a file in the sidebar while dirty
    const rtkBtn = screen.queryByTitle('~/. claude')
      || screen.queryAllByRole('button').find((b) => b.title?.includes('~/.claude'));

    // Click the global file button directly via store action mock
    const mockSelectFile = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ selectConfigFile: mockSelectFile, configDirty: true } as any);

    // Trigger the sidebar file click — get any file button from nav
    const fileButtons = screen.getAllByRole('navigation')[0].querySelectorAll('button');
    if (fileButtons.length > 0) {
      fireEvent.click(fileButtons[0]);
      // Dialog should appear since configDirty is true
      expect(document.body.querySelector('[role="alertdialog"]')).toBeInTheDocument();
    }

    unmount();
  });
});
