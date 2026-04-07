# Prism — GitHub Public Release Checklist

> Fecha de análisis: 2026-03-23 — Actualizado: 2026-04-07
> Estado: Listo para publicar

---

## Resumen ejecutivo

Prism está en excelente estado técnico para ser repositorio público: código limpio, sin secretos, dependencias mínimas (`ws` y `node-pty`), frontend completamente tipado, 142+ tests, README completo, LICENSE MIT, `.gitignore` correcto y MCP server documentado. Quedan dos tareas recomendables antes de publicar.

---

## ✅ Resuelto — Ya está hecho

### 1. README.md
Existe y cubre todos los puntos esenciales: descripción, stack, prerequisites para `node-pty` (macOS/Linux/Windows), setup paso a paso, modo dev, variables de entorno, configuración MCP para Claude Code y Claude Desktop, tests y licencia.

### 2. .gitignore
Correcto y completo: excluye `node_modules`, `dist/`, `data/` (con `.gitkeep`), `.env*`, `.claude/`, `*.log`, `agent-docs/`, `frontend/coverage/`, `.playwright-mcp/` y screenshots en raíz.

### 3. node-pty documentado
Prerequisitos bien documentados en README. El servidor degrada gracefully (devuelve 503) si `node-pty` no compila.

### 4. WebSocket origins configurables (`terminal.js:57-62`)
Ya lee `ALLOWED_ORIGINS` desde env var con fallback a localhost. `README.md` documenta la variable. Resuelto.

### 5. LICENSE
Existe: MIT License, 2026, Oscar Menéndez García.

### 6. CLAUDE.md para uso público
`CLAUDE.md` en raíz solo contiene: design system, tokens, componentes compartidos, comandos de arranque y stack. Todo útil para cualquier contribuidor. Las reglas del pipeline de agentes están en `.claude/CLAUDE.md` (git-ignorado). Resuelto.

### 7. docs/README.md
Existe y explica correctamente la estructura de `docs/`: documentación del sistema vs artefactos del pipeline por feature.

### 8. public/ legacy
Eliminado durante la migración a React+Vite. El handler estático sirve únicamente desde `dist/`.

### 9. Secretos y credenciales
Sin API keys, tokens, passwords, emails personales ni IPs privadas en archivos trackeados. `.claude/` y `.env*` git-ignorados.

### 10. Scripts de arranque
Funcionan en un clone limpio: `npm install && node server.js` levanta el backend; `cd frontend && npm install && npm run dev` el frontend en dev. Build de producción: `cd frontend && npm run build`.

---

## ⏳ Pendiente — Antes de publicar

### T-09: Corregir referencias rotas en `docs/README.md`

La tabla de documentación del sistema referencia dos archivos que fueron eliminados del repo:
- `pipeline-agent-permissions.md`
- `pipeline-known-issues.md`

**Acción:** Eliminar esas dos filas de la tabla en `docs/README.md`.

---

### T-10: Añadir `.github/` files para contribuidores

Sin estos, el repo funciona pero no tiene guía para contribuidores externos.

**Archivos a crear:**
- `.github/CONTRIBUTING.md` — convenciones de código, cómo abrir una PR, cómo correr tests
- `.github/ISSUE_TEMPLATE/bug_report.md` — template para bugs
- `.github/ISSUE_TEMPLATE/feature_request.md` — template para features

---

## 🟡 Recomendable — No bloquea publicación

### T-11: Dividir `server.js` en módulos

`server.js` concentra routing, handlers, WebSocket, terminal y lógica de negocio. Para contribuidores, separarlo en `src/routes/`, `src/handlers/` y `src/services/` facilita navegar el código.

**No es bloqueante** — el archivo actual es legible y funciona perfectamente.

---

## Checklist de tareas

| # | Tarea | Prioridad | Estado |
|---|-------|-----------|--------|
| T-01 | Crear `README.md` completo | 🔴 Bloqueante | ✅ Hecho |
| T-02 | Actualizar `.gitignore` + añadir `data/.gitkeep` | 🔴 Bloqueante | ✅ Hecho |
| T-03 | Documentar prerequisito `node-pty` en README | 🔴 Bloqueante | ✅ Hecho |
| T-04 | WebSocket origins configurables via env var | 🟠 Importante | ✅ Hecho |
| T-05 | Crear archivo `LICENSE` (MIT) | 🟠 Importante | ✅ Hecho |
| T-06 | Limpiar `CLAUDE.md` para uso público | 🟡 Recomendable | ✅ Hecho |
| T-07 | Añadir `docs/README.md` explicando estructura | 🟡 Recomendable | ✅ Hecho |
| T-08 | Resolver `public/` legacy | 🟡 Recomendable | ✅ Hecho |
| T-09 | Corregir referencias rotas en `docs/README.md` | 🟠 Importante | ✅ Hecho |
| T-10 | Añadir `.github/` files para contribuidores | 🟡 Recomendable | ✅ Hecho |
| T-11 | Dividir `server.js` en módulos | 🟡 Recomendable | ✅ Hecho |

---

## Lo que ya está bien

- Sin secretos ni credenciales en el código
- Dependencias mínimas en producción (`ws`, `node-pty`)
- Frontend completamente tipado (TypeScript strict)
- 142+ tests frontend (Vitest + RTL) + tests backend (Node.js test runner)
- Configurable via variables de entorno (`PORT`, `DATA_DIR`, `KANBAN_API_URL`, `ALLOWED_ORIGINS`)
- MCP server listo para Claude Code y Claude Desktop
- CHANGELOG.md completo y bien estructurado
- Arquitectura clara y sin frameworks innecesarios
- `.gitignore` completo — sin datos de usuario, builds ni artefactos de agentes
- `CLAUDE.md` raíz limpio y útil para colaboradores externos
