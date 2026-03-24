# ADR-1: Multi-Tab PTY Terminal Sessions

## Status

Accepted

## Context

The current terminal implementation provides exactly one PTY session per user session. One WebSocket connection is opened at `/ws/terminal`, one `node-pty` process is spawned, and one `xterm.js` instance renders it inside `TerminalPanel`. The `terminalSender` bridge in `useAppStore` registers the single `sendInput` callback so the agent launcher can inject commands.

This model creates a practical constraint: the user cannot observe an agent running in the background terminal while also typing manual shell commands at the same time — they share the same PTY. The feature request is to support N independent terminal tabs, each backed by a separate PTY process and WebSocket connection.

### Constraints inherited from the existing system

- `terminal.js` is a standalone module; `server.js` calls `setupTerminalWebSocket(server)` once after `server.listen()`.
- The WebSocket upgrade route is `/ws/terminal`. Any new session-multiplexing scheme must coexist with or replace this route without breaking existing clients (e.g. tests, MCP usage).
- `useTerminal` hook encapsulates all `xterm.js` and WebSocket lifecycle in a single component-scoped hook. It is tightly coupled to a single `containerRef`.
- `terminalSender` in `useAppStore` is a single nullable function, not an array. The agent launcher `executeAgentRun` uses this bridge to inject commands; this coupling must be preserved or adapted.
- `TerminalPanel` is a single `<aside>` element mounted once in `App.tsx`. Its visibility is controlled by `terminalOpen: boolean`.
- `MAX_CONNECTIONS = 5` already exists in `terminal.js` — sufficient headroom for N tabs (recommended max: 4).

### Why this matters now

Agent pipelines (T-10 parent task) spawn agents in the PTY. When a pipeline is running it occupies the single terminal. Having a second tab for manual commands is the minimum viable improvement that keeps the user productive without interrupting agent output.

## Decision

Introduce a session-ID-based URL scheme on the existing WebSocket route so that each tab connects to a unique URL (`/ws/terminal?sessionId=<uuid>`). The backend creates one PTY per connection (existing behaviour, unchanged). The frontend introduces a `TerminalSessionManager` — a Zustand slice managing an ordered list of sessions, the active tab index, and per-session `sendInput` bridges — replacing the single `terminalSender`. `TerminalPanel` is refactored to render a tab bar and one `TerminalTab` component per session. `useTerminal` is parameterised with a `sessionId` and a `wsUrl`, but is otherwise unchanged.

## Rationale

**One WebSocket connection = one PTY session** is the existing invariant. The cleanest extension is to open N connections, each to a URL that carries a session identifier in the query string. The server already creates a PTY per connection; no server-side multiplexing or session registry is needed.

A query-string discriminator (`?sessionId=`) was chosen over a new path prefix (`/ws/terminal/abc`) because:
1. The existing upgrade handler checks `url === '/ws/terminal'` after stripping the query string — changing to a path-based scheme would require rewriting that check.
2. A query string is transparent to existing tests that connect to `/ws/terminal` with no parameters; those tests continue to work unchanged.

The `TerminalSessionManager` Zustand slice keeps session state (id, label, status, sendInput) in one place, avoiding prop-drilling and making the agent launcher's tab-targeting straightforward.

The `terminalSender` field in `useAppStore` is replaced by `activeTerminalSender: (data: string) => boolean | null`, which is derived from the active tab's `sendInput`. The agent launcher logic (`executeAgentRun`, `cancelAgentRun`) does not change — it still reads `terminalSender`-equivalent from the store. This ensures backward compatibility with all existing agent-launcher code.

Maximum sessions is capped at 4 in the frontend to stay well inside `MAX_CONNECTIONS = 5`.

## Consequences

### Positive

- Each tab is a fully independent PTY with its own shell, working directory, and scrollback buffer.
- Agent commands injected via the launcher always go to the "active" tab (user-controlled), making it easy to dedicate tab 1 to agents and tab 2 to manual work.
- `terminal.js` requires zero changes — the feature is entirely additive.
- `useTerminal` hook requires only one additive parameter (`wsUrl`) — its core lifecycle logic is untouched.
- Existing single-tab tests pass without modification.

### Negative / Risks

- **More concurrent PTY processes:** Each open tab spawns a shell. Four tabs = four shells, each consuming memory and file descriptors. Mitigation: enforce a 4-tab maximum in the frontend; the `MAX_CONNECTIONS = 5` cap on the server acts as a hard backstop.
- **`terminalSender` refactor touches `useAppStore`:** Renaming/replacing the single `terminalSender` field requires updating `TerminalPanel`, `TerminalTab`, and all agent-launcher store actions. Mitigation: the rename is a mechanical find-replace; the interface contract is unchanged.
- **Tab lifecycle on disconnect:** If the WebSocket for a tab drops and auto-reconnects, the tab label and status must update correctly. The existing reconnect/backoff logic in `useTerminal` already handles this; it just needs to surface status per-tab rather than globally.
- **Agent launcher target tab:** When a user has multiple tabs, the agent command goes to whichever tab is active at the time `executeAgentRun` is called. This is correct UX but may be surprising if the user switches tabs between preparing a run and executing it. Mitigation: a status indicator on the tab receiving the injection.

## Alternatives Considered

- **Single WebSocket + server-side session multiplexing:** The server would demultiplex messages by a `sessionId` field and maintain a map of PTY processes. Rejected: adds non-trivial server complexity for zero benefit over N independent connections.
- **Shared xterm.js, swap PTY per tab:** Mount one `xterm.js` instance and swap the underlying WebSocket when the user clicks a tab. Rejected: `xterm.js` does not support hot-swapping the data source without a full dispose/recreate cycle, which causes a visible flash and loses scrollback.
- **Detached floating terminal windows:** Open extra terminal sessions in detached overlay panels. Rejected: higher UI complexity; tabs are the universally understood affordance for multiple sessions.

## Review

Suggested review date: 2026-09-24
