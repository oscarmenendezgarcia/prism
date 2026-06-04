---
title: Gotchas and Known Traps
author: agent
pinned: true
created: 2026-06-01
updated: 2026-06-01
tags: [lecciones, gotchas, ci]
---

Knowledge that's hard to re-discover by reading the code. Avoids repeating mistakes already paid for.

## Tests
- **`node-pty` hangs the tests in some environments** — use the mock, never import it directly in tests. The `terminal.test.js` failure (PTY exit/respawn) is **pre-existing and unrelated** to nearly any change; don't chase it as a regression.
- **Background tests die** with session compaction. Always foreground.

## Server / build
- **A stale `dist/`** is the #1 cause of "my frontend change isn't showing up" — the server serves `dist/`, so you have to `npm run build` after touching the frontend.
- **New routes** in `routes/index.js` don't exist until the server is restarted.
- **Don't restart the server with agents running** (they lose MCP).

## Data
- The schema's JSON columns (e.g. `spaces.working_directory`, `pipeline`) are stored **JSON-encoded**. Writing a raw value via direct SQL breaks `listSpaces` at startup (`JSON.parse` blows up).
- There was a bug in `PUT /api/v1/spaces/:id` that **deleted all of the space's tasks** on rename — verify that any change to `spaceManager.renameSpace` preserves the tasks.

## Pipeline
- Some pipeline runs create their **own branch** `feature/<feature>-<task>` and commit there (not on the base branch). After a run, check with `git reflog`/`git branch` and run `git merge --ff-only <branch>` to bring the commits in.
- Parallel runs over the same working dir provision **worktrees** (`.worktrees/`, gitignored).
- Folio write-back runs as an **epilogue after the run completes** (it is not a stage). Kill switch: `PRISM_FOLIO_WRITEBACK=off`.

## File backend identity
- **The file-backend folioId MUST be stable across hydrations.** `openFileBackend` rebuilds the in-memory index from markdown on every open, and the standalone MCP resolver re-hydrates whenever a `.md` mtime advances — which every `create_page` does. If hydration minted a fresh `crypto.randomUUID()` each time (the original bug), the folioId returned to a client went stale on the very next call → `folio_create_page`'s `getFolio()` guard failed with **"Folio not active"**, and `folio_list` churned a new id every call. The id is now derived deterministically from the `.folio/` root path (`folioIdForRoot`), with a persisted `folio.json` `id` taking precedence. **Don't reintroduce a random id in `hydrateFromMarkdown`.** See decision 18 and [[architecture/storage-backend]].
- **`folio_create` on the file backend writes `folio.json`** (id + chosen name) and is idempotent/single-folio — it renames the directory's one folio rather than inserting a second. An empty `.folio/` still hydrates exactly one folio (named after the dir) before any create. Bulk authoring by writing `.md` files directly into `.folio/` is still valid and preferred over N `create_page` calls.
