---
title: Vocabulario — Folio, Chapter, Page
author: user
pinned: true
created: 2026-05-31
updated: 2026-05-31
tags: [naming, modelo]
---

## La jerarquía

```
Folio (el cuaderno / la base de conocimiento de un dominio)
└── Chapter (la sección)
    └── Page (la unidad de conocimiento)
        └── Attachment (blobs opcionales)
```

## Por qué estos nombres

El producto se llama Folio. Un folio es **el cuaderno**, no la hoja — por eso Folio nombra el contenedor, no la entrada. La jerarquía interna debe ser coherente con esa metáfora de libro:

- **Folio** > Entry sonaba raro (un folio es una hoja, no un libro entero).
- **Chapter / Page** son coherentes con "cuaderno", los entiende cualquiera sin contexto técnico, y funcionan igual para Oncall que para una novela.

Las MCP tools quedan legibles: `folio_get_page`, `folio_search`, `folio_list_chapters`.

## Producto en una frase

Folio es el cuaderno compartido entre tú y tu agente. Tagline: *"Lo que tu agente necesita recordar."*
