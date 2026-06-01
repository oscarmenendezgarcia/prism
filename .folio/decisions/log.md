---
title: Design Decision Log
author: user
pinned: false
created: 2026-05-31
updated: 2026-06-01
tags: [decisiones, historia]
---

## Closed decisions and why

1. **Folio embedded in Prism first, extractable later.** Validates the data model and UX without infra overhead. Prism = the first consumer.

2. **A separate repo in the future, not a dependency on Engram.** The stack already exists in Prism (SQLite, FTS5, MCP). Copy Engram's patterns, not the binary.

3. **Backend only in v1.** No frontend of its own; Prism provides the UI. Folio = HTTP + MCP + CLI.

4. **Folio → Chapter → Page naming.** Folio = notebook, not sheet. See [[concept/vocabulary]].

5. **No templates or intent picker.** Structure emerges from the slug. The complexity wasn't worth it.

6. **Opt-in / lazy.** A space doesn't have to use a folio. Activation in the store, not the UI.

7. **The core keys on folio_id; space_id is a Prism binding.** Key to extraction.

8. **Stage-aware injection (relevance keyed-on-query), not a stage→chapters table.** Avoids coupling the engine and rotting.

9. **Injection by confidence tiers** (inline / reference / on-demand), threshold by score.

10. **Pinned = boost, not unconditional injection.** An "always" pin had the same rigidity as templates.

11. **Write-back: only if the folio exists + a single consolidation at the end, conservative.**

12. **Export = a markdown folder (git = sync); .folio = a transparent zip.**

13. **FTS5 in the core, in-memory by default + an optional cache.** SQLite FTS5 on both backends (not BM25-JS, which would diverge).

14. **Backend per space.** SQLite as the universal default; file-backend (`.folio/` in the working dir, git-versioned) opt-in and only if the space has a working_directory. No repo → SQLite always. See [[architecture/storage-backend]].

15. **Agent-written pages are English by default — NO per-folio language field (yet).** The bootstrapper had Spanish slugs hardcoded (`arquitectura/stack`…) so it wrote Spanish while the consolidator followed the task language (English) → mixed-language folios. Fix: both agents write English. The bootstrap's `allowedSlugs` is a fixed English allow-list — `architecture/stack`, `architecture/structure`, `architecture/request-flow` — and the consolidator prompt pins English. A per-folio `language` column was designed (it belongs on the folio, not the space, so it travels on extraction) but **rejected for now as YAGNI**: it stays inert until there's a UI to set it and a real non-English folio. The idempotent `ALTER TABLE folios ADD COLUMN language` can add it the day a consumer exists. See [[flows/bootstrap]] and [[flows/write-back]].

## Deferrable

- Per-folio `language` field (decision 15) — add when a UI sets it and a non-English folio actually exists.

- Write-back concurrency (last-write-wins in v1).
- Versioning of the `.folio` format (importing a different version).
- Shell completion in the CLI.
