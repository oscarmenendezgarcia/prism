# ADR-1: Resizable Settings Panels via Drag Handle

## Status
Accepted

## Context

Both the `ConfigPanel` and `AgentSettingsPanel` are rendered as `<aside>` slide-overs in the main flex row of `App.tsx`. Both are hardcoded to `w-[480px]` with `shrink-0`. Users need more horizontal space — particularly in `ConfigPanel` (code editor) and `AgentSettingsPanel` (long custom-instructions textarea). There is no resize mechanism today.

The feature requires:
- Dragging a handle on the left edge of any open settings panel to resize it.
- Persisting the chosen width per panel across browser sessions.
- Respecting min/max bounds so the board area never disappears.
- Working in both light and dark themes without additional token work.

Only horizontal (width) resize is required. Height is always 100% of the viewport minus the header — vertical resize is out of scope.

## Decision

Implement a custom left-edge drag handle rendered inside each panel's `<aside>`. Width state is managed by a shared `usePanelResize` hook that reads/writes to `localStorage` via the existing `useLocalStorage` hook.

## Rationale

**Custom drag handle** is chosen over `CSS resize: horizontal` for three reasons:
1. CSS `resize` only works on the right/bottom edge; these panels are on the right side of the layout, so dragging must originate from the left edge — CSS `resize` cannot cover this.
2. CSS `resize` applies a native OS widget that cannot be styled with Tailwind tokens and breaks the design system.
3. A custom handle gives precise control over min/max constraints enforced in JS, snapping, and aria attributes.

**Width-only** resize is chosen over two-axis resize because panel height is structurally determined by the flex layout (always fills the available vertical space). There is no user value in resizing height independently of the viewport.

**Per-panel localStorage persistence** is chosen over session-only state because the user typically configures a panel width once and expects it to be remembered. The existing `useLocalStorage` hook is reused — no new infrastructure needed.

**Inline hook, no global store** — resize width is purely presentational state local to each panel. It does not need to be shared across components or affect other parts of the app. Adding it to `useAppStore` (Zustand) would be over-engineering for local UI state.

## Consequences

### Positive
- Both `ConfigPanel` and `AgentSettingsPanel` become resizable with a single shared hook — DRY.
- No changes to the global store, backend, or API.
- Works with existing Tailwind tokens; drag handle uses `bg-border` / `hover:bg-primary` tokens consistent with the design system.
- Persisted width survives page reload without any server round-trip.

### Negative / Risks
- `onMouseMove` / `onMouseUp` listeners are attached to `window` during a drag. A small memory-leak risk exists if the component unmounts mid-drag; mitigated by cleanup in the `useEffect` return.
- If the browser is resized to a very narrow viewport, the stored width may violate the minimum bound. Mitigated: width is clamped on every render using `Math.max(MIN, Math.min(MAX, storedWidth))`.
- Two panels open simultaneously is not currently possible (the layout supports at most one side panel + terminal), so no collision handling is needed.

## Alternatives Considered

- **CSS `resize: horizontal`**: discarded because it works only on the right/bottom corner and cannot be styled with design tokens.
- **React-resizable or react-resizable-panels library**: discarded — adding a third-party dependency is disproportionate for a two-component feature; the custom hook is ~40 lines.
- **Resize stored in Zustand global store**: discarded — presentational state local to the panel; pollutes the global store with UI-only data.

## Review
Suggested review date: 2026-09-23
