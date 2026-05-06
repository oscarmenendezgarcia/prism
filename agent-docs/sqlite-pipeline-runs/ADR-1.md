# ADR-1: Migrar la persistencia de pipeline runs de JSON/filesystem a SQLite

## Status
Accepted — 2026-05-04

## Context

Actualmente los runs de pipeline (`createRun`, `executeNextStage`, `stopRun`, …) se persisten en dos artefactos en disco:

1. **`data/runs/runs.json`** — índice plano `RunSummary[]` para `listRuns()`.
2. **`data/runs/<runId>/run.json`** — estado completo del run (stages, statuses, worktree, blockedReason, …).

Cada `writeRun` es de hecho **dos** escrituras secuenciales (atómicas individualmente con `.tmp + rename`, pero **no atómicas en conjunto**). Esto produce tres problemas:

- **B1 (bug confirmado):** un run de hace ~17 h aparece en el UI (porque su `run.json` se persistió) pero **no** en `runs.json` (la segunda escritura nunca llegó — el server murió en medio). Resultado: `listRuns()` no lo enumera y el UI lo muestra solo si lo abres por URL directa.
- **B2 (escalabilidad de queries):** "¿hay un run activo para esta task?" hoy hace `readdirSync(runsDir)` + `readJSON` por cada subdirectorio. O(n) ficheros por consulta. Lo mismo para `init()` al arrancar.
- **B3 (inconsistencia con el resto del proyecto):** spaces y tasks ya migraron a `data/prism.db` (better-sqlite3) — los runs son la última entidad que sigue en ficheros sueltos.

Los logs de stage (`stage-N.log`, `-prompt.md`, `.done`, `.inject`) son streaming de subprocesos y no entran en este ADR.

## Decision

Mover el estado de los runs a una nueva tabla `pipeline_runs` en `data/prism.db`, gestionada por `src/services/store.js`. Los métodos `readRun`/`writeRun`/`listRuns`/`upsertRegistryEntry`/`removeRegistryEntry` de `pipelineManager.js` delegan en el store. Los ficheros auxiliares por stage (`stage-N.log`, prompts, sentinels, inject signals) **siguen** en `data/runs/<runId>/`. Phase 3 del migrator importa los `run.json` existentes al arrancar; los renombra a `.migrated` para rollback.

## Rationale

- **Atomicidad real (resuelve B1):** un único `INSERT OR REPLACE` reemplaza las dos escrituras. WAL + `synchronous=NORMAL` ya en uso para spaces/tasks → no hay configuración nueva.
- **Queries indexadas (resuelve B2):** índices por `status`, `task_id`, `space_id`, `updated_at`. `findActiveRunByTaskId` baja de O(n ficheros) a un index seek. `init()` itera solo runs con `status IN ('pending','running','blocked')`.
- **Coherencia (resuelve B3):** una sola fuente de verdad para spaces, tasks y runs. Reduce acoplamiento al sistema de ficheros y simplifica backup/restore (`prism.db` + `data/runs/*.log`).
- **Sin nuevas dependencias.** `better-sqlite3` ya está en uso. Patrón idéntico al ya implementado en ADR de SQLite tasks.
- **Cambio quirúrgico** — la API pública de `pipelineManager` no cambia. Los handlers HTTP (`src/handlers/pipeline.js`) y el frontend no se tocan.

## Consequences

### Positivas
- Adiós al bug de runs perdidos por escritura parcial.
- `listRuns` y `findActiveRunByTaskId` indexados; UI de runs escala a miles sin paginación ad-hoc.
- Backup atómico (`cp data/prism.db backup.db`) cubre todo el estado de runs.
- Migración Phase 3 idempotente: arrancar → parar → arrancar otra vez no duplica filas.
- Rollback trivial: `mv *.migrated *.json` + `DROP TABLE pipeline_runs`.

### Negativas / riesgos
- **Concurrencia con polling loop:** `writeRun` puede competir con `setInterval` — *mitigación:* better-sqlite3 + WAL ya serializan; `upsertRun` es un único statement.
- **Divergencia entre tabla y directorio si alguien borra `data/runs/<runId>/` a mano** — *mitigación:* `getRun` tolera ausencia del directorio (devuelve run sin logs); `deleteRun` borra ambos.
- **Schema migration nueva al desplegar** — *mitigación:* `CREATE TABLE IF NOT EXISTS` (idempotente, cero downtime).
- **Tests existentes** que toquen `runs.json` o `<runId>/run.json` directamente romperán — *mitigación:* auditar y migrar a `store.getRun`/`store.upsertRun` o usar el helper `pipelineManager.getRun`.
- **Tamaño de `prism.db`** crecerá con cada run (≈1-3 KB por fila). Acceptable: el repo actual tiene 47 runs → ~150 KB. Plan: añadir `DELETE FROM pipeline_runs WHERE status IN ('completed','failed','aborted') AND updated_at < ?` como tarea de housekeeping futura (fuera de este ADR).

## Alternatives considered

- **A. Un único `runs.json` con todos los runs en un solo fichero, sin subdirectorio.** Descartada: empeora B1 (más datos por escritura → más ventana de corrupción) y mantiene el problema de queries lineales.
- **B. Mover **todo** a SQLite (incluidos los logs de stage como BLOBs).** Descartada: rompe el patrón `child.stdout.pipe(fs.createWriteStream)` y el endpoint de preview que hace `fs.createReadStream`. Volumen alto (MB por run) sin beneficio. Se mantiene el filesystem para artefactos append-only.
- **C. Lazy migration (importar `run.json` solo cuando alguien lo pida).** Descartada: comportamiento no determinista, `listRuns` quedaría incompleta hasta tocar runs uno a uno. Eager Phase 3 añade <100 ms al arranque (47 runs).
- **D. Esquema con una columna por campo del run.** Descartada: `stageStatuses` es lista anidada con sub-objetos, y cada nuevo campo del modelo de run (loop counts, blocked reason, worktree meta…) requeriría `ALTER TABLE`. Híbrido (PK + columnas indexadas + blob `data` JSON) es el sweet spot.

## Review
Suggested review date: 2026-11-04 (+6 meses) — revisar si la tabla necesita housekeeping/TTL y si conviene migrar también los logs cuando aparezca FUSE/blob storage.
