# User Stories: Pipeline Log Viewer

## Personas

**Persona primaria: El Desarrollador Local**
- Perfil: desarrollador tecnico, usuario unico de Prism en su maquina local.
- Goal: monitorear el progreso de sus pipelines de agentes sin abrir terminales adicionales.
- Frustracion: tener que hacer `tail -f data/runs/*/stage-3.log` en una terminal separada para ver que esta haciendo el agente.
- Nivel tecnico: alto — entiende el output crudo de Claude CLI y disfruta verlo.

---

## Epicas

### Epic 1: Panel de Logs Visible en la UI

#### Story E1-S1: Abrir el panel de logs desde el Header

**Como** desarrollador que ha lanzado un pipeline,
**quiero** hacer click en un boton en el Header para ver los logs del pipeline activo,
**para que** pueda monitorear el progreso sin salir de Prism ni abrir una terminal.

**Acceptance Criteria:**
1. El boton con icono `article` es visible en el Header SOLO cuando `pipelineState !== null`.
2. Al hacer click, el panel `PipelineLogPanel` aparece a la derecha del board (480px, mismo patron que TerminalPanel).
3. El panel muestra el tab del stage actualmente en ejecucion seleccionado por defecto.
4. El panel NO bloquea la interaccion con el kanban board.
5. El boton muestra estado activo (pill azul) cuando el panel esta abierto.
6. El boton no esta presente cuando no hay pipeline activo.

**Definition of Done:**
- Componente `PipelineLogToggle` implementado en `Header.tsx`.
- Store `usePipelineLogStore` con `logPanelOpen` persistido en memoria.
- El panel monta con `logPanelOpen === true` y se desmonta con `logPanelOpen === false`.
- Test unitario: toggle visible con pipeline activo, oculto sin pipeline.

**Prioridad:** Must
**Story Points:** 3

---

#### Story E1-S2: Cerrar el panel de logs

**Como** desarrollador que esta viendo logs,
**quiero** poder cerrar el panel de logs facilmente,
**para que** recupere el espacio del board cuando no necesito monitorear.

**Acceptance Criteria:**
1. El boton × en el header del panel cierra el panel (llama a `setLogPanelOpen(false)`).
2. Hacer click en el toggle del Header cuando el panel esta abierto tambien lo cierra.
3. El panel NO se cierra al hacer click fuera de el (no es un modal).
4. Al cerrar, el board recupera el espacio de forma inmediata (no hay animacion de cierre requerida en v1).

**Definition of Done:**
- Boton × funcional en `PipelineLogPanel`.
- Toggle actua como switch (abre/cierra).
- Test unitario: click × cierra panel.

**Prioridad:** Must
**Story Points:** 1

---

#### Story E1-S3: Redimensionar el panel de logs

**Como** desarrollador que revisa logs largos,
**quiero** poder ajustar el ancho del panel de logs,
**para que** pueda ver mas contenido de logs o mas contenido del board segun mi necesidad.

**Acceptance Criteria:**
1. El panel es redimensionable mediante drag en su borde izquierdo.
2. Ancho minimo: 320px. Ancho maximo: 900px. Ancho por defecto: 480px.
3. El ancho se persiste en `localStorage` con la clave `prism:panel-width:pipeline-log`.
4. El resize usa el mismo mecanismo que `TerminalPanel` (`usePanelResize`).

**Definition of Done:**
- `usePanelResize({ storageKey: 'prism:panel-width:pipeline-log', defaultWidth: 480, minWidth: 320, maxWidth: 900 })` integrado en `PipelineLogPanel`.

**Prioridad:** Should
**Story Points:** 1

---

### Epic 2: Navegacion por Stages

#### Story E2-S1: Seleccionar el stage a visualizar

**Como** desarrollador que sigue un pipeline de 4 stages,
**quiero** poder hacer click en cada tab de stage para ver sus logs,
**para que** pueda revisar el output de cualquier stage sin importar cual esta activo.

**Acceptance Criteria:**
1. El `StageTabBar` muestra un tab por stage (4 en total: Architect, UX, Dev, QA).
2. Cada tab muestra el nombre corto del stage y un icono de status.
3. Hacer click en un tab cambia `selectedStageIndex` en el store.
4. Al cambiar de tab, el log del nuevo stage se carga inmediatamente (fetch inmediato, sin esperar el intervalo de 2s).
5. El tab del stage actualmente en ejecucion tiene el icono `progress_activity` con `animate-spin`.
6. El tab activo (seleccionado) tiene `bg-primary/10 text-primary border-b-2 border-primary`.

**Definition of Done:**
- `StageTabBar` implementado con props correctos.
- `usePipelineLogPolling` hace fetch inmediato al cambiar `stageIndex`.
- Test unitario: click en tab llama `onSelect(index)`, tab activo tiene clase correcta.

**Prioridad:** Must
**Story Points:** 2

---

#### Story E2-S2: Ver el status de cada stage de un vistazo

**Como** desarrollador,
**quiero** que los tabs me indiquen el estado de cada stage con un icono,
**para que** sepa de un vistazo si un stage ha terminado, esta fallido o aun esta pendiente.

**Acceptance Criteria:**
1. `completed` → icono `check_circle` en color success (#28CD41).
2. `running` → icono `progress_activity` con `animate-spin` en color primary (#0A84FF).
3. `failed` → icono `close` en color error (#FF3B30).
4. `timeout` → icono `timer_off` en color warning (#FF9500).
5. `pending` → icono `hourglass_empty` en color text-secondary.
6. Los iconos son siempre visibles, no solo on hover.
7. El status se comunica con icono + color, NUNCA solo con color (WCAG 1.4.1).

**Definition of Done:**
- Todos los estados mapeados en `StageTabBar`.
- Los iconos son `aria-hidden="true"` con texto del tab como fuente de verdad.
- Test unitario: icono correcto para cada status.

**Prioridad:** Must
**Story Points:** 1

---

### Epic 3: Visualizacion de Logs en Tiempo Real

#### Story E3-S1: Ver logs actualizandose en tiempo real

**Como** desarrollador que espera que un stage termine,
**quiero** que el log del stage activo se actualice automaticamente cada 2 segundos,
**para que** no tenga que recargar manualmente para ver el progreso.

**Acceptance Criteria:**
1. Mientras `run.status === 'running'`, el hook `usePipelineLogPolling` hace un fetch cada 2000ms.
2. Cada fetch reemplaza el contenido del log en el store (`setStageLog`).
3. El polling se detiene automaticamente cuando `run.status !== 'running'`.
4. Si el panel esta cerrado, el polling NO se ejecuta (hook desmontado).
5. Si el stage cambia, el intervalo del stage anterior se limpia y se inicia un fetch inmediato del nuevo stage.
6. El log es el contenido crudo de `text/plain` del endpoint — sin procesamiento adicional.

**Definition of Done:**
- `usePipelineLogPolling` implementado con `setInterval` y cleanup en `useEffect`.
- Test con fake timers: polling cada 2s, limpieza al desmontar.
- Console log en dev: `[PipelineLog] poll fetched stage=${N} bytes=${len}`.

**Prioridad:** Must
**Story Points:** 3

---

#### Story E3-S2: Auto-scroll al fondo mientras llegan nuevos logs

**Como** desarrollador que monitorea logs en vivo,
**quiero** que el visor de logs haga scroll automatico al fondo cuando llegan nuevas lineas,
**para que** vea siempre el output mas reciente sin tener que hacer scroll manualmente.

**Acceptance Criteria:**
1. Cuando `content` cambia y `isAtBottom === true`, el visor hace scroll a `scrollHeight` automaticamente.
2. Si el usuario ha scrolleado arriba manualmente, el auto-scroll NO dispara (respeta la posicion del usuario).
3. El threshold para considerar "al fondo" es `scrollTop + clientHeight >= scrollHeight - 20px`.

**Definition of Done:**
- `LogViewer` con `containerRef`, `isAtBottom` state, y `onScroll` handler.
- `useEffect` que ejecuta el auto-scroll solo si `isAtBottom`.
- Test: auto-scroll dispara con content nuevo, NO dispara si `isAtBottom = false`.

**Prioridad:** Must
**Story Points:** 2

---

#### Story E3-S3: Volver al fondo del log cuando el usuario ha scrolleado arriba

**Como** desarrollador que reviso logs anteriores mientras el pipeline sigue corriendo,
**quiero** un boton para volver al final del log,
**para que** retome el monitoreo en tiempo real sin tener que hacer scroll manual hasta el fondo.

**Acceptance Criteria:**
1. Cuando `isAtBottom === false`, aparece un boton "Scroll to bottom" en `position: absolute; bottom: 12px; right: 12px` del log area.
2. El boton tiene icono `keyboard_arrow_down` + texto "Scroll to bottom".
3. Al hacer click: `scrollTop = scrollHeight` y `isAtBottom = true` (auto-scroll se reactiva).
4. El boton desaparece cuando el usuario esta al fondo (`isAtBottom === true`).
5. El boton es sutil: `bg-surface-elevated border border-border text-text-secondary text-xs`.

**Definition of Done:**
- Boton condicional en `LogViewer`.
- Click handler restaura scroll y estado.
- Test: boton visible con `isAtBottom=false`, oculto con `isAtBottom=true`, click restaura.

**Prioridad:** Must
**Story Points:** 1

---

### Epic 4: Estados de Carga y Error

#### Story E4-S1: Ver estado de espera cuando un stage aun no ha empezado

**Como** desarrollador que navego al tab de un stage pendiente,
**quiero** ver un mensaje claro de que el stage no ha comenzado,
**para que** sepa que no hay nada que ver aun (no es un error).

**Acceptance Criteria:**
1. Cuando el stage tiene `status === 'pending'` y el log esta vacio, el log area muestra:
   - Icono `hourglass_empty` (text-secondary).
   - Texto "Stage not started yet." en text-secondary, Inter 13px.
2. No hay spinner — el estado es estatico.
3. El endpoint puede devolver `404 LOG_NOT_AVAILABLE` — esto se trata como estado pending, no como error.

**Definition of Done:**
- `LogViewer` con prop `isPending` muestra el empty state correcto.
- `usePipelineLogPolling` captura `LogNotAvailableError` y no setea `stageError`.
- Test: `isPending=true, content=""` → muestra "Stage not started yet.".

**Prioridad:** Must
**Story Points:** 1

---

#### Story E4-S2: Ver spinner cuando el stage esta corriendo pero aun no hay output

**Como** desarrollador que acaba de abrir el panel justo cuando empezo un stage,
**quiero** ver un indicador de que el sistema esta esperando output,
**para que** sepa que el pipeline esta activo y el log llegara pronto.

**Acceptance Criteria:**
1. Cuando `isRunning === true` y `content === ""`, el log area muestra:
   - Spinner CSS con `animate-spin`, color primary (#0A84FF), 20px.
   - Texto "Waiting for output..." en text-secondary, Inter 13px.
2. En cuanto `content` tenga contenido, el spinner desaparece y se muestra el log.

**Definition of Done:**
- `LogViewer` con prop `isRunning` muestra spinner state.
- Test: `isRunning=true, content=""` → muestra spinner.

**Prioridad:** Must
**Story Points:** 1

---

#### Story E4-S3: Ver mensaje de error cuando el fetch falla

**Como** desarrollador que esta monitoreando logs,
**quiero** ver un mensaje claro cuando no se puede cargar el log,
**para que** sepa que hay un problema temporal y que el sistema lo reintentara.

**Acceptance Criteria:**
1. Cuando `error !== null`, el log area muestra:
   - Icono `error_outline` en color error (#FF3B30).
   - Texto "No se pudo cargar el log." en text-primary, 13px.
   - Texto "El servidor no respondio. Se reintentara automaticamente." en text-secondary, 11px.
2. NO hay boton de reintento manual — el polling reintenta cada 2s automaticamente.
3. El mensaje NO expone el error tecnico interno (sin stack traces ni codigos HTTP).
4. Si el siguiente poll tiene exito, el error desaparece y el log se muestra.

**Definition of Done:**
- `LogViewer` con prop `error: string | null` muestra error state.
- `usePipelineLogPolling` llama a `setStageError` en errores != `LogNotAvailableError`.
- Si el siguiente fetch tiene exito, llama a `setStageError(stageIndex, null)`.
- Test: error state mostrado con `error !== null`, desaparece cuando error vuelve a null.

**Prioridad:** Must
**Story Points:** 1

---

### Epic 5: Run Completado

#### Story E5-S1: Ver logs estaticos cuando el pipeline ha terminado

**Como** desarrollador que abrio el panel despues de que el pipeline termino,
**quiero** poder navegar por los logs de todos los stages sin que haya polling activo,
**para que** pueda revisar el output completo sin consumir recursos innecesarios.

**Acceptance Criteria:**
1. Cuando `run.status !== 'running'` (completed / failed / interrupted), el polling se detiene.
2. Al abrir el panel con un run terminado, se hace un fetch unico de cada stage al seleccionarlo.
3. Todos los tabs muestran su icono de status final (check / close / timeout).
4. No hay spinner — el estado es estatico una vez cargado.
5. El log se puede scrollear libremente.

**Definition of Done:**
- `usePipelineLogPolling` con `isRunActive=false` hace fetch unico (sin interval).
- Test: `isRunActive=false` → un solo fetch al montar, sin intervalo posterior.

**Prioridad:** Must
**Story Points:** 1

---

## Resumen de Prioridades (MoSCoW)

| Story | Prioridad | SP |
|-------|-----------|----|
| E1-S1: Abrir panel | Must | 3 |
| E1-S2: Cerrar panel | Must | 1 |
| E1-S3: Redimensionar panel | Should | 1 |
| E2-S1: Seleccionar stage | Must | 2 |
| E2-S2: Status de stages | Must | 1 |
| E3-S1: Polling en tiempo real | Must | 3 |
| E3-S2: Auto-scroll | Must | 2 |
| E3-S3: Boton scroll to bottom | Must | 1 |
| E4-S1: Estado pending | Must | 1 |
| E4-S2: Estado waiting | Must | 1 |
| E4-S3: Estado error | Must | 1 |
| E5-S1: Run completado | Must | 1 |

**Total Must:** 17 SP
**Total Should:** 1 SP
**Total:** 18 SP
