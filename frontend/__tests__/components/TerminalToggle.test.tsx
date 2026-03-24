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
});
