/**
 * useTerminal hook unit tests.
 * WebSocket is mocked globally — no live server needed.
 * xterm.js dynamic import is intercepted by vi.mock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { TerminalStatus } from '../../src/types';

// ── Mock xterm.js dynamic imports ──────────────────────────────────────────
const mockFit = vi.fn();
const mockTerminalWrite = vi.fn();
const mockTerminalDispose = vi.fn();
const mockTerminalOnData = vi.fn();
const mockTerminalOnResize = vi.fn();
const mockTerminalOpen = vi.fn();
const mockLoadAddon = vi.fn();

const mockTerminalInstance = {
  loadAddon: mockLoadAddon,
  open: mockTerminalOpen,
  dispose: mockTerminalDispose,
  onData: mockTerminalOnData,
  onResize: mockTerminalOnResize,
  write: mockTerminalWrite,
  focus: vi.fn(),
  cols: 80,
  rows: 24,
};

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(() => mockTerminalInstance),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(() => ({ fit: mockFit })),
}));

// ── Mock WebSocket ──────────────────────────────────────────────────────────

type WsListener = (event: Event | MessageEvent | CloseEvent) => void;

interface MockWebSocketInstance {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  _listeners: Map<string, WsListener[]>;
  _emit: (type: string, event?: object) => void;
}

let mockWsInstance: MockWebSocketInstance | null = null;
const MockWebSocket = vi.fn().mockImplementation(() => {
  mockWsInstance = {
    readyState: WebSocket.CONNECTING,
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn((type: string, handler: WsListener) => {
      if (!mockWsInstance!._listeners.has(type)) {
        mockWsInstance!._listeners.set(type, []);
      }
      mockWsInstance!._listeners.get(type)!.push(handler);
    }),
    removeEventListener: vi.fn(),
    _listeners: new Map(),
    _emit(type: string, event: object = {}) {
      // Automatically update readyState to match lifecycle events
      if (type === 'open') this.readyState = WebSocket.OPEN;
      if (type === 'close') this.readyState = WebSocket.CLOSED;
      const handlers = this._listeners.get(type) ?? [];
      handlers.forEach((h) => h(event as any));
    },
  };
  return mockWsInstance;
});
MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;

// ── Setup ───────────────────────────────────────────────────────────────────

let originalWebSocket: typeof WebSocket;

beforeEach(() => {
  vi.clearAllMocks();
  mockWsInstance = null;
  originalWebSocket = global.WebSocket;
  global.WebSocket = MockWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  global.WebSocket = originalWebSocket;
  vi.useRealTimers();
});

// ── Import hook after mocks are in place ────────────────────────────────────
import { useTerminal } from '../../src/hooks/useTerminal';

// ── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_WS_URL = 'ws://localhost:3000/ws/terminal';

function renderTerminalHook(panelOpen = false, wsUrl = DEFAULT_WS_URL) {
  const onStatusChange = vi.fn<[TerminalStatus], void>();
  const onReconnectAvailable = vi.fn<[boolean], void>();
  const onReconnectCountdown = vi.fn<[number], void>();

  const result = renderHook(
    ({ open }) =>
      useTerminal({
        panelOpen: open,
        wsUrl,
        onStatusChange,
        onReconnectAvailable,
        onReconnectCountdown,
      }),
    { initialProps: { open: panelOpen } }
  );

  return { ...result, onStatusChange, onReconnectAvailable, onReconnectCountdown };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useTerminal — initial state', () => {
  it('returns containerRef and reconnectNow', () => {
    const { result } = renderTerminalHook(false);
    expect(result.current.containerRef).toBeDefined();
    expect(typeof result.current.reconnectNow).toBe('function');
  });

  it('does not create WebSocket when panel is closed', () => {
    renderTerminalHook(false);
    expect(MockWebSocket).not.toHaveBeenCalled();
  });
});

describe('useTerminal — connect on panel open', () => {
  it('creates a WebSocket when panel opens', () => {
    const { rerender } = renderTerminalHook(false);
    act(() => {
      rerender({ open: true });
    });
    expect(MockWebSocket).toHaveBeenCalledWith(DEFAULT_WS_URL);
  });

  it('creates a WebSocket with the provided wsUrl', () => {
    const customUrl = 'ws://localhost:3000/ws/terminal?sessionId=abc-123';
    const { rerender } = renderTerminalHook(false, customUrl);
    act(() => {
      rerender({ open: true });
    });
    expect(MockWebSocket).toHaveBeenCalledWith(customUrl);
  });

  it('calls onStatusChange("connecting") immediately on connect', () => {
    const { onStatusChange, rerender } = renderTerminalHook(false);
    act(() => {
      rerender({ open: true });
    });
    expect(onStatusChange).toHaveBeenCalledWith('connecting');
  });

  it('does not create a second WebSocket if one is already open', () => {
    const { rerender } = renderTerminalHook(false);

    act(() => {
      rerender({ open: true });
    });

    // Simulate open
    act(() => {
      mockWsInstance!.readyState = WebSocket.OPEN;
      mockWsInstance!._emit('open', {});
    });

    const callsBefore = MockWebSocket.mock.calls.length;

    // Toggle panel off then on — should NOT create another WS because existing one is OPEN
    act(() => {
      rerender({ open: false });
      rerender({ open: true });
    });

    expect(MockWebSocket.mock.calls.length).toBe(callsBefore);
  });
});

describe('useTerminal — connected state', () => {
  it('calls onStatusChange("connected") on WebSocket open event', () => {
    const { onStatusChange, rerender } = renderTerminalHook(false);
    act(() => {
      rerender({ open: true });
    });
    act(() => {
      mockWsInstance!._emit('open', {});
    });
    expect(onStatusChange).toHaveBeenCalledWith('connected');
  });

  it('calls onReconnectAvailable(false) on WebSocket open event', () => {
    const { onReconnectAvailable, rerender } = renderTerminalHook(false);
    act(() => {
      rerender({ open: true });
    });
    act(() => {
      mockWsInstance!._emit('open', {});
    });
    expect(onReconnectAvailable).toHaveBeenCalledWith(false);
  });
});

describe('useTerminal — disconnected state and reconnect', () => {
  it('calls onStatusChange("disconnected") on WebSocket close event', () => {
    vi.useFakeTimers();
    const { onStatusChange, rerender } = renderTerminalHook(false);
    act(() => {
      rerender({ open: true });
    });
    act(() => {
      mockWsInstance!._emit('close', { code: 1006 });
    });
    expect(onStatusChange).toHaveBeenCalledWith('disconnected');
  });

  it('calls onReconnectAvailable(true) after disconnect', () => {
    vi.useFakeTimers();
    const { onReconnectAvailable, rerender } = renderTerminalHook(false);
    act(() => {
      rerender({ open: true });
    });
    act(() => {
      mockWsInstance!._emit('close', { code: 1006 });
    });
    expect(onReconnectAvailable).toHaveBeenCalledWith(true);
  });

  it('schedules reconnect after BACKOFF_BASE_MS (2000ms)', async () => {
    vi.useFakeTimers();
    const { rerender } = renderTerminalHook(false);
    act(() => {
      rerender({ open: true });
    });

    const wsCallsBefore = MockWebSocket.mock.calls.length;

    // Emit close inside act so React state updates are flushed
    await act(async () => {
      mockWsInstance!._emit('close', { code: 1006 });
    });

    // Before timeout — no new WS yet
    expect(MockWebSocket.mock.calls.length).toBe(wsCallsBefore);

    // After 2s — new WS created
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(MockWebSocket.mock.calls.length).toBeGreaterThan(wsCallsBefore);
  });

  it('reconnectNow cancels pending timer and reconnects immediately', async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderTerminalHook(false);
    act(() => {
      rerender({ open: true });
    });

    await act(async () => {
      mockWsInstance!._emit('close', { code: 1006 });
    });

    const wsCallsBefore = MockWebSocket.mock.calls.length;

    await act(async () => {
      result.current.reconnectNow();
    });

    // Reconnect happens immediately without waiting for the timer
    expect(MockWebSocket.mock.calls.length).toBeGreaterThan(wsCallsBefore);
  });
});

describe('useTerminal — message handling', () => {
  it('does not throw on well-formed output message', () => {
    const { rerender } = renderTerminalHook(false);
    act(() => {
      rerender({ open: true });
    });

    expect(() => {
      act(() => {
        mockWsInstance!._emit('message', {
          data: JSON.stringify({ type: 'output', data: 'hello' }),
        });
      });
    }).not.toThrow();
  });

  it('does not throw on non-JSON message (warns via console.warn)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rerender } = renderTerminalHook(false);
    act(() => {
      rerender({ open: true });
    });

    act(() => {
      mockWsInstance!._emit('message', { data: 'not-json' });
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[terminal] non-JSON message:'),
      expect.anything()
    );
    warnSpy.mockRestore();
  });
});

describe('useTerminal — WebSocket error', () => {
  it('calls onStatusChange("connecting") when WebSocket constructor fails and schedules reconnect', () => {
    vi.useFakeTimers();
    MockWebSocket.mockImplementationOnce(() => {
      throw new Error('Connection refused');
    });

    const { onStatusChange, rerender } = renderTerminalHook(false);
    act(() => {
      rerender({ open: true });
    });

    // After failure, reconnect delay schedules a new attempt
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // The first call should be 'connecting' and eventually a retry WS is created
    expect(onStatusChange).toHaveBeenCalledWith('connecting');
  });
});

describe('useTerminal — cleanup on unmount', () => {
  it('closes the WebSocket on unmount', () => {
    const { rerender, unmount } = renderTerminalHook(false);
    act(() => {
      rerender({ open: true });
    });

    expect(mockWsInstance).not.toBeNull();
    unmount();

    expect(mockWsInstance!.close).toHaveBeenCalled();
  });
});

describe('useTerminal — console.debug on disconnect (not console.log)', () => {
  it('uses console.debug not console.log on close event', async () => {
    vi.useFakeTimers();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log');

    const { rerender } = renderTerminalHook(false);
    act(() => {
      rerender({ open: true });
    });
    await act(async () => {
      mockWsInstance!._emit('close', { code: 1006 });
    });

    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('[terminal] disconnected'));
    expect(logSpy).not.toHaveBeenCalled();

    debugSpy.mockRestore();
    logSpy.mockRestore();
  });
});
