---
title: FTS5 Indexing
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [fts5, busqueda, indice]
---

## FTS5 lives in the CORE, not in Prism

`better-sqlite3` already ships with FTS5 compiled in, so search is available in any context where the package runs. What changes between backends is not *whether FTS5 exists*, but *what the source of truth is*.

- **Prism**: SQLite is both the source of truth and the index. The FTS table lives in `prism.db`.
- **File-backend**: the markdown is the truth; the FTS index is **derived** from it.

## Building the standalone index

1. **In-memory per invocation (default)**: for folios with dozens of pages, building the FTS5 index in memory from the markdown takes milliseconds. No cache, no staleness bugs. This is the default option.
2. **Persistent cache** `.folio/cache.db` (gitignored): only for large folios. It is rebuilt when the markdown mtime is newer than the cache, or with `folio reindex`.

## Why SQLite FTS5 on both backends

If a JS BM25 library were used for the files and FTS5 for Prism, there would be **two rankings that diverge** — the same search would return different results depending on where it runs. With SQLite FTS5 on both, the ranking is identical everywhere. The `better-sqlite3` dependency is already there; nothing new is added.

## Mental model

Files = truth. FTS5 = index (in `prism.db` if it's Prism, in memory/cache if it's the terminal).
