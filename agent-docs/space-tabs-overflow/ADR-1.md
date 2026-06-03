# ADR-1: Responsive Space-Tab Bar with Overflow Dropdown, Truncation, and Strengthened Active State

## Status
Accepted

## Context
`SpaceTabs.tsx` lays spaces out as a horizontal strip with hidden horizontal
scroll (`overflow-x-auto scrollbar-none`). At 10+ spaces — the real current
state of this Prism instance — three problems compound: the bar overflows with
no affordance to reach off-screen spaces, every tab carries the same visual
weight so the active space does not stand out, and long technical names
(`related-tags-motive`, `ltr-empathyai-questions`) make the area noisy. The
brief asks us to choose among: (1) truncate + tooltip, (2) limit visible tabs +
"more" dropdown, or (3) a sidebar/picker model. This needs deciding now because
the space count only grows and the bar is on every screen.

## Decision
Adopt a **responsive (priority+) tab bar**: render as many tabs as fit the
container width, collapse the remainder into a single `+N` overflow button that
opens a dropdown (with a filter input when the list is long); always keep the
active space rendered as a visible tab; truncate long names to a bounded width
with the full name in a tooltip and `title`; and strengthen the active-tab
treatment with a filled chip plus a bottom accent indicator and reduced weight
on inactive tabs. Overflow is computed by a new generic, unit-testable
`useOverflowItems` hook (ResizeObserver + per-item width refs).

## Rationale
- This is the only direction that satisfies **all three** stated goals at once:
  no horizontal overflow, active space always one click away and visually
  dominant, and reduced noise — *without* discarding the tab model.
- It **combines** the brief's options rather than picking one: truncation+tooltip
  (option 1) handles long names; the `+N` dropdown (option 2) handles count; the
  picker's best property (search) is folded into the dropdown's filter (option 3)
  while keeping one-click switching that a pure picker would cost.
- Measurement (vs. a fixed visible cap) is required because FR-1 ("never
  overflow") must hold at every viewport width *and* every name length;
  encapsulating it in one hook contains the only real complexity.
- Multi-channel active emphasis (color + weight + position indicator) meets
  WCAG AA and does not rely on color alone.
- Frontend-only, additive + one-component refactor: no store, type, or API
  change, so the blast radius and rollback cost are minimal.

## Consequences
- **Positive:**
  - Tab area never overflows at any space count or width; active space always
    visible and prominent; quieter bar.
  - One-click switching preserved for frequently used spaces.
  - `useOverflowItems` is reusable for any future overflowing strip (e.g. agent
    chips, filters).
  - No backend/contract change → trivial, low-risk deploy and rollback.
- **Negative / Risks:**
  - *Measurement two-pass can flash on first paint.* Mitigation: `useLayoutEffect`
    + a `measuring` gate + Tailwind `invisible` during the measure pass.
  - *Active space could be pushed into overflow.* Mitigation: hook accepts a
    `pinnedId` and forces the active space to stay visible; unit-tested.
  - *Added DOM-measurement code.* Mitigation: isolated, generic, unit-tested;
    O(n) and rAF/debounce-gated for performance.
  - *Mobile behaviour unsettled.* Mitigation: keep the scroll strip on `< sm`
    as a fallback pending a UX decision (logged as a Kanban note/question).

## Alternatives Considered
- **Pure picker (single switcher button + dropdown):** simplest and most
  scalable, but turns every space switch into two clicks and removes
  at-a-glance multi-space visibility — a regression for the common
  bounce-between-active-projects flow. Discarded as the primary model; its
  search idea is reused inside the overflow dropdown.
- **Horizontal scroll with edge fades + scroll buttons:** least logic, but does
  not reduce noise (all long names still rendered), is slow to scan at 10+, and
  lets the active tab scroll out of view. Retained only as the mobile fallback.
- **Fixed visible cap (always first N + overflow):** trivial but still overflows
  at narrow widths with long names and wastes space on wide screens; N is a
  guess. Discarded in favour of measurement.

## Review
Suggested review date: 2026-12-03 (+6 months), or sooner if a global Cmd+K space
switcher is introduced (it may supersede the overflow dropdown's filter).
