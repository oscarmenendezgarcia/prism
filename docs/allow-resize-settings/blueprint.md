# Blueprint: Allow Resize — Settings Panels

## 1. Scope

Make `ConfigPanel` and `AgentSettingsPanel` horizontally resizable by the user. Resize state persists per panel in `localStorage`. The board area is protected by a minimum panel width and the panel is capped at a maximum so it never fully covers the viewport.

Out of scope: vertical resize, TerminalPanel resize (separate concern), global store changes, API changes.

---

## 2. Current Layout

```
App.tsx → <div class="flex flex-1 overflow-hidden">
  <div class="flex-1 overflow-hidden">   ← Board (flex-1, shrinks)
    <Board />
  </div>
  {terminalOpen && <TerminalPanel />}    ← fixed width, no resize today
  {configPanelOpen && <ConfigPanel />}   ← w-[480px] shrink-0, HARDCODED
  {agentSettingsPanelOpen && <AgentSettingsPanel />}  ← w-[480px] shrink-0, HARDCODED
</div>
```

Both `ConfigPanel` and `AgentSettingsPanel` share the same `<aside>` structural pattern:
- `className="flex flex-col bg-surface-elevated border-l border-border h-full w-[480px] shrink-0"`

The `w-[480px]` hardcoded class is the single point of change. It will be replaced by an inline `style={{ width: panelWidth }}` driven by the resize hook.

---

## 3. New Hook: `usePanelResize`

**File:** `frontend/src/hooks/usePanelResize.ts`

**Signature:**
```
usePanelResize(options: {
  storageKey: string;      // localStorage key, e.g. 'prism:panel-width:config'
  defaultWidth: number;    // px, default 480
  minWidth: number;        // px, default 320
  maxWidth: number;        // px, default 800
}) → {
  width: number;           // current clamped width in px
  handleMouseDown: (e: React.MouseEvent) => void;  // attach to drag handle element
}
```

**Internal logic:**

1. Read initial width from `localStorage` via `useLocalStorage(storageKey, defaultWidth)`.
2. Clamp the stored value between `minWidth` and `maxWidth` on every render (handles stale values from old viewport sizes).
3. On `handleMouseDown`:
   - Record `startX = e.clientX` and `startWidth = width`.
   - Attach `mousemove` and `mouseup` listeners to `window`.
4. On `mousemove`:
   - `delta = startX - e.clientX` (left-edge drag: moving left → wider, right → narrower).
   - `newWidth = clamp(startWidth + delta, minWidth, maxWidth)`.
   - Call `setWidth(newWidth)`.
5. On `mouseup`: remove listeners from `window`.
6. Cleanup `useEffect` removes any dangling listeners on unmount.

**No Zustand involvement.** The hook encapsulates all resize state locally.

---

## 4. Drag Handle Element

A thin vertical strip rendered as the **first child** inside each `<aside>`, spanning full height:

```
<div
  role="separator"
  aria-orientation="vertical"
  aria-label="Resize panel"
  aria-valuenow={width}
  aria-valuemin={minWidth}
  aria-valuemax={maxWidth}
  onMouseDown={handleMouseDown}
  className="
    absolute left-0 top-0 h-full w-1
    cursor-col-resize
    bg-transparent hover:bg-primary/40
    transition-colors duration-150
    z-10
  "
/>
```

The `<aside>` must be `relative` to contain the absolute drag handle.

**Visual design:** 1px wide, transparent at rest, `bg-primary/40` on hover — consistent with existing interactive surface tokens.

**Cursor:** `cursor-col-resize` (browser native bidirectional arrow).

---

## 5. Component Changes

### 5.1 `ConfigPanel`

- Import `usePanelResize`.
- Call: `const { width, handleMouseDown } = usePanelResize({ storageKey: 'prism:panel-width:config', defaultWidth: 480, minWidth: 320, maxWidth: 800 })`.
- Change `<aside>` class: remove `w-[480px]`, add `relative`, add `style={{ width }}`.
- Add drag handle `<div>` as first child of `<aside>`.

### 5.2 `AgentSettingsPanel`

- Identical changes with `storageKey: 'prism:panel-width:agent-settings'`.

---

## 6. Constraints

| Constraint | Value | Rationale |
|---|---|---|
| Default width | 480px | Matches existing hardcoded value — no visual change on first load |
| Min width | 320px | Sufficient for all existing form controls; preserves readability |
| Max width | 800px | ~50% of a standard 1440px monitor; board always retains meaningful space |
| Storage key prefix | `prism:panel-width:` | Namespaced to avoid collisions with other localStorage consumers |

---

## 7. Data Flow

```mermaid
sequenceDiagram
    participant User
    participant DragHandle
    participant usePanelResize
    participant localStorage

    User->>DragHandle: mousedown
    DragHandle->>usePanelResize: handleMouseDown(e)
    usePanelResize->>usePanelResize: record startX, startWidth; attach window listeners

    User->>DragHandle: mousemove (window)
    usePanelResize->>usePanelResize: compute delta, clamp newWidth
    usePanelResize->>localStorage: setItem(storageKey, newWidth)
    usePanelResize-->>ConfigPanel/AgentSettingsPanel: width updated → re-render <aside> style

    User->>DragHandle: mouseup (window)
    usePanelResize->>usePanelResize: remove window listeners
```

---

## 8. Observability

No metrics or traces required for a pure UI interaction. The feature is observable by inspection (panel visually resizes, value survives reload).

A single `console.debug` statement inside `usePanelResize` during the drag can aid development diagnostics but is not required in production.

---

## 9. No API or Backend Changes

This feature is entirely client-side. No new endpoints, no changes to `server.js`, no changes to the MCP server.

---

## 10. Tests

- Unit test `usePanelResize` hook: verify clamping, localStorage read/write, listener lifecycle.
- Component render tests for `ConfigPanel` and `AgentSettingsPanel`: verify drag handle is present and `<aside>` style contains `width`.
- Existing tests must continue to pass without modification (the hook is additive; only the `w-[480px]` class is removed from the `<aside>`).
