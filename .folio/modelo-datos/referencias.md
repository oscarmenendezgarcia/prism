---
title: Sintaxis de referencias
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [referencias, sintaxis]
---

## Sintaxis elegida: [[ ]]

Estándar de facto en wikis y knowledge bases (Obsidian, Roam, Notion). Los usuarios lo reconocen de forma instintiva y no colisiona con otros usos.

Alternativas descartadas:
- `@slug` — conflicto futuro con menciones de usuario.
- `#slug` — evoca tags/categorías, no referencias a contenido.
- `/slug` — se confunde con rutas de fichero.
- `folio:slug` — sin ambigüedad pero verboso.

## Dos niveles de granularidad

- `[[chapter/page]]` — page completa.
- `[[chapter/page#section]]` — solo el bloque H2 indicado (más ligero, más preciso). Anchor por título H2, como en Markdown/GitHub.

NO se soporta referencia por número de línea (frágil, cambia al editar).

## Resolución

En prompts de tareas, Prism resuelve las referencias ANTES de enviar al agente: sustituye `[[...]]` por el contenido. El agente recibe texto plano, no sabe que hubo referencias. Las referencias son **estables**: si la page se actualiza, la próxima ejecución recibe la versión nueva.

## Ficheros del repo vs adjuntos

- **Ficheros del repo**: solo se mencionan como texto en el markdown. Folio NO los copia. El repo es la única fuente de verdad para código.
- **Adjuntos**: blobs en Folio solo para ficheros que NO viven en el repo (diagramas, PDFs, notas externas).
