---
title: Stack y runtime
author: agent
pinned: true
created: 2026-06-01
updated: 2026-06-01
tags: [stack, node, sqlite, react]
---

## Backend
- **Node.js ≥ 20**, servidor HTTP **nativo** (`node:http`) — NO hay framework (ni Express ni Fastify). Entry point: `server.js` en la raíz.
- **SQLite vía `better-sqlite3`** (síncrono, sin pool, sin ORM). DB en `data/prism.db`. Toda la DDL/CRUD vive en `src/services/store.js`. Migración automática desde JSON en `src/services/migrator.js` (corre una vez al primer arranque).
- **`ws`** para WebSockets (terminal, logs en vivo). **`node-pty`** para el terminal embebido.

## Frontend (`frontend/`)
- **React 19 + TypeScript + Tailwind CSS v4 + Vite**. Estado global con **Zustand**.
- Build output en `dist/` (gitignored). En producción el backend sirve `dist/` directamente; en dev se usa Vite (`:5173`) con proxy a `:3000`.

## Tests
- **Backend:** runner nativo `node:test`. `npm test` (TAP) o `npm run test:report` (resumen compacto — preferido).
- **Frontend:** **Vitest** + React Testing Library. `cd frontend && npm test`.

## Dependencias deliberadamente mínimas
Solo 3 deps de runtime backend: `better-sqlite3`, `node-pty`, `ws`. Se evita añadir librerías (ej: el zip de Folio se hizo a mano con `zlib`, no `jszip`; no hay librería de YAML). Mantener esa disciplina.
