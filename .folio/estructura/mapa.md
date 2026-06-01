---
title: Mapa de ficheros y entry points
author: agent
pinned: true
created: 2026-06-01
updated: 2026-06-01
tags: [estructura, entrypoints]
---

## Backend
- `server.js` — entry point; `startServer()`, arranca el HTTP server en `:3000`.
- `src/routes/index.js` — routing manual (match por método + path). Aquí se registran rutas de spaces, tasks, runs, y Folio (`/folio/refs/*`, `/spaces/:id/folio*`). Orden de rutas importa (específicas antes que `SPACES_TASKS_ROUTE`).
- `src/handlers/` — handlers HTTP: `prompt.js`, `config.js`, `search.js`, `pipeline.js`, `folioRefs.js`, `folioPages.js`.
- `src/services/store.js` — **única fuente de DDL y CRUD** (spaces, tasks, runs). Folio colgado en `store.folio.{core,binding}`.
- `src/services/migrator.js` — migración JSON → SQLite.
- `src/services/pipelineManager.js` — el **runner del pipeline de agentes** (grande, ~93KB): spawn de stages, buildStagePrompt, loop de fix QA→dev, write-back/bootstrap de Folio.
- `src/services/spaceManager.js` · `worktreeManager.js` (worktrees de runs paralelos) · `agentResolver.js` · `templateManager.js`.
- `src/services/folio/` — módulo Folio (core, extraíble): `db.js`, `store.js`, `backend.js`, `markdown.js`, `resolver.js`, `injection.js`, `tokens.js`, `archive.js`, `zip.js`, `index.js` (facade).
- `src/services/folioBinding.js` · `folioFileBinding.js` · `folioRouter.js` — binding lado-Prism (space↔folio, dispatch por backend). `folioBootstrap.js` — bootstrap desde repo.
- `mcp/mcp-server.js` — MCP server de Prism (acoplado a la REST API vía `kanban-client.js`). `mcp/folio-tools.js` + `folio-mcp-server.js` — tools Folio + server stdio standalone.

## Frontend (`frontend/src/`)
- `App.tsx` — layout raíz; board + paneles laterales (Terminal, Runs, Config, AgentSettings, Folio).
- `stores/useAppStore.ts` — Zustand global (`activeSpaceId`, toggles de panel, `showToast`).
- `api/client.ts` — cliente REST tipado. `API_BASE = '/api/v1'` (ruta relativa, mismo origen).
- `components/`: `board/`, `layout/Header.tsx`, `shared/` (Button, Badge, Modal, Toast, Tooltip), `config/`, `runs-panel/`, `agent-launcher/`, `terminal/`, `modals/`, `folio/`.
- `tailwind.config.js` + `index.css` — tokens del design system.
