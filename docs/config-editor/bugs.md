# Bug Report: Config Editor Panel

**Feature:** Config Editor Panel (ADR-1)
**Branch:** `feature/config-editor`
**Date:** 2026-03-18
**Author:** qa-engineer-e2e

---

## Summary

| ID | Severity | Type | Component | Story | Status |
|----|----------|------|-----------|-------|--------|
| BUG-001 | Medium | Functional | `useAppStore.ts` `toggleConfigPanel` | CE-11 | Open |
| BUG-002 | Low | Functional / UX | `useAppStore.ts` `loadConfigFiles` | CE-13 | Open |
| BUG-003 | Low | Functional / UX | `useAppStore.ts` `selectConfigFile` | CE-14 | Open |

**Merge verdict: APPROVED.** No Critical or High bugs. All three bugs are Medium/Low and may go to backlog.

---

## BUG-001: `toggleConfigPanel` bypasses the dirty state guard when closing

- **Severity:** Medium
- **Type:** Functional
- **Component:** `frontend/src/stores/useAppStore.ts` — `toggleConfigPanel` action
- **Story:** CE-11

### Reproduction Steps

1. Open the Config Panel (ConfigToggle button in header).
2. Select any config file (e.g., `global-claude-md`).
3. Make any edit to the textarea content (creates dirty state: `configDirty = true`).
4. Click the ConfigToggle button in the header **a second time** to close the panel.

**Expected Behavior (per CE-11):** The `DiscardChangesDialog` should appear asking the user to confirm discarding unsaved changes before the panel closes.

**Actual Behavior:** The panel closes immediately without showing the discard confirmation dialog. The user's unsaved edits are silently discarded.

### Root Cause Analysis

`toggleConfigPanel` in `useAppStore.ts` (line 321–329) directly flips `configPanelOpen` without checking `configDirty`:

```
toggleConfigPanel: () => {
  const next = !get().configPanelOpen;
  if (next) {
    localStorage.setItem(CONFIG_OPEN_KEY, '1');
  } else {
    localStorage.removeItem(CONFIG_OPEN_KEY);
  }
  set({ configPanelOpen: next });
},
```

`ConfigPanel.tsx` correctly intercepts the close button via `handleRequestClose` (which checks `configDirty` and calls `setPendingFileId('close')`). However, the ConfigToggle button in the **header** calls `toggleConfigPanel` directly from the store, bypassing this guard entirely.

The close button inside the panel is guarded; the header toggle button is not.

### Proposed Fix

The `ConfigToggle` component (or `toggleConfigPanel` action) must check `configDirty` before closing. Two approaches:

**Option A (preferred — store-level guard):** `toggleConfigPanel` should check `configDirty` when transitioning from open to closed, and if dirty, dispatch a signal to `ConfigPanel` to show the discard dialog instead of directly setting `configPanelOpen = false`. A simple approach: expose a `requestCloseConfigPanel` action that `ConfigPanel` subscribes to via a flag in the store (e.g., `configPanelCloseRequested: boolean`), and have `ConfigPanel` react to it by showing the discard dialog.

**Option B (component-level guard):** `ConfigToggle` receives an `onToggle` prop from the layout instead of calling the store directly. The layout or `ConfigPanel` parent passes a guarded handler that checks `configDirty` and routes to `handleRequestClose` in `ConfigPanel`.

Option A requires a small store change; Option B requires threading a callback through the layout. Either eliminates the bypass.

---

## BUG-002: File list load error shows a toast instead of an inline sidebar error state

- **Severity:** Low
- **Type:** Functional / UX
- **Component:** `frontend/src/stores/useAppStore.ts` — `loadConfigFiles` action
- **Story:** CE-13

### Reproduction Steps

1. Stop or block the backend server (e.g., kill the `node server.js` process).
2. Open the Config Panel.
3. The panel attempts to call `GET /api/v1/config/files` and the request fails.

**Expected Behavior (per CE-13):** The sidebar area shows an inline error state with the text "Could not load config files." and a "Retry" button. No toast is shown.

**Actual Behavior:** A generic error toast appears (e.g., "Failed to load config files: Failed to fetch") in the bottom-right corner. The sidebar shows the empty state ("No config files found") or spinner indefinitely. No "Retry" button is available.

### Root Cause Analysis

`loadConfigFiles` in `useAppStore.ts` (lines 340–350) catches errors by calling `showToast` and does not set a dedicated error state:

```
loadConfigFiles: async () => {
  set({ configLoading: true });
  try {
    const files = await api.getConfigFiles();
    set({ configFiles: files });
  } catch (err) {
    get().showToast(`Failed to load config files: ${(err as Error).message}`, 'error');
  } finally {
    set({ configLoading: false });
  }
},
```

There is no `configFilesError` state field in the store (CE-13 DoD specifies it). `ConfigFileSidebar` has no error branch to render — it only handles loading (spinner) and empty array (empty state). A toast is insufficient here because:
- It auto-dismisses after 3 seconds, leaving no persistent indication of the error.
- It provides no "Retry" button — the user must close and reopen the panel to retry.

### Proposed Fix

1. Add `configFilesError: string | null` to the store state.
2. In `loadConfigFiles`, on catch: `set({ configFilesError: (err as Error).message })` instead of (or in addition to) the toast.
3. On success: `set({ configFilesError: null })`.
4. In `ConfigFileSidebar`, add an error branch: when `configFilesError` is non-null (and `configFiles.length === 0`), render the inline error state with a "Retry" button that calls `loadConfigFiles`.
5. Remove the `showToast` call from `loadConfigFiles` (CE-13 AC explicitly says no toast for this error).

---

## BUG-003: File content load error shows a toast instead of an inline editor error state

- **Severity:** Low
- **Type:** Functional / UX
- **Component:** `frontend/src/stores/useAppStore.ts` — `selectConfigFile` action
- **Story:** CE-14

### Reproduction Steps

1. Open the Config Panel and wait for the file list to load.
2. Simulate a read failure by temporarily making the test file unreadable (e.g., `chmod 000 ~/.claude/CLAUDE.md`), then click the file in the sidebar.

**Expected Behavior (per CE-14):** The editor area shows an inline error state: "Could not load {filename}. Please try again." with a "Retry" button. The sidebar item remains selected (active styling). No red toast is shown.

**Actual Behavior:** A generic error toast appears ("Failed to load file: ..."). The editor area either stays empty or shows the previous file's content. The sidebar item may lose its active styling because `activeConfigFileId` is never set on error.

### Root Cause Analysis

`selectConfigFile` in `useAppStore.ts` (lines 352–367) catches errors via `showToast` without setting a dedicated error state:

```
selectConfigFile: async (fileId: string) => {
  set({ configLoading: true });
  try {
    const file = await api.getConfigFile(fileId);
    set({
      activeConfigFileId:   file.id,
      activeConfigContent:  file.content,
      activeConfigOriginal: file.content,
      configDirty:          false,
    });
  } catch (err) {
    get().showToast(`Failed to load file: ${(err as Error).message}`, 'error');
  } finally {
    set({ configLoading: false });
  }
},
```

On error, `activeConfigFileId` is not updated to `fileId`, so the sidebar loses the active selection (the clicked item is no longer highlighted). CE-14 requires the sidebar selection to remain intact. Additionally, CE-14 AC explicitly says "A red error toast is NOT shown."

There is no `configFileLoadError` state in the store.

### Proposed Fix

1. Add `configFileLoadError: string | null` to the store state.
2. In `selectConfigFile`, on entry: `set({ activeConfigFileId: fileId, configFileLoadError: null })` so the sidebar selection is preserved regardless of outcome.
3. On catch: `set({ configFileLoadError: (err as Error).message })` instead of the toast call.
4. On success: `set({ configFileLoadError: null })`.
5. In `ConfigEditor`, add an error branch: when `configFileLoadError` is non-null, render the inline error state with a "Retry" button that calls `selectConfigFile(activeConfigFileId)`.
6. Remove the `showToast` call from `selectConfigFile` (CE-14 AC says no toast).

---

## Pre-existing Bugs (outside config-editor feature scope)

The following failures were observed in the backend test run but are **not related to the config-editor feature**. They existed before this feature branch and are out of scope for this QA cycle.

| ID | File | Test | Nature |
|----|------|------|--------|
| PRE-01 | tests/attachments.test.js | "move route not shadowed by attachments route" | Route ordering regression in attachment/move handler |
| PRE-02 | tests/qa-attachments.test.js | QA-TC-001, QA-TC-003 | Path traversal test expectations mismatch with current server behavior (test expectation bug, not a live security hole — the file ID registry is the real guard) |

These pre-existing failures do not affect the config-editor feature and should be tracked separately.
