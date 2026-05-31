---
title: Inyección por niveles de confianza
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [inyeccion, inline, referencia]
---

## El principio: inline lo seguro, nombra lo dudoso, el agente tira del resto

Inyectar todo el contenido inline desperdicia tokens en pages que el agente ignora. Inyectar solo slugs (reference-only) para todo arriesga que el agente vago NO los busque y vuelva a re-descubrir — matando el value prop. La solución es por nivel de confianza.

## Tres niveles

```
Inline (contenido completo):
  - Restricciones (always) — guardarraíles tipo "no toques el módulo X"
  - Top matches BM25 por encima de un THRESHOLD de score
  → lo que el agente seguro necesita, garantizado presente

Reference (solo slug):
  - El índice (capa 1, always) ya lista TODO = lista de refs gratis
  - + hint "relevantes: [slug, slug]" del tier justo bajo el threshold

On demand:
  - El agente hace folio_get_page de la cola cuando quiera
```

## Umbral por SCORE, no por rank

Una page que puntúa altísimo va inline (la necesita); una marginal solo se nombra. Esto resuelve el cold-start solo: pocas pages = todo pequeño = inline; muchas = inline los fuertes + referencia el resto.

## El índice ES la lista de referencias gratis

La capa 1 (índice con todos los slugs) ya le dice al agente qué existe y qué puede pedir. El reference-only sale sin trabajo extra.
