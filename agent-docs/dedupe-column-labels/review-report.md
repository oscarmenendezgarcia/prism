# Review Report: Dedupe Column Labels

**Date:** 2026-07-15
**Reviewer:** code-reviewer
**Verdict:** APPROVED

---

## Design Fidelity

### Summary
Pure refactor — no UI changes, no Stitch screens produced by prior stages. Design fidelity review is not applicable. Visual output is byte-identical to `main` because the shared `COLUMN_LABELS` map holds the same string values that were previously duplicated.

### Deviations

_No deviations found — no UI surface changed._

---

## Code Quality

### Design System Compliance
N/A — no Tailwind, color, typography, or component changes.

### Code Quality
- New `frontend/src/constants/columns.ts` is small, well-documented, and typed:
  - `COLUMNS: readonly Column[]` (`as const`) — immutable source of column order.
  - `COLUMN_LABELS: Record<Column, string>` — exhaustive at compile time; adding a new `Column` union member would force an update here.
  - `adjacentColumnLabel(column, direction)` — replaces the two separate `LEFT_LABEL` / `RIGHT_LABEL` partial maps in `CardActionMenu.tsx` with one derivation from `COLUMNS`. Correctly returns `undefined` at board edges.
- All 6 previously-duplicated definitions removed from:
  `useAppStore.ts`, `GlobalSearchModal.tsx`, `AutoTaskModal.tsx`, `Column.tsx`, `TaskDetailPanel.tsx`, `ColumnTabBar.tsx`, plus the related pair in `CardActionMenu.tsx`.
- Board.tsx, TaskCard.tsx and utils/arcs.ts also picked up the shared `COLUMNS` array (bonus cleanup — good).
- `ColumnTabBar.tsx` now derives `TABS` via `COLUMNS.map(...)` — cleaner and keeps tab order tied to column order.
- No dead code, no commented-out blocks left behind.
- `npx tsc --noEmit` passes with zero errors.

### Security
N/A — no user-input handling, no HTML rendering, no new endpoints.

### Pattern Consistency
- Uses the `@/constants/` path alias consistent with `@/types`, `@/components`, etc.
- `Column.tsx` keeps `COLUMN_META` local for the presentation-only fields (`accentClass`, `colIndex`) but pulls labels from the shared map — correct separation.
- `GlobalSearchModal.tsx` correctly imports `Column` type alongside `COLUMN_LABELS` and keeps the local `COLUMN_COLORS` map (color is presentation-only and column-specific; not in scope for this task).

---

## Minor Observations (non-blocking)

1. **`adjacentColumnLabel` return type is `string | undefined`.** In `CardActionMenu.tsx` the calls are guarded by `showLeft` / `showRight`, so `undefined` is never rendered. If the helper is reused elsewhere unguarded, an aria-label of `"Move to undefined"` becomes possible. Consider tightening to throw on edges, or letting the caller pass a fallback. Not required for this PR.
2. `COLUMN_META` in `Column.tsx` now reads labels from `COLUMN_LABELS[key]` for each key rather than iterating `COLUMNS`. Fine as written; the exhaustive `Record<ColumnType, ...>` keeps it type-safe.

Neither warrants CHANGES_REQUIRED.

---

## Verdict

**APPROVED** — Ready for QA. Refactor is minimal, faithful to the blueprint, and eliminates the drift risk called out in the task description. Typecheck is clean.
