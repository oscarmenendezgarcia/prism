# ADR-1: Unificar RunIndicator

## Status
Accepted

## Context

Header muestra dos indicadores simultaneos. AgentRunIndicator (activeRun) y PipelineProgressBar (pipelineState) coexisten cuando agente suelto corre como pipeline de 1 etapa.

Ademas: deleteRun sin detached:true deja subprocesos huerfanos al Abort.

## Decision

Crear RunIndicator que lee solo de pipelineState. Bifurcacion por stages.length:
1 etapa -> dot pulsante + nombre completo + tiempo + Abort
N etapas -> step nodes + etapa activa + tiempo + Abort
paused -> banner con Continue + Abort

Backend: spawn con detached:true. Kill via process.kill(-child.pid, SIGTERM).

## Rationale

pipelineState contiene stages, currentStageIndex, status, pausedBeforeStage. activeRun no tiene stages. La bifurcacion visual es decision de render.

detached:true asigna PGID=PID del hijo. process.kill(-pid) mata todo el arbol.

## Consequences

Positivo: zero doble indicador, nombre completo en modo 1-etapa, Abort mata subprocesos, unico test file.
Negativo: AgentRunIndicator.tsx y PipelineProgressBar.tsx desaparecen. Mitigacion: T-003 reescribe tests primero.

## Alternatives

Guard mejorado en AgentRunIndicator: descartado, problema estructural.
RunStatusBanner orquestador: misma dualidad.
Mover agente suelto a pipeline-1-etapa en backend: fuera de scope.

## Review
Suggested review date: 2026-09-25