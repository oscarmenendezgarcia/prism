---
title: Stage-Aware Injection
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [inyeccion, pipeline, relevancia]
---

## Relevance is PER STAGE, not per task

The UX stage doesn't need architecture; the architect doesn't need UI conventions. Injecting the same block into every stage is noise.

## The trick: put the stage's role into the query

The BM25 query = **the task description + a short descriptor of the stage**. So:
- The architect (a prompt about architecture) → BM25 pulls architecture/decisions pages for it.
- The UX stage (a prompt about design) → it pulls UI conventions.

With no `stage → chapters` table to maintain.

## Why NOT a stage→chapters table

1. **It breaks the generic thesis**: a table with dev chapters (architecture, decisions) means nothing in an Oncall folio or a novel.
2. **It couples the engine to Prism's stage names** (`ux-api-designer`, etc.) — exactly what an extractable module can't know.
3. **It rots**: a new chapter wouldn't be in any list and would never get injected, silently.

Relevance keyed-on-query picks it all up on its own, in any domain, with no config.

## Risk: cold start

With few pages, BM25 is noisy and a task title might not match lexically. This is covered by the index (always present) + the fact that the agent can fall back on `folio_search`. The cap bounds any bad match. See [[injection/confidence-tiers]].
