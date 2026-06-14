# ADR-1: Manual Task Ordering — Fractional Rank Field + In-Column Drag-to-Reorder

## Status
Accepted

## Context

Tasks are currently ordered by `created_at ASC` within each column. There is no user-controlled ordering. This becomes critical because LOOP-3 (Board Autopilot) selects "the next todo task" based on column order — making the todo column the pipeline's priority queue. Without rank, there is no way to prioritise.

The feature requires:
1. A persistent `rank` field per task in the SQLite store.
2. `getTasksByColumn` to respect rank in its `ORDER BY`.
3. In-column drag-to-reorder: the existing `useDragStore` tracks column-level hovering only; it must be extended to track card-level hovering with insert position (before/after).
4. When a task is dragged to a **different column**, assign it rank at the tail of the destination (current `moveTask` does a simple column update, which already works).
5. A dedicated `PATCH /spaces/:spaceId/tasks/:taskId/rank` endpoint for rank-only updates (avoids triggering FTS rebuild on every reorder).

## Decision

Introduce a `rank REAL` column in the `tasks` table with fractional midpoint insertion (gap-based ordering). Extend `useDragStore` with card-level hover tracking (`dragOverTaskId` + `insertBefore`). Add a new `PATCH /tasks/:taskId/rank` backend endpoint. Render a drag handle icon and a drop-indicator line in `TaskCard`.

## Rationale

### Fractional midpoint ranking vs. integer position index

Integer position (storing 1, 2, 3...) requires rewriting ranks for all tasks after the insertion point on every reorder. With `N` tasks in a column this is `O(N)` writes per reorder. Fractional midpoint insertion (`new_rank = (rank_above + rank_below) / 2`) requires exactly **one write** per reorder — `PATCH /tasks/:taskId/rank`. The tradeoff is that extreme repeated reordering to the same gap eventually degrades precision, requiring a rebalance. This is negligible for Kanban boards (typically <50 tasks per column) and handled by a client-side rebalance guard.

**Initial spacing**: ranks start at `[1000, 2000, 3000, ...]`. This gives 1000 halvings before precision loss (2^10 ≈ 1024 insertions into the same gap). Rebalance triggers when `|rank_above - rank_below| < 0.001`.

### Dedicated `/rank` endpoint vs. extending `PUT /tasks/:taskId`

Extending the existing PUT would work, but:
- Every rank change fires the SQLite FTS trigger (two writes: delete + insert). During a single reorder gesture these saves are wasted.
- The existing PUT endpoint validates title/type/description; rank changes don't need that overhead.
- A dedicated `PATCH /tasks/:taskId/rank` endpoint is lightweight, semantically clean ("I am only changing position"), and mirrors the existing `/move` sub-resource pattern.

**Chosen**: dedicated `PATCH /tasks/:taskId/rank` with body `{ rank: number }`.

### `dragOverTaskId` in `useDragStore` vs. React state in Column

Moving `dragOverTaskId` to `useDragStore` keeps the existing O(1) re-render pattern: only the two affected `TaskCard` components re-render per drag event (the one leaving and the one entering). If `dragOverTaskId` lived in React state on `Column`, every card in the column would re-render on each `dragover` event (O(n) cards) — exactly the problem the store solved for column-level drag.

### Drop indicator: top/bottom border on TaskCard vs. separate separator element

A separator `<div>` between every pair of cards requires `N+1` DOM nodes per column and complex index tracking. A top or bottom border (`ring`/`border-t-2`) on the target card is simpler, uses existing Tailwind utilities, and is visually clear. The card's `onDragOver` computes mouse Y position relative to the card's bounding box (top half = insert before, bottom half = insert after).

### Drag handle: visual affordance only, `draggable` remains on whole card

The spec requires "drag handle visible en hover". Restricting drag initiation to the handle would require `pointerdown` + `dragstart` coordination to conditionally set `draggable` on the card — non-trivial, error-prone on mobile. Since the existing UX already drags from anywhere on the card and users understand this, the handle is a **visual affordance** (gripper icon, hover-only). The drag still initiates from the full card surface.

### `moveTask` rank assignment: tail of destination column

When a task is dropped into a **different** column (existing behavior), the server assigns `rank = MAX(rank in destination) + 1000.0` — appending to the tail. This is the expected UX (dropped task lands at the bottom) and requires extending `store.moveTask` to compute the max rank in a transaction.

### Optimistic UI for reorder

Rank updates are high-frequency (one per user drop gesture). A full `loadBoard()` after each reorder would produce visible flicker and is unnecessary. Instead, `reorderTask` in `useAppStore`:
1. Optimistically reorders the `tasks[column]` array in the store (re-sorts by new rank).
2. Fires `PATCH /tasks/:taskId/rank` async.
3. On error: reverts to the pre-reorder array and shows a toast.

No `loadBoard()` is needed on success. The next natural poll or navigation will sync any edge-case discrepancy.

## Consequences

### Positive
- Single write per reorder (no cascade updates).
- Ordering persists across reloads and is visible to LOOP-3.
- O(1) drag-event re-renders maintained.
- New endpoint is lightweight and testable in isolation.
- Existing `moveTask` cross-column behavior unchanged except for appending rank.

### Negative / Risks
- **Precision degradation** if user reorders the same gap >1000 times: mitigated by the client-side rebalance guard (triggers a batch of `PATCH /rank` calls to reassign `[1000, 2000, ...]`).
- **Migration**: existing tasks get `rank = 0` from `ALTER TABLE` default; the migration block in `createStore` reassigns correct ranks from `created_at` order. Tests must cover the migration path.
- **FTS trigger still fires on `updateTask` patches that include rank** (if rank is ever passed through the generic PUT): document that rank MUST go through `PATCH /rank`, never through `PUT /tasks/:taskId`.
- **Rebalance batch writes**: in the worst case (column with 50 tasks all with degenerate ranks) this sends 50 sequential PATCH calls. Acceptable for this app size; a future `POST /tasks/reorder-bulk` could batch them.
- **Touch/mobile drag**: HTML5 drag-and-drop doesn't fire on iOS Safari without a polyfill. Not in scope for this feature — existing cross-column drag has the same limitation.

## Alternatives Considered

- **Integer position (rewrite on insert)**: Discarded — O(N) writes per reorder.
- **LexoRank (string-based)**: String midpoints (e.g., Jira's approach) avoid float precision issues but are complex to implement in SQLite (collation-aware ordering). Float rank achieves the same result with native `ORDER BY rank ASC` and is simpler.
- **Extend `PUT /tasks/:taskId` to accept rank**: Discarded — fires FTS triggers on every reorder, mixes positioning with content fields, adds validation overhead.
- **`@dnd-kit` library**: The existing drag implementation is hand-rolled HTML5 DnD with careful O(1) re-render optimisation. Introducing a library adds bundle weight and would require refactoring the entire Board drag layer. The existing pattern extends cleanly to within-column reorder.

## Review
Suggested review date: 2026-12-14
