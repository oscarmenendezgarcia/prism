/**
 * Unit tests for TerminalTab component.
 * T-007: Mock useTerminal and useTerminalSessionStore to test the wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import type { TerminalStatus } from '../../src/types';

// ── Mock xterm.js CSS ────────────────────────────────────────────────────────
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

// ── Mock useTheme ─────────────────────────────────────────────────────────────
let mockResolvedTheme: 'light' | 'dark' = 'dark';

vi.mock('../../src/hooks/useTheme', () => ({
  useTheme: vi.fn(() => ({ resolvedTheme: mockResolvedTheme, theme: mockResolvedTheme, setTheme: vi.fn() })),
}));

// ── Mock useTerminal ─────────────────────────────────────────────────────────

const mockSendInput = vi.fn(() => true);
const mockReconnectNow = vi.fn();
const mockContainerRef = { current: null };

let capturedOptions: Record<string, unknown> = {};

vi.mock('../../src/hooks/useTerminal', () => ({
  useTerminal: vi.fn((options: Record<string, unknown>) => {
    capturedOptions = options;
    return {
      containerRef: mockContainerRef,
      reconnectNow: mockReconnectNow,
      sendInput: mockSendInput,
    };
  }),
}));

// ── Mock useTerminalSessionStore ─────────────────────────────────────────────

const mockUpdateStatus = vi.fn();
const mockRegisterSender = vi.fn();

vi.mock('../../src/stores/useTerminalSessionStore', () => ({
  useTerminalSessionStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      updateStatus: mockUpdateStatus,
      registerSender: mockRegisterSender,
    };
    return selector ? selector(state) : state;
  }),
}));

// Make getState() work too
import { useTerminalSessionStore } from '../../src/stores/useTerminalSessionStore';
vi.mocked(useTerminalSessionStore).getState = vi.fn(() => ({
  updateStatus: mockUpdateStatus,
  registerSender: mockRegisterSender,
  sessions: [],
  activeId: null,
  panelOpen: false,
  openPanel: vi.fn(),
  closePanel: vi.fn(),
  togglePanel: vi.fn(),
  addSession: vi.fn(),
  removeSession: vi.fn(),
  setActiveId: vi.fn(),
  renameSession: vi.fn(),
  activeSendInput: vi.fn(() => null),
}));

// ── Mock useAppStore ─────────────────────────────────────────────────────────

const mockClearActiveRun = vi.fn();

vi.mock('../../src/stores/useAppStore', () => ({
  useAppStore: vi.fn(),
}));

import { useAppStore } from '../../src/stores/useAppStore';
vi.mocked(useAppStore).getState = vi.fn(() => ({
  clearActiveRun: mockClearActiveRun,
}) as any);

// ── Import component after mocks ─────────────────────────────────────────────

import { useTerminal } from '../../src/hooks/useTerminal';
import { TerminalTab } from '../../src/components/terminal/TerminalTab';

const mockUseTerminal = vi.mocked(useTerminal);

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderTab(props: {
  sessionId?: string;
  panelOpen?: boolean;
  isActive?: boolean;
}) {
  return render(
    <TerminalTab
      sessionId={props.sessionId ?? 'session-abc'}
      panelOpen={props.panelOpen ?? false}
      isActive={props.isActive ?? true}
    />,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  capturedOptions = {};
  mockResolvedTheme = 'dark';
});

describe('TerminalTab — rendering', () => {
  it('renders a div container', () => {
    const { container } = renderTab({});
    expect(container.querySelector('div')).toBeInTheDocument();
  });

  it('has className="hidden" when isActive=false', () => {
    const { container } = renderTab({ isActive: false });
    const div = container.querySelector('div');
    expect(div?.className).toBe('hidden');
  });

  it('has flex-1 overflow-hidden p-2 min-h-0 classes when isActive=true', () => {
    const { container } = renderTab({ isActive: true });
    const div = container.querySelector('div');
    expect(div?.className).toContain('flex-1');
    expect(div?.className).toContain('overflow-hidden');
    expect(div?.className).toContain('p-2');
    expect(div?.className).toContain('min-h-0');
  });
});

describe('TerminalTab — useTerminal wiring', () => {
  it('calls useTerminal with wsUrl matching /ws/terminal?sessionId=<id>', () => {
    renderTab({ sessionId: 'my-session-123' });
    expect(mockUseTerminal).toHaveBeenCalled();
    const options = mockUseTerminal.mock.calls[0][0];
    expect(options.wsUrl).toContain('/ws/terminal?sessionId=my-session-123');
  });

  it('passes panelOpen to useTerminal', () => {
    renderTab({ panelOpen: true });
    const options = mockUseTerminal.mock.calls[0][0];
    expect(options.panelOpen).toBe(true);
  });

  it('passes resolvedTheme="dark" to useTerminal when theme is dark', () => {
    mockResolvedTheme = 'dark';
    renderTab({});
    const options = mockUseTerminal.mock.calls[0][0];
    expect(options.resolvedTheme).toBe('dark');
  });

  it('passes resolvedTheme="light" to useTerminal when theme is light', () => {
    mockResolvedTheme = 'light';
    renderTab({});
    const options = mockUseTerminal.mock.calls[0][0];
    expect(options.resolvedTheme).toBe('light');
  });
});

describe('TerminalTab — onStatusChange callback', () => {
  it('calls updateStatus and registerSender(sendInput) when status is connected', () => {
    renderTab({ sessionId: 'session-abc' });

    // Trigger the onStatusChange callback captured from useTerminal
    act(() => {
      const opts = mockUseTerminal.mock.calls[0][0];
      (opts.onStatusChange as (s: TerminalStatus) => void)('connected');
    });

    expect(mockUpdateStatus).toHaveBeenCalledWith('session-abc', 'connected');
    expect(mockRegisterSender).toHaveBeenCalledWith('session-abc', expect.any(Function));
  });

  it('calls updateStatus and registerSender(null) when status is disconnected', () => {
    renderTab({ sessionId: 'session-abc' });

    act(() => {
      const opts = mockUseTerminal.mock.calls[0][0];
      (opts.onStatusChange as (s: TerminalStatus) => void)('disconnected');
    });

    expect(mockUpdateStatus).toHaveBeenCalledWith('session-abc', 'disconnected');
    expect(mockRegisterSender).toHaveBeenCalledWith('session-abc', null);
  });

  it('calls updateStatus and registerSender(null) when status is connecting', () => {
    renderTab({ sessionId: 'session-abc' });

    act(() => {
      const opts = mockUseTerminal.mock.calls[0][0];
      (opts.onStatusChange as (s: TerminalStatus) => void)('connecting');
    });

    expect(mockUpdateStatus).toHaveBeenCalledWith('session-abc', 'connecting');
    expect(mockRegisterSender).toHaveBeenCalledWith('session-abc', null);
  });
});

describe('TerminalTab — onProcessExit callback', () => {
  it('calls useAppStore.getState().clearActiveRun() on process exit', () => {
    renderTab({});

    act(() => {
      const opts = mockUseTerminal.mock.calls[0][0];
      (opts.onProcessExit as (code: number | null) => void)(0);
    });

    expect(mockClearActiveRun).toHaveBeenCalled();
  });
});
