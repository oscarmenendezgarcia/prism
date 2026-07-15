# ADR-1: Keyboard-accessible in-column task reorder

## Status
Accepted

## Context
In-column drag-to-reorder (PR #143) is mouse-only — it relies on native HTML5 `draggable`
and `dragstart/dragover/drop` events with no keyboard equivalent. Keyboard-only and
assistive-technology users cannot reorder tasks within a column at all; they can only move
cards *between* columns via `CardActionMenu`'s move-left / move-right buttons. Worse, the
`<article>` task card has no `tabIndex`, so it is not even in the tab order — a keyboard user
cannot focus a card to act on it. This blocks WCAG 2.2 AA conformance (2.1.1 Keyboard, and
2.5.7 Dragging Movements, which requires a non-drag alternative to any drag gesture). This
matters now because the board's core interaction — ordering work — is unreachable for an
entire class of users, and the feature sits in the active "Polish-v-next" accessibility arc.

The persistence layer already supports this: `reorderTask(taskId, column, newRank)` and the
dedicated `PATCH /api/v1/tasks/:id/rank` endpoint (folio `decisions/patch-rank-avoids-fts`)
were built for drag and are reusable unchanged. The only gap is an accessible **input path**
and a **status-announcement** channel.

## Decision
Add a **frontend-only** keyboard reorder path: make task cards focusable, let a focused card
respond to **`Alt`+`ArrowUp` / `Alt`+`ArrowDown`** to move one position within its column,
expose the same action as **discoverable move-up / move-down buttons in `CardActionMenu`**,
route both through a single Board handler that reuses the existing `computeDropRank` +
`reorderTask`, and announce each move through a new shared visually-hidden
`role="status" aria-live="polite"` announcer. No backend, API, or `useDragStore` change.

## Rationale
- **Reuse over reinvention:** `computeDropRank` and `reorderTask` already encode the
  fractional-rank + rebalance logic; the keyboard path is just a second producer of the same
  `(taskId, column, newRank)` call. Zero new persistence surface, zero FTS churn.
- **Two affordances, one handler:** the `CardActionMenu` buttons are self-documenting,
  pointer-operable (satisfying WCAG **2.5.7** for mouse users who cannot drag), and require
  no knowledge of a shortcut; `Alt`+`Arrow` is the power-user accelerator on the focused
  card. Both are thin callers of one Board function, so behavior can't diverge.
- **`Alt`+`Arrow` chosen** over `Ctrl`/`Cmd`+`Arrow` (which collide with macOS
  line/word/Spaces navigation) and over plain arrows (reserved for scroll / a future roving
  focus model). It mirrors the near-universal "move line up/down" editor idiom.
- **Discrete, not modal:** unlike the dnd-kit "pick-up → move → drop" model used for
  pipeline stages, a discrete per-press swap needs no grabbed state, so `useDragStore` stays
  drag-only (folio `decisions/tab-drag-local-state`) and the board avoids a second DnD
  paradigm.
- **Dedicated announcer, not toasts:** position changes are status messages (4.1.3), not
  notifications — they must reach SR users silently, without spamming the viewport on every
  keystroke as visible toasts would.

## Consequences
- **Positive:**
  - Board reordering becomes fully keyboard- and AT-operable; unblocks WCAG 2.1.1 / 2.4.7 /
    2.5.7 / 4.1.3 for this surface.
  - A reusable `useAnnouncer` + `<Announcer/>` primitive the codebase lacked, available for
    future a11y announcements.
  - Mouse users gain a no-drag reorder option (up/down buttons).
  - Purely additive and reversible; existing drag path untouched.
- **Negative / Risks:**
  - *Tab-stop volume:* `tabIndex=0` per card adds one tab stop per card. **Mitigation:** the
    `Alt` modifier keeps plain arrows free, so a later roving-tabindex upgrade is
    non-breaking; revisit only if users complain.
  - *Focus loss on reorder:* if the moved DOM node isn't preserved, focus jumps.
    **Mitigation:** list items are keyed by `task.id` (React moves the node); QA must verify
    focus retention explicitly.
  - *Keydown capture:* a card handler could swallow Tab/Enter/Escape. **Mitigation:** handle
    only `altKey + Arrow{Up,Down}`; `preventDefault` scoped to that case; pass everything
    else through; covered by component tests.
  - *Arc-group ambiguity:* moving across an arc group would implicitly reassign `arc`.
    **Mitigation:** reorder is constrained within the visible arc group; cross-group presses
    are spoken no-ops (documented assumption A-2, handed to UX/QA).
  - *Rapid-press rank churn:* many presses fire many `PATCH …/rank`. **Mitigation:** endpoint
    is cheap and FTS-free by design; optimistic re-sort keeps each press O(1).

## Alternatives Considered
- **dnd-kit "Space to pick up, Arrow to move, Space to drop"** (as in `SortableStageList`):
  discarded — introduces a modal grabbed state and a second DnD library onto a hand-rolled
  drag board; heavier than the brief and raises re-render/complexity cost.
- **Roving tabindex (one focusable card per column, arrows move focus):** deferred — the
  WAI-ARIA-correct focus model but a larger change that hijacks plain arrows; the chosen
  `Alt` accelerator makes it a non-breaking future upgrade.
- **Reuse `showToast` for announcements:** discarded — pops a visible toast on every
  keystroke; wrong channel for a high-frequency SR status message.
- **New backend endpoint / extend `PUT`:** rejected — the rank sub-resource already exists
  and deliberately bypasses FTS; the keyboard path needs no server change at all.

## Review
Suggested review date: 2027-01-14 (+6 months), or sooner if board size makes per-card
tab-stops a usability complaint (trigger to reconsider roving tabindex).
