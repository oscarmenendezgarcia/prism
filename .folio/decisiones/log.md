---
title: Log de decisiones de diseño
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [decisiones, historia]
---

## Decisiones cerradas y por qué

1. **Folio embebido en Prism primero, extraíble después.** Valida modelo de datos y UX sin overhead de infra. Prism = primer consumidor.

2. **Repo separado a futuro, no dependencia de Engram.** El stack ya existe en Prism (SQLite, FTS5, MCP). Copiar patrones de Engram, no el binario.

3. **Solo backend en v1.** Sin frontend propio; la UI la provee Prism. Folio = HTTP + MCP + CLI.

4. **Nomenclatura Folio → Chapter → Page.** Folio = cuaderno, no hoja. Ver [[concepto/vocabulario]].

5. **Sin templates ni intent picker.** Estructura emergente del slug. La complejidad no merecía la pena.

6. **Opt-in / lazy.** Un space no tiene por qué usar folio. Activación en el store, no en la UI.

7. **Core keyea por folio_id; space_id es binding de Prism.** Clave para extraer.

8. **Inyección stage-aware (relevancia keyed-on-query), no tabla stage→chapters.** Evita acoplar el motor y pudrirse.

9. **Inyección por niveles de confianza** (inline / referencia / on-demand), umbral por score.

10. **Pinned = boost, no inyección incondicional.** El pin "siempre" tenía la misma rigidez que los templates.

11. **Write-back: solo si folio existe + una consolidación al final, conservadora.**

12. **Export = carpeta markdown (git = sync); .folio = zip transparente.**

13. **FTS5 en el core, in-memory por defecto + caché opcional.** SQLite FTS5 en ambos backends (no BM25-JS, divergiría).

14. **Backend por space.** SQLite default universal; file-backend (`.folio/` en el working dir, git-versionado) opt-in y solo si el space tiene working_directory. Sin repo → SQLite siempre. Ver [[arquitectura/storage-backend]].

## Diferibles

- Concurrencia write-back (last-write-wins en v1).
- Versionado del formato `.folio` (import de versión distinta).
- Shell completion en CLI.
