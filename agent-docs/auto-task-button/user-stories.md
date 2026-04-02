# User Stories: Auto-task Button (FAB)

## Personas

**Primary persona — Oscar (solo developer / Kanban user)**
- Single user of a local Kanban board
- Manages 4 AI agents as tasks
- Wants to generate batches of tasks from a text description without typing each card manually
- Values speed and a distraction-free dark UI

---

## Epic 1: Floating Action Button — Discovery and Access

### Story 1.1
**As a Kanban user, I want to see a clearly identifiable AI entry point on the board so that I can discover the auto-task feature without reading documentation.**

**Acceptance Criteria:**
- [ ] A pill-shaped FAB is visible in the bottom-right corner of the board at all times
- [ ] The FAB displays a sparkle icon ("auto_awesome" Material Symbol) and the label "Auto-task"
- [ ] The FAB is always visible regardless of board scroll position (fixed positioning)
- [ ] The FAB renders above all task cards (z-index above columns)
- [ ] The FAB is visible on first load with no user interaction required
- [ ] On screens narrower than 600px the label is hidden but the icon remains (48x48px circle)

**Definition of Done:**
- FAB component exists at `frontend/src/components/AutoTaskFAB.tsx`
- FAB is rendered in the board layout, not inside a column
- Visual: gradient border animation is visible and cycles purple→blue→cyan
- Animation pauses when `prefers-reduced-motion: reduce` is active
- Manual test: visible at 320px, 768px, 1280px viewport widths

**Priority:** Must
**Story Points:** 3

---

### Story 1.2
**As a Kanban user, I want the FAB to provide clear hover and focus feedback so that I understand it is interactive before clicking it.**

**Acceptance Criteria:**
- [ ] On hover: scale increases to 1.04, glow intensifies, gradient rotation speeds up to 2s
- [ ] On focus (keyboard Tab): a 2px blue focus ring appears around the FAB
- [ ] On press: scale briefly drops to 0.97 before releasing
- [ ] hover/focus states are visually distinct from the resting state
- [ ] Hover animations use spring easing (cubic-bezier(0.34, 1.56, 0.64, 1))
- [ ] Pressed feedback occurs within 100ms of click/tap

**Definition of Done:**
- Hover, focus, and active CSS states implemented
- No layout shift from hover scale — transform only, not width/height
- Tested with keyboard-only navigation (Tab to FAB, Enter to activate)

**Priority:** Must
**Story Points:** 2

---

## Epic 2: Auto-task Modal — Input and Generation

### Story 2.1
**As a Kanban user, I want to click the FAB and immediately see a modal where I can describe the tasks I need so that I can start the generation flow without navigating to a different page.**

**Acceptance Criteria:**
- [ ] Clicking the FAB opens a modal dialog centered on screen
- [ ] Modal animation: scale-in 280ms spring easing on open, modal-out 180ms on close
- [ ] Modal title is "Auto-task" with the sparkle icon
- [ ] A textarea is present with focus automatically set on open
- [ ] Placeholder text gives a concrete example: "e.g. Build a user authentication system with login, register and password reset."
- [ ] The board is dimmed by a scrim (rgba(0,0,0,0.50)) while modal is open
- [ ] The FAB is still visible behind the scrim

**Definition of Done:**
- Uses existing `<Modal>` shared component from `frontend/src/components/shared/`
- focus-trap is active (Tab cycles within modal)
- Modal opens within 300ms of FAB click
- Textarea autofocused on open (React `autoFocus` prop or `useEffect` ref focus)

**Priority:** Must
**Story Points:** 3

---

### Story 2.2
**As a Kanban user, I want to select which space and column the generated tasks should land in so that tasks are organized correctly without manual drag-and-drop after generation.**

**Acceptance Criteria:**
- [ ] The modal shows a "Space" selector pre-filled with the currently active space
- [ ] The modal shows a "Column" selector defaulting to "Todo"
- [ ] Both selectors are keyboard-navigable
- [ ] Changing the Space selector updates the Column selector to show columns of the selected space
- [ ] The selected space/column is included in the generation request

**Definition of Done:**
- Selectors render as native `<select>` elements or custom listbox with role="listbox"
- Default values are derived from current board state (active space, "todo" column)
- Selection state is passed to the generation handler

**Priority:** Must
**Story Points:** 2

---

### Story 2.3
**As a Kanban user, I want to click "Generate tasks" and see the AI creating tasks in real-time so that I have confidence the request is being processed.**

**Acceptance Criteria:**
- [ ] Clicking "Generate tasks" disables the button and shows "Generating..." label with a spinner
- [ ] The textarea is disabled during generation to prevent modification mid-request
- [ ] The button cannot be double-clicked (disabled during async operation)
- [ ] If generation succeeds: modal closes, green toast "N tasks created" appears for 3 seconds
- [ ] If generation fails: modal stays open, error message appears below textarea, button changes to "Try again"

**Definition of Done:**
- Button uses `<Button variant="primary">` shared component
- Loading state implemented with `disabled` prop and spinner icon
- Toast uses `useAppStore.getState().showToast(message, 'success' | 'error')`
- Error message has `role="alert"` for screen reader announcement
- `aria-busy="true"` on form during loading

**Priority:** Must
**Story Points:** 3

---

### Story 2.4
**As a Kanban user, I want to dismiss the modal at any point so that I can return to the board without generating tasks.**

**Acceptance Criteria:**
- [ ] The modal has an X close button in the top-right corner
- [ ] Pressing Escape dismisses the modal
- [ ] Clicking the backdrop (scrim) dismisses the modal
- [ ] No confirmation dialog is shown when dismissing with empty textarea
- [ ] If textarea has text: no confirmation required (generation has not started)
- [ ] After dismissal, focus returns to the FAB button

**Definition of Done:**
- All three dismiss mechanisms (X, Escape, backdrop) implemented
- Focus restoration: after close, `document.querySelector('[data-autotask-fab]')?.focus()`
- Uses existing Modal component's escape-key and backdrop-click handling

**Priority:** Must
**Story Points:** 1

---

## Epic 3: Accessibility and Responsiveness

### Story 3.1
**As a user who navigates by keyboard, I want the FAB and modal to be fully operable without a mouse so that I can use the feature without a pointing device.**

**Acceptance Criteria:**
- [ ] FAB is reachable via Tab key navigation
- [ ] FAB is activatable via Enter or Space key
- [ ] All modal interactive elements (textarea, selectors, buttons, close) are Tab-reachable
- [ ] Tab order inside modal is logical: textarea → Space selector → Column selector → Generate button → Close button
- [ ] Focus is trapped inside modal while it is open
- [ ] After modal close, focus returns to the FAB

**Definition of Done:**
- Manual keyboard-only test passes end-to-end
- Focus trap verified: Tab from last element wraps to first (textarea)

**Priority:** Must
**Story Points:** 2

---

### Story 3.2
**As a user on a small mobile screen, I want the auto-task flow to be usable on a 320px wide viewport so that the feature works on any device.**

**Acceptance Criteria:**
- [ ] At 320px: FAB shows icon only (48x48px circle), label hidden with `sr-only`
- [ ] At 320px: modal occupies full screen (position fixed, inset 0, border-radius top corners only)
- [ ] At 320px: textarea is usable, keyboard does not obscure "Generate tasks" button
- [ ] At 600px+: FAB shows icon + label (pill shape)
- [ ] At 600px+: modal is centered dialog, max-width 520px

**Definition of Done:**
- Tested at 320px, 390px (iPhone 14), 768px (tablet), 1280px (desktop) viewport widths
- No horizontal scroll introduced by FAB or modal at any breakpoint
- FAB bottom position uses `.bottom-safe-6` utility (safe-area-inset-bottom aware)

**Priority:** Must
**Story Points:** 2

---

### Story 3.3
**As a user with motion sensitivity, I want the FAB gradient animation to stop when I have reduced-motion preferences enabled so that the interface does not trigger discomfort.**

**Acceptance Criteria:**
- [ ] When `prefers-reduced-motion: reduce` is active, the gradient border rotation is paused
- [ ] The gradient border remains visible (static gradient) — it does not disappear
- [ ] All scale animations (hover, press, modal open/close) are collapsed to near-instant (0.01ms per global rule in index.css)
- [ ] The feature remains fully functional with motion disabled

**Definition of Done:**
- CSS `@media (prefers-reduced-motion: reduce)` rule applies `animation-play-state: paused` to the FAB border animation
- Global reduced-motion rule in index.css already covers transition-duration — no additional work needed
- Test: enable "Reduce motion" in OS settings, verify FAB gradient is static

**Priority:** Must
**Story Points:** 1

---

## Summary Table

| Story | Epic | Priority | Points |
|-------|------|----------|--------|
| 1.1 FAB visible on board | Discovery | Must | 3 |
| 1.2 FAB hover/focus feedback | Discovery | Must | 2 |
| 2.1 Modal opens on click | Generation | Must | 3 |
| 2.2 Space/Column selectors | Generation | Must | 2 |
| 2.3 Generate button + states | Generation | Must | 3 |
| 2.4 Modal dismiss | Generation | Must | 1 |
| 3.1 Keyboard navigation | Accessibility | Must | 2 |
| 3.2 Mobile responsiveness | Responsiveness | Must | 2 |
| 3.3 Reduced motion | Accessibility | Must | 1 |
| **Total** | | | **19** |

---

## Assumptions

| ID | Assumption | Impact if wrong |
|----|------------|-----------------|
| A-1 | Generation is triggered by calling existing tagger/AI infrastructure already in the server | If no backend endpoint exists, developer must create POST /api/v1/tasks/generate |
| A-2 | The modal resets its textarea content each time it is opened | If persistence is desired, add local state between open/close cycles |
| A-3 | The "AI-powered by Claude" attribution refers to the TAGGER_CLI configured in server (default: `claude`) | If attribution should be dynamic, read config from GET /api/v1/config |
| A-4 | No minimum character count is required in the textarea | If minimum required, add inline validation on submit |
| A-5 | Generated tasks always go into the "todo" JSON file of the selected space (existing structure) | If a different column is possible, ensure all column identifiers (todo, in-progress, done) are valid |
