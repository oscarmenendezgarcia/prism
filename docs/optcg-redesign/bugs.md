# Bugs: OPTCG Card Search Visual Redesign

**Branch:** `feature/optcg-redesign`
**QA Date:** 2026-03-18
**QA Engineer:** qa-engineer-e2e

---

## Summary

| ID | Title | Severity | Type | Status |
|----|-------|----------|------|--------|
| BUG-001 | Dead `CardSearchPage.tsx` not deleted after rename | High | Functional | FIXED |
| BUG-002 | Test suite importing dead component instead of live `SearchPage` | High | Functional | FIXED |
| BUG-003 | `CardImage.tsx` uses hardcoded dark-only classes | High | Functional | FIXED |
| BUG-004 | `CardThumbnail.tsx` Leader life pip uses hardcoded dark class | High | Functional | FIXED |
| BUG-005 | `ThemeToggle` `aria-label` wording does not match US-3.1 spec | Medium | Functional / Accessibility | OPEN |
| BUG-006 | `useTheme`, `ThemeToggle`, and `LandingPage` have zero unit test coverage | Low | Quality | OPEN |
| BUG-007 | `SearchPage` header missing logo/back link to `/` | Medium | Functional | OPEN |

**Merge gate:** BUG-001 through BUG-004 (all High) were fixed in QA commit `256fe0c` before this document was finalised. Zero open Critical or High bugs. Branch is **ready to merge**.

---

## BUG-001: Dead `CardSearchPage.tsx` not deleted after rename

- **Severity:** High
- **Type:** Functional
- **Status:** FIXED in commit `256fe0c`
- **Component:** `src/components/CardSearchPage.tsx`

**Reproduction Steps:**
1. Inspect `src/components/` on branch `feature/optcg-redesign`.
2. Observe both `CardSearchPage.tsx` (old) and `SearchPage.tsx` (new) coexist.
3. `CardSearchPage.tsx` still exports `CardSearchPage`, which uses hardcoded dark classes (`bg-optcg-navy`, `text-white`, `bg-optcg-navy/90`, etc.) and renders no `ThemeToggle`.

**Expected Behavior:** `CardSearchPage.tsx` was superseded by `SearchPage.tsx` per ADR-1 §1 and commit message `T-R07`. The file should have been deleted.

**Actual Behavior:** The dead file remains on disk, holding 137 lines of stale code with old dark-only classes and duplicate `loadCards` subscriptions. It is not referenced by `App.tsx` but is importable, creating confusion.

**Root Cause Analysis:** The developer renamed the component and created `SearchPage.tsx` but did not delete the source file. The file was not referenced by the router (App.tsx imports only `SearchPage`) so no runtime error was produced, and no test failed at the time because the test file was also pointing to the dead component (see BUG-002).

**Proposed Fix:** Delete `src/components/CardSearchPage.tsx`.
**Fix Applied:** File deleted. `git rm` confirmed in QA commit.

---

## BUG-002: Test suite importing dead component instead of live `SearchPage`

- **Severity:** High
- **Type:** Functional
- **Status:** FIXED in commit `256fe0c`
- **Component:** `src/__tests__/CardSearchPage.test.tsx`

**Reproduction Steps:**
1. Open `src/__tests__/CardSearchPage.test.tsx`.
2. Observe line 12: `import { CardSearchPage } from '@/components/CardSearchPage';`
3. Run `npm test`. All 13 tests pass — but they are testing the dead file, not the live `SearchPage`.
4. `SearchPage` (the component actually rendered at `/search` in production) has zero integration test coverage as a result.

**Expected Behavior:** The integration test file should import and test `SearchPage` — the component registered at `/search` in `App.tsx` and shipped to users.

**Actual Behavior:** Tests import the deleted/dead `CardSearchPage`. Because `CardSearchPage.tsx` was not yet deleted when tests ran, all 13 tests passed against the wrong component. `SearchPage` rendered no `ThemeToggle` in the dead file, so the `window.matchMedia` crash was never triggered, masking the need for the `matchMedia` stub in `test-setup.ts`.

**Root Cause Analysis:** The test file was not updated when `CardSearchPage` was renamed to `SearchPage`. The dead file masked the gap because it still passed the same behavioral assertions (same child components, same store connections). The difference — `ThemeToggle` in the header — was not tested.

**Proposed Fix:**
1. Update `CardSearchPage.test.tsx` to `import { SearchPage } from '@/components/SearchPage'`.
2. Update `renderPage()` to render `<SearchPage />`.
3. Update all describe block names to `SearchPage — ...`.
4. Add `window.matchMedia` stub to `test-setup.ts` (required by `useTheme` called inside `ThemeToggle`).

**Fix Applied:** All four changes applied in QA commit. All 88 tests now pass, exercising the live `SearchPage`.

---

## BUG-003: `CardImage.tsx` uses hardcoded dark-only classes

- **Severity:** High
- **Type:** Functional (visual regression in light mode)
- **Status:** FIXED in commit `256fe0c`
- **Component:** `src/components/CardImage.tsx`
- **Story:** US-3.3 (zero remaining hardcoded dark classes)

**Reproduction Steps:**
1. Switch the app to light mode.
2. View any card thumbnail in the grid or list view.
3. The card image container background, shimmer placeholder, and error fallback all show the dark navy blue (`#1C2541`) instead of the light theme's `--color-input` token (`#F0F0F0`).

**Expected Behavior:** Image placeholder, shimmer, and error fallback should use `var(--color-input)` which resolves to `#F0F0F0` in light mode and `#1C2541` in dark mode.

**Actual Behavior:** Three hardcoded occurrences of `bg-optcg-navy-light` in `CardImage.tsx` forced the component to always render the dark navy background regardless of theme. Additionally `text-white/30` was used for the "No image" label, rendering white text on a dark background regardless of theme.

**Lines affected (before fix):**
- Line 33: `className={\`relative overflow-hidden bg-optcg-navy-light ${className}\`}`
- Line 38: `<div className="absolute inset-0 animate-pulse bg-gradient-to-br from-optcg-navy-light via-white/5 to-optcg-navy-light" />`
- Line 43: `<div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-optcg-navy-light">`
- Line 50: `<span className="text-[10px] text-white/30">No image</span>`

**Root Cause Analysis:** ADR-1 §3 explicitly lists `CardImage` as a component "that needs NO theme changes" because it only renders `<img>` tags. However, the component also renders a shimmer placeholder and error fallback that use background colours. The component audit table was incomplete for these non-image states.

**Proposed Fix:** Replace all `bg-optcg-navy-light` with `style={{ backgroundColor: 'var(--color-input)' }}` and replace `text-white/30` with `style={{ color: 'var(--color-text-muted)' }}`.
**Fix Applied:** Applied in QA commit.

---

## BUG-004: `CardThumbnail.tsx` Leader life pip uses hardcoded dark class

- **Severity:** High
- **Type:** Functional (visual regression in light mode)
- **Status:** FIXED in commit `256fe0c`
- **Component:** `src/components/CardThumbnail.tsx` line 87
- **Story:** US-3.3 (zero remaining hardcoded dark classes)

**Reproduction Steps:**
1. Switch the app to light mode.
2. View any Leader card (e.g., Monkey D. Luffy OP01-001) in the card grid.
3. The Leader life pip (top-right circle showing the Leader's life value) shows a dark navy background (`#1C2541`) instead of the light theme input background.

**Expected Behavior:** The life pip background should adapt to theme using `var(--color-input)`.

**Actual Behavior:** `className="... bg-optcg-navy-light ..."` hardcoded the dark background. In light mode this produces a dark-on-light artefact that looks inconsistent with the card surface.

**Root Cause Analysis:** The cost pip (top-left) was correctly noted in ADR-1 §3 as theme-invariant (always gold/navy). The life pip for Leader cards was also treated as theme-invariant in the component audit table, but it uses `bg-optcg-navy-light` as its badge background rather than the gold/navy combination, making it theme-sensitive.

**Proposed Fix:** Replace `bg-optcg-navy-light` with `style={{ backgroundColor: 'var(--color-input)' }}` on the life pip div.
**Fix Applied:** Applied in QA commit.

---

## BUG-005: `ThemeToggle` `aria-label` wording does not match US-3.1 acceptance criteria

- **Severity:** Medium
- **Type:** Accessibility / Functional
- **Status:** OPEN
- **Component:** `src/components/ThemeToggle.tsx`
- **Story:** US-3.1 (Acceptance Criteria bullet 5)

**Reproduction Steps:**
1. Open the app and inspect the `ThemeToggle` button.
2. Observe `aria-label`: `"Theme: System. Click to cycle theme."` (or similar).
3. Compare to US-3.1: `aria-label` should indicate the **current mode** as "Switch to dark mode" / "Switch to light mode".

**Expected Behavior (per US-3.1):** The `aria-label` should read e.g. `"Switch to dark mode"` when the current resolved theme is light, and `"Switch to light mode"` when dark.

**Actual Behavior:** The current `buildAriaLabel()` function returns `"Theme: System. Click to cycle theme."` which:
1. Does not match the exact wording specified in user stories.
2. Does not tell screen reader users what action will result from clicking (the target theme).
3. Uses "System" as a label when the resolved theme may already be light or dark.

**Root Cause Analysis:** The developer implemented a descriptive label pattern ("current state + instruction") rather than the action-forward pattern ("Switch to X") specified in the user story. Both are valid ARIA patterns but the specification is explicit.

**Proposed Fix:** Update `buildAriaLabel()` in `ThemeToggle.tsx` to return:
- When `resolvedTheme === 'light'`: `"Switch to dark mode"`
- When `resolvedTheme === 'dark'`: `"Switch to light mode"`
- Optionally append `" (currently: System)"` when theme preference is `'system'`.

This is a one-line change to the label-building logic. No production code is modified by this QA report — the fix is left to the developer.

---

## BUG-006: `useTheme`, `ThemeToggle`, and `LandingPage` have zero unit test coverage

- **Severity:** Low
- **Type:** Quality
- **Status:** OPEN
- **Components:** `src/hooks/useTheme.ts`, `src/components/ThemeToggle.tsx`, `src/components/LandingPage.tsx`
- **Story:** US-3.2 (Definition of Done: "Unit test: setTheme('dark') writes 'dark' to localStorage mock"), US-3.1 (Definition of Done: "Unit test: three clicks return to the original theme"), US-1.1 (Definition of Done: "Snapshot test covers the default rendered output")

**Reproduction Steps:**
1. Run `npm test -- --run`.
2. Inspect `src/__tests__/` — no `useTheme.test.ts`, no `ThemeToggle.test.tsx`, no `LandingPage.test.tsx`.
3. Three components central to the redesign have no automated test coverage.

**Expected Behavior:** Per the Definition of Done in user stories US-3.1 and US-3.2, unit tests for `useTheme` and `ThemeToggle` are required. US-1.1 requires a snapshot test for `LandingPage`.

**Actual Behavior:** These files were shipped without any test coverage. The coverage gap means:
- A regression in `useTheme` (e.g., localStorage key name change, cycle order change) would not be caught automatically.
- The `ThemeToggle` three-click cycle property is unverified.
- The `LandingPage` render output has no snapshot baseline.

**Root Cause Analysis:** The developer likely deferred tests for the new UI components. The `matchMedia` stub was also missing from `test-setup.ts` (added by QA in this cycle), which would have caused test crashes and may have discouraged writing these tests.

**Proposed Fix:** Create three new test files:
1. `src/__tests__/useTheme.test.ts` — unit tests for `readStored`, `resolve`, `applyClass`, `setTheme`, `toggleTheme`, matchMedia listener.
2. `src/__tests__/ThemeToggle.test.tsx` — integration tests for icon display per theme, aria-label cycling, three-click round-trip.
3. `src/__tests__/LandingPage.test.tsx` — snapshot test, navigation tests, no card store interaction assertion.

The `window.matchMedia` stub added to `test-setup.ts` in this QA cycle already provides the necessary environment setup.

---

## BUG-007: `SearchPage` header missing logo/back link to `/`

- **Severity:** Medium
- **Type:** Functional / UX
- **Status:** OPEN
- **Component:** `src/components/SearchPage.tsx`
- **Story:** US-5.1 (Must — "OPTCG logo in SearchPage sticky header is a link to /")

**Reproduction Steps:**
1. Navigate to `http://localhost:4000/search?q=Luffy`.
2. Inspect the sticky header — it contains only a `SearchBar` and a `ThemeToggle`.
3. There is no logo, no "OPTCG" text link, and no back arrow linking to `/`.
4. The only way to return to the landing page is via the browser back button.

**Expected Behavior (per US-5.1):**
- The OPTCG logo (or "OPTCG" text) in the `SearchPage` sticky header should be a `<Link to="/">`.
- On mobile, a left-arrow back icon should also be present linking to `/`.
- Clicking the logo shows the landing page with an empty search bar.

**Actual Behavior:** The `SearchPage` sticky header renders:
```
[SearchBar (flex-1)] [ThemeToggle]
```
No logo link. No back navigation element. US-5.1 is unimplemented.

**Root Cause Analysis:** Comparing `SearchPage.tsx` to the ADR-1 route table and blueprint, the sticky header structure matches commit `T-R07` which focused on the rename and token migration. The logo/back-link element from the Stitch wireframes was not implemented.

**Proposed Fix:** Wrap a logo span or OPTCG text in `<Link to="/" className="...">` inside the sticky header div. On mobile, add a `<Link to="/">` with a `arrow_back` Material Symbol icon before the `SearchBar`. This is a UI addition — no store, no API, no routing logic changes required.

This bug does not block merge (Medium severity) but should be addressed in the next sprint before the feature is publicly announced.
