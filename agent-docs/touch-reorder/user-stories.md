# User Stories: Touch-accessible in-column reorder

## Personas

- **Mobile/tablet Prism user** — manages a board from a phone or tablet;
  currently sees a drag handle that silently does nothing.
- **Keyboard-only / screen-reader user** — desktop user who cannot perform a
  mouse-drag gesture at all; currently has zero way to reorder a card within
  a column.
- **Mouse/trackpad user** — existing drag-and-drop workflow; must see zero
  regression.

---

## Epics

### Epic 1: In-column reorder without dragging

#### Story: As a mobile user, I want to move a card up or down within its column by tapping, so that I can prioritize my tasks without a broken drag gesture.
- **Acceptance Criteria:**
  - Given a card that is not first in its column, when I tap the "Move up"
    button, then the card swaps with its rank-neighbor above and the change
    persists after reload.
  - Given a card that is not last in its column, when I tap "Move down", then
    it swaps with its rank-neighbor below and persists after reload.
  - Given the card is the first in its column, the "Move up" button is
    visibly disabled and does nothing when tapped.
  - Given the card is the last in its column, "Move down" is disabled.
  - A success toast ("Moved up" / "Moved down") confirms the action.
  - If the persist call fails, the card visually returns to its prior
    position and an error toast explains what happened, in plain language.
- **Definition of Done:** Buttons implemented in `CardActionMenu`, wired via
  `Board.handleReorderStep`, unit + E2E tests per blueprint §3.6 pass, no new
  dependency added, `useDragStore`/drag path untouched.
- **Priority:** Must
- **Story Points:** 3

#### Story: As a keyboard-only or screen-reader user, I want to reorder a card without any pointer at all, so that I have the same capability as mouse or touch users (WCAG 2.5.7).
- **Acceptance Criteria:**
  - The move-up/move-down buttons are native `<button>` elements, reachable
    via Tab, activated via Enter or Space.
  - Each button has a descriptive `aria-label` ("Move up" / "Move down") and
    matching `title`.
  - Disabled buttons are marked with the native `disabled` attribute (not
    just a visual style), so assistive tech announces them as such and skips
    them in tab order per platform convention.
  - This is the first reorder path available to this persona in the app —
    previously there was none.
- **Definition of Done:** Verified with keyboard-only navigation in manual QA
  and/or an automated a11y check; satisfies WCAG 2.2 SC 2.5.7 (AA).
- **Priority:** Must
- **Story Points:** 2

#### Story: As a mouse/trackpad user, I want my existing drag-and-drop reorder to keep working exactly as before, so that this fix doesn't disrupt my workflow.
- **Acceptance Criteria:**
  - HTML5 drag-and-drop reorder (dragstart/dragover/drop) is unchanged in
    behavior, rank computation, and persistence.
  - `useDragStore` and its O(1) per-card re-render behavior are untouched.
  - The new ↑/↓ buttons appear in the same hover/focus-within overlay
    alongside the existing ←/→ buttons — they are additive, not a
    replacement.
- **Definition of Done:** Existing drag E2E/unit tests continue to pass
  unmodified; no diff in `useDragStore.ts`.
- **Priority:** Must
- **Story Points:** 1

---

### Epic 2: Remove the misleading drag-handle affordance

#### Story: As a mobile user, I want the app to not show me a control that doesn't work, so that I'm not confused into thinking the app is broken.
- **Acceptance Criteria:**
  - On a coarse pointer (touch) device, the `drag_indicator` handle is not
    rendered/visible (previously shown at `opacity-30`).
  - On a fine pointer (mouse/trackpad) device, the hover-revealed drag handle
    is unchanged — still shown at `opacity-40` on `group-hover`.
- **Definition of Done:** `TaskCard.tsx` no longer applies the
  `[@media(pointer:coarse)]:opacity-30` class; verified under coarse-pointer
  emulation in unit + E2E tests.
- **Priority:** Must
- **Story Points:** 1

---

### Epic 3: Correct behavior with arc grouping enabled

#### Story: As a user with arc grouping turned on, I want a reorder step to behave predictably even when it crosses a group boundary, so that the outcome matches what I see happen.
- **Acceptance Criteria:**
  - Given arc grouping is on, when I tap ↑/↓ on a card at a group boundary,
    then the card moves to sit under its new rank-neighbor's group header —
    rank order remains the single source of truth (no special-casing).
  - The success toast copy is the same regardless of whether a group
    boundary was crossed ("Moved up"/"Moved down") — the visual re-parenting
    under the new group header is sufficient feedback (see wireframes.md,
    open question #3, for the alternative considered and deferred).
- **Definition of Done:** Behavior documented as intentional in code comments
  or tests; not treated as a bug in QA.
- **Priority:** Should
- **Story Points:** 1

---

## Edge Cases Covered

- Only card in a column: both ↑ and ↓ disabled.
- Reorder attempted while another mutation (`isMutating`) is in flight:
  both buttons disabled, no double-submit.
- Rank-gap collapse (rebalance branch of `computeDropRank`): all rebalanced
  tasks persist, not just the moved one — inherited from the existing drag
  path, exercised via the same code path here.
- 404 on the target task mid-action (e.g. deleted by another session):
  existing error-toast + rollback pattern applies (see `pattern_toast_abort`
  precedent already used elsewhere on this board) — no new blocking modal.

## Accessibility Summary (WCAG 2.1/2.2 AA)

- **2.5.7 Dragging Movements (AA)** — primary driver of this feature. Now
  satisfied: a single-pointer, non-drag alternative exists for the only
  drag-only interaction on the board.
- **2.5.5 / 2.5.8 Target Size** — 28×28px buttons meet the 24×24 CSS px
  minimum with `gap-0.5` spacing between adjacent targets.
- **4.1.2 Name, Role, Value** — native `<button>` + `aria-label` + `disabled`
  attribute cover this without custom ARIA.
- **1.4.13 / hover-or-focus content** — overlay reveal on `hover`/
  `focus-within` unchanged; buttons remain reachable via keyboard focus
  without requiring hover, per existing pattern.

## Questions for Stakeholders

(Duplicated from wireframes.md for visibility in this artifact — see that
file for full rationale.)
1. Confirm icon choice: `arrow_upward`/`arrow_downward` vs.
   `keyboard_arrow_up`/`keyboard_arrow_down`.
2. Confirm ↑/↓ group ordering: before or after the existing ←/→ group.
3. Confirm no special toast copy is needed for the arc-boundary-crossing case.
4. Confirm error-toast wording: "Couldn't save the new order. Please try
   again."
