---
title: Differentiation vs Engram
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [competencia, engram, posicionamiento]
---

## Engram (Gentleman-Programming/engram)

A Go binary, agent-agnostic. SQLite + FTS5, 4 interfaces (CLI, HTTP, MCP, TUI), 19 MCP tools. Sync via Git (compressed chunks) + cloud replication (beta). Conflict detection (beta).

## Folio shares the technical foundation but differs in philosophy

| | Engram | Folio |
|---|---|---|
| Scope | Global, everything mixed together | Per folio — Oncall doesn't contaminate your novel |
| Structure | Flat entries | Folio → Chapter → Page (the index is the product) |
| User | Agent only | User and agent collaborate as equals |
| UI | Terminal UI | Navigable index (in Prism) |
| Domain | Built for code | Neutral, any domain |
| References | — | [[chapter/page]] and [[chapter/page#section]] |

## The conclusion

Same insight (SQLite + FTS5 for agent memory), different bet: Engram is a tool FOR agents; Folio is a product for the USER who works with agents. The two key differences in v1: **scope per folio** + **reference granularity**.

Decision: copy Engram's patterns, not the binary. Prism already has its own SQLite, FTS5, and MCP server.

## Positioning

- **Folio standalone** = agent-agnostic memory via MCP → competes with Engram.
- **Prism** = a batteries-included host that adds automatic injection + UI + pipeline write-back.
