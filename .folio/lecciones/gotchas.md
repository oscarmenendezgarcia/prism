---
title: Gotchas y trampas conocidas
author: agent
pinned: true
created: 2026-06-01
updated: 2026-06-01
tags: [lecciones, gotchas, ci]
---

Conocimiento difícil de re-descubrir leyendo el código. Evita repetir errores ya pagados.

## Tests
- **`node-pty` cuelga los tests en algunos entornos** — usar el mock, nunca importarlo directo en tests. El fallo de `terminal.test.js` (PTY exit/respawn) es **pre-existente y no relacionado** con casi ningún cambio; no perseguirlo como regresión.
- **Tests en background mueren** con la compactación de sesión. Siempre foreground.

## Server / build
- **`dist/` obsoleto** es la causa nº1 de "mi cambio de frontend no se ve" — el server sirve `dist/`, hay que `npm run build` tras tocar el frontend.
- **Rutas nuevas** en `routes/index.js` no existen hasta reiniciar el server.
- **No reiniciar el server con agentes corriendo** (pierden MCP).

## Datos
- Columnas JSON del schema (ej. `spaces.working_directory`, `pipeline`) se guardan **JSON-encoded**. Escribir un valor crudo por SQL directo rompe `listSpaces` al arrancar (`JSON.parse` peta).
- Hubo un bug en `PUT /api/v1/spaces/:id` que **borraba todas las tareas del space** al renombrar — verificar que cualquier cambio en `spaceManager.renameSpace` preserva las tareas.

## Pipeline
- Algunos runs del pipeline crean su **propia rama** `feature/<feature>-<task>` y commitean ahí (no en la rama base). Tras un run, revisar con `git reflog`/`git branch` y hacer `git merge --ff-only <rama>` para traer los commits.
- Los runs paralelos sobre el mismo working dir provisionan **worktrees** (`.worktrees/`, gitignored).
- El write-back de Folio corre como **epílogo tras completar el run** (no es un stage). Kill switch: `PRISM_FOLIO_WRITEBACK=off`.
