/**
 * TerminalPanel tests — multi-tab layout.
 * ADR-1 (multi-tab-terminal): panel renders tab bar + TerminalTab per session.
 * TerminalTab is mocked to avoid xterm.js deps.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ── Mock xterm.js CSS ────────────────────────────────────────────────────────
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

// ── Mock TerminalTab ─────────────────────────────────────────────────────────
vi.mock('../../src/components/terminal/TerminalTab', () => ({
  TerminalTab: ({ sessionId, isActive }: { sessionId: string; isActive: boolean }) => (
    <div data-testid={`terminal-tab-${sessionId}`} data-active={String(isActive)} />
  ),
}));

// ── Mock usePanelResize ──────────────────────────────────────────────────────
vi.mock('../../src/hooks/usePanelResize', () => ({
  usePanelResize: () => ({
    width: 420,
    handleMouseDown: vi.fn(),
    minWidth: 280,
    maxWidth: 900,
  }),
}));

// ── Mock api/client (required by stores) ────────────────────────────────────
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
}));

import { useTerminalSessionStore } from '../../src/stores/useTerminalSessionStore';
import { TerminalPanel } from '../../src/components/terminal/TerminalPanel';

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

function makeSession(id: string, label: string, status = 'connecting' as const) {
  return { id, label, status, sendInput: null };
}

function resetStore(overrides: Partial<ReturnType<typeof useTerminalSessionStore.getState>> = {}) {
  useTerminalSessionStore.setState({
    sessions: [makeSession('session-1', 'Terminal 1')],
    activeId: 'session-1',
    panelOpen: true,
    ...overrides,
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

// ---------------------------------------------------------------------------
// Panel visibility
// ---------------------------------------------------------------------------

describe('TerminalPanel — visibility', () => {
  it('hides the aside via "hidden" class when panelOpen is false (BUG-001: no unmount)', () => {
    resetStore({ panelOpen: false });
    const { container } = render(<TerminalPanel />);
    // The aside must still be in the DOM so TerminalTab components stay mounted
    // and PTY WebSocket connections are preserved (F-10 / E-02-S02).
    const aside = container.querySelector('aside');
    expect(aside).toBeInTheDocument();
    expect(aside).toHaveClass('hidden');
  });

  it('TerminalTabs remain mounted when panelOpen is false (BUG-001: PTY preservation)', () => {
    resetStore({
      sessions: [makeSession('s1', 'Terminal 1'), makeSession('s2', 'Terminal 2')],
      activeId: 's1',
      panelOpen: false,
    });
    render(<TerminalPanel />);
    // Both tab mocks must still be in the DOM even when the panel is hidden.
    expect(screen.getByTestId('terminal-tab-s1')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-tab-s2')).toBeInTheDocument();
  });

  it('renders the panel visible when panelOpen is true', () => {
    render(<TerminalPanel />);
    const aside = screen.getByRole('complementary');
    expect(aside).toBeInTheDocument();
    expect(aside).not.toHaveClass('hidden');
  });
});

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

describe('TerminalPanel — header', () => {
  it('renders "Terminal" label in header', () => {
    render(<TerminalPanel />);
    expect(screen.getByText('Terminal')).toBeInTheDocument();
  });

  it('renders the close button with accessible label', () => {
    render(<TerminalPanel />);
    expect(screen.getByRole('button', { name: /close terminal panel/i })).toBeInTheDocument();
  });

  it('close button calls closePanel on the session store', () => {
    const mockClose = vi.fn();
    useTerminalSessionStore.setState({ closePanel: mockClose } as any);
    render(<TerminalPanel />);
    fireEvent.click(screen.getByRole('button', { name: /close terminal panel/i }));
    expect(mockClose).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

describe('TerminalPanel — tab bar', () => {
  it('renders a tablist', () => {
    render(<TerminalPanel />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('renders a tab chip for each session', () => {
    resetStore({
      sessions: [
        makeSession('a', 'Terminal 1'),
        makeSession('b', 'Terminal 2'),
      ],
      activeId: 'a',
      panelOpen: true,
    });
    render(<TerminalPanel />);
    expect(screen.getByText('Terminal 1')).toBeInTheDocument();
    expect(screen.getByText('Terminal 2')).toBeInTheDocument();
  });

  it('renders the add tab button', () => {
    render(<TerminalPanel />);
    expect(screen.getByRole('button', { name: /add terminal tab/i })).toBeInTheDocument();
  });

  it('add tab button is aria-disabled when sessions.length === 4', () => {
    resetStore({
      sessions: [
        makeSession('a', 'Terminal 1'),
        makeSession('b', 'Terminal 2'),
        makeSession('c', 'Terminal 3'),
        makeSession('d', 'Terminal 4'),
      ],
      activeId: 'a',
      panelOpen: true,
    });
    render(<TerminalPanel />);
    expect(screen.getByRole('button', { name: /add terminal tab/i })).toHaveAttribute('aria-disabled', 'true');
  });

  it('clicking a tab chip calls setActiveId', () => {
    const mockSetActiveId = vi.fn();
    resetStore({
      sessions: [
        makeSession('a', 'Terminal 1'),
        makeSession('b', 'Terminal 2'),
      ],
      activeId: 'a',
      panelOpen: true,
    });
    useTerminalSessionStore.setState({ setActiveId: mockSetActiveId } as any);
    render(<TerminalPanel />);
    fireEvent.click(screen.getByText('Terminal 2'));
    expect(mockSetActiveId).toHaveBeenCalledWith('b');
  });

  it('close button on chip calls removeSession', () => {
    const mockRemove = vi.fn();
    resetStore({
      sessions: [
        makeSession('a', 'Terminal 1'),
        makeSession('b', 'Terminal 2'),
      ],
      activeId: 'a',
      panelOpen: true,
    });
    useTerminalSessionStore.setState({ removeSession: mockRemove } as any);
    render(<TerminalPanel />);
    // Close buttons on chips have label "Close <session label>"
    const closeChipButton = screen.getByRole('button', { name: /^close terminal 1$/i });
    fireEvent.click(closeChipButton);
    expect(mockRemove).toHaveBeenCalled();
  });

  it('close button on chip is NOT shown when sessions.length === 1', () => {
    render(<TerminalPanel />); // single session
    // The "Close Terminal 1" chip close button should not exist — only
    // "Close terminal panel" header button is present.
    expect(screen.queryByRole('button', { name: /^close terminal 1$/i })).not.toBeInTheDocument();
  });

  it('clicking add tab button calls addSession', () => {
    const mockAdd = vi.fn();
    useTerminalSessionStore.setState({ addSession: mockAdd } as any);
    render(<TerminalPanel />);
    fireEvent.click(screen.getByRole('button', { name: /add terminal tab/i }));
    expect(mockAdd).toHaveBeenCalled();
  });

  it('disabled "+" button shows correct tooltip text when at cap (BUG-004)', () => {
    resetStore({
      sessions: [
        makeSession('a', 'Terminal 1'),
        makeSession('b', 'Terminal 2'),
        makeSession('c', 'Terminal 3'),
        makeSession('d', 'Terminal 4'),
      ],
      activeId: 'a',
      panelOpen: true,
    });
    render(<TerminalPanel />);
    const addBtn = screen.getByRole('button', { name: /add terminal tab/i });
    expect(addBtn).toHaveAttribute('title', 'Maximum 4 tabs open. Close a tab to open a new one.');
  });

  it('"+" button shows "New terminal tab" tooltip when under cap', () => {
    render(<TerminalPanel />); // single session, under cap
    const addBtn = screen.getByRole('button', { name: /add terminal tab/i });
    expect(addBtn).toHaveAttribute('title', 'New terminal tab');
  });
});

// ---------------------------------------------------------------------------
// TerminalTab mounting
// ---------------------------------------------------------------------------

describe('TerminalPanel — TerminalTab mounting', () => {
  it('renders one TerminalTab per session', () => {
    resetStore({
      sessions: [
        makeSession('a', 'Terminal 1'),
        makeSession('b', 'Terminal 2'),
      ],
      activeId: 'a',
      panelOpen: true,
    });
    render(<TerminalPanel />);
    expect(screen.getByTestId('terminal-tab-a')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-tab-b')).toBeInTheDocument();
  });

  it('only the active tab has isActive=true', () => {
    resetStore({
      sessions: [
        makeSession('a', 'Terminal 1'),
        makeSession('b', 'Terminal 2'),
      ],
      activeId: 'b',
      panelOpen: true,
    });
    render(<TerminalPanel />);
    expect(screen.getByTestId('terminal-tab-a')).toHaveAttribute('data-active', 'false');
    expect(screen.getByTestId('terminal-tab-b')).toHaveAttribute('data-active', 'true');
  });
});

// ---------------------------------------------------------------------------
// Reconnect bar
// ---------------------------------------------------------------------------

describe('TerminalPanel — reconnect bar', () => {
  it('does not show reconnect bar when active session is connected', () => {
    resetStore({
      sessions: [makeSession('a', 'Terminal 1', 'connected')],
      activeId: 'a',
      panelOpen: true,
    });
    render(<TerminalPanel />);
    expect(screen.queryByText(/disconnected/i)).not.toBeInTheDocument();
  });

  it('shows reconnect bar when active session is disconnected', () => {
    resetStore({
      sessions: [makeSession('a', 'Terminal 1', 'disconnected')],
      activeId: 'a',
      panelOpen: true,
    });
    render(<TerminalPanel />);
    expect(screen.getByText(/disconnected/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Inline rename
// ---------------------------------------------------------------------------

describe('TerminalPanel — inline rename', () => {
  it('double-clicking a label enters rename mode', () => {
    render(<TerminalPanel />);
    fireEvent.dblClick(screen.getByText('Terminal 1'));
    expect(screen.getByRole('textbox', { name: /rename session/i })).toBeInTheDocument();
  });

  it('pressing Enter commits the rename', () => {
    const mockRename = vi.fn();
    useTerminalSessionStore.setState({ renameSession: mockRename } as any);
    render(<TerminalPanel />);
    fireEvent.dblClick(screen.getByText('Terminal 1'));
    const input = screen.getByRole('textbox', { name: /rename session/i });
    fireEvent.change(input, { target: { value: 'Shell' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockRename).toHaveBeenCalledWith('session-1', 'Shell');
  });

  it('pressing Escape cancels rename without saving', () => {
    const mockRename = vi.fn();
    useTerminalSessionStore.setState({ renameSession: mockRename } as any);
    render(<TerminalPanel />);
    fireEvent.dblClick(screen.getByText('Terminal 1'));
    const input = screen.getByRole('textbox', { name: /rename session/i });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(mockRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
