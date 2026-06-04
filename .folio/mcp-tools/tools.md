---
title: MCP Tools
author: user
pinned: false
created: 2026-05-31
updated: 2026-06-04T08:12:53.543Z
---

## Minimal surface

There is no session management or conflict detection in v1.

### Reading
- `folio_search(query, folioId)` — FTS5/BM25, returns relevant pages.
- `folio_get_page(slug, folioId)` — the full page by slug.
- `folio_get_page(slug#section, folioId)` — only the indicated H2 block.
- `folio_list_chapters(folioId)` — the folio's index.
- `folio_list_attachments(slug)` — lists a page's attachments.
- `folio_get_attachment(slug, name)` — returns an attachment blob.

### Writing
- `folio_create_page(slug, title, content, folioId)`
- `folio_update_page(slug, content, folioId)`

### Folio management
- `folio_list()` — lists all folios.
- `folio_create(name)` — a new folio.

## Notes

- Chapters are created implicitly when a page is created with a new chapter_slug (there is no explicit `create_chapter`).
- Agent writes pass `createIfMissing: false` (see [[data-model/activation]]).
- Every agent write is recorded with `author='agent'`.
