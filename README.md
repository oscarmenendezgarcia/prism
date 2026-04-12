# Prism

[![CI](https://github.com/oscarmenendezgarcia/prism/actions/workflows/ci.yml/badge.svg)](https://github.com/oscarmenendezgarcia/prism/actions/workflows/ci.yml)

**A Kanban board built for Claude Code agents.**

Prism gives your AI pipelines a place to work. Agents create tasks, move them across columns, write to an embedded terminal, and stream live logs — all from a single interface you can run locally or in Docker.

![Prism demo](docs/prism-demo.gif)

---

## What it does

Most Kanban tools are built for humans to track human work. Prism is different: it's designed as the **operating environment for AI agent pipelines**.

- **Agents manage the board** — via MCP tools, Claude Code agents create tasks, update status, and attach artifacts as they work
- **Run pipelines from any task** — one click launches a multi-stage pipeline (architect → UX → developer → QA) against a task card
- **Orchestrator mode** — a meta-agent drives the full pipeline, with live output streaming into the built-in terminal
- **Embedded terminal** — full PTY shell inside the UI; the orchestrator attaches to it automatically when open
- **Live log viewer** — stream stage-by-stage output in real time as each agent runs
- **Multiple spaces** — organise work across projects, each with its own board and pipeline config

---

## Quick start

```bash
docker compose up -d
# → http://localhost:3000
```

No Node.js or build tools required locally. Board data persists in `./data/`.

> **With Claude:** set `ANTHROPIC_API_KEY` in your environment before running Docker to enable agent pipelines.

---

## MCP — let Claude manage the board

Prism ships with an MCP server that exposes the full Kanban API as tools. Connect it to Claude Code or Claude Desktop and your agents can read and write the board directly.

> **Prerequisite:** `node server.js` (or `docker compose up`) must be running before starting any Claude session — the MCP server proxies requests to the Prism HTTP API.

**Claude Code** — one-liner from the project root:

```bash
claude mcp add prism node ./mcp/mcp-server.js -e KANBAN_API_URL=http://localhost:3000/api/v1
```

Or add it manually to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "prism": {
      "command": "node",
      "args": ["./mcp/mcp-server.js"],
      "env": { "KANBAN_API_URL": "http://localhost:3000/api/v1" }
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "prism": {
      "command": "node",
      "args": ["/absolute/path/to/prism/mcp/mcp-server.js"],
      "env": { "KANBAN_API_URL": "http://localhost:3000/api/v1" }
    }
  }
}
```

Available tools: `kanban_list_tasks`, `kanban_create_task`, `kanban_update_task`, `kanban_move_task`, `kanban_delete_task`, `kanban_list_spaces`, `kanban_create_space`, `kanban_start_pipeline`, `kanban_get_run_status`, and more.

---

## Running locally (without Docker)

**Prerequisites:** Node.js ≥ 18 and build tools for `node-pty`:

| OS | Command |
|----|---------|
| macOS | `xcode-select --install` |
| Linux | `sudo apt install build-essential python3` |
| Windows | `npm install --global windows-build-tools` |

```bash
npm install
cd frontend && npm install && npm run build && cd ..
node server.js
# → http://localhost:3000
```

**Development mode** (with HMR):

```bash
node server.js &
cd frontend && npm run dev   # → http://localhost:5173
```

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `DATA_DIR` | `./data` | JSON persistence directory |
| `ALLOWED_ORIGINS` | `http://localhost:3000,...` | Allowed WebSocket origins — set to your public URL behind a reverse proxy |
| `ANTHROPIC_API_KEY` | — | Required to run agent pipelines |

---

## Tests

```bash
npm test                        # Backend (Node.js test runner)
cd frontend && npm test         # Frontend (Vitest + React Testing Library)
```

---

## Stack

Node.js (no framework) · React 19 · TypeScript · Tailwind CSS v4 · Vite · Zustand · node-pty

---

## License

MIT
