# Review Report: touch-reorder

**Date:** 2026-07-15
**Reviewer:** code-reviewer
**Verdict:** APPROVED

---

## Design Fidelity

### Summary
Implementation matches the UX spec (`wireframes.md`) and the architect blueprint (`blueprint.md`) exactly. This is a UI-behavior fix with no new screens — no Stitch mocks were produced by the UX stage (justified in `wireframes-stitch.md`), so fidelity was validated against the ASCII wireframe + written state matrix rather than image diff.

Verified against spec:
- `CardActionMenu` gains `↑` / `↓` buttons using `arrow_upward` / `arrow_downward` (Material Symbols) — matches the arrow-with-shaft family of the existing `arrow_back` / `arrow_forward`.
- Buttons are grouped **before** the existing `←` / `→` cluster, with a `w-px h-4 mx-0.5 bg-border/70` divider between the two groups (spec called `border-l border-border/60 mx-0.5 h-4 self-center` — visually equivalent, uses the same token family; a minor deviation with no visible impact).
- Same `w-7 h-7`, `rounded-sm`, `text-text-secondary hover:text-primary hover:bg-surface-variant disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150` classes as the existing buttons — zero new visual language.
- Native `<button type="button">` with `aria-label` + `title` + `disabled` attribute — matches the existing button pattern and the a11y notes.
- All 5 documented states are implemented: default, first-in-column disabled, last-in-column disabled, only-card (both disabled), isMutating disabled.
- Drag handle's `[@media(pointer:coarse)]:opacity-30` class removed from `TaskCard.tsx` — the literal reported defect is gone.

### Deviations

| Severity | Screen | Element | Expected | Actual |
|----------|--------|---------|----------|--------|
| MINOR | CardActionMenu overlay | Group divider | `border-l border-border/60 mx-0.5 h-4 self-center` | `w-px h-4 mx-0.5 bg-border/70` |

The divider deviation is cosmetically equivalent (1px vertical rule, same height, same margin, same border token family). Not worth changing.

---

## Code Quality

### Design System Compliance
All rules respected. Only Tailwind classes used, only design-system tokens (`text-text-secondary`, `text-primary`, `bg-surface-variant`, `bg-border/70`, `border-border`), no inline styles, Material Symbols already loaded, `<button>` native elements throughout.

### Code Quality
- `handleReorderStep` in `Board.tsx` is short, single-purpose, and exhaustively guards: `isMutating`, `index === -1`, edge-of-column, missing neighbor. Reuses `computeDropRank` + `reorderTask` — no duplicated rank math.
- The rebalance branch iterates `rebalancedTasks` the same way `handleDrop` does — behavior is consistent with the existing drag path.
- `isFirst`/`isLast` are correctly derived from the unfiltered `tasks` prop (rank-order), not the arc-filtered visible list — matches the blueprint's "rank is the source of truth" contract and the assumption the developer flagged. Also correctly handles the `rankIndex === -1` case (treated as `isLast=true`, harmless because such a card can't appear in the visible list anyway).
- Callback dependencies are minimal (`[reorderTask]`) — matches the existing `useCallback` pattern in Board where Zustand actions are treated as stable references.
- No dead code, no commented-out blocks, no magic numbers.

### Security
No user input is rendered as HTML. No new endpoints, no new store actions, no `dangerouslySetInnerHTML`. Reorder still goes through the existing `reorderTask` store action which hits the existing `/api/v1/spaces/:spaceId/tasks/:id/reorder` endpoint. No new attack surface.

### Pattern Consistency
- Prop shape (`onReorderStep?`, `isFirst?`, `isLast?` with sensible defaults) mirrors the existing `onDragStart?` / `onDragEnd?` optional-callback pattern in `TaskCard`.
- New buttons in `CardActionMenu` follow the same "only render when handler is provided" gate (`typeof onMoveUp === 'function'`) used implicitly by `showLeft`/`showRight`.
- `Column.tsx`'s `isFirst`/`isLast` computation is inline and small — fits the existing style of Column (no helper extracted, matches the surrounding stagger/group math).
- Tests are added to the existing `__tests__/components/*.test.tsx` files rather than a new file — matches the co-located test pattern.

---

## Verification

- `npx vitest run __tests__/components/CardActionMenu.test.tsx __tests__/components/TaskCard.test.tsx __tests__/components/Board.test.tsx` → **98 pass / 0 fail**.
- `npx tsc --noEmit` → **clean**.
- Manual code review of all 4 changed source files + 3 test files.

---

## Verdict

**APPROVED** — Ready for QA. No CRITICAL or MAJOR design deviations, no security issues, tests green, TypeScript clean. The one MINOR divider styling deviation is cosmetically equivalent and not worth a fix cycle.
