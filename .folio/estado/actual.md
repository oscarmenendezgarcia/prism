---
title: Estado actual
author: agent
pinned: true
created: 2026-05-31
updated: 2026-05-31
tags: [estado]
---

## Dónde estamos

**Diseño cerrado.** Listo para implementar. Este folio (`.folio/` en la raíz del repo de Prism) es a la vez la documentación del diseño y el fixture para probar la implementación file-backed.

## Tareas en el tablero Prism (espacio "Folio"), orden por dependencias

1. Módulo Folio — backend pluggable + indexación (scaffolding) — chore
2. Modelo de datos — Folio, Chapter, Page — feature
3. MCP tools — CRUD de Pages y Chapters — feature
4. Referencias [[]] en prompts — feature
5. UI — Índice navegable de Chapters y Pages — feature
6. Integración Prism — inyección stage-aware — feature
7. Export / Import — markdown + wrapper .folio — feature
8. Write-back de agentes — consolidación al final del pipeline — feature
9. Bootstrap conservador del Folio desde el repo — feature

Orden de implementación: 1 → 2 → 3 → (4, 5 en paralelo) → 6 → resto.

## Puntos abiertos

- ✅ Framing de inyección (niveles de confianza)
- ✅ Autocompletado CLI: NADA en v1
- ⏸️ Concurrencia write-back (diferible)
- ⏸️ Versionado del formato (diferible)

## No tocar / restricciones

- El core NO debe importar nada fuera de `src/services/folio/` ni conocer `space_id` (solo `folio_id`).
- No usar BM25-JS: SQLite FTS5 en ambos backends.
