# Wireframes Stitch — QOL-7 User-Managed Attachments

## Stitch Project

- **Project:** Prism
- **Project ID:** `12795983416046485305`
- **Design System:** Obsidian Precision (`assets/e7265cb8054f4ed1b3e78bebd003c39c`)
  - Primary: `#7C6DFA`, Surface: `#111118`, Elevated: `#1A1A24`, Font: Inter + JetBrains Mono

---

## Screens

### S-1: Attachments Section — Empty State
**Screen ID:** `544a26ca57f14ec59c710571c4deee54`  
**Stitch URL:** `https://stitch.withgoogle.com/projects/12795983416046485305/screens/544a26ca57f14ec59c710571c4deee54`  
**HTML file:** `stitch-screens/attachments-empty-state.html`

Covers:
- Default state when 0 attachments exist
- "ATTACHMENTS" header with "+" ghost icon button
- "No attachments yet" italic empty state row
- Demonstrates the section always renders (FR: NF-1)

---

### S-2: AddAttachmentForm — Link Type Active
**Screen ID:** `ebceb41e68884a44ad4b5483ab089da9`  
**Stitch URL:** `https://stitch.withgoogle.com/projects/12795983416046485305/screens/ebceb41e68884a44ad4b5483ab089da9`  
**HTML file:** `stitch-screens/add-attachment-form.html`

Covers:
- Segmented type selector (Link active / Note / File Path inactive)
- Name field + URL field layout
- Cancel (ghost) + Add (primary) footer buttons
- Elevated card (`#1A1A24`) within the sidebar (`#111118`)
- All three button states (active/inactive distinction)

---

### S-3: Attachments Section — Mixed User + Agent Rows
**Screen ID:** `e5d3becc126b4152a6fd6c3fbcc736b8`  
**Stitch URL:** `https://stitch.withgoogle.com/projects/12795983416046485305/screens/e5d3becc126b4152a6fd6c3fbcc736b8`  
**HTML file:** `stitch-screens/attachments-mixed-list.html`

Covers:
- 2× agent rows (neutral bg, type-icon in primary, no delete button)
- 1× user row in hover state (violet tint, "you" chip, `×` delete in error red visible)
- 1× user row at rest (× hidden)
- Multi-channel distinction: color + icon + chip text label
- Developer note: `×` delete button uses `group-hover` pattern

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Always-visible section | Discoverability — users won't know they can add attachments if the section is hidden when empty |
| Inline form (not modal) | Consistency with PipelineFieldEditor in same sidebar; avoids z-index complexity |
| "You" chip in text + violet border | Three-channel distinction ensures accessibility (not color-only) |
| "×" visible on hover only | Reduces visual clutter in the list; delete is low-frequency action |
| No confirmation on delete | Lightweight action; re-adding is fast; consistent with Kanban "undo = re-do" patterns |
| Backend 403 guard | Defense-in-depth — UI hides button, backend blocks API bypass |

---

## HTML Files on Disk

```
agent-docs/user-attachments/stitch-screens/
├── attachments-empty-state.html   (S-1)
├── add-attachment-form.html       (S-2)
└── attachments-mixed-list.html    (S-3)
```
