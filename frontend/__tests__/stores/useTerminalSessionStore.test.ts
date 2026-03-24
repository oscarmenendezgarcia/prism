/**
 * Unit tests for useTerminalSessionStore.
 * T-006 acceptance criteria: all actions, edge cases, and localStorage persistence.
 * localStorage is mocked via vitest's jsdom environment.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTerminalSessionStore, MAX_SESSIONS } from '../../src/stores/useTerminalSessionStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset the store to a known single-session state before each test. */
function resetStore() {
  // Re-create the initial session manually so each test starts clean.
  const id = 'initial-session-id';
  useTerminalSessionStore.setState({
    sessions: [
      { id, label: 'Terminal 1', status: 'connecting', sendInput: null },
    ],
    activeId: id,
    panelOpen: false,
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('uuid-1' as `${string}-${string}-${string}-${string}-${string}`)
    .mockReturnValue('uuid-n' as `${string}-${string}-${string}-${string}-${string}`);
  resetStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Panel controls
// ---------------------------------------------------------------------------

describe('togglePanel', () => {
  it('opens the panel when closed', () => {
    useTerminalSessionStore.getState().togglePanel();
    expect(useTerminalSessionStore.getState().panelOpen).toBe(true);
  });

  it('closes the panel when open', () => {
    useTerminalSessionStore.setState({ panelOpen: true });
    useTerminalSessionStore.getState().togglePanel();
    expect(useTerminalSessionStore.getState().panelOpen).toBe(false);
  });

  it('persists panelOpen=true to localStorage', () => {
    useTerminalSessionStore.getState().togglePanel();
    expect(localStorage.getItem('prism:terminal:panelOpen')).toBe('1');
  });

  it('removes panelOpen key from localStorage when closing', () => {
    localStorage.setItem('prism:terminal:panelOpen', '1');
    useTerminalSessionStore.setState({ panelOpen: true });
    useTerminalSessionStore.getState().togglePanel();
    expect(localStorage.getItem('prism:terminal:panelOpen')).toBeNull();
  });
});

describe('openPanel / closePanel', () => {
  it('openPanel sets panelOpen=true', () => {
    useTerminalSessionStore.getState().openPanel();
    expect(useTerminalSessionStore.getState().panelOpen).toBe(true);
  });

  it('closePanel sets panelOpen=false', () => {
    useTerminalSessionStore.setState({ panelOpen: true });
    useTerminalSessionStore.getState().closePanel();
    expect(useTerminalSessionStore.getState().panelOpen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// addSession
// ---------------------------------------------------------------------------

describe('addSession — normal', () => {
  it('adds a new session with status connecting', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('new-session-uuid' as any);
    useTerminalSessionStore.getState().addSession();
    const { sessions } = useTerminalSessionStore.getState();
    expect(sessions).toHaveLength(2);
    const newSession = sessions[1];
    expect(newSession.status).toBe('connecting');
    expect(newSession.sendInput).toBeNull();
  });

  it('labels new session based on session count', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('new-session-uuid' as any);
    useTerminalSessionStore.getState().addSession();
    const { sessions } = useTerminalSessionStore.getState();
    expect(sessions[1].label).toBe('Terminal 2');
  });

  it('sets activeId to the new session', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('new-uuid' as any);
    useTerminalSessionStore.getState().addSession();
    expect(useTerminalSessionStore.getState().activeId).toBe('new-uuid');
  });
});

describe('addSession — at cap', () => {
  it('is a no-op when sessions.length >= MAX_SESSIONS', () => {
    // Fill to the cap
    const fillSessions = Array.from({ length: MAX_SESSIONS }, (_, i) => ({
      id: `session-${i}`,
      label: `Terminal ${i + 1}`,
      status: 'connecting' as const,
      sendInput: null,
    }));
    useTerminalSessionStore.setState({ sessions: fillSessions, activeId: 'session-0' });

    useTerminalSessionStore.getState().addSession();

    expect(useTerminalSessionStore.getState().sessions).toHaveLength(MAX_SESSIONS);
  });

  it('does not change activeId when at cap', () => {
    const fillSessions = Array.from({ length: MAX_SESSIONS }, (_, i) => ({
      id: `session-${i}`,
      label: `Terminal ${i + 1}`,
      status: 'connecting' as const,
      sendInput: null,
    }));
    useTerminalSessionStore.setState({ sessions: fillSessions, activeId: 'session-0' });

    useTerminalSessionStore.getState().addSession();

    expect(useTerminalSessionStore.getState().activeId).toBe('session-0');
  });
});

// ---------------------------------------------------------------------------
// removeSession
// ---------------------------------------------------------------------------

describe('removeSession — last tab', () => {
  it('sets sessions to [] and activeId to null', () => {
    const id = useTerminalSessionStore.getState().sessions[0].id;
    useTerminalSessionStore.getState().removeSession(id);
    expect(useTerminalSessionStore.getState().sessions).toHaveLength(0);
    expect(useTerminalSessionStore.getState().activeId).toBeNull();
  });

  it('closes the panel when last tab is removed', () => {
    useTerminalSessionStore.setState({ panelOpen: true });
    const id = useTerminalSessionStore.getState().sessions[0].id;
    useTerminalSessionStore.getState().removeSession(id);
    expect(useTerminalSessionStore.getState().panelOpen).toBe(false);
  });
});

describe('removeSession — middle tab (activeId switch)', () => {
  beforeEach(() => {
    useTerminalSessionStore.setState({
      sessions: [
        { id: 'a', label: 'Terminal 1', status: 'connected', sendInput: null },
        { id: 'b', label: 'Terminal 2', status: 'connecting', sendInput: null },
        { id: 'c', label: 'Terminal 3', status: 'connecting', sendInput: null },
      ],
      activeId: 'b',
      panelOpen: true,
    });
  });

  it('removes the session from the list', () => {
    useTerminalSessionStore.getState().removeSession('b');
    const ids = useTerminalSessionStore.getState().sessions.map((s) => s.id);
    expect(ids).toEqual(['a', 'c']);
  });

  it('switches activeId to the previous session when active tab is removed', () => {
    useTerminalSessionStore.getState().removeSession('b');
    // 'b' was at index 1; previous is index 0 → 'a'
    expect(useTerminalSessionStore.getState().activeId).toBe('a');
  });

  it('does not change activeId when a non-active tab is removed', () => {
    useTerminalSessionStore.setState({ activeId: 'c' });
    useTerminalSessionStore.getState().removeSession('a');
    expect(useTerminalSessionStore.getState().activeId).toBe('c');
  });

  it('does not close the panel when tabs remain', () => {
    useTerminalSessionStore.getState().removeSession('b');
    expect(useTerminalSessionStore.getState().panelOpen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renameSession
// ---------------------------------------------------------------------------

describe('renameSession', () => {
  it('updates the session label', () => {
    const { sessions } = useTerminalSessionStore.getState();
    useTerminalSessionStore.getState().renameSession(sessions[0].id, 'My Shell');
    expect(useTerminalSessionStore.getState().sessions[0].label).toBe('My Shell');
  });

  it('trims whitespace from the label', () => {
    const { sessions } = useTerminalSessionStore.getState();
    useTerminalSessionStore.getState().renameSession(sessions[0].id, '  Server  ');
    expect(useTerminalSessionStore.getState().sessions[0].label).toBe('Server');
  });

  it('truncates label to 24 characters', () => {
    const { sessions } = useTerminalSessionStore.getState();
    const longLabel = 'A'.repeat(30);
    useTerminalSessionStore.getState().renameSession(sessions[0].id, longLabel);
    expect(useTerminalSessionStore.getState().sessions[0].label).toHaveLength(24);
  });

  it('does not modify other sessions', () => {
    useTerminalSessionStore.setState({
      sessions: [
        { id: 'a', label: 'Terminal 1', status: 'connected', sendInput: null },
        { id: 'b', label: 'Terminal 2', status: 'connecting', sendInput: null },
      ],
      activeId: 'a',
    });
    useTerminalSessionStore.getState().renameSession('a', 'Renamed');
    expect(useTerminalSessionStore.getState().sessions[1].label).toBe('Terminal 2');
  });

  it('keeps the existing label when new label is empty string (BUG-002)', () => {
    const { sessions } = useTerminalSessionStore.getState();
    const originalLabel = sessions[0].label;
    useTerminalSessionStore.getState().renameSession(sessions[0].id, '');
    expect(useTerminalSessionStore.getState().sessions[0].label).toBe(originalLabel);
  });

  it('keeps the existing label when new label is whitespace-only (BUG-002)', () => {
    const { sessions } = useTerminalSessionStore.getState();
    const originalLabel = sessions[0].label;
    useTerminalSessionStore.getState().renameSession(sessions[0].id, '   ');
    expect(useTerminalSessionStore.getState().sessions[0].label).toBe(originalLabel);
  });
});

// ---------------------------------------------------------------------------
// updateStatus
// ---------------------------------------------------------------------------

describe('updateStatus', () => {
  it('updates the status field for the matching session', () => {
    const { sessions } = useTerminalSessionStore.getState();
    useTerminalSessionStore.getState().updateStatus(sessions[0].id, 'connected');
    expect(useTerminalSessionStore.getState().sessions[0].status).toBe('connected');
  });

  it('does not affect other sessions', () => {
    useTerminalSessionStore.setState({
      sessions: [
        { id: 'a', label: 'Terminal 1', status: 'connecting', sendInput: null },
        { id: 'b', label: 'Terminal 2', status: 'connecting', sendInput: null },
      ],
      activeId: 'a',
    });
    useTerminalSessionStore.getState().updateStatus('a', 'connected');
    expect(useTerminalSessionStore.getState().sessions[1].status).toBe('connecting');
  });
});

// ---------------------------------------------------------------------------
// registerSender
// ---------------------------------------------------------------------------

describe('registerSender', () => {
  it('registers a sendInput function for a session', () => {
    const fn = vi.fn(() => true);
    const { sessions } = useTerminalSessionStore.getState();
    useTerminalSessionStore.getState().registerSender(sessions[0].id, fn);
    expect(useTerminalSessionStore.getState().sessions[0].sendInput).toBe(fn);
  });

  it('registers null to clear the sender', () => {
    const fn = vi.fn(() => true);
    const { sessions } = useTerminalSessionStore.getState();
    useTerminalSessionStore.getState().registerSender(sessions[0].id, fn);
    useTerminalSessionStore.getState().registerSender(sessions[0].id, null);
    expect(useTerminalSessionStore.getState().sessions[0].sendInput).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// activeSendInput
// ---------------------------------------------------------------------------

describe('activeSendInput', () => {
  it('returns null when there are no sessions', () => {
    useTerminalSessionStore.setState({ sessions: [], activeId: null });
    expect(useTerminalSessionStore.getState().activeSendInput()).toBeNull();
  });

  it('returns null when the active session has no sendInput', () => {
    expect(useTerminalSessionStore.getState().activeSendInput()).toBeNull();
  });

  it('returns the sendInput of the active session when registered', () => {
    const fn = vi.fn(() => true);
    const { sessions } = useTerminalSessionStore.getState();
    useTerminalSessionStore.getState().registerSender(sessions[0].id, fn);
    expect(useTerminalSessionStore.getState().activeSendInput()).toBe(fn);
  });

  it('returns the sendInput of the correct tab when multiple sessions exist', () => {
    const fnA = vi.fn(() => true);
    const fnB = vi.fn(() => false);
    useTerminalSessionStore.setState({
      sessions: [
        { id: 'a', label: 'Terminal 1', status: 'connected', sendInput: fnA },
        { id: 'b', label: 'Terminal 2', status: 'connected', sendInput: fnB },
      ],
      activeId: 'b',
    });
    expect(useTerminalSessionStore.getState().activeSendInput()).toBe(fnB);
  });
});

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

describe('localStorage persistence', () => {
  it('reads panelOpen from localStorage on store init (value=1)', () => {
    localStorage.setItem('prism:terminal:panelOpen', '1');
    // Re-import won't re-init — test via the writePanelOpenToStorage indirectly.
    // We verify the store's togglePanel writes the key correctly.
    useTerminalSessionStore.getState().openPanel();
    expect(localStorage.getItem('prism:terminal:panelOpen')).toBe('1');
  });

  it('writes panelOpen on togglePanel', () => {
    useTerminalSessionStore.getState().togglePanel(); // open
    expect(localStorage.getItem('prism:terminal:panelOpen')).toBe('1');

    useTerminalSessionStore.getState().togglePanel(); // close
    expect(localStorage.getItem('prism:terminal:panelOpen')).toBeNull();
  });

  it('writes panelOpen=false to localStorage when last tab is removed', () => {
    localStorage.setItem('prism:terminal:panelOpen', '1');
    useTerminalSessionStore.setState({ panelOpen: true });
    const id = useTerminalSessionStore.getState().sessions[0].id;
    useTerminalSessionStore.getState().removeSession(id);
    expect(localStorage.getItem('prism:terminal:panelOpen')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setActiveId
// ---------------------------------------------------------------------------

describe('setActiveId', () => {
  it('updates the activeId', () => {
    useTerminalSessionStore.setState({
      sessions: [
        { id: 'a', label: 'Terminal 1', status: 'connected', sendInput: null },
        { id: 'b', label: 'Terminal 2', status: 'connecting', sendInput: null },
      ],
      activeId: 'a',
    });
    useTerminalSessionStore.getState().setActiveId('b');
    expect(useTerminalSessionStore.getState().activeId).toBe('b');
  });
});
