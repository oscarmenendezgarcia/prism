---
title: Uso sin Prism
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [standalone, cli, mcp, headless]
---

## Tres interfaces, sin Prism

### 1. CLI
```bash
folio init mi-proyecto
folio page set stack/runtime --file runtime.md
folio search "redis timeout"
folio get stack/runtime#tests
folio export ./out        # carpeta markdown
folio import ./out
```

### 2. MCP server (apuntas cualquier cliente: Claude Code, Cursor, Windsurf)
```bash
folio mcp                 # MCP server por stdio
```
El agente tiene `folio_search` / `folio_get_page` / `folio_create_page` contra la DB local. Es exactamente el caso de Engram: memoria persistente sin Prism.

### 3. HTTP API
```
POST /folios · POST /folios/:id/pages · GET /folios/:id/search?q=...
```

## Diferencia clave: pull vs push

La inyección automática stage-aware es una feature del **pipeline runner de Prism**. Sin Prism no hay pipeline → no hay inyección automática: el agente tira de las tools **on demand** (pull-only). Prism añade el push automático encima.

## Autocompletado [[ ]]

Solo en la UI de Prism (dropdown con FTS). En CLI v1: NADA de autocompletado — `folio search <texto>` devuelve los slugs y los copias. Shell completion es fase 2.
