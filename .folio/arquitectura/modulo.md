---
title: Módulo y estrategia de extracción
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [arquitectura, modulo, extraccion]
---

## Estrategia: empezar embebido, extraer después

Folio arranca como módulo autocontenido dentro de Prism y se extrae a repo propio cuando esté estable. Prism será el primer consumidor.

## Estructura dentro de Prism

```
src/services/folio/
├── db.js          — schema SQLite + FTS5
├── store.js       — CRUD de folios, chapters, pages, adjuntos
└── resolver.js    — resuelve [[slug]] y [[slug#section]] en texto plano
mcp/
└── folio-tools.js — herramientas MCP, importadas desde mcp-server.js
```

## Reglas de aislamiento (para que la extracción sea trivial)

1. `src/services/folio/` no importa nada fuera de su propio directorio (ni el store del Kanban, ni el HTTP server).
2. Recibe el storage backend inyectado, no lo crea (ver [[arquitectura/storage-backend]]).
3. `folio-tools.js` es la única interfaz pública del módulo.

## Extracción futura

Copiar `src/services/folio/` a un repo nuevo, envolver en servidor HTTP + MCP server + CLI, publicar como paquete npm. Prism pasa a importarlo como dependencia en vez de carpeta local. Sin reescribir nada.
