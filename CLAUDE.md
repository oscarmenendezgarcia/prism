# Prism — Project Rules

## Folio — design spec (READ FIRST for any Folio task)

The **Folio** feature (a navigable, augmentable knowledge base for agents) is being
built under `src/services/folio/` + `mcp/folio-tools.js`. Its complete, authoritative
design lives in the **`.folio/` directory at the repo root** — a working example of the
format itself (chapter = folder, page = `.md` with YAML frontmatter).

**Before implementing ANY Folio task, read `.folio/` and treat it as the spec.** Key pages:
- `.folio/arquitectura/modulo.md` — module layout, isolation rules, extraction plan
- `.folio/arquitectura/storage-backend.md` — pluggable SQLite vs file backend
- `.folio/arquitectura/indexacion-fts5.md` — FTS5 in the core, in-memory vs cache
- `.folio/modelo-datos/schema.md` — schema (core keys on `folio_id`, NOT `space_id`)
- `.folio/modelo-datos/referencias.md` — `[[chapter/page]]` / `[[chapter/page#section]]`
- `.folio/inyeccion/` — stage-aware injection by confidence tier
- `.folio/decisiones/log.md` — every closed decision and why
- `.folio/estado/actual.md` — current state + task order

Do not re-derive these decisions; honour them. Document any deviation in the task notes.

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

## Agent Pipeline Rules

> ⚠️ **CRITICAL — Never run test commands as background tasks (`run_in_background: true`).**
> Session compaction kills background processes mid-run; the pipeline stage stalls with no output and no error.
> Always run `npm test`, `npm run test:report`, and `node --test` **synchronously (foreground)**.
> For long-running test suites, use `npm run test:report` which emits a compact summary instead of raw TAP output.
