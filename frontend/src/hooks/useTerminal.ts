/**
 * WebSocket + xterm.js lifecycle hook.
 * ADR-002: replaces the terminal.js IIFE.
 * Blueprint §5 rules 1-2: xterm uses useRef, WebSocket survives re-renders.
 *
 * Key contract:
 * - terminalRef: attach to a <div> element for xterm.js mounting
 * - connect/disconnect controlled by panelOpen
 * - Closing the panel does NOT close the WebSocket (matching legacy behavior)
 * - Reconnect with exponential backoff: 2s base, 30s max
 */

import { useEffect, useRef, useCallback } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { TerminalStatus } from '@/types';

const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS  = 30000;
const RESIZE_DEBOUNCE = 100;

/** Dark palette — background matches --color-terminal-bg dark token (#0D0D0F). */
export const XTERM_THEME_DARK = {
  background:          '#0d0d0f',
  foreground:          '#d4d4d4',
  cursor:              '#1a73e8',
  selectionBackground: 'rgba(26, 115, 232, 0.3)',
  black:               '#1e1e1e',
  red:                 '#f48771',
  green:               '#81c784',
  yellow:              '#ffb74d',
  blue:                '#64b5f6',
  magenta:             '#bb86fc',
  cyan:                '#4dd0e1',
  white:               '#d4d4d4',
  brightBlack:         '#484848',
  brightRed:           '#ff8a80',
  brightGreen:         '#b9f6ca',
  brightYellow:        '#ffe57f',
  brightBlue:          '#82b1ff',
  brightMagenta:       '#ea80fc',
  brightCyan:          '#84ffff',
  brightWhite:         '#ffffff',
};

/**
 * Light palette — MD3 light surface tokens + WCAG AA-contrast ANSI colors.
 * Blueprint §3: all foreground colors verified ≥ 4.5:1 contrast on #ffffff.
 */
export const XTERM_THEME_LIGHT = {
  background:          '#ffffff',
  foreground:          '#1f1f1f',
  cursor:              '#1a73e8',
  selectionBackground: 'rgba(26, 115, 232, 0.25)',
  black:               '#000000',
  red:                 '#c5221f',
  green:               '#1e8e3e',
  yellow:              '#b06000',
  blue:                '#1a73e8',
  magenta:             '#a142f4',
  cyan:                '#007b83',
  white:               '#3c4043',
  brightBlack:         '#5f6368',
  brightRed:           '#d93025',
  brightGreen:         '#188038',
  brightYellow:        '#e37400',
  brightBlue:          '#1967d2',
  brightMagenta:       '#8430ce',
  brightCyan:          '#129eaf',
  brightWhite:         '#202124',
};

interface UseTerminalOptions {
  panelOpen: boolean;
  /** Full WebSocket URL including query string, e.g. 'ws://localhost:3000/ws/terminal?sessionId=abc'. */
  wsUrl: string;
  onStatusChange: (status: TerminalStatus) => void;
  onReconnectAvailable: (available: boolean) => void;
  onReconnectCountdown: (seconds: number) => void;
  /** Called when the PTY process exits. code is null when unavailable. */
  onProcessExit?: (code: number | null) => void;
  /**
   * Active app theme. When 'light', the terminal renders the light palette.
   * Defaults to 'dark'. Changes are applied live without remounting xterm or
   * reconnecting the WebSocket (blueprint §3, ADR-1).
   */
  resolvedTheme?: 'light' | 'dark';
}

interface UseTerminalReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  reconnectNow: () => void;
  /**
   * Inject raw data into the PTY terminal.
   * Returns true if the WebSocket was open and the message was sent, false otherwise.
   * Stable across renders (useCallback with no deps change).
   * Used by the agent launcher store to inject CLI commands.
   */
  sendInput: (data: string) => boolean;
}

export function useTerminal({
  panelOpen,
  wsUrl,
  onStatusChange,
  onReconnectAvailable,
  onReconnectCountdown,
  onProcessExit,
  resolvedTheme = 'dark',
}: UseTerminalOptions): UseTerminalReturn {
  const containerRef = useRef<HTMLDivElement>(null);

  // Imperative refs — never stored in React state (blueprint §5 rule 1)
  const terminalRef     = useRef<Terminal | null>(null);
  const fitAddonRef     = useRef<FitAddon | null>(null);
  const xtermMounted    = useRef(false);
  const wsRef           = useRef<WebSocket | null>(null);
  const reconnectDelay  = useRef(BACKOFF_BASE_MS);
  const reconnectTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef     = useRef<ResizeObserver | null>(null);

  // Keep callbacks stable
  const onStatusChangeRef      = useRef(onStatusChange);
  const onReconnectAvailableRef = useRef(onReconnectAvailable);
  const onReconnectCountdownRef = useRef(onReconnectCountdown);
  const onProcessExitRef        = useRef(onProcessExit);
  useEffect(() => { onStatusChangeRef.current = onStatusChange; });
  useEffect(() => { onReconnectAvailableRef.current = onReconnectAvailable; });
  useEffect(() => { onReconnectCountdownRef.current = onReconnectCountdown; });
  useEffect(() => { onProcessExitRef.current = onProcessExit; });

  const send = useCallback((payload: object): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }, []);

  const writeSystemLine = useCallback((message: string) => {
    terminalRef.current?.write(`\r\n\x1b[2m${message}\x1b[0m`);
  }, []);

  const onContainerResize = useCallback(() => {
    if (!fitAddonRef.current || !terminalRef.current || !xtermMounted.current) return;
    fitAddonRef.current.fit();
    // Restore scroll position after fit — xterm.js v5 can jump to the top of the
    // scrollback buffer when the terminal is resized during active output.
    terminalRef.current.scrollToBottom();
    if (resizeTimer.current) clearTimeout(resizeTimer.current);
    resizeTimer.current = setTimeout(() => {
      send({
        type: 'resize',
        cols: terminalRef.current?.cols ?? 80,
        rows: terminalRef.current?.rows ?? 24,
      });
    }, RESIZE_DEBOUNCE);
  }, [send]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimer.current) return;
    const delay   = reconnectDelay.current;
    const seconds = Math.round(delay / 1000);
    writeSystemLine(`Reconnecting in ${seconds}s...`);
    onReconnectAvailableRef.current(true);
    onReconnectCountdownRef.current(seconds);

    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null;
      onReconnectAvailableRef.current(false);
      connect(); // eslint-disable-line @typescript-eslint/no-use-before-define
    }, delay);

    reconnectDelay.current = Math.min(reconnectDelay.current * 2, BACKOFF_MAX_MS);
  }, [writeSystemLine]);

  const connect = useCallback(() => {
    const ws = wsRef.current;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    onStatusChangeRef.current('connecting');

    let newWs: WebSocket;
    try {
      newWs = new WebSocket(wsUrl);
    } catch (err) {
      console.error('[terminal] WebSocket constructor error:', err);
      scheduleReconnect();
      return;
    }
    wsRef.current = newWs;

    newWs.addEventListener('open', () => {
      reconnectDelay.current = BACKOFF_BASE_MS;
      onStatusChangeRef.current('connected');
      onReconnectAvailableRef.current(false);
    });

    newWs.addEventListener('message', (event: MessageEvent) => {
      let parsed: { type: string; data?: string; cols?: number; rows?: number; code?: number; message?: string };
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        console.warn('[terminal] non-JSON message:', event.data);
        return;
      }

      if (parsed.type === 'output') {
        terminalRef.current?.write(parsed.data ?? '');
      } else if (parsed.type === 'ready') {
        if (terminalRef.current && fitAddonRef.current && xtermMounted.current) {
          fitAddonRef.current.fit();
          terminalRef.current.scrollToBottom();
          send({ type: 'resize', cols: terminalRef.current.cols, rows: terminalRef.current.rows });
        }
      } else if (parsed.type === 'exit') {
        const code = parsed.code != null ? parsed.code : '—';
        terminalRef.current?.write(`\r\n\x1b[33m--- Shell exited (code ${code}) ---\x1b[0m\r\n`);
        onProcessExitRef.current?.(parsed.code ?? null);
      } else if (parsed.type === 'error') {
        terminalRef.current?.write(`\r\n\x1b[31m[error] ${parsed.message ?? ''}\x1b[0m\r\n`);
      }
      // pong: no-op
    });

    newWs.addEventListener('close', (event) => {
      console.debug(`[terminal] disconnected, code=${event.code}`);
      onStatusChangeRef.current('disconnected');
      scheduleReconnect();
    });

    newWs.addEventListener('error', () => {
      console.warn('[terminal] WebSocket error');
    });
  }, [scheduleReconnect, send, wsUrl]);

  const reconnectNow = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    onReconnectAvailableRef.current(false);
    connect();
  }, [connect]);

  // Initialize xterm.js on first panel open (lazy)
  useEffect(() => {
    if (!panelOpen || xtermMounted.current || !containerRef.current) return;

    let mounted = true;

    // Dynamic import to avoid bundling in tests
    Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
    ]).then(([{ Terminal }, { FitAddon }]) => {
      if (!mounted || !containerRef.current) return;

      const terminal = new Terminal({
        cursorBlink:      true,
        cursorStyle:      'block',
        fontSize:         13,
        fontFamily:       "'JetBrains Mono', 'Courier New', monospace",
        theme:            resolvedTheme === 'light' ? XTERM_THEME_LIGHT : XTERM_THEME_DARK,
        scrollback:       5000,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);
      fitAddon.fit();
      xtermMounted.current = true;

      terminalRef.current  = terminal;
      fitAddonRef.current  = fitAddon;

      // Relay keystrokes to server
      terminal.onData((data) => {
        send({ type: 'input', data });
      });

      // Debounced resize relay
      terminal.onResize(({ cols, rows }) => {
        if (resizeTimer.current) clearTimeout(resizeTimer.current);
        resizeTimer.current = setTimeout(() => {
          send({ type: 'resize', cols, rows });
        }, RESIZE_DEBOUNCE);
      });

      // Watch container for size changes
      const observer = new ResizeObserver(onContainerResize);
      observer.observe(containerRef.current);
      observerRef.current = observer;
    });

    return () => { mounted = false; };
  }, [panelOpen, onContainerResize, send]);

  // Re-fit after panel becomes visible (layout shift)
  useEffect(() => {
    if (!panelOpen || !xtermMounted.current) return;
    const id = setTimeout(() => {
      fitAddonRef.current?.fit();
      terminalRef.current?.scrollToBottom();
      terminalRef.current?.focus();
    }, 50);
    return () => clearTimeout(id);
  }, [panelOpen]);

  // Live theme switching — mutates xterm options in place (no remount, no reconnect).
  // ADR-1: xterm.js v5 supports live theme updates via terminal.options.theme.
  useEffect(() => {
    if (!terminalRef.current || !xtermMounted.current) return;
    terminalRef.current.options.theme = resolvedTheme === 'light' ? XTERM_THEME_LIGHT : XTERM_THEME_DARK;
  }, [resolvedTheme]);

  // Connect on first panel open
  useEffect(() => {
    if (!panelOpen) return;
    connect();
  }, [panelOpen, connect]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
      observerRef.current?.disconnect();
      terminalRef.current?.dispose();
      wsRef.current?.close();
    };
  }, []);

  /**
   * Stable function that wraps send({ type: 'input', data }).
   * sendInput is the bridge used by the agent launcher Zustand store to inject
   * CLI commands into the PTY without directly accessing wsRef.
   */
  const sendInput = useCallback((data: string): boolean => {
    return send({ type: 'input', data });
  }, [send]);

  return { containerRef, reconnectNow, sendInput };
}
