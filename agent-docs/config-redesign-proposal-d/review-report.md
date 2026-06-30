# Review Report: Config Panel Redesign — Proposal D

**Date:** 2026-06-30
**Reviewer:** code-reviewer
**Verdict:** CHANGES_REQUIRED

---

## Design Fidelity

### Summary

The implementation is structurally sound and delivers the Proposal D skeleton (two-tab layout, ScopeSelector, AgentRoutingCard multi-expand, model preset chips, read-only Effort, read-only Skills). However, three MAJOR deviations were found: inheritance badges are absent from collapsed card rows, the dirty indicator is missing from the panel header, and the search empty state lacks the "Clear search" affordance required by the wireframe.

### Deviations

| Severity | Screen | Element | Expected | Actual |
|----------|--------|---------|----------|--------|
| MAJOR | Screen 3 — Space Scope + Dirty | Inheritance badge in collapsed card rows | `[SPACE]`, `[GLOBAL]`, `[DEFAULT]` text badges inline before the model pill in every collapsed card row (see wireframes.md §Screen 3) | Only the model pill is tinted when `source !== 'default'`; no badge text shown in collapsed state. `<ModelInheritanceBadge>` is instantiated only inside the expanded `<div id={detailId}>`. |
| MAJOR | Screen 3 — Space Scope + Dirty | Dirty indicator (●) in panel header | Small `●` dot (`bg-primary`, 6px, `aria-label="Unsaved changes"`) appears after "Configuration" title when any edit is dirty (wireframes.md §Dirty State Rules) | `ConfigPanel.tsx` header never renders the dot regardless of `routingDirty` state. `anyDirty` is computed but not surfaced in the header. |
| MAJOR | Screen 4 — Search Empty State | "Clear search" action in empty state | (1) "Try searching by agent name, model, or skill" helper text; (2) `[ Clear search ]` primary-link button that calls `setSearch('')` (wireframes.md §Screen 4 layout) | `AgentRoutingView.tsx` empty state only renders `search_off` icon + "No agents match `{search}`" text. No helper text, no Clear button. User must manually erase the query. |
| MINOR | All screens | Space badge color token | Wireframes specify `text-sky-400 bg-sky-400/10` for the space inheritance badge. UX handoff maps it to "nearest token". | `ModelInheritanceBadge.tsx` uses `text-info bg-info-container` (`--color-info: #1A73E8`). Correct design-system approach (tokens > Tailwind utilities) but the rendered hue differs from the wireframe swatch (info = medium blue vs sky-400 = light cyan-blue). |
| MINOR | Screen 4 — Search | Explicit × clear button on search input | Wireframe shows a visible custom × button in the search row that calls `setSearch('')` when active | Implementation uses `type="search"` which delegates to the native browser × button. Not rendered in Firefox or Safari by default. No custom × button present in the JSX. |
| MINOR | Screen 4 — Search Empty State | Helper text in empty state | "Try searching by agent name, model, or skill" secondary line (12px text-tertiary) below the main message | Text is absent in `AgentRoutingView.tsx` empty branch. |
| MINOR | All screens | `style={{}}` in ConfigPanel.tsx | CLAUDE.md §Design System Rule 5: "No `style={{}}` attributes" | Line 114 in `ConfigPanel.tsx` injects `--panel-w` CSS custom property for the dynamic resize feature. Documented with `// lint-ok` comment explaining technical necessity (Tailwind cannot set runtime CSS vars at element level). This is a legitimate exception. |

---

## Code Quality

### Design System Compliance

All new components use Tailwind design-system tokens consistently (`bg-surface`, `text-primary`, `border-border`, `bg-primary-container`, etc.). No hardcoded hex colors in JSX. No duplicate font imports.

The single `style={{}}` usage in `ConfigPanel.tsx` (line 114) is a justified exception: it injects a CSS custom property (`--panel-w`) that `usePanelResize` sets at runtime — Tailwind's arbitrary value syntax cannot supply dynamic runtime values at the element level. The `// lint-ok` comment documents this correctly.

**One gap:** `AgentRoutingCard.tsx` uses `bg-primary-container` for the selected preset chip (`bg-primary text-white border-primary`) and `bg-primary-container` is not the token for a filled/active chip — that is correct token-wise (`bg-primary` is the filled primary action color). No issue there. All tokens verified against `index.css`.

### Code Quality

- Functions are short and focused. `AgentRoutingView` is the longest file at ~300 lines, but clearly sectioned.
- `handleChange`, `handleClear`, `handleSave`, `handleReset` are all `useCallback`-memoized with correct dependency arrays.
- `useAgentMetadata` module-level cache and inflight-dedup pattern is clean and avoids redundant network calls.
- `parseAgentFrontmatter` is defensive and never throws — all edge cases covered.
- The `// eslint-disable-next-line @typescript-eslint/no-explicit-any` in `AgentRoutingView.tsx` line 123 (`saveSettings` call) warrants a note: the cast `as any` is suppressing a type mismatch on `saveSettings`. If a typed partial-settings helper exists elsewhere, prefer it. This is acceptable for Phase 1 but should be cleaned up before Phase 2 adds more write paths.

### Security

No issues found. No `dangerouslySetInnerHTML`, no raw DOM injection. No secrets or API keys. Input from `<input type="search">` is used only as a filter predicate over a pre-fetched local array. No SQL or command injection vectors.

### Pattern Consistency

- Zustand store access follows the selector pattern used across the codebase.
- API calls go through `api.getAgent(agentId)` (the existing `apiFetch`-backed client).
- Save paths reuse existing store actions (`saveSettings`, `renameSpace`) — no new endpoints, matching the Phase 1 constraint in ADR-1.
- `ConfigFileSidebar` correctly strips the `agent` scope group (Proposal D — only Global + Project remain), matching the two-tab architecture.
- `DiscardChangesDialog` guard covers all three navigation axes (close, view-switch, file-switch) as specified in the blueprint.

---

## Verdict

**CHANGES_REQUIRED** — Three MAJOR deviations found. None are security-related but they collectively undermine the core UX goals of Proposal D:

1. The absence of inheritance badges in collapsed cards breaks the "inheritance source always visible at a glance" promise.
2. The missing dirty indicator leaves users unaware of unsaved changes at the panel level.
3. The missing "Clear search" button creates a dead-end UX when the empty state is reached.

All three are localized fixes (no architectural changes needed):

- **Fix 1 (MAJOR — badges in collapsed cards):** Add `<ModelInheritanceBadge source={source} />` inside the collapsed header `<button>` in `AgentRoutingCard.tsx`, between the model pill and the skill count. It should be visible only when `scope` is relevant (show when `source !== 'default'` at minimum, or always — pending stakeholder answer to UX Q4).
- **Fix 2 (MAJOR — dirty indicator):** In `ConfigPanel.tsx`, pass `anyDirty` to the header and render a `<span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-label="Unsaved changes" />` after the "Configuration" label when `anyDirty`.
- **Fix 3 (MAJOR — Clear search in empty state):** Add a "Clear search" `<button>` (ghost/link style) below the empty-state message in `AgentRoutingView.tsx` that calls `setSearch('')`. Also add the helper text line and a custom × button in the search row (or at least guard the native × button behavior cross-browser).

---

## Screenshots

Playwright was not available in this run environment. Stitch screen HTML files are stub placeholders (live Stitch URLs require a Google browser session). Review was performed via static code analysis against `wireframes.md` specifications.

Key files reviewed:
- `frontend/src/components/config/AgentRoutingCard.tsx`
- `frontend/src/components/config/AgentRoutingView.tsx`
- `frontend/src/components/config/ConfigPanel.tsx`
- `frontend/src/components/config/ModelInheritanceBadge.tsx`
- `frontend/src/components/config/ScopeSelector.tsx`
- `frontend/src/components/config/EffortSegmented.tsx`
- `frontend/src/components/config/SkillsReadOnly.tsx`
- `frontend/src/components/config/ConfigViewTabs.tsx`
- `frontend/src/components/config/ConfigFileSidebar.tsx`
- `frontend/src/utils/parseAgentFrontmatter.ts`
- `frontend/src/utils/modelRouting.ts`
- `frontend/src/utils/agentName.ts`
- `frontend/src/hooks/useAgentMetadata.ts`
- `frontend/src/index.css` (design tokens)
- `agent-docs/config-redesign-proposal-d/wireframes.md` (spec)
