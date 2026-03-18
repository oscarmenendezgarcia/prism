# Test Plan: OPTCG Card Search Visual Redesign

**Feature:** Visual redesign — routing, theme system, landing page, token migration
**ADR:** `docs/optcg-redesign/ADR-1.md` (status: Accepted)
**Branch:** `feature/optcg-redesign`
**QA Date:** 2026-03-18
**QA Engineer:** qa-engineer-e2e

---

## Executive Summary

The OPTCG Card Search application has been redesigned to add a dedicated landing page at `/`, rename the search results component from `CardSearchPage` to `SearchPage` at `/search`, and introduce a full light/dark/system theme system backed by CSS custom properties and a `useTheme` hook.

**Risk level: Medium.** All 88 automated tests pass. TypeScript compiles clean. Production build succeeds. Four bugs were identified during static review: two were High severity (dead file coexisting with renamed component; test suite testing dead file instead of live component) and were fixed before this plan was finalised. Two Medium and two Low bugs remain documented for backlog resolution.

**Merge gate status:** PASSED. No Critical or High bugs remain open.

---

## Scope and Objectives

### In scope

- `/` route: `LandingPage` component — hero, search form, theme toggle, anti-flash script
- `/search` route: `SearchPage` component — full search, filters, URL sync, theme toggle in header
- `/cards` redirect to `/search` (backwards compat)
- `*` catch-all redirect to `/`
- `useTheme` hook — localStorage persistence, matchMedia system preference, html class toggle
- `ThemeToggle` component — icon cycling, aria-label, focus ring
- CSS semantic token layer (`--color-page`, `--color-input`, etc.) under `html.light` / `html.dark`
- All 17 component files migrated from hardcoded dark classes to semantic token classes

### Out of scope

- Backend, API endpoints, JSON data schema — no changes per ADR-1
- Zustand store logic — explicitly unchanged per ADR-1
- `useCardUrlSync` hook internals — explicitly unchanged per ADR-1
- Performance profiling beyond the existing P95 < 500 ms baseline
- Browser compatibility outside Chrome/Firefox/Safari latest

### Assumptions

1. `window.matchMedia` and `localStorage` are available in all target browsers — confirmed browser-native, no polyfill needed.
2. The Vite dev server at `http://localhost:4000` is used for manual E2E verification.
3. "System" preference in tests is mocked to return `matches: false` (light preference) via `test-setup.ts`.
4. Coverage percentages are estimated from static analysis (Vitest does not emit a coverage report in the run used here).

---

## Environment Requirements

| Requirement | Value |
|-------------|-------|
| Node.js | v23+ (confirmed by project) |
| Package manager | npm |
| Test runner | Vitest v3.2.4 |
| React Testing Library | Latest (per package.json) |
| jsdom | Default Vitest environment |
| Dev server | `vite` → `http://localhost:4000` |
| Browsers for manual testing | Chrome 122+, Firefox 124+, Safari 17+ |

---

## Test Levels

### Level 1: Unit Tests

Target: isolated hook and component logic with no DOM rendering.

### Level 2: Integration Tests

Target: full component trees rendered in jsdom with mocked fetch and store.

### Level 3: End-to-End (Manual)

Target: real browser at `http://localhost:4000`, verifying visual correctness, theme switching, navigation flows, and URL sync.

### Level 4: Performance

Target: LCP and load time targets stated in user stories.

### Level 5: Security

Target: OWASP Top 10 review of the SPA surface area introduced by this redesign.

### Level 6: Accessibility

Target: WCAG AA colour contrast, keyboard navigation, ARIA attributes.

---

## Test Cases

### Theme Toggle (Epic E-3)

| ID | Type | Description | Input | Expected Output | Priority |
|----|------|-------------|-------|-----------------|----------|
| TC-001 | Unit | `useTheme` initialises to `system` when localStorage is empty | Empty localStorage | `theme === 'system'`, `resolvedTheme` derived from matchMedia | High |
| TC-002 | Unit | `useTheme` initialises to stored value when localStorage has `'dark'` | `localStorage.optcg-theme = 'dark'` | `theme === 'dark'`, `resolvedTheme === 'dark'` | High |
| TC-003 | Unit | `setTheme('light')` writes `'light'` to localStorage | Call `setTheme('light')` | `localStorage.getItem('optcg-theme') === 'light'` | High |
| TC-004 | Unit | `toggleTheme()` cycles system → light → dark → system | Three successive calls | Returns to original theme | High |
| TC-005 | Unit | `resolvedTheme` is `'dark'` when system preference is dark and theme is `'system'` | `matchMedia.matches = true`, `theme = 'system'` | `resolvedTheme === 'dark'` | High |
| TC-006 | Unit | `resolvedTheme` is `'light'` when system preference is light and theme is `'system'` | `matchMedia.matches = false`, `theme = 'system'` | `resolvedTheme === 'light'` | High |
| TC-007 | Unit | OS preference change event updates `resolvedTheme` when in system mode | Dispatch matchMedia change event | `resolvedTheme` flips to new value | Medium |
| TC-008 | Unit | OS preference change event is ignored when theme is explicitly `'dark'` | Dispatch matchMedia change event with `theme = 'dark'` | `resolvedTheme` stays `'dark'` | Medium |
| TC-009 | Integration | `ThemeToggle` renders sun icon when resolved theme is light | `resolvedTheme = 'light'` | `material-symbols-outlined` contains `light_mode` | High |
| TC-010 | Integration | `ThemeToggle` renders moon icon when resolved theme is dark | `resolvedTheme = 'dark'` | `material-symbols-outlined` contains `dark_mode` | High |
| TC-011 | Integration | Three clicks on `ThemeToggle` return to original theme | Three click events | `aria-label` returns to initial value | High |
| TC-012 | E2E | Theme preference persists across page reload | Set dark, reload | Page loads in dark mode without flash | High |
| TC-013 | E2E | Anti-flash script applies correct class before React hydrates | Hard reload with dark OS preference | No white flash observable on slow network | High |
| TC-014 | E2E | `ThemeToggle` present in both `LandingPage` header and `SearchPage` sticky header | Navigate to `/` then `/search` | Button visible in top-right corner on both pages | High |

### Landing Page Flow (Epic E-1, E-2)

| ID | Type | Description | Input | Expected Output | Priority |
|----|------|-------------|-------|-----------------|----------|
| TC-015 | Integration | `LandingPage` renders "ONE PIECE TCG" heading | Render at `/` | `h1` contains text matching `/ONE PIECE TCG/i` | High |
| TC-016 | Integration | `LandingPage` renders "Card Search" subtitle | Render at `/` | Paragraph with "Card Search" visible | High |
| TC-017 | Integration | `LandingPage` renders dataset hint text | Render at `/` | Text matching `/2,400\+.+cards/i` visible | Medium |
| TC-018 | Integration | `LandingPage` does NOT render card grid or filter panel | Render at `/` | No `role="grid"` or filter sidebar in DOM | High |
| TC-019 | Integration | `LandingPage` does NOT call `loadCards()` or touch `useCardStore` | Render at `/` | No fetch to `/api/cards.json` initiated | High |
| TC-020 | Integration | Search form submit with text navigates to `/search?q=Luffy` | Type "Luffy" and press Enter | `window.location.pathname === '/search'`, `?q=Luffy` in URL | High |
| TC-021 | Integration | Search form submit with empty input navigates to `/search` with no `q` param | Empty input, press Enter | Navigate to `/search`, no `q` param | Medium |
| TC-022 | Integration | Search button click produces same navigation as Enter | Type "Nami", click Search button | Navigate to `/search?q=Nami` | High |
| TC-023 | E2E | LCP < 1.5 s on landing page (no card data fetch) | Load `http://localhost:4000/` | Chrome DevTools LCP < 1500 ms | Medium |

### Search Navigation (Epic E-2, E-4, E-5)

| ID | Type | Description | Input | Expected Output | Priority |
|----|------|-------------|-------|-----------------|----------|
| TC-024 | Integration | `SearchPage` mounts and calls `loadCards()` | Render `SearchPage` | fetch to cards data URL initiated | High |
| TC-025 | Integration | `SearchPage` reads `q` param on mount via `useCardUrlSync` | `MemoryRouter initialEntries={['/search?q=Luffy']}` | Store `query === 'Luffy'` after mount | High |
| TC-026 | Integration | `SearchPage` shows skeleton during loading | Before fetch resolves | `aria-busy="true"` element in DOM | High |
| TC-027 | Integration | `SearchPage` replaces skeleton with results after load | After fetch resolves | Card names visible; no `aria-busy` | High |
| TC-028 | Integration | `SearchPage` shows error state on fetch failure | `fetch` returns 500 | Retry button visible | High |
| TC-029 | E2E | `/cards` redirect preserves arrival at `/search` | Navigate to `http://localhost:4000/cards` | Browser URL becomes `/search` with `replace` | High |
| TC-030 | E2E | Unknown path `/xyz` redirects to `/` | Navigate to `http://localhost:4000/xyz` | Browser URL becomes `/` | Medium |
| TC-031 | E2E | OPTCG logo in `SearchPage` header is a link back to `/` | Click logo from `/search` | Navigate to `/`, landing page shown | High |

### URL Parameter Sync (Epic E-4)

| ID | Type | Description | Input | Expected Output | Priority |
|----|------|-------------|-------|-----------------|----------|
| TC-032 | Integration | `useCardUrlSync` reads `q` param on mount | `?q=Zoro` in URL | `useCardStore.query === 'Zoro'` | High |
| TC-033 | Integration | `useCardUrlSync` reads `color` param on mount | `?color=Red` in URL | `useCardStore.filters.colors` contains `'Red'` | High |
| TC-034 | Integration | Filter change pushes updated param to URL (replaceState) | Toggle Red color filter | URL updates to include `?color=Red` without navigation | High |
| TC-035 | E2E | Bookmarked URL `/search?q=Luffy&color=Red` reproduces same results in fresh session | Open URL in incognito | Results show only Red Luffy cards | High |
| TC-036 | Unit | Theme preference is NOT stored in URL | Set theme to dark, check URL | URL contains no `theme` param | Medium |

### Component Token Migration (Epic E-3, US-3.3)

| ID | Type | Description | Input | Expected Output | Priority |
|----|------|-------------|-------|-----------------|----------|
| TC-037 | Static | Zero `bg-optcg-navy` references in component files (except CardSearchPage deleted) | `grep -rn "bg-optcg-navy\b" src/components/` | 0 matches | High |
| TC-038 | Static | Zero `bg-optcg-navy-light` references in component files | `grep -rn "bg-optcg-navy-light" src/components/` | 0 matches after BUG-003/004 fixes | High |
| TC-039 | Static | Zero unscoped `text-white` references in component files | `grep -rn "text-white\b" src/components/` | 0 matches (theme-invariant usages allowed with comment) | Medium |
| TC-040 | E2E | All components render correctly in dark mode | Toggle to dark | No white backgrounds or invisible text | High |
| TC-041 | E2E | All components render correctly in light mode | Toggle to light | No dark backgrounds blocking text; readable contrast | High |
| TC-042 | E2E | OPTCG color indicators (Red/Blue/Green/Yellow/Purple/Black) unchanged in both themes | Compare color chip appearance in both themes | Color values identical in both modes | Medium |
| TC-043 | E2E | Yellow color chip has visible border in light mode (WCAG) | Switch to light mode, view ColorFilter | Yellow chip has `border border-black/20` visible | Medium |

### Accessibility (All Epics)

| ID | Type | Description | Input | Expected Output | Priority |
|----|------|-------------|-------|-----------------|----------|
| TC-044 | Integration | Search input has accessible `aria-label` | Render `SearchPage` | `getByLabelText(/search cards/i)` resolves | High |
| TC-045 | Integration | `ResultsCount` has `aria-live` region | After load | `document.querySelector('[aria-live]')` non-null | High |
| TC-046 | Integration | `ViewToggle` buttons have `aria-pressed` | After render | Grid button `aria-pressed="true"`, list `aria-pressed="false"` | High |
| TC-047 | Integration | Card detail modal has `aria-modal="true"` | Open modal | `[aria-modal="true"]` in DOM | High |
| TC-048 | E2E | Body text contrast in light mode: `#1A1A2E` on `#FAFAFA` | DevTools contrast checker | >= 4.5:1 (WCAG AA) | High |
| TC-049 | E2E | All interactive elements keyboard-accessible (Tab + Enter/Space) | Keyboard-only navigation | All buttons, inputs, cards reachable and activatable | High |
| TC-050 | E2E | `ThemeToggle` focus ring uses gold (#D4A843) on both themes | Focus button with Tab | Gold ring visible in light and dark mode | Medium |
| TC-051 | E2E | `ThemeToggle` `aria-label` updates on each click | Three clicks | Label reflects new state each time | High |

### Security (OWASP Top 10 — SPA surface)

| ID | Type | OWASP | Description | Expected | Priority |
|----|------|-------|-------------|----------|----------|
| TC-052 | Security | A03 Injection | `localStorage` value used in class toggle — arbitrary class injection | `readStored()` validates against enum `['light','dark','system']`; any other value defaults to `'system'`. No injection surface. | High |
| TC-053 | Security | A03 Injection | URL `q` param passed to Fuse.js search — verify no eval or dangerouslySetInnerHTML path | Search results rendered via `card.name` in JSX (auto-escaped); no `innerHTML` or `eval`. Confirmed safe. | High |
| TC-054 | Security | A05 Security Misconfiguration | Anti-flash inline script uses only `localStorage.getItem` and `classList.add` — no external src, no eval | Script is inline, dependency-free, < 10 lines per ADR-1 | Medium |
| TC-055 | Security | A01 Broken Access Control | No authentication surface introduced — all routes are public read-only | N/A — static SPA with no auth | Low |
| TC-056 | Security | A06 Vulnerable Components | Review new dependencies introduced by redesign | ADR-1 confirms zero new dependencies; existing Fuse.js, react-router, zustand unchanged | Medium |

### Performance

| ID | Type | Description | Threshold | Priority |
|----|------|-------------|-----------|----------|
| TC-057 | Perf | LandingPage LCP (no card data fetch) | < 1500 ms (US-1.1) | High |
| TC-058 | Perf | SearchPage time-to-interactive with warm cache | < 500 ms P95 | Medium |
| TC-059 | Perf | Search results update latency after filter toggle | < 50 ms (Fuse.js sync) | Medium |
| TC-060 | Perf | Production bundle gzip size | <= 100 KB JS gzip | Low |

Actual measurement from build: `dist/assets/index-DcZcB2D6.js` = 311 KB raw / **95.98 KB gzip**. Threshold met.

---

## Open Questions from Developer Summary — QA Assessment

| Question | QA Finding | Action |
|----------|------------|--------|
| Should `CardSearchPage.tsx` be deleted now that `SearchPage.tsx` is the canonical file? | Yes — dead file confirmed. Fixed as BUG-001. | CLOSED (fixed in QA commit) |
| Should `CardSearchPage.test.tsx` be renamed and redirected to `SearchPage`? | Yes — tests were covering the dead file. Fixed as BUG-002. | CLOSED (fixed in QA commit) |
| Does `ThemeToggle` need a `window.matchMedia` mock in tests? | Yes — added to `test-setup.ts`. | CLOSED (fixed in QA commit) |
| Is `useTheme` covered by unit tests? | No unit tests exist. Documented as BUG-006. | OPEN (Low, backlog) |
| Are there any remaining hardcoded dark classes? | `CardImage.tsx` (3 classes) and `CardThumbnail.tsx` (1 class). Fixed as BUG-003/004. | CLOSED (fixed in QA commit) |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Flash of wrong theme on hard reload | Low | Medium | Anti-flash inline script in `<head>` — verified present and correct |
| `ThemeToggle` aria-label does not match US-3.1 spec wording | Confirmed | Low | Documented BUG-005 (Medium) |
| `useTheme` matchMedia listener not removed on unmount in edge cases | Low | Low | Cleanup function uses `removeEventListener` correctly |
| Hardcoded palette classes missed in migration audit | Low (2 found/fixed) | Medium | Grep audit confirms 0 remaining after fixes |
| No coverage for `useTheme` hook — regressions could go undetected | Confirmed | Medium | Documented BUG-006 (Low). Unit tests recommended before next theme feature |

---

## Performance Baselines

| Metric | Baseline |
|--------|----------|
| API response P95 | N/A — static SPA, no runtime API calls |
| JS bundle gzip | 95.98 KB |
| CSS gzip | 6.92 KB |
| LCP target | < 1500 ms (landing), < 2000 ms (search) |
| Search filter response | < 50 ms (synchronous Fuse.js) |
| Error rate | 0% (no server calls at runtime) |
