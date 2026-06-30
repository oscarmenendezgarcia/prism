# Review Report: Config Panel Redesign — Proposal D

**Date:** 2026-06-30
**Reviewer:** code-reviewer
**Pass:** 2 (fix-loop re-review)
**Verdict:** APPROVED

---

## Context

This is the second review pass. The first pass (commit `59074af`) returned **CHANGES_REQUIRED** with 3 MAJOR and 4 MINOR findings. Developer-agent applied all fixes in commit `2297ab5`. This pass verifies those fixes and re-evaluates the implementation in full.

---

## Fix Verification (MAJOR → Resolved)

### Fix 1 — Inheritance badge in collapsed card rows ✅ RESOLVED

`AgentRoutingCard.tsx` line 129:
```tsx
{!open && <ModelInheritanceBadge source={source} />}
```
The `ModelInheritanceBadge` is now rendered inside the collapsed header `<button>`, positioned after the model pill and before the skill count, guarded by `!open`. The model source (default / global / space / task) is now visible at a glance without expanding the card — exactly as specified in wireframes §Screen 3.

### Fix 2 — Dirty indicator in panel header ✅ RESOLVED

`ConfigPanel.tsx` lines 136–141:
```tsx
{anyDirty && (
  <span
    className="w-1.5 h-1.5 rounded-full bg-primary shrink-0"
    aria-label="Unsaved changes"
  />
)}
```
The dot appears immediately after the "Configuration" label when `anyDirty = configDirty || routingDirty`. Dimensions, color token (`bg-primary`), and `aria-label` all match the wireframe specification.

### Fix 3 — Search empty-state affordances ✅ RESOLVED

All three sub-items are addressed in `AgentRoutingView.tsx`:

1. **Input type**: Changed from `type="search"` to `type="text"` (line 210) — native browser × button no longer relied upon.
2. **Custom × button**: Lines 221–233 — renders a `close` Material Symbol button that calls `setSearch('')` only when `search` is truthy. Accessible with `aria-label="Clear search"`.
3. **Helper text in empty state**: Line 246–247 — `"Try searching by agent name, model, or skill"` secondary line (`text-[11px] text-text-secondary/70`).
4. **"Clear search" action**: Lines 249–258 — primary-colored link-style `<button>` calling `setSearch('')`, matching the wireframe §Screen 4 layout exactly.

---

## Design Fidelity

### Summary

The implementation faithfully reproduces the Proposal D layout and hierarchy described in the wireframes. All MAJOR deviations from pass 1 are resolved. The two remaining MINOR findings from pass 1 are unchanged (acceptable, documented below).

### Deviations

| Severity | Screen | Element | Expected | Actual | Status |
|----------|--------|---------|----------|--------|--------|
| MINOR | All screens | Space badge color token | `text-sky-400 bg-sky-400/10` (wireframe swatch) | `text-info bg-info-container` (`--color-info: #1A73E8`) | Pre-existing — correct design-system approach; hue differs slightly from wireframe but tokens are preferred over Tailwind utilities per CLAUDE.md |
| MINOR | All screens | `style={{}}` in ConfigPanel.tsx | No inline styles | `style={{ '--panel-w': ... }}` at line 114 | Justified exception — documented with `// lint-ok` for CSS custom property injection that Tailwind cannot supply at runtime |

---

## Code Quality

### Design System Compliance

All components use design-system tokens correctly (`bg-surface`, `text-primary`, `border-border`, `bg-primary-container`, `text-info`, `bg-info-container`, etc.). No hardcoded hex colors in JSX.

The single `style={{}}` in `ConfigPanel.tsx` line 114 is a justified, documented exception for dynamic CSS custom property injection (`--panel-w`) used by `usePanelResize`. `// lint-ok` comment is present and accurate.

### Code Quality

- `useCallback` dependencies are correct throughout `AgentRoutingView` and `AgentRoutingCard`.
- `useAgentMetadata` module-level cache with inflight-dedup is clean and avoids redundant network calls.
- `parseAgentFrontmatter` is defensive and never throws.
- The `as any` cast on `saveSettings` (line 123 `AgentRoutingView.tsx`) is the same pre-existing trade-off noted in pass 1 — acceptable for Phase 1, should be typed in Phase 2 when more write paths are added.
- No dead code. No commented-out blocks.

### Security

No issues found. No `dangerouslySetInnerHTML`, no DOM injection, no secrets. Search input is used only as a local filter predicate over pre-fetched data.

### Pattern Consistency

- Zustand selector pattern used consistently.
- API calls through `api.getAgent` (existing `apiFetch`-backed client).
- Save paths reuse `saveSettings` + `renameSpace` — no new endpoints, matching Phase 1 ADR constraint.
- Panel `aside` root follows the `panel-shell` / `usePanelResize` / `--animate-panel-in` pattern shared with Folio, Runs, and AgentSettings panels (per `conventions/ui` Folio page).
- `DiscardChangesDialog` guard covers all three navigation axes (close, view-switch, file-switch).

---

## Verdict

**APPROVED** — All 3 MAJOR findings from pass 1 are resolved. The implementation now matches the Proposal D wireframe specification. The 2 remaining MINOR findings are pre-existing accepted deviations (correct token usage vs wireframe swatch, justified `style={}` exception). No security issues. Ready for QA.

---

## Screenshots

Playwright was not available in this run environment. Stitch screen HTML files are stub placeholders (live Stitch URLs require a Google browser session). Both review passes were performed via static code analysis against `wireframes.md` specifications.

Key files reviewed (pass 2):
- `frontend/src/components/config/AgentRoutingCard.tsx` (Fix 1 — badge in collapsed row)
- `frontend/src/components/config/ConfigPanel.tsx` (Fix 2 — dirty indicator in header)
- `frontend/src/components/config/AgentRoutingView.tsx` (Fix 3 — search affordances)
- `frontend/src/components/config/ModelInheritanceBadge.tsx` (MINOR — space token)
