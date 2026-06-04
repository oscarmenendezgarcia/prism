---
title: Injection by Confidence Tiers
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [inyeccion, inline, referencia]
---

## The principle: inline what's certain, name what's doubtful, let the agent pull the rest

Injecting all content inline wastes tokens on pages the agent ignores. Injecting only slugs (reference-only) for everything risks a lazy agent NOT looking them up and re-discovering from scratch — killing the value prop. The solution is by confidence tier.

## Three tiers

```
Inline (full content):
  - Constraints (always) — guardrails like "don't touch module X"
  - Top BM25 matches above a score THRESHOLD
  → what the agent definitely needs, guaranteed present

Reference (slug only):
  - The index (layer 1, always) already lists EVERYTHING = a free list of refs
  - + a "relevant: [slug, slug]" hint from the tier just below the threshold

On demand:
  - The agent calls folio_get_page from the queue whenever it wants
```

## Threshold by SCORE, not by rank

A page that scores very high goes inline (the agent needs it); a marginal one is only named. This solves the cold start on its own: few pages = everything small = inline; many = inline the strong ones + reference the rest.

## The index IS the free reference list

Layer 1 (the index with every slug) already tells the agent what exists and what it can request. The reference-only tier comes for free, with no extra work.
