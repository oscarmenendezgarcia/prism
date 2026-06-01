---
title: Convenciones de UI
author: agent
pinned: true
created: 2026-06-01
updated: 2026-06-01
tags: [ui, design-system, tailwind]
---

## Design system (obligatorio)
- Tokens en `frontend/tailwind.config.js` + `frontend/src/index.css` (MD3: color, spacing, radius, shadow). Tema **oscuro** por defecto.
- Usar tokens, no hex: `bg-surface`, `bg-surface-elevated`, `bg-surface-variant`, `text-text-primary`, `text-text-secondary`, `border-border`, `primary`. Easing custom `ease-apple`.
- Componentes compartidos en `frontend/src/components/shared/`: `Button` (variants primary/secondary/ghost/danger/icon), `Badge`, `Modal` (portal + backdrop + escape + focus-trap), `Toast`, `Tooltip`. **Revisar shared/ antes de crear un componente nuevo.**
- Toasts: `useAppStore.getState().showToast(msg, 'success'|'error')`.

## Patrón de panel lateral (IMPORTANTE — consistencia)
Todos los paneles laterales (Config, Runs, AgentSettings, **Folio**) comparten el mismo patrón. Al crear/editar un panel:
- Root: `relative flex flex-col bg-surface-elevated border-l border-border h-full shrink-0 w-[var(--panel-w)]`.
- Ancho redimensionable vía el hook `usePanelResize({ storageKey: 'prism:panel-width:<name>', defaultWidth, minWidth, maxWidth })` + un handle `role="separator"` en el borde izquierdo (`onMouseDown={handleMouseDown}`).
- Animación de entrada: token compartido `[animation:var(--animate-panel-in)]` — NO inventar una propia.
- El panel **posee su root** (se renderiza directo en `App.tsx`, sin wrapper).

## Animación / feel
Solo `transform`/`opacity` (GPU). Transiciones con propiedades específicas, no `transition-all`. `:active` con `scale(~0.99)` en pulsables. Popovers origin-aware (`origin-top-right` + `starting:` para `@starting-style`). Modales centrados (delegan al `<Modal>` compartido).
