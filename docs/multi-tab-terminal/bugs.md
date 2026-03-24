# Bug Report: Multi-Tab PTY Terminal Sessions (T-10)

**QA Date (initial):** 2026-03-24
**QA Re-verification:** 2026-03-24
**Vitest Suite (re-verification):** 868/868 passing
**Open bugs:** 1 (Low — non-blocking)
**Merge gate:** CLEAR — no unresolved Critical or High bugs.

---

## BUG-001: Panel close unmounts all TerminalTabs, killing PTY sessions (F-10 violation)

- **Severity:** High
- **Type:** Functional
- **Component:** `frontend/src/components/terminal/TerminalPanel.tsx`
- **Test Case:** TC-058
- **Status:** RESOLVED

**Reproduction Steps (original):**
1. Open the terminal panel. Confirm a PTY shell is running.
2. Open a second tab ("+"). Start a long-running process (e.g., `sleep 60`).
3. Click the close (×) button in the terminal panel header to hide the panel.
4. Reopen the panel.

**Expected Behavior (F-10 / E-02-S02):**
Closing the panel hides it but preserves all running shells. All WebSocket connections
remain open. Reopening the panel shows all tabs in the same state. `panelOpen=false`
only sets the flag — it does NOT unmount `TerminalTab` components.

**Actual Behavior (original):**
`TerminalPanel` returned `null` when `panelOpen === false`, causing React to unmount
all child `TerminalTab` components and close WebSocket connections.

**Fix Applied:**
The `if (!panelOpen) return null;` guard was removed. The `<aside>` element now uses
a conditional `hidden` CSS class: `className={... panelOpen ? '' : ' hidden'}`. All
`TerminalTab` components remain mounted regardless of panel visibility. The test for
this behaviour was updated from "renders null" to "hides via hidden class (BUG-001: no
unmount)" — confirmed passing in the re-verification run.

**Verified by:** Reading `TerminalPanel.tsx` line 98 and `TerminalPanel.test.tsx` line 73.

---

## BUG-002: renameSession stores empty string when label is blank or whitespace-only

- **Severity:** Medium
- **Type:** Functional
- **Component:** `frontend/src/stores/useTerminalSessionStore.ts`
- **Test Cases:** TC-013, TC-014
- **Status:** RESOLVED

**Reproduction Steps (original):**
1. Double-click a tab label to enter rename mode.
2. Clear the input field entirely (or type only spaces).
3. Press Enter or click outside (blur).

**Expected Behavior (E-01-S04):**
"Empty names are rejected — the previous name is kept on save."

**Actual Behavior (original):**
`renameSession` applied `label.trim().slice(0, 24)` without guarding for the empty
result, overwriting the tab label with an empty string.

**Fix Applied:**
Guard added at line 171 in `useTerminalSessionStore.ts`:
```
const trimmed = label.trim().slice(0, 24);
if (trimmed.length === 0) return;  // ← added
```
The guard returns early, leaving `sessions` unchanged. TC-013 and TC-014 now reflect
the fixed behavior.

**Verified by:** Reading `useTerminalSessionStore.ts` lines 168–177.

---

## BUG-003: Inline style used for CSS custom property (--panel-w) in TerminalPanel

- **Severity:** Medium
- **Type:** Code Style / Design System Compliance
- **Component:** `frontend/src/components/terminal/TerminalPanel.tsx`
- **Test Case:** N/A (static analysis)
- **Status:** RESOLVED

**Reproduction Steps (original):**
`style={{ '--panel-w': `${width}px` } as React.CSSProperties}` was applied directly
to the `<aside>` element, violating the CLAUDE.md no-inline-styles rule.

**Fix Applied:**
The `style={{}}` prop was replaced with a ref callback `asideRef` that calls
`node.style.setProperty('--panel-w', `${width}px`)` imperatively on the DOM node.
The `<aside>` now carries `ref={asideRef}` and the `--panel-w` token continues to
work via the `w-[var(--panel-w)]` Tailwind class. No `style={{}}` attribute remains
on the element.

**Verified by:** Reading `TerminalPanel.tsx` lines 44–49 and line 97.

---

## BUG-004: Disabled "+" button tooltip text does not match specification

- **Severity:** Medium
- **Type:** Functional / Copy
- **Component:** `frontend/src/components/terminal/TerminalPanel.tsx`
- **Test Case:** TC-059
- **Status:** RESOLVED

**Reproduction Steps (original):**
1. Open 4 terminal tabs.
2. Hover over the disabled "+" button.
   Tooltip read: "Maximum 4 terminal tabs" (missing actionable guidance).

**Expected Behavior (E-01-S05 AC):**
Tooltip text: "Maximum 4 tabs open. Close a tab to open a new one."

**Fix Applied:**
The `title` attribute at line 201 of `TerminalPanel.tsx` was updated to:
```
title={atCap ? 'Maximum 4 tabs open. Close a tab to open a new one.' : 'New terminal tab'}
```
This matches the user story acceptance criterion exactly.

**Verified by:** Reading `TerminalPanel.tsx` line 201.

---

## BUG-005: Tab chips lack aria-controls relationship to their panel containers

- **Severity:** Low
- **Type:** Accessibility
- **Component:** `frontend/src/components/terminal/TerminalPanel.tsx` (tab bar)
- **Test Case:** TC-060
- **Status:** OPEN (Low — not addressed in fix loop, non-blocking for merge)

**Reproduction Steps:**
1. Open the terminal panel with 2 tabs.
2. Inspect `[role="tablist"]` children with a screen reader or axe-core.

**Expected Behavior (ARIA Tabs Pattern):**
Each `role="tab"` element should have `aria-controls="<id-of-associated-tabpanel>"`.
Each `TerminalTab` container should have `role="tabpanel"`, `id`, and `aria-labelledby`.

**Actual Behavior:**
The `role="tab"` elements have `aria-selected` but no `aria-controls`. The `TerminalTab`
component's root `<div>` has no `role="tabpanel"` attribute.

**Root Cause Analysis:**
The tab bar uses correct semantics (`role="tablist"`, `role="tab"`, `aria-selected`) but
the tab-to-panel association is incomplete. This is a common omission when building tab
UIs from scratch.

**Proposed Fix:**
1. Assign stable IDs to each tab chip derived from `session.id`:
   - Tab chip: `id="terminal-tab-chip-{session.id}"` + `aria-controls="terminal-tab-panel-{session.id}"`
2. Pass id props to `TerminalTab`:
   - `<div id="terminal-tab-panel-{sessionId}" role="tabpanel" aria-labelledby="terminal-tab-chip-{sessionId}" ...>`

**OWASP Reference:** N/A

---

## Summary

| ID | Severity | Type | Component | Status |
|----|----------|------|-----------|--------|
| BUG-001 | High | Functional (F-10) | TerminalPanel.tsx | RESOLVED |
| BUG-002 | Medium | Functional | useTerminalSessionStore.ts | RESOLVED |
| BUG-003 | Medium | Code Style | TerminalPanel.tsx | RESOLVED |
| BUG-004 | Medium | Copy/Spec | TerminalPanel.tsx | RESOLVED |
| BUG-005 | Low | Accessibility | TerminalPanel.tsx (tab bar) | OPEN |
