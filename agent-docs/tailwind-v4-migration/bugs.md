# Bug Report: Tailwind CSS v4 Migration

**Feature:** tailwind-v4-migration  
**QA Date:** 2026-04-07  
**Branch:** feature/tailwind-v4-migration  
**Implementation status at QA time:** T-001 (codemod) + T-002 (vite plugin) partially done; T-003 (index.css @theme) + T-004 (@custom-variant) NOT done.

---

## BUG-001: All custom token utilities absent from compiled CSS (regression in partial state)

- **Severity:** Critical
- **Type:** Functional / Visual
- **Component:** `frontend/src/index.css`, `frontend/vite.config.ts`
- **Discovered:** CSS bundle analysis — post-partial-migration build output `dist/assets/index-8rnxgIuL.css`
- **Reproduction Steps:**
  1. Current branch state: `@tailwindcss/vite` registered in vite.config.ts, `tailwind.config.js` DELETED, `index.css` still has `@tailwind base/components/utilities` (v3 directives), no `@theme` block
  2. `cd frontend && npm run build`
  3. Inspect `dist/assets/*.css` — search for `bg-surface`, `bg-primary`, `text-primary`, `shadow-card`, `rounded-card`, `ease-apple`, `h-header`, `w-column`
  4. Result: **zero matches** for all custom token utilities
- **Expected Behavior:** CSS bundle contains `bg-surface { background-color: var(--color-surface) }`, `shadow-card { box-shadow: var(--shadow-card) }`, etc. and all 160+ custom token utilities generated from the theme definition.
- **Actual Behavior:** The CSS bundle is 30.45 KB (down from 51.25 KB baseline) — custom token utilities not generated because `tailwind.config.js` was deleted but `@theme` block has NOT yet been added to `index.css`. The app renders with no colors, wrong shadows, wrong typography, wrong spacing, wrong border-radius on all custom-styled elements.
- **Root Cause Analysis:** The migration is incomplete. T-002 deleted the JS config source of truth, but T-003 (which re-declares tokens in `@theme`) has not been executed. This creates a broken intermediate state where Tailwind v4 runs with zero custom tokens.
- **Proposed Fix:** Complete T-003 immediately: add `@import "tailwindcss";` replacing `@tailwind base/components/utilities`, then add `@theme inline { ... }` with all color tokens, and `@theme { ... }` with layout/radius/shadow/animation tokens. Until T-003 is complete, the app is functionally broken.

---

## BUG-002: `dark:` variant compiles to `prefers-color-scheme` — class-based toggle broken

- **Severity:** Critical
- **Type:** Functional
- **Component:** `frontend/src/index.css` — missing `@custom-variant dark` declaration
- **Discovered:** CSS bundle analysis — `dist/assets/index-8rnxgIuL.css`
- **Reproduction Steps:**
  1. Current partial-migration state (as per BUG-001)
  2. Load app, click the light/dark theme toggle button
  3. `html.dark` class is added to `<html>` element correctly
  4. Observe: theme does NOT change — no visual effect from toggle
  5. In CSS: `@media (prefers-color-scheme:dark){ .dark\:bg-\[rgba(...)]{...} }` — `dark:` variants respond to OS setting only
- **Expected Behavior:** `dark:` prefixed utilities respond to `html.dark` class. Toggle button immediately switches all dark-prefixed colors.
- **Actual Behavior:** Compiled CSS: `@media (prefers-color-scheme:dark){.dark\:bg-\[rgba\(10\,132\,255\,0\.14\)\]{...}}`. The dark: variant is mapped to the OS `prefers-color-scheme` media query instead of the `html.dark` class selector. Manual theme toggle has no effect.
- **Root Cause Analysis:** Tailwind v4's default `dark:` variant is `prefers-color-scheme: dark`. To restore class-based dark mode, `@custom-variant dark (&:where(.dark, .dark *));` must be declared in `index.css` BEFORE any `@theme` blocks. This is T-004.
- **Proposed Fix:** Add to `frontend/src/index.css` (before @theme):
  ```css
  @custom-variant dark (&:where(.dark, .dark *));
  ```
  This is documented in the blueprint and ADR as a high-risk item that must not be omitted.

---

## BUG-003: Pre-existing test failure in useAgentCompletion.test.ts

- **Severity:** Critical
- **Type:** Functional / Process
- **Component:** `feature/tailwind-v4-migration` branch — entire frontend CSS toolchain
- **Reproduction Steps:**
  1. `git checkout feature/tailwind-v4-migration`
  2. `git log --oneline` — no Tailwind migration commits
  3. `ls frontend/tailwind.config.js` → file exists
  4. `ls frontend/postcss.config.js` → file exists
  5. `grep "tailwindcss" frontend/package.json` → shows `^3.4.0`
  6. `grep "@tailwind" frontend/src/index.css` → shows v3 directives
- **Expected Behavior:** Feature branch contains implementation commits for T-001 through T-007: codemod output, vite plugin switch, @theme tokens in index.css, @custom-variant dark, deprecated utility fixes, passing test suite.
- **Actual Behavior:** Branch is at the same state as `main`. No migration commits exist. All v3 files are in place.
- **Root Cause Analysis:** Developer stage (Stage 3) was not executed, or commits were not pushed to this branch before the QA pipeline stage was triggered.
- **Proposed Fix:** Re-invoke `developer-agent` with `ADR-1.md`, `blueprint.md`, `tasks.json`, and `user-stories.md` as input. Implement T-001 through T-007 in order. Then re-trigger `qa-engineer-e2e`.

---

## BUG-002: Pre-existing test failure in useAgentCompletion.test.ts

- **Severity:** High
- **Type:** Functional
- **Component:** `frontend/src/__tests__/hooks/useAgentCompletion.test.ts:332`
- **Reproduction Steps:**
  1. `cd frontend && npm test`
  2. Observe `useAgentCompletion.test.ts` → 1 test FAIL
  3. Error: toast spy called with `"Agent run completed: developer-agent"` and `"Stage 1 complete. Advance to next stage?"` (with `info` type and action button), but test expects `stringContaining('Adva...')` on the first call.
- **Expected Behavior:** Test assertion matches the actual toast message — all 1,093 tests pass.
- **Actual Behavior:**
  ```
  1st spy call: "Agent run completed: developer-agent"   ← no 'Advance' string
  2nd spy call: "Stage 1 complete. Advance to next stage?"  ← now has 'Advance'
  Test: expects 1st call to contain 'Advance'  → FAIL
  ```
- **Root Cause Analysis:** The `useAgentCompletion` hook was updated to separate the completion toast (call 1) from the pipeline-advance toast (call 2). The test was written expecting both to be combined in call 1. This is test drift from recent pipeline feature work (commits `0a637b5`, pipeline interrupt recovery).
- **Proposed Fix:** Update `useAgentCompletion.test.ts:332` to assert `toastFn.mock.calls[1][0]` (second call) contains 'Adva', not `toastFn` directly. Alternatively restructure the test to verify both toast invocations individually. **Do not modify application code** — the new two-toast pattern is intentional.

---

## BUG-003: Pre-existing test failure in useAgentCompletion.test.ts (was BUG-002)

---

## BUG-004: `@custom-variant dark` missing — dark mode will break after migration

- **Severity:** High
- **Type:** Functional
- **Component:** `frontend/src/index.css`
- **Reproduction Steps (post-migration, without fix):**
  1. Complete Tailwind v4 migration without adding `@custom-variant dark` to index.css
  2. Load app in browser — defaults to dark mode
  3. Observe all `dark:` prefixed utilities stop applying (badges, status indicators, surfaces lose theme-specific colors)
  4. Toggle to light mode and back — no theme change occurs
- **Expected Behavior:** `dark:bg-[rgba(191,90,242,0.14)]` on Badge.tsx, `dark:bg-surface` patterns, and all `dark:` utilities respond to `html.dark` class toggle.
- **Actual Behavior (without fix):** Tailwind v4 does not provide a built-in `dark:` variant for class-based dark mode. Without the explicit `@custom-variant dark (&:where(.dark, .dark *));` declaration, all `dark:` utilities compile to CSS that never matches.
- **Root Cause Analysis:** In Tailwind v3, `darkMode: 'class'` in `tailwind.config.js` enabled the `dark:` variant automatically. In v4's CSS-first model, there is no JS config, so the variant must be declared explicitly in CSS. This is documented as a high-risk item in ADR-1 and blueprint.md.
- **Proposed Fix:** Add the following line to `frontend/src/index.css` immediately before the `@theme` block:
  ```
  @custom-variant dark (&:where(.dark, .dark *));
  ```
  This is T-004 acceptance criterion #1.
- **Verification TC:** TC-010, TC-026, TC-029

---

## BUG-005: `border-color` override absent — bare `border` class will render `currentColor` in v4

- **Severity:** Medium
- **Type:** Visual
- **Component:** `frontend/src/index.css` — all components using bare `border` utility
- **Reproduction Steps (post-migration, without fix):**
  1. Migrate to v4 without `@layer base { border-color: var(--color-border); }` override
  2. Load board view in dark mode
  3. Inspect cards with `border` class — borders render in `currentColor` (text color, ~#F5F5F7 in dark) instead of `var(--color-border)` (subtle rgba(255,255,255,0.08))
  4. Cards appear to have harsh, high-contrast borders instead of the intended subtle theme-aware border
- **Expected Behavior:** Components using bare `border` class render borders using the design token `var(--color-border)` in both themes.
- **Actual Behavior (without fix):** Tailwind v4 changed the default `border-color` from `gray-200` to `currentColor`. All elements using bare `border` inherit their text color as border color — in dark mode this creates white/near-white borders.
- **Root Cause Analysis:** Breaking change in Tailwind v4 defaults. Documented in ADR-1 and blueprint.md as a mitigable risk. T-004 addresses this explicitly.
- **Proposed Fix:** Add to `frontend/src/index.css`:
  ```css
  @layer base {
    *, ::before, ::after {
      border-color: var(--color-border);
    }
  }
  ```
  This restores v3 behavior using the project's existing border token.
- **Verification TC:** TC-011, TC-030

---

## BUG-006: Playwright E2E smoke tests not executed — browser lock

- **Severity:** Medium
- **Type:** Process / Test Infrastructure
- **Component:** Playwright MCP browser
- **Reproduction Steps:**
  1. QA agent attempts to run E2E tests via `mcp__plugin_playwright__browser_navigate`
  2. Error: `Browser is already in use for /Users/oscarmenendezgarcia/Library/Caches/ms-playwright/mcp-chrome-f592f4b`
  3. `pkill -f "chromium|chrome|playwright"` does not release the lock
- **Expected Behavior:** Playwright MCP browser available for E2E test execution.
- **Actual Behavior:** Browser locked by a concurrent session. TC-019 through TC-033 (all E2E visual tests) could not be executed.
- **Root Cause Analysis:** Another MCP agent or browser automation session held an exclusive lock on the shared Playwright browser profile.
- **Proposed Fix:** Re-run E2E tests after implementation is complete in an isolated browser session. When invoking playwright-mcp, ensure no other browser sessions are active. Alternatively, configure the playwright MCP plugin with `--isolated` flag for concurrent session support.
- **Impact:** These tests are REQUIRED before merge gate can be cleared. TC-026 (dark/light toggle) and TC-029 (badge colors) are critical for validating BUG-004 resolution.

---

## Advisory: `outline-none` in v4.2.2 generates `outline-style: none`

**Note:** The ADR referenced `outline-none` → `outline-hidden` as a v4 breaking change. Static analysis found 42 occurrences. However, CSS bundle analysis confirms that Tailwind v4.2.2 generates `.outline-none { --tw-outline-style: none; outline-style: none }` — functionally identical to the v3 behavior (`outline: none`). The rename is NOT required in v4.2.2, and BUG-003 in the original assessment was incorrect. No action needed for `outline-none`.

---

## Summary Table

| Bug | Severity | Blocks Merge? | Owner |
|---|---|---|---|
| BUG-001: Custom token utilities absent (partial migration) | Critical | YES | developer-agent |
| BUG-002: dark: variant → prefers-color-scheme (T-004 missing) | Critical | YES | developer-agent |
| BUG-003: useAgentCompletion test failure | High | YES | developer-agent |
| BUG-004: `@custom-variant dark` missing | High | YES (T-004) | developer-agent |
| BUG-005: border-color override absent | Medium | NO (visual regression) | developer-agent |
| BUG-006: E2E tests not executed (browser lock) | Medium | YES (TC-026/TC-029 required) | qa-engineer-e2e |

**Merge gate: 2 Critical + 2 High bugs unresolved. NOT ready for merge.**
