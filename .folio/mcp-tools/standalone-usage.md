---
title: Standalone Usage (without Prism)
author: user
pinned: false
created: 2026-05-31
updated: 2026-06-01
tags: [standalone, cli, mcp, headless]
---

## Three interfaces, without Prism

### 1. CLI
```bash
folio init my-project
folio page set stack/runtime --file runtime.md
folio search "redis timeout"
folio get stack/runtime#tests
folio export ./out        # markdown folder
folio import ./out
```

### 2. MCP server (point any client at it: Claude Code, Cursor, Windsurf)
```bash
folio mcp                 # MCP server over stdio
```
The agent has `folio_search` / `folio_get_page` / `folio_create_page` against the local DB. This is exactly the Engram case: persistent memory without Prism.

#### Multi-folio — one server, any folio (no restart)

The MCP server is **not pinned to a single folio**. Every tool takes an optional
`folioRoot` and the server opens/caches a `FolioService` for that root per call,
so one running server serves any `.folio/` on disk — no re-register, no reconnect
to switch folios.

- **`folioRoot` omitted** → the server's startup directory (`process.cwd()`) is
  used as the default. This is the simple "cd into your repo" experience.
- **`folioRoot` = a directory** → the nearest `.folio/` is discovered by walking
  up from it (like `git` finding `.git`).
- **`folioRoot` = a `.folio` directory** → opened directly as the root.

```jsonc
// Work on a different project's folio in the same session:
folio_list({ folioRoot: "~/Documents/oncall" })
// → [{ id, name: "On-Call Postmortems", ... }]
folio_create_page({
  folioRoot: "~/Documents/oncall",
  folioId:   "<id from folio_list>",
  slug:      "2026/redis-outage",
  content:   "# Redis outage\n..."
})
```

Do **not** re-register the server with a different startup cwd per folio (editing
the client's MCP config) — that's fighting the symptom. Register it once; target
folios with `folioRoot`.

> Bulk authoring tip: to seed many pages at once, writing the `.md` files directly
> into the `.folio/` directory is valid and preferred over N `folio_create_page`
> calls — the file format *is* the file backend's interface. Use the MCP tools for
> incremental, in-session reads and writes.

### 3. HTTP API
```
POST /folios · POST /folios/:id/pages · GET /folios/:id/search?q=...
```

## Key difference: pull vs push

Automatic stage-aware injection is a feature of **Prism's pipeline runner**. Without Prism there is no pipeline → no automatic injection: the agent pulls from the tools **on demand** (pull-only). Prism adds the automatic push on top.

## [[ ]] autocomplete

Only in Prism's UI (an FTS-backed dropdown). In the CLI v1: NO autocomplete — `folio search <text>` returns the slugs and you copy them. Shell completion is phase 2.
