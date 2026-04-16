# Wireframes — Stitch Designs: Task Detail Panel Modal

**Project:** Prism Kanban  
**Feature:** task-detail-panel-modal  
**Stitch Project ID:** `15790477920468951127`  
**Date:** 2026-04-16

---

## Screen References

### Existing Stitch Screens (Close to Final Design)

The following Stitch screens in the project serve as visual references for the task-detail-panel-modal redesign:

#### 1. Desktop Modal with Comments
**Screen Title:** "Task Detail Modal - Comments"  
**Device:** Desktop (2560×2048px)  
**Purpose:** Shows centered modal layout with comment sidebar (45% width, independent scroll)  
**Key Elements:**
- Modal positioned center with `max-width: 800px`
- 2-column grid: content left (55%), comments right (45%)
- Comment threading: amber questions, green answers, gray notes
- Timestamps and author attribution visible
- "Mark as resolved" button on questions

**Note:** This screen closely matches the desktop design in `wireframes.md`. Use as reference for color palette and component placement.

---

#### 2. Task Detail - Comments Section
**Screen Title:** "Task Detail - Comments Section"  
**Device:** Desktop (2560×2048px)  
**Purpose:** Detailed view of comment threading with all interaction states  
**Key Elements:**
- Question card with amber badge (#FFB000)
- Indented answer cards with green badge (#30D158)
- Note card with gray badge (#A1A1A6)
- Edit/Delete buttons on hover (author-only)
- "Add comment" form with type selector dropdown
- "Mark as resolved" checkmark

**Note:** Reference for comment card styling and threading indentation (16px left margin + 3px color border).

---

#### 3. Kanban Board with Task Detail Panel
**Screen Title:** "Kanban Board with Task Detail Panel"  
**Device:** Desktop (2560×2048px)  
**Purpose:** Shows modal overlaying the main board, confirming breakpoint behavior  
**Key Elements:**
- Board visible behind modal (backdrop at z-105)
- Modal at z-110, centered
- Focus trap active (board cards not focusable)
- Backdrop click closes modal

**Note:** Reference for z-index stacking and modal positioning.

---

#### 4. Mobile Kanban Board (Slider Reference)
**Screen Title:** "Prism Kanban Mobile"  
**Device:** Mobile (796×1768px)  
**Purpose:** Shows mobile layout with slider panel from right  
**Key Elements:**
- Panel slides in from right edge (100% viewport width <768px)
- Full-height vertical scroll
- Content stacks single-column (title, type, assigned, description, pipeline, comments)
- Close button top-right

**Note:** Reference for mobile slider behavior (<768px breakpoint). Current design maintains this behavior.

---

## Design Specifications by Screen

### Screen 1: Desktop Modal (≥768px)

**Layout:**
```
┌─ Backdrop (bg-black/35, z-105) ───────────────────┐
│ ┌─ Modal (bg-surface, z-110, max-w-800px) ───────┐│
│ │ ┌─────────────────────────────────────────────┐ ││
│ │ │ Header: [X Close] #id [Status Badge]        │ ││
│ │ ├─────────────────────────────────────────────┤ ││
│ │ │                                             │ ││
│ │ │ Left Column (55%)    │    Right Column (45%)│ ││
│ │ │ ─────────────────────┼──────────────────────│ ││
│ │ │ [Title]             │    [Comments]         │ ││
│ │ │ [Type selector]     │    ┌─────────────────┤ ││
│ │ │ [Assigned]          │    │ Q: "Did we..."  │ ││
│ │ │ [Description]       │    │ └─ ✓ Resolved   │ ││
│ │ │ [Pipeline]          │    │                 │ ││
│ │ │ [Attachments]       │    │ N: "Update docs"│ ││
│ │ │                     │    │                 │ ││
│ │ │ Footer: Timestamps  │    │ [+ Add comment] │ ││
│ │ │                     │    └─────────────────┤ ││
│ │ └─────────────────────────────────────────────┘ ││
│ └─────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────┘
```

**Breakpoint:** 768px–1024px  
- Modal width: 600px
- 2-column layout with reduced padding

**Breakpoint:** 1025px+  
- Modal width: 800px
- Optimal 2-column layout
- Generous spacing

---

### Screen 2: Mobile Slider (<768px)

**Layout:**
```
┌──────────────────────┐
│   [Board Columns]    │
│                      │    ┌─────────────────────┐
│ [Card] [Card]...     │    │ [X Close]  #id [⋮]  │
│                      │    ├─────────────────────┤
│                      │    │ Title               │
│                      │    │ [Title input]       │
│                      │    │                     │
│                      │    │ Type                │
│                      │    │ [Type selector]     │
│                      │    │                     │
│                      │    │ Assigned            │
│                      │    │ [Assigned input]    │
│                      │    │                     │
│                      │    │ Description         │
│                      │    │ [Large textarea]    │
│                      │    │                     │
│                      │    │ Comments            │
│                      │    │ [Q: Did we...]      │
│                      │    │ [N: Update docs]    │
│                      │    │                     │
│                      │    │ [+ Add comment]     │
│                      │    │                     │
│                      │    │ Created: Mar 16...  │
│                      └─────────────────────────┘
└──────────────────────┘
```

**Breakpoint:** <768px  
- Full viewport width (100%)
- Single scrollable column
- All content stacks vertically
- Animation: slide-in from right (300ms ease)

---

## Color Palette (Dark Theme)

| Element | Color | Usage |
|---------|-------|-------|
| Modal Surface | `#111827` | Background of modal |
| Text Primary | `#F3F4F6` | Titles, labels |
| Text Secondary | `#9CA3AF` | Descriptions, metadata |
| Border | `#374151` | Input borders, dividers |
| Primary Accent | `#0A84FF` | Buttons, active states |
| Question Badge | `#FFB000` (Amber) | Question comments |
| Answer Badge | `#30D158` (Green) | Answer comments |
| Note Badge | `#A1A1A6` (Gray) | Note comments |
| Backdrop | `#000000 @ 35%` | Modal overlay |

---

## Typography

| Element | Font | Size | Weight | Line-Height |
|---------|------|------|--------|-------------|
| Modal Title | Inter | 20px | 600 | 1.4 |
| Field Label | Inter | 12px | 500 | 1.2 |
| Body Text | Inter | 14px | 400 | 1.6 |
| Comment Author | Inter | 12px | 500 | 1.2 |
| Timestamp | Inter | 11px | 400 | 1.4 |

---

## Spacing & Sizing

| Element | Value |
|---------|-------|
| Modal padding | 24px |
| Column gap (desktop) | 24px |
| Input padding | 12px |
| Border radius (inputs) | 8px |
| Border radius (modal) | 0px (sharp corners) |
| Touch target min | 44px × 44px |
| Indentation (answer) | 16px |
| Border (threading) | 3px left, color-coded |

---

## Animation & Interaction

### Desktop Modal
- **Open:** Fade-in 200ms (easing: ease-out)
- **Close:** Fade-out 150ms
- **Comment add:** Optimistic UI, appears immediately

### Mobile Slider
- **Open:** Slide-in from right 300ms (easing: ease-out)
- **Close:** Slide-out to right 200ms
- **Comment add:** Optimistic UI, appears immediately

### States
- **Default:** All fields visible, editable
- **Loading:** Fields opacity-50, buttons disabled with spinner
- **Error:** Red banner with retry button
- **Resolved comment:** Checkmark + "Marked as resolved" text

---

## Accessibility

| Criterion | Implementation |
|-----------|-----------------|
| Focus Trap | Focus confined to modal; Tab cycles within modal |
| Escape Key | Close modal, return focus to trigger |
| Contrast | Text: ≥4.5:1; Comment colors: ≥4.8:1 |
| Color Independence | Threading via indentation + border, not color alone |
| Keyboard Nav | All interactive elements focusable; logical tab order |
| ARIA Labels | `role="dialog"`, `aria-modal="true"`, `aria-label` on sections |
| Screen Readers | Comment type announced via text + icon, not color alone |

---

## Implementation Notes

### Component Hierarchy
```
TaskDetailPanel
├── Modal (shared component)
│   ├── Header (close button, status badge, ID)
│   ├── Content (desktop: 2-col grid | mobile: single col)
│   │   ├── LeftColumn (55% desktop)
│   │   │   ├── Title Input
│   │   │   ├── Type Selector
│   │   │   ├── Assigned Input
│   │   │   ├── Description Textarea
│   │   │   ├── Pipeline Editor
│   │   │   ├── Attachments List
│   │   │   └── Timestamps
│   │   └── RightColumn / Comments (100% mobile, 45% desktop)
│   │       ├── CommentsSection
│   │       │   ├── CommentCard (per comment)
│   │       │   │   ├── CommentBadge
│   │       │   │   ├── CommentContent
│   │       │   │   └── CommentActions
│   │       │   └── CommentForm
│   │       └── ScrollContainer (independent on desktop)
│   └── Footer (timestamps, optional)
```

### CSS Classes (Tailwind)
- Modal: `fixed inset-0 z-110 flex items-center justify-center`
- Backdrop: `bg-black/35 absolute inset-0 z-105`
- Modal Body: `bg-surface rounded-0 max-w-800px p-6`
- 2-Col Grid (desktop): `grid grid-cols-[1fr_1fr] gap-6 md:hidden lg:grid`
- Single Col (mobile): `flex flex-col gap-6 md:flex lg:hidden`
- Comments Sidebar (desktop): `overflow-y-auto max-h-[calc(100vh-200px)]`

### Responsive Breakpoints
- **320px–767px:** Mobile slider (100% width, slide-in right)
- **768px–1023px:** Desktop modal, 600px width, 2-col if space
- **1024px+:** Desktop modal, 800px width, optimal 2-col

---

## Design Tokens from frontend/src/index.css

The implementation must use Tailwind v4 tokens from `@theme` directive:

```css
--color-surface:           #111827 (dark)
--color-text-primary:      #F3F4F6
--color-text-secondary:    #9CA3AF
--color-primary:           #0A84FF
--color-border:            #374151
--color-warning:           #FFB000 (questions)
--color-success:           #30D158 (answers)
```

Map these to Tailwind utilities:
- `bg-surface` → `--color-surface`
- `text-text-primary` → `--color-text-primary`
- `text-text-secondary` → `--color-text-secondary`
- `border-border` → `--color-border`

---

## Next Steps

1. **Designer Review:** Confirm 2-column modal layout on desktop (55/45 split) vs mobile slider
2. **Component Integration:** Implement `<Modal>` wrapper, `<CommentsSection>` responsive behavior
3. **API Integration:** Connect PATCH comment endpoints, POST new comments
4. **Accessibility Testing:** Verify focus trap, keyboard navigation, contrast
5. **Mobile Testing:** Test on real iPhone/Android at 768px breakpoint

---

## Files Referenced

- `wireframes.md` — Detailed design specifications
- `api-spec.json` — Comment CRUD endpoints
- `user-stories.md` — Feature breakdown and acceptance criteria
- `frontend/src/components/shared/Modal.tsx` — Shared modal component
- `frontend/src/components/shared/Button.tsx` — Button component
- `frontend/src/index.css` — Tailwind tokens (dark theme)

