# Prism

A local-first Kanban board with an integrated terminal, AI agent run history, and a Model Context Protocol (MCP) server — built for use with Claude Code and Claude Desktop.

**Stack:** Node.js (no framework) · React 19 · TypeScript · Tailwind CSS · Vite · Zustand

---

## Features

- Kanban board with spaces, columns (To Do / In Progress / Done), and task attachments
- Integrated terminal panel (PTY-backed, full shell access)
- Agent run history with live polling and status timeline
- Dark-first Material Design 3 UI
- MCP server exposing all Kanban operations as tools callable by Claude

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

Available MCP tools: `kanban_list_tasks`, `kanban_get_task`, `kanban_create_task`, `kanban_update_task`, `kanban_move_task`, `kanban_delete_task`, `kanban_list_spaces`, `kanban_create_space`, `kanban_rename_space`, `kanban_delete_space`, `kanban_list_activity`.

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
├── server.js          # HTTP server — all API routes
├── terminal.js        # PTY-backed WebSocket terminal
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

## Changelog

See [docs/agent-run-history/CHANGELOG.md](docs/agent-run-history/CHANGELOG.md) for the implementation history of the agent run history feature.

---

## License

MIT
