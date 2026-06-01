---
title: Comandos — arrancar y testear
author: agent
pinned: true
created: 2026-06-01
updated: 2026-06-01
tags: [comandos, run, tests]
---

## Arrancar
```bash
# Producción (sirve dist/ compilado)
node server.js                     # → http://localhost:3000

# Desarrollo (Vite HMR + proxy al backend)
node server.js &
cd frontend && npm run dev         # → http://localhost:5173
```

## Tests
```bash
npm run test:report                # backend, output compacto (preferido)
npm test                           # backend, TAP completo
cd frontend && npm test            # frontend (Vitest)
cd frontend && npm run build       # compila dist/ (TS + Vite)
```

## Reglas operativas
- **Matar instancias previas antes de arrancar:** `pkill -f "node server.js"` (el puerto 3000 no se libera solo). O arrancar solo si no hay proceso: `pgrep -f "node server.js" >/dev/null || node server.js &`.
- **No reiniciar el server mientras corren agentes** — pierden la conexión MCP y fallan en silencio.
- **Rebuild de `dist/` tras tocar el frontend** — el server sirve `dist/`, no la fuente. Sin rebuild, ves el bundle viejo (causa típica de "mi cambio no aparece"). `dist/` es gitignored, persiste en disco entre reinicios.
- Rutas nuevas en `routes/index.js` requieren **reiniciar el server** para registrarse.
