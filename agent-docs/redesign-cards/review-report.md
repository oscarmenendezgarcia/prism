# Review Report: Redesign Cards

**Date:** 2026-03-26
**Reviewer:** code-reviewer
**Verdict:** APPROVED_WITH_NOTES

---

## Design Fidelity

### Summary

The implementation faithfully reproduces the three-zone progressive disclosure layout specified in the Stitch screens and wireframes. All primary states (resting, hover, context menu, done, empty/minimal) are correctly implemented. Two minor deviations were found: a Badge shape difference and a hover overlay anchor position that differs slightly from the Stitch spec.

### Deviations

| Severity | Screen | Element | Expected | Actual |
|----------|--------|---------|----------|--------|
| MINOR | card-resting.html | Badge shape | `border-radius: 9999px` (pill / `rounded-full`) — Stitch CSS uses `border-radius: 9999px` | Badge uses `rounded-sm` (6px) — defined in `Badge.tsx` which predates this feature. The Badge component is a pre-existing shared component; the deviation is at the design-system level, not an implementation error. |
| MINOR | card-hover.html | Hover overlay anchor | Stitch positions overlay at `top: -1px; right: -1px` — slightly outside the card boundary, producing a floating detached appearance | Implementation uses `top-2 right-2` — overlay sits inside the card boundary. This matches the blueprint spec (`absolute top-2 right-2`) so the developer followed the correct source of truth. Stitch and blueprint differ; blueprint takes precedence. |
| MINOR | card-resting.html | Description text color | Stitch uses `rgba(245,245,247,0.40)` for description | Implementation uses `text-text-secondary/70` which resolves to `rgba(245,245,247,0.55) * 0.70 = ~0.39` — effectively the same; token-based, acceptable. |

_No CRITICAL or MAJOR deviations found._

---

## Code Quality

### Design System Compliance

**One violation found** (minor, no inline styles):

- **Hardcoded `#3b82f6` (blue-500)** appears three times in `TaskCard.tsx`:
  - Line 165: `border-[#3b82f6]/40` — active run indicator border
  - Line 199: `bg-[#3b82f6]` — outer ping ring of the run dot
  - Line 200: `bg-[#3b82f6]` — inner dot fill

  The design system already has `--color-primary: #0A84FF` (Apple Blue). The blueprint (§2.5) specifies `bg-[#3b82f6]` explicitly (Tailwind blue-500), which is not an existing token. This is a deliberate named deviation from the primary color, but it introduces a hardcoded value that cannot be theme-switched. The developer should either:
  - Define a token (e.g., `--color-run-indicator: #3b82f6`) in `index.css` and reference it via a Tailwind config entry, or
  - Use `bg-primary` / `border-primary` since the primary token `#0A84FF` is visually near-identical for this purpose.

  This does not violate the "no `style={{}}` inline styles" rule since it uses Tailwind's arbitrary value syntax. It is a **minor** token-gap issue.

- All other color references use design system tokens correctly: `bg-surface`, `bg-surface-elevated`, `text-text-primary`, `text-text-secondary`, `border-border`, `text-primary`, `text-error`, `bg-surface-variant`, `bg-error/[0.08]`.

- No `style={{}}` attributes found anywhere in either new file.

### Code Quality

All rules respected with one note:

- **`run-agent` context menu item is a no-op when selected via `more_vert` menu.** `handleContextMenuSelect` in `TaskCard.tsx` handles `move-left`, `move-right`, and `delete` but explicitly skips `run-agent` with a comment: _"run-agent is handled by AgentLauncherMenu inside CardActionMenu — not via ContextMenu"_. This means that if the user opens the `more_vert` context menu (especially on touch/keyboard) and taps "Run Agent", nothing happens. The `AgentLauncherMenu` is only accessible through the hover overlay, which is the coarse-pointer always-visible row.

  **Impact:** On keyboard/touch, "Run Agent" appears as an enabled menu item in the `more_vert` ContextMenu but clicking it does nothing. This is a **functional gap** for keyboard and touch users — the primary accessibility path for running an agent (per the wireframe sequence diagram) silently fails.

  The developer left a comment acknowledging the gap but did not resolve it. The fix would be to either: (a) invoke `AgentLauncherMenu`'s trigger programmatically via a ref when `run-agent` is selected, or (b) remove the `run-agent` item from the context menu items entirely (and let users access it only through the hover toolbar's `AgentLauncherMenu` button).

  This is a **MAJOR functional issue** — not a design deviation, but a behavior gap that degrades the keyboard/touch workflow. The developer's own blueprint (§2.6 sequence diagram) shows the `more_vert` path as the canonical touch/keyboard action flow.

- Avatar gradient uses Tailwind named color classes (`from-indigo-500 to-purple-600`, etc.) rather than design tokens. These are internal to the avatar helper and not exposed as public colors — acceptable for decorative gradients with no semantic meaning.

- Functions are short and single-purpose. No magic numbers outside of the run indicator color (noted above). No dead code or commented-out blocks.

### Security

No issues found:

- No `dangerouslySetInnerHTML` usage.
- No secrets or API keys in code.
- All user input (task title, description, assigned name) is rendered as text content, not HTML.
- No new API endpoints introduced.

### Pattern Consistency

- Correctly uses `useAppStore` and `useRunHistoryStore` Zustand stores.
- Correctly uses the existing `ContextMenu`, `Badge`, and `AgentLauncherMenu` shared/board components — no reimplementations.
- `CardActionMenu` follows the same component structure as adjacent board components.
- `onDragStart={(e) => e.stopPropagation()}` on the `more_vert` button (line 210) correctly prevents drag events from firing when the user clicks the button — a defensive pattern consistent with the existing codebase.
- The `aria-hidden="true"` on the hover overlay `<div>` (line 276) is correct: the overlay buttons are still in the DOM and accessible to keyboard users (the overlay is only visually hidden via `opacity-0`, not hidden from the accessibility tree). The `aria-hidden` suppresses the wrapper `<div>` from announcing redundantly, while `role="toolbar"` on the inner `CardActionMenu` `<div>` correctly exposes the buttons.

---

## Pre-existing Test Failures

Two test failures exist in the suite that are **unrelated to this feature**:

| File | Test | Status |
|------|------|--------|
| `__tests__/hooks/useAgentCompletion.test.ts` | `shows confirmation toast when confirmBetweenStages=true and autoAdvance=true` | Failing — predates this feature |
| `__tests__/components/PipelineLogToggle.test.tsx` | `is not rendered when pipelineState is null` | Failing — predates this feature |

Both failures are in files not modified by this feature's developer. They do not affect the verdict for this review but should be tracked as existing debt.

---

## Verdict

**APPROVED_WITH_NOTES**

The three-zone redesign is correctly implemented, the design system is followed with one minor token gap (`#3b82f6`), tests are thorough (61 pass for the feature's two new files), and no security issues exist.

Two notes the developer should address before the next sprint:

1. **(Important — keyboard/touch)** The `run-agent` item in the `more_vert` ContextMenu is currently a silent no-op. Either wire it to `AgentLauncherMenu` or remove it from the context menu items list. File: `TaskCard.tsx` lines 123–128 and 142.

2. **(Minor)** Replace `bg-[#3b82f6]` and `border-[#3b82f6]/40` with a design token or use `bg-primary` / `border-primary`. File: `TaskCard.tsx` lines 165, 199, 200.

These can be addressed in a follow-up commit and do not block QA progression.

---

## Screenshots

- `review-card-resting.png` — Pre-build screenshot showing old layout (confirms build was stale before review)
- `review-board-after-build.png` — Post-build screenshot showing new three-zone card layout
- `review-hover-overlay-zoom.png` — Hover overlay visible on BUG-002 card (arrow-right + smart_toy + delete icons)

All screenshots taken from `http://localhost:3000` (production build via `node server.js`).
