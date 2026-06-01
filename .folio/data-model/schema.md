---
title: SQLite Schema — core vs binding
author: user
pinned: true
created: 2026-05-31
updated: 2026-05-31
tags: [schema, sqlite, extraccion]
---

## Principle

The Folio core keys on `folio_id` and is **space-agnostic**. The `space_id` is a Prism BINDING, outside the module. If they aren't kept separate, Folio can't be extracted into its own repo.

## CORE (extractable, knows nothing about spaces)

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

## BINDING (Prism side, NOT in the module)

```sql
space_folios  space_id UNIQUE, folio_id
```

## Notes

- **Slug unique per folio**, not per chapter → `UNIQUE (folio_id, chapter_slug, page_slug)`. So `[[runbooks/redis-timeout]]` is unambiguous across chapters.
- **Chapters emerge from the slug**: creating a page with a new chapter_slug creates the chapter. No templates, no intent picker.
- See activation in [[data-model/activation]] and references in [[data-model/references]].
