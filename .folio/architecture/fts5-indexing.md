---
title: FTS5 Indexing
author: user
pinned: false
created: 2026-05-31
updated: 2026-06-01
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

## Ranking: title weighted 10× content

The FTS table indexes two columns, `title` and `content`. The search query
(`store.searchPages`) orders by `bm25(pages_fts, 10.0, 1.0)` — the title column
is weighted **10× the content**. This is deliberate, not a default: with equal
weights, a long page that merely *mentions* a term in its body outranks the
short page whose **title** is literally that term. Concrete failure it fixes:
typing `[[MCP` in the reference autocomplete buried the `mcp-tools/tools`
page ("MCP Tools") at rank 9 — the title weight moves it to rank 1.

bm25() returns negative scores (lower = better match); the heavier title weight
pushes title hits further negative, to the top. The slug is **not** indexed —
only `title` and `content` — so ranking leans on the title to surface a page by
its name. If you simplify the `bm25()` call back to no weights, you reintroduce
the buried-title bug. See `[[data-model/references]]` for the `[[ ]]` syntax the
autocomplete serves.

## Mental model

Files = truth. FTS5 = index (in `prism.db` if it's Prism, in memory/cache if it's the terminal).
