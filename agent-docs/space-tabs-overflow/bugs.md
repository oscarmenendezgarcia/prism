# Bug Report: Space Tabs — Overflow Handling & Visual Weight

**Feature:** `space-tabs-overflow`
**QA Engineer:** qa-engineer-e2e
**Date:** 2026-06-03

---

## BUG-001: Add button permanently clipped — `reservedTrailingPx` ignores nav padding

- **Severity**: High
- **Type**: Functional / Layout
- **Component**: `frontend/src/components/layout/SpaceTabs.tsx` (line 38–42) + `frontend/src/hooks/useOverflowItems.ts`
- **Test Cases**: TC-016, TC-017, TC-018, TC-019

### Reproduction Steps

1. Open Prism with 10+ spaces at any viewport width (confirmed at 1440px and 800px).
2. Open browser DevTools and run:
   ```js
   const nav = document.querySelector('[role="tablist"]');
   console.log(nav.scrollWidth, nav.clientWidth); // e.g. 1473 1440
   const addBtn = document.getElementById('space-add-btn');
   const navRect = nav.getBoundingClientRect();
   const addBtnRect = addBtn.getBoundingClientRect();
   console.log('Add btn right:', addBtnRect.right, 'Nav right:', navRect.right);
   // → 1457.23  1440  (17px of the button is outside the nav)
   ```
3. The "Create new space" button is partially hidden by the `overflow-hidden` clipping boundary.

### Expected Behavior

`nav.scrollWidth === nav.clientWidth` (no overflow). The add button is fully visible and clickable.

### Actual Behavior

`nav.scrollWidth = 1473 > nav.clientWidth = 1440` at 1440px viewport. The add button's right edge is 17px past the nav's right edge; approximately 60% of the button is rendered outside the visible area. The button is partially clickable but unreliable; the right-side icon `add` is hidden.

### Root Cause Analysis

`SpaceTabs.tsx` passes `reservedTrailingPx: 76` to `useOverflowItems`. The hook attaches `containerRef` to the `<nav>` element and reads `container.getBoundingClientRect().width` (= nav's full CSS width including padding). But the nav has `px-4` (16px left + 16px right = 32px of padding) that reduces the actual content area.

The hook computes:
```
available = containerWidth - reservedTrailingPx
           = 1440 - 76 = 1364px
```

However, the real available width for tabs is:
```
navWidth - navPadding - overflowBtn - gaps - addBtn
= 1440 - 32 - 42 - (2 × gap-1=4) - 28 = 1326px
```

The hook over-allocates 38px to tabs, allowing more tabs to be kept visible than actually fit. This causes the rightmost elements (add button) to be pushed past the nav's visible edge.

### Proposed Fix

**Option A (minimal — patch):** In `SpaceTabs.tsx`, increase `reservedTrailingPx` from `76` to `112`:

```ts
// 76 was: overflowBtn(~44) + addBtn(28) + 1 gap(4)
// 112 adds: nav padding(32) + 1 extra gap(4)
reservedTrailingPx: 112,
```

Measured actual values: overflowBtn=42px, addBtn=28px, gaps=8px, navPadding=32px → total 110px. Use 112 for a 2px safety margin.

**Option B (architectural — preferred):** Move `containerRef` from the `<nav>` to the inner flex-1 div (the tab strip container). The hook would then measure the actual available tab strip width, making `reservedTrailingPx` only need to cover the overflow button and add button (no padding subtraction needed):

In `SpaceTabs.tsx`:
```tsx
{/* Attach containerRef to the inner div, not the nav */}
<div
  ref={containerRef as React.RefCallback<HTMLElement>}
  className="flex items-center flex-1 gap-0.5 py-1.5 min-w-0"
>
  ...
</div>
```
And update `reservedTrailingPx` to just `78` (overflowBtn=42 + addBtn=28 + 2 gaps=8).

Option B also resolves the measurement accuracy across all future padding changes to the nav.

---

## BUG-002: Kebab span is not keyboard-focusable (WCAG 2.1 AA failure)

- **Severity**: Medium
- **Type**: Accessibility (NFR-2)
- **Component**: `frontend/src/components/layout/SpaceTab.tsx` (line 96–106)
- **WCAG Reference**: WCAG 2.1 SC 2.1.1 (Keyboard), SC 4.1.2 (Name, Role, Value)
- **Test Cases**: TC-030

### Reproduction Steps

1. Load Prism.
2. Press Tab repeatedly to navigate through the space tabs.
3. Observe: the kebab "more_vert" icon is never reachable via keyboard.
4. Inspect: `document.querySelectorAll('[role="tab"] [role="button"]')` — all have `tabindex=null` (default for SPAN → not in tab order).

### Expected Behavior

Each kebab affordance should be reachable via Tab (or within the tab keyboard context). Users who cannot use a mouse must be able to access "Edit" and "Delete" on spaces.

### Actual Behavior

`<span role="button">` without `tabindex="0"` is not in the browser's natural tab order. Keyboard-only users cannot focus or activate the kebab.

### Root Cause Analysis

`SpaceTab.tsx` uses `<span role="button">` for the kebab icon. Semantically, `role="button"` is correct, but interactive ARIA roles on non-interactive HTML elements require `tabindex="0"` to receive keyboard focus.

### Proposed Fix

Replace `<span role="button">` with a `<button>` element and `type="button"`, or add `tabindex="0"` to the existing span and handle keyboard `Enter`/`Space` events:

```tsx
// Preferred: use a real button
<button
  type="button"
  aria-label="Space options"
  title="Space options"
  onClick={handleKebabClick}
  className={[
    'material-symbols-outlined text-base leading-none text-text-secondary',
    'hover:text-text-primary transition-opacity duration-fast rounded',
    active ? 'opacity-70' : 'opacity-0 group-hover:opacity-100',
  ].join(' ')}
>
  more_vert
</button>
```

This makes the kebab natively keyboard-focusable and activatable with Enter/Space, without extra event handlers.

---

## BUG-003: Overflow dropdown uses non-standard `listbox + button[role="option"]` ARIA pattern

- **Severity**: Medium
- **Type**: Accessibility (NFR-2)
- **Component**: `frontend/src/components/layout/SpaceOverflowMenu.tsx` (line 269–314)
- **WCAG Reference**: WCAG 2.1 SC 4.1.2 (Name, Role, Value); ARIA 1.2 `listbox` role spec
- **Test Cases**: TC-028 (passing on aria-haspopup; pattern not directly tested by existing unit tests)

### Reproduction Steps

1. Click the `+N` overflow button.
2. Inspect: the dropdown `<ul role="listbox">` contains `<li role="none"><button role="option">` elements.

### Expected Behavior

Either:
- A `listbox` with `option` elements that are semantically children (not buttons), enabling screen readers to announce count + position ("item 1 of 3"); **or**
- A `menu` with `menuitem` elements (more appropriate for navigation, which is what this dropdown does — it switches between spaces, not selects a value).

### Actual Behavior

The dropdown uses `role="listbox"` + `aria-haspopup="listbox"` on the trigger, but the items are `<button role="option">` inside `<li role="none">`. The ARIA spec requires `option` to be an owned child of `listbox`, but `button` is not a valid `option` implementation. This may cause:
- Screen readers to skip or misread item count/position
- VoiceOver to announce "button" rather than "option"
- Some AT to not recognise keyboard arrows within the list

### Root Cause Analysis

The component was modelled after a `listbox` pattern but implemented with `button` elements for interactivity. The semantic mismatch exists because `<button>` adds keyboard behaviour (Tab, Enter) while `<option>` does not have native interaction.

### Proposed Fix

Change the dropdown to use `role="menu"` / `role="menuitem"` which is the standard pattern for navigation dropdowns activated by a trigger button:

```tsx
// Trigger:
aria-haspopup="menu"
// Dropdown:
<ul role="menu" aria-label="Available spaces">
  <li key={space.id} role="none">
    <button role="menuitem" aria-checked={space.id === activeSpaceId} ...>
```

This is semantically correct — the user is navigating between spaces (a menu action), not selecting a value from a listbox. The keyboard behaviour (`aria-activedescendant` + arrow keys) works the same way. Update `aria-haspopup` on the trigger from `"listbox"` to `"menu"` accordingly.

---

## BUG-004: Duplicate `aria-label` on tab button and its child label span

- **Severity**: Low
- **Type**: Accessibility (minor)
- **Component**: `frontend/src/components/layout/SpaceTab.tsx` (lines 49, 67)

### Reproduction Steps

1. Inspect a space tab: `<button aria-label="Ideas">...<span aria-label="Ideas">...</span></button>`
2. VoiceOver / NVDA may announce "Ideas tab, Ideas" (label twice) on focus.

### Expected Behavior

The space name is announced once per focus event.

### Actual Behavior

`aria-label` is set both on the `<button>` (line 49) and on the `<span>` (line 67). Screen readers that compute the accessible name from the button's `aria-label` will not traverse child elements — so in practice most screen readers only read the button's `aria-label` once. However, some screen readers in browse/reading mode may also read the span's label.

### Root Cause Analysis

The `aria-label` on the inner `<span>` was added for redundancy but is unnecessary — the outer button's `aria-label` already provides the accessible name for the whole interactive element.

### Proposed Fix

Remove `aria-label` from the truncation span; keep it only on the outer `<button>`. The `title` attribute on the button already provides the hover tooltip for AT users who need it:

```tsx
{/* Remove aria-label from this span — the button's aria-label is sufficient */}
<span ref={labelRef} className="max-w-[160px] truncate">
  {space.name}
</span>
```

---

## Summary Table

| Bug | Severity | Component | FR/NFR | Fix Complexity |
|---|---|---|---|---|
| BUG-001: Add button clipped — reservedTrailingPx ignores padding | **High** | SpaceTabs.tsx | FR-1 | Low — 1-line config change (Option A) or minor refactor (Option B) |
| BUG-002: Kebab span not keyboard-focusable | Medium | SpaceTab.tsx | NFR-2 | Low — replace `<span>` with `<button>` |
| BUG-003: Non-standard listbox/option ARIA in overflow dropdown | Medium | SpaceOverflowMenu.tsx | NFR-2 | Low — rename roles to menu/menuitem |
| BUG-004: Duplicate aria-label on button + child span | Low | SpaceTab.tsx | NFR-2 | Trivial — remove aria-label from span |
