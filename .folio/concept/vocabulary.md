---
title: Vocabulary — Folio, Chapter, Page
author: user
pinned: true
created: 2026-05-31
updated: 2026-05-31
tags: [naming, modelo]
---

## The hierarchy

```
Folio (the notebook / the knowledge base for a domain)
└── Chapter (the section)
    └── Page (the unit of knowledge)
        └── Attachment (optional blobs)
```

## Why these names

The product is called Folio. A folio is **the notebook**, not the sheet — that is why Folio names the container, not the entry. The internal hierarchy has to stay coherent with that book metaphor:

- **Folio** > Entry sounded odd (a folio is a sheet, not a whole book).
- **Chapter / Page** are coherent with "notebook," anyone understands them without technical context, and they work just as well for Oncall as for a novel.

The MCP tools stay readable: `folio_get_page`, `folio_search`, `folio_list_chapters`.

## The product in one sentence

Folio is the notebook shared between you and your agent. Tagline: *"What your agent needs to remember."*
