# User Stories: Config Editor Panel

**Feature:** Configuration Editor Panel for Prism
**Date:** 2026-03-18
**Author:** ux-api-designer
**ADR reference:** ADR-1 (Accepted)

---

## Epics

| Epic | Description |
|------|-------------|
| E-01 | Panel lifecycle (open / close) |
| E-02 | File listing and selection |
| E-03 | File editing and saving |
| E-04 | Dirty state and unsaved changes guard |
| E-05 | Keyboard shortcuts |
| E-06 | Error handling |

---

## E-01: Panel Lifecycle

### Story CE-01: Open the config panel via header button

**As a** developer using Prism,
**I want** to open the config editor panel by clicking the ConfigToggle button in the header,
**so that** I can access and edit my Claude configuration files without leaving the Prism UI.

**Acceptance Criteria:**
- [ ] A "settings" (or "tune") icon button exists in the header between ThemeToggle and TerminalToggle
- [ ] Clicking the button opens the ConfigPanel slide-over on the right side of the screen
- [ ] The button renders with `aria-label="Toggle configuration panel"`
- [ ] The button renders with `aria-pressed="true"` when the panel is open
- [ ] The button renders with `aria-pressed="false"` when the panel is closed
- [ ] The active state applies `bg-primary/[0.15] text-primary` styling
- [ ] The inactive state applies `bg-white/5 text-text-secondary hover:bg-white/10` styling
- [ ] The panel slides in with a CSS transition (not an instant appear)
- [ ] When the panel opens, `GET /api/v1/config/files` is called immediately to populate the sidebar

**Definition of Done:**
- [ ] ConfigToggle component exists at `frontend/src/components/config/ConfigToggle.tsx`
- [ ] `toggleConfigPanel` action exists in `useAppStore`
- [ ] `configPanelOpen` state is persisted to localStorage under key `config-panel:open`
- [ ] Manual test: click toggle → panel opens; click again → panel closes

**Priority:** Must
**Story Points:** 2

---

### Story CE-02: Close the config panel

**As a** developer,
**I want** to close the config panel via the close button (X) in the panel header or by clicking the ConfigToggle again,
**so that** I can reclaim horizontal space for the board.

**Acceptance Criteria:**
- [ ] A close button with `aria-label="Close configuration panel"` exists in the panel header
- [ ] Clicking the close button closes the panel (without discard confirmation when editor is clean)
- [ ] Clicking the ConfigToggle button in the header while the panel is open closes the panel
- [ ] When closed while editor is clean, the panel closes immediately with no dialog
- [ ] When closed while editor is dirty, the discard confirmation dialog is shown (see CE-09)
- [ ] The `configPanelOpen` state is updated to `false` in the store after close

**Definition of Done:**
- [ ] Close button is a `<Button variant="ghost" size="icon">` with a "close" Material Symbol icon
- [ ] Manual test: open panel, do not edit any file, close → no dialog, panel closes
- [ ] Manual test: open panel, edit a file, close → discard dialog appears

**Priority:** Must
**Story Points:** 1

---

### Story CE-03: Config panel and terminal panel coexist

**As a** developer,
**I want** to have both the config panel and the terminal panel open simultaneously,
**so that** I can reference or run commands while editing my config files.

**Acceptance Criteria:**
- [ ] When both panels are open, the board shrinks proportionally using `flex-1 min-w-0`
- [ ] Both ConfigToggle and TerminalToggle show active styling simultaneously
- [ ] Each panel is independently closeable without affecting the other
- [ ] On screens narrower than 900px, panels stack fullscreen (overlay the board)
- [ ] No horizontal overflow on the page body when both panels are open

**Definition of Done:**
- [ ] Manual test at 1440px: open terminal, open config → board shrinks, both panels visible side by side
- [ ] Manual test at 900px: both panels behave as fullscreen overlays

**Priority:** Should
**Story Points:** 2

---

## E-02: File Listing and Selection

### Story CE-04: View list of config files

**As a** developer,
**I want** to see all available config files listed in the panel sidebar when I open the panel,
**so that** I know which files I can view and edit.

**Acceptance Criteria:**
- [ ] The sidebar shows files grouped under two section headers: "Global" and "Project"
- [ ] "Global" section lists all `.md` files found in `~/.claude/`
- [ ] "Project" section lists `CLAUDE.md` from the Prism project root if it exists
- [ ] If no project `CLAUDE.md` exists, the Project section is omitted entirely
- [ ] Each file item shows the filename and a subdirectory label (`~/.claude` or `./`)
- [ ] Files are listed in alphabetical order within each section
- [ ] If the API call fails, the sidebar shows an error state with a "Retry" button
- [ ] The file list is re-fetched on every panel open (not cached across open/close cycles)

**Definition of Done:**
- [ ] `ConfigFileSidebar` component at `frontend/src/components/config/ConfigFileSidebar.tsx`
- [ ] Sidebar uses `role="listbox"` with `aria-label="Config files"`
- [ ] Each file item uses `role="option"`
- [ ] Unit test: renders global and project sections correctly from mock API response
- [ ] Unit test: renders empty state when API returns empty array

**Priority:** Must
**Story Points:** 3

---

### Story CE-05: Select a file to view its content

**As a** developer,
**I want** to click a file in the sidebar to load and view its content in the editor area,
**so that** I can read and prepare to edit the file.

**Acceptance Criteria:**
- [ ] Clicking a file item in the sidebar triggers `GET /api/v1/config/files/{fileId}`
- [ ] While the file is loading, a spinner is shown in the editor area and the sidebar item shows a loading indicator
- [ ] Once loaded, the file content appears in the textarea
- [ ] The active file item shows `border-l-2 border-primary bg-primary/[0.10] text-primary font-medium` styling
- [ ] Inactive file items show `text-text-secondary hover:bg-white/5 hover:text-text-primary` styling
- [ ] The textarea renders with `font-mono` (JetBrains Mono) and `text-sm`
- [ ] The textarea has `spellcheck="false"`, `autocorrect="off"`, `autocapitalize="off"`
- [ ] The editor area has `aria-label="File editor for {filename}"`
- [ ] After loading, `activeConfigOriginal` and `activeConfigContent` are set to the same value (clean state)

**Definition of Done:**
- [ ] `selectConfigFile` action in the store fetches content and updates state
- [ ] `configLoading` is `true` during fetch and `false` on completion (success or error)
- [ ] Unit test: selecting a file calls the API and populates the textarea
- [ ] Unit test: loading state is set correctly during and after fetch

**Priority:** Must
**Story Points:** 3

---

### Story CE-06: Navigate the file list with the keyboard

**As a** developer,
**I want** to navigate the file sidebar using the keyboard (arrow keys + Enter),
**so that** I can select files without using the mouse.

**Acceptance Criteria:**
- [ ] When focus is in the sidebar listbox, Up/Down arrow keys move the focused option
- [ ] Pressing Enter on a focused option triggers file selection (same as clicking)
- [ ] Tab key moves focus from the last sidebar item to the textarea
- [ ] Shift+Tab moves focus from the textarea back to the sidebar
- [ ] The focused sidebar item has a visible focus ring (`focus:ring-2 focus:ring-primary`)

**Definition of Done:**
- [ ] Keyboard navigation implemented via `onKeyDown` handlers on the listbox
- [ ] Unit test: arrow key navigation updates the focused item index
- [ ] Unit test: Enter on focused item triggers `selectConfigFile`

**Priority:** Should
**Story Points:** 2

---

## E-03: File Editing and Saving

### Story CE-07: Edit a config file

**As a** developer,
**I want** to type in the textarea to modify the selected file's content,
**so that** I can make changes to my Claude configuration.

**Acceptance Criteria:**
- [ ] The textarea is fully editable when a file is selected
- [ ] Any change to the textarea value triggers `setConfigContent(newValue)` in the store
- [ ] The textarea occupies the full editor area (`w-full h-full`)
- [ ] The textarea supports horizontal scrolling for long lines (`overflow-x: auto`, `white-space: pre`)
- [ ] Browser-native undo/redo (Ctrl+Z / Cmd+Z) works within the textarea
- [ ] The textarea is disabled (not editable) when `configLoading` or `configSaving` is `true`

**Definition of Done:**
- [ ] `onChange` handler on the textarea calls `setConfigContent`
- [ ] `configDirty` is derived as `activeConfigContent !== activeConfigOriginal`
- [ ] Unit test: typing in the textarea updates `activeConfigContent` and sets `configDirty = true`

**Priority:** Must
**Story Points:** 2

---

### Story CE-08: Save a config file

**As a** developer,
**I want** to save my changes by clicking the Save button or pressing Ctrl+S / Cmd+S,
**so that** my edits are persisted to disk.

**Acceptance Criteria:**
- [ ] A "Save" button with `variant="primary"` exists in the panel footer
- [ ] The Save button is disabled when `configDirty === false` or no file is selected
- [ ] The Save button is disabled during `configSaving === true` (shows "Saving..." label)
- [ ] Clicking Save calls `PUT /api/v1/config/files/{activeConfigFileId}` with `{ content: activeConfigContent }`
- [ ] On success: `activeConfigOriginal` is updated to the saved content, `configDirty` becomes `false`, a success toast is shown ("CLAUDE.md saved.")
- [ ] On success: the Save button returns to disabled state
- [ ] On failure: a red error toast is shown ("Could not save {filename}. Please try again."), the button returns to enabled, content is NOT discarded
- [ ] The success toast auto-dismisses after 3 seconds
- [ ] The error toast auto-dismisses after 5 seconds
- [ ] The Save button has `aria-label="Save {filename}"` (interpolated with current filename)
- [ ] Tooltip on Save button reads "Save (Ctrl+S)" on Windows/Linux and "Save (Cmd+S)" on Mac

**Definition of Done:**
- [ ] `saveConfigFile` action in the store calls the API and updates state
- [ ] `configSaving` is `true` during the API call
- [ ] Unit test: save success updates `activeConfigOriginal` and sets `configDirty = false`
- [ ] Unit test: save failure leaves `activeConfigContent` unchanged and `configDirty = true`
- [ ] Integration test: PUT request is sent with correct body and fileId

**Priority:** Must
**Story Points:** 3

---

## E-04: Dirty State and Unsaved Changes Guard

### Story CE-09: See unsaved changes indicator

**As a** developer,
**I want** to see a clear "Unsaved changes" indicator in the footer when I have made edits that haven't been saved,
**so that** I am always aware of my pending changes and don't lose them accidentally.

**Acceptance Criteria:**
- [ ] When `configDirty === true`, the footer shows a colored dot and the text "Unsaved changes"
- [ ] The indicator uses amber color: `text-amber-400` for text, `bg-amber-400` for the dot
- [ ] The indicator is `12px` font size and `font-medium`
- [ ] The indicator disappears immediately when the file is saved successfully
- [ ] The indicator element has `role="status"` and `aria-live="polite"`
- [ ] The indicator announces "Unsaved changes" to screen readers when `configDirty` transitions from `false` to `true`

**Definition of Done:**
- [ ] `DirtyIndicator` sub-component or inline JSX in ConfigEditor footer
- [ ] Unit test: indicator is visible when `configDirty = true`, hidden when `false`
- [ ] Accessibility test: `role="status"` present on the indicator element

**Priority:** Must
**Story Points:** 1

---

### Story CE-10: Confirm before switching files with unsaved changes

**As a** developer,
**I want** to see a confirmation dialog when I click a different file in the sidebar while I have unsaved changes,
**so that** I don't accidentally discard my edits.

**Acceptance Criteria:**
- [ ] When `configDirty === true` and user clicks a sidebar item, the discard dialog appears before loading the new file
- [ ] The dialog uses the existing `<Modal role="alertdialog">` component
- [ ] Dialog title: "Discard unsaved changes?"
- [ ] Dialog body: "You have unsaved changes to {currentFilename}. Switching files will discard them."
- [ ] Dialog has two buttons: "Cancel" (secondary, initial focus) and "Discard" (danger)
- [ ] Clicking "Cancel" closes the dialog and keeps the current file loaded with edits intact
- [ ] Clicking "Discard" closes the dialog and loads the newly selected file (discarding edits)
- [ ] Pressing Escape closes the dialog and selects Cancel (no discard)
- [ ] Focus returns to the sidebar after dialog closes

**Definition of Done:**
- [ ] `DiscardChangesDialog` component at `frontend/src/components/config/DiscardChangesDialog.tsx`
- [ ] Uses `<Modal role="alertdialog" aria-labelledby="discard-dialog-title">`
- [ ] Initial focus on Cancel button (handled by Modal's `initialFocusRef` prop or equivalent)
- [ ] Unit test: dialog appears when switching files with dirty state
- [ ] Unit test: Cancel keeps current content, Discard loads new file

**Priority:** Must
**Story Points:** 3

---

### Story CE-11: Confirm before closing the panel with unsaved changes

**As a** developer,
**I want** to see a confirmation dialog when I close the config panel while I have unsaved changes,
**so that** I don't accidentally discard my edits by closing the panel.

**Acceptance Criteria:**
- [ ] When `configDirty === true` and user clicks the close button (X), the discard dialog appears
- [ ] When `configDirty === true` and user clicks the ConfigToggle button to close the panel, the discard dialog appears
- [ ] Dialog body: "You have unsaved changes to {currentFilename}. Closing the panel will discard them."
- [ ] Clicking "Cancel" closes the dialog and leaves the panel open with edits intact
- [ ] Clicking "Discard" closes the dialog and closes the panel (discarding edits)
- [ ] The same `DiscardChangesDialog` component is reused with different body text

**Definition of Done:**
- [ ] `DiscardChangesDialog` accepts a `context: "switch" | "close"` prop that controls the body text
- [ ] `toggleConfigPanel` action in the store checks `configDirty` before closing and triggers the dialog if needed
- [ ] Unit test: close button with dirty state opens dialog
- [ ] Unit test: Discard in dialog closes the panel

**Priority:** Must
**Story Points:** 2

---

## E-05: Keyboard Shortcuts

### Story CE-12: Save with Ctrl+S / Cmd+S

**As a** developer,
**I want** to save the current file using the standard keyboard shortcut Ctrl+S (or Cmd+S on Mac),
**so that** I can save without moving my hands from the keyboard to the mouse.

**Acceptance Criteria:**
- [ ] When the config panel is open and `configDirty === true`, pressing Ctrl+S (Windows/Linux) or Cmd+S (Mac) triggers the save action
- [ ] The shortcut is active only when focus is within the config panel (panel root element or any child)
- [ ] The shortcut does not fire when a dialog is open over the panel
- [ ] The shortcut does not fire when `configSaving === true` (save already in progress)
- [ ] The shortcut prevents the browser's default "Save page" dialog (`event.preventDefault()`)
- [ ] The save flow is identical to clicking the Save button (same success/error states)

**Definition of Done:**
- [ ] `useEffect` with `keydown` listener attached to the ConfigPanel root element
- [ ] Listener checks `event.key === 's'` and `event.metaKey || event.ctrlKey`
- [ ] Unit test: Ctrl+S dispatches `saveConfigFile` when panel is open and dirty
- [ ] Unit test: Ctrl+S does nothing when editor is clean

**Priority:** Should
**Story Points:** 2

---

## E-06: Error Handling

### Story CE-13: Handle file list loading failure

**As a** developer,
**I want** to see a helpful error message when the config file list fails to load,
**so that** I understand what went wrong and can retry without having to close and reopen the panel.

**Acceptance Criteria:**
- [ ] If `GET /api/v1/config/files` fails (network error or 5xx), the sidebar shows an error state
- [ ] Error state shows: "Could not load config files." with a "Retry" button
- [ ] Clicking "Retry" re-calls `GET /api/v1/config/files`
- [ ] The error state does NOT show a toast (the sidebar error is sufficient context)
- [ ] The error state uses `text-text-secondary` styling (non-alarming, since it is recoverable)

**Definition of Done:**
- [ ] `configFilesError` state added to the store (or handled inline in the component)
- [ ] Unit test: sidebar renders error state when the API returns an error
- [ ] Unit test: Retry button re-fetches the file list

**Priority:** Must
**Story Points:** 2

---

### Story CE-14: Handle file content loading failure

**As a** developer,
**I want** to see a helpful error message when a selected file fails to load,
**so that** I can understand the problem and retry without losing my place in the sidebar.

**Acceptance Criteria:**
- [ ] If `GET /api/v1/config/files/{fileId}` fails (network error, 404, or 5xx), the editor area shows an error state
- [ ] Error state shows: "Could not load {filename}. Please try again." with a "Retry" button
- [ ] The sidebar item for the failed file is still shown as active (selection is not cleared)
- [ ] Clicking "Retry" re-calls the file read endpoint
- [ ] A red error toast is NOT shown for this error (inline error in editor area is cleaner)

**Definition of Done:**
- [ ] Editor area has an error sub-state rendered when `configFileLoadError` is set
- [ ] Unit test: editor shows error state when `getConfigFile` returns an error
- [ ] Unit test: Retry button clears the error and re-fetches

**Priority:** Must
**Story Points:** 2

---

### Story CE-15: Handle save failure

**As a** developer,
**I want** to see a clear error notification when a save fails,
**so that** I can retry the save and know that my edits have NOT been lost.

**Acceptance Criteria:**
- [ ] If `PUT /api/v1/config/files/{fileId}` returns 4xx or 5xx or a network error, a red toast appears
- [ ] Toast message: "Could not save {filename}. Please try again."
- [ ] The toast auto-dismisses after 5 seconds
- [ ] After the error, `activeConfigContent` is unchanged (user's edits are preserved in the textarea)
- [ ] `configDirty` remains `true` after the error
- [ ] The Save button is re-enabled after the error (so the user can retry immediately)
- [ ] `configSaving` is set back to `false` after the error

**Definition of Done:**
- [ ] `saveConfigFile` action catches errors and dispatches a toast via `useAppStore.getState().showToast(...)`
- [ ] Unit test: save failure leaves `configDirty = true` and `activeConfigContent` unchanged
- [ ] Unit test: save failure shows error toast

**Priority:** Must
**Story Points:** 2

---

## Summary Table

| Story | Epic | Title | Priority | Points |
|-------|------|-------|----------|--------|
| CE-01 | E-01 | Open config panel via header button | Must | 2 |
| CE-02 | E-01 | Close config panel | Must | 1 |
| CE-03 | E-01 | Config and terminal panels coexist | Should | 2 |
| CE-04 | E-02 | View list of config files | Must | 3 |
| CE-05 | E-02 | Select a file to view content | Must | 3 |
| CE-06 | E-02 | Keyboard navigation in file list | Should | 2 |
| CE-07 | E-03 | Edit a config file | Must | 2 |
| CE-08 | E-03 | Save a config file | Must | 3 |
| CE-09 | E-04 | See unsaved changes indicator | Must | 1 |
| CE-10 | E-04 | Confirm before switching files (dirty) | Must | 3 |
| CE-11 | E-04 | Confirm before closing panel (dirty) | Must | 2 |
| CE-12 | E-05 | Save with Ctrl+S / Cmd+S | Should | 2 |
| CE-13 | E-06 | Handle file list loading failure | Must | 2 |
| CE-14 | E-06 | Handle file content loading failure | Must | 2 |
| CE-15 | E-06 | Handle save failure | Must | 2 |
| | | **Total** | | **32** |

**Must:** 12 stories, 26 points
**Should:** 3 stories, 6 points
**Could / Won't:** 0 (deferred to future ADR: syntax highlighting, file creation, drag-to-reorder)
