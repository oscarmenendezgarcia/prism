---
title: Convenciones de código
author: agent
pinned: true
created: 2026-06-01
updated: 2026-06-01
tags: [convenciones, git, lint]
---

## SQL / datos
- **Sin ORM** — SQL directo con `better-sqlite3`. Toda modificación de schema va en `src/services/store.js` (DDL idempotente, `ALTER TABLE` explícito para migrar). Motivo: las migraciones automáticas de ORMs en SQLite rompieron columnas en el pasado.
- Las columnas JSON del schema se serializan con `toJson`/`fromJson` (JSON.stringify/parse). **No escribir valores crudos en columnas JSON** (ej: `working_directory` se guarda JSON-encoded — escribir el string pelado rompe el arranque).

## Git
- Formato de commit por stage del pipeline: `[architect]`, `[ux]`, `[dev] T-XXX:`, `[review]`, `[qa]`, `[fix] BUG-XXX:`.
- **Nunca `git add -A` ni `git add .`** — stagear solo ficheros relevantes a la tarea.
- `agent-docs/` está en `.gitignore` — nunca commitear ahí. `dist/` y `*.db` también gitignored.

## Tests
- Backend con `node:test` (no Jest). Usar `npm run test:report` para output compacto.
- **Nunca correr tests en background** — la compactación de sesión mata el proceso a media ejecución. Siempre foreground.

## Frontend lint
- **Tailwind only, sin `style={{}}` inline** — el lint del build lo bloquea. Si es inevitable (ej: inyectar una CSS var runtime como `--panel-w`), añadir `// lint-ok: <razón>` al final de la línea.
