# User Stories: OPTCG Card Search Visual Redesign

> ADR reference: `docs/optcg-redesign/ADR-1.md`
> Blueprint reference: `docs/optcg-redesign/blueprint.md`
> Date: 2026-03-18

---

## Personas

### P-1: The Competitive Player
Oscar searches for specific cards by name or card number to build and verify tournament decks. He visits the app frequently and wants fast, precise results. He bookmarks search URLs to share deck ideas with teammates. He primarily uses desktop during deck-building sessions.

### P-2: The Casual Fan
Maria is new to the One Piece TCG and wants to browse cards by character name or color. She uses the app on her phone while watching the anime. She does not know card numbers and relies on visual browsing. Light mode is her preference.

### P-3: The Night-Session Builder
Kenji builds decks late at night in low-light environments. He keeps his monitor in dark mode system-wide and expects apps to respect that. He finds pure white backgrounds harsh on his eyes.

---

## Epics

| ID | Epic | Description |
|----|------|-------------|
| E-1 | Landing Page Experience | Dedicated home screen with search entry point |
| E-2 | Search and Navigation Flow | Searching from landing and arriving at results |
| E-3 | Theme System | Light/dark mode toggle with persistence |
| E-4 | Shareable and Bookmarkable URLs | URL-based state for search and filters |
| E-5 | Navigation and Wayfinding | Getting back to landing from results |

---

## Epic E-1: Landing Page Experience

### Story US-1.1
**As a casual fan (P-2),** I want to land on a clean home page with a visible search bar so that I know immediately how to start exploring cards.

**Acceptance Criteria:**
- [ ] The route `/` renders the `LandingPage` component without loading any card data
- [ ] The page displays a logo/heading containing "ONE PIECE TCG" and "Card Search"
- [ ] A search input is visible and focused (or easily reachable) as the first interactive element
- [ ] Below the search bar, text displays the approximate catalog size (e.g., "2,400 cards across 49 sets")
- [ ] The page loads in under 1.5 seconds on a standard connection (no card data fetch required)
- [ ] There is no card grid, list, or filter panel on this page

**Definition of Done:**
- `LandingPage.tsx` renders at `/` per the router table
- No call to `loadCards()` or interaction with `useCardStore` in `LandingPage`
- LCP < 1.5s measured via Lighthouse in both light and dark modes
- Snapshot test covers the default rendered output

**Priority:** Must
**Story Points:** 3
**Task ref:** T-R04

---

### Story US-1.2
**As a night-session builder (P-3),** I want the landing page to appear in dark mode automatically when my OS is set to dark so that I never see a jarring white flash on page load.

**Acceptance Criteria:**
- [ ] `index.html` contains an inline `<script>` in `<head>` that reads `localStorage` and applies `html.light` or `html.dark` before React hydrates
- [ ] A hard refresh with the OS set to dark mode shows the dark landing page immediately, without a white flash
- [ ] A hard refresh with the OS set to light mode shows the light landing page immediately
- [ ] The inline script has no external dependencies and is fewer than 10 lines

**Definition of Done:**
- `index.html` modified per blueprint section 3.14
- Manual test: hard reload in both OS modes confirms no flash
- The script does not throw any console errors

**Priority:** Must
**Story Points:** 1
**Task ref:** T-R09

---

## Epic E-2: Search and Navigation Flow

### Story US-2.1
**As a competitive player (P-1),** I want to type a card name or card number in the landing page search bar and press Enter to be taken directly to the results page so that I can reach my search without extra clicks.

**Acceptance Criteria:**
- [ ] Typing in the landing search bar and pressing Enter navigates the browser to `/search?q={encoded-value}`
- [ ] Clicking the Search button produces the same navigation
- [ ] The search value is URI-encoded (e.g., spaces become `%20` or `+`)
- [ ] Submitting an empty search navigates to `/search` (no `q` param), showing all cards
- [ ] The `SearchPage` on mount reads the `q` parameter and populates the search results correctly via `useCardUrlSync`
- [ ] The `LandingPage` does NOT interact with `useCardStore` or call `setQuery()`

**Definition of Done:**
- Navigation from `/` to `/search?q=Luffy` works and displays filtered results
- Existing `useCardUrlSync` hook behaviour is unchanged
- Integration test: navigate to `/search?q=Luffy`, verify result count > 0

**Priority:** Must
**Story Points:** 2
**Task ref:** T-R04, T-R05

---

### Story US-2.2
**As a casual fan (P-2),** I want the search results page to show a count of how many cards match my current filters so that I understand the scope of my results.

**Acceptance Criteria:**
- [ ] The toolbar row on `SearchPage` displays "N results" where N updates reactively as filters change
- [ ] When 0 results are found, the count shows "0 results" and the empty state component is rendered
- [ ] The count is visible at both desktop (toolbar row) and mobile (above the filter toggle chip) breakpoints
- [ ] The count text uses `text-secondary` token (muted, not primary) to maintain visual hierarchy

**Definition of Done:**
- `ResultsCount` component uses semantic token `text-secondary`
- Unit test: renders correct count string for 0, 1, and N results
- Manual test: applying a filter that yields 0 results triggers empty state

**Priority:** Must
**Story Points:** 1
**Task ref:** T-R08

---

### Story US-2.3
**As any user,** I want to see a loading skeleton while the card catalog is being fetched so that I know the page is working and have a sense of the content layout.

**Acceptance Criteria:**
- [ ] While `loadCards()` is in progress, the card grid area shows `CardGridSkeleton` with at least 10 placeholder cards
- [ ] The skeleton cards have the same dimensions and rounded corners as real cards
- [ ] The skeleton uses `bg-input` token with `animate-pulse` (so it looks correct in both themes)
- [ ] The grid container has `aria-busy="true"` and `aria-label="Loading cards"` during loading
- [ ] Once data loads, the skeleton is replaced by the real card grid with no layout shift

**Definition of Done:**
- `CardGridSkeleton` uses `bg-input` token (replaced from `bg-optcg-navy-light`)
- `aria-busy` attribute toggled correctly in `SearchPage`
- Manual test: throttle network to Slow 3G; verify skeleton appears for at least 500ms

**Priority:** Must
**Story Points:** 1
**Task ref:** T-R07, T-R08

---

## Epic E-3: Theme System

### Story US-3.1
**As any user,** I want a visible theme toggle button on both the landing page and the search results page so that I can switch between light and dark mode at any time.

**Acceptance Criteria:**
- [ ] A `ThemeToggle` button is present in the top-right corner of `LandingPage`
- [ ] A `ThemeToggle` button is present in the sticky header bar of `SearchPage`, right-aligned
- [ ] The button shows a sun icon (`light_mode` Material Symbol) when the resolved theme is light
- [ ] The button shows a moon icon (`dark_mode` Material Symbol) when the resolved theme is dark
- [ ] The button has an `aria-label` indicating the current mode (e.g., "Switch to dark mode")
- [ ] The button has a `title` tooltip showing "Light", "Dark", or "System"
- [ ] Clicking the button cycles through: system → light → dark → system
- [ ] The focus ring uses `#D4A843` (gold) on both light and dark backgrounds

**Definition of Done:**
- `ThemeToggle.tsx` renders correctly and cycles themes on click
- `aria-label` updates to reflect the current state on each click
- Unit test: three clicks return to the original theme
- Manual test: verify icon and tooltip update on each click in both themes

**Priority:** Must
**Story Points:** 1
**Task ref:** T-R03

---

### Story US-3.2
**As a night-session builder (P-3),** I want my theme preference to be remembered across visits so that I do not need to switch to dark mode every time I open the app.

**Acceptance Criteria:**
- [ ] When the user sets a theme via `ThemeToggle`, the preference is stored in `localStorage` under the key `optcg-theme`
- [ ] On the next page load, the stored theme is applied before React renders (via the inline `<head>` script)
- [ ] If the stored value is `"system"`, the OS preference is resolved and applied
- [ ] Clearing localStorage resets to system preference on next load

**Definition of Done:**
- `useTheme` hook writes to `localStorage` on `setTheme()`
- Manual test: set dark mode, close tab, reopen — dark mode active immediately
- Unit test: `setTheme('dark')` writes `'dark'` to localStorage mock

**Priority:** Must
**Story Points:** 2
**Task ref:** T-R02

---

### Story US-3.3
**As a night-session builder (P-3),** I want all components to display correctly in dark mode so that the visual quality is consistent with the existing dark-only experience.

**Acceptance Criteria:**
- [ ] All 17 component files have their hardcoded dark classes replaced with semantic token classes per blueprint section 3
- [ ] Zero remaining references to `text-white`, `bg-optcg-navy` (as page/section bg), or `bg-optcg-navy-light` (as input/card bg) in component files
- [ ] Card art panel in `CardDetailModal` remains dark (`bg-black/20`) regardless of theme
- [ ] OPTCG color indicators (red/blue/green/yellow/purple/black) are unchanged in both themes
- [ ] Type badges (Leader=gold, Character=blue, Event=purple, Stage=green) maintain correct contrast in both themes
- [ ] Manual visual inspection of every component in dark mode confirms no regression from the current design

**Definition of Done:**
- Grep for hardcoded dark classes across all component files returns 0 matches (excluding explicitly theme-invariant usages documented in blueprint)
- QA visual check of dark mode vs. current screenshots passes

**Priority:** Must
**Story Points:** 5
**Task ref:** T-R08

---

### Story US-3.4
**As a casual fan (P-2),** I want all text to be clearly readable in light mode so that I can use the app outdoors or in a bright room.

**Acceptance Criteria:**
- [ ] Body text in light mode (`#1A1A2E` on `#FAFAFA`) achieves a minimum 4.5:1 contrast ratio (WCAG AA)
- [ ] All interactive labels (filter names, card type chips, result count) meet 4.5:1
- [ ] OPTCG Yellow color chip has a visible border in light mode to compensate for low color contrast
- [ ] Card name text on card thumbnails in light mode is clearly legible

**Definition of Done:**
- Colour contrast audit using browser devtools confirms AA compliance for all primary and secondary text
- Yellow chip border (`border border-black/20`) implemented and verified

**Priority:** Must
**Story Points:** 1 (included in T-R08 audit)
**Task ref:** T-R08

---

## Epic E-4: Shareable and Bookmarkable URLs

### Story US-4.1
**As a competitive player (P-1),** I want to bookmark a search URL like `/search?q=Luffy&color=Red` and open it later to get the exact same results so that I can save and share specific searches.

**Acceptance Criteria:**
- [ ] Navigating to `/search?q=Luffy&color=Red` loads `SearchPage` and immediately shows Red cards matching "Luffy"
- [ ] The `useCardUrlSync` hook reads all supported URL params (`q`, `color`, `type`, `set`, `cost_min`, `cost_max`, `view`) on mount and applies them to the store
- [ ] Changing a filter updates the URL in place (replaceState) without triggering a navigation
- [ ] The URL is shareable: a second user opening the same URL in a fresh browser session sees the same results
- [ ] The theme preference is NOT encoded in the URL (it is personal and stored in localStorage)

**Definition of Done:**
- Integration test: navigate to `/search?q=Luffy&color=Red`, verify `useCardStore.query === 'Luffy'` and `useCardStore.colorFilter === 'Red'`
- Manual test: copy URL, open in incognito, verify same results
- `useCardUrlSync` hook is unchanged (no modifications required per blueprint)

**Priority:** Must
**Story Points:** 1 (useCardUrlSync unchanged — verification only)
**Task ref:** T-R10

---

### Story US-4.2
**As a competitive player (P-1),** I want `/cards?q=Luffy` (old URL format) to redirect to `/search` so that old bookmarks still work.

**Acceptance Criteria:**
- [ ] Navigating to `/cards` redirects the browser to `/search`
- [ ] The redirect uses `replace` so the `/cards` entry is removed from browser history
- [ ] A toast or visual notification is NOT shown for this redirect — it should be transparent

**Definition of Done:**
- `App.tsx` contains `<Route path="/cards" element={<Navigate to="/search" replace />} />`
- Manual test: type `/cards` in address bar, verify redirect to `/search`

**Priority:** Should
**Story Points:** 0.5
**Task ref:** T-R05

---

## Epic E-5: Navigation and Wayfinding

### Story US-5.1
**As any user,** I want to navigate back to the landing page from the search results page so that I can start a new search from a clean state.

**Acceptance Criteria:**
- [ ] The OPTCG logo in the `SearchPage` sticky header is a link (or button) that navigates to `/`
- [ ] On mobile, a left-arrow back icon is also present in the sticky header linking to `/`
- [ ] Navigating to `/` shows the landing page with an empty search bar
- [ ] The browser back button from `/search` navigates to `/` if the user arrived there from the landing page

**Definition of Done:**
- Logo in `SearchPage` header wrapped in `<Link to="/">` or uses `useNavigate`
- Mobile back button visible at xs breakpoint
- Manual test: search from landing, land on results, click logo, verify landing page with empty search

**Priority:** Must
**Story Points:** 1
**Task ref:** T-R07

---

### Story US-5.2
**As any user,** I want unknown URLs (e.g., `/about`, `/xyz`) to redirect to the landing page so that I am never left on a blank 404 screen.

**Acceptance Criteria:**
- [ ] Any path not matching `/`, `/search`, or `/cards` redirects to `/`
- [ ] The redirect uses `replace` (no extra browser history entry)
- [ ] No 404 error page or blank page is ever shown

**Definition of Done:**
- `App.tsx` contains `<Route path="*" element={<Navigate to="/" replace />} />`
- Manual test: navigate to `/nonexistent`, verify redirect to `/`

**Priority:** Should
**Story Points:** 0.5
**Task ref:** T-R05

---

## Story Map Summary

| Story | Epic | Persona | Priority | SP | Task |
|-------|------|---------|----------|----|------|
| US-1.1 Landing page with search bar | E-1 | P-2 | Must | 3 | T-R04 |
| US-1.2 Dark mode no flash on load | E-1 | P-3 | Must | 1 | T-R09 |
| US-2.1 Search from landing navigates to results | E-2 | P-1 | Must | 2 | T-R04, T-R05 |
| US-2.2 Result count in toolbar | E-2 | P-2 | Must | 1 | T-R08 |
| US-2.3 Skeleton loading state | E-2 | Any | Must | 1 | T-R07, T-R08 |
| US-3.1 Theme toggle on both pages | E-3 | Any | Must | 1 | T-R03 |
| US-3.2 Theme preference persists across visits | E-3 | P-3 | Must | 2 | T-R02 |
| US-3.3 Dark mode visual quality maintained | E-3 | P-3 | Must | 5 | T-R08 |
| US-3.4 Light mode readable contrast | E-3 | P-2 | Must | 1 | T-R08 |
| US-4.1 Bookmarkable search URL | E-4 | P-1 | Must | 1 | T-R10 |
| US-4.2 /cards redirect to /search | E-4 | P-1 | Should | 0.5 | T-R05 |
| US-5.1 Navigate back to landing | E-5 | Any | Must | 1 | T-R07 |
| US-5.2 Catch-all redirect to landing | E-5 | Any | Should | 0.5 | T-R05 |

**Total estimated SP:** 19.5

---

## Definition of Done (Project-Wide)

All of the following must be true before any story is considered complete:

- [ ] Implementation matches the blueprint and wireframes
- [ ] Component renders correctly in both light and dark mode (manual visual check)
- [ ] All new or modified components have semantic token classes (no hardcoded dark palette classes)
- [ ] Keyboard navigation works for all interactive elements
- [ ] `aria-label` and semantic HTML present for screen reader support
- [ ] Unit tests pass (`vitest run` with zero failures)
- [ ] No broken imports referencing the old `CardSearchPage` name
- [ ] Tailwind build produces no errors or unresolved variable warnings
