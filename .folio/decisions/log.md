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

17. **Bootstrap is activation-triggered, NOT a pipeline step.** The stage-0 pipeline hook was removed. Bootstrap now fires when a working directory is added to a repo-backed space, or via a manual "Bootstrap from repo" button in the Folio empty state — both fire-and-forget in the background (`triggerBackgroundBootstrap`) and recorded in the Runs panel ('Folio Bootstrapper'). Why: a bootstrap isn't a pipeline stage; tying it to the first run was surprising (auto-activation on run) and invisible (no run record). The explicit "you added a repo → it reads the repo" trigger matches the activation mental model and makes the folio ready before *any* pipeline. The pipeline now only consolidates at the end. See [[flows/bootstrap]].

16. **`busy_timeout` + transient-aware bootstrap one-shot.** A bootstrap once wrote 0 pages because `createPage` hit `SQLITE_BUSY` (WAL serialises writers; the HTTP server and the bootstrap apply collided) — and `ensureBootstrapped` marked `bootstrapped_at` anyway, permanently blocking retry. Two fixes: (a) `PRAGMA busy_timeout = 5000` on the connection so writers wait instead of throwing (root cause, helps all writes); (b) `applyBootstrapPages` now returns `{ written, transientErrors }` and the one-shot mark is skipped only when `written===0 && transientErrors>0` — a transient failure retries next run, while a permanent error or a legitimately empty result still marks (no infinite re-bootstrap loop). Only `SQLITE_BUSY`/`SQLITE_LOCKED` count as transient. See [[flows/bootstrap]].

18. **File-backend folio identity is stable, derived from the root path + persisted in `folio.json`.** The file backend rebuilds its in-memory SQLite index from markdown on every open, and `hydrateFromMarkdown` used to mint a fresh `crypto.randomUUID()` each time. The standalone MCP server (`makeResolver`) re-hydrates a cached service whenever a `.md` mtime advances — and **every `create_page` writes a `.md`**, so the next tool call re-hydrated with a *new* id. The folioId handed back to the client (from `folio_create`/`folio_list`) was therefore invalid by the next call: `folio_create_page`'s `getFolio()` guard returned null → **"Folio not active"**, and `folio_list` churned a different UUID each invocation. Standalone MCP was effectively unusable for multi-page authoring (Engram case). Fix: derive the id deterministically from the canonical `.folio/` root path (`folioIdForRoot`, a sha1-of-path UUID), with a persisted `folio.json` `id` taking precedence; `createFolio` on the file backend now materialises `folio.json` (id + chosen name), is idempotent and single-folio. SQLite path unchanged (still random UUID, identity owned by `space_folios`). Discovered while using the standalone MCP to author a meetings folio. See [[architecture/storage-backend]] and the "File backend identity" gotchas.

## Deferrable

- Per-folio `language` field (decision 15) — add when a UI sets it and a non-English folio actually exists.

- Write-back concurrency (last-write-wins in v1).
- Versioning of the `.folio` format (importing a different version).
- Shell completion in the CLI.
