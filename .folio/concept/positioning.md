---
title: Positioning & Differentiation
author: agent
pinned: false
created: 2026-06-04T08:17:25.395Z
updated: 2026-06-04T08:17:25.395Z
---

## Storage is not the differentiator

Folio shares its plumbing with most agent-memory tools: SQLite + FTS5 + MCP + git. So **do not position Folio as "a better agent memory store"** — on that axis a dedicated memory tool is at best even and the moat is thin. Folio wins on a different axis.

## The moat is NOT the storage

| | Typical agent-memory tool | Folio |
|---|---|---|
| Who uses it | Agent only (private memory) | **User and agent as equals** — authored, reviewable |
| Form | Flat, auto-captured entries | **Folio → Chapter → Page** — a navigable, curated document (the index is the product) |
| Trust | Opaque agent memory | **Human-readable markdown** — git-diffable, PR-reviewable, editable in the UI |
| Scope | Global, everything mixed | **Per folio** — Oncall doesn't contaminate your novel |
| Domain | Built for code | **Any domain** — oncall, research, product, runbooks |
| References | — | `[[chapter/page]]` / `[[chapter/page#section]]` |
| Integration | Bolt-on tool | **Woven into the workflow** (Prism): stage-aware injection + write-back + UI |

Three real differentiators, none technical:
1. **Human + agent co-author curated, navigable knowledge.** A private agent notebook is auto-captured and opaque. Folio is a shared wiki people read, write and review (markdown, PRs, an index, refs, a UI) — trustworthy and useful to humans, not just recalled by the agent.
2. **Embedded where the work happens.** In Prism: automatic stage-aware injection into the pipeline + agent write-back + a browsable UI. A bolt-on memory tool can't replicate this without becoming Prism.
3. **Domain-agnostic.** Built neutral (oncall, research, PM, runbooks), not "agent coding memory".

## Positioning

- **Prism + Folio — the bet:** the team's navigable, curated knowledge base (human + agent), embedded in the flow, for any domain. This is where Folio is differentiated and attractive.
- **Folio standalone (MCP / CLI / file) — a portability/extraction path, NOT the battlefield.** It proves the core isn't Prism-locked and lets the same knowledge travel, but head-to-head on raw agent memory the moat is thin — do not try to win there.

Decision: reuse the standard patterns (Prism already has SQLite, FTS5, MCP); don't take a dependency on a third-party binary. Win on **curation + navigability + product integration + domain breadth**, never on storage.
