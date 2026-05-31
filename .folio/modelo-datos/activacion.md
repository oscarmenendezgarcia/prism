---
title: Activación — opt-in y createIfMissing
author: user
pinned: true
created: 2026-05-31
updated: 2026-05-31
tags: [opt-in, activacion, store]
---

## Folio es opt-in y lazy

Un space tiene **0 o 1 folio**. NO se crea al crear el space. Se materializa por una vía explícita. Si nadie lo usa, no existe → reads devuelven vacío (no error), inyección con coste cero.

## La activación vive en el STORE, no en la UI

Acoplar la activación a un toggle de UI rompería el uso headless (CLI, MCP). El opt-in se garantiza con un flag en la escritura:

```
createPage(slug, content, { createIfMissing })
```

- **Vías explícitas** (page manual del usuario, bootstrap, import) → `createIfMissing: true` → materializan el folio.
- **Write-back de agentes** durante el pipeline → `createIfMissing: false` → no-op si no hay folio.

Así "los agentes no crean folio por la puerta de atrás" es una propiedad del store, no del frontend. Funciona idéntico desde UI, CLI, MCP o test headless.

## Huevo y gallina, resuelto

Los agentes solo escriben en folios que ya existen. La creación es SIEMPRE un gesto de usuario:
1. Toggle "Activar Folio" (cliente UI) — el modelo mental principal.
2. Escribir la primera page a mano.
3. Bootstrap desde el repo (ver [[flujos/bootstrap]]).
4. Import de un .folio / carpeta markdown.

Los clientes (UI toggle, CLI, MCP) son intercambiables sobre la misma operación de store.

Folio existe = tiene ≥1 page por vía explícita.
