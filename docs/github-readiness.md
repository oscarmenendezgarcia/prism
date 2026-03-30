# Prism — GitHub Public Release Checklist

> Fecha de análisis: 2026-03-23 — Actualizado: 2026-03-30
> Estado: En preparación

---

## Resumen ejecutivo

Prism está en buen estado técnico: arquitectura limpia, sin secretos, dependencias mínimas (solo `ws` y `node-pty`), frontend completamente tipado y 142+ tests. Los bloqueantes para publicación son principalmente documentación y configuración del repositorio.

---

## 🔴 Bloqueantes — Sin esto no es usable

### 1. README.md
**No existe.** Es el primer punto de contacto para cualquier usuario externo.

Debe cubrir:
- Descripción del proyecto + screenshot
- Arquitectura en una línea (Node.js HTTP + React 19 + Tailwind + MCP)
- **Prerequisitos:** Node.js ≥18, `node-gyp` (para `node-pty`)
  - macOS: `xcode-select --install`
  - Linux: `sudo apt install build-essential python3`
  - Windows: `npm install --global windows-build-tools`
- **Setup:**
  ```bash
  npm install
  cd frontend && npm install && npm run build && cd ..
  node server.js
  # → http://localhost:3000
  ```
- **Dev mode:**
  ```bash
  node server.js &
  cd frontend && npm run dev   # → http://localhost:5173
  ```
- **Variables de entorno:**

  | Variable | Default | Descripción |
  |----------|---------|-------------|
  | `PORT` | `3000` | Puerto del servidor HTTP |
  | `DATA_DIR` | `./data` | Directorio de persistencia |
  | `KANBAN_API_URL` | `http://localhost:3000/api/v1` | URL base para MCP |

- **MCP (Claude Code / Claude Desktop):** cómo configurarlo en `settings.json`
- **Tests:** `npm test` (backend) / `cd frontend && npm test` (frontend)
- **Licencia**

---

### 2. `.gitignore` incompleto

Actualmente solo excluye `node_modules`. Están commiteados `data/` y `dist/`, lo que supone:
- Datos de usuario reales en el repo
- Build artifacts duplicados innecesariamente

**Añadir:**
```gitignore
dist/
data/
.env
.env.local
.env.*.local
.claude/
*.log
```

**Nota:** Añadir `data/.gitkeep` para que el directorio se cree vacío en el primer clone.

---

### 3. `node-pty` requiere compilación nativa

Es la dependencia más problemática. `node-pty` compila C++ nativo con `node-gyp` y **falla silenciosamente** en entornos sin las build tools.

**Acciones:**
- Documentar prerequisitos claramente en el README (ver arriba)
- Evaluar si el terminal integrado puede ser **opcional** (la app funciona sin él; es una feature sobre el core del kanban)
- Añadir mensaje de error claro en `terminal.js` si `node-pty` no está disponible

---

## 🟠 Importantes — Experiencia de usuario

### 4. WebSocket origins hardcodeados

**Archivo:** `terminal.js:56-59`

```js
const LOCALHOST_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);
```

Bloquea cualquier deployment en un host o puerto distinto al por defecto (servidor remoto, Docker, Nginx reverse proxy).

**Solución:** Leer desde env var con fallback:
```js
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? new Set(process.env.ALLOWED_ORIGINS.split(','))
  : new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
```

---

### 5. LICENSE

No hay ningún archivo `LICENSE`. Sin licencia explícita, el proyecto es técnicamente "todos los derechos reservados" aunque sea público.

**Acción:** Crear `LICENSE` con MIT (lo más común para proyectos open source de este tipo).

---

### 6. `data/` no se inicializa automáticamente documentado

El servidor crea `data/spaces.json` en el primer arranque si no existe, pero no está documentado. Un usuario que clone el repo verá que `data/` no existe y puede pensar que algo falló.

**Acciones:**
- Añadir `data/.gitkeep` al repo (con `data/` en `.gitignore` excepto el `.gitkeep`)
- Añadir nota en README: "El directorio `data/` se crea automáticamente al arrancar"

---

## 🟡 Recomendables — Calidad del repo

### 7. `CLAUDE.md` expone workflow interno

El fichero contiene reglas del pipeline de desarrollo con Anthropic agents (arquitecto, diseñador, QA). Esto es confuso para contribuidores externos que no usan Claude Code con ese workflow.

**Opciones:**
- Mover las reglas de agentes a `.claude/CLAUDE.md` (ignorado por `.gitignore`)
- Dejar en `CLAUDE.md` solo lo relevante para cualquier contribuidor: design system, stack, comandos de arranque

---

### 8. `docs/` contiene 60+ artefactos de diseño interno

ADRs, blueprints, wireframes de más de 15 features. Es valioso como documentación de decisiones, pero puede abrumar a un nuevo contribuidor.

**Acción:** Añadir `docs/README.md` explicando la estructura: "Estos ficheros son artefactos del proceso de diseño iterativo. Cada carpeta corresponde a una feature."

---

### 9. `public/` legacy — RESUELTO

El directorio `public/` (que contenía `app.js`, `spaces.js`, `style.css` del frontend original pre-React) ya no existe. Fue eliminado durante la migración a React+Vite.

`src/handlers/static.js` sirve assets únicamente desde `dist/` (build de Vite) y documenta explícitamente la eliminación en el comentario de la constante `PUBLIC_DIR`.

---

### 10. `CHANGELOG.md`

Existe y está completo. Solo necesita estar referenciado desde el README con un enlace.

---

## Checklist de tareas

| # | Tarea | Prioridad | Estado |
|---|-------|-----------|--------|
| T-01 | Crear `README.md` completo | 🔴 Bloqueante | ✅ Hecho |
| T-02 | Actualizar `.gitignore` + añadir `data/.gitkeep` | 🔴 Bloqueante | ✅ Hecho |
| T-03 | Documentar prerequisito `node-pty` en README | 🔴 Bloqueante | ✅ Hecho |
| T-04 | WebSocket origins configurables via env var | 🟠 Importante | ⏳ Pendiente |
| T-05 | Crear archivo `LICENSE` (MIT) | 🟠 Importante | ✅ Hecho |
| T-06 | Limpiar `CLAUDE.md` para uso público | 🟡 Recomendable | ⏳ Pendiente |
| T-07 | Añadir `docs/README.md` explicando estructura | 🟡 Recomendable | ⏳ Pendiente |
| T-08 | Resolver `public/` legacy (eliminar o documentar) | 🟡 Recomendable | ✅ Hecho |
| T-09 | Dividir `server.js` en módulos (`routes/`, `services/`) | 🟡 Recomendable | ⏳ Pendiente |
| T-10 | Consolidar changelogs sueltos en root | 🟡 Recomendable | ⏳ Pendiente |

---

## Lo que ya está bien

- Sin secretos ni credenciales en el código
- Dependencias mínimas en producción (`ws`, `node-pty`)
- Frontend completamente tipado (TypeScript)
- 142 tests frontend + 8 ficheros de tests backend
- Configurable via variables de entorno (`PORT`, `DATA_DIR`, `KANBAN_API_URL`)
- MCP server listo para Claude Code y Claude Desktop
- CHANGELOG.md completo
- Arquitectura clara y sin frameworks innecesarios
