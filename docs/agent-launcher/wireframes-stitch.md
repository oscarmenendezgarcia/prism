# Wireframes Stitch: Agent Launcher

**Project:** Prism — Agent Launcher from Task Cards
**Date:** 2026-03-19
**Author:** ux-api-designer
**Stitch Project ID:** `13926234062424334528`
**Stitch Project Name:** Prism — Agent Launcher

---

## Stitch Project URL

```
https://stitch.withgoogle.com/projects/13926234062424334528
```

---

## Screen Index

| Screen ID | Stitch Screen ID | Title | Local HTML |
|-----------|-----------------|-------|------------|
| S-01 | `6d36d018bb974e80807efbbf72c1279c` | Prism Kanban Task Cards | `stitch-screens/S-01-task-card.html` |
| S-02 | `22346c37f6db47488779e81fa663599f` | Prism Dropdown Variants | `stitch-screens/S-02-agent-dropdown.html` |
| S-03 | `00b93c61e5fc4ba4b71339d06f56eb0c` | Prism Agent Prompt Modal States | `stitch-screens/S-03-prompt-preview-modal.html` |
| S-04 | `30ec42cfb8164ca983383d012c76901f` | Prism Agent Settings Panel | `stitch-screens/S-04-settings-panel.html` |
| S-05 | `3ca94c31588c4bcc9ac5db12bc1b5b9b` | Prism Header Variants | `stitch-screens/S-05-header-active-run.html` |
| S-06 | `aa8cc4fe1c8049019fc1cd8a23b9b49e` | Prism Pipeline Header | `stitch-screens/S-06-header-pipeline.html` |

---

## Screen Descriptions

### S-01 — Prism Kanban Task Cards
**Stitch name:** `projects/13926234062424334528/screens/6d36d018bb974e80807efbbf72c1279c`
**Local file:** `stitch-screens/S-01-task-card.html`

Two task cards side-by-side on a dark board background:
- **Left (Active):** research badge, T-001 title, description, assigned label, timestamp. Footer: move arrows, Run Agent button (purple, smart_toy icon, enabled), delete button.
- **Right (Disabled):** Same card with Run Agent button greyed out and a "Agent already running" tooltip.

Design tokens applied: `bg-surface-elevated #1e1e2e`, `border-border #2e2e3e`, `bg-primary #7c3aed`, `text-text-primary #e2e2e9`.

---

### S-02 — Prism Dropdown Variants
**Stitch name:** `projects/13926234062424334528/screens/22346c37f6db47488779e81fa663599f`
**Local file:** `stitch-screens/S-02-agent-dropdown.html`

Three dropdown states stacked vertically:
- **Default:** Header "Run Agent" + smart_toy icon, list of 4 agents (Senior Architect, UX API Designer, Developer Agent, QA Engineer E2E), divider, "Run Full Pipeline" in purple.
- **Loading:** Spinner + "Loading agents..." text.
- **Empty:** "No agents found in ~/.claude/agents/" + "Open Settings" link.

---

### S-03 — Prism Agent Prompt Modal States
**Stitch name:** `projects/13926234062424334528/screens/00b93c61e5fc4ba4b71339d06f56eb0c`
**Local file:** `stitch-screens/S-03-prompt-preview-modal.html`

Two modal states side-by-side:
- **Left (Ready):** Full modal with agent name, task title, token badge (~2400), CLI command code block (JetBrains Mono, bg #141420) with Copy button, Prompt Preview scrollable area with Edit button, Cancel + Execute (purple, play icon) footer.
- **Right (Loading):** "Generating command..." spinner in CLI block, Execute button disabled at 50% opacity.

---

### S-04 — Prism Agent Settings Panel
**Stitch name:** `projects/13926234062424334528/screens/30ec42cfb8164ca983383d012c76901f`
**Local file:** `stitch-screens/S-04-settings-panel.html`

Right-side slide-in panel (480px wide, full height):
- **CLI Tool:** Radio group — Claude Code (selected), OpenCode, Custom (shows binary path input when selected).
- **Prompt Delivery Method:** Radio group — cat-subshell (selected), stdin-redirect, flag-file.
- **Additional Flags:** Pre-filled text input.
- **Pipeline:** Auto-advance ON, Confirm between stages ON. Read-only stage list (1–4).
- **Prompt Content:** Include Kanban ON, Include Git ON, Working Directory input.
- **Footer:** Cancel (ghost) + Save Settings (purple).

---

### S-05 — Prism Header Variants
**Stitch name:** `projects/13926234062424334528/screens/3ca94c31588c4bcc9ac5db12bc1b5b9b`
**Local file:** `stitch-screens/S-05-header-active-run.html`

Two header states stacked:
- **Top (Active Run):** Prism logo, "Kanban Board" title, Active Run Indicator (pulsing dot + "Senior Architect" + "0:42" + Cancel button), gear icon.
- **Bottom (Idle):** Prism logo, "Kanban Board" title, gear icon only — no run indicator, no layout shift.

---

### S-06 — Prism Pipeline Header
**Stitch name:** `projects/13926234062424334528/screens/aa8cc4fe1c8049019fc1cd8a23b9b49e`
**Local file:** `stitch-screens/S-06-header-pipeline.html`

Header with Pipeline Progress Bar embedded:
- 4-step pipeline: Architect (checkmark, dimmed) → UX (active, purple pill, pulsing) → Dev (dimmed) → QA (dimmed).
- Elapsed time "12:34" right of steps.
- "Abort Pipeline" ghost button.
- Gear icon.

---

## Design Token Reference

All screens use the following Prism design tokens (consistent with `frontend/tailwind.config.js`):

| Token | Value | Usage |
|-------|-------|-------|
| `bg-surface-elevated` | `#1e1e2e` | Card backgrounds, modals, panels |
| `border-border` | `#2e2e3e` | All borders and dividers |
| `text-text-primary` | `#e2e2e9` | Primary text |
| `text-text-secondary` | `#9494a0` | Muted labels, timestamps, badges |
| `bg-primary` | `#7c3aed` | Active buttons, selected radio, pulsing dot, badges |
| `bg-surface` | `#141420` | Code blocks, nested dark areas |
| Font — UI | Inter | All labels, buttons, navigation |
| Font — Code | JetBrains Mono | CLI command, prompt preview textarea |
| Icons | Material Symbols Outlined | All iconography |

---

## Notes for Developer

- HTML files in `stitch-screens/` are self-contained (inline CSS + JS). Open directly in a browser to preview.
- The Stitch designs are reference — implementation must use the existing Prism shared components (`<Button>`, `<Modal>`, `<Badge>`, `<ContextMenu>`).
- No `style={{}}` inline attributes in React implementation — use Tailwind arbitrary values.
- See `wireframes.md` for full ASCII wireframes, states, accessibility notes, and mobile-first breakpoints.
- See `api-spec.json` for endpoint contracts.
