# Stitch Screens — arc Field (QOL-5)

**Stitch project:** Prism  
**Project ID:** `12795983416046485305`  
**Project URL:** `https://stitch.withgoogle.com/projects/12795983416046485305`

---

## Screens

| # | Screen Name | Screen ID | Description | HTML |
|---|-------------|-----------|-------------|------|
| 1 | Board + ArcBar | `32e22f00298d4ce6829c3ffa9d5b5f85` | Kanban board with ArcBar filter strip and TaskCard arc chips | `stitch-screens/board-arcbar.html` |
| 2 | CreateTaskModal with arc | `b22e040fc16d440f9f18b21dbe6fc9b2` | Create Task modal with "Arc (optional)" ArcAutocomplete field and open dropdown | `stitch-screens/create-task-modal-arc.html` |
| 3 | TaggerReviewModal arc | `6d1230f8b3f445db8eb94c4267c4e737` | AI Tag Review modal with arc suggestion chips per suggestion row | `stitch-screens/tagger-review-modal-arc.html` |

> **Screen 4 (TaskDetailPanel)**: Stitch returned an auth error during generation. The TaskDetailPanel arc row is fully specified via ASCII wireframe in `wireframes.md §Screen 3`. Developer should implement from that spec; the ArcAutocomplete component and inline-edit pattern are identical to the CreateTaskModal usage.

---

## Design System Applied

| Token | Value |
|-------|-------|
| Background | `#0A0A0F` |
| Surface | `#111118` |
| Surface elevated | `#1A1A24` |
| Primary | `#7C6DFA` |
| Text primary | `rgba(245,245,250,0.96)` |
| Text secondary | `rgba(245,245,250,0.60)` |
| Border | `rgba(255,255,255,0.08)` |
| Font (body) | Inter |
| Font (mono) | JetBrains Mono |
| Radius card | 12px |
| Radius modal | 16px |
| Radius chip | 6px |
| Radius input | 8px |

---

## Screen Detail

### Screen 1 — Board + ArcBar
**URL:** `projects/12795983416046485305/screens/32e22f00298d4ce6829c3ffa9d5b5f85`

**What's shown:**
- Full Kanban board with 3 columns (Todo / In Progress / Done)
- ArcBar strip between ColumnTabBar and columns (h-10, bg-surface, border-bottom)
- Filter chips: `QOL` (active — primary tint + border), `AUTH`, `LOOP`, `FOLIO` (inactive)
- Group toggle button on the right of ArcBar
- TaskCards with arc chip in Zone B: `[QOL]` in monospace pill style
- Some cards without arc chip (showing the optional nature)

**Key design decisions visible:**
- Active filter chip: `bg-primary/15 border-primary text-primary`
- Inactive chip: `bg-surface-elevated border-border text-text-secondary`
- Arc chip on card: `text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border border-border bg-surface text-text-secondary`

---

### Screen 2 — CreateTaskModal with ArcAutocomplete
**URL:** `projects/12795983416046485305/screens/b22e040fc16d440f9f18b21dbe6fc9b2`

**What's shown:**
- Modal centered over dimmed board (480px wide, 16px radius, shadow-modal)
- Form fields: Title, Type segmented control (feature active), Description textarea
- "Arc (optional)" field with helper text "Narrative grouping label (e.g. QOL, AUTH, LOOP)"
- ArcAutocomplete input showing typed value "QOL" with clear (×) button
- Open dropdown below input: `QOL` highlighted (primary/10 tint), `AUTH`, `LOOP`, `FOLIO`
- Footer: "Cancel" ghost + "Create Task" primary button (bg-primary)

**Key design decisions visible:**
- Label + helper text stacked (helper text distinguishes from required fields)
- Dropdown uses elevated surface to float above modal content
- No external select library — native input + absolutely positioned list

---

### Screen 3 — TaggerReviewModal with arc chips
**URL:** `projects/12795983416046485305/screens/6d1230f8b3f445db8eb94c4267c4e737`

**What's shown:**
- AI Tag Review modal (640px wide) over dimmed board
- 4 suggestion rows:
  - `QOL-5: Add arc field` — `[feature]→[feature]` + `[arc: QOL]` chip ✓ checked
  - `AUTH-1: JWT refresh flow` — `[feature]→[chore]` + `[arc: AUTH]` chip ✓ checked
  - `CI-2: Fix build script` — `[bug]→[chore]` — no arc chip ✓ checked
  - `QOL-6: Export to CSV` — `[feature]→[feature]` + `[arc: QOL]` ✗ unchecked
- Footer: "3 of 4 selected" + "Skip All" ghost + "Apply Selected" primary

**Key design decisions visible:**
- Arc chip: `font-mono text-[10px] px-2 py-0.5 rounded-6px bg-primary/12 border border-primary/30 text-[#9B8BFF]`
- Arc chip is purely informational (not a button) — visual indicator only
- Rows without arc suggestion are clean — no placeholder dash or "(no arc)"
- Unchecked rows have lower opacity (`opacity-50`) to de-emphasize

---

## HTML Files

All HTML files are saved at: `agent-docs/arc-field/stitch-screens/`

```
stitch-screens/
  board-arcbar.html            20.8 KB  (Screen 1)
  create-task-modal-arc.html   18.2 KB  (Screen 2)
  tagger-review-modal-arc.html 18.1 KB  (Screen 3)
```

These files are self-contained HTML with inline styles and can be opened in a browser for visual reference.

---

## Notes for Developer Agent

1. **Read screens 1, 2, 3 as the visual spec** — particularly for the arc chip style, ArcBar layout, and TaggerReviewModal row structure.
2. **TaskDetailPanel** — no Stitch screen; implement from `wireframes.md §Screen 3`. The arc row uses the same ArcAutocomplete component as the modal.
3. **Arc chip color** in TaggerReviewModal differs from TaskCard: tagger uses primary-tinted violet (`#9B8BFF` text, `primary/12` bg) to denote "AI-suggested" vs the card chip's neutral style (`text-text-secondary`).
4. The blueprint `§3.4 TaskCard` spec in `blueprint.md` overrides the Stitch chip if there's any discrepancy — the blueprint is the authoritative implementation source.
