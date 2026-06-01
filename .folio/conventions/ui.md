---
title: UI Conventions
author: agent
pinned: true
created: 2026-06-01
updated: 2026-06-01
tags: [ui, design-system, tailwind]
---

## Design system (mandatory)
- Tokens in `frontend/tailwind.config.js` + `frontend/src/index.css` (MD3: color, spacing, radius, shadow). **Dark** theme by default.
- Use tokens, not hex: `bg-surface`, `bg-surface-elevated`, `bg-surface-variant`, `text-text-primary`, `text-text-secondary`, `border-border`, `primary`. Custom easing `ease-apple`.
- Shared components in `frontend/src/components/shared/`: `Button` (variants primary/secondary/ghost/danger/icon), `Badge`, `Modal` (portal + backdrop + escape + focus-trap), `Toast`, `Tooltip`. **Check shared/ before creating a new component.**
- Toasts: `useAppStore.getState().showToast(msg, 'success'|'error')`.

## Side-panel pattern (IMPORTANT — consistency)
All side panels (Config, Runs, AgentSettings, **Folio**) share the same pattern. When creating/editing a panel:
- Root: `relative flex flex-col bg-surface-elevated border-l border-border h-full shrink-0 w-[var(--panel-w)]`.
- Resizable width via the `usePanelResize({ storageKey: 'prism:panel-width:<name>', defaultWidth, minWidth, maxWidth })` hook + a `role="separator"` handle on the left edge (`onMouseDown={handleMouseDown}`).
- Entry animation: shared token `[animation:var(--animate-panel-in)]` — do NOT invent your own.
- The panel **owns its root** (it renders directly in `App.tsx`, with no wrapper).

## Animation / feel
Only `transform`/`opacity` (GPU). Transitions with specific properties, not `transition-all`. `:active` with `scale(~0.99)` on clickable elements. Origin-aware popovers (`origin-top-right` + `starting:` for `@starting-style`). Centered modals (delegated to the shared `<Modal>`).
