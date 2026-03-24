# Blueprint: Pipeline Log Viewer

## 1. Requirements Summary

### Functional
- Ver el output completo de cada stage del pipeline en la UI de Prism, sin abrir la terminal.
- Seleccionar qué stage visualizar mediante tabs o selector.
- Scroll sobre el contenido del log, anclado al fondo por defecto (auto-scroll).
- Botón de colapsar/expandir el panel.
- Los logs se actualizan automáticamente mientras el run está activo.
- El panel puede abrirse con el run activo o con un run ya terminado (logs estáticos).

### Non-Functional
- Sin nuevos endpoints de backend.
- Sin nuevas dependencias npm.
- Consistente con el design system (Tailwind tokens, shared components).
- El panel no bloquea la interacción con el board.
- El polling se detiene cuando el run no está activo.
- Latencia aceptable: hasta 2 s de retraso en logs en vivo.

### Constraints
- Backend: Node.js nativo, sin framework — no se añade SSE ni WebSocket.
- Frontend: React 19 + TypeScript + Tailwind CSS v4 + Zustand + Vite.
- El endpoint `GET /api/v1/runs/:runId/stages/:N/log?tail=N` ya existe y no se modifica.
- Ancho del panel: 480 px por defecto, redimensionable con `usePanelResize`.
- No instalar nuevas dependencias npm.

---

## 2. Trade-offs Analizados

### Trade-off 1: Polling vs SSE
- **Polling (elegido):** Implementación pura en el frontend, cero cambios en backend.
  Intervalo de 2 s. Pros: simple, sin nuevas dependencias. Cons: hasta 2 s de retraso.
- **SSE:** Tiempo real verdadero pero requiere endpoint nuevo en `server.js`. Fuera de scope.
- **Decisión:** Polling. El retraso es aceptable; un futuro upgrade a SSE es un cambio de backend aislado.

### Trade-off 2: Panel lateral vs Modal
- **Panel lateral (elegido):** Sigue el patrón de `TerminalPanel`, `RunHistoryPanel`, `ConfigPanel`.
  No bloquea el board. Cierre/apertura por toggle en Header.
- **Modal:** Bloquea la interacción con el tablero. Inadecuado para monitoreo prolongado.
- **Decisión:** Panel lateral.

### Trade-off 3: Store dedicado vs Slice en useAppStore
- **Store dedicado `usePipelineLogStore` (elegido):** Sigue el patrón de `useRunHistoryStore`.
  Cohesión: el log viewer tiene su propio ciclo de vida.
- **Slice en useAppStore:** El store ya tiene >1200 líneas. Añadir más estado ahí dificulta el mantenimiento.
- **Decisión:** Store dedicado.

---

## 3. Architectural Blueprint

### 3.1 Core Components

| Componente | Responsabilidad única | Tecnología | Patrón de escalado |
|---|---|---|---|
| `usePipelineLogStore` | Estado del log viewer: open, runId, stage activo, cache de logs por stage, loading | Zustand | Singleton por aplicación |
| `usePipelineLogPolling` | Polling del log activo cada 2 s; se detiene si run inactivo | React hook (useEffect + setInterval) | Stateless; un único intervalo activo |
| `PipelineLogPanel` | Contenedor del panel: header con tabs de stage, área de log, resize | React + Tailwind | Stateless UI, delega estado al store |
| `StageTabBar` | Tabs clickables por stage; indica status (running/done/pending/failed) | React + Tailwind | Pure component |
| `LogViewer` | Área `<pre>` scrollable con auto-scroll al fondo; botón de "scroll to top" | React + useRef | Stateless display |
| `PipelineLogToggle` | Botón en el `Header` que abre/cierra el panel | React + Tailwind | Stateless button |

### 3.2 Data Flows y Secuencias

#### Diagrama C4 — Nivel de sistema

```
graph TD
    User["Usuario (browser)"]
    Frontend["Prism Frontend\n(React + Zustand)"]
    Backend["Prism Backend\n(Node.js HTTP)"]
    LogFiles["Log Files\n(data/runs/:runId/stage-N.log)"]

    User -->|"Toggle 'Logs'"| Frontend
    Frontend -->|"GET /api/v1/runs/:runId\n(polling run status)"| Backend
    Frontend -->|"GET /api/v1/runs/:runId/stages/:N/log?tail=500\n(polling cada 2s)"| Backend
    Backend -->|"text/plain"| Frontend
    Backend -->|"Lee"| LogFiles
    pipelineManager -->|"Escribe stdout+stderr"| LogFiles
```

#### Flujo de apertura y polling

```
sequenceDiagram
    actor User
    participant Header
    participant PipelineLogStore as usePipelineLogStore
    participant PollingHook as usePipelineLogPolling
    participant API as GET /api/v1/runs/:runId/stages/:N/log

    User->>Header: Click "Logs" toggle
    Header->>PipelineLogStore: setLogPanelOpen(true)
    PipelineLogStore-->>PipelineLogPanel: panelOpen=true, runId, selectedStage

    Note over PollingHook: Se monta cuando panelOpen && runId != null

    loop Cada 2s mientras run.status === 'running'
        PollingHook->>API: GET /stages/{selectedStage}/log?tail=500
        API-->>PollingHook: text/plain (últimas 500 líneas)
        PollingHook->>PipelineLogStore: setStageLog(stageIndex, content)
        PipelineLogStore-->>LogViewer: log actualizado
        LogViewer->>LogViewer: auto-scroll al fondo
    end

    Note over PollingHook: run.status !== 'running' → clearInterval
```

#### Flujo de cambio de stage

```
sequenceDiagram
    actor User
    participant StageTabBar
    participant PipelineLogStore as usePipelineLogStore
    participant PollingHook as usePipelineLogPolling
    participant API

    User->>StageTabBar: Click tab Stage 2
    StageTabBar->>PipelineLogStore: setSelectedStage(1)
    PipelineLogStore-->>PollingHook: selectedStage cambió
    PollingHook->>API: GET /stages/1/log?tail=500 (inmediato)
    API-->>PollingHook: text/plain
    PollingHook->>PipelineLogStore: setStageLog(1, content)
    PipelineLogStore-->>LogViewer: render nuevo log
```

#### Diagrama de despliegue (estructura de archivos frontend)

```
graph LR
    subgraph "frontend/src/"
        A["stores/usePipelineLogStore.ts"]
        B["hooks/usePipelineLogPolling.ts"]
        C["components/pipeline-log/\n PipelineLogPanel.tsx\n StageTabBar.tsx\n LogViewer.tsx"]
        D["components/layout/\n Header.tsx (modificado)"]
        E["App.tsx (modificado)"]
    end

    E -->|"monta"| C
    D -->|"toggle"| A
    C -->|"usa"| A
    C -->|"monta"| B
    B -->|"fetch API"| F["api/client.ts (modificado)"]
```

### 3.3 APIs e Interfaces

#### Endpoint consumido (ya existe, sin cambios)

```
GET /api/v1/runs/:runId/stages/:stageIndex/log?tail=500

Response: 200 text/plain
  <contenido del log — últimas 500 líneas si ?tail=500>

Errores:
  404 RUN_NOT_FOUND     — runId no existe
  404 STAGE_NOT_FOUND   — stageIndex fuera de rango
  404 LOG_NOT_AVAILABLE — el stage aún no ha comenzado
  500 INTERNAL_ERROR    — error de lectura del archivo

Latencia SLA: p95 < 50 ms (lectura de archivo local en servidor)
```

#### Endpoint consumido para estado del run (ya existe, sin cambios)

```
GET /api/v1/runs/:runId

Response: 200 application/json
{
  "runId": "string",
  "status": "pending" | "running" | "completed" | "failed" | "interrupted",
  "currentStage": number,
  "stages": string[],
  "stageStatuses": [
    {
      "index": number,
      "agentId": "string",
      "status": "pending" | "running" | "completed" | "failed" | "timeout",
      "startedAt": "ISO" | null,
      "finishedAt": "ISO" | null,
      "exitCode": number | null
    }
  ],
  "createdAt": "ISO",
  "updatedAt": "ISO"
}

Latencia SLA: p95 < 20 ms (lectura de JSON en memoria/disco local)
```

#### Contrato del store `usePipelineLogStore`

```typescript
interface PipelineLogState {
  /** Panel open/close */
  logPanelOpen: boolean;
  setLogPanelOpen: (open: boolean) => void;

  /** El runId que se está visualizando (null = ninguno) */
  activeRunId: string | null;
  setActiveRunId: (runId: string | null) => void;

  /** Stage seleccionado (índice 0-based) */
  selectedStageIndex: number;
  setSelectedStageIndex: (index: number) => void;

  /** Cache de logs por stage: Map<stageIndex, string> */
  stageLogs: Record<number, string>;
  setStageLog: (stageIndex: number, content: string) => void;
  clearStageLogs: () => void;

  /** Estado de carga por stage */
  stageLoading: Record<number, boolean>;
  setStageLoading: (stageIndex: number, loading: boolean) => void;

  /** Error por stage (null = sin error) */
  stageErrors: Record<number, string | null>;
  setStageError: (stageIndex: number, error: string | null) => void;
}
```

#### Función añadida a `api/client.ts`

```typescript
/**
 * Fetch log content for a specific stage.
 * @param runId   Pipeline run ID.
 * @param stageIndex  Zero-based stage index.
 * @param tail    Number of lines to return from the end (0 = full log).
 */
async function getStageLog(runId: string, stageIndex: number, tail = 500): Promise<string>
// Returns: raw text content
// Throws on 4xx/5xx
```

### 3.4 Observability

El feature es frontend-only. Se aplica observabilidad mínima:

**Métricas (client-side, logging a console en dev):**
- `[PipelineLog] poll fetched stage=${N} bytes=${len} runId=${id}` — cada ciclo de polling exitoso.
- `[PipelineLog] poll error stage=${N} status=${code}` — cada error de fetch.

**Logs estructurados del backend (ya existentes):**
- El backend ya emite `[PIPELINE] { event: "stage.started" | "stage.done" | "run.failed" }` a stderr.
- No se añaden nuevos logs de servidor.

**Trazas:**
- No aplica para este feature (sin llamadas distribuidas nuevas; todo es HTTP local).

**Herramientas:** ninguna adicional. El perfil de red del navegador (DevTools) es suficiente para diagnosticar latencia de las llamadas de polling.

### 3.5 Deploy Strategy

No se requieren cambios de infraestructura ni configuración de CI/CD adicionales.

**Pipeline CI/CD (sin cambios):**
```
lint (ESLint + tsc) → test (Vitest) → build (vite build) → deploy
```

El build de Vite incluye los nuevos componentes automáticamente. No hay variables de entorno nuevas.

**Release strategy:** rolling (el servidor Prism se reinicia con `node server.js`). No hay estado de sesión que preservar — el frontend es una SPA.

**Infrastructure as code:** no aplica (Prism es un servidor Node.js de desarrollo local, sin IaC).

---

## 4. Detalles de Implementación por Componente

### `usePipelineLogStore` (`frontend/src/stores/usePipelineLogStore.ts`)

Store Zustand con `create`. Estado inicial:
```
logPanelOpen: false
activeRunId: null
selectedStageIndex: 0
stageLogs: {}
stageLoading: {}
stageErrors: {}
```

Acción `openForRun(runId: string)`: limpia `stageLogs`, `stageErrors`, `stageLoading`,
establece `activeRunId = runId`, `selectedStageIndex = 0`, `logPanelOpen = true`.

### `usePipelineLogPolling` (`frontend/src/hooks/usePipelineLogPolling.ts`)

Hook que acepta `{ runId, stageIndex, isRunActive }`:
- `isRunActive === false` → no inicia intervalo (logs estáticos: fetch único al montar).
- `isRunActive === true` → `setInterval(fetchLog, 2000)`.
- Fetch inmediato al montar y en cada cambio de `stageIndex`.
- Limpia el intervalo en el cleanup de `useEffect`.
- Llama a `api.getStageLog(runId, stageIndex, 500)`.
- En caso de 404 `LOG_NOT_AVAILABLE`: no setea error, deja el área vacía con mensaje "Stage no iniciado aún".
- En caso de otro error: setea `stageError`.

### `PipelineLogPanel` (`frontend/src/components/pipeline-log/PipelineLogPanel.tsx`)

Estructura JSX:
```
<aside style={{ width }} className="flex flex-col border-l border-border bg-surface h-full overflow-hidden">
  <PanelHeader>        ← título "Pipeline Logs", botón collapse (×)
  <StageTabBar>        ← tabs por stage con status badge
  <LogViewer>          ← área scrollable con el log del stage activo
</aside>
```

Usa `usePanelResize({ storageKey: 'prism:panel-width:pipeline-log', defaultWidth: 480, minWidth: 320, maxWidth: 900 })`.

### `StageTabBar`

Una tab por entrada en `run.stages`. Cada tab muestra:
- Nombre corto del stage (Architect / UX / Dev / QA).
- Icono de status: `check` (completado), `progress_activity animate-spin` (running), `close` (failed), `hourglass_empty` (pending).
- Clase activa: `bg-primary/10 text-primary border-b-2 border-primary`.

Al hacer click: `setSelectedStageIndex(index)`.

El componente recibe `stageStatuses` del run (del store de `usePipelineLogStore` o del
`pipelineState` del `useAppStore` — ver Integración abajo).

### `LogViewer`

```
<pre ref={containerRef} className="flex-1 overflow-y-auto p-3 text-xs font-mono text-text-primary whitespace-pre-wrap break-words bg-surface-variant">
  {content}
</pre>
```

Auto-scroll: `containerRef.current.scrollTop = containerRef.current.scrollHeight` en cada
actualización de `content`, SÓLO si `isAtBottom === true` (calculado por onScroll handler).
Botón "Scroll to bottom" aparece cuando `isAtBottom === false`.

Cuando `content` está vacío:
- Stage pending: "Stage no iniciado aún."
- Stage running pero sin contenido: spinner + "Esperando output..."

### `PipelineLogToggle` (en `Header.tsx`)

Botón con icono `article` (Material Symbols). Visible sólo cuando `pipelineState !== null`
o `activeRunId !== null` en el log store. Al hacer click: `setLogPanelOpen(!logPanelOpen)`.

### Integración en `App.tsx`

```tsx
{logPanelOpen && <PipelineLogPanel />}
```

Añadido junto a `{historyPanelOpen && <RunHistoryPanel />}` en el flex row de paneles.

### Integración del `runId` con `useAppStore`

Cuando `startPipeline` o `executeOrchestratorRun` son llamados, se registra el `runId`
del run en el log store vía `usePipelineLogStore.getState().setActiveRunId(run.runId)`.

El `runId` del run creado por `POST /api/v1/runs` ya es devuelto en la respuesta y
almacenado en el `pipelineState`. El store de logs puede leerlo directamente de
`useAppStore.getState().pipelineState` o recibirlo como prop.

Opción preferida: el `PipelineLogPanel` lee el `runId` de `useAppStore((s) => s.pipelineState?.runId ?? null)`.
Esto evita duplicar el estado del runId y mantiene `usePipelineLogStore` independiente del
`useAppStore`. El `activeRunId` del log store es sólo un override para cuando el usuario
quiere ver logs de un run terminado en el futuro.

**Nota sobre la integración actual del runId en pipelineState:**
La interfaz `PipelineState` actual (en `types/index.ts`) NO tiene campo `runId`.
El pipeline frontend gestiona stages vía terminal (agentRun) y no llama a `POST /api/v1/runs`
directamente desde todos los flujos. La integración correcta es:
- Cuando `POST /api/v1/runs` es invocado (en `startPipeline` o `executeOrchestratorRun`
  si llaman a la API de runs), el `runId` de la respuesta se almacena en `usePipelineLogStore.setActiveRunId`.
- El `PipelineLogToggle` en el Header se muestra cuando `activeRunId !== null`.
- Si `pipelineState` no tiene `runId`, el usuario puede también pegar un runId manualmente
  (v2) o el toggle se muestra sólo cuando hay un run activo conocido.

**Decisión para T-001 (v1):** Añadir campo opcional `runId?: string` a la interfaz
`PipelineState` en `types/index.ts`. Cuando `POST /api/v1/runs` devuelve el run,
almacenar `runId` en `pipelineState`. El `PipelineLogPanel` lo lee desde allí.

---

## 5. Diagrama de Estado del Polling

```
graph TD
    A["panelOpen=false\n(sin polling)"]
    B["panelOpen=true, run running\n(polling cada 2s)"]
    C["panelOpen=true, run terminado\n(fetch único, sin intervalo)"]
    D["Error de fetch\n(muestra error, reintenta en siguiente tick)"]

    A -->|"Usuario abre panel\n+ run activo"| B
    A -->|"Usuario abre panel\n+ run terminado"| C
    B -->|"run.status != running"| C
    B -->|"Error de fetch"| D
    D -->|"Siguiente tick (2s)"| B
    B -->|"Usuario cierra panel"| A
    C -->|"Usuario cierra panel"| A
```
