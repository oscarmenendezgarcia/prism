# Stitch Screens: Touch-accessible in-column reorder

**No Stitch screens were generated for this feature.**

## Why

This feature does not introduce a new screen, route, or component. It extends
one existing overlay component, `CardActionMenu` (rendered inside `TaskCard`
on the existing Board screen), with two additional 28×28 icon buttons and
removes one CSS class (`[@media(pointer:coarse)]:opacity-30`) from
`TaskCard.tsx`. The architect's blueprint (`blueprint.md` §3.1, "Core
components (all existing — no new files required)") and handoff note
explicitly state: *"No new screens needed; the controls live in the existing
per-card action overlay."*

Stitch is best used to generate and iterate on new screen layouts. Generating
a full Stitch screen mock for a 2-button toolbar addition inside an existing,
already-implemented component would not add design fidelity beyond what is
already specified in `wireframes.md` — the exact Tailwind classes, icon
choices, disabled states, and toolbar composition are already fully specified
there, byte-for-byte reusable by the developer stage from the existing
`CardActionMenu.tsx` file.

## What developers should reference instead

- `wireframes.md` — full ASCII wireframe of the modified toolbar (default,
  disabled-edge, disabled-mutating, success, error states), accessibility
  notes, and mobile-first width budget.
- `frontend/src/components/board/CardActionMenu.tsx` — the file being
  extended; copy its existing button JSX/class pattern verbatim for the new
  ↑/↓ buttons (per blueprint §3.1/§3.4).
- `frontend/src/components/board/TaskCard.tsx` — the file where the
  coarse-pointer drag-handle affordance is removed.

## If a future feature in this area needs a new screen

Reuse the existing Stitch project for **Prism**
(`projectId: 12795983416046485305` — see UX/API Designer memory) rather than
creating a new one. Run the Pre-step B project-resolution flow described in
this agent's operating instructions before generating anything.
