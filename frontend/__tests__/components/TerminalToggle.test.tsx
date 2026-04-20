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

  it('has w-9 h-9 icon-only size classes (Trend A redesign)', () => {
    render(<TerminalToggle />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('w-9');
    expect(btn.className).toContain('h-9');
  });

  it('has items-center justify-center layout (Trend A redesign)', () => {
    render(<TerminalToggle />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('items-center');
    expect(btn.className).toContain('justify-center');
  });

  it('uses rounded-lg (Trend A wireframe spec)', () => {
    render(<TerminalToggle />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('rounded-lg');
    expect(btn.className).not.toContain('rounded-xl');
  });

  it('renders icon-only — no text label (Trend A redesign)', () => {
    render(<TerminalToggle />);
    const btn = screen.getByRole('button');
    const icon = btn.querySelector('.material-symbols-outlined');
    expect(icon).toBeInTheDocument();
    expect(btn.querySelector('span:not(.material-symbols-outlined)')).toBeNull();
  });
});
