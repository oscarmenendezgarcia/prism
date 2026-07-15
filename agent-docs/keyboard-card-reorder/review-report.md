# Review Report: Keyboard-accessible in-column task reorder

**Date:** 2026-07-15
**Reviewer:** code-reviewer
**Branch / PR:** `pipeline/run-765266a8` → main (PR #170)
**Verdict:** APPROVED_WITH_NOTES

---

## Scope of review

Read the pipeline artifacts (ADR-1, blueprint.md, tasks.json) and the six commits on
the run branch (`main..HEAD`). Reviewed all touched sources:

- `frontend/src/stores/useAnnouncer.ts` (new)
- `frontend/src/components/shared/Announcer.tsx` (new)
- `frontend/src/components/board/Board.tsx` (edited — keyboard handler + `resolveKeyboardNeighbor`)
- `frontend/src/components/board/Column.tsx` (edited — boundary flags + callback threading)
- `frontend/src/components/board/TaskCard.tsx` (edited — focusability, keydown, focus ring)
- `frontend/src/components/board/CardActionMenu.tsx` (edited — Move up/down buttons)
- Test files under `frontend/__tests__/` for the above

**Design fidelity note:** the ux-api-designer stage produced `wireframes.md`,
`api-spec.json`, `user-stories.md`, `wireframes-stitch.md`, and a Stitch reference
screen, but those files were **not committed to the branch** — only the architect's
ADR/blueprint/tasks.json are on-disk. Fidelity was therefore checked against the
architect's blueprint §3.3 (interfaces / contracts) and the ux-api-designer's
handoff notes on the Kanban task, which restate the button-order, aria-label,
tooltip-hint, copy strings, and 28×28 button-size decisions.

---

## Design Fidelity

### Summary
The implementation matches the architectural blueprint and the UX handoff
verbatim: `Alt+ArrowUp/Down` accelerator on a focused card, discoverable
Move up / Move down buttons at the leftmost slot of `CardActionMenu` followed
by a thin divider from the existing horizontal move pair, matching icons,
`aria-label="Move up"`/`"Move down"`, tooltip hints `"Move up (Alt+↑)"`
/`"Move down (Alt+↓)"`, disabled at boundaries and while `isMutating`, and
polite `role="status"` announcements with the copy strings the UX stage
finalised (success, column-boundary, arc-group-boundary). `isMutating` is a
silent no-op on both the key path and the buttons, matching the UX
error-channel dedup decision.

### Deviations

_No CRITICAL or MAJOR deviations found._

| Severity | Location | Element | Expected | Actual |
|----------|----------|---------|----------|--------|
| MINOR | `TaskCard.tsx:164` | Card is `tabIndex=0` but has no `onKeyDown` handler for `Enter`/`Space` | With the card now in the tab order, a keyboard user reaching a card would expect `Enter`/`Space` to open the detail panel (same effect as the existing `onClick`) | Only `Alt+Arrow` is handled; other keys pass through. The blueprint §3.3 explicitly says these keys must **not be swallowed** but does not require them to open the panel, so this is consistent with the spec. Recommend adding an `Enter`/`Space` → `openDetailPanel` binding in a follow-up. |
| MINOR | `Announcer.tsx:23` | Nonce marker uses `nonce % 3` zero-width spaces | Repeated identical announcements must always change the DOM text node | Cycles 0→1→2→0 lengths, so **consecutive** calls always change (length delta ±1). Correct — but a plain incrementing suffix (`​`.repeat(nonce & 3)) or a `key={nonce}` on the wrapper would be more obviously safe if `nonce` ever mutates non-monotonically in a future change. Consider adding a code comment stating the modulus is safe because `nonce` is strictly monotonic. |

### Missing UX artefacts (process, not code)
| Severity | Item | Note |
|----------|------|------|
| MINOR | `wireframes.md`, `api-spec.json`, `user-stories.md`, `wireframes-stitch.md`, `stitch-screens/task-card-reorder-states.html` | Referenced by the UX stage's attachments but not committed. Not a blocker (the design decisions are recoverable from the Kanban notes and the developer implemented them faithfully) but the artefacts should be committed to `agent-docs/keyboard-card-reorder/` alongside the rest so future readers of the branch have the full spec on disk. Recommend the developer add them in a follow-up commit before merge. |

---

## Code Quality

### Design system compliance
All rules respected.

- No `style={{}}` inline styles except the pre-existing `animationDelay` for stagger (untouched by this PR).
- Tokens used correctly: `bg-surface`, `bg-surface-variant`, `bg-surface-elevated`, `border-border`, `text-text-secondary`, `text-primary`, `text-error`. No hardcoded hex.
- `focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface` uses the correct Tailwind v4 focus-visible pattern; the ring shows only on real keyboard focus, not on click.
- Icons: `arrow_upward` / `arrow_downward` Material Symbols reused. No duplicate font import.
- Shared components: `Announcer` is a new **shared** component correctly placed under `components/shared/`.

### Code quality
- `resolveKeyboardNeighbor` is a pure, exported function with a discriminated-union return — nicely testable and self-documenting.
- `handleKeyboardReorder` is short and single-purpose; reuses `computeDropRank` + `reorderTask` verbatim, matching the "one handler, two producers" rationale from the ADR.
- `handleKeyDown` on the card is scoped — only intercepts `altKey + ArrowUp/Down`, all other keys pass through. No accidental Tab/Enter/Escape trap.
- `canMoveUp` / `canMoveDown` are threaded as explicit props parallel to `onMoveUp` / `onMoveDown`, which — as the developer noted — makes a wiring bug an observable disabled button rather than an invisibly-hidden control. Good defensive design.
- No dead code, no commented-out blocks, no magic numbers.
- No unhandled promise rejections; the store's existing optimistic rollback + toast on failed `PATCH …/rank` is inherited unchanged.

### Security
No new HTTP surface, no new user-input rendering path, no `dangerouslySetInnerHTML`. The task title is interpolated into the announcement string but rendered as text into an `sr-only` `<div>` — no XSS surface. The route reused (`PATCH /api/v1/tasks/:id/rank`) is unchanged and already validated server-side.

### Pattern consistency
- Zustand store pattern matches the existing stores (small, focused, `create<State>()(...)`).
- Callback wiring `Board → Column → TaskCard` mirrors the existing drag callbacks.
- Toolbar buttons in `CardActionMenu` follow the exact same 28×28 (`w-7 h-7`) shape, `text-text-secondary` idle / `text-primary` hover, and `disabled:opacity-40 cursor-not-allowed` disabled treatment as the four existing buttons.
- Folio decisions honoured: `decisions/tab-drag-local-state` (no `useDragStore` change), `decisions/patch-rank-avoids-fts` (rank sub-resource reused unchanged).

---

## Verdict

**APPROVED_WITH_NOTES** — Ready for QA.

No CRITICAL or MAJOR issues. Two MINOR polish items and one process item (missing UX
artefacts on disk) noted above; none block QA. The developer should address the
missing artefact commit and the `Enter`/`Space` → open-panel follow-up before merge,
but neither blocks the QA stage from starting.

---

## Follow-ups for developer (non-blocking)

1. Commit the ux-api-designer artefacts (`wireframes.md`, `api-spec.json`, `user-stories.md`, `wireframes-stitch.md`, `stitch-screens/`) to `agent-docs/keyboard-card-reorder/`.
2. Add `Enter`/`Space` → `openDetailPanel(task)` in `TaskCard.handleKeyDown` so a keyboard user who has tab-focused a card can open its detail panel without needing a pointer.
3. Add a one-line comment to `Announcer.tsx` explaining that `nonce % 3` is safe because `nonce` is strictly monotonic (or switch to a `key={nonce}` on the wrapper to make the intent obvious).
