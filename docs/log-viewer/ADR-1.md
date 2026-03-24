# ADR-1: Log Viewer — Arquitectura del Panel de Logs por Stage

## Status
Accepted

## Context
El pipeline de agentes (`POST /api/v1/runs`) ya ejecuta cada stage y escribe su output
a un archivo de log en `data/runs/<runId>/stage-<N>.log`. La API `GET /api/v1/runs/:runId/stages/:N/log`
ya existe y devuelve el contenido como `text/plain` (con soporte de `?tail=N`).

Sin embargo, el frontend no expone ningún mecanismo para leer estos logs. El usuario
debe abrir la terminal del servidor o consultar el sistema de archivos manualmente.
Esto rompe la promesa de UX: "ver el output completo de cada stage directamente en la UI".

La decisión afecta exclusivamente al frontend (React + Zustand) y a ningún endpoint nuevo.
No hay estado mutable nuevo en el backend.

## Decision
Se introduce un **PipelineLogPanel**: panel lateral de ancho fijo (480 px, redimensionable
con `usePanelResize`), montado en `App.tsx` junto a `TerminalPanel` y `RunHistoryPanel`,
controlado por un toggle en el `Header`. El panel carga los logs por polling cada 2 s
mientras el run está activo, y permite al usuario seleccionar el stage a visualizar
mediante un selector de tabs. El contenido se muestra en un `<pre>` con scroll anclado
al fondo (auto-scroll desactivable). No se requiere WebSocket ni server-sent events.

## Rationale

### Por qué polling en lugar de streaming (SSE / WebSocket)
El backend no expone un endpoint de streaming para los logs. Añadir SSE o WebSocket
requeriría modificar `server.js` de forma no trivial y no está dentro del alcance de
esta tarea. Polling a 2 s es suficiente dado que los stages duran minutos, no segundos.
El costo de red es mínimo: cada respuesta es `text/plain` sin overhead de JSON.

### Por qué panel lateral en lugar de modal
Un modal bloquearía la interacción con el tablero. El usuario necesita poder mover
tarjetas o consultar el board mientras monitorea los logs: el panel lateral (el mismo
patrón ya usado por `TerminalPanel`, `RunHistoryPanel`, `ConfigPanel`) es la solución
establecida en este proyecto.

### Por qué Zustand en lugar de React Query / SWR
El proyecto no tiene React Query. Zustand ya gestiona el `pipelineState` que contiene
el `runId`. Centralizar el estado del log viewer en una slice del store de Zustand
(o en un store dedicado similar a `useRunHistoryStore`) mantiene la consistencia
arquitectónica y evita instalar nuevas dependencias.

### Por qué store dedicado (`usePipelineLogStore`) en lugar de slice en `useAppStore`
`useAppStore` ya supera las 1200 líneas. Separar el store del log viewer sigue el
patrón establecido por `useRunHistoryStore` y mantiene la cohesión: el log viewer
tiene su propio ciclo de vida (open/close, runId activo, stage seleccionado, logs cacheados
por stage).

## Consequences

**Positive:**
- Cero cambios en el backend. El endpoint `GET /api/v1/runs/:runId/stages/:N/log` ya existe.
- La UI es consistente con los paneles existentes (mismo patrón de resize, mismo toggle en el Header).
- El componente es puramente de lectura — no introduce efectos secundarios en el estado del pipeline.
- El polling se detiene automáticamente cuando el run termina (status != 'running'), eliminando carga residual.

**Negative / Risks:**
- Polling a 2 s puede mostrar logs con hasta 2 s de retraso respecto a la ejecución real.
  Mitigación: aceptable dado que los stages duran minutos. Si en el futuro se necesita
  tiempo real, añadir SSE es un cambio de backend aislado.
- El log completo de un stage largo puede ser grande (cientos de KB). El endpoint ya
  soporta `?tail=500` para limitar la respuesta; el panel debe usar tail por defecto
  y ofrecer opción de "cargar todo".
  Mitigación: usar `?tail=500` como valor por defecto en el hook de polling.
- Si el usuario abre el panel con el run terminado, los logs son estáticos (sin polling).
  Mitigación: el hook detecta `run.status !== 'running'` y deshabilita el intervalo.

## Alternatives Considered

- **SSE (Server-Sent Events):** descartado — requiere cambios en `server.js` fuera de scope.
- **Modal de logs:** descartado — bloquea la interacción con el board.
- **Slice en `useAppStore`:** descartado — el store ya es muy grande; se prefiere store dedicado.
- **xterm.js para renderizar los logs:** descartado — los logs son texto plano del CLI de Claude,
  no una sesión PTY interactiva. `<pre>` con Tailwind es suficiente y no añade dependencias.

## Review
Fecha de revisión sugerida: 2026-09-24
