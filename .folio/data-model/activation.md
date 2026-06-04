---
title: Activation — opt-in and createIfMissing
author: user
pinned: true
created: 2026-05-31
updated: 2026-06-02T11:23:44.943Z
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
4. **Repo bootstrap on activation** — triggered by **adding a working directory** to a repo-backed space (or the manual "Bootstrap from repo" button), NOT by the pipeline. Runs fire-and-forget in the background, materializes the folio (`createIfMissing:true`) with a few conservative architecture pages, and shows in the Runs panel. One-shot per space; opt out with `PRISM_FOLIO_BOOTSTRAP=off`. See [[flows/bootstrap]] and decision 17 in [[decisions/log]].

The user-gesture clients (UI toggle, CLI, MCP) are interchangeable over the same store operation.

**Net effect on opt-in:** strict for **non-repo** spaces (nothing auto-creates the folio — it accretes only if you activate it). For **repo-backed** spaces the folio auto-activates when you **add the working directory** (the discriminator is `detectRepo(workingDir)`) — an explicit gesture, not a side effect of running a pipeline. Earlier this fired at stage 0 of the first pipeline run; that hook was removed (decision 17) because it was surprising and invisible.

Folio exists = it has ≥1 page via one of those paths.
