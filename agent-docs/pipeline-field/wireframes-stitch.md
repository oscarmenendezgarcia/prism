# Wireframes Stitch — Pipeline Field per Card

## Stitch Project

**Project ID:** `15790477920468951127`
**Project name:** kanban-local

## Stitch Generation Status

Stitch MCP (`generate_screen_from_text` and `edit_screens`) returned `Request contains an invalid argument`
for all generation attempts during this design run (April 6, 2026). This is consistent with the
known Stitch timeout/invalid-argument bug documented in agent MEMORY.md (March 2026 entry).

**Fallback applied:** Full ASCII wireframes are the authoritative design reference. See `wireframes.md`.

No HTML files were downloaded for `stitch-screens/` because no screens were generated.

## Screens to Generate (pending Stitch availability)

When Stitch is available again, generate these 4 screens against project `15790477920468951127`:

| Screen ID | Title                                              | Key elements                                                                 |
|-----------|----------------------------------------------------|------------------------------------------------------------------------------|
| S-01      | TaskDetailPanel — Pipeline Field Read (empty)      | Panel with "Pipeline: (space default)" italic text + Configure ghost button  |
| S-02      | TaskDetailPanel — Pipeline Field Read (set)        | Panel with pill chain + Edit + Clear icon buttons                            |
| S-03      | TaskDetailPanel — Pipeline Field Edit Mode         | Inline editor: ordered list, up/down, remove, add-select, Save/Cancel        |
| S-04      | TaskDetailPanel — Pipeline Validation States       | Error banner (Save disabled) + Warning banner (Save enabled, empty stages)   |

## Design tokens to include in all prompts

```
Dark theme. Colors: bg-surface #1a1a1f, bg-surface-elevated #232329,
bg-surface-variant #2a2a31, border #2e2e38, text-primary #e2e2e8,
text-secondary #8b8b9a, text-disabled #55556a, primary #7c6af7,
error #f87171, warning #f5a623.
Font: Inter. Border-radius: inputs 8px, cards/containers 12px.
Material Symbols Outlined for icons.
```

## Existing related screens in the project

These screens already exist and show the surrounding context for the pipeline field:

| Screen name                    | Screen ID                            | Relevance                            |
|-------------------------------|--------------------------------------|--------------------------------------|
| Task Detail Side Panel         | 959236fa62c0421bb61ecd37030b379d     | Base panel layout — extend this      |
| Kanban Board with Task Detail  | 95740b65d1ee4acd99e062f72c2c8e65     | Full board context                   |
| Task Detail Panel Open         | fe3d8873c4cb4e8fb1e62ec990889f97     | Alternative panel base               |
| Prism: Updated Task Modal      | ababfd48f4674d8aafa3c880d52f6310     | Shows type segmented control pattern |
