---
title: Diferenciación vs Engram
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [competencia, engram, posicionamiento]
---

## Engram (Gentleman-Programming/engram)

Binario Go, agent-agnostic. SQLite + FTS5, 4 interfaces (CLI, HTTP, MCP, TUI), 19 MCP tools. Sync via Git (chunks comprimidos) + replicación cloud beta. Conflict detection beta.

## Folio comparte la base técnica pero difiere en filosofía

| | Engram | Folio |
|---|---|---|
| Scope | Global, todo mezclado | Por folio — Oncall no contamina tu novela |
| Estructura | Entradas planas | Folio → Chapter → Page (el índice es el producto) |
| Usuario | Solo el agente | Usuario y agente colaboran igual |
| UI | Terminal UI | Índice navegable (en Prism) |
| Dominio | Pensado para código | Neutral, cualquier dominio |
| Referencias | — | [[chapter/page]] y [[chapter/page#section]] |

## La conclusión

Mismo insight (SQLite + FTS5 para memoria de agentes), distinta apuesta: Engram es una herramienta PARA agentes; Folio es un producto para el USUARIO que trabaja con agentes. Las dos diferencias clave en v1: **scope por folio** + **granularidad de referencias**.

Decisión: copiar los patrones de Engram, no el binario. Prism ya tiene SQLite, FTS5 y MCP server propios.

## Posicionamiento

- **Folio standalone** = memoria agent-agnostic vía MCP → compite con Engram.
- **Prism** = host batteries-included que añade inyección automática + UI + write-back del pipeline.
