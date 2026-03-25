# Prism — Architecture

> Maintained by agents. Update this file when architectural decisions change.

## Stack

- **Backend:** Node.js native HTTP (no framework) — `server.js`
- **Frontend:** React 19 + TypeScript + Tailwind CSS v4 + Vite + Zustand
- **Persistence:** `data/spaces.json` + per-space `data/<space-id>/{todo,in-progress,done}.json`
- **Build output:** `dist/` (served by backend in production)
- **MCP server:** `mcp/mcp-server.js` — exposes Kanban tools to Claude agents
- **Terminal:** `terminal.js` — PTY support via node-pty + xterm.js (WebSocket)

## Data model

```
spaces.json                  ← list of spaces { id, name, pipeline?, createdAt, updatedAt }
data/<spaceId>/
  todo.json                  ← Task[]
  in-progress.json           ← Task[]
  done.json                  ← Task[]
data/runs/<runId>/
  run.json                   ← PipelineRun
  stage-<N>.log              ← agent stdout stream
activity.json                ← ActivityEvent[] (global)
```

### Task shape

```json
{
  "id": "uuid",
  "title": "string (max 200)",
  "type": "task | research",
  "description": "string? (max 1000)",
  "assigned": "string?",
  "attachments": [{ "name": "string", "type": "text | file", "content": "string?" }],
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

### Space shape

```json
{
  "id": "uuid",
  "name": "string",
  "pipeline": ["agent-id", "..."],
  "workingDirectory": "string?",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

## Pipeline

Default order: `senior-architect → ux-api-designer → developer-agent → qa-engineer-e2e`

Per-space custom pipelines can override this order. Triggered via:
- `kanban_start_pipeline` MCP tool
- `POST /api/v1/runs`

Runs are async — poll `kanban_get_run_status` or `GET /api/v1/runs/:runId`.

Agent mode: `PIPELINE_AGENT_MODE=subagent` (default) uses `--agent <id>`.

Stage timeout: `PIPELINE_STAGE_TIMEOUT_MS` (default: `3600000` — 1 hour).

## Key ADRs

| # | Decision |
|---|----------|
| ADR-001 | Native Node.js HTTP, no framework |
| ADR-002 | Direct disk persistence via JSON files |
| ADR-1 (Spaces) | Directory-per-space model, legacy route shim |
| ADR-1 (Pipeline) | Async pipeline with per-stage logs and run state |
