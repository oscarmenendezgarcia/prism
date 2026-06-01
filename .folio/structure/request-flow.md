---
title: Request Flow
author: agent
pinned: false
created: 2026-06-01
updated: 2026-06-01
tags: [http, backend, mcp]
---

## HTTP
`server.js` receives the request → `src/routes/index.js` matches manually by method+path → handler (in `src/handlers/` or inline) → operates via `src/services/store.js` → responds with JSON. **No framework middleware.** Route registration order matters: specific routes (e.g. `/folio/refs/search`) come BEFORE generic ones (`/spaces/:id/tasks/...`).

## Frontend → Backend
- Dev: Vite (`:5173`) proxies `/api/*` to `:3000`.
- Prod: the backend serves `dist/` and the SPA calls `/api/v1/*` (same origin, relative path).

## MCP
`mcp/mcp-server.js` exposes the Kanban API as tools (`kanban_*`); internally it calls Prism's REST API via `kanban-client.js` (it is **coupled to HTTP**, which is why the server must be up). The Folio MCP (`folio-mcp-server.js`) is separate and uses the file backend directly (it does not go through HTTP).

## Pipeline
`pipelineManager.js` launches each stage as a `claude --agent <id>` subprocess with the prompt in `data/runs/<runId>/stage-N-prompt.md`. State is persisted in `data/runs/<runId>/run.json`; output in `stage-N.log`. Folio resolution (`[[refs]]` + context injection) is wired inside `buildStagePrompt`.
