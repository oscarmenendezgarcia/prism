# Bug Report: Task Detail & Edit Side Panel

**Feature:** task-detail-edit
**QA Date:** 2026-03-24
**Total Bugs Found:** 3
**Critical:** 0 | **High:** 0 | **Medium:** 2 | **Low:** 1

**Merge gate status: PASSED** — zero Critical or High bugs.

---

## BUG-001: "Save description" button has no dirty-state guard

- **Severity:** Medium
- **Type:** Functional
- **Component:** `frontend/src/components/board/TaskDetailPanel.tsx` (lines 386–402)
- **Test Case:** TC-055

**Reproduction Steps:**
1. Open the detail panel for any task that already has a description.
2. Do not change the description textarea.
3. Observe that the "Save description" button is enabled.
4. Click the button without having made any edit.
5. An unnecessary PUT request is sent to the server.

**Expected Behavior:**
Per Story 2.4 Acceptance Criteria: "The button is disabled until the textarea value differs from the last saved value." The button should be disabled whenever `localDescription.trim() === savedDescription` (where `savedDescription` tracks the last value persisted to the server, initialized to `detailTask.description ?? ''` when the panel opens).

**Actual Behavior:**
The button's `disabled` prop is `fieldDisabled` (`isMutating || activeRun`). There is no comparison to the initial description value. The button is always enabled when the panel is idle, regardless of whether the description has been changed.

**Root Cause Analysis:**
The component tracks `savedTitle` and `savedAssigned` as `useRef` values to detect actual changes on blur. No equivalent `savedDescription` ref was created for the description field. The description's explicit-save path only checks `fieldDisabled`, not a dirty condition.

**Proposed Fix:**
Add a `savedDescription` ref initialized to `detailTask.description ?? ''` in the same `useEffect` that syncs local state. Compute a `descriptionDirty` boolean: `localDescription.trim() !== savedDescription.current`. Pass `disabled={fieldDisabled || !descriptionDirty}` to the Button. Update `savedDescription.current` after a successful save.

---

## BUG-002: Expand icon touch target is 24x24px — below Story 1.2 minimum of 44x44px

- **Severity:** Medium
- **Type:** Accessibility / UX
- **Component:** `frontend/src/components/board/TaskCard.tsx` (line 122)
- **Test Case:** TC-056
- **OWASP Reference:** Not applicable — accessibility (WCAG 2.5.8)

**Reproduction Steps:**
1. Open the Prism board on any device or browser.
2. Inspect the expand icon button on any task card (the `open_in_full` icon).
3. Measure the click target: it is `w-6 h-6` = 24×24 CSS pixels.

**Expected Behavior:**
Per Story 1.2 Acceptance Criteria: "The icon has a minimum touch target of 44×44px."
WCAG 2.5.8 (Level AA in WCAG 2.2) also requires a minimum 24×24 CSS pixel target; the more strict 44×44 requirement from the user story goes further and aligns with Apple HIG / Android material guidelines.

**Actual Behavior:**
The expand icon button uses `className="w-6 h-6 ..."` which renders a 24×24px element. The visible icon is 16px (`text-base leading-none`), meaning the outer button is the full click target at 24×24px.

**Root Cause Analysis:**
The expand icon was sized to match surrounding icon buttons (context menu icons), but the user story explicitly required a larger touch target for this particular action. The className was set to `w-6 h-6` (24px) instead of `w-11 h-11` (44px) or a padding-extended variant.

**Proposed Fix:**
Increase the button's touch target to at least 44×44px while keeping the icon visually small. Two options:
1. Use `w-11 h-11` (44px × 44px) on the button.
2. Keep `w-6 h-6` visually but add `relative` + a CSS `::before` pseudo-element extending the tap zone to 44px (using `before:absolute before:-inset-2.5` or equivalent Tailwind).

---

## BUG-003: Type segmented control wrapper uses role="group" instead of role="radiogroup"

- **Severity:** Low
- **Type:** Accessibility
- **Component:** `frontend/src/components/board/TaskDetailPanel.tsx` (line 327)
- **Test Case:** TC-057

**Reproduction Steps:**
1. Open the detail panel for any task.
2. Inspect the type segmented control (`<div role="group" aria-label="Task type">`).
3. With a screen reader (VoiceOver / NVDA), navigate to the type control.
4. Observe that the screen reader announces it as a generic group, not a radio group.

**Expected Behavior:**
Per Story 2.2 Definition of Done: "Both pills labeled for screen readers: `role="radio"` or `aria-pressed`." The wrapper element should use `role="radiogroup"` to give the `role="radio"` child buttons the correct semantic group context. The individual buttons already have `role="radio"` and `aria-checked`, which require a `radiogroup` parent to be correctly interpreted by assistive technology per ARIA authoring practices (ARIA 1.2 §3.26).

**Actual Behavior:**
The wrapper `<div>` uses `role="group"`. While `role="group"` is not incorrect (it will still expose `aria-label`), the combination of `role="radio"` children with a `role="group"` parent is semantically inconsistent: `role="radio"` implies membership in a `radiogroup`. Some screen readers may not announce the checked state correctly in this context.

**Root Cause Analysis:**
`role="group"` was used as a generic grouping container. The more specific `role="radiogroup"` was not applied, likely as an oversight since the child buttons do correctly use `role="radio"` + `aria-checked`.

**Proposed Fix:**
Change the wrapper `<div role="group" ...>` to `<div role="radiogroup" ...>`. No other changes are needed — the child buttons already have the correct `role="radio"` and `aria-checked={localType === t}` attributes.
