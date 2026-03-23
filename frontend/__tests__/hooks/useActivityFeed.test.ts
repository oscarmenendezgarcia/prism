/**
 * useActivityFeed hook unit tests.
 * ADR-1 (Activity Feed) — T-018 acceptance criteria.
 *
 * WebSocket is mocked globally via vi.stubGlobal — no live server needed.
 * Tests verify: connect on mount, reconnect with exponential backoff,
 * event parsing + store dispatch, ping scheduling, and cleanup on unmount.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mock api/client (required by store) ──────────────────────────────────────
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
  getAgents: vi.fn(),
  getAgent: vi.fn(),
  generatePrompt: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  getActivity: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
  getGlobalActivity: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
}));

import { useAppStore } from '../../src/stores/useAppStore';
import { useActivityFeed } from '../../src/hooks/useActivityFeed';
import type { ActivityEvent } from '../../src/types';

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

interface MockWsInstance {
  readyState: number;
  onopen:     ((e: Event) => void) | null;
  onmessage:  ((e: MessageEvent) => void) | null;
  onerror:    ((e: Event) => void) | null;
  onclose:    ((e: CloseEvent) => void) | null;
  send:       ReturnType<typeof vi.fn>;
  close:      ReturnType<typeof vi.fn>;
  // test helpers
  _open():    void;
  _message(data: string): void;
  _close():   void;
}

let latestWs: MockWsInstance | null = null;
const allWsInstances: MockWsInstance[] = [];

function createMockWs(): MockWsInstance {
  const ws: MockWsInstance = {
    readyState: 0, // CONNECTING
    onopen:     null,
    onmessage:  null,
    onerror:    null,
    onclose:    null,
    send:       vi.fn(),
    close:      vi.fn(),
    _open()    { this.readyState = 1; this.onopen?.({} as Event); },
    _message(data: string) { this.onmessage?.({ data } as MessageEvent); },
    _close()   { this.readyState = 3; this.onclose?.({} as CloseEvent); },
  };
  return ws;
}

const MockWebSocket = vi.fn().mockImplementation(() => {
  const ws = createMockWs();
  latestWs = ws;
  allWsInstances.push(ws);
  return ws;
});
MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN       = 1;
MockWebSocket.CLOSING    = 2;
MockWebSocket.CLOSED     = 3;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  allWsInstances.length = 0;
  latestWs = null;
  vi.stubGlobal('WebSocket', MockWebSocket);
  useAppStore.setState({ activityEvents: [], activityUnreadCount: 0, activityPanelOpen: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useActivityFeed — initial connection', () => {
  it('creates a WebSocket on mount', () => {
    renderHook(() => useActivityFeed());
    expect(MockWebSocket).toHaveBeenCalledOnce();
    expect(MockWebSocket).toHaveBeenCalledWith(expect.stringContaining('/ws/activity'));
  });

  it('returns status "connecting" before WebSocket opens', () => {
    const { result } = renderHook(() => useActivityFeed());
    expect(result.current.status).toBe('connecting');
  });

  it('returns status "connected" when WebSocket opens', () => {
    const { result } = renderHook(() => useActivityFeed());
    act(() => { latestWs!._open(); });
    expect(result.current.status).toBe('connected');
  });

  it('returns status "disconnected" when WebSocket closes', () => {
    const { result } = renderHook(() => useActivityFeed());
    act(() => { latestWs!._open(); });
    act(() => { latestWs!._close(); });
    expect(result.current.status).toBe('disconnected');
  });
});

describe('useActivityFeed — event parsing', () => {
  it('calls addActivityEvent when an activity message is received', () => {
    const mockAdd = vi.fn();
    useAppStore.setState({ addActivityEvent: mockAdd } as any);

    renderHook(() => useActivityFeed());
    act(() => { latestWs!._open(); });

    const event: ActivityEvent = {
      id: 'e1', type: 'task.created', spaceId: 's1',
      timestamp: new Date().toISOString(), actor: 'system',
      payload: { taskId: 't1', taskTitle: 'New task' },
    };

    act(() => {
      latestWs!._message(JSON.stringify({ type: 'activity', event }));
    });

    expect(mockAdd).toHaveBeenCalledWith(event);
  });

  it('ignores "connected" server frames (no store call)', () => {
    const mockAdd = vi.fn();
    useAppStore.setState({ addActivityEvent: mockAdd } as any);

    renderHook(() => useActivityFeed());
    act(() => { latestWs!._open(); });
    act(() => { latestWs!._message(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })); });

    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('ignores "pong" frames (no store call)', () => {
    const mockAdd = vi.fn();
    useAppStore.setState({ addActivityEvent: mockAdd } as any);

    renderHook(() => useActivityFeed());
    act(() => { latestWs!._open(); });
    act(() => { latestWs!._message(JSON.stringify({ type: 'pong' })); });

    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('silently ignores malformed JSON frames', () => {
    const mockAdd = vi.fn();
    useAppStore.setState({ addActivityEvent: mockAdd } as any);

    renderHook(() => useActivityFeed());
    act(() => { latestWs!._open(); });
    expect(() => {
      act(() => { latestWs!._message('not json {{{{'); });
    }).not.toThrow();
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

describe('useActivityFeed — reconnect with exponential backoff', () => {
  it('reconnects after 1s on first disconnect', () => {
    renderHook(() => useActivityFeed());
    act(() => { latestWs!._open(); });
    act(() => { latestWs!._close(); });

    expect(MockWebSocket).toHaveBeenCalledTimes(1);

    // Advance past the initial 1s backoff
    act(() => { vi.advanceTimersByTime(1100); });
    expect(MockWebSocket).toHaveBeenCalledTimes(2);
  });

  it('doubles the backoff delay on each successive disconnect', () => {
    renderHook(() => useActivityFeed());

    // First connect
    act(() => { latestWs!._open(); });
    act(() => { latestWs!._close(); }); // backoff=1s

    // Trigger first reconnect
    act(() => { vi.advanceTimersByTime(1100); });
    expect(MockWebSocket).toHaveBeenCalledTimes(2);

    // Second disconnect — backoff should now be 2s
    act(() => { latestWs!._close(); });
    act(() => { vi.advanceTimersByTime(1000); });
    // Should NOT have reconnected yet (need 2s)
    expect(MockWebSocket).toHaveBeenCalledTimes(2);

    act(() => { vi.advanceTimersByTime(1100); });
    expect(MockWebSocket).toHaveBeenCalledTimes(3);
  });

  it('resets backoff to 1s after a successful connection', () => {
    renderHook(() => useActivityFeed());

    // First connect + disconnect + reconnect (backoff = 2s now)
    act(() => { latestWs!._open(); });
    act(() => { latestWs!._close(); });
    act(() => { vi.advanceTimersByTime(1100); });

    // Second WS opens successfully → backoff resets to 1s
    act(() => { latestWs!._open(); });
    act(() => { latestWs!._close(); }); // backoff should be 1s again

    act(() => { vi.advanceTimersByTime(1100); });
    expect(MockWebSocket).toHaveBeenCalledTimes(3);
  });
});

describe('useActivityFeed — ping keep-alive', () => {
  it('sends a ping every 30 seconds when connected', () => {
    renderHook(() => useActivityFeed());
    act(() => { latestWs!._open(); });

    act(() => { vi.advanceTimersByTime(30_000); });
    expect(latestWs!.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }));
  });

  it('does not send ping when disconnected', () => {
    renderHook(() => useActivityFeed());
    act(() => { latestWs!._open(); });
    act(() => { latestWs!._close(); });

    act(() => { vi.advanceTimersByTime(30_000); });
    // send should NOT have been called after close
    expect(latestWs!.send).not.toHaveBeenCalled();
  });
});

describe('useActivityFeed — cleanup on unmount', () => {
  it('closes the WebSocket on unmount (nulls onclose to prevent reconnect)', () => {
    const { unmount } = renderHook(() => useActivityFeed());
    act(() => { latestWs!._open(); });

    unmount();

    expect(latestWs!.close).toHaveBeenCalledOnce();
    // onclose should have been nulled before close so no reconnect fires
    expect(latestWs!.onclose).toBeNull();
  });

  it('does not create a new WebSocket after unmount + timer fires', () => {
    const { unmount } = renderHook(() => useActivityFeed());
    act(() => { latestWs!._open(); });
    unmount();

    act(() => { vi.advanceTimersByTime(60_000); });
    // Only 1 WebSocket total — no reconnect after unmount
    expect(MockWebSocket).toHaveBeenCalledTimes(1);
  });
});
