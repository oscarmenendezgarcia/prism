/**
 * Zustand store for multi-tab PTY terminal sessions.
 * ADR-1 (multi-tab-terminal): dedicated slice keeps useAppStore from growing.
 *
 * Each session maps 1-to-1 with a WebSocket connection and a PTY process.
 * The store manages the ordered session list, which tab is active, and
 * panel open/close state (persisted in localStorage).
 */

import { create } from 'zustand';
import type { TerminalStatus } from '@/types';

/** Maximum concurrent PTY sessions (server MAX_CONNECTIONS = 5, we cap at 4). */
export const MAX_SESSIONS = 4;

const STORAGE_KEY = 'prism:terminal:panelOpen';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TerminalSession {
  /** UUID used as ?sessionId= query parameter in the WebSocket URL. */
  id: string;
  /** Display name shown in the tab chip. Max 24 chars after trim. */
  label: string;
  /** Current connection status for this session. */
  status: TerminalStatus;
  /** Bridge injected by useTerminal — null when not connected. */
  sendInput: ((data: string) => boolean) | null;
}

interface TerminalSessionState {
  sessions: TerminalSession[];
  activeId: string | null;
  panelOpen: boolean;

  // Panel controls
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;

  // Session lifecycle
  /** Creates a new session (up to MAX_SESSIONS) and switches to it. */
  addSession: () => void;
  /** Removes a session. Switches active tab; closes panel if last tab removed. */
  removeSession: (id: string) => void;
  setActiveId: (id: string) => void;
  /** Updates session label — trimmed and capped at 24 characters. */
  renameSession: (id: string, label: string) => void;

  // Per-session state updates (called by TerminalTab)
  updateStatus: (id: string, status: TerminalStatus) => void;
  registerSender: (id: string, fn: ((data: string) => boolean) | null) => void;

  /** Returns the sendInput of the active session, or null if none. */
  activeSendInput: () => ((data: string) => boolean) | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  // crypto.randomUUID() is available in all modern browsers and Node 15+.
  return crypto.randomUUID();
}

function readPanelOpenFromStorage(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writePanelOpenToStorage(open: boolean): void {
  try {
    if (open) {
      localStorage.setItem(STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors (e.g. private browsing quota)
  }
}

function makeSession(label: string): TerminalSession {
  return {
    id: generateId(),
    label,
    status: 'connecting',
    sendInput: null,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initialSession = makeSession('Terminal 1');

export const useTerminalSessionStore = create<TerminalSessionState>((set, get) => ({
  sessions: [initialSession],
  activeId: initialSession.id,
  panelOpen: readPanelOpenFromStorage(),

  // ── Panel controls ────────────────────────────────────────────────────────

  openPanel: () => {
    writePanelOpenToStorage(true);
    set({ panelOpen: true });
  },

  closePanel: () => {
    writePanelOpenToStorage(false);
    set({ panelOpen: false });
  },

  togglePanel: () => {
    const next = !get().panelOpen;
    writePanelOpenToStorage(next);
    set({ panelOpen: next });
  },

  // ── Session lifecycle ─────────────────────────────────────────────────────

  addSession: () => {
    const { sessions } = get();
    if (sessions.length >= MAX_SESSIONS) return;

    const label = `Terminal ${sessions.length + 1}`;
    const newSession = makeSession(label);

    set({
      sessions: [...sessions, newSession],
      activeId: newSession.id,
    });
  },

  removeSession: (id: string) => {
    const { sessions, activeId } = get();
    const filtered = sessions.filter((s) => s.id !== id);

    if (filtered.length === 0) {
      // Last tab removed — close the panel.
      writePanelOpenToStorage(false);
      set({ sessions: [], activeId: null, panelOpen: false });
      return;
    }

    // If we removed the active tab, switch to the previous session or first.
    let nextActiveId = activeId;
    if (activeId === id) {
      const removedIndex = sessions.findIndex((s) => s.id === id);
      const previousIndex = Math.max(0, removedIndex - 1);
      nextActiveId = filtered[previousIndex]?.id ?? filtered[0].id;
    }

    set({ sessions: filtered, activeId: nextActiveId });
  },

  setActiveId: (id: string) => {
    set({ activeId: id });
  },

  renameSession: (id: string, label: string) => {
    const trimmed = label.trim().slice(0, 24);
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, label: trimmed } : s,
      ),
    }));
  },

  // ── Per-session state updates ─────────────────────────────────────────────

  updateStatus: (id: string, status: TerminalStatus) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, status } : s,
      ),
    }));
  },

  registerSender: (id: string, fn: ((data: string) => boolean) | null) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, sendInput: fn } : s,
      ),
    }));
  },

  // ── Derived ───────────────────────────────────────────────────────────────

  activeSendInput: () => {
    const { sessions, activeId } = get();
    return sessions.find((s) => s.id === activeId)?.sendInput ?? null;
  },
}));
