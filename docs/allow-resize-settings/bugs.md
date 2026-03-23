# Bug Report: allow-resize-settings

**Feature:** Resizable Settings Panels via Drag Handle
**Branch:** `feature/allow-resize-window-on-settings`
**QA Date:** 2026-03-23
**QA Agent:** qa-engineer-e2e

---

## Summary

| ID | Severity | Type | Component | Status |
|----|----------|------|-----------|--------|
| BUG-001 | Medium | Code Quality / Policy | `ConfigPanel.tsx`, `AgentSettingsPanel.tsx` | Open |
| BUG-002 | Medium | Functional | `usePanelResize.ts` | Open |
| ADV-001 | Advisory | Accessibility | `ConfigPanel.tsx`, `AgentSettingsPanel.tsx` | Advisory |

**Merge gate:** Both open bugs are Medium severity. No Critical or High bugs. Feature may merge per project merge gate policy. Recommend addressing BUG-001 and BUG-002 before or in a fast-follow commit.

---

## BUG-001: Inline `style={{ width }}` on `<aside>` violates CLAUDE.md no-inline-styles rule

- **Severity:** Medium
- **Type:** Code Quality / Policy
- **Component:** `frontend/src/components/config/ConfigPanel.tsx` (line 86), `frontend/src/components/agent-launcher/AgentSettingsPanel.tsx` (line 108)

**Reproduction Steps:**

1. Open `frontend/src/components/config/ConfigPanel.tsx`, line 84–87.
2. Observe: `<aside ... style={{ width }}>`.
3. Repeat for `AgentSettingsPanel.tsx`, line 106–109.

**Expected Behavior:**

Per `CLAUDE.md` (project rules, section "Design System — Rules"):
> "Tailwind CSS only — no inline styles."
> "No `style={{}}` attributes — use Tailwind arbitrary values (`bg-[#hex]`, `w-[480px]`) instead."

Width should be expressed as a Tailwind arbitrary value, e.g. a CSS custom property set via a className or a data attribute driven approach.

**Actual Behavior:**

Both components use `style={{ width }}` to apply the dynamic panel width. This correctly applies the width at runtime but violates the documented code-style rule enforced by CLAUDE.md.

**Root Cause Analysis:**

The blueprint (section 5.1) explicitly specified `style={{ width }}` as the implementation approach:
> "Change `<aside>` class: remove `w-[480px]`, add `relative`, add `style={{ width }}`."

The blueprint was written before the CLAUDE.md inline-style prohibition was applied to this design choice. The developer followed the blueprint faithfully, but the blueprint itself conflicts with the project rule.

**Proposed Fix:**

Option A (preferred — CSS custom property via Tailwind arbitrary value):

Introduce a CSS custom property on the element and read it via a Tailwind arbitrary class. Use a `ref` to set the property imperatively on the DOM node whenever `width` changes:

```
// In the hook, return width as a pixel string for direct DOM use:
// In the component, set via ref:
//   asideRef.current.style.setProperty('--panel-width', `${width}px`)
//   className="... w-[var(--panel-width)]"
```

This avoids `style={{}}` on the JSX element while keeping dynamic width. It is more verbose but compliant.

Option B (pragmatic — document exception in CLAUDE.md):

Because `style={{ width }}` is the only practical way to apply a numeric dynamic width without a runtime CSS variable, add a documented exception in CLAUDE.md:
> "Exception: dynamic numeric width/height values driven by JavaScript state may use `style={{ width }}` or `style={{ height }}`. All other styling must use Tailwind."

Option B requires a CLAUDE.md update, not a code change.

**Note:** The blueprint must be updated regardless to remove the instruction that prescribed `style={{ width }}`, replacing it with the chosen compliant approach.

---

## BUG-002: Non-numeric value in localStorage produces `NaNpx` panel width, collapsing the panel

- **Severity:** Medium
- **Type:** Functional / Defensive Programming
- **Component:** `frontend/src/hooks/usePanelResize.ts` (lines 50–54)

**Reproduction Steps:**

1. Open browser DevTools > Application > Local Storage.
2. Set the key `prism:panel-width:config` to the value `"abc"` (a JSON string — the stored value is `"abc"` without outer quotes, so devtools raw value is `abc`; or set it to `abc` which parses as a string).
3. Reload the page and open ConfigPanel.
4. Observe the `<aside>` element width in DevTools Styles — it shows `width: NaNpx`.
5. The panel has zero or undefined rendered width and is not visible or usable.

**Alternatively (manual simulation):**

```js
// In the browser console:
localStorage.setItem('prism:panel-width:config', JSON.stringify('abc'));
// Reload → ConfigPanel aside collapses
```

**Expected Behavior:**

When the stored value cannot be interpreted as a valid number within [minWidth, maxWidth], the hook should fall back to `defaultWidth` (480). The panel should render at 480px.

**Actual Behavior:**

`useLocalStorage` reads `"abc"` and returns it as a string (TypeScript type `number` is nominal only — no runtime coercion occurs at the boundary). `clamp("abc" as any, 320, 800)` evaluates `Math.max(320, Math.min(800, "abc"))`. `Math.min(800, "abc")` returns `NaN`. `Math.max(320, NaN)` returns `NaN`. The returned `width` is `NaN`. React renders `style={{ width: NaN }}` which the browser serializes as `width: NaNpx` — an invalid CSS value. The panel renders with no explicit width, collapsing to its content width or zero in a `shrink-0` flex container.

**Root Cause Analysis:**

`useLocalStorage` is generic (`T = number`) but performs no runtime type validation — it returns whatever `JSON.parse` produces. Storing a non-numeric JSON value under a key that `usePanelResize` reads with type `number` creates a type gap at the localStorage boundary. The `clamp` function does not guard against `NaN` because it assumes its input is already a number.

`Math.max(min, NaN)` and `Math.min(max, NaN)` both return `NaN` in JavaScript, so the existing clamp provides no protection against a NaN input.

**Proposed Fix:**

Add a `Number.isFinite` guard after reading from `useLocalStorage` and before clamping, replacing any non-finite value with `defaultWidth`:

```
// In usePanelResize, after line 50:
const rawWidth = Number.isFinite(storedWidth) ? storedWidth : defaultWidth;
const width = clamp(rawWidth, minWidth, maxWidth);
```

This is a one-line defensive addition that makes the hook robust against any corrupted or manually edited localStorage value. The test case to add:

```ts
it('falls back to defaultWidth when localStorage contains a non-numeric value', () => {
  localStorage.setItem(DEFAULT_OPTIONS.storageKey, JSON.stringify('abc'));
  const { result } = renderHook(() => usePanelResize(DEFAULT_OPTIONS));
  expect(result.current.width).toBe(DEFAULT_OPTIONS.defaultWidth);
});
```

---

## ADV-001: Drag handle lacks keyboard interaction despite carrying `role="separator"` with value ARIA attributes

- **Severity:** Advisory (Low)
- **Type:** Accessibility
- **Component:** `frontend/src/components/config/ConfigPanel.tsx` (lines 91–99), `frontend/src/components/agent-launcher/AgentSettingsPanel.tsx` (lines 112–121)

**Description:**

WAI-ARIA authoring practices for `role="separator"` with `aria-valuenow`/`aria-valuemin`/`aria-valuemax` (a focusable separator / splitter) specify that the element should respond to keyboard input:

- `ArrowLeft` / `ArrowRight`: decrease / increase value by a step
- `Home` / `End`: set to `aria-valuemin` / `aria-valuemax`

The current implementation has no `onKeyDown` handler and no `tabIndex`, so the drag handle is unreachable and inoperable via keyboard. Screen readers will announce "Resize panel, separator, 480" but users with keyboard-only navigation cannot resize the panel.

**Expected Behavior (per WAI-ARIA):**

The drag handle should be focusable (`tabIndex={0}`) and respond to arrow keys to increment/decrement the panel width in configurable steps (e.g. 10px per keypress).

**Actual Behavior:**

Mouse-only. Keyboard users cannot resize the panel.

**Proposed Fix:**

This is an advisory for a future enhancement, not a blocking bug. The feature as designed is a drag handle; keyboard support was not in the ADR scope. To address:

1. Add `tabIndex={0}` to the separator div.
2. Add an `onKeyDown` handler that calls `setStoredWidth` with clamped delta for `ArrowLeft`/`ArrowRight`, and with `minWidth`/`maxWidth` for `Home`/`End`.
3. Add `aria-keyshortcuts` or a tooltip describing the keyboard behavior.

The hook's `setStoredWidth` is already accessible — this enhancement requires only a component-level `onKeyDown` prop, no hook changes.

---

## Pre-existing Issue (Out of Scope): useAppStore test timeout

- **Component:** `frontend/__tests__/stores/useAppStore.test.ts`
- **Test:** `executeAgentRun > shows "Opening terminal..." toast and error when terminalSender is null after 500ms wait`
- **Status:** Pre-existing on `main` before feature branch was cut. Confirmed by running the test suite on the base commit after stashing the feature changes. **Not introduced by this feature. Not a merge blocker for allow-resize-settings.**
