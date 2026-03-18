# Test Plan: OPTCG Card Search Visual Redesign

> Feature branch: `feature/optcg-redesign`
> Project: `/Users/oscarmenendezgarcia/Documents/IdeaProjects/optcg-search`
> QA date: 2026-03-18
> ADR reference: `docs/optcg-redesign/ADR-1.md`
> User stories reference: `docs/optcg-redesign/user-stories.md`

---

## Executive Summary

The redesign introduces a landing page (`LandingPage`), a light/dark theme system (`useTheme` + `ThemeToggle`), React Router route restructuring, and a full semantic token migration across 17 component files. All 88 existing tests pass. TypeScript compilation is clean. The production build completes without errors. No Critical or High severity bugs were found. Three Medium and five Low bugs were identified, all of which can be resolved without blocking the merge.

---

## Scope and Objectives

### In scope
- `LandingPage` component and routing at `/`
- `SearchPage` (renamed from `CardSearchPage`) and routing at `/search`
- `/cards` redirect to `/search` and `*` catch-all redirect to `/`
- `useTheme` hook: localStorage persistence, system preference detection, DOM class toggling
- `ThemeToggle` component: cycle behaviour, aria-label, icon selection
- Anti-flash inline script in `index.html`
- Semantic CSS token system (`html.light` / `html.dark`) in `index.css`
- All 15 modified component files: token class correctness in both themes
- `CardDetailModal` alternate art thumbnail picker (`images[]` schema)
- `resolveCardImage` utility
- Accessibility compliance for all new and modified interactive elements
- URL-sync behaviour (`useCardUrlSync` unchanged but tested against new routing)

### Out of scope
- Backend / scraper changes (none made per ADR-1)
- `useCardStore`, `cardSearchEngine`, `cardDataProvider` core logic (unchanged)
- Lighthouse performance auditing (no automation tooling available in environment)
- Visual regression screenshots (no Playwright/Chromatic configured)

---

## Test Levels

### Unit tests
Cover isolated function and hook behaviour: `useTheme` state transitions, `resolveCardImage` URL resolution, `parseKeywords` in `CardEffectText`, `LandingPage` form submission logic.

### Integration tests
Cover component interaction with mocked data: `SearchPage` load flow, filter interactions, modal open/close, color filter narrowing, clear-all filters, error/retry state. Implemented in `CardSearchPage.test.tsx` (13 tests).

### End-to-end (static simulation)
Manual simulation via code review against user stories. No Cypress/Playwright automation in this project. Key flows traced through source code.

### Accessibility
ARIA attributes verified statically and via `@testing-library` assertions. Focus management verified in Modal shared component code.

### Performance (static analysis)
LCP budget verified via architecture: `LandingPage` loads no card data. Build output gzip size reviewed: 95.94 kB JS, 6.52 kB CSS.

### Security
Static review of token handling, no user data persisted beyond `localStorage` key `optcg-theme`. No new API endpoints. No XSS vectors identified in new components (no `innerHTML`, all rendering via React JSX).

---

## Test Cases

| ID | Type | Description | Input | Expected Output | User Story | Priority |
|----|------|-------------|-------|----------------|------------|----------|
| TC-001 | Unit | `useTheme` initialises from `localStorage` | `localStorage['optcg-theme'] = 'dark'` | `theme='dark'`, `resolvedTheme='dark'`, `html.dark` class applied | US-3.2 | P0 |
| TC-002 | Unit | `useTheme` defaults to system when no stored value | No localStorage entry | `theme='system'`, `resolvedTheme` follows `prefers-color-scheme` | US-3.2 | P0 |
| TC-003 | Unit | `useTheme.setTheme('light')` writes localStorage | Call `setTheme('light')` | `localStorage['optcg-theme'] === 'light'`, `html.light` class applied | US-3.2 | P0 |
| TC-004 | Unit | `useTheme.toggleTheme` cycles system→light→dark→system | Three successive `toggleTheme()` calls from `system` | Returns to `system` after three clicks | US-3.1 | P0 |
| TC-005 | Unit | `resolveCardImage` returns path unchanged when no CDN set | `imagePath='/images/optcg/OP01-001.jpg'`, `VITE_CARD_CDN_URL=''` | `'/images/optcg/OP01-001.jpg'` | — | P1 |
| TC-006 | Unit | `resolveCardImage` replaces prefix when CDN set | `imagePath='/images/optcg/OP01-001.jpg'`, CDN=`'https://cdn.example.com'` | `'https://cdn.example.com/OP01-001.jpg'` | — | P1 |
| TC-007 | Unit | `LandingPage` form navigates to `/search?q=Luffy` on submit | Enter "Luffy" in input and submit | `navigate` called with `/search?q=Luffy` | US-2.1 | P0 |
| TC-008 | Unit | `LandingPage` form navigates to `/search` on empty submit | Submit empty input | `navigate` called with `/search` | US-2.1 | P1 |
| TC-009 | Unit | `LandingPage` does not call `loadCards` or `setQuery` | Mount component | No `useCardStore` interaction | US-1.1, US-2.1 | P0 |
| TC-010 | Unit | `ThemeToggle` aria-label reflects current theme | `theme='system'` | `aria-label='Theme: System. Click to cycle theme.'` | US-3.1 | P0 |
| TC-011 | Unit | `ThemeToggle` icon is `light_mode` when resolvedTheme is light | `resolvedTheme='light'` | Material Symbol text = `light_mode` | US-3.1 | P0 |
| TC-012 | Unit | `ThemeToggle` icon is `dark_mode` when resolvedTheme is dark | `resolvedTheme='dark'` | Material Symbol text = `dark_mode` | US-3.1 | P0 |
| TC-013 | Integration | Route `/` renders `LandingPage` | Navigate to `/` | Page contains "ONE PIECE TCG" heading, search input, no card grid | US-1.1 | P0 |
| TC-014 | Integration | Route `/search` renders `SearchPage` | Navigate to `/search` | Page contains search bar, filter panel, results area | US-2.1 | P0 |
| TC-015 | Integration | Route `/cards` redirects to `/search` | Navigate to `/cards` | Browser location becomes `/search`, no history entry added | US-4.2 | P1 |
| TC-016 | Integration | Route `*` redirects to `/` | Navigate to `/xyz` | Browser location becomes `/`, landing page shown | US-5.2 | P1 |
| TC-017 | Integration | `SearchPage` loads skeleton then card grid | Mount with fetch mock | `aria-busy=true` initially, then card grid renders | US-2.3 | P0 |
| TC-018 | Integration | `ResultsCount` shows "Showing N of M cards" | Cards loaded | Text matches pattern "Showing X of Y cards" | US-2.2 | P0 |
| TC-019 | Integration | `ResultsCount` shows "No cards found" on zero results | Filter with no matches | "No cards found" text visible | US-2.2 | P0 |
| TC-020 | Integration | Color filter narrows results | Click Red chip | Non-Red cards removed from grid | US-4.1 | P0 |
| TC-021 | Integration | Clear all filters restores full set | Apply filter then clear | All cards visible again | — | P0 |
| TC-022 | Integration | Card detail modal opens on card click | Click card thumbnail | `[aria-modal=true]` present in DOM | — | P0 |
| TC-023 | Integration | `SearchPage` error state shows retry button | Fetch returns 500 | Retry button visible | — | P1 |
| TC-024 | Integration | View toggle switches to list view | Click List view button | List container with `aria-label="card search results list"` present | — | P1 |
| TC-025 | E2E (simulated) | Search from landing navigates to results with query | Type "Luffy", submit | URL becomes `/search?q=Luffy`, Luffy cards visible | US-2.1 | P0 |
| TC-026 | E2E (simulated) | Bookmarkable URL `/search?q=Luffy&color=Red` loads filtered | Navigate with params | Store `query='Luffy'`, `filters.colors={'Red'}` | US-4.1 | P0 |
| TC-027 | E2E (simulated) | ThemeToggle persists dark mode across page load | Set dark, reload | `html.dark` applied before React hydrates | US-3.2, US-1.2 | P0 |
| TC-028 | E2E (simulated) | Navigate back to landing from SearchPage | Click logo in SearchPage header | Route changes to `/`, landing page shown | US-5.1 | P0 |
| TC-029 | Accessibility | `LandingPage` search input has `<label>` for screen readers | Render LandingPage | `<label for="landing-search">` with SR-only text present | US-1.1 | P0 |
| TC-030 | Accessibility | `FilterPanel` toggle button has `aria-expanded` | Mobile view | `aria-expanded` toggles on click | US-2.3 | P1 |
| TC-031 | Accessibility | `ViewToggle` buttons have `aria-pressed` | Mount SearchPage | Grid button `aria-pressed=true` initially | — | P0 |
| TC-032 | Accessibility | `ResultsCount` has `aria-live="polite"` | Mount SearchPage | `[aria-live]` attribute present | — | P0 |
| TC-033 | Accessibility | `CardDetailModal` close button has `aria-label` | Open modal | `aria-label="Close card detail"` on close button | — | P0 |
| TC-034 | Accessibility | Modal focus trap: Tab wraps, Escape closes | Open modal, Tab to last element, press Tab again | Focus returns to first focusable element | — | P0 |
| TC-035 | Accessibility | `ThemeToggle` focus ring uses gold (`#D4A843`) | Inspect applied CSS | `focus-visible:ring-optcg-gold` class applied | US-3.1 | P1 |
| TC-036 | Performance | `LandingPage` makes no fetch calls on mount | Mount without network | Zero network requests to `/data/optcg-cards.json` | US-1.1 | P0 |
| TC-037 | Performance | JS bundle gzip < 200 kB | Production build | `index-*.js` gzip = 95.94 kB (pass) | US-1.1 | P1 |
| TC-038 | Security | `optcg-theme` localStorage value validated before use | Tamper `localStorage['optcg-theme']='<script>'` | `readStored()` returns `'system'` (invalid value rejected) | US-3.2 | P0 |
| TC-039 | Security | No `innerHTML` or `dangerouslySetInnerHTML` in new components | Code review | Zero unsafe HTML insertion in LandingPage, ThemeToggle, SearchPage | — | P0 |
| TC-040 | Security | Anti-flash script has no external dependencies | Review `index.html` | Script uses only `localStorage` and `window.matchMedia` | US-1.2 | P0 |

---

## Environment Requirements

| Requirement | Value |
|-------------|-------|
| Node.js | >= 18 (project uses Vite 8, React 19) |
| Package manager | npm |
| Test runner | Vitest 3.2.4 + React Testing Library |
| TypeScript | 5.x (via `tsc -b`) |
| Browser targets | Vite default: evergreen + Safari 14+ |
| App URL (dev) | http://localhost:4000 |
| Static data | `public/data/optcg-cards.json` |

---

## Assumptions

1. The app is served with Vite dev server; BrowserRouter requires a dev server that supports HTML5 history fallback.
2. `VITE_CARD_CDN_URL` is not set in `.env` — images are served from the local path.
3. OS dark mode detection via `prefers-color-scheme` is available in all target browsers (supported since Chrome 76, Safari 12.1, Firefox 67).
4. No Lighthouse/Playwright automation was run; performance and E2E assertions are based on static code analysis.
5. Estimated coverage percentage derived from lines covered in existing tests versus total source lines; no `--coverage` instrumentation active.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| `LandingPage` and `ThemeToggle` have zero dedicated unit tests | Confirmed | Medium | New components lack regression safety net. File BUG-001. |
| `useTheme` has zero unit tests | Confirmed | Medium | Core theme logic untested automatically. File BUG-002. |
| Inline `style={{}}` usage conflicts with CLAUDE.md "no inline styles" rule | Confirmed | Medium | All usages reference `var(--token)` — no hardcoded hex/rgba directly. Advisory filed BUG-003. |
| `border-white!` active state in `ColorFilter` is a hardcoded dark-specific class | Confirmed | Low | Intentional: active chip glow is always white. Acceptable as theme-invariant design decision but not documented. BUG-004. |
| Test file still named `CardSearchPage.test.tsx` after component rename | Confirmed | Low | Cosmetic inconsistency; all tests pass. BUG-005. |
| `useCardUrlSync.ts` comment still references old component name `CardSearchPage` | Confirmed | Low | Cosmetic stale comment. BUG-006. |
| `SearchPage` has a redundant variable alias (`loadCardsAction` duplicates `loadCards`) | Confirmed | Low | No runtime error, minor dead code. BUG-007. |
| `aria-label` on colour filter chips includes `(active)` suffix alongside `aria-pressed` | Confirmed | Low | Redundant state signalling — `aria-pressed` is the idiomatic pattern. BUG-008. |
