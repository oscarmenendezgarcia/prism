---
title: Differentiation vs Engram
author: user
pinned: false
created: 2026-05-31
updated: 2026-06-02T14:29:49.081Z
---

## Engram (Gentleman-Programming/engram)

A Go binary, agent-agnostic. SQLite + FTS5, 4 interfaces (CLI, HTTP, MCP, TUI), 19 MCP tools. Sync via Git (compressed chunks) + cloud replication (beta). Conflict detection (beta). As a standalone tool it is further along than Folio.

## Same foundation — so the storage is NOT the differentiator

The plumbing is identical: SQLite + FTS5 + MCP + git. Do NOT position Folio as "a better Engram memory" — head-to-head and standalone, Engram is ahead and the moat is thin. Folio wins on a different axis.

| | Engram | Folio |
|---|---|---|
| Who uses it | Agent only (private memory) | **User and agent as equals** — authored, reviewable |
| Form | Flat, auto-captured entries | **Folio → Chapter → Page** — a navigable, curated document (the index is the product) |
| Trust | Opaque agent memory | **Human-readable markdown** — git-diffable, PR-reviewable, editable in the UI |
| Scope | Global, everything mixed | **Per folio** — Oncall doesn't contaminate your novel |
| Domain | Built for code | **Any domain** — oncall, research, product, runbooks |
| References | — | `[[chapter/page]]` / `[[chapter/page#section]]` |
| Integration | Bolt-on tool | **Woven into the workflow** (Prism): stage-aware injection + write-back + UI |

## The moat is NOT the storage

Three real differentiators, none technical:
1. **Human + agent co-author curated, navigable knowledge.** Engram is the agent's private notebook (auto-captured, opaque). Folio is a shared wiki people read, write and review (markdown, PRs, an index, refs, a UI) — trustworthy and useful to humans, not just recalled by the agent.
2. **Embedded where the work happens.** In Prism: automatic stage-aware injection into the pipeline + agent write-back + a browsable UI. Engram can't replicate this without becoming Prism.
3. **Domain-agnostic.** Built neutral (oncall, research, PM, runbooks), not "agent coding memory".

## Positioning (corrected)

- **Prism + Folio — the bet:** the team's navigable, curated knowledge base (human + agent), embedded in the flow, for any domain. This is where Folio is differentiated and attractive.
- **Folio standalone (MCP / CLI / file) — a portability/extraction path, NOT the battlefield.** It proves the core isn't Prism-locked and lets the same knowledge travel, but head-to-head on agent memory the moat is thin — do not try to win there.

Decision: copy Engram's patterns, not the binary (Prism already has SQLite, FTS5, MCP). Win on **curation + navigability + product integration + domain breadth**, never on storage.
