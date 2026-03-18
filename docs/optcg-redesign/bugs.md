# Bugs: OPTCG Card Search Visual Redesign

**Branch:** `feature/optcg-redesign`
**QA Date:** 2026-03-18
**QA Engineer:** qa-engineer-e2e

---

## Summary

| ID | Severity | Type | Component | Status |
|----|----------|------|-----------|--------|
| BUG-001 | Medium | Functional / UX | `SearchPage` header | Open |
| BUG-002 | Medium | Test Coverage | `useTheme`, `LandingPage`, `ThemeToggle` | Open |
| BUG-003 | Medium | Code Style | All new components | Open |
| BUG-004 | Low | Functional | `ColorFilter` | Open |
| BUG-005 | Low | Code Quality | `src/__tests__/CardSearchPage.test.tsx` | Open |
| BUG-006 | Low | Code Quality | `src/hooks/useCardUrlSync.ts` | Open |
| BUG-007 | Low | Code Quality | `src/components/SearchPage.tsx` | Open |
| BUG-008 | Low | Accessibility | `ColorFilter`, `AttributeFilter`, `SetFilter` | Open |

**Zero Critical or High severity bugs. Merge is not blocked.**

---

## BUG-001: SearchPage header logo has no link back to landing page

- **Severity:** Medium
- **Type:** Functional / UX
- **Component:** `src/components/SearchPage.tsx` (sticky header)
- **Reproduction Steps:**
  1. Navigate to `http://localhost:4000/`
  2. Submit a search to arrive at `/search`
  3. Look for a clickable logo or link in the sticky header to return to `/`
  4. Observe that the header only contains a `<SearchBar />` and `<ThemeToggle />` — no logo/link to `/`
- **Expected Behavior (US-5.1):** The OPTCG logo in the `SearchPage` sticky header is a link (or button) that navigates to `/`. On mobile, a left-arrow back icon is also present.
- **Actual Behavior:** The `SearchPage` sticky header contains only `<SearchBar />` and `<ThemeToggle />`. There is no logo, no link to `/`, and no mobile back arrow. Users cannot navigate back to the landing page via the header — they must use the browser back button.
- **Root Cause Analysis:** The developer implemented the sticky header in `SearchPage.tsx` without adding the logo-as-link pattern specified in US-5.1 and the blueprint section 3.1 (component tree). The blueprint mentions `<Link to="/">` wrapping the logo, but the implementation omits this element entirely.
- **Proposed Fix:** Add an OPTCG logo or wordmark inside a `<Link to="/">` in the sticky header, left-aligned, before `<SearchBar />`. On `xs` breakpoints (mobile), also render a `<Link to="/"><span className="material-symbols-outlined">arrow_back</span></Link>` icon. The logo can reuse the `font-slab` class used in `LandingPage` header.
- **OWASP Reference:** N/A

---

## BUG-002: useTheme, LandingPage, and ThemeToggle have no dedicated unit tests

- **Severity:** Medium
- **Type:** Test Coverage
- **Component:** `src/hooks/useTheme.ts`, `src/components/LandingPage.tsx`, `src/components/ThemeToggle.tsx`
- **Reproduction Steps:**
  1. Run `npm test -- --run` in the project root
  2. Observe the 7 test files: `optcgAgent.test.ts`, `cardSearchEngine.test.ts`, `cardDataProvider.test.ts`, `useCardStore.test.ts`, `useLazyImage.test.tsx`, `useDebounce.test.ts`, `CardSearchPage.test.tsx`
  3. Note the absence of: `useTheme.test.ts`, `LandingPage.test.tsx`, `ThemeToggle.test.tsx`
- **Expected Behavior (US-3.1, US-3.2 DoD):** "Unit test: three clicks return to the original theme" and "Unit test: `setTheme('dark')` writes `'dark'` to localStorage mock" are explicit Definition of Done items. `LandingPage` DoD also requires a snapshot test.
- **Actual Behavior:** These three new components / hooks are shipped with zero automated test coverage. Regressions in theme cycling, localStorage persistence, or landing page navigation will not be caught by the test suite.
- **Root Cause Analysis:** The developer noted this as a known open issue. The test files were not created during the implementation cycle.
- **Proposed Fix:** Create three test files:
  - `src/__tests__/useTheme.test.ts` — tests for `readStored()`, `resolve()`, `setTheme()`, `toggleTheme()` cycle, localStorage mock, `matchMedia` mock.
  - `src/__tests__/LandingPage.test.tsx` — snapshot test, form submit navigates to `/search?q=...`, empty submit navigates to `/search`, no `useCardStore` interaction.
  - `src/__tests__/ThemeToggle.test.tsx` — renders sun icon for light theme, moon icon for dark, `aria-label` text, `onClick` calls `toggleTheme`.
- **OWASP Reference:** N/A

---

## BUG-003: New components use inline `style={{}}` attributes for theme tokens

- **Severity:** Medium
- **Type:** Code Style (CLAUDE.md violation)
- **Component:** `src/components/LandingPage.tsx`, `src/components/SearchPage.tsx`, `src/components/SearchBar.tsx`, and all other modified components
- **Reproduction Steps:**
  1. Open `src/components/LandingPage.tsx`
  2. Observe `style={{ backgroundColor: 'var(--color-page)', color: 'var(--color-text-primary)' }}` on line 36
  3. The CLAUDE.md project rule states: "No inline `style={{}}` attributes — use Tailwind arbitrary values (`bg-[#hex]`, `text-[rgba(...)]`) instead."
- **Expected Behavior:** All theme token references should use Tailwind arbitrary value syntax: `bg-[var(--color-page)]`, `text-[color:var(--color-text-primary)]`, `border-[color:var(--color-border)]` — no `style={{}}` props.
- **Actual Behavior:** All 15 modified component files use `style={{ color: 'var(--token)' }}` inline object syntax to apply theme tokens. The `ThemeToggle` itself uses `text-[color:var(--color-text-secondary)]` (correct Tailwind arbitrary syntax) in its className, demonstrating awareness of the pattern, but the same file does not apply inline styles elsewhere. Other components mix both patterns.
- **Root Cause Analysis:** The developer chose inline `style={{}}` as the implementation path for CSS custom properties across all components rather than Tailwind arbitrary value syntax. Both approaches produce identical rendered output, but the inline style approach violates the project's CLAUDE.md coding standard.
- **Proposed Fix:** Replace inline `style={{ color: 'var(--color-text-primary)' }}` with Tailwind class `text-[color:var(--color-text-primary)]`. Replace `style={{ backgroundColor: 'var(--color-page)' }}` with `bg-[var(--color-page)]`. For more complex multi-property style objects (e.g., `borderBottom + color` combined), either split into separate classes or accept as an exception documented in the component. Systematic find-and-replace across all component files.
- **OWASP Reference:** N/A

---

## BUG-004: ColorFilter active state uses `border-white!` — hardcoded white border in all themes

- **Severity:** Low
- **Type:** Functional
- **Component:** `src/components/filters/ColorFilter.tsx`
- **Reproduction Steps:**
  1. Switch to light mode
  2. Open the filter panel
  3. Click any color chip to activate it
  4. Observe: the active border is always white (`border-white!`) regardless of theme
- **Expected Behavior:** In light mode the active chip border should have sufficient contrast against a light background. A white border on a light background may be invisible or low-contrast.
- **Actual Behavior:** `ColorFilter.tsx` line 46 applies `border-white! shadow-[0_0_8px_rgba(255,255,255,0.4)] scale-[1.05]` for the active state. The white border is invisible or very low contrast on a light (`#FAFAFA`) page background.
- **Root Cause Analysis:** The active-chip glow was designed for dark mode only and was not updated during the token migration. The `border-white!` class uses the Tailwind `!important` modifier (Tailwind v4 `!` suffix syntax) to override other border settings.
- **Proposed Fix:** Replace `border-white!` with a gold border (`border-optcg-gold!`) and update the glow shadow to `shadow-[0_0_8px_rgba(212,168,67,0.4)]`. Gold (#D4A843) provides clear visibility in both light and dark themes and is consistent with the rest of the OPTCG design system active states.
- **OWASP Reference:** N/A

---

## BUG-005: Test file still named `CardSearchPage.test.tsx` after component rename

- **Severity:** Low
- **Type:** Code Quality
- **Component:** `src/__tests__/CardSearchPage.test.tsx`
- **Reproduction Steps:**
  1. Run `ls src/__tests__/`
  2. Observe: `CardSearchPage.test.tsx` when the tested component is now `SearchPage`
- **Expected Behavior:** Test file name should match the component it tests: `SearchPage.test.tsx`.
- **Actual Behavior:** File is named `CardSearchPage.test.tsx`. The file header comment acknowledges this (line 6: "NOTE: CardSearchPage.tsx was deleted in T-R07. This file was updated by QA (fix BUG-002) to import SearchPage"), but the rename was not completed.
- **Root Cause Analysis:** The developer updated the test's import to use `SearchPage` but did not rename the test file to match.
- **Proposed Fix:** `git mv src/__tests__/CardSearchPage.test.tsx src/__tests__/SearchPage.test.tsx`. No code changes required.
- **OWASP Reference:** N/A

---

## BUG-006: Stale comment in `useCardUrlSync.ts` references old component name

- **Severity:** Low
- **Type:** Code Quality
- **Component:** `src/hooks/useCardUrlSync.ts`
- **Reproduction Steps:**
  1. Open `src/hooks/useCardUrlSync.ts`
  2. Observe JSDoc comment: "Mount this hook once inside CardSearchPage."
- **Expected Behavior:** Comment should read "Mount this hook once inside SearchPage."
- **Actual Behavior:** Comment still references the deleted `CardSearchPage` component.
- **Root Cause Analysis:** The blueprint listed `useCardUrlSync.ts` as an "Unchanged file", so it was not reviewed for stale comments during the implementation phase.
- **Proposed Fix:** Update the JSDoc comment on line ~21 from `CardSearchPage` to `SearchPage`.
- **OWASP Reference:** N/A

---

## BUG-007: `SearchPage` declares `loadCardsAction` as a redundant alias for `loadCards`

- **Severity:** Low
- **Type:** Code Quality
- **Component:** `src/components/SearchPage.tsx`
- **Reproduction Steps:**
  1. Open `src/components/SearchPage.tsx`
  2. Observe lines 48 and 54:
     ```
     const loadCards = useCardStore((s) => s.loadCards);       // line 48
     const loadCardsAction = useCardStore((s) => s.loadCards);  // line 54
     ```
  3. `loadCardsAction` is used in the Retry button's `onClick` handler; `loadCards` is used in the `useEffect`.
- **Expected Behavior:** A single variable should be declared and used for both the effect and the retry button.
- **Actual Behavior:** The same store selector is called twice, producing two references to the same function. This is harmless at runtime but introduces dead code and confusion about whether they are different actions.
- **Root Cause Analysis:** The Retry button was likely added after the initial `loadCards` variable was already declared, and the developer created a new alias instead of reusing the existing variable.
- **Proposed Fix:** Remove line 54 (`const loadCardsAction = ...`). Replace `loadCardsAction()` in the Retry button's `onClick` with `loadCards()`.
- **OWASP Reference:** N/A

---

## BUG-008: Color/type filter aria-labels include `(active)` suffix alongside `aria-pressed`

- **Severity:** Low
- **Type:** Accessibility
- **Component:** `src/components/filters/ColorFilter.tsx`, `src/components/filters/AttributeFilter.tsx`, `src/components/filters/SetFilter.tsx`
- **Reproduction Steps:**
  1. Inspect the DOM of an active color filter chip
  2. Observe: `aria-label="Red (active)"` and `aria-pressed="true"` on the same element
- **Expected Behavior:** `aria-pressed="true"` is the correct and sufficient ARIA pattern for communicating toggle state. The `aria-label` should describe the action, not duplicate the state: `aria-label="Red color filter"`.
- **Actual Behavior:** Active buttons have redundant state information in two ARIA attributes. Screen readers will announce both: "Red (active) toggle button pressed" — the word "active" and "pressed" convey the same information twice.
- **Root Cause Analysis:** The developer used `(active)` as a fallback for environments that do not support `aria-pressed`, but modern assistive technologies handle `aria-pressed` correctly. The pattern is documented in the codebase as consistent across ColorFilter, AttributeFilter, and SetFilter.
- **Proposed Fix:** Remove the `${isActive ? ' (active)' : ''}` suffix from all three filter components' `aria-label` values. Keep `aria-pressed={isActive}` as the sole state indicator. Update `aria-label` to describe the element's purpose: `aria-label={label}` for ColorFilter, `aria-label={attr}` for AttributeFilter, `aria-label={code — name}` for SetFilter.
- **OWASP Reference:** N/A
