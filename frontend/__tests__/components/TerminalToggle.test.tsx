/**
 * TerminalToggle tests.
 * ADR-1 (multi-tab-terminal): reads panelOpen from useTerminalSessionStore.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TerminalToggle } from '../../src/components/terminal/TerminalToggle';
import { useTerminalSessionStore } from '../../src/stores/useTerminalSessionStore';

vi.mock('../../src/api/client', () => ({
  getSpaces: vi.fn(), getTasks: vi.fn(), createTask: vi.fn(), moveTask: vi.fn(),
  deleteTask: vi.fn(), createSpace: vi.fn(), renameSpace: vi.fn(), deleteSpace: vi.fn(),
  getAttachmentContent: vi.fn(),
}));

beforeEach(() => {
  useTerminalSessionStore.setState({ panelOpen: false });
});

describe('TerminalToggle', () => {
  it('renders the terminal toggle button', () => {
    render(<TerminalToggle />);
    expect(screen.getByRole('button', { name: /toggle terminal panel/i })).toBeInTheDocument();
  });

  it('has aria-pressed=false when terminal is closed', () => {
    render(<TerminalToggle />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('has aria-pressed=true when terminal is open', () => {
    useTerminalSessionStore.setState({ panelOpen: true });
    render(<TerminalToggle />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls togglePanel when clicked', () => {
    const mockToggle = vi.fn();
    useTerminalSessionStore.setState({ togglePanel: mockToggle } as any);
    render(<TerminalToggle />);
    fireEvent.click(screen.getByRole('button'));
    expect(mockToggle).toHaveBeenCalled();
  });

  it('applies active style when terminal is open', () => {
    useTerminalSessionStore.setState({ panelOpen: true });
    render(<TerminalToggle />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('has h-10 min-w-[72px] px-3 size classes (T-4 redesign)', () => {
    render(<TerminalToggle />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('h-10');
    expect(btn.className).toContain('min-w-[72px]');
    expect(btn.className).toContain('px-3');
  });

  it('has flex-col layout class for icon+label column (T-4 redesign)', () => {
    render(<TerminalToggle />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('flex-col');
    expect(btn.className).toContain('gap-0.5');
  });

  it('uses rounded-lg instead of rounded-xl (T-4 wireframe spec)', () => {
    render(<TerminalToggle />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('rounded-lg');
    expect(btn.className).not.toContain('rounded-xl');
  });

  // T-5: text label tests
  it('renders "Terminal" text label (T-5)', () => {
    render(<TerminalToggle />);
    const btn = screen.getByRole('button');
    const label = btn.querySelector('span:not(.material-symbols-outlined)');
    expect(label).toBeInTheDocument();
    expect(label?.textContent).toBe('Terminal');
  });

  it('label has hidden sm:block classes for mobile-only visibility (T-5)', () => {
    render(<TerminalToggle />);
    const btn = screen.getByRole('button');
    const label = btn.querySelector('span:not(.material-symbols-outlined)');
    expect(label?.className).toContain('hidden');
    expect(label?.className).toContain('sm:block');
  });

  it('label has text-[10px] font-medium leading-none classes (T-5)', () => {
    render(<TerminalToggle />);
    const btn = screen.getByRole('button');
    const label = btn.querySelector('span:not(.material-symbols-outlined)');
    expect(label?.className).toContain('text-[10px]');
    expect(label?.className).toContain('font-medium');
    expect(label?.className).toContain('leading-none');
  });
});
