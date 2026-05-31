---
title: Export / Import
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [export, import, git, sync]
---

## Fase 1 — Carpeta de markdown (forma canónica)

- chapter = carpeta, page = fichero `.md`, slug = ruta.
- frontmatter YAML por page: `author`, `pinned`, `created`, `updated`, `tags`.
- `_attachments/<chapter>/<page>/` para blobs.
- `folio.json` = manifest (nombre, config, versión de formato).

```
mi-folio/
├── folio.json
├── stack/
│   ├── runtime.md
│   └── arrancar.md
└── _attachments/...
```

## El payoff estratégico: git ES tu sync

Si un folio es una carpeta de markdown, no necesitas infraestructura de sync. `git init` sobre la carpeta da versionado, historia y compartición en equipo, con una herramienta que todo dev ya usa. Engram construyó sync custom con chunks; Folio lo obtiene apoyándose en git. Resuelve gratis el gap competitivo de sync.

## Round-trip

El frontmatter completo hace la carpeta re-importable. Diseñar el frontmatter desde ya para que el round-trip sea posible, aunque el import se implemente después. Abre la puerta a que en el futuro el almacenamiento SEA la carpeta (modelo Obsidian).

## Fase 2 — Wrapper .folio

`nombre.folio` = **zip** de la carpeta + manifest. NO es formato propio: por dentro sigue siendo markdown (como `.docx`/`.epub`). Transparente, sin lock-in. Artefacto único para compartir. Es literalmente `zip` → diferible.

## Fuente de verdad

SQLite en runtime (Prism); markdown/.folio es export/import. En file-backend, los markdown SON la verdad. Ver [[arquitectura/storage-backend]].
