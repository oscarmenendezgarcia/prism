---
title: Design Decisions Log and Trade-offs
author: user
pinned: false
created: 2026-05-31T00:00:00.000Z
updated: 2026-05-31T00:00:00.000Z
tags: [decisions, trade-offs]
---

## Decisions

Closed design decisions and the trade-offs behind each one.

- The core keys on a folio id, not a space id — the decision that makes
  extraction possible.
- Opt-in activation, lazy by default.
- Stage-aware injection by relevance, not a fixed table.

Each decision records the architecture trade-off it resolves so future work
does not re-litigate it.
