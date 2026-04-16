# User Stories: Task Detail Panel — Desktop Modal + Mobile Slider

**Feature:** task-detail-panel-modal  
**Version:** 1.0.0  
**Date:** 2026-04-16

---

## Epics

### Epic 1: Desktop Modal Layout
Rediseño del panel de detalle para mostrar como modal centrado en viewports ≥768px.

#### Story 1.1: Render Desktop Modal Centrado
**As a** developer working on a 27" monitor  
**I want** the task detail panel to render as a centered modal on desktop (≥768px)  
**So that** I have a focused, distraction-free view with ample room for comments and metadata

**Acceptance Criteria:**
- Modal renders at `max-width: 800px` centered on the viewport
- Backdrop is `bg-black/35` with click-to-close functionality
- Modal has proper z-index (`z-[110]`) above other UI elements
- Close button visible in top-right corner (icon: `close`)
- Focus trap active (keyboard navigation confined to modal)
- Escape key closes the modal without propagating

**Definition of Done:**
- Component renders correctly in viewport 768px+
- CSS Grid layout 2-column (55% content, 45% comments) is pixel-perfect
- Tested at 768px, 1024px, 1440px breakpoints
- Keyboard accessibility verified (Tab, Escape)
- No regressions in mobile (<768px) behavior

**Priority:** Must  
**Story Points:** 5

---

#### Story 1.2: Two-Column Layout with Independent Scroll
**As a** user reviewing task details with many comments  
**I want** the content column and comments column to scroll independently  
**So that** I can read the task description while viewing older comments

**Acceptance Criteria:**
- Left column (content): title, type, assigned, description, pipeline, attachments
- Right column (comments): 45% width, independent `overflow-y: auto`
- Both columns visible simultaneously on 1024px+ viewports
- On 768px-1023px: layout switches to full-width stacked (comment section below)
- No visual overflow or text wrapping issues

**Definition of Done:**
- Scroll behavior tested on Chrome, Firefox, Safari
- Layout adaptation verified at 768px breakpoint
- No performance issues with long comment threads

**Priority:** Should  
**Story Points:** 3

---

### Epic 2: Mobile Slider Behavior
Mantener el comportamiento de slider en viewports <768px con animaciones suave.

#### Story 2.1: Mobile Slider Maintains Current Behavior
**As a** mobile user  
**I want** the task detail panel to slide in from the right as before  
**So that** the UX remains consistent on phone and tablet

**Acceptance Criteria:**
- Slider position: `fixed inset-y-0 right-0` (full height, aligned right)
- Animation: slide in from right (`animate-slide-in-right`)
- Width: 100% on 320px viewports (full screen)
- Backdrop click closes slider
- Escape key closes slider without propagating
- Content scrolls vertically as a single column

**Definition of Done:**
- Mobile layout tested at 320px, 480px, 600px viewports
- Animation performance smooth (60fps) on iOS/Android
- Touch interactions responsive

**Priority:** Must  
**Story Points:** 3

---

#### Story 2.2: Responsive Breakpoint Transition
**As a** a user resizing the browser from mobile to desktop  
**I want** the panel to transition smoothly from slider to modal  
**So that** the experience feels responsive and intentional

**Acceptance Criteria:**
- At 768px exactly, panel transitions from slider to modal
- No layout jank or visual artifacts during resize
- State is preserved during transition (field values, scroll position)
- Backdrop behavior changes (click closes on both, but styling differs)

**Definition of Done:**
- Chrome DevTools responsive mode tested
- Window resize event triggers layout update correctly
- No field data loss during transition

**Priority:** Should  
**Story Points:** 2

---

### Epic 3: Comments Section Integration
Renderizar hilo de comentarios con threading, tipos y resolución.

#### Story 3.1: Render Comments with Threading
**As a** user managing task workflow  
**I want** to see questions, answers, and notes with proper visual hierarchy  
**So that** I understand the context and decisions made

**Acceptance Criteria:**
- Questions display with 🟠 Amber badge (`#FFB000`)
- Answers display with 🟢 Green badge and indentation (16px left margin, 3px left border)
- Notes display with ⚪ Gray badge (`#A1A1A6`)
- Parent-child relationship is clear (visual indentation + color)
- Resolved questions show checkmark + "Marked as resolved" label
- Threading max 2 levels: question → answer only (no nested answers)

**Definition of Done:**
- All comment types render with correct colors and styling
- Contrast verified: ≥4.5:1 against dark background (WCAG AA)
- Threading visually distinct (not relying on color alone)
- Resolved status visible without screen reader

**Priority:** Must  
**Story Points:** 5

---

#### Story 3.2: Create and Respond to Comments
**As a** user collaborating on a task  
**I want** to create new comments, mark questions as resolved, and edit/delete my own comments  
**So that** I can actively participate in task workflow

**Acceptance Criteria:**
- "Add comment" button visible when no focus
- Click shows dropdown: "Note", "Question", "Answer"
- Textarea appears with max 5000 chars, character counter
- Submit button disabled until text provided
- For "Answer": parent question automatically selected (focus)
- Mark as resolved: click checkmark badge → PATCH endpoint → visual confirmation
- Edit/Delete buttons appear on hover (author-only)
- Optimistic UI: comment appears immediately, sync in background
- Toast shows success/error after API response

**Definition of Done:**
- All CRUD operations verified with API
- Optimistic UI tested (comment appears before server response)
- Error handling: show toast + retry button on failure
- Mobile: textarea expands on focus (no layout shift)

**Priority:** Must  
**Story Points:** 8

---

#### Story 3.3: Comment Timestamps and Author Attribution
**As a** user reviewing task history  
**I want** to see who said what and when  
**So that** I can understand the chronology and responsibility

**Acceptance Criteria:**
- Each comment shows: `Author · Deterministic timestamp (e.g., "Mar 16, 14:32")`
- Timestamps are absolute (not relative), consistent with task timestamps
- Author attribution: agent name or user name (max 100 chars)
- Timestamps rendered below comment text, muted color
- No relative time ("2 hours ago") — absolute only

**Definition of Done:**
- Timestamps formatted consistently across all comments
- Timestamps match task `createdAt` / `updatedAt` format
- Mobile layout: timestamp stacks below author without truncation

**Priority:** Should  
**Story Points:** 2

---

### Epic 4: Responsive Design and Accessibility
Asegurar que el panel funciona en todos los tamaños y cumple con WCAG 2.1 AA.

#### Story 4.1: Keyboard Navigation and Focus Management
**As a** keyboard-only user  
**I want** to navigate the modal using Tab, Shift+Tab, and Escape  
**So that** I can use the panel without a mouse

**Acceptance Criteria:**
- Focus trap active: Tab cycles through focusable elements within modal
- Escape closes modal and returns focus to trigger (card that opened it)
- No focus escape outside modal while open
- All interactive elements (inputs, buttons, comment actions) are focusable
- Focus indicator visible (browser default or custom outline)
- Read order matches visual order (no hidden elements in DOM)

**Definition of Done:**
- Keyboard-only test: open modal, navigate, close
- Focus ring visible on all focus states
- Screen reader test: elements announced in correct order

**Priority:** Must  
**Story Points:** 3

---

#### Story 4.2: Color Contrast and Visual Accessibility
**As a** a user with color blindness  
**I want** comment types to be distinguishable without relying only on color  
**So that** I can understand the comment hierarchy

**Acceptance Criteria:**
- Comment type (question/answer/note) distinguished by: badge text + icon + color + border
- Contrast ratios: question 7.2:1+, answer 8.1:1+, note 4.8:1+ (WCAG AA minimum 4.5:1)
- Threading: indentation (16px) + left border (3px color-coded) — not color alone
- Modal backdrop: sufficient contrast with background
- Text in modal readable against surface color

**Definition of Done:**
- Contrast ratios verified with aXe or manual testing
- Color blindness simulator test (Coblis)
- No criticial color-only distinctions

**Priority:** Must  
**Story Points:** 2

---

#### Story 4.3: Mobile-First Touch Interactions
**As a** mobile user  
**I want** buttons and interactive elements to be at least 44x44px  
**So that** I can tap accurately without missing

**Acceptance Criteria:**
- All buttons: minimum 44px × 44px touch target
- Form inputs: sufficient padding for easy interaction
- Close button easily reachable (no tiny icon)
- Comments list: swipe-to-action or clear delete intent (confirmation)
- No hover-only functionality (mobile has no hover)

**Definition of Done:**
- Touch target sizes verified in DevTools
- Mobile testing on real device (iPhone, Android)
- No accidental taps on adjacent elements

**Priority:** Should  
**Story Points:** 3

---

### Epic 5: Performance and Animation
Asegurar que las transiciones sean suaves y no bloqueen la UI.

#### Story 5.1: Smooth Animation: Slide-In (Mobile) and Fade-In (Desktop)
**As a** user opening a task  
**I want** smooth, non-janky animations  
**So that** the interface feels responsive and polished

**Acceptance Criteria:**
- Mobile: slide-in from right 300ms easing
- Desktop: modal fade-in + scale 200ms easing
- No layout shift during animation
- Animation runs at 60fps (verified in DevTools)
- Animation can be disabled (prefers-reduced-motion)
- Close animation: reverse of open (slide-out or fade-out)

**Definition of Done:**
- Animation performance tested with DevTools Performance tab
- `prefers-reduced-motion` CSS rule applied
- No jank on older devices (tested on mid-range phone)

**Priority:** Should  
**Story Points:** 3

---

#### Story 5.2: Optimistic UI: Comment Creation
**As a** user posting a comment  
**I want** the comment to appear immediately (optimistic UI)  
**So that** I don't wait for server response

**Acceptance Criteria:**
- Comment appears in the list before API response
- Loading state: spinner on submit button during POST
- If API fails: comment shows error badge, retry option
- Success: remove loading state, confirm with toast
- Undo not available (comment already created serverside)

**Definition of Done:**
- Optimistic UI tested on slow network (DevTools throttling)
- Error handling: show toast, retry button functional
- Successful creation: proper confirmation

**Priority:** Should  
**Story Points:** 3

---

### Epic 6: Component Reuse
Reutilizar componentes existentes (Modal, Button, Badge, Toast).

#### Story 6.1: Use Shared Modal Component
**As a** developer  
**I want** to reuse the existing `Modal` component from `frontend/src/components/shared/`  
**So that** I maintain consistency and reduce code duplication

**Acceptance Criteria:**
- `<Modal>` wraps the task detail content
- Props: `isOpen`, `onClose`, `children`, `title` (optional)
- Modal handles: backdrop, Escape key, focus trap, z-index
- No custom modal logic required
- Fallback: if Modal doesn't exist, create minimal wrapper

**Definition of Done:**
- Modal component exists and is used
- No duplicate modal CSS or logic
- All Modal props working as documented

**Priority:** Must  
**Story Points:** 2

---

#### Story 6.2: Reuse Shared UI Components
**As a** developer  
**I want** to use existing Button, Badge, Toast components  
**So that** styling and behavior remain consistent

**Acceptance Criteria:**
- `<Button variant="primary|secondary|danger|ghost">` for all actions
- `<Badge type="task|research|done|pending">` for comment/task status
- `useAppStore().showToast(msg, 'success'|'error')` for feedback
- No custom button or badge CSS
- ContextMenu for comment actions (edit/delete)

**Definition of Done:**
- All buttons use shared component
- All badges use shared component
- All toasts use AppStore hook
- Visual consistency verified

**Priority:** Must  
**Story Points:** 2

---

## Summary Table

| Epic | Story | Priority | Points | Dependencies |
|------|-------|----------|--------|--------------|
| 1 | 1.1 | Must | 5 | None |
| 1 | 1.2 | Should | 3 | 1.1 |
| 2 | 2.1 | Must | 3 | None |
| 2 | 2.2 | Should | 2 | 1.1, 2.1 |
| 3 | 3.1 | Must | 5 | None |
| 3 | 3.2 | Must | 8 | 3.1, API ready |
| 3 | 3.3 | Should | 2 | 3.1 |
| 4 | 4.1 | Must | 3 | 1.1, 2.1 |
| 4 | 4.2 | Must | 2 | 3.1 |
| 4 | 4.3 | Should | 3 | 2.1 |
| 5 | 5.1 | Should | 3 | 1.1, 2.1 |
| 5 | 5.2 | Should | 3 | 3.2 |
| 6 | 6.1 | Must | 2 | 1.1 |
| 6 | 6.2 | Must | 2 | 3.1, 3.2 |

**Total Must Points:** 29  
**Total Should Points:** 19  
**Total Story Points:** 48

---

## Release Scope

### Phase 1 (MVP — Sprint 1)
- Epic 1: Desktop Modal Layout (Stories 1.1, 1.2)
- Epic 2: Mobile Slider (Stories 2.1)
- Epic 3: Comments Integration (Stories 3.1, 3.2)
- Epic 4: Accessibility (Stories 4.1, 4.2)
- Epic 6: Component Reuse (Stories 6.1, 6.2)

**Total: 32 points**

### Phase 2 (Polish — Sprint 2)
- Epic 2.2: Responsive Breakpoint Transition
- Epic 3.3: Timestamps
- Epic 4.3: Mobile Touch
- Epic 5: Performance & Animation

**Total: 11 points**

---

## Notes

- **API Dependency:** POST `/api/v1/spaces/{spaceId}/tasks/{taskId}/comments` must be ready before 3.2
- **Styling:** All CSS must use Tailwind and design tokens from `frontend/tailwind.config.js`
- **Testing:** >90% coverage required (unit + integration)
- **Browser Support:** Chrome, Firefox, Safari, Edge (latest versions)
- **Mobile Devices:** iPhone 12+, Android 10+

