# User Stories: QOL-1 — Manual Task Ordering (rank + drag-to-reorder)

## Personas

| Persona | Role | Context |
|---|---|---|
| **Oscar** | Prism user (developer/PM) | Uses the Kanban board to manage tasks across features. Wants to control what LOOP-3 works on next. |
| **LOOP-3** | Board Autopilot agent | Reads the todo column in order and picks the first task to run. Depends on rank ordering to respect human priorities. |
| **Developer Agent** | Pipeline agent | Creates tasks via POST; tasks should appear at the tail of todo to avoid disrupting current priorities. |

---

## Epics

### Epic 1: Persistent task rank field

> As Oscar, I want tasks to have a stable position within each column so that my prioritization survives page reloads and other users' actions.

#### Story 1.1 — Tasks persist their order within a column
**As Oscar**, I want tasks in a column to stay in the order I arranged them, **so that** my prioritization is not lost when I reload the page.

**Acceptance Criteria:**
- [ ] After dragging task A above task B and reloading, task A still appears above task B
- [ ] The order is consistent across browser tabs (both read from the same SQLite rank)
- [ ] Three tasks reordered via drag maintain their order after 5 page reloads

**Definition of Done:**
- [ ] `rank REAL` column exists in `tasks` table (migration applied)
- [ ] `GET /spaces/:spaceId/tasks` returns tasks ordered by `rank ASC, created_at ASC`
- [ ] `PATCH /rank` endpoint persists to SQLite and returns 200

**Priority:** Must  
**Story Points:** 5  
**Tasks:** T-001, T-002, T-003, T-004

---

#### Story 1.2 — Existing tasks get correct initial rank
**As Oscar**, I want my existing tasks to appear in their original creation order after the feature ships, **so that** nothing is disrupted when I first get the update.

**Acceptance Criteria:**
- [ ] On first server start after migration, existing tasks in each column get ranks `[1000, 2000, 3000, ...]` in `created_at ASC` order
- [ ] Migration is idempotent — running it twice does not double the ranks or fail
- [ ] After migration, `GET /tasks` returns tasks in the same visual order as before the feature

**Definition of Done:**
- [ ] Migration block in `store.js` seeds correct ranks from `created_at` order
- [ ] `PRAGMA table_info` guard prevents duplicate `ALTER TABLE`
- [ ] Existing backend tests pass after migration

**Priority:** Must  
**Story Points:** 2  
**Tasks:** T-001

---

#### Story 1.3 — New tasks appear at the bottom of their column
**As a Developer Agent (or Oscar)**, I want newly created tasks to appear at the tail of the column, **so that** they don't disrupt existing priorities.

**Acceptance Criteria:**
- [ ] Creating a task via `POST /tasks` places it at rank `MAX(column_ranks) + 1000`
- [ ] The new task appears visually at the bottom of the todo column without a page reload (optimistic update)
- [ ] If there are no tasks in the column, the new task gets rank `1000`

**Definition of Done:**
- [ ] `store.insertTask` computes `MAX + 1000` when `task.rank` is not provided
- [ ] `POST /tasks` response includes `rank` field
- [ ] Frontend renders new tasks at the tail (Zustand store inserts at correct position)

**Priority:** Must  
**Story Points:** 2  
**Tasks:** T-002, T-005

---

### Epic 2: Drag-to-reorder within a column

> As Oscar, I want to drag tasks up and down within a column to control their priority visually.

#### Story 2.1 — Drag a task to a new position within the same column
**As Oscar**, I want to drag a task card up or down within a column, **so that** I can quickly change which task is highest priority.

**Acceptance Criteria:**
- [ ] Dragging task C from position 3 to above task A (position 1) makes C appear first
- [ ] The reorder is instant (optimistic update — no waiting for server)
- [ ] The new order persists after page reload
- [ ] Dragging a task to the same position it's already in has no visible effect

**Definition of Done:**
- [ ] `computeDropRank` utility correctly computes fractional midpoints
- [ ] `PATCH /rank` fires after drop and returns 200
- [ ] `reorderTask` in `useAppStore` updates the Zustand tasks array before the API call resolves
- [ ] Backend: `store.reorderTask` updates rank without triggering FTS

**Priority:** Must  
**Story Points:** 8  
**Tasks:** T-005, T-006, T-007, T-008, T-009, T-010

---

#### Story 2.2 — Visual affordance: drag handle icon
**As Oscar**, I want to see a drag handle icon on a card when I hover over it, **so that** I know the card can be reordered.

**Acceptance Criteria:**
- [ ] Hovering over a card reveals a `drag_indicator` (six-dot grip) icon at the left edge
- [ ] The icon is not visible when not hovering (opacity-0 default)
- [ ] On touch devices, the icon is faintly visible at all times (opacity-30) since hover doesn't exist
- [ ] The cursor changes to `grab` when over the handle, `grabbing` when dragging
- [ ] The drag handle is `aria-hidden` (decorative affordance only)

**Definition of Done:**
- [ ] `TaskCard` renders drag handle with `opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-30`
- [ ] Card padding is `p-4 pl-6` to accommodate the handle without overlapping text
- [ ] `aria-hidden="true"` on the handle element

**Priority:** Must  
**Story Points:** 2  
**Tasks:** T-009

---

#### Story 2.3 — Visual feedback: drop indicator shows insertion point
**As Oscar**, I want a visual line to show where the dragged card will land, **so that** I know exactly where it will be inserted before I release.

**Acceptance Criteria:**
- [ ] When dragging over the **top half** of a card, a 2px purple line appears at the top of that card
- [ ] When dragging over the **bottom half** of a card, a 2px purple line appears at the bottom of that card
- [ ] The line disappears immediately when the drag ends (regardless of drop success/failure)
- [ ] No indicator appears when hovering over the card being dragged itself

**Definition of Done:**
- [ ] `TaskCard` subscribes to `useDragStore` with per-card boolean selectors (`isDragOverThis`, `insertBeforeThis`)
- [ ] `border-t-2 border-t-primary` applied when `isDragOverThis && insertBefore`
- [ ] `border-b-2 border-b-primary` applied when `isDragOverThis && !insertBefore`
- [ ] `resetDrag()` clears `dragOverTaskId` on `dragend`
- [ ] Only the two affected cards re-render per drag event (O(1) re-render budget)

**Priority:** Must  
**Story Points:** 3  
**Tasks:** T-009

---

#### Story 2.4 — Reorder survives precision loss (rebalance guard)
**As a system**, I want the rank system to automatically recover from precision degradation, **so that** extreme repeated reordering never breaks the sort order.

**Acceptance Criteria:**
- [ ] When computed gap < 0.001 (extremely dense ranking), client automatically rebalances all tasks in the column to `[1000, 2000, 3000, ...]`
- [ ] Rebalance sends one `PATCH /rank` per task in the column (batch)
- [ ] A `console.warn('[rank] rebalance triggered', ...)` is emitted for observability
- [ ] No visible disruption to the user during rebalance

**Definition of Done:**
- [ ] `computeDropRank` returns `{ needsRebalance: true, rebalancedTasks }` when gap < 0.001
- [ ] `handleDrop` in `Board.tsx` iterates `rebalancedTasks` and calls `reorderTask` for each
- [ ] Optimistic update correctly applies rebalanced ranks before server confirms

**Priority:** Should  
**Story Points:** 3  
**Tasks:** T-008

---

#### Story 2.5 — API failure reverts reorder with user notification
**As Oscar**, I want to be notified if a reorder fails to save, **so that** I know my priority change wasn't persisted and I can try again.

**Acceptance Criteria:**
- [ ] If `PATCH /rank` returns an error, the card snaps back to its original position
- [ ] A toast notification appears: `"Reorder failed — please try again"` (error style)
- [ ] The board state after rollback matches the pre-drag state exactly

**Definition of Done:**
- [ ] `reorderTask` in `useAppStore` snapshots `tasks[column]` before optimistic update
- [ ] On `catch`, `set({ tasks: prevTasks })` restores the snapshot
- [ ] `showToast(err.message, 'error')` is called on failure
- [ ] No `loadBoard()` called on success (only on error as implicit in rollback)

**Priority:** Must  
**Story Points:** 2  
**Tasks:** T-007

---

### Epic 3: Cross-column drag preserves rank coherence

> As Oscar, I want tasks I move between columns to appear at the bottom of the destination column, and for rank-based ordering to remain coherent.

#### Story 3.1 — Moving a task to another column appends it to the tail
**As Oscar**, I want tasks I drag to another column to land at the bottom of that column, **so that** I don't accidentally disrupt the existing priority queue in the destination.

**Acceptance Criteria:**
- [ ] Dragging a task from todo to in-progress places it at the bottom of in-progress
- [ ] The destination column's existing task order is unchanged
- [ ] The moved task's `rank` is `MAX(in-progress ranks) + 1000`
- [ ] After page reload, the moved task remains at the tail of in-progress

**Definition of Done:**
- [ ] `store.moveTask` atomically computes `MAX(destination rank) + 1000` in a transaction
- [ ] `PUT /move` response includes `rank` in the task object
- [ ] No existing cross-column drag tests broken

**Priority:** Must  
**Story Points:** 2  
**Tasks:** T-002

---

### Epic 4: LOOP-3 integration (priority queue)

> As LOOP-3 (Board Autopilot), I need the todo column to be ordered by user-defined rank so I can work on the highest-priority task first.

#### Story 4.1 — LOOP-3 reads todo tasks in rank order
**As LOOP-3**, I want `GET /tasks?column=todo` to return tasks ordered by rank, **so that** the first task in the response is always the one Oscar has placed at the top of his priority queue.

**Acceptance Criteria:**
- [ ] `GET /spaces/:spaceId/tasks?column=todo` returns tasks ordered by `rank ASC`
- [ ] After Oscar reorders tasks via drag, subsequent LOOP-3 reads reflect the new order
- [ ] If tasks have the same rank (edge case), `created_at ASC` is the tiebreaker

**Definition of Done:**
- [ ] `store.getTasksByColumn` uses `ORDER BY rank ASC, created_at ASC`
- [ ] MCP tool `kanban_list_tasks({ column: 'todo' })` calls this endpoint and returns ordered results
- [ ] E2E test confirms the first todo task after reorder matches the user's intended top priority

**Priority:** Must  
**Story Points:** 1  
**Tasks:** T-002 (backend), T-011 (E2E)

---

## Story Map

```
Epic 1: Rank field      → T-001, T-002, T-003, T-004 (backend)
Epic 2: Drag-to-reorder → T-005, T-006, T-007, T-008, T-009, T-010 (frontend)
Epic 3: Cross-column    → T-002 (already covers moveTask)
Epic 4: LOOP-3          → T-002 (store ordering), T-011 (E2E verification)
QA                      → T-011 (Playwright E2E + backend integration)
```

## MoSCoW Summary

| Priority | Stories |
|---|---|
| **Must** | 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.5, 3.1, 4.1 |
| **Should** | 2.4 (rebalance guard) |
| **Could** | Keyboard reordering (not in scope v1), touch drag polyfill |
| **Won't** (v1) | iOS touch-drag (HTML5 DnD limitation), within-column drop at specific position on cross-column drag |

## Total Story Points: 30

| Epic | Points |
|---|---|
| Epic 1: Persistent rank | 9 |
| Epic 2: Drag-to-reorder | 18 |
| Epic 3: Cross-column coherence | 2 |
| Epic 4: LOOP-3 integration | 1 |

## Edge Cases and Non-Happy Paths

| Edge Case | Handling |
|---|---|
| Column is empty — first task dropped | `rank = 1000` (0 + 1000) |
| Only one task in column | No reorder possible — no indicator shown |
| Drop on self (same card) | `draggedTaskId === task.id` guard prevents indicator and reorder |
| Gap < 0.001 (precision loss) | Client rebalance triggers batch PATCH |
| API offline / 500 during PATCH /rank | Optimistic revert + toast error |
| Two users reorder simultaneously | Last write wins (no conflict resolution in v1) |
| Task rank = 0 (migration default before seeding) | Migration seeds all ranks before server starts accepting connections |
| NaN / Infinity passed as rank | Backend: 400 VALIDATION_ERROR |
| Cross-column drop while same-column drag is in flight | Not possible — drag state is reset on `dragend` before cross-column drop triggers |
