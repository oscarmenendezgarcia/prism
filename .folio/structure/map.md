---
title: File Map and Entry Points
author: agent
pinned: true
created: 2026-06-01
updated: 2026-06-01
tags: [estructura, entrypoints]
---

## Backend
- `server.js` — entry point; `startServer()`, starts the HTTP server on `:3000`.
- `src/routes/index.js` — manual routing (match by method + path). This is where routes for spaces, tasks, runs, and Folio (`/folio/refs/*`, `/spaces/:id/folio*`) are registered. Route order matters (specific routes before `SPACES_TASKS_ROUTE`).
- `src/handlers/` — HTTP handlers: `prompt.js`, `config.js`, `search.js`, `pipeline.js`, `folioRefs.js`, `folioPages.js`.
- `src/services/store.js` — **the single source of DDL and CRUD** (spaces, tasks, runs). Folio hangs off `store.folio.{core,binding}`.
- `src/services/migrator.js` — JSON → SQLite migration.
- `src/services/pipelineManager.js` — the **agent pipeline runner** (large, ~93KB): stage spawning, buildStagePrompt, the QA→dev fix loop, Folio write-back/bootstrap.
- `src/services/spaceManager.js` · `worktreeManager.js` (worktrees for parallel runs) · `agentResolver.js` · `templateManager.js`.
- `src/services/folio/` — the Folio module (core, extractable): `db.js`, `store.js`, `backend.js`, `markdown.js`, `resolver.js`, `injection.js`, `tokens.js`, `archive.js`, `zip.js`, `index.js` (facade).
- `src/services/folioBinding.js` · `folioFileBinding.js` · `folioRouter.js` — Prism-side binding (space↔folio, dispatch by backend). `folioBootstrap.js` — bootstrap from the repo.
- `mcp/mcp-server.js` — Prism's MCP server (coupled to the REST API via `kanban-client.js`). `mcp/folio-tools.js` + `folio-mcp-server.js` — Folio tools + standalone stdio server.

## Frontend (`frontend/src/`)
- `App.tsx` — root layout; board + side panels (Terminal, Runs, Config, AgentSettings, Folio).
- `stores/useAppStore.ts` — global Zustand (`activeSpaceId`, panel toggles, `showToast`).
- `api/client.ts` — typed REST client. `API_BASE = '/api/v1'` (relative path, same origin).
- `components/`: `board/`, `layout/Header.tsx`, `shared/` (Button, Badge, Modal, Toast, Tooltip), `config/`, `runs-panel/`, `agent-launcher/`, `terminal/`, `modals/`, `folio/`.
- `tailwind.config.js` + `index.css` — design system tokens.
