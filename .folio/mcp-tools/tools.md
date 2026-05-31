---
title: MCP tools
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [mcp, tools, api]
---

## Superficie mínima (vs los 19 de Engram)

No hay gestión de sesiones ni conflict detection en v1.

### Lectura
- `folio_search(query, folioId)` — FTS5/BM25, devuelve pages relevantes.
- `folio_get_page(slug, folioId)` — page completa por slug.
- `folio_get_page(slug#section, folioId)` — solo el bloque H2 indicado.
- `folio_list_chapters(folioId)` — índice del folio.
- `folio_list_attachments(slug)` — lista adjuntos de una page.
- `folio_get_attachment(slug, nombre)` — devuelve blob de adjunto.

### Escritura
- `folio_create_page(slug, título, contenido, folioId)`
- `folio_update_page(slug, contenido, folioId)`

### Gestión de folios
- `folio_list()` — lista todos los folios.
- `folio_create(nombre)` — nuevo folio.

## Notas

- Los chapters se crean implícitamente al crear una page con un chapter_slug nuevo (no hay `create_chapter` explícito).
- Las escrituras de agente pasan `createIfMissing: false` (ver [[modelo-datos/activacion]]).
- Todo write de agente queda con `author='agent'`.
