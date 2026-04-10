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

  it('has h-10 min-w-[72px] px-3 size classes (T-4 redesign)', () => {
    render(<ConfigToggle />);
    const btn = screen.getByRole('button', { name: /toggle configuration editor/i });
    expect(btn.className).toContain('h-10');
    expect(btn.className).toContain('min-w-[72px]');
    expect(btn.className).toContain('px-3');
  });

  it('has flex-col layout for icon+label column (T-4 redesign)', () => {
    render(<ConfigToggle />);
    const btn = screen.getByRole('button', { name: /toggle configuration editor/i });
    expect(btn.className).toContain('flex-col');
    expect(btn.className).toContain('gap-0.5');
  });

  it('uses rounded-lg instead of rounded-xl (T-4 wireframe spec)', () => {
    render(<ConfigToggle />);
    const btn = screen.getByRole('button', { name: /toggle configuration editor/i });
    expect(btn.className).toContain('rounded-lg');
    expect(btn.className).not.toContain('rounded-xl');
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

  // T-5: text label tests
  it('renders "Config" text label (T-5)', () => {
    render(<ConfigToggle />);
    const btn = screen.getByRole('button', { name: /toggle configuration editor/i });
    const label = btn.querySelector('span:not(.material-symbols-outlined)');
    expect(label).toBeInTheDocument();
    expect(label?.textContent).toBe('Config');
  });

  it('label has hidden sm:block classes for mobile-only visibility (T-5)', () => {
    render(<ConfigToggle />);
    const btn = screen.getByRole('button', { name: /toggle configuration editor/i });
    const label = btn.querySelector('span:not(.material-symbols-outlined)');
    expect(label?.className).toContain('hidden');
    expect(label?.className).toContain('sm:block');
  });

  it('label has text-[10px] font-medium leading-none classes (T-5)', () => {
    render(<ConfigToggle />);
    const btn = screen.getByRole('button', { name: /toggle configuration editor/i });
    const label = btn.querySelector('span:not(.material-symbols-outlined)');
    expect(label?.className).toContain('text-[10px]');
    expect(label?.className).toContain('font-medium');
    expect(label?.className).toContain('leading-none');
  });
});
