# Blueprint: RunIndicator

## Objetivo

Reemplazar AgentRunIndicator.tsx y PipelineProgressBar.tsx con un unico componente RunIndicator.tsx que lee de pipelineState.

## 3.1 Componentes

| Componente | Responsabilidad | Tecnologia |
|---|---|---|
| RunIndicator.tsx | Renderizar estado activo de ejecucion (dot/steps/paused) | React 19, Tailwind |
| useAppStore (sin cambio) | Fuente de verdad: pipelineState, abortPipeline, resumePipeline | Zustand |
| pipelineManager.js (patch) | Spawn con detached:true, kill de process group | Node.js child_process |
| Header.tsx (patch) | Contener RunIndicator en el centro | React 19 |

## 3.2 Logica de render de RunIndicator

Condicion | Render
pipelineState === null | return null
status === paused | PausedBanner (Continue + Abort + elapsed)
stages.length === 1 | SingleAgentDot (dot + displayName + elapsed + Abort)
stages.length > 1 | StepNodes (nodes + elapsed + Abort si running + Dismiss)

## 3.3 Selectores consumidos

- usePipelineState() -> PipelineState | null
- useAvailableAgents() -> AgentInfo[] (solo modo 1-etapa para resolver displayName)
- useAppStore(s => s.abortPipeline) -> () => void
- useAppStore(s => s.resumePipeline) -> () => void (solo modo paused)
- useAppStore(s => s.clearPipeline) -> () => void

## 3.4 STAGE_LABELS y STAGE_DISPLAY

Los mapas de etiquetas deben incluir code-reviewer ademas de los 4 agentes actuales:

STAGE_LABELS: senior-architect=Architect, ux-api-designer=UX, developer-agent=Dev, qa-engineer-e2e=QA, code-reviewer=Rev
STAGE_DISPLAY: senior-architect=Senior Architect, ux-api-designer=UX / API Designer, developer-agent=Developer Agent, qa-engineer-e2e=QA Engineer E2E, code-reviewer=Code Reviewer

## 3.5 Timer

El useEffect del timer es identico al de PipelineProgressBar: resetea cuando cambia pipelineState.startedAt, tick cada 1000ms, cleanup clearInterval en unmount.

## 3.6 Backend patches en pipelineManager.js

spawnStage: agregar detached:true al objeto de opciones de spawn.
deleteRun y timeout handler: reemplazar child.kill(SIGTERM) por process.kill(-child.pid, SIGTERM).

## 3.7 Header patch

Eliminar imports de AgentRunIndicator y PipelineProgressBar.
Agregar import de RunIndicator.
En el div centre: un unico <RunIndicator />.

## 3.8 Archivos eliminados

frontend/src/components/agent-launcher/AgentRunIndicator.tsx (git rm)
frontend/src/components/agent-launcher/PipelineProgressBar.tsx (git rm)
frontend/__tests__/components/AgentRunIndicator.test.tsx (git rm)
frontend/__tests__/components/PipelineProgressBar.test.tsx (git rm)

## 3.9 Archivos creados

frontend/src/components/agent-launcher/RunIndicator.tsx
frontend/__tests__/components/RunIndicator.test.tsx

## 3.10 Accesibilidad

role=status, aria-live=polite, aria-label dinamico en todos los modos. Identico al comportamiento actual de los componentes que se eliminan.