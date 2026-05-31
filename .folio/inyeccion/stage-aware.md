---
title: Inyección stage-aware
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [inyeccion, pipeline, relevancia]
---

## La relevancia es POR STAGE, no por tarea

El UX no necesita arquitectura; el architect no necesita convenciones de UI. Inyectar el mismo bloque a todos los stages es ruido.

## El truco: meter el rol del stage en la query

La query de BM25 = **descripción de la tarea + descriptor corto del stage**. Así:
- El architect (prompt sobre arquitectura) → BM25 le saca pages de arquitectura/decisiones.
- El UX (prompt sobre diseño) → le saca convenciones de UI.

Sin tabla `stage → chapters` que mantener.

## Por qué NO una tabla stage→chapters

1. **Rompe la tesis genérica**: una tabla con chapters de dev (arquitectura, decisiones) no significa nada en un folio de Oncall o una novela.
2. **Acopla el motor a los nombres de stages de Prism** (`ux-api-designer`, etc.) — justo lo que un módulo extraíble no puede saber.
3. **Se pudre**: un chapter nuevo no estaría en ninguna lista y nunca se inyectaría, en silencio.

La relevancia keyed-on-query lo recoge todo solo, en cualquier dominio, sin config.

## Riesgo: cold-start

Con pocas pages, BM25 es ruidoso y un título de tarea puede no hacer match léxico. Lo cubre el índice (siempre presente) + que el agente puede tirar de `folio_search`. El cap acota cualquier match malo. Ver [[inyeccion/niveles-confianza]].
