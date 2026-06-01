---
title: Token Budget
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [inyeccion, tokens, presupuesto]
---

## Count real tokens, don't estimate them

The budget is fiction until it's measured. Truncate by the real count.

## Layers and cost

- Layer 1 — Index: always, ~200 tokens (chapter titles + page counts).
- Layer 2 — Inline by relevance: HARD CAP of ~3 inline pages / ~1500 tokens, whichever comes first.
- Pinned = **a ranking boost**, NOT unconditional injection. If a pinned page is irrelevant to this stage, it falls below the cap and does not appear.
- Constraints = the only always-on class, kept minimal.

## Dedup

Subtract what's already injected so a page isn't repeated (e.g. a page boosted by pinning that also shows up in the BM25 top-K).

## Truncation

When truncating a page, leave a marker:

```
[truncated — [[chapter/slug]] available via folio_get_page]
```

That way the agent knows there is more and can request it.

## Configurable

The budget is configurable per space. Zero cost if the space has no folio.
