# Blueprint — Keyboard-accessible in-column task reorder

**Feature slug:** `keyboard-card-reorder`
**Arc:** Polish-v-next
**Type:** feature (accessibility)
**Complexity:** Medium — single-domain (frontend), additive, reversible.
**Scope:** Frontend only. **No backend / no API change.** The `PATCH /api/v1/tasks/:id/rank`
sub-resource and `reorderTask(taskId, column, newRank)` store action already exist (PR #143).

---

# REQUIREMENTS SUMMARY

## Problem
In-column drag-to-reorder (PR #143) is **mouse-only**: it relies on native HTML5
`draggable` + `dragstart/dragover/drop`. Keyboard-only and assistive-tech users
**cannot reorder tasks at all** — they can only move cards *between* columns via the
`CardActionMenu` move-left / move-right buttons. Additionally, the `<article>` card is
**not in the tab order today** (no `tabIndex`), so a keyboard user cannot even focus a
card to act on it.

## Functional requirements
- FR-1 — A keyboard user can move the focused card **up** or **down** one position within
  its column and have the new order persisted.
- FR-2 — The reorder path reuses the existing `reorderTask` action and rank model
  (no new persistence mechanism, no new endpoint).
- FR-3 — Each reorder is announced to assistive tech via a polite `aria-live` region
  ("Task *title* moved to position N of M in *Column*").
- FR-4 — A **discoverable, self-documenting** affordance exists (not only a hidden
  shortcut): move-up / move-down controls surfaced through the existing `CardActionMenu`,
  operable by keyboard **and** pointer.
- FR-5 — Boundary presses (top card ↑ / bottom card ↓) are safe no-ops with a spoken
  boundary announcement — never an error, never a wrap-around.
- FR-6 — Focus stays on the moved card after the reorder so repeated presses keep moving
  the same card.

## Non-functional requirements & constraints
- **NFR-1 Accessibility (primary driver):** WCAG 2.2 AA. Directly satisfies:
  - **2.1.1 Keyboard** — all reorder functionality reachable without a pointer.
  - **2.5.7 Dragging Movements (WCAG 2.2)** — a single-pointer, non-drag alternative to the
    drag gesture (the `CardActionMenu` up/down buttons serve mouse users who cannot drag too).
  - **2.4.7 Focus Visible** — the card shows a visible focus indicator (none exists today).
  - **4.1.3 Status Messages** — position changes announced without moving focus.
- **NFR-2 Performance:** reorder is optimistic (existing `reorderTask` re-sorts locally,
  then fires one cheap `PATCH …/rank`). Rapid repeated presses must remain O(1) per press
  and must not churn FTS (guaranteed by the existing rank sub-resource — folio
  `decisions/patch-rank-avoids-fts`).
- **NFR-3 No regression:** existing mouse drag-reorder is untouched; the new path is purely
  additive.
- **NFR-4 Reduced motion:** no new animation is introduced on reorder beyond what the list
  already does; the layout shift is instantaneous (respects `prefers-reduced-motion`).

## Flagged assumptions (see kanban notes)
- **A-1:** The precise **modifier key** and the **visual affordance** are UX-stage
  decisions. This blueprint recommends `Alt`+`ArrowUp`/`ArrowDown` as the accelerator and
  `CardActionMenu` up/down buttons as the canonical control, and hands the final visual
  polish to `ux-api-designer` (see ADR §Rationale + Open Questions).
- **A-2:** Reorder operates on the **rendered/visible** order (respecting arc filter and arc
  grouping), and is **constrained within an arc group** when grouping is on (a press that
  would cross a group boundary is a spoken no-op — moving across groups would implicitly
  reassign the card's arc, which is out of scope).

---

# TRADE-OFFS

## Trade-off 1 — Reorder trigger: modifier+Arrow accelerator vs. explicit buttons vs. dnd-kit "pick-up" model
- **Option A — `Alt`+`ArrowUp/ArrowDown` direct swap.** Press once = move one slot.
  - *Pros:* matches "move line up/down" muscle memory (IDEs); low keystroke cost; no mode
    to enter/exit; exactly what the brief describes.
  - *Cons:* a hidden shortcut is not self-discoverable; needs `aria-keyshortcuts` + hint.
- **Option B — Explicit move-up / move-down buttons in `CardActionMenu`.**
  - *Pros:* self-documenting (`aria-label` + tooltip); works for pointer users (satisfies WCAG
    2.5.7); zero new keyboard model; mirrors the existing move-left/right buttons.
  - *Cons:* slower for power users; adds two controls to an already-busy toolbar.
- **Option C — dnd-kit "Space to pick up → Arrow to move → Space to drop" (as in `SortableStageList`).**
  - *Pros:* consistent with the pipeline-stage reorder; rich live announcements built in.
  - *Cons:* introduces a modal "grabbed" state and a second DnD library into the board;
    heavier than the brief asks; the board's drag path is hand-rolled, not dnd-kit — mixing
    the two raises complexity and re-render cost.
- **Recommendation: A **and** B together.** The two buttons are the canonical, discoverable,
  WCAG-2.5.7-compliant control (and give mouse users a no-drag path); `Alt`+`Arrow` is the
  keyboard accelerator layered on the focused card. Both call **one** shared handler.
  Option C is rejected — it would drag a second DnD paradigm onto the board for no benefit.

## Trade-off 2 — Card focus model: `tabIndex=0` per card vs. roving tabindex
- **Option A — every card `tabIndex={0}`.**
  - *Pros:* trivial; every card reachable by Tab; matches "a focused card" literally.
  - *Cons:* adds one tab-stop per card — Tabbing past a full column to reach the next region
    is tedious in large boards.
- **Option B — roving tabindex (one `tabIndex=0` per column, arrows move focus).**
  - *Pros:* WAI-ARIA-grid-correct; a single tab-stop per column.
  - *Cons:* larger change; hijacks plain `ArrowUp/Down` for focus movement (so reorder must
    use a modifier anyway); needs a focus manager per column.
- **Recommendation: Option A for v1**, with roving tabindex explicitly deferred (documented
  in ADR Alternatives). Reason: bounded, low-risk, and the `Alt` modifier keeps plain arrows
  free — so a later roving-tabindex upgrade is non-breaking. If Tab-stop volume becomes a
  complaint, revisit. (Assumption flagged to UX.)

## Trade-off 3 — Announcement channel: dedicated shared `aria-live` announcer vs. reuse Toast
- **Option A — new dedicated visually-hidden `role="status" aria-live="polite"` announcer**
  (tiny `useAnnouncer` store + one `<Announcer/>` mounted once).
  - *Pros:* SR-only, silent to sighted users; one live region (no duplicate announcements);
    reusable for future a11y needs; decoupled from visual toasts.
  - *Cons:* one small new store + component.
- **Option B — reuse `showToast` (already has `aria-live`).**
  - *Pros:* zero new code.
  - *Cons:* pops a **visible** toast on every keystroke — visually noisy and wrong for a
    high-frequency micro-action; toasts auto-dismiss/stack awkwardly under rapid presses.
- **Recommendation: Option A.** Position changes are status messages, not notifications;
  they must reach SR users without spamming the viewport. A shared announcer is a small,
  reusable primitive the codebase currently lacks.

---

# ARCHITECTURAL BLUEPRINT

## 3.1 Core components

| Component | Single responsibility | Location | Change |
|---|---|---|---|
| `useAnnouncer` store | Hold the latest polite status message + `announce(msg)` | `frontend/src/stores/useAnnouncer.ts` | **new** |
| `<Announcer/>` | Render one SR-only `role="status" aria-live="polite"` region fed by `useAnnouncer` | `frontend/src/components/shared/Announcer.tsx` | **new** |
| `Board` | Own the reorder handler: resolve visible neighbor → compute rank → call `reorderTask` → `announce()`; mount `<Announcer/>` | `frontend/src/components/board/Board.tsx` | edit |
| `computeDropRank` | Compute new rank / rebalance from (columnTasks, id, overId, insertBefore) | `Board.tsx` (existing) | **reused as-is** |
| `Column` | Pass the keyboard-reorder callback + visible-order context down to cards | `Column.tsx` | edit (prop pass-through) |
| `TaskCard` | Be focusable; translate `Alt`+`Arrow` keydown into a reorder request; visible focus ring; `aria-keyshortcuts` | `TaskCard.tsx` | edit |
| `CardActionMenu` | Render move-up / move-down buttons (discoverable canonical control) | `CardActionMenu.tsx` | edit |
| `reorderTask` | Optimistic rank update + persist via `PATCH …/rank` | `useAppStore.ts` (existing) | **reused as-is** |

**Design rule (folio `decisions/tab-drag-local-state`):** `useDragStore` stays
kanban-*drag*-only. Keyboard reorder is a **discrete** action (press → compute → persist)
that needs **no** grabbed/drag-over state, so it adds **nothing** to `useDragStore`.

## 3.2 Data flow

```mermaid
sequenceDiagram
    actor U as Keyboard user
    participant TC as TaskCard (focused)
    participant B as Board.handleKeyboardReorder
    participant CDR as computeDropRank (existing)
    participant S as useAppStore.reorderTask
    participant API as PATCH /tasks/:id/rank
    participant AN as useAnnouncer

    U->>TC: Alt+ArrowDown (or clicks ▼ button)
    TC->>B: onKeyboardReorder(taskId, column, 'down')
    B->>B: resolve visible order (arc filter/group)
    alt at boundary (last in group)
        B->>AN: announce("Already at bottom of <Column>")
    else has neighbor
        B->>CDR: neighbor = next visible card; overId, insertBefore=false
        CDR-->>B: { newRank, needsRebalance?, rebalancedTasks? }
        B->>S: reorderTask(taskId, column, newRank)  (or rebalance loop)
        S->>S: optimistic re-sort (list re-renders, key=taskId → focus retained)
        S->>API: PATCH rank  (cheap, no FTS)
        B->>AN: announce("Task '<title>' moved to position N of M in <Column>")
    end
    AN-->>U: SR reads polite live region (focus unchanged)
```

## 3.3 Interfaces / contracts (no HTTP change — internal component contracts)

**Board → Column → TaskCard callback**
```ts
// Direction is within-column vertical movement.
type ReorderDirection = 'up' | 'down';
onKeyboardReorder(taskId: string, column: Column, direction: ReorderDirection): void;
```

**`useAnnouncer` store**
```ts
interface AnnouncerState {
  message: string;            // latest polite status text
  announce: (msg: string) => void;
}
```
Implementation note: to force SR re-announcement of an identical string (e.g. two boundary
presses in a row), append a zero-width nonce or toggle a counter so the live-region text
node actually changes.

**`TaskCard` keydown contract**
- Card is `tabIndex={0}`, `role="listitem"` (unchanged), `aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"`.
- On `keydown`: if `e.altKey && key ∈ {ArrowUp, ArrowDown}` and `!isMutating` →
  `e.preventDefault(); e.stopPropagation();` then `onKeyboardReorder(id, column, dir)`.
  All other keys pass through (must **not** swallow Tab, Enter/Space→open panel, Escape).
- Card gains a `focus-visible` ring (`focus-visible:ring-2 focus-visible:ring-primary
  focus-visible:outline-hidden`) — none exists today.

**`CardActionMenu` new controls**
- `onMoveUp?: () => void` / `onMoveDown?: () => void`, rendered as two icon buttons
  (`arrow_upward` / `arrow_downward`), `aria-label="Move up"` / `"Move down"`, `title`
  tooltip includes the shortcut hint ("Move up (Alt+↑)"). Disabled at list boundaries and
  while `isMutating`. Wired to the same `handleKeyboardReorder`.
  Final placement/visual grouping vs. the existing left/right buttons is a **UX-stage** call.

## 3.4 Boundary & edge-case rules
- **Top/bottom:** first visible card ↑ and last visible card ↓ → no store call; announce
  "Task '…' is already at the top/bottom of <Column>". Buttons rendered `disabled`.
- **Arc grouping ON:** neighbor is the adjacent card **within the same arc group**; a press
  that would cross into another group (or the ungrouped bucket) is a boundary no-op
  (crossing would silently change `arc` — out of scope). (Assumption A-2.)
- **Arc filter active:** compute neighbor from the **filtered** visible list; rank is placed
  relative to visible neighbors (hidden cards keep their ranks; this matches drag behavior).
- **`isMutating` (cross-column move in flight):** ignore reorder presses; buttons disabled.
- **Rebalance:** when fractional gap collapses, reuse `computeDropRank`'s existing
  rebalance branch (loops `reorderTask` over `rebalancedTasks`) — identical to drag.
- **Focus retention:** list items are keyed by `task.id`, so React moves the existing DOM
  node on reorder and focus is preserved. **Must be verified in QA** (known reorder-focus
  gotcha).

## 3.5 Observability
Frontend-only; no server telemetry. Observability = the a11y surface itself:
`aria-live` announcements are the user-facing "log". Component tests assert the announced
strings. No new metrics/traces (out of scope for a client interaction).

## 3.6 Deploy / rollout
Ships with the normal frontend build (`dist/`), served by `server.js`. No migration, no
flag, fully reversible (revert the additive components). Existing CI runs frontend Vitest +
backend `node:test`; QA adds Playwright keyboard E2E.

## 3.7 Testing strategy (for QA stage)
- **Unit:** neighbor/rank resolution incl. boundaries, arc-group constraint, rebalance path.
- **Component (RTL):** `Alt+ArrowUp/Down` reorders and calls `reorderTask` with expected
  rank; plain arrows / Tab / Enter are **not** swallowed; announcer text is correct;
  boundary press announces and does not call `reorderTask`; buttons disabled at boundaries.
- **E2E (Playwright, keyboard-only):** Tab to a card, `Alt+ArrowDown`, assert DOM order
  changed and focus remains on the same card; reload → order persisted.
- **A11y:** focus-visible ring present; live region is `role="status"`/`aria-live="polite"`
  and SR-only; `aria-keyshortcuts` present.
```
