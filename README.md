# Prism

A local-first Kanban board with an integrated terminal, AI agent run history, and a Model Context Protocol (MCP) server — built for use with Claude Code and Claude Desktop.

**Stack:** Node.js (no framework) · React 19 · TypeScript · Tailwind CSS · Vite · Zustand

---

## What Makes Prism Different

**Prism is not another Kanban + terminal.** It's a **design-to-code workflow orchestrator** that eliminates the gap between planning and shipping:

- **Multi-stage agent pipeline built into your board** — Create a task, hit "Run Pipeline", and watch `architect → UX/API → developer → code-review → QA` execute automatically. Each stage is a gated gate; no hand-offs between tools.

- **All design decisions persist as artifacts** — Not just code commits. ADRs, blueprints, wireframes, OpenAPI specs, test results, and bug reports live alongside your task. When you ship, you ship the *why*, not just the *what*.

- **Automated quality loop** — QA finds a critical bug? Prism re-invokes the developer with the bug report, auto-reruns tests, and blocks merge until green. Zero manual choreography.

- **Real-time agent log streaming** — Watch each agent's reasoning unfold in a live terminal. See what decisions it made, what it generated, and catch issues mid-run.

---

## Features

**Core**
- **Kanban board** — Spaces, columns (To Do / In Progress / Done), task attachments, activity log
- **Multi-stage pipeline runner** — Orchestrate architect → UX/API → dev → code-review → QA in one click; stages are gated (can't proceed without required artifacts)
- **Live agent output** — Real-time log viewer streams each stage's reasoning and generated artifacts

**Developer Experience**
- **Integrated terminal** — Full shell access (PTY-backed WebSocket), no leaving the browser
- **Artifact management** — Attach ADRs, specs, wireframes, and test results directly to tasks
- **Config editor** — Edit `~/.claude/*.md` files (CLAUDE.md, project rules, agent definitions) directly from the UI
- **Agent run history** — Status timeline, logs, and stage outputs for debugging

**Integration**
- **MCP server** — Expose all Kanban and pipeline operations as Claude tools (works with Claude Code + Claude Desktop)
- **Dark-first Material Design 3** — Built for focused, long-session work

---

## Prerequisites

**Node.js ≥ 18** is required.

`node-pty` compiles native C++ bindings via `node-gyp`. You must have build tools installed before running `npm install`.

| OS | Command |
|----|---------|
| macOS | `xcode-select --install` |
| Linux (Debian/Ubuntu) | `sudo apt install build-essential python3` |
| Windows | `npm install --global windows-build-tools` (run as Administrator) |

---

## Setup

```bash
# 1. Install backend dependencies (compiles node-pty)
npm install

# 2. Install and build the frontend
cd frontend && npm install && npm run build && cd ..

# 3. Start the server
node server.js
# → http://localhost:3000
```

> The `data/` directory is created automatically on first startup. No manual initialisation needed.

---

## Development Mode

Run backend and frontend concurrently with hot-reload:

```bash
# Terminal 1 — backend
node server.js

# Terminal 2 — frontend (Vite dev server with HMR)
cd frontend && npm run dev
# → http://localhost:5173
```

The Vite dev server proxies `/api/v1` and `/ws` requests to `localhost:3000`.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `DATA_DIR` | `./data` | Directory for JSON persistence files |
| `KANBAN_API_URL` | `http://localhost:3000/api/v1` | Base URL used by the MCP server |
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated list of allowed WebSocket origins for the terminal. Set this when running behind a reverse proxy, in Docker, or in cloud deployments (e.g. `ALLOWED_ORIGINS=https://myapp.example.com`). |

---

## MCP Configuration

Prism includes an MCP server (`mcp/mcp-server.js`) that exposes all Kanban operations as tools. This allows Claude Code and Claude Desktop to read and write your board directly.

**Requires `node server.js` to be running** before launching any Claude session.

### Claude Code (`.claude/settings.json`)

```json
{
  "mcpServers": {
    "prism": {
      "command": "node",
      "args": ["./mcp/mcp-server.js"],
      "env": {
        "KANBAN_API_URL": "http://localhost:3000/api/v1"
      }
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "prism": {
      "command": "node",
      "args": ["/absolute/path/to/prism/mcp/mcp-server.js"],
      "env": {
        "KANBAN_API_URL": "http://localhost:3000/api/v1"
      }
    }
  }
}
```

Available MCP tools: `kanban_list_tasks`, `kanban_get_task`, `kanban_create_task`, `kanban_update_task`, `kanban_move_task`, `kanban_delete_task`, `kanban_clear_board`, `kanban_list_spaces`, `kanban_create_space`, `kanban_rename_space`, `kanban_delete_space`, `kanban_list_activity`, `kanban_start_pipeline`, `kanban_get_run_status`.

---

## Tests

```bash
# Backend integration tests (Node.js test runner)
npm test

# Frontend unit + component tests (Vitest + React Testing Library)
cd frontend && npm test
```

Frontend test suite: 142+ tests across stores, hooks, and components.
Backend test suite: integration tests covering all API endpoints.

---

## Project Structure

```
prism/
├── server.js          # Entry point — wires services, handlers and router
├── terminal.js        # PTY-backed WebSocket terminal
├── src/
│   ├── routes/        # URL pattern matching and dispatch
│   ├── handlers/      # Per-resource request handlers (tasks, spaces, pipeline…)
│   ├── services/      # Business logic (spaceManager, pipelineManager, migrator…)
│   └── utils/         # Shared HTTP helpers
├── mcp/               # MCP server (ESM sub-package)
│   └── mcp-server.js
├── frontend/          # React 19 + TypeScript + Vite
│   └── src/
│       ├── components/
│       ├── hooks/
│       ├── stores/
│       └── api/
├── data/              # JSON persistence (auto-created, gitignored)
└── dist/              # Built frontend (served in production, gitignored)
```

The `docs/` directory contains ADRs, blueprints, and design artefacts for each feature, organised by feature name.

---

## Contributing

See [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) for setup instructions, code conventions and how to submit a PR.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

---

## License

MIT
