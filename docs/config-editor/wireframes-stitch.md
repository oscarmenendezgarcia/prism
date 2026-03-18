# Wireframes Stitch Reference: Config Editor Panel

**Feature:** Configuration Editor Panel for Prism
**Date:** 2026-03-18
**Author:** ux-api-designer

---

## Stitch Screen Generation — Evaluation and Deferral

### Decision

Stitch screen generation was evaluated for the Config Editor Panel and **deferred**. The existing TerminalPanel implementation serves as the authoritative visual reference for the developer.

### Rationale

The Config Editor Panel reuses established Prism design patterns without introducing novel UI patterns that would require Stitch-level visual specification:

| Design element | Source of truth |
|----------------|-----------------|
| Slide-over panel shell (header + close button + footer) | TerminalPanel (`frontend/src/components/terminal/TerminalPanel.tsx`) |
| Header toggle button (active/inactive states) | TerminalToggle (`frontend/src/components/terminal/TerminalToggle.tsx`) |
| Confirmation dialog (alertdialog role, Cancel/Discard buttons) | Existing `<Modal>` component (`frontend/src/components/shared/Modal.tsx`) |
| Toast notifications (success/error) | Existing `<Toast>` component + `showToast` Zustand action |
| Button variants (primary, secondary, ghost, danger) | `<Button>` component (`frontend/src/components/shared/Button.tsx`) |
| Dirty/status indicator pattern | No existing analogue — fully specified in `wireframes.md` S-04 |

The only genuinely new visual element is the **file sidebar** (S-09 in wireframes.md) and the **unsaved changes indicator** (S-04 footer). Both are fully specified in ASCII wireframes with exact Tailwind class callouts. A Stitch screen would add visual fidelity without adding design information.

Stitch generation is recommended if:
- A designer wants to validate the sidebar item states (active, hover, loading) at pixel level
- The project adds a light mode theme in a future iteration

---

## Visual Token Reference for Developer

The developer MUST use the following Tailwind tokens. These are extracted from the existing Prism design system (`frontend/tailwind.config.js` and `frontend/src/index.css`) and from the TerminalPanel implementation.

### Panel Shell

| Element | Tailwind classes |
|---------|-----------------|
| Panel container | `flex flex-col h-full w-[480px] bg-surface-elevated border-l border-border` |
| Panel header | `flex items-center justify-between h-12 px-4 border-b border-border shrink-0` |
| Panel header title | `text-sm font-semibold text-text-primary` |
| Panel footer | `flex items-center justify-between h-12 px-4 border-t border-border shrink-0` |
| Panel body | `flex flex-1 min-h-0 overflow-hidden` |

### ConfigToggle Button

| State | Tailwind classes |
|-------|-----------------|
| Inactive | `inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white/5 text-text-secondary hover:bg-white/10 hover:text-text-primary transition-colors` |
| Active | `inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/[0.15] text-primary` |

Icon: `<span class="material-symbols-outlined text-[18px]">settings</span>`

### File Sidebar

| Element | Tailwind classes |
|---------|-----------------|
| Sidebar container | `w-[140px] shrink-0 border-r border-border overflow-y-auto flex flex-col` |
| Section header | `px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-secondary` |
| Section separator | `border-t border-border mx-3 my-2` |
| File item (inactive) | `px-3 py-2 cursor-pointer text-sm text-text-secondary hover:bg-white/5 hover:text-text-primary transition-colors` |
| File item (active) | `px-3 py-2 border-l-2 border-primary bg-primary/[0.10] text-primary font-medium text-sm` |
| File item filename | `block truncate` (line 1 of item) |
| File item directory | `block text-xs text-text-secondary/60 truncate` (line 2 of item) |
| File item loading icon | `material-symbols-outlined text-[12px] animate-spin ml-1` |

### Editor Area

| Element | Tailwind classes |
|---------|-----------------|
| Editor container | `flex-1 flex flex-col min-w-0 overflow-hidden` |
| Textarea | `flex-1 w-full p-3 font-mono text-sm text-text-primary bg-transparent resize-none outline-none border-none overflow-auto` |
| Empty state container | `flex-1 flex items-center justify-center` |
| Empty state text | `text-sm text-text-secondary text-center px-4` |
| Loading spinner container | `flex-1 flex flex-col items-center justify-center gap-3` |
| Loading text | `text-sm text-text-secondary` |
| Error state container | `flex-1 flex flex-col items-center justify-center gap-3 px-4` |
| Error state text | `text-sm text-text-secondary text-center` |

### Footer — Dirty Indicator

| Element | Tailwind classes |
|---------|-----------------|
| Dirty indicator wrapper | `flex items-center gap-1.5` |
| Colored dot | `w-2 h-2 rounded-full bg-amber-400 shrink-0` |
| Indicator text | `text-[12px] font-medium text-amber-400` |

Contrast check: `#F59E0B` (amber-400) on `bg-surface-elevated` (`#1E2030`) = approximately 5.5:1 (WCAG AA pass).

### Discard Changes Dialog

Uses the existing `<Modal>` component. Key classes for content inside the modal:

| Element | Tailwind classes |
|---------|-----------------|
| Dialog title | `text-base font-semibold text-text-primary` id="discard-dialog-title" |
| Dialog body | `text-sm text-text-secondary mt-2` id="discard-dialog-desc" |
| Button row | `flex justify-end gap-2 mt-6` |

---

## TerminalPanel Reference Files

The developer should read these files before implementing ConfigPanel to ensure structural consistency:

| File | Purpose |
|------|---------|
| `frontend/src/components/terminal/TerminalPanel.tsx` | Slide-over panel shell: header, footer, open/close transitions |
| `frontend/src/components/terminal/TerminalToggle.tsx` | Header toggle button: active/inactive state pattern |
| `frontend/src/store/useAppStore.ts` | Zustand store: how `terminalPanelOpen` and `configPanelOpen` are managed |
| `frontend/src/components/shared/Modal.tsx` | Confirmation dialog: focus trap, alertdialog role |
| `frontend/src/components/shared/Button.tsx` | All button variants referenced in this feature |

---

## Stitch Screens (None Generated)

No Stitch screens were generated for this feature. The wireframes.md ASCII diagrams and the token reference table above are the complete visual specification.

If Stitch screens are generated in a future design iteration, record their IDs and HTML download URLs here following the pattern established in previous features (e.g., `docs/terminal-shell/wireframes-stitch.md`).
