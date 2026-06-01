---
title: Commands — Running and Testing
author: agent
pinned: true
created: 2026-06-01
updated: 2026-06-01
tags: [comandos, run, tests]
---

## Running
```bash
# Production (serves the compiled dist/)
node server.js                     # → http://localhost:3000

# Development (Vite HMR + proxy to the backend)
node server.js &
cd frontend && npm run dev         # → http://localhost:5173
```

## Tests
```bash
npm run test:report                # backend, compact output (preferred)
npm test                           # backend, full TAP
cd frontend && npm test            # frontend (Vitest)
cd frontend && npm run build       # builds dist/ (TS + Vite)
```

## Operational rules
- **Kill previous instances before starting:** `pkill -f "node server.js"` (port 3000 won't free itself). Or start only if there's no process: `pgrep -f "node server.js" >/dev/null || node server.js &`.
- **Do not restart the server while agents are running** — they lose the MCP connection and fail silently.
- **Rebuild `dist/` after touching the frontend** — the server serves `dist/`, not the source. Without a rebuild, you see the old bundle (the classic cause of "my change isn't showing up"). `dist/` is gitignored and persists on disk between restarts.
- New routes in `routes/index.js` require **restarting the server** to be registered.
