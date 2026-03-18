# ADR-1: OPTCG Card Search Visual Redesign — Routing, Theme System, and Token Strategy

## Status

Accepted

## Context

The OPTCG Card Search application currently renders a single dark-mode-only page (`CardSearchPage`) at both `/` and `/cards`. All 17 component files use hardcoded dark-palette Tailwind classes (`bg-optcg-navy`, `text-white`, `border-white/10`, etc.) with no theme abstraction.

The redesign requires:
1. A dedicated landing page (`/`) with a centered search bar, separate from the search results page (`/search`).
2. A light/dark mode toggle with system preference detection and localStorage persistence.
3. A Scryfall-inspired design direction: spacious, light-primary, with the existing OPTCG dark palette available as dark mode.

All changes are UI-only. No backend, no schema changes, no new API endpoints. The existing Zustand store, static JSON data, scraper, and search engine remain untouched.

---

## Decision 1: Landing Page Routing Strategy

**Use react-router-dom's existing `<Routes>` to add `/` as `LandingPage` and `/search` as `SearchPage` (renamed from `CardSearchPage`). On search submission from the landing page, navigate to `/search?q=...` using `useNavigate()`.**

### Rationale

The app already uses `react-router-dom` v7 with `BrowserRouter`. Adding a new route is trivial and requires no new dependencies.

Two alternative approaches were evaluated:

**Alternative A — Conditional rendering (no route change):** Keep `/` as the only route and toggle between landing and results views based on whether a search has been submitted. Discarded because: (a) breaks the back button expectation (user cannot return to landing), (b) makes `/search?q=luffy` non-shareable as a direct URL, (c) couples the two views unnecessarily.

**Alternative B — Hash-based routing:** Use `HashRouter` instead of `BrowserRouter`. Discarded because: the app already uses `BrowserRouter`, there is no server-side restriction requiring hash routing, and `useSearchParams` already works with `BrowserRouter` for URL sync.

### Route table after redesign

| Path | Component | Behavior |
|------|-----------|----------|
| `/` | `LandingPage` | Centered logo + search bar. On submit, navigate to `/search?q=...` |
| `/search` | `SearchPage` | Current `CardSearchPage` layout. Reads `q` from URL on mount. |
| `/cards` | Redirect to `/search` | Backwards-compatible redirect |
| `*` | Redirect to `/` | Catch-all |

### `useCardUrlSync` impact

The existing `useCardUrlSync` hook reads `q`, `color`, `type`, `set`, etc. from `useSearchParams()` on mount and syncs store changes back to the URL. This hook is already mounted inside `CardSearchPage` (soon `SearchPage`) and only runs on `/search`. No changes needed to the hook itself.

The landing page does NOT mount `useCardUrlSync`. It simply navigates to `/search?q=...` on submit, and `SearchPage` picks up the query on mount via the existing hook.

---

## Decision 2: Theme System Design

**Use CSS custom properties scoped under `html.light` and `html.dark` classes, toggled by a `useTheme` hook that reads/writes `localStorage` and respects `prefers-color-scheme` as the default. Tailwind classes reference the custom properties via the existing `@theme` block.**

### Rationale

Three approaches were evaluated:

**Option A — Tailwind `dark:` variant classes (rejected):** Tailwind v4 supports `dark:bg-white` style modifiers. This would require adding `dark:` prefixes to every hardcoded class across all 17 component files (~79 hardcoded dark-color class usages). This is extremely verbose, error-prone, and makes the HTML unreadable.

**Option B — CSS custom properties with class toggle (chosen):** Define semantic token variables (`--color-page-bg`, `--color-text-primary`, etc.) that resolve to different values under `html.light` and `html.dark`. Components use Tailwind classes that reference these variables (e.g., `bg-[var(--color-page-bg)]` or registered as `@theme` tokens like `bg-page`). This approach: (a) centralizes all theme values in one CSS file, (b) requires changing each component class only once, (c) is the idiomatic approach for Tailwind v4 with PostCSS.

**Option C — Separate CSS files per theme (rejected):** Maintain `light.css` and `dark.css`, swapping `<link>` tags at runtime. This causes a flash of unstyled content on theme switch and doubles CSS maintenance burden.

### Theme toggle mechanism

1. On app mount, `useTheme` hook reads `localStorage.getItem('optcg-theme')`.
2. If no stored value, reads `window.matchMedia('(prefers-color-scheme: dark)').matches`.
3. Applies `html.light` or `html.dark` class to `document.documentElement`.
4. Listens to `matchMedia` change events if in "system" mode.
5. Exposes `theme` ('light' | 'dark' | 'system'), `resolvedTheme` ('light' | 'dark'), and `setTheme()` to components.
6. `ThemeToggle` component renders a button cycling through: system -> light -> dark -> system.

### localStorage key

`optcg-theme` — stores `'light'`, `'dark'`, or `'system'`.

---

## Decision 3: CSS Token Naming and Theme Mapping

**Introduce semantic token layer (`--color-page-bg`, `--color-card-bg`, `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`, `--color-border`, `--color-input-bg`, `--color-input-border`) that map to concrete OPTCG palette values under each theme. The six OPTCG color constants (red, blue, green, yellow, purple, black) and gold remain unchanged across themes.**

### Rationale

The existing `index.css` already defines some semantic tokens (`--color-surface`, `--color-text-primary`, etc.) but they are hardcoded to dark values and mixed with OPTCG palette constants. The redesign needs a clean separation:

- **Palette constants** (theme-invariant): `--color-optcg-red`, `--color-optcg-blue`, `--color-optcg-green`, `--color-optcg-yellow`, `--color-optcg-purple`, `--color-optcg-black`, `--color-optcg-gold`, `--color-optcg-navy`, `--color-optcg-navy-light`. These never change between themes because they represent the card game's brand colors and must be legible in both modes.
- **Semantic tokens** (theme-dependent): `--color-page-bg`, `--color-card-bg`, `--color-card-border`, `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`, `--color-border`, `--color-input-bg`, `--color-input-border`, `--color-hover-bg`. These flip between light and dark values.
- **Shadows** (theme-dependent): `--shadow-optcg-card`, `--shadow-optcg-card-hover` need lighter values in light mode.

### What changes per component

| Component | Current hardcoded classes | Replacement token classes |
|-----------|-------------------------|--------------------------|
| `CardSearchPage` | `bg-optcg-navy`, `text-white`, `bg-optcg-navy/90`, `border-white/10` | `bg-page`, `text-primary`, `bg-page/90`, `border-border` |
| `SearchBar` | `bg-optcg-navy-light`, `border-white/10`, `text-white`, `placeholder-white/30` | `bg-input`, `border-input-border`, `text-primary`, `placeholder-text-muted` |
| `FilterPanel` | `bg-optcg-navy`, `border-white/10`, `bg-optcg-navy-light` | `bg-page`, `border-border`, `bg-input` |
| `CardThumbnail` | `bg-optcg-card-bg`, `border-optcg-card-border`, `bg-optcg-navy-light/90`, `text-white` | `bg-card`, `border-card-border`, `bg-card-name`, `text-primary` |
| `CardDetailModal` | `bg-optcg-navy-light`, `border-optcg-card-border`, `text-white`, `border-white/10` | `bg-card`, `border-card-border`, `text-primary`, `border-border` |
| `CardRow` | `border-white/5`, `hover:bg-optcg-navy-light/60`, `text-white` | `border-border`, `hover:bg-hover`, `text-primary` |
| `CardStats` | `border-white/10`, `text-white`, `text-white/40`, `text-white/30` | `border-border`, `text-primary`, `text-secondary`, `text-muted` |
| `ResultsCount` | `text-white/50`, `text-white` | `text-secondary`, `text-primary` |
| `ViewToggle` | `bg-optcg-navy-light`, `border-white/10`, `bg-optcg-navy`, `text-white/40` | `bg-input`, `border-border`, `bg-page`, `text-secondary` |
| `CardGridSkeleton` | `bg-optcg-navy-light` | `bg-input` |
| `ColorFilter` | `text-white/40`, `border-white/20` | `text-secondary`, `border-border` |
| `CardEffectText` | `text-white`, `bg-white/5` | `text-primary`, `bg-hover` |
| All filter sub-components | `text-white/40`, `text-white/80`, `border-white/*` | `text-secondary`, `text-primary`, `border-border` |
| `Modal` (shared) | Already uses `bg-surface`, `border-border`, `text-text-primary` | Needs `--color-surface` to flip per theme |

### Components that need NO theme changes

- `CardImage` — renders `<img>` tags only, no background classes.
- `CardGrid` — structural layout only, delegates to `CardThumbnail`.
- `CardList` — structural layout only, delegates to `CardRow`.

---

## Consequences

### Positive

- **Single source of truth for theme values** — all in `index.css` under `html.light` / `html.dark` selectors.
- **Minimal Zustand changes** — no store modifications needed; theme state lives in a standalone hook + DOM class.
- **No new dependencies** — CSS custom properties, `matchMedia`, and `localStorage` are all browser-native.
- **All existing tests pass** — changing Tailwind class names from `bg-optcg-navy` to `bg-page` is a string swap with no behavioral change. Test assertions on user interactions and store state are unaffected.
- **Shareable URLs** — `/search?q=luffy&color=Red` continues to work as before.

### Negative / Risks

- **79 hardcoded class references across 17 files** need updating. Risk: missing a class, causing a visual bug in one theme. Mitigation: the component audit table above is exhaustive; QA must test both themes on every component.
- **`@theme` block registration in Tailwind v4** — new token names (`bg-page`, `text-primary`, etc.) may shadow existing utility classes. Mitigation: prefix all semantic tokens with `page-`, `card-`, or use the existing `--color-` namespace consistently.
- **Flash of wrong theme on initial load** — if the CSS class is applied after React hydrates, users may see a brief flash. Mitigation: add a `<script>` in `index.html` `<head>` that reads `localStorage` and sets the class synchronously before the body renders.

### Alternatives Considered

- **Tailwind `dark:` variant approach** — discarded due to doubling class count in JSX and poor maintainability.
- **CSS-in-JS (styled-components, emotion)** — discarded; project uses Tailwind v4 exclusively, adding a CSS-in-JS library contradicts the "no new dependencies" constraint.
- **Single page with conditional landing view** — discarded; breaks URL shareability and back-button behavior.

---

## Review

Suggested review date: 2026-09-18
