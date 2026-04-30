# Prism — Project Rules

## Design System (MANDATORY)

Every UI task MUST use the design system defined in `frontend/tailwind.config.js` and `frontend/src/index.css`.

- **Tokens:** `frontend/tailwind.config.js` — MD3 color, spacing, radius, shadow
- **Shared components:** `frontend/src/components/shared/` — Button, Badge, Modal, Toast, ContextMenu

### Rules

1. **Tailwind CSS only** — no inline styles. Tokens: `bg-surface`, `bg-surface-elevated`, `text-primary`, `text-text-primary`, `text-text-secondary`, `border-border`. Dark theme is the default.

2. **Reuse shared components:**
   - `<Button variant="primary|secondary|ghost|danger|icon">`
   - `<Badge type="task|research|done">`
   - `<Modal>` — handles portal, backdrop, Escape key, focus trap
   - Toasts: `useAppStore.getState().showToast(message, 'success'|'error')`

3. **Before adding a new component**, check `frontend/src/components/` for existing ones.

4. **Fonts already loaded** in `frontend/index.html`: Inter, JetBrains Mono, Material Symbols Outlined. No duplicate imports.

5. **No `style={{}}` attributes** — use Tailwind arbitrary values (`bg-[#hex]`, `w-[480px]`) instead.

---

## Starting the app

```bash
# Production (serves built frontend from dist/)
node server.js        # → http://localhost:3000

# Development (Vite HMR + proxy to backend)
node server.js &
cd frontend && npm run dev   # → http://localhost:5173
```

---

## Stack

- **Backend:** Node.js native HTTP (no framework) — `server.js`
- **Persistence:** SQLite — `data/prism.db` (via `better-sqlite3`). Auto-migrated from JSON on first run. Managed by `src/services/store.js` + `src/services/migrator.js`.
- **Frontend:** React 19 + TypeScript + Tailwind CSS v4 + Vite + Zustand (`frontend/`)
- **Build output:** `dist/` (served by backend in production)
- **Frontend tests:** `cd frontend && npm test` (Vitest + React Testing Library)
- **Backend tests:** `npm test` (Node.js `node:test` runner)
