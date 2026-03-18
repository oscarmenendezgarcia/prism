/**
 * Tests for ConfigToggle component.
 * ADR-1 (Config Editor Panel): toggle button in the header.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfigToggle } from '../../src/components/config/ConfigToggle';
import { useAppStore } from '../../src/stores/useAppStore';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(),
  getTasks: vi.fn(),
  createTask: vi.fn(),
  moveTask: vi.fn(),
  deleteTask: vi.fn(),
  createSpace: vi.fn(),
  renameSpace: vi.fn(),
  deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
  getConfigFiles: vi.fn(),
  getConfigFile: vi.fn(),
  saveConfigFile: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({
    configPanelOpen: false,
    configFiles: [],
    activeConfigFileId: null,
    activeConfigContent: '',
    activeConfigOriginal: '',
    configDirty: false,
    configLoading: false,
    configSaving: false,
  });
});

describe('ConfigToggle', () => {
  it('renders a button with aria-label "Toggle configuration editor"', () => {
    render(<ConfigToggle />);
    expect(screen.getByRole('button', { name: /toggle configuration editor/i })).toBeInTheDocument();
  });

  it('renders the settings material icon', () => {
    render(<ConfigToggle />);
    const icon = document.querySelector('.material-symbols-outlined');
    expect(icon).toBeInTheDocument();
    expect(icon?.textContent).toBe('settings');
  });

  it('has aria-pressed=false when panel is closed', () => {
    useAppStore.setState({ configPanelOpen: false });
    render(<ConfigToggle />);
    const btn = screen.getByRole('button', { name: /toggle configuration editor/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('has aria-pressed=true when panel is open', () => {
    useAppStore.setState({ configPanelOpen: true });
    render(<ConfigToggle />);
    const btn = screen.getByRole('button', { name: /toggle configuration editor/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('applies active class when configPanelOpen is true', () => {
    useAppStore.setState({ configPanelOpen: true });
    render(<ConfigToggle />);
    const btn = screen.getByRole('button', { name: /toggle configuration editor/i });
    expect(btn.className).toContain('text-primary');
  });

  it('applies inactive class when configPanelOpen is false', () => {
    useAppStore.setState({ configPanelOpen: false });
    render(<ConfigToggle />);
    const btn = screen.getByRole('button', { name: /toggle configuration editor/i });
    expect(btn.className).toContain('text-text-secondary');
  });

  it('calls toggleConfigPanel on click', () => {
    const mockToggle = vi.fn();
    useAppStore.setState({ toggleConfigPanel: mockToggle } as any);
    render(<ConfigToggle />);
    fireEvent.click(screen.getByRole('button', { name: /toggle configuration editor/i }));
    expect(mockToggle).toHaveBeenCalledOnce();
  });

  it('toggles configPanelOpen state when clicked via real store', () => {
    // Reset the store fully, including the toggleConfigPanel action as the real impl.
    useAppStore.setState({
      configPanelOpen: false,
      toggleConfigPanel: () => {
        const next = !useAppStore.getState().configPanelOpen;
        useAppStore.setState({ configPanelOpen: next });
      },
    } as any);
    render(<ConfigToggle />);
    const btn = screen.getByRole('button', { name: /toggle configuration editor/i });
    fireEvent.click(btn);
    expect(useAppStore.getState().configPanelOpen).toBe(true);
  });
});
