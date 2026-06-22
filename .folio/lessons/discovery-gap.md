---
title: Folio Discovery Gap (no global registry)
author: agent
pinned: false
created: 2026-06-04T10:14:55.844Z
updated: 2026-06-04T10:14:55.844Z
---

## The problem: you can't enumerate folios that exist on disk

`folio_list` always returns **exactly one** folio — the one resolved from
`folioRoot` (nearest-ancestor `.folio/`), or the server's startup cwd when
`folioRoot` is omitted. There is no "list every folio that exists." See
[[mcp-tools/standalone-usage]] for the resolution rules this builds on.

Consequence: **if you don't already know a standalone folio's path, the MCP
cannot help you find it.** Hit live (2026-06-04) looking for a personal
`glucosa` folio:

- `folio_list()` (no root) → returned only `Prism` (the startup folio). The
  glucosa folio was invisible despite existing at `~/Documents/glucosa/.folio`.
- The path had to come from the human ("it's in documentos/glucosa").

Standalone **reads** are fine once you know the root; **discovery** is the gap.
This bites any setup with several loose folios under `~/Documents/` (oncall,
glucosa, …) and no single repo to `cd` into.

## Gotcha next to it: don't trust a wrapped `find`

A plain `find ~ -type d -name .folio` *does* locate every folio. In this session
it appeared to fail (`0 for '.folio'`) — but that was the **rtk command proxy**
mangling the output, not `find` and not folio. Bypassing the wrapper
(`/usr/bin/find "$HOME/Documents" -type d -name .folio`) returned both folios
correctly. If a discovery `find` comes back empty, re-run it unwrapped before
concluding the folio doesn't exist.

## How to solve it

### Today, no code change (workaround)
1. **Keep an external name → path → id index** of your folios (a notes file, or
   agent memory). Then pass `folioRoot` explicitly. This is already the de-facto
   pattern for the oncall folio.
2. **To find one on disk**, use a real (unwrapped) find:
   ```bash
   find ~ -type d -name .folio -not -path '*/node_modules/*' 2>/dev/null
   ```

### Product fix (proposed) — give Folio a discovery primitive
Two complementary options; the registry is the primary recommendation:

1. **Persistent registry (recommended).** On `folio_create` (and on first open of
   any `.folio/`), append `{ id, name, path }` to a user-level registry
   (`$XDG_CONFIG_HOME/folio/registry.json`, fallback `~/.config/folio/`).
   `folio_list` with **no** `folioRoot` then returns the union of registered
   folios instead of just the startup one. O(1), survives "where did I put it,"
   and is the natural "list all my folios."
   - Prune stale entries lazily: drop any whose `path/.folio` no longer exists.

2. **`folio_list({ searchRoot })` walk-DOWN.** Complement the existing walk-UP
   resolution: given a root, enumerate every `.folio/` *under* it and return
   `[{ id, name, path }]`. Good for "scan this directory tree," but bounded to
   `searchRoot` and costlier than the registry, so it's a secondary tool, not the
   default.

Either keeps the "one `.folio/` = one folio, nearest-ancestor wins" model intact
([[mcp-tools/standalone-usage]]); they only add a way to *learn which folios
exist* before you target one with `folioRoot`.
