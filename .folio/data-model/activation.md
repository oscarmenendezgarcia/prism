---
title: Activation — opt-in and createIfMissing
author: user
pinned: true
created: 2026-05-31
updated: 2026-06-01
tags: [opt-in, activacion, store]
---

## Folio is opt-in and lazy

A space has **0 or 1 folio**. It is NOT created when the space is created. It is materialized through an explicit path. If no one uses it, it does not exist → reads return empty (not an error), and injection costs nothing.

## Activation lives in the STORE, not the UI

Coupling activation to a UI toggle would break headless usage (CLI, MCP). Opt-in is guaranteed with a flag on the write:

```
createPage(slug, content, { createIfMissing })
```

- **Explicit paths** (a manual user page, bootstrap, import) → `createIfMissing: true` → materialize the folio.
- **Agent write-back** during the pipeline → `createIfMissing: false` → a no-op if there is no folio.

That way "agents don't create the folio through the back door" is a property of the store, not the frontend. It works identically from the UI, CLI, MCP, or a headless test.

## Chicken and egg, solved

Agent **write-back** only touches folios that already exist (`createIfMissing:false` — a no-op otherwise). Creation happens through one of these explicit paths:
1. The "Activate Folio" toggle (UI client) — the primary mental model.
2. Writing the first page by hand.
3. Importing a .folio / markdown folder.
4. **Automatic repo bootstrap** — the one path that is NOT a user gesture. The first time a pipeline runs in a space whose working dir is a git repo, the bootstrapper agent materializes the folio (`createIfMissing:true`) with a few conservative architecture pages. One-shot per space; opt out with `PRISM_FOLIO_BOOTSTRAP=off`. See [[flows/bootstrap]].

The user-gesture clients (UI toggle, CLI, MCP) are interchangeable over the same store operation.

**Net effect on opt-in:** strict for **non-repo** spaces (nothing auto-creates the folio — it accretes only if you activate it), but **relaxed for repo-backed spaces**, where the bootstrap auto-activates on the first pipeline run. The discriminator is `detectRepo(workingDir)`. This is a deliberate evolution from the original "no back-door creation" stance, kept honest here so the rule isn't re-derived wrongly.

Folio exists = it has ≥1 page via one of those paths.
