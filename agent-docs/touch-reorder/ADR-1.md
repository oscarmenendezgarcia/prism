# ADR-1: Touch/keyboard in-column reorder via explicit step controls (not a Pointer-Events drag rewrite)

## Status
Accepted

## Context
The kanban board reorders cards **only** through the HTML5 drag-and-drop API
(`draggable` + `dragstart/dragover/drop` in `Board.tsx`/`TaskCard.tsx`, ranks via
`computeDropRank`, persistence via `reorderTask`). Touch browsers do not
synthesize HTML5 DnD events from a `touchstart`, so **in-column reordering is
silently non-functional on mobile/tablet**. Worse, `TaskCard.tsx` shows a
`drag_indicator` handle at `[@media(pointer:coarse)]:opacity-30` — a visible
affordance implying touch drag support that does not exist.

Two facts narrow the problem:
1. **Cross-column moves already work on touch** — `CardActionMenu`'s
   `arrow_back`/`arrow_forward` buttons call `moveTask`, and their overlay is
   forced visible on coarse pointers. Only *in-column vertical* reorder is broken.
2. **Mobile shows a single column at a time** (MB-1), so cross-column drag is not
   a meaningful gesture there anyway.

Prism's design system targets **WCAG 2.2 AA**, which includes **SC 2.5.7 Dragging
Movements**: any drag operation must have a single-pointer, non-drag alternative.
The current board fails 2.5.7, and additionally has **no keyboard reorder at all**.

## Decision
Add explicit **"move up" / "move down"** reorder controls to the per-card action
toolbar (`CardActionMenu`), available to all pointer types (and keyboard), and
**remove the misleading drag-handle affordance on coarse pointers** — instead of
reimplementing dragging on top of Pointer Events.

## Rationale
- **It is the only option that clears the AA bar.** A Pointer-Events drag is
  still a dragging movement and does **not** satisfy WCAG 2.5.7 — step controls
  are required regardless, so building drag-on-touch first would be redundant.
- **Reuse over rewrite.** Step controls reuse `computeDropRank` (incl. its
  rank-rebalance branch) and `reorderTask` (optimistic update + rollback + toast)
  verbatim. No new API, no new dependency, no change to the perf-tuned
  `useDragStore` hot path.
- **Fixes two defects at once:** touch reorder *and* the total absence of
  keyboard/screen-reader reorder.
- **Fits existing patterns:** `CardActionMenu` is already an ARIA `toolbar`,
  already 28×28 icon-button styled, already forced-visible on coarse pointers.
- **Minimal, reversible, single-domain** — appropriate for a bug fix.

## Consequences
- **Positive**
  - In-column reorder works on touch, mouse (still via drag *and* now buttons),
    and keyboard.
  - WCAG 2.5.7 satisfied; new keyboard/SR reorder path.
  - Small, well-tested diff; no deps; no backend change.
  - Removes the "visible but dead" drag handle on touch — the reported defect.
- **Negative / Risks**
  - Long-distance reorder needs multiple taps.
    *Mitigation:* columns are short; drag remains for mouse users; acceptable.
  - `CardActionMenu` grows to up-to-6 buttons; width pressure on narrow cards.
    *Mitigation:* UX stage sets order/grouping; buttons are 28×28 and the toolbar
    already wraps into a compact strip.
  - Arc-grouping-on: a step swaps rank-neighbors across group boundaries.
    *Mitigation:* rank is the source of truth — correct behaviour; documented, UX
    confirms copy.

## Alternatives Considered
- **Pointer-Events drag reimplementation** — rejected: large/risky
  (long-press-lift, custom hit-testing, auto-scroll, `touch-action`, drag ghost),
  touches perf-tuned drag state, and *still* fails WCAG 2.5.7 so wouldn't remove
  the need for step controls.
- **A DnD library (dnd-kit / react-dnd / SortableJS)** — rejected: violates
  Prism's native-first / minimal-deps rule; heavyweight for a one-axis reorder;
  would still need a non-drag alternative for 2.5.7.
- **Coarse-pointer-only reorder buttons** — rejected: WCAG 2.5.7 is not
  touch-scoped; desktop keyboard users would still have no reorder path.

## Review
Suggested review date: 2027-01-14 (+6 months), or sooner if a board-wide DnD
overhaul or multi-select reorder is scheduled.
