---
title: Presupuesto de tokens
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [inyeccion, tokens, presupuesto]
---

## Contar tokens reales, no estimarlos

El presupuesto es ficción hasta que se mide. Truncar por conteo real.

## Capas y coste

- Capa 1 — Índice: siempre, ~200 tokens (chapter titles + conteo de pages).
- Capa 2 — Inline por relevancia: HARD CAP de ~3 pages inline / ~1500 tokens, lo que llegue antes.
- Pinned = **boost en el ranking**, NO inyección incondicional. Si una page pinned es irrelevante para este stage, cae bajo el cap y no aparece.
- Restricciones = única clase always-on, mínima.

## Dedup

Restar lo ya inyectado para no repetir una page (p.ej. una page con boost de pinned que también sale en el top-K de BM25).

## Truncado

Al truncar una page, dejar marca:

```
[truncado — [[chapter/slug]] disponible via folio_get_page]
```

Así el agente sabe que hay más y puede pedirlo.

## Configurable

El presupuesto es configurable por space. Coste cero si el space no tiene folio.
