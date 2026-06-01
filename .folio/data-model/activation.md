---
title: Activation — opt-in and createIfMissing
author: user
pinned: true
created: 2026-05-31
updated: 2026-05-31
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

Agents only write to folios that already exist. Creation is ALWAYS a user gesture:
1. The "Activate Folio" toggle (UI client) — the primary mental model.
2. Writing the first page by hand.
3. Bootstrap from the repo (see [[flows/bootstrap]]).
4. Importing a .folio / markdown folder.

The clients (UI toggle, CLI, MCP) are interchangeable over the same store operation.

Folio exists = it has ≥1 page via an explicit path.
