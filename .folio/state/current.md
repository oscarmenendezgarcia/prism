---
title: Current State
author: agent
pinned: true
created: 2026-05-31
updated: 2026-05-31
tags: [estado]
---

## Where we are

**Design locked.** Ready to implement. This folio (`.folio/` at the root of the Prism repo) is at once the design documentation and the fixture for testing the file-backed implementation.

## Tasks on the Prism board (the "Folio" space), ordered by dependencies

1. Folio module — pluggable backend + indexing (scaffolding) — chore
2. Data model — Folio, Chapter, Page — feature
3. MCP tools — CRUD for Pages and Chapters — feature
4. [[]] references in prompts — feature
5. UI — navigable index of Chapters and Pages — feature
6. Prism integration — stage-aware injection — feature
7. Export / Import — markdown + .folio wrapper — feature
8. Agent write-back — consolidation at the end of the pipeline — feature
9. Conservative Folio bootstrap from the repo — feature

Implementation order: 1 → 2 → 3 → (4, 5 in parallel) → 6 → the rest.

## Open points

- ✅ Injection framing (confidence tiers)
- ✅ CLI autocomplete: NOTHING in v1
- ⏸️ Write-back concurrency (deferred)
- ⏸️ Format versioning (deferred)

## Do not touch / constraints

- The core must NOT import anything outside `src/services/folio/` nor know about `space_id` (only `folio_id`).
- Do not use BM25-JS: SQLite FTS5 on both backends.
