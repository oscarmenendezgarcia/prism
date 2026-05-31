---
title: Schema SQLite — core vs binding
author: user
pinned: true
created: 2026-05-31
updated: 2026-05-31
tags: [schema, sqlite, extraccion]
---

## Principio

El core de Folio keyea por `folio_id` y es **space-agnostic**. El `space_id` es un BINDING de Prism, fuera del módulo. Si no se separa, no se podrá extraer Folio a su propio repo.

## CORE (extraíble, no sabe de spaces)

```sql
folios       id, name, created_at
chapters     id, folio_id, title, slug, position, created_at
pages        id, chapter_id, title, slug, content (markdown),
             author ('user'|'agent'), pinned BOOLEAN DEFAULT 0,
             created_at, updated_at
             UNIQUE (folio_id, chapter_slug, page_slug)
pages_fts    -- FTS5 virtual table, BM25 ranking
             rowid → pages.id, title, content
attachments  id, page_id, name, mime_type, data (BLOB), created_at
```

## BINDING (lado Prism, NO en el módulo)

```sql
space_folios  space_id UNIQUE, folio_id
```

## Notas

- **Slug único por folio**, no por chapter → `UNIQUE (folio_id, chapter_slug, page_slug)`. Así `[[runbooks/redis-timeout]]` no tiene ambigüedad entre chapters.
- **Chapters emergen del slug**: crear una page con un chapter_slug nuevo crea el chapter. Sin templates, sin intent picker.
- Ver activación en [[modelo-datos/activacion]] y referencias en [[modelo-datos/referencias]].
