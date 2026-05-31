---
title: Storage backend pluggable
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [arquitectura, backend, storage]
---

## La fuente de verdad depende del contexto

El core define las operaciones (get/search/create page); detrás hay dos backends intercambiables. "SQLite es la fuente de verdad" solo vale para Prism.

## Backend SQLite (Prism, embebido)

- DB central `prism.db`. SQLite = fuente de verdad **y** índice.
- Folios bound a spaces vía `space_folios`.
- Es un servidor con una DB.

## Backend file-backed (terminal / CLI)

- Descubre un **`.folio/` DIRECTORIO** desde el CWD, subiendo por el árbol como hace `git` con `.git`.
- **Markdown = fuente de verdad**, versionado con el repo vía git → git ES el sync.
- Sin registro global, sin flag `--folio`: el folio es el de la carpeta en la que estás. Aislamiento por directorio.

## Fichero vs directorio (modelo git)

- **`.folio/` (DIRECTORIO)** = store local vivo. Markdown editable en sitio, git-diffable. Equivalente a `.git/`.
- **`nombre.folio` (FICHERO zip)** = solo artefacto de export/compartir. Equivalente a `git bundle`. Ver [[flujos/export-import]].

Si el store vivo fuera el zip, cada read/write tendría que des-zipear/re-zipear y no se diffea en git → mala idea. El zip es para mandar, el directorio para trabajar.

## Selección de backend por space (Prism)

Un space de Prism elige dónde vive su folio, usando esta misma abstracción de backend:

- **SQLite (default universal)** — folio en `data/prism.db`. Para CUALQUIER space.
- **File-backend (opt-in)** — folio como `.folio/` DIRECTORIO dentro del `working_directory` del space. Versionado con git, viaja con el repo, mismo formato que el CLI standalone.

**Regla:** el file-backend solo está disponible si el space tiene `working_directory`. Sin repo (ops, writing, research) → SQLite siempre. La presencia de working dir habilita la opción (igual que gatea el bootstrap).

Setting por space: `folioBackend: 'sqlite' | 'file'` (default `'sqlite'`). El binding `space_folios` sigue mapeando identidad; en file-backend el "folio" es el `.folio/` del working dir. Conflictos usuario+agente → last-write-wins + git.
