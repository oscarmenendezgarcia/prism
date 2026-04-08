# Test Plan: Tailwind CSS v4 Migration

## Executive Summary

**Feature:** Migrate Prism frontend from Tailwind CSS v3.4 → v4 (CSS-first config).  
**QA Date:** 2026-04-07  
**Branch:** `feature/tailwind-v4-migration`  
**QA Status:** ⛔ BLOCKED — implementation not yet present on the branch.

The developer stage has not been completed. The `feature/tailwind-v4-migration` branch contains no migration commits. All v3 artefacts (`tailwind.config.js`, `postcss.config.js`, `@tailwind` directives in `index.css`) are still in place. This test plan documents:

1. The pre-migration baseline (what works today, ready for comparison after migration).
2. The full test strategy to execute once implementation is complete.
3. All deprecated-utility surface areas identified via static analysis.

---

## Scope & Objectives

| In Scope | Out of Scope |
|---|---|
| Frontend CSS toolchain (Tailwind v3→v4) | Backend (`server.js`, MCP, pipeline) |
| `@theme` token fidelity vs `tailwind.config.js` | Database / persistence layer |
| Dark/light toggle via `dark:` variant | xterm.js internals |
| Deprecated utility class audit (`outline-none`, `shadow-sm`, etc.) | CI/CD pipeline config |
| Vitest test suite pass/fail | Browser extension compatibility |
| Build time & CSS bundle size delta | Mobile native (app is web-only) |
| Playwright E2E visual smoke tests | |

---

## Pre-migration Baseline (recorded 2026-04-07)

| Metric | Value |
|---|---|
| Tailwind version | 3.4.0 |
| CSS bundle size (unminified) | 51,249 bytes (51.25 KB) |
| CSS bundle size (gzip) | 10.78 KB |
| Build time (`vite build`) | 1.42 s |
| Vitest total tests | 1,093 |
| Vitest passing | 1,092 |
| Vitest failing | 1 (`useAgentCompletion.test.ts:332`) |

---

## Test Levels

### Level 1 — Build Gate (T-001 / T-002)

Verify the toolchain upgrade does not break compilation.

| TC-001 | Build succeeds with v4 |
|---|---|
| **Command** | `cd frontend && npm run build` |
| **Expected** | Zero errors. CSS chunk emitted. |
| **Priority** | Critical |

| TC-002 | Dev server HMR works |
|---|---|
| **Command** | `npm run dev` in frontend/ |
| **Expected** | Vite starts on :5173, HMR hot-updates on CSS change |
| **Priority** | High |

| TC-003 | postcss.config.js deleted |
|---|---|
| **Command** | `ls frontend/postcss.config.js` |
| **Expected** | `No such file` |
| **Priority** | High |

| TC-004 | tailwind.config.js deleted |
|---|---|
| **Command** | `ls frontend/tailwind.config.js` |
| **Expected** | `No such file` |
| **Priority** | High |

| TC-005 | autoprefixer removed |
|---|---|
| **Command** | `grep "autoprefixer" frontend/package.json` |
| **Expected** | Empty (no match) |
| **Priority** | High |

| TC-006 | @tailwindcss/vite plugin registered |
|---|---|
| **Check** | `frontend/vite.config.ts` imports and registers `@tailwindcss/vite` |
| **Priority** | High |

---

### Level 2 — CSS-First Config (T-003 / T-004)

Verify token migration into `@theme` and dark mode preservation.

| TC-007 | @import "tailwindcss" present |
|---|---|
| **Check** | First line of `frontend/src/index.css` is `@import "tailwindcss";` |
| **Priority** | Critical |

| TC-008 | @theme inline block contains all color tokens |
|---|---|
| **Check** | `index.css` contains `@theme inline` with color tokens referencing `var(--color-*)` |
| **Tokens required** | primary, secondary, surface, background, on-surface, on-primary, text-primary, text-secondary, border, error, success, warning, info, col-todo, col-in-progress, col-done, badge-*-text, terminal-* |
| **Priority** | Critical |

| TC-009 | @theme block contains layout/radius/shadow tokens |
|---|---|
| **Tokens required** | rounded-{xs,sm,md,lg,card,modal}, shadow-{card,card-hover,sm,md,lg,modal}, font-mono, h-header, w-terminal, w-column, ease-apple, ease-spring, animate-* |
| **Priority** | Critical |

| TC-010 | @custom-variant dark present |
|---|---|
| **Check** | `@custom-variant dark (&:where(.dark, .dark *));` exists in index.css before @theme |
| **Priority** | Critical (High risk if missing — dark mode stops working entirely) |

| TC-011 | @layer base border-color override |
|---|---|
| **Check** | `@layer base { *, ::before, ::after { border-color: var(--color-border); } }` present |
| **Priority** | High |

---

### Level 3 — Deprecated Utility Audit (T-005)

Systematic grep-based verification that no removed v3 utilities remain.

| TC-012 | outline-none → outline-hidden |
|---|---|
| **Command** | `grep -rn "outline-none" frontend/src --include="*.tsx"` |
| **Expected** | Zero matches (42 occurrences found pre-migration — codemod must handle all) |
| **Priority** | High |
| **Note** | All 42 occurrences are in `focus:outline-none` and `focus-visible:outline-none` patterns. In Tailwind v4, `outline-none` generates `outline: 2px solid transparent; outline-offset: 2px` instead of `outline: none` — this is a behavioral difference that can expose unexpected focus rings. |

| TC-013 | bg-opacity-* / text-opacity-* absent |
|---|---|
| **Command** | `grep -rn "bg-opacity-\|text-opacity-" frontend/src --include="*.tsx"` |
| **Expected** | Zero matches (already clean — using slash syntax) |
| **Priority** | Medium |

| TC-014 | Custom shadow tokens preserved (shadow-sm, shadow-card, etc.) |
|---|---|
| **Note** | `shadow-sm` in this codebase maps to custom token `var(--shadow-sm)`, not the Tailwind built-in. After migration to `@theme`, these must be declared explicitly and will resolve correctly. Verify 3 occurrences in Button.tsx, TaskCard.tsx, AutoTaskModal.tsx still render visible shadows. |
| **Priority** | Medium |

| TC-015 | Custom rounded tokens preserved (rounded-sm, rounded-card, rounded-modal) |
|---|---|
| **Note** | 14 `rounded-sm` occurrences; this is a custom token (8px) that must be re-declared in `@theme`. In v4 the built-in `rounded-sm` becomes 4px — the custom declaration must take precedence. |
| **Priority** | Medium |

| TC-016 | ring-0 in TaggerReviewModal renders correctly |
|---|---|
| **Note** | One `ring-0` usage. In v4, bare `ring` default changes; verify `ring-0` correctly resets. |
| **Priority** | Low |

| TC-017 | ease-apple and ease-spring tokens function (20 usages) |
|---|---|
| **Check** | `grep -rn "ease-apple\|ease-spring" frontend/src --include="*.tsx"` → 20 hits. All must resolve after @theme migration. |
| **Priority** | Medium |

---

### Level 4 — Vitest Unit/Integration (T-006)

| TC-018 | All 1,093 Vitest tests pass |
|---|---|
| **Command** | `cd frontend && npm test` |
| **Expected** | `Test Files X passed, 0 failed; Tests X passed, 0 failed` |
| **Note** | Pre-migration baseline has 1 failing test (BUG-002). That must be fixed before QA can sign off. |
| **Priority** | Critical |

---

### Level 5 — Playwright E2E Visual Smoke (T-008)

Execute each scenario in both **dark** and **light** mode. Capture screenshots on any failure.
Save all screenshots to `agent-docs/tailwind-v4-migration/screenshots/`.

| ID | Scenario | Dark | Light | Priority |
|---|---|---|---|---|
| TC-019 | Board view — all 3 columns visible, cards render | ⬜ | ⬜ | Critical |
| TC-020 | Create task modal — form fields, type selector, validation | ⬜ | ⬜ | Critical |
| TC-021 | Move task todo → in-progress → done | ⬜ | ⬜ | High |
| TC-022 | TaskDetailPanel — open, edit title, close | ⬜ | ⬜ | High |
| TC-023 | Terminal panel — open, type command, close | ⬜ | ⬜ | High |
| TC-024 | AI Actions FAB — visible, hover state | ⬜ | ⬜ | High |
| TC-025 | AI Actions FAB — mobile (375px viewport) | ⬜ | ⬜ | Medium |
| TC-026 | Dark/light toggle — immediate transition, no flash | ⬜ | n/a | Critical |
| TC-027 | Spaces switcher — create, rename, select, delete | ⬜ | ⬜ | High |
| TC-028 | Config panel — open, edit, discard | ⬜ | ⬜ | Medium |
| TC-029 | Badge colours (feature/bug/tech-debt/chore/done) both themes | ⬜ | ⬜ | Critical |
| TC-030 | Border visibility — no invisible borders after `currentColor` change | ⬜ | ⬜ | High |
| TC-031 | Focus rings — outline-hidden produces invisible default ring | ⬜ | ⬜ | High |
| TC-032 | Animations — scale-in, fade-in-up, slide-in-right, toast-out | ⬜ | ⬜ | Medium |
| TC-033 | prefers-reduced-motion — animations collapse to 0.01ms | ⬜ | ⬜ | Medium |

---

### Level 6 — Performance

| TC-034 | Build time delta |
|---|---|
| **Baseline** | 1.42 s (v3, Vite + PostCSS) |
| **Expected** | ≤ 1.42 s (v4 + Vite plugin should be faster, not slower) |
| **Priority** | Low |

| TC-035 | CSS bundle size delta |
|---|---|
| **Baseline** | 51.25 KB (10.78 KB gzip) |
| **Expected** | ≤ 53.8 KB unminified (+5% tolerance) |
| **Priority** | Low |

---

## Environment Requirements

- Node.js 23.x (active on this machine)
- Chromium via Playwright MCP for E2E tests
- `http://localhost:3000` — production server via `node server.js`
- `http://localhost:5173` — dev server via `npm run dev` (HMR tests)
- macOS — Safari 16.4+ browser support floor is acceptable for this internal tool

---

## Assumptions & Exclusions

1. **Assumption:** The Tailwind codemod (`@tailwindcss/upgrade`) will be used. Custom token handling (shadow-sm, rounded-sm) is assumed correct because both map to custom `@theme` declarations, not built-in renames.
2. **Assumption:** Vitest does not process actual CSS — unit tests are unaffected by Tailwind version change. Failures in Vitest post-migration are behavioural regressions, not CSS compilation issues.
3. **Exclusion:** Browser compatibility testing on Safari 16.4 / Firefox 128 is out of scope for this QA cycle (internal tool).
4. **Exclusion:** Lighthouse performance audit. Perf budget covers only build time and CSS bundle size.
5. **Note:** E2E tests (TC-019 to TC-033) could not be executed in this QA pass — Playwright browser was locked by another process. Marked as ⬜ pending.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `dark:` variant stops working after migration | High if `@custom-variant dark` is omitted | Critical — entire dark theme broken | TC-010 gates merge |
| `outline-none` → `outline-hidden` misses in codemod | Medium | High — 42 occurrences expose ghost focus rings in v4 | TC-012 grep gates merge |
| Custom `shadow-sm` / `rounded-sm` override lost | Medium | Medium — cards/buttons render with wrong shadows | TC-014/TC-015 |
| Test suite regresses | Low (Vitest doesn't process CSS) | Medium — indicates behavioural change | TC-018 |
| Build time regression | Low | Low | TC-034 |
| `@custom-variant dark` variant added but *after* @theme | Low | Medium — selector specificity issue | Review index.css ordering |

---

## T-006 Addendum: Board Components + Drag Store (QA Date: 2026-04-08)

### Scope

Covers the specific changes introduced in commit range T-003→T-007 for Board.tsx, Column.tsx, TaskCard.tsx, and the new `useDragStore.ts` Zustand store.

### Additional Test Cases (T-006)

| ID | Type | Description | Input | Expected | Priority |
|---|---|---|---|---|---|
| TC-036 | unit | useDragStore initial state | Fresh store | All three fields null | High |
| TC-037 | unit | startDrag sets draggedTaskId + dragSourceColumn | startDrag('t1','todo') | Fields updated; dragOverTaskId untouched | High |
| TC-038 | unit | setDragOver(null) clears dragOverTaskId | setState then setDragOver(null) | null | High |
| TC-039 | unit | resetDrag clears all fields | Populated state | All null | High |
| TC-040 | unit | Board drag lifecycle aria-grabbed | dragStart + dragEnd | true → false | High |
| TC-041 | unit | Drop same column → moveTask not called | Drop todo→todo | moveTask never invoked | High |
| TC-042 | unit | Drop cross-column direction=right | Drop todo→in-progress | moveTask('t1','right','todo') | High |
| TC-043 | unit | TaskCard isDragOver ring via store state | useDragStore.setState({dragOverTaskId}) | ring-2 ring-primary present | High |
| TC-044 | unit | Column memo: no drag-state props passed | Render Column | No draggedTaskId/dragOverTaskId props | Medium |
| TC-045 | static | No inline styles except staggerDelayMs exception | Source review | Zero style={{}} other than animationDelay | Medium |
| TC-046 | static | outline-hidden present in board components | Grep | outline-hidden in TaskCard; no outline-none | Medium |
| TC-047 | static | Hardcoded #3b82f6 hex in TaskCard | Source review | 3 occurrences: active border + dot colors | Low |
| TC-048 | perf | Re-render budget: O(1) cards per drag-over | Code analysis | Board/Column use getState(); no subscriptions | High |

### T-006 Risk Assessment

| Risk | Severity | Finding |
|---|---|---|
| CSS token drift (ease-apple, animate-fade-in-up) | Medium | Confirmed present in @theme block; build produces correct CSS (72KB chunk) |
| Inline style CLAUDE.md violation | Low | Only animationDelay/animationFillMode present; approved exception per ADR comment |
| Hardcoded #3b82f6 hex colors | Low | Advisory: 3 occurrences in TaskCard (active run border + dot). Should use --color-primary token |
| useDragStore not shared across tabs/windows | Info | Expected: Zustand store is per-page-instance; no cross-tab drag intent |
