# Pipeline Known Issues & Solutions

Discovered during the `ltr-empathyai-questions / AI Carousel` pipeline run on 2026-03-26.

---

## Issue 1 — Log vacío en subagent mode (agente parece colgado)

**Síntoma:** La UI muestra "Waiting for output..." indefinidamente. El log del stage permanece vacío mientras el agente trabaja. Al abortar, se pierde todo el output.

**Causa:** El modo `subagent` no incluye `--output-format stream-json`. En modo texto, Claude bufferiza todo el output y solo escribe al final de la ejecución. Si el proceso se aborta antes de terminar, el log queda vacío.

```js
// agentResolver.js — subagent mode actual (problemático)
spawnArgs = ['--agent', agentId, '--print', '--enable-auto-mode'];

// headless mode sí lo tiene
spawnArgs = ['-p', systemPrompt, '--model', model, '--output-format', 'stream-json', '--verbose', '--enable-auto-mode'];
```

**Solución:** Añadir `--output-format stream-json --verbose` al modo subagent:
```js
spawnArgs = ['--agent', agentId, '--print', '--enable-auto-mode', '--output-format', 'stream-json', '--verbose'];
```

**Impacto:** Alto — el usuario no puede distinguir entre un agente trabajando y uno colgado.

---

## Issue 2 — Pipeline relanzado repite trabajo ya hecho

**Síntoma:** Al relanzar el pipeline tras un abort, el `developer-agent` reimplementa código que ya existía en la rama de feature. Duplica commits y puede sobreescribir trabajo válido.

**Causa:** El pipeline no verifica el estado de la rama git antes de lanzar el stage. No hay mecanismo para comunicar al agente que la implementación ya está parcialmente hecha.

**Soluciones:**

- **Corto plazo:** Incluir en el prompt del stage un resumen del estado de la rama (`git log --oneline -10` + `git status`) para que el agente lo evalúe antes de actuar.
- **Medio plazo:** Añadir un campo `resumeContext` a la task que se adjunte automáticamente al relanzar un stage interrumpido.
- **Largo plazo:** Checkpoint system — el agente persiste su estado parcial en la task (attachments) al completar cada sub-tarea, permitiendo retomar desde el último checkpoint.

**Impacto:** Medio — genera trabajo redundante y potenciales conflictos de git.

---

## Issue 3 — QA lanzado antes de que se corrijan errores de compilación

**Síntoma:** El stage `qa-engineer-e2e` arranca inmediatamente después de que `developer-agent` termina, sin validar que el código compila. El QA falla en compilación y hay que relanzarlo.

**Causa:** El pipeline no tiene ningún gate de compilación entre el developer y el QA. El developer puede generar código con errores de sintaxis (en este caso, double diamond operator y comillas sin escapar en Java) que el agente no detecta hasta intentar compilar.

**Soluciones:**

- **Corto plazo:** Añadir un stage de compilación ligero (`mvn compile -q` / `./gradlew compileJava`) entre developer y QA. Si falla, el pipeline se detiene.
- **Medio plazo:** Incluir en el prompt del `developer-agent` la instrucción explícita de compilar antes de cerrar la task (`mvn compile` o `./gradlew build`).
- **Largo plazo:** Stage `code-reviewer` (ya definido en el pipeline estándar) debería ejecutarse antes del QA e incluir verificación de compilación.

**Impacto:** Alto — obliga a relanzar el QA manualmente y alarga el ciclo.

---

## Issue 4 — PIPELINE_AGENTS_DIR no persistente

**Síntoma:** Al reiniciar el servidor Prism, `PIPELINE_AGENTS_DIR` no está seteada y el pipeline falla con `AGENT_NOT_FOUND` apuntando a un directorio temporal.

**Causa:** La variable de entorno se pasa al arrancar el servidor pero no se persiste en ningún fichero de configuración. Cualquier reinicio del proceso la pierde.

```
Error [AGENT_NOT_FOUND]: Agent 'developer-agent' not found.
Expected file: /var/folders/.../prism-pipeline-test-N68nuU/developer-agent.md
```

**Soluciones:**

- **Corto plazo:** Añadir `PIPELINE_AGENTS_DIR` al fichero `.env` o a un script de arranque (`start.sh`) que siempre incluya la variable.
- **Medio plazo:** Leer `PIPELINE_AGENTS_DIR` desde `data/settings.json` con fallback a `~/.claude/agents/`, exponiendo el valor en la UI de Settings para que sea configurable sin tocar el entorno.

**Impacto:** Medio — bloquea todos los pipelines tras un reinicio del servidor.

---

## Issue 5 — No hay forma de abortar un run desde la UI de forma fiable

**Síntoma:** El botón de Abort no siempre funciona o no es visible según el estado del run. El usuario tuvo que recurrir a `kill <pid>` desde terminal.

**Causa:** Pendiente de investigar en el código del frontend (RunIndicator / AbortButton).

**Solución:** Verificar que el endpoint `DELETE /api/v1/runs/:runId` se llama correctamente desde la UI y que el botón es accesible en todos los estados del pipeline (`running`, `pending`).

**Impacto:** Medio — obliga al usuario a intervenir manualmente por terminal.

---

## Resumen de prioridades

| # | Issue | Impacto | Esfuerzo | Prioridad |
|---|-------|---------|----------|-----------|
| 1 | Log vacío en subagent mode | Alto | Bajo (1 línea) | 🔴 P0 |
| 3 | QA sin gate de compilación | Alto | Bajo-Medio | 🔴 P0 |
| 4 | PIPELINE_AGENTS_DIR no persistente | Medio | Bajo | 🟠 P1 |
| 2 | Pipeline repite trabajo ya hecho | Medio | Alto | 🟠 P1 |
| 5 | Abort desde UI no fiable | Medio | Medio | 🟠 P1 |
