# ADR-1: Terminal Injection with Temp-File Prompts for Agent Launcher

## Status

Accepted

## Context

Prism is a local Kanban board used to orchestrate AI coding agents (Claude Code, OpenCode). Users currently launch agents manually by typing CLI commands in the integrated terminal. This is repetitive and error-prone: the user must assemble the prompt (task context, agent instructions, Kanban/Git blocks) by hand every time.

We need a mechanism to launch agents directly from task cards, with the full prompt auto-generated from task metadata and agent definitions. The key architectural question is: **how should Prism execute CLI commands, and how should complex prompts be delivered to the CLI tool?**

The existing system has:
- An integrated terminal panel backed by node-pty via WebSocket (`/ws/terminal`)
- Agent definitions as `.md` files in `~/.claude/agents/`
- A config file API that already scans `~/.claude/agents/`
- JSON flat-file persistence in `data/`
- A 3-second polling loop for board auto-refresh

The constraints are explicit:
- No spawning new processes from the server
- No new major dependencies
- Commands must be injected into the existing PTY terminal

## Decision

Agent commands are executed by **injecting keystrokes into the existing PTY terminal** via the WebSocket input protocol. Complex prompts are delivered via **temporary files** written by a new server endpoint, referenced in the CLI command using shell substitution (`$(cat /path/to/prompt.md)`).

Specifically:
1. A new `POST /api/v1/agent/prompt` endpoint assembles the full prompt from task data + agent file content + standard instruction blocks, writes it to `data/.prompts/`, and returns the absolute path.
2. The frontend builds the CLI command string (e.g., `claude -p "$(cat /path/to/prompt.md)"`) and sends it to the terminal WebSocket as `{ type: "input", data: "command\n" }`.
3. Pipeline orchestration (multi-stage runs) is managed client-side in Zustand, using the existing 3-second polling loop to detect stage completion (all tasks in "done" column).
4. Settings (CLI binary, flags, pipeline config) are persisted in `data/settings.json` via new `GET/PUT /api/v1/settings` endpoints.

## Rationale

**Terminal injection over server-side spawning:**
- The PTY already exists and is connected. Injecting into it requires zero new infrastructure.
- The user sees the command in their shell context, with full env vars, PATH, aliases.
- It matches the user's existing mental model: "I type commands in the terminal."
- Server-side spawning would contradict the explicit constraint and add process management complexity.

**Temp files over inline CLI arguments:**
- Agent prompts are multi-section documents (1-4 KB typical) containing special characters (backticks, `$`, quotes, newlines).
- Shell escaping for inline arguments is fragile and has practical length limits.
- Temp files are debuggable (the user can `cat` the file to inspect the prompt).
- The server already uses atomic file writes (`.tmp` + rename pattern) for persistence.

**Client-side pipeline orchestration over server-side:**
- The pipeline is interactive: users want to see each stage, review output, and intervene.
- The existing 3-second polling already detects board changes.
- Server-side orchestration would require a state machine, process monitoring, and would break if the server restarts mid-pipeline.

## Consequences

### Positive
- **Zero new dependencies.** All infrastructure (WebSocket, PTY, file I/O, Zustand) already exists.
- **Transparent execution.** The user sees exactly what command runs in their terminal.
- **Debuggable prompts.** Temp files persist on disk for inspection.
- **Incremental delivery.** Each component (agent listing, prompt generation, terminal injection, settings, pipeline) can be built and tested independently.
- **Board auto-refresh is free.** The 3-second polling already picks up agent-driven changes.

### Negative / Risks
- **No programmatic exit-code detection.** Terminal injection cannot return a structured "command completed" signal. Mitigation: detect stage completion heuristically via board state (tasks moved to "done") rather than process exit codes.
- **Single terminal limitation.** Only one command runs at a time in the PTY. Mitigation: the UI disables the "Run Agent" action while `activeRun` is non-null. Pipeline mode is inherently sequential.
- **Keystroke interleaving.** If the user types in the terminal while a command is being injected, characters may interleave. Mitigation: the entire command string (including `\n`) is sent as a single WebSocket message, which node-pty writes atomically to the PTY fd.
- **Temp file cleanup.** Prompt files accumulate in `data/.prompts/`. Mitigation: server cleans up files older than 24 hours on startup and periodically.
- **Prompt size.** Very large prompts (>64KB) may hit shell limits. Mitigation: the temp file approach already handles this; the `$(cat ...)` subshell reads from disk, not from the argument buffer.

## Alternatives Considered

- **Server-side process spawning:** Discarded because it contradicts the explicit constraint ("no spawning new processes from server") and would duplicate the PTY infrastructure.
- **Inline CLI arguments with shell escaping:** Discarded because agent prompts contain backticks, `$`, and multi-line content that make reliable escaping impractical. Tested with a 2KB prompt containing Mermaid diagrams -- escaping failed on the first attempt.
- **Server-side pipeline orchestration with file watchers:** Discarded because it adds a state machine, survives server restarts poorly, and removes the interactive quality of the pipeline. The 4-stage pipeline benefits from human oversight between stages.
- **WebSocket-based command execution protocol (new message types):** Discarded because it would require changes to terminal.js server-side, new message types, and effectively duplicate the existing PTY input path.

## Review

Suggested review date: 2026-09-18
