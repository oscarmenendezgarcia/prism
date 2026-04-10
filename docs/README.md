# docs/

Esta carpeta contiene dos tipos de contenido:

1. **Documentación del sistema** — archivos Markdown que describen la arquitectura, la API y el servidor MCP.
2. **Artefactos del proceso de desarrollo** — una subcarpeta por feature, generada automáticamente por el pipeline de agentes durante el desarrollo iterativo de Prism.

---

## Documentación del sistema

| Archivo | Propósito |
|---------|-----------|
| `architecture.md` | Stack, modelo de datos, flujo del pipeline y ADRs clave |
| `endpoints.md` | Referencia completa de la REST API — rutas, parámetros y shapes de respuesta |
| `mcp-server.md` | Referencia de las herramientas MCP — todos los `kanban_*` con parámetros y ejemplos |
| `github-readiness.md` | Checklist para la publicación del repositorio en GitHub |

---

## Artefactos del proceso de desarrollo

Cada subcarpeta corresponde a una **feature desarrollada mediante el pipeline de agentes**
(`senior-architect → ux-api-designer → developer-agent → qa-engineer-e2e`).
Los artefactos son la salida natural de ese proceso iterativo — no son documentación final
ni están destinados a usuarios externos.

### Artefactos posibles por feature

| Archivo | Generado por | Contenido |
|---------|-------------|-----------|
| `ADR-1.md` | senior-architect | Decisión de arquitectura (contexto, opciones, decisión, consecuencias) |
| `blueprint.md` | senior-architect | Diseño de componentes, flujos y contratos |
| `tasks.json` | senior-architect | Breakdown de tareas con dependencias y criterios de aceptación |
| `wireframes.md` | ux-api-designer | Flujos de usuario, estados de la UI y accesibilidad |
| `wireframes-stitch.md` | ux-api-designer | IDs de Stitch y URLs de descarga de pantallas HTML |
| `api-spec.json` | ux-api-designer | Especificación OpenAPI 3.0 de los endpoints de la feature |
| `user-stories.md` | ux-api-designer | Historias de usuario y criterios de aceptación |
| `stitch-screens/` | ux-api-designer | Pantallas HTML generadas con Stitch (spec visual pixel-perfect) |
| `CHANGELOG.md` | developer-agent | Cambios implementados, referenciando tareas de `tasks.json` |
| `test-plan.md` | qa-engineer-e2e | Plan de pruebas: unitarias, integración, E2E, rendimiento, seguridad |
| `test-results.json` | qa-engineer-e2e | Resultados de ejecución de Playwright (pass/fail por test, screenshots en fallo) |
| `bugs.md` | qa-engineer-e2e | Bugs encontrados con severidad — Critical/High bloquean el merge |

No todas las features tienen todos los artefactos. Las features backend-only omiten
wireframes y pantallas Stitch; las features sin cambios de API omiten `api-spec.json`.

### Features actuales

| Carpeta | Descripción |
|---------|-------------|
| `agent-launcher/` | UI para lanzar agentes del pipeline desde la interfaz |
| `agent-run-history/` | Historial de ejecuciones del pipeline |
| `allow-resize-settings/` | Redimensionado del panel de configuración |
| `bug-agents-progress/` | Indicador de progreso de agentes en ejecución |
| `config-editor/` | Editor de archivos de configuración (`~/.claude/*.md`) |
| `log-viewer/` | Visor de logs de stages del pipeline en tiempo real |
| `mcp-start-pipeline/` | Herramienta MCP para lanzar pipelines desde el kanban |
| `multi-tab-terminal/` | Terminal con soporte multi-tab |
| `optcg-redesign/` | Rediseño de la UI del buscador OPTCG |
| `pipeline-subtasks/` | Soporte de subtareas en el pipeline |
| `run-indicator/` | Indicador visual del estado de un pipeline run |
| `settings-bar/` | Barra de configuración global de la app |
| `task-detail/` | Vista de detalle de una tarea del kanban |
| `task-detail-edit/` | Edición inline de los campos de una tarea |

---

## Pipeline overview

```
senior-architect  →  ux-api-designer  →  developer-agent  →  qa-engineer-e2e
     ADR                wireframes           código +             test-plan
  blueprint            api-spec.json         tests              test-results
  tasks.json          user-stories.md      CHANGELOG              bugs.md
```

Los bugs de severidad Critical o High bloquean el merge y disparan un ciclo de corrección
de vuelta al developer-agent.
