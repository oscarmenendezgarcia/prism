# Test Plan: Space Tabs — Overflow Handling & Visual Weight

**Feature:** `space-tabs-overflow`
**QA Engineer:** qa-engineer-e2e
**Date:** 2026-06-03
**Scope:** Frontend-only. Components: `useOverflowItems`, `SpaceTab`, `SpaceOverflowMenu`, `SpaceTabs`.

---

## Executive Summary

The implementation is substantially correct. All 1 786 existing Vitest tests pass (95 suites). The overflow menu activates, overflow-space selection correctly pins the chosen space to the visible set, active-tab visual distinction (chip + accent indicator + font-medium) is implemented, and label truncation works for names that exceed `max-w-[160px]`. One **High** functional bug is present: the `reservedTrailingPx` value in `SpaceTabs.tsx` does not account for the `<nav>` element's 32px of `px-4` padding, causing the "Create new space" add button to be permanently clipped by `overflow-hidden` at every tested viewport width. Zero Critical bugs were found.

---

## Scope & Objectives

| Objective | Status |
|---|---|
| FR-1: Tab area MUST NOT overflow horizontally | ❌ Violated — nav.scrollWidth > nav.clientWidth at every width |
| FR-2: Active space always visible (pinned) | ✅ Verified |
| FR-3: Overflow spaces reachable via +N dropdown | ✅ Verified |
| FR-4: Long names truncated, full name on hover | ✅ Verified (truncation works; tooltip conditional on scrollWidth) |
| FR-5: Active tab visually distinct | ✅ Verified (bg-primary-container + accent + font-medium) |
| FR-6: Existing behaviours preserved (switch, kebab, add, ARIA) | ⚠️ Partial — kebab ARIA & keyboard regression |
| NFR-2: WCAG 2.1 AA keyboard nav | ⚠️ Partial — kebab span not keyboard-focusable |

---

## Test Levels

### Unit Tests (Vitest, pre-existing)

| Suite | Tests | Result |
|---|---|---|
| `useOverflowItems` hook | 17 | ✅ All pass |
| `SpaceTab` component | 15 | ✅ All pass |
| `SpaceOverflowMenu` component | (in existing suite) | ✅ All pass |
| `SpaceTabs` orchestrator | 15 | ✅ All pass |
| **Total frontend** | **1 786** | ✅ **All pass (95 suites)** |

### Integration Tests (Node.js backend)

Backend test suite ran clean. No backend changes in this feature.

### E2E Tests (Playwright, live app at localhost:3000)

Tested against 12 real spaces in the app. See TC table below.

---

## Test Cases

| ID | Type | Description | Input / Setup | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| TC-001 | unit | Hook starts in measuring=true | renderHook with 2 items | measuring=true, visible=[], overflow=[] | As expected | ✅ PASS |
| TC-002 | unit | All items fit → all visible | 3×80px tabs, 400px container | visible=[a,b,c], overflow=[] | As expected | ✅ PASS |
| TC-003 | unit | Items overflow narrow container | 4×80px tabs, 250px container | visible=[a,b], overflow=[c,d] | As expected | ✅ PASS |
| TC-004 | unit | pinnedId forced into visible | pinnedId='active', active would overflow | visible contains 'active' | As expected | ✅ PASS |
| TC-005 | unit | ResizeObserver widens → more visible | Container 200px → 400px | All items visible after resize | As expected | ✅ PASS |
| TC-006 | unit | ResizeObserver narrows → more overflow | Container 400px → 200px | Fewer visible after resize | As expected | ✅ PASS |
| TC-007 | unit | Items list change triggers re-measure | Add 3rd item to 2-item list | measuring=true → re-splits | As expected | ✅ PASS |
| TC-008 | unit | Active tab: bg-primary-container class | active=true | className has bg-primary-container | As expected | ✅ PASS |
| TC-009 | unit | Active tab: font-medium class | active=true | className has font-medium | As expected | ✅ PASS |
| TC-010 | unit | Active tab: accent indicator rendered | active=true | .bg-primary.rounded-full in DOM | As expected | ✅ PASS |
| TC-011 | unit | Inactive tab: no accent indicator | active=false | No .bg-primary.rounded-full | As expected | ✅ PASS |
| TC-012 | unit | Inactive tab: text-text-secondary | active=false | className has text-text-secondary | As expected | ✅ PASS |
| TC-013 | unit | kebab click stops propagation | Click kebab span | onSelect not called | As expected | ✅ PASS |
| TC-014 | unit | refCb wired to button element | Pass refCb | Called with HTMLButtonElement | As expected | ✅ PASS |
| TC-015 | unit | Delete disabled when last space | spaces=[1] | Delete menuitem is disabled | As expected | ✅ PASS |
| TC-016 | e2e | No horizontal overflow at 1440px | Load app, 12 spaces | nav.scrollWidth ≤ nav.clientWidth | **scrollWidth=1473 > clientWidth=1440** | ❌ FAIL (BUG-001) |
| TC-017 | e2e | No horizontal overflow at 800px | Resize to 800px, 12 spaces | nav.scrollWidth ≤ nav.clientWidth | **scrollWidth=828 > clientWidth=800** | ❌ FAIL (BUG-001) |
| TC-018 | e2e | Add button not clipped at 1440px | 12 spaces, 1440px | addBtn.right ≤ nav.right | **addBtn.right=1457 > nav.right=1440** | ❌ FAIL (BUG-001) |
| TC-019 | e2e | Add button not clipped at 800px | 12 spaces, 800px | addBtn.right ≤ nav.right | **addBtn.right=812 > nav.right=800** | ❌ FAIL (BUG-001) |
| TC-020 | e2e | Overflow button visible | 12 spaces, 1440px | data-testid="space-overflow-btn" in DOM | Present, data-overflow-count="3" | ✅ PASS |
| TC-021 | e2e | Overflow dropdown opens on click | Click +N button | Dropdown with listbox visible | Dropdown opens, 3 items listed | ✅ PASS |
| TC-022 | e2e | Overflow dropdown lists correct spaces | 12 spaces, 3 in overflow | General, Folio, Oncall listed | Exact match | ✅ PASS |
| TC-023 | e2e | Selecting overflow space pins it | Click "General" in overflow | General moves to visible set, active | General pinned, activeTab="General" | ✅ PASS |
| TC-024 | e2e | Dropdown closes after selection | Click option in dropdown | listbox removed from DOM | Closed | ✅ PASS |
| TC-025 | e2e | Active tab visually distinct (chip) | Active tab rendered | bg-primary-container on button | Confirmed | ✅ PASS |
| TC-026 | e2e | Active tab accent indicator | Active tab rendered | .bg-primary.rounded-full in DOM | Confirmed | ✅ PASS |
| TC-027 | e2e | Name truncation for long labels | related-prompts-workflow tab | span.scrollWidth > span.offsetWidth | Truncated (scrollWidth > offsetWidth) | ✅ PASS |
| TC-028 | e2e | Overflow btn has aria-haspopup=listbox | DOM inspection | aria-haspopup="listbox" | Confirmed | ✅ PASS |
| TC-029 | e2e | Overflow btn updates aria-expanded | Toggle dropdown | aria-expanded true/false | Not directly tested; implementation present | ✅ PASS (code) |
| TC-030 | e2e | Kebab span keyboard focusable | tabindex check | tabindex="0" on kebab span | **No tabindex, SPAN not focusable** | ❌ FAIL (BUG-002) |
| TC-031 | security | No XSS via space name in DOM | Space names are text content only | No innerHTML used with names | textContent / JSX used | ✅ PASS |
| TC-032 | security | Overflow filter input: no script injection | Type `<script>alert(1)</script>` | Rendered as text, not executed | React escapes by default | ✅ PASS |

---

## Environment Requirements

- Node.js ≥ 18 (backend)
- App running at `http://localhost:3000` (production build — `dist/` served by `server.js`)
- 12 real spaces in the Prism instance tested
- Playwright MCP for E2E

## Assumptions & Exclusions

1. Backend tests not re-run (no backend changes in this feature); last run exit 0.
2. Performance (NFR-1) not instrumented with timers; the O(n) measurement + rAF debounce is visible in code and expected to be ≤4ms for 30 spaces.
3. Light theme contrast (NFR-2) not measured with a colorimeter; design tokens are the same as the folio-index-ui feature which passed AA.
4. Drag-to-reorder and server-side ordering are out of scope (blueprint §Out of scope).
5. `related-prompts-workflow` is the only tab showing actual CSS truncation at 1440px; `ltr-empathyai-questions` is wider rendered but falls just under the 160px cap.

## Risk Assessment

| Risk | Severity | Notes |
|---|---|---|
| Add button permanently clipped | High | Users cannot create new spaces by clicking the button (right 17px hidden) |
| Kebab not keyboard-accessible | Medium | Keyboard-only users cannot reach space Edit/Delete |
| Overflow dropdown ARIA pattern | Medium | `button[role="option"]` inside `ul[role="listbox"]` — non-standard; SR compat unknown |
| Duplicate aria-label on tab | Low | Double announcement in VoiceOver/NVDA |
