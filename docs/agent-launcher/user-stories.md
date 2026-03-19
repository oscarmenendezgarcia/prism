# User Stories: Agent Launcher

**Project:** Prism — Agent Launcher from Task Cards
**Date:** 2026-03-19
**Author:** ux-api-designer
**Branch:** feature/agent-launcher

---

## Personas

**Primary:** Oscar (solo developer, technical user). Uses Prism as a local Kanban board to orchestrate AI coding agents. He is comfortable with CLI tools and understands the agent pipeline model. He wants to avoid repetitive prompt assembly by hand and wants to see live output in his familiar terminal environment.

---

## Epics

| Epic | Name | Priority |
|------|------|----------|
| E-01 | Agent Discovery | Must |
| E-02 | Single Agent Launch | Must |
| E-03 | Prompt Preview and Edit | Should |
| E-04 | Active Run Feedback | Should |
| E-05 | Pipeline Mode | Should |
| E-06 | CLI Settings | Must |
| E-07 | Board Auto-Refresh on Agent Changes | Could (already exists) |

---

## Epic E-01: Agent Discovery

### Story E-01-S1
**As a developer**, I want to see a list of available AI agents on task cards so that I can choose the right agent for a task without leaving the board.

**Acceptance Criteria:**
- When I click "Run Agent" on a task card, a dropdown lists all .md files found in `~/.claude/agents/`.
- Each agent is shown with its display name (e.g., "Senior Architect" from `senior-architect.md`).
- The list is loaded on first dropdown open and cached for the session; a manual retry button is available on error.
- If `~/.claude/agents/` is empty or does not exist, the dropdown shows an empty state with a link to Settings.
- The list is sorted alphabetically by display name.

**Definition of Done:**
- `GET /api/v1/agents` returns correct data from the filesystem.
- Dropdown renders within 100ms of clicking the trigger.
- Empty and error states are rendered and tested.
- Touch target on Run Agent button is minimum 44x44px.

**Priority:** Must
**Story Points:** 3

---

### Story E-01-S2
**As a developer**, I want agent discovery to be automatic so that I do not need to configure anything when I add or rename an agent file.

**Acceptance Criteria:**
- Adding a new .md file to `~/.claude/agents/` and reopening the dropdown shows the new agent.
- Renaming or deleting an agent file is reflected on next dropdown open.
- No server restart required for changes to be visible.

**Definition of Done:**
- `GET /api/v1/agents` reads the directory on every request (no in-memory cache on the server).
- Test confirms new file is returned after creation without restart.

**Priority:** Must
**Story Points:** 1

---

## Epic E-02: Single Agent Launch

### Story E-02-S1
**As a developer**, I want to launch a specific agent on a task card with two clicks so that I can start an agent run quickly without typing CLI commands manually.

**Acceptance Criteria:**
- I click the "Run Agent" icon (smart_toy) on a task card in the `todo` column.
- A dropdown opens listing all available agents.
- I click an agent name.
- A prompt preview modal opens showing the assembled CLI command and prompt preview.
- I click "Execute".
- The terminal panel opens (if closed) and the CLI command is injected into the PTY.
- The modal closes and an active run indicator appears in the header.

**Definition of Done:**
- Full flow works end-to-end: card click → dropdown → modal → terminal injection.
- `POST /api/v1/agent/prompt` is called before the modal opens.
- `{ type: "input", data: "command\n" }` is sent over the WebSocket.
- Manual test: command appears in terminal and agent begins executing.

**Priority:** Must
**Story Points:** 8 (combines T-012, T-013, T-015)

---

### Story E-02-S2
**As a developer**, I want "Run Agent" to be disabled while another agent is already running so that I do not accidentally inject two commands into the terminal.

**Acceptance Criteria:**
- When `activeRun` is non-null, the "Run Agent" button on every task card is `aria-disabled="true"` and shows a tooltip "Agent already running".
- Clicking a disabled button does nothing.
- The button re-enables immediately when `activeRun` is cleared.

**Definition of Done:**
- Zustand `activeRun` selector drives `disabled` prop on the button.
- Tooltip text is accessible (title attribute and/or aria-describedby).
- Test: button is disabled when store has activeRun set.

**Priority:** Must
**Story Points:** 2

---

### Story E-02-S3
**As a developer**, I want "Run Agent" to only appear on tasks in the `todo` column so that I do not accidentally re-run agents on tasks that are already in progress or done.

**Acceptance Criteria:**
- The "Run Agent" button is not rendered for tasks in `in-progress` or `done` columns.
- Moving a task from `todo` to `in-progress` (e.g., by clicking the move arrow) removes the button from that card.

**Definition of Done:**
- Button rendered conditionally based on column prop.
- Test: card in todo has button, card in in-progress does not.

**Priority:** Must
**Story Points:** 1

---

### Story E-02-S4
**As a developer**, I want the terminal panel to open automatically if it is closed when I click Execute so that I do not have to manually open it before running an agent.

**Acceptance Criteria:**
- If the terminal WebSocket is disconnected when Execute is clicked, the store calls `setTerminalOpen(true)` and waits 500ms before retrying the injection.
- A transient info toast "Opening terminal..." is shown during the wait.
- If the terminal fails to connect after 500ms, an error toast is shown: "Could not connect to terminal. Please open the terminal panel and try again."

**Definition of Done:**
- `executeAgentRun()` in the Zustand store implements the guard and retry logic.
- Test: when `terminalSender` is null, error toast appears after retry timeout.

**Priority:** Must
**Story Points:** 2

---

## Epic E-03: Prompt Preview and Edit

### Story E-03-S1
**As a developer**, I want to see the exact CLI command and a preview of the generated prompt before executing so that I can verify the context is correct and avoid surprises.

**Acceptance Criteria:**
- The preview modal shows the full CLI command string in a monospace code block with a Copy button.
- The prompt preview section shows the first 500 characters of the assembled prompt in a scrollable, read-only textarea.
- An estimated token count badge is displayed (e.g., "~2,400 tokens").
- The agent name and task title are shown at the top of the modal.

**Definition of Done:**
- `POST /api/v1/agent/prompt` response fields `cliCommand`, `promptPreview`, `estimatedTokens` are all rendered.
- Copy button copies `cliCommand` to clipboard and shows a "Copied" confirmation.
- Token badge uses `<Badge>` component.

**Priority:** Should
**Story Points:** 3

---

### Story E-03-S2
**As a developer**, I want to be able to edit the prompt before executing so that I can add context or adjust instructions for edge cases.

**Acceptance Criteria:**
- Clicking "Edit" in the preview modal makes the prompt textarea editable.
- Edited content replaces the original `promptPreview` in the display.
- Clicking "Execute" after editing uses the original `cliCommand` (editing the preview does not change the temp file — editing is visual only for v1).
- A visual indicator shows that the prompt has been edited ("Edited" label near the textarea).

**Definition of Done:**
- Edit mode toggled by a button; textarea switches between `readOnly` and editable.
- Edited text is stored in local component state, not sent back to the server.
- Note in UI: "Preview only — the full prompt is in the temp file."

**Priority:** Should
**Story Points:** 2

---

## Epic E-04: Active Run Feedback

### Story E-04-S1
**As a developer**, I want to see a live indicator in the header while an agent is running so that I always know the system is busy.

**Acceptance Criteria:**
- When `activeRun` is non-null, the header shows a pulsing dot + agent display name + elapsed time (updated every second).
- The elapsed time format is: `0:42`, `1:05`, `12:34`.
- A "Cancel" button is shown next to the indicator.
- When `activeRun` is null, the indicator is completely hidden (no reserved space, no layout shift).

**Definition of Done:**
- `AgentRunIndicator` reads from Zustand `useActiveRun` selector.
- `setInterval` updates elapsed time every second; cleared on unmount or when `activeRun` is null.
- `animate-pulse` applied to the dot element.
- Test: indicator appears when `activeRun` is set, disappears when cleared.

**Priority:** Should
**Story Points:** 2

---

### Story E-04-S2
**As a developer**, I want to be able to cancel an agent run from the header so that I can stop a misbehaving agent without switching to the terminal manually.

**Acceptance Criteria:**
- Clicking "Cancel" in the active run indicator calls `cancelAgentRun()`.
- `cancelAgentRun()` sends `\x03` (Ctrl+C) via `terminalSender`.
- `activeRun` is cleared immediately in the store after Cancel is clicked (optimistic clear).
- A toast "Agent run cancelled." is shown.
- If `terminalSender` is null at cancel time (terminal disconnected), `activeRun` is still cleared and a toast "Terminal disconnected — run cleared." is shown.

**Definition of Done:**
- `cancelAgentRun()` action implemented in Zustand store.
- Test: Cancel button sends `\x03` and clears `activeRun`.

**Priority:** Should
**Story Points:** 2

---

### Story E-04-S3
**As a developer**, I want the board to automatically detect when an agent has finished so that `activeRun` is cleared without me having to click anything.

**Acceptance Criteria:**
- When the task associated with `activeRun` moves to the `done` column (detected via the 3-second board polling), `clearActiveRun()` is called automatically.
- A toast "Agent run completed: Senior Architect" is shown.
- The detection uses the existing polling cycle — no new polling interval is added.
- If `activeRun.taskId` is not found on the board (task was deleted mid-run), `activeRun` is cleared silently.

**Definition of Done:**
- `useAgentCompletion` hook implemented and mounted at app level.
- Test: mock board state change moves task to done, verify `clearActiveRun` is called.

**Priority:** Must
**Story Points:** 3

---

## Epic E-05: Pipeline Mode

### Story E-05-S1
**As a developer**, I want to run the full 4-stage pipeline (architect → ux → dev → qa) from a single action on a space so that I can run the entire AI workflow without manually triggering each stage.

**Acceptance Criteria:**
- The agent selector dropdown includes a "Run Full Pipeline" option (separated from the agent list by a divider).
- Clicking "Run Full Pipeline" opens a pipeline confirmation modal showing the 4 stages in order.
- Clicking "Start Pipeline" triggers `startPipeline(spaceId)`.
- The pipeline runs stages sequentially: it injects stage 1's command, waits for task(s) to reach `done`, then injects stage 2's command, and so on.
- A pipeline progress bar appears in the header showing completed, active, and pending stages.
- A toast is shown at pipeline completion: "Pipeline complete. All 4 stages finished."

**Definition of Done:**
- `startPipeline`, `advancePipeline`, `abortPipeline` actions implemented in store.
- `useAgentCompletion` hook calls `advancePipeline()` when pipeline mode is active.
- `PipelineProgressBar` component renders and updates correctly.
- Manual test: pipeline runs all 4 stages end-to-end.

**Priority:** Should
**Story Points:** 10 (combines T-018, T-019)

---

### Story E-05-S2
**As a developer**, I want to be asked for confirmation before the pipeline advances to the next stage (when the option is enabled) so that I can review each stage's output before the next agent starts.

**Acceptance Criteria:**
- When `pipeline.confirmBetweenStages` is true and a stage completes, a confirmation toast is shown: "Stage 2 (UX API Designer) complete. Start Stage 3 (Developer Agent)? [Yes] [Abort]".
- Clicking "Yes" calls `advancePipeline()`.
- Clicking "Abort" calls `abortPipeline()`.
- When `pipeline.confirmBetweenStages` is false, the next stage starts automatically without confirmation.

**Definition of Done:**
- `useAgentCompletion` checks `confirmBetweenStages` before calling `advancePipeline`.
- Toast renders with two action buttons.
- Test: both confirmation paths (auto-advance and confirm) are covered.

**Priority:** Should
**Story Points:** 3

---

### Story E-05-S3
**As a developer**, I want to be able to abort a pipeline mid-run so that I can stop it if an early stage produces incorrect results.

**Acceptance Criteria:**
- Clicking "Abort Pipeline" in the pipeline progress bar calls `abortPipeline()`.
- `abortPipeline()` sends `\x03` (Ctrl+C) to the terminal and sets `pipelineState.status` to `'aborted'`.
- The pipeline progress bar disappears after abort.
- A toast "Pipeline aborted at stage 2." is shown.
- The board state is not rolled back — tasks remain wherever the agent left them.

**Definition of Done:**
- `abortPipeline()` action implemented in store.
- Test: abort clears `pipelineState` and sends Ctrl+C.

**Priority:** Should
**Story Points:** 2

---

## Epic E-06: CLI Settings

### Story E-06-S1
**As a developer**, I want to configure which CLI tool Prism uses (claude / opencode / custom) so that I can use the launcher regardless of which AI CLI I have installed.

**Acceptance Criteria:**
- A settings panel is accessible from a gear icon (`settings`) in the header.
- The panel shows a radio group for CLI tool: "Claude Code", "OpenCode", "Custom".
- Selecting "Custom" reveals a text input for the binary path.
- Selecting "Claude Code" or "OpenCode" hides the custom binary input and uses the known binary name.
- A "Prompt Delivery Method" radio group allows choosing: `$(cat /path)`, `< /path`, `--file /path`.
- An "Additional Flags" text input shows the current flags (e.g., `--allowedTools "Agent,Bash,..."`).
- Clicking "Save Settings" calls `PUT /api/v1/settings` and shows a success toast.
- If save fails, an error toast is shown and the panel remains open.

**Definition of Done:**
- `AgentSettingsPanel` component built, wired to `agentSettingsSlice`.
- `GET /api/v1/settings` loads defaults; `PUT /api/v1/settings` persists changes atomically.
- Test: selecting OpenCode and saving writes `{ cli: { tool: "opencode", binary: "opencode" } }` to settings.

**Priority:** Must
**Story Points:** 5

---

### Story E-06-S2
**As a developer**, I want the pipeline settings (auto-advance, confirm between stages) to be configurable so that I can control how automated the pipeline runs.

**Acceptance Criteria:**
- The settings panel has a "Pipeline" section with:
  - Toggle: "Auto-advance stages" (default: on).
  - Toggle: "Confirm between stages" (default: on).
  - Read-only ordered list showing the 4 pipeline stage names.
- Saving the pipeline settings persists them via `PUT /api/v1/settings`.

**Definition of Done:**
- Pipeline settings toggles wired to `agentSettingsSlice.saveSettings`.
- Test: toggling auto-advance to false and saving is reflected in `GET /api/v1/settings` response.

**Priority:** Should
**Story Points:** 2

---

### Story E-06-S3
**As a developer**, I want to configure what content blocks are included in generated prompts so that I can exclude irrelevant blocks for specific workflows.

**Acceptance Criteria:**
- The settings panel has a "Prompt Content" section with:
  - Toggle: "Include Kanban instructions" (default: on).
  - Toggle: "Include Git instructions" (default: on).
  - Text input: "Working Directory" (optional, empty = auto-detect).
- Saved settings affect all subsequent calls to `POST /api/v1/agent/prompt`.

**Definition of Done:**
- `POST /api/v1/agent/prompt` reads settings from `data/settings.json` (or defaults) when assembling the prompt.
- Test: disabling Kanban block results in generated prompt without the Kanban section.

**Priority:** Should
**Story Points:** 2

---

### Story E-06-S4
**As a developer**, I want settings to persist across server restarts so that I do not have to reconfigure the CLI tool every time I restart Prism.

**Acceptance Criteria:**
- Settings are written to `data/settings.json` via atomic write (.tmp + rename).
- On server startup, `GET /api/v1/settings` returns the persisted settings.
- If `data/settings.json` does not exist, defaults are returned without error.

**Definition of Done:**
- Atomic write pattern implemented (identical to existing space persistence).
- Test: write settings, simulate server restart (re-read file), verify settings match.

**Priority:** Must
**Story Points:** 2

---

## Epic E-07: Board Auto-Refresh on Agent Changes (existing)

### Story E-07-S1
**As a developer**, I want the Kanban board to update automatically when an agent moves tasks so that I can see progress without manually refreshing.

**Acceptance Criteria:**
- The board refreshes within 3 seconds when an agent calls `kanban_move_task` via MCP.
- No action required from the user.

**Definition of Done:**
- This is already implemented via the 3-second polling loop in the existing codebase.
- Verified: no new work required; acceptance criteria met by existing behavior.

**Priority:** Could (already exists)
**Story Points:** 0

---

## Story Map (Full Feature)

```
Epic E-01 (Agent Discovery)
  E-01-S1  List agents in dropdown               Must   3 SP
  E-01-S2  Auto-discovery on file change         Must   1 SP

Epic E-02 (Single Agent Launch)
  E-02-S1  Two-click launch end-to-end           Must   8 SP
  E-02-S2  Disable button while run active       Must   2 SP
  E-02-S3  Button only in todo column            Must   1 SP
  E-02-S4  Auto-open terminal on Execute         Must   2 SP

Epic E-03 (Prompt Preview)
  E-03-S1  Show CLI command + preview            Should 3 SP
  E-03-S2  Edit prompt before executing          Should 2 SP

Epic E-04 (Active Run Feedback)
  E-04-S1  Pulsing indicator with elapsed time   Should 2 SP
  E-04-S2  Cancel from header                    Should 2 SP
  E-04-S3  Auto-clear on task done               Must   3 SP

Epic E-05 (Pipeline Mode)
  E-05-S1  Full pipeline launch                  Should 10 SP
  E-05-S2  Confirm between stages                Should  3 SP
  E-05-S3  Abort pipeline                        Should  2 SP

Epic E-06 (CLI Settings)
  E-06-S1  Configure CLI tool                    Must   5 SP
  E-06-S2  Configure pipeline settings           Should 2 SP
  E-06-S3  Configure prompt content blocks       Should 2 SP
  E-06-S4  Persist settings across restarts      Must   2 SP

Epic E-07 (Board Auto-Refresh)
  E-07-S1  Board refreshes when agent moves task Could  0 SP
```

**Total:** ~57 SP across 20 stories.

---

## Definition of Done (Feature-Level)

- All Must-priority stories implemented and passing tests.
- `GET /api/v1/agents`, `GET /api/v1/agents/:agentId`, `POST /api/v1/agent/prompt`, `GET /api/v1/settings`, `PUT /api/v1/settings` documented in api-spec.json and tested.
- Frontend test coverage >90% for new components and store slices.
- Backend test coverage >90% for new endpoints.
- No Critical or High bugs in the QA report.
- Manual smoke test: full pipeline runs all 4 stages end-to-end with a real Claude Code CLI.
- Accessibility: all new UI passes keyboard navigation and screen-reader label checks.
- No new npm dependencies introduced.
