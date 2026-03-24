# ADR-1: Task Detail Side Panel — Interaction and State Model

## Status
Accepted

## Context

Task cards on the Kanban board surface only a compact summary. Users need to read or edit all
task fields (title, description, type, assigned) without leaving the board context. A full
page navigation would break flow; a modal centered on screen would obscure the board; an
inline-editable card creates unsalvageable layout instability at small column widths.

The decision is: what UI surface do we use for expanded detail and inline editing?

The existing `PUT /spaces/:spaceId/tasks/:taskId` endpoint already accepts all four editable
fields (`title`, `type`, `description`, `assigned`). No new backend endpoint is required.

## Decision

Implement a **right-side slide-in panel** (`TaskDetailPanel`) that is rendered at the App
level, overlaid on top of the board without collapsing columns. The panel opens when the user
clicks a task title or a dedicated "expand" icon on the card. It contains editable fields for
all four existing task properties and saves changes via the existing `PUT` endpoint, with
**auto-save on blur per field** (no explicit Save button for simple fields; description uses
explicit save due to textarea length).

## Rationale

**Side panel over modal:**
- Panels keep the board visible, maintaining spatial context (the user sees which card they
  are editing).
- The existing `<Modal>` component is designed for discrete, focus-trapped decisions. A
  persistent editing surface does not fit that affordance.
- Panels are a standard Kanban pattern (Jira, Linear, GitHub Projects all use this model).

**Auto-save on blur over an explicit Save button (for title, type, assigned):**
- Reduces cognitive load — no "did I save?" anxiety for simple single-field edits.
- Consistent with the rest of the app (no explicit save exists anywhere in Prism today).
- Description uses explicit save because multiline textarea edits benefit from a deliberate
  commit gesture, and accidental blur (e.g. focus loss from a system dialog) would lose large
  text edits.

**App-level render over column/card-level:**
- Prevents z-index stacking issues with column scroll containers.
- Single panel instance — only one task is ever open at a time (simplifies store shape).

**No new backend endpoint:**
- `PUT /spaces/:spaceId/tasks/:taskId` already supports partial updates for all four fields.
- Adding a PATCH would be redundant; the PUT handler already diffs by `'key' in body`.

## Consequences

### Positive
- Zero backend changes required — feature is purely frontend.
- Panel does not collapse or scroll the board, preserving spatial context.
- Store shape stays flat: one nullable `detailTask` slot, two new actions.
- Auto-save eliminates the risk of unsaved changes on accidental navigation.

### Negative / Risks
- **Concurrent edit race:** if another agent or browser tab updates the same task while the
  panel is open, the panel's local state will diverge from the server state until the next
  board poll. *Mitigation:* the panel re-hydrates its fields from the store on open, and the
  board's polling interval (existing) will eventually refresh values. An optimistic update to
  the store on save keeps the card in sync immediately.
- **Mobile layout:** a right-side panel at 380 px fixed width overlaps most of the board on
  narrow screens. *Mitigation:* the panel uses `max-w-full w-full sm:w-[380px]` so it
  becomes a bottom sheet equivalent on mobile. Addressed in UX stage.
- **Focus management:** closing the panel must return focus to the triggering card to comply
  with accessibility requirements. Implementation must store the trigger element ref.

## Alternatives Considered

- **Inline card editing (expand-in-place):** Discarded. Card width (~280 px) is too narrow
  for a textarea; expanding a card disrupts column layout and scroll position.
- **Full-page detail route (React Router):** Discarded. Adds routing complexity with no user
  benefit; leaves the board entirely, losing spatial context.
- **Centered modal via existing `<Modal>`:** Discarded. Blocks the entire board; the existing
  component is built for short-lived confirmations, not persistent editing surfaces.
- **Optimistic editing directly on the card (no panel):** Discarded. Clutters the card UI
  and makes description editing impossible at card width.

## Review
Suggested review date: 2026-09-24
