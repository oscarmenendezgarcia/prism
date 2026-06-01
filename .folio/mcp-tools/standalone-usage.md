---
title: Standalone Usage (without Prism)
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
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

### 3. HTTP API
```
POST /folios · POST /folios/:id/pages · GET /folios/:id/search?q=...
```

## Key difference: pull vs push

Automatic stage-aware injection is a feature of **Prism's pipeline runner**. Without Prism there is no pipeline → no automatic injection: the agent pulls from the tools **on demand** (pull-only). Prism adds the automatic push on top.

## [[ ]] autocomplete

Only in Prism's UI (an FTS-backed dropdown). In the CLI v1: NO autocomplete — `folio search <text>` returns the slugs and you copy them. Shell completion is phase 2.
