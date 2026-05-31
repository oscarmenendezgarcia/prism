---
title: Indexación FTS5
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [fts5, busqueda, indice]
---

## FTS5 vive en el CORE, no en Prism

`better-sqlite3` ya trae FTS5 compilado, así que la búsqueda está disponible en cualquier contexto donde corra el paquete. Lo que cambia entre backends no es *si hay FTS5*, sino *qué es la fuente de verdad*.

- **Prism**: SQLite es a la vez fuente de verdad e índice. La tabla FTS vive en `prism.db`.
- **File-backend**: los markdown son la verdad; el índice FTS se **deriva** de ellos.

## Construcción del índice standalone

1. **In-memory por invocación (default)**: para folios de decenas de pages, montar el índice FTS5 en memoria desde los markdown tarda milisegundos. Sin caché, sin bugs de staleness. Es la opción por defecto.
2. **Caché persistente** `.folio/cache.db` (gitignored): solo para folios grandes. Se rebuildea cuando el mtime de los markdown supera al de la caché, o con `folio reindex`.

## Por qué SQLite FTS5 en ambos backends

Si se usara una librería JS de BM25 para los ficheros y FTS5 para Prism, habría **dos rankings que divergen** — la misma búsqueda daría resultados distintos según dónde corra. Con SQLite FTS5 en ambos, el ranking es idéntico en todas partes. La dependencia de `better-sqlite3` ya está, no se añade nada.

## Modelo mental

Ficheros = verdad. FTS5 = índice (en `prism.db` si es Prism, en memoria/caché si es terminal).
