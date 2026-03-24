# User Stories: Task Detail & Edit Side Panel

## Persona

**The Developer (single local user)**
A technical user running Prism on their own machine to coordinate a multi-agent AI pipeline. They navigate the board frequently, reading task context and updating fields as agents complete work or requirements change. They work in short bursts — opening a task, scanning it, making a quick edit, closing it — and do not tolerate losing changes or leaving the board context.

---

## Epics

### Epic 1 — Open and Close the Detail Panel

#### Story 1.1 — Open panel from card title
As a developer, I want to click a task title to open a detail panel, so that I can read the full task content without leaving the board.

**Acceptance Criteria:**
- Clicking the task title in any column opens the TaskDetailPanel for that task
- The board columns remain visible (not hidden or replaced)
- The panel slides in from the right edge within 200ms
- Focus automatically lands on the title input inside the panel
- The task's current field values are pre-populated in the panel

**Definition of Done:**
- Component renders with correct task data from the store
- CSS transition animation is ≤200ms
- Focus management confirmed with keyboard-only navigation test
- No visual regression on the board layout

**Priority:** Must
**Story Points:** 2

---

#### Story 1.2 — Open panel from expand icon
As a developer, I want a dedicated expand icon on each task card, so that I can distinguish the "open detail" action from other card interactions.

**Acceptance Criteria:**
- An expand icon (open_in_full) appears in the top-right area of every task card header
- Clicking the icon opens the same detail panel as clicking the title
- The icon has aria-label="Open task detail"
- The icon has a minimum touch target of 44×44px
- The icon does not interfere with drag-and-drop if it is implemented later

**Definition of Done:**
- Icon renders without breaking existing card layout (badge, description, assigned, timestamps)
- aria-label verified in browser accessibility tree
- No drag event triggered when clicking the icon

**Priority:** Must
**Story Points:** 1

---

#### Story 1.3 — Close panel via close button
As a developer, I want a close button in the panel header, so that I can dismiss the panel with a single click.

**Acceptance Criteria:**
- A × close button appears in the top-right corner of the panel header
- Clicking it closes the panel (slide-out animation ≤200ms)
- Focus returns to the task card title that triggered the open
- aria-label="Close task detail" on the button

**Definition of Done:**
- closeDetailPanel() store action called on click
- Focus return confirmed with keyboard navigation test

**Priority:** Must
**Story Points:** 1

---

#### Story 1.4 — Close panel via Escape key
As a developer, I want pressing Escape to close the detail panel, so that I can return to the board quickly without reaching for the mouse.

**Acceptance Criteria:**
- Pressing Escape anywhere inside the panel closes it
- No Escape event propagates to the board or other components
- Focus returns to the trigger element after close

**Definition of Done:**
- keydown Escape listener added inside the panel, removed on unmount
- e.stopPropagation() confirmed to not break other Escape handlers

**Priority:** Must
**Story Points:** 1

---

#### Story 1.5 — Close panel via backdrop click
As a developer, I want to click outside the panel to dismiss it, so that I can quickly return to the board by clicking anywhere on it.

**Acceptance Criteria:**
- A semi-transparent backdrop overlays the board while the panel is open
- Clicking the backdrop closes the panel
- Clicking inside the panel does not close it
- The backdrop has pointer-events disabled for board interaction (clicking through is NOT required — backdrop click closes panel)

**Definition of Done:**
- onClick on backdrop div calls closeDetailPanel()
- onClick on panel surface uses e.stopPropagation()

**Priority:** Must
**Story Points:** 1

---

### Epic 2 — Edit Task Fields

#### Story 2.1 — Edit title with auto-save
As a developer, I want to edit a task's title directly in the detail panel and have it auto-save on blur, so that I don't need to click a Save button for a simple field change.

**Acceptance Criteria:**
- The title field renders as a text input pre-populated with the current title
- Editing the value and blurring the input triggers store.updateTask({ title }) immediately
- The board card updates in place (optimistic update) without requiring a page reload
- A "Saved" toast appears (green, 3 seconds) on success
- A "Failed to save" toast appears (red, 3 seconds) on network/server error
- If the title after trimming is empty, the save call is NOT made (local validation)
- The input is disabled while a save is in-flight

**Definition of Done:**
- Blur event handler wired to store.updateTask
- Optimistic board update confirmed: card title changes without refresh
- Empty title: no API call fired, input stays on last valid value
- Test: blur with changed value → updateTask called with correct patch

**Priority:** Must
**Story Points:** 2

---

#### Story 2.2 — Change task type with auto-save
As a developer, I want to change a task's type via a segmented control, so that I can reclassify tasks without opening a separate modal.

**Acceptance Criteria:**
- A segmented control with two options ("task" in orange, "research" in blue) shows the current type selected
- Clicking the unselected option immediately triggers store.updateTask({ type })
- The badge on the board card updates in place (optimistic update)
- A "Saved" toast confirms the change
- The control is disabled while a save is in-flight

**Definition of Done:**
- onChange handler on the control calls store.updateTask immediately (no blur needed)
- Both pills labeled for screen readers: role="radio" or aria-pressed
- Optimistic update confirmed on board card badge

**Priority:** Must
**Story Points:** 2

---

#### Story 2.3 — Edit assigned with auto-save
As a developer, I want to edit the assigned field in the detail panel, so that I can reassign tasks to different agents without reopening the create modal.

**Acceptance Criteria:**
- The assigned field renders as a text input pre-populated with the current value (or empty if unset)
- Blurring with a changed value triggers store.updateTask({ assigned })
- Clearing the field and blurring sends an empty string, which the server interprets as "delete the field"
- A "Saved" toast confirms the change
- The input is disabled while a save is in-flight

**Definition of Done:**
- Blur handler wired to store.updateTask
- Empty string behavior confirmed: assigned field absent on next GET after clearing
- Test: blur with empty string → API called with { assigned: "" }

**Priority:** Must
**Story Points:** 1

---

#### Story 2.4 — Edit description with explicit save
As a developer, I want to edit a task's description in a textarea and explicitly save it with a button, so that I don't lose multi-line text I'm still composing if I accidentally click away.

**Acceptance Criteria:**
- The description field renders as a textarea (4 rows, resize-none on mobile) pre-populated with the current value (or empty placeholder "Add a description...")
- A "Save description" button appears below the textarea
- Clicking the button triggers store.updateTask({ description }) with the current textarea value
- The button is disabled until the textarea value differs from the last saved value
- The button is disabled while a save is in-flight
- A "Saved" toast confirms the change
- Accidentally blurring the textarea does NOT auto-save

**Definition of Done:**
- onClick on button calls store.updateTask
- Blur on textarea does NOT call store.updateTask
- Dirty state: button enabled only when textarea !== last saved description
- Test: blur textarea → no API call; click button → API call

**Priority:** Must
**Story Points:** 2

---

### Epic 3 — Read-Only Metadata

#### Story 3.1 — View read-only task metadata
As a developer, I want the detail panel to show the task's ID, current column, creation date, and last updated date, so that I have full context when editing.

**Acceptance Criteria:**
- Task ID is shown as a small chip in the panel header (read-only)
- Current column ("Todo", "In Progress", "Done") is shown as a colored chip next to the ID
- createdAt is shown in the footer: "Created [formatted date]"
- updatedAt is shown in the footer: "Updated [formatted date]"
- Timestamps use the format "Mar 9, 2026 - 14:32" (deterministic, no Intl API)
- updatedAt refreshes after a successful save (reflecting the server's new timestamp)
- None of these fields are editable

**Definition of Done:**
- Header chips render with correct data from detailTask
- Footer timestamps format correctly for all months (Jan–Dec, hard-coded mapping)
- updatedAt updates after successful PUT response is applied to detailTask in store

**Priority:** Must
**Story Points:** 1

---

### Epic 4 — Safety Guards

#### Story 4.1 — Disable editing during save in-flight
As a developer, I want all panel fields to be disabled while a save is in progress, so that I cannot trigger concurrent conflicting saves.

**Acceptance Criteria:**
- While store.isMutating is true, all four field inputs are disabled (opacity-50, cursor-not-allowed)
- The "Save description" button shows a loading indicator and is disabled
- The state reverts to enabled as soon as the save resolves (success or error)

**Definition of Done:**
- All inputs have disabled={isMutating} prop
- Test: isMutating=true → all inputs have disabled attribute

**Priority:** Must
**Story Points:** 1

---

#### Story 4.2 — Read-only mode during active agent run
As a developer, I want the panel to be fully read-only while an agent pipeline is running on this task, so that I do not accidentally overwrite data the agent is currently modifying.

**Acceptance Criteria:**
- When the task has an active run (activeRun matches task id), a warning banner appears inside the panel: "Agent pipeline is running — editing disabled"
- All four field inputs and the "Save description" button are disabled
- The panel remains openable and closeable (close button and Escape still work)
- The banner disappears and fields re-enable when the run completes

**Definition of Done:**
- activeRun guard reads from existing store state
- Banner: bg-warning-container text-warning-on text-xs rounded-sm
- All inputs disabled when activeRun guard is active
- Test: activeRun set → all inputs disabled, banner visible

**Priority:** Must
**Story Points:** 1

---

### Epic 5 — Accessibility

#### Story 5.1 — Screen reader and keyboard navigation
As a developer using keyboard-only navigation, I want to open, navigate, edit, and close the task detail panel without a mouse, so that the feature is fully accessible.

**Acceptance Criteria:**
- Panel has role="dialog", aria-modal="true", aria-label="Task detail"
- Tab key cycles through all interactive elements inside the panel (focus trap)
- Shift+Tab navigates in reverse
- Tab does not escape the panel while it is open
- On open, focus lands on the title input
- On close, focus returns to the trigger element (card title or expand icon)
- All interactive elements have visible focus rings (ring-2 ring-primary)
- Segmented control pills are navigable by keyboard (role="radio" group or aria-pressed buttons)

**Definition of Done:**
- Focus trap implemented (useFocusTrap hook or equivalent)
- Manual keyboard navigation test passes end-to-end
- No focus escapes to the board while panel is open

**Priority:** Must
**Story Points:** 2

---

## Story Map Summary

| Epic | Stories | Total Points | Priority |
|------|---------|-------------|----------|
| 1 — Open/Close | 1.1–1.5 | 6 | Must |
| 2 — Edit Fields | 2.1–2.4 | 7 | Must |
| 3 — Metadata | 3.1 | 1 | Must |
| 4 — Guards | 4.1–4.2 | 2 | Must |
| 5 — Accessibility | 5.1 | 2 | Must |
| **Total** | **11 stories** | **18 pts** | |

All stories are classified as **Must** — none are Should/Could/Won't, as every story maps directly to a functional or non-functional requirement in the blueprint with no optional features.
