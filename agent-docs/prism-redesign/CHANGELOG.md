# Prism Redesign — Changelog

> **Rollback pointer:** to undo the entire redesign, revert the feature branch
> merge to `main` (`git revert -m 1 <merge-commit-sha>`). All redesign changes
> are isolated to `feature/prism-redesign` — no backend or store changes.

---

## Summary

Clean-slate UI redesign of the Prism frontend. Pure presentation-layer rewrite:
design tokens, shared primitives, and component visuals replaced with the
**Trend A** dark palette (indigo-violet accent, near-black surfaces, rich motion
system). No store shape changes, no API changes, no new features.

---

## Token system (`frontend/src/index.css`)

### Added token namespaces

| Namespace | Purpose |
|---|---|
| `--color-background` | Deep navy-black page background |
| `--color-surface` | Card / column fill |
| `--color-surface-elevated` | Modal / dropdown / popover fill |
| `--color-surface-variant` | Subtle hover-state fill |
| `--color-surface-sunken` | Textarea / code-block fill |
| `--color-text-primary/secondary/tertiary/disabled` | Text hierarchy |
| `--color-on-surface` / `--color-on-primary` | Text on colored surfaces |
| `--color-primary` / `*-hover` / `*-active` / `*-container` / `*-ring` | Indigo-violet accent scale (`#7C6DFA`) |
| `--color-secondary` | Muted action color |
| `--color-border` / `--color-border-strong` / `--color-border-subtle` / `--color-border-focus` | Border hierarchy |
| `--color-success` / `--color-error` / `--color-warning` / `--color-info` | Semantic feedback colors |
| `--color-success-container` / `--color-error-container` | Semantic tint fills |
| `--color-col-todo` / `--color-col-in-progress` / `--color-col-done` | Column accent colors |
| `--color-agent-*` (developer, architect, ux, reviewer, qa, human) | Per-agent badge colors |
| `--color-badge-*-text` | Badge foreground colors |
| `--shadow-card` / `--shadow-modal` / `--shadow-popover` | Elevation shadows |
| `--radius-sm/md/lg/xl/full/modal/card` | Border-radius scale |
| `--font-sans` / `--font-mono` | Type families |
| `--duration-fast/base/slow/slower` | Motion duration tokens |
| `--ease-default/in/out/spring/bounce` | Easing tokens |
| `--animate-badge-pop` / `--animate-modal-in/out` / `--animate-toast-in/out` / `--animate-tab-indicator` / `--animate-drop-pulse` / `--animate-empty-pulse` | Named animation tokens |

### Removed / renamed tokens (old → new)

| Old token | New token | Note |
|---|---|---|
| Apple-HIG blue `#1a73e8` primary | `#7C6DFA` indigo-violet | Full palette swap |
| `--color-bg` | `--color-background` | Renamed |
| `--color-surface-light` / `-dark` | `--color-surface` + `html.dark` overrides | Theme approach changed |
| Scattered hard-coded `rgba(...)` shadows | `--shadow-card/modal/popover` tokens | Centralised |
| Numeric radius vars `--radius-1` … | Semantic scale `--radius-sm` … `--radius-full` | Renamed |
| Old `--transition-*` vars | `--duration-*` + `--ease-*` tokens | Split for composability |

### Light-mode overrides

`html:not(.dark)` block defines light-mode counterparts for every surface, text,
border, and shadow token. Dark mode (`.dark` on `<html>`) is the **default**.

---

## Motion system

All animations are expressed as CSS `@keyframes` + `animation` shorthand stored
in `--animate-*` tokens. Components reference these tokens via Tailwind's
`animate-[var(--animate-x)]` utility.

**`prefers-reduced-motion` contract:**  
A single `@media (prefers-reduced-motion: reduce)` block at the bottom of
`index.css` overrides every `--animate-*` token to `none 0s`. No per-component
media-query checks needed.

---

## Rewritten files

| File | Change |
|---|---|
| `frontend/src/index.css` | Full `@theme` token rewrite — Trend A palette + motion scale |
| `frontend/src/components/shared/Badge.tsx` | Token-driven variants, `--animate-badge-pop` on mount |
| `frontend/src/components/shared/Toast.tsx` | Semantic colors, `--animate-toast-in/out`, bottom-center positioning |
| `frontend/src/components/agent-run-history/RunHistoryPanel.tsx` | Token colours, panel-width CSS-custom-prop pattern |
| `frontend/src/components/modals/TaggerReviewModal.tsx` | Token colours throughout |
| `frontend/src/components/pipeline-log/LogViewer.tsx` | Surface + text token classes |

---

## Lint gate (T-014)

New script: **`frontend/scripts/check-design-invariants.mjs`**

Enforces blueprint §7 invariants:

1. **No `style={{...}}`** in `frontend/src/**/*.tsx`  
   Exception: add `// lint-ok: <reason>` on the same line.  
   Approved categories: CSS-custom-property injection (`--panel-w`), runtime-computed
   positions from `getBoundingClientRect()`, `fontVariationSettings`.

2. **No raw hex literals** (`#RGB` / `#RRGGBB` / `#RRGGBBAA`) in TSX files.  
   Route all colors through `bg-[var(--color-x)]` or Tailwind token utilities.

Wired into `npm run build` via the `prebuild` lifecycle hook.  
Also available as a standalone command: `npm run lint:design`.

### Current approved exceptions (`// lint-ok:` annotated)

| File | Line | Reason |
|---|---|---|
| `AgentSettingsPanel.tsx` | 108 | CSS custom property `--panel-w` for resize |
| `ConfigPanel.tsx` | 87 | CSS custom property `--panel-w` for resize |
| `PipelineLogPanel.tsx` | 185 | CSS custom property `--panel-w` for resize |
| `RunHistoryPanel.tsx` | 68 | CSS custom property `--panel-w` for resize |
| `AgentLauncherMenu.tsx` | 124 | Runtime position from `getBoundingClientRect()` |
| `TaggerReviewModal.tsx` | 278 | `fontVariationSettings` — no Tailwind utility |

---

## Seed script

New script: **`scripts/seed-demo.js`**

Populates a fresh Prism instance with realistic demo data across three spaces
(`Frontend`, `Backend API`, `DevOps`) for screenshots and GIF recordings.

```bash
node scripts/seed-demo.js                        # → http://localhost:3000
node scripts/seed-demo.js http://localhost:3001  # → Docker demo instance
```

---

## Test coverage

All 1,172 existing tests continue to pass (`cd frontend && npm test`).  
No test logic was modified — token renames do not affect class-name assertions
since tests reference component semantics, not hex values.
