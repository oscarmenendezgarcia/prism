---
title: Flujo de una request
author: agent
pinned: false
created: 2026-06-01
updated: 2026-06-01
tags: [http, backend, mcp]
---

## HTTP
`server.js` recibe la request → `src/routes/index.js` hace match manual por método+path → handler (en `src/handlers/` o inline) → opera vía `src/services/store.js` → responde JSON. **Sin middleware de framework.** El orden de registro de rutas importa: las específicas (ej. `/folio/refs/search`) van ANTES de las genéricas (`/spaces/:id/tasks/...`).

## Frontend → Backend
- Dev: Vite (`:5173`) proxea `/api/*` a `:3000`.
- Prod: el backend sirve `dist/` y la SPA llama a `/api/v1/*` (mismo origen, ruta relativa).

## MCP
`mcp/mcp-server.js` expone la API Kanban como tools (`kanban_*`); internamente llama a la REST API de Prism vía `kanban-client.js` (está **acoplado a HTTP**, por eso el server debe estar arriba). El MCP de Folio (`folio-mcp-server.js`) es aparte y usa el backend de fichero directo (no pasa por HTTP).

## Pipeline
`pipelineManager.js` lanza cada stage como subproceso `claude --agent <id>` con el prompt en `data/runs/<runId>/stage-N-prompt.md`. El estado se persiste en `data/runs/<runId>/run.json`; el output en `stage-N.log`. La resolución de Folio (`[[refs]]` + inyección de contexto) se cablea dentro de `buildStagePrompt`.
