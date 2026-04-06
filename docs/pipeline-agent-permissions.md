# Pipeline: Gestión de permisos y confirmaciones de agentes

## Problema

El pipeline ejecuta agentes vía `spawn('claude', ['--agent', agentId, '--print', '--enable-auto-mode'])`.
`stdin` se cierra tras escribir el task prompt. Si Claude necesita confirmación del usuario, bloquea
indefinidamente porque no hay nadie al otro lado.

Hay **dos causas distintas** que producen el mismo síntoma (cuelgue):

| Causa | Descripción |
|-------|-------------|
| **Prompts de permiso del CLI** | Claude pide confirmar Bash, escritura de archivos, uso de MCP tools, etc. Artefacto del modo interactivo del CLI. |
| **Preguntas de razonamiento del agente** | El agente usa `AskUserQuestion` porque genuinamente no sabe cómo proceder (requisitos ambiguos, decisiones de diseño, etc.). |

---

## Solución a corto plazo — `allowedTools` en el spawn

Pasar `--allowedTools` como flag en `agentResolver.js` para pre-autorizar las herramientas
que los agentes del pipeline usan de forma rutinaria.

```js
// src/agentResolver.js — modo subagent
spawnArgs = [
  '--agent', agentId,
  '--print',
  '--enable-auto-mode',
  '--allowedTools', 'Bash Edit Write Read Glob Grep mcp__prism__* mcp__stitch__* mcp__figma__*',
];
```

**Ventajas:** simple, inmediato, no requiere tocar los `.md` de los agentes.
**Limitación:** aplica a todos los agentes por igual — no es granular.

---

## Solución a medio plazo — Agentes del pipeline en el repo

El problema de fondo es que los agentes viven en `~/.claude/agents/` (propiedad del usuario),
pero el pipeline depende de que estén configurados de una manera concreta. Es fricción de
onboarding y un contrato implícito no documentado.

### Propuesta

Añadir un directorio `agents/` en el repo con las definiciones de los agentes de pipeline.
Configurar `PIPELINE_AGENTS_DIR` para que apunte ahí por defecto.

```
prism/
  agents/
    senior-architect.md    ← allowedTools declarados, versionados
    ux-api-designer.md
    developer-agent.md
    code-reviewer.md
    qa-engineer-e2e.md
```

Cada `.md` declara sus `allowedTools` en el frontmatter:

```yaml
---
name: developer-agent
model: sonnet
allowedTools:
  - Bash
  - Edit
  - Write
  - Read
  - Glob
  - Grep
  - mcp__prism__*
---
```

**Ventajas:**
- Cero configuración para el usuario — los agentes vienen con el producto
- Cada agente tiene exactamente los permisos que necesita (principio de mínimo privilegio)
- Versionados en git — cambios en permisos son auditables
- Si alguien modifica `~/.claude/agents/senior-architect.md`, el pipeline no se rompe

**Desventaja:** los usuarios no pueden personalizar los agentes del pipeline sin hacer fork.

### Compatibilidad

`PIPELINE_AGENTS_DIR` ya existe en `pipelineManager.js`. Solo hay que cambiar el valor por defecto
en `agentResolver.js`:

```js
// Antes:
const dir = agentsDir || path.join(os.homedir(), '.claude', 'agents');

// Después:
const dir = agentsDir || path.join(__dirname, '..', 'agents');
```

Los usuarios que quieran usar sus agentes personales pueden seguir usando `PIPELINE_AGENTS_DIR=~/.claude/agents/`.

---

## Solución a largo plazo — MCP tool `ask_user` (checkpoints asincrónicos)

Para las preguntas de razonamiento del agente, `allowedTools` no ayuda. Necesita un mecanismo
de comunicación async entre el agente y el usuario.

### Flujo propuesto

```
Agente llama mcp__prism__ask_user({ question: "...", runId: "..." })
  → MCP persiste la pregunta en run.json
  → run.status = "waiting_for_input"
  → MCP espera hasta que el usuario responda (long-poll)

Usuario ve la pregunta en la UI del kanban
  → escribe respuesta → POST /api/v1/runs/:runId/answer
  → MCP recibe la respuesta y la devuelve al agente

Agente continúa con el contexto de la respuesta
```

### Cambios requeridos

1. **MCP server** (`mcp/mcp-server.js`): nuevo tool `kanban_ask_user`
2. **Pipeline manager** (`src/pipelineManager.js`): nuevo estado `waiting_for_input` + endpoint `POST /api/v1/runs/:runId/answer`
3. **Frontend**: componente para mostrar preguntas pendientes y enviar respuesta
4. **Agent system prompts**: instruir a los agentes a usar `mcp__prism__ask_user` en lugar de `AskUserQuestion`

### Por qué es la dirección correcta a nivel de producto

Es el patrón que usan Devin, Linear AI y GitHub Copilot Workspace: **checkpoints asincrónicos**.
El pipeline no bloquea — la tarea queda en `waiting_for_input`. El usuario responde cuando
quiera, desde cualquier sitio. La pregunta + respuesta quedan en el historial de la tarea
para que agentes futuros tengan contexto.

---

## Tabla resumen

| Solución | Resuelve | Complejidad | Estado |
|----------|----------|-------------|--------|
| `--allowedTools` en spawn | Prompts de permiso del CLI | Baja | Por implementar |
| Agentes en el repo | Fricción de onboarding + permisos por agente | Media | Por diseñar |
| MCP `ask_user` | Preguntas de razonamiento del agente | Alta | Por diseñar |
