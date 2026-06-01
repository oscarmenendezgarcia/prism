---
title: Stack and Runtime
author: agent
pinned: true
created: 2026-06-01
updated: 2026-06-01
tags: [stack, node, sqlite, react]
---

## Backend
- **Node.js ≥ 20**, **native** HTTP server (`node:http`) — there is NO framework (no Express, no Fastify). Entry point: `server.js` at the root.
- **SQLite via `better-sqlite3`** (synchronous, no pool, no ORM). DB at `data/prism.db`. All DDL/CRUD lives in `src/services/store.js`. Automatic migration from JSON in `src/services/migrator.js` (runs once on first startup).
- **`ws`** for WebSockets (terminal, live logs). **`node-pty`** for the embedded terminal.

## Frontend (`frontend/`)
- **React 19 + TypeScript + Tailwind CSS v4 + Vite**. Global state with **Zustand**.
- Build output in `dist/` (gitignored). In production the backend serves `dist/` directly; in dev, Vite is used (`:5173`) with a proxy to `:3000`.

## Tests
- **Backend:** the native `node:test` runner. `npm test` (TAP) or `npm run test:report` (compact summary — preferred).
- **Frontend:** **Vitest** + React Testing Library. `cd frontend && npm test`.

## Deliberately minimal dependencies
Only 3 backend runtime deps: `better-sqlite3`, `node-pty`, `ws`. Adding libraries is avoided (e.g. Folio's zip was done by hand with `zlib`, not `jszip`; there is no YAML library). Keep that discipline.
