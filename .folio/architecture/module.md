---
title: Module and Extraction Strategy
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [arquitectura, modulo, extraccion]
---

## Strategy: start embedded, extract later

Folio starts as a self-contained module inside Prism and gets extracted into its own repo once it is stable. Prism will be the first consumer.

## Structure inside Prism

```
src/services/folio/
├── db.js          — SQLite schema + FTS5
├── store.js       — CRUD for folios, chapters, pages, attachments
└── resolver.js    — resolves [[slug]] and [[slug#section]] into plain text
mcp/
└── folio-tools.js — MCP tools, imported from mcp-server.js
```

## Isolation rules (so extraction is trivial)

1. `src/services/folio/` imports nothing outside its own directory (not the Kanban store, not the HTTP server).
2. It receives the storage backend injected, it does not create it (see [[architecture/storage-backend]]).
3. `folio-tools.js` is the module's only public interface.

## Future extraction

Copy `src/services/folio/` into a new repo, wrap it in an HTTP server + MCP server + CLI, and publish it as an npm package. Prism then imports it as a dependency instead of a local folder. Nothing gets rewritten.
