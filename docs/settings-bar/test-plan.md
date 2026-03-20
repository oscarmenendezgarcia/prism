# Test Plan: Settings Bar Redesign (feature/settings-bar)

**Date:** 2026-03-20
**Author:** qa-engineer-e2e
**Branch:** feature/settings-bar
**ADR:** docs/settings-bar/ADR-1.md
**Blueprint:** docs/settings-bar/blueprint.md

---

## Executive Summary

The settings-bar feature restructures the Header right-section into three visually distinct zones
(Panel Toggles | CTA | Utility Strip), normalizes all toggle button styles to a single spec
(w-9 h-9 rounded-xl), and extracts the Agent Settings gear into a standalone `AgentSettingsToggle`
component. T-008 also adds `taskId` to the `PipelineRun` type and surfaces agent config files
in `ConfigFileSidebar`.

**Key risks:**
1. The `startPipeline` store action signature changed (added `taskId` parameter) — all callers
   must pass both `spaceId` and `taskId`. One existing test asserts only `spaceId` was passed,
   indicating a call-site or test mismatch.
2. The `executeAgentRun` store action sends `\r` (carriage return) to the PTY but the test
   expects `\n` (newline). One must be wrong; the PTY requires `\r` for Enter but the test was
   written expecting `\n`.
3. The terminal-sender null-polling path in `executeAgentRun` has a 3-second busy-wait loop
   that causes one test to exceed the 5-second timeout.
4. `ConfigFileSidebar` gained an "Agents" scope section (T-008) with zero test coverage.

**Merge gate status:** BLOCKED — 3 failed frontend tests (1 Medium, 2 Low-severity test issues).

---

## 1. Scope & Objectives

### In Scope
- `AgentSettingsToggle` component (new) — T-001, T-007
- `TerminalToggle`, `ConfigToggle`, `ThemeToggle` style normalization — T-002, T-003, T-004
- `Header.tsx` zone restructure — T-005
- `AgentLauncherMenu` createPortal + viewport-clamped dropdown — T-008
- `ConfigFileSidebar` agent-files section — T-008
- `PipelineRun.taskId` type field — T-008
- `server.js` `-p` flag removal — T-008

### Out of Scope
- Config Editor Panel backend logic (pre-existing)
- Terminal PTY backend (pre-existing)
- Agent Launcher backend endpoints (pre-existing; backend test failures are pre-existing)
- Performance and security testing (pure CSS/UI change with no new API surface)

---

## 2. Test Levels

### 2.1 Unit Tests

| ID     | Component                 | Test File                                              | Coverage Area                                    |
|--------|---------------------------|--------------------------------------------------------|--------------------------------------------------|
| UT-001 | AgentSettingsToggle       | `__tests__/components/AgentSettingsToggle.test.tsx`   | render, aria-label, aria-pressed, click toggle, active/inactive classes |
| UT-002 | TerminalToggle            | `__tests__/components/TerminalToggle.test.tsx`        | render, aria-pressed, click, active style        |
| UT-003 | ConfigToggle              | `__tests__/components/ConfigToggle.test.tsx`          | render, aria-pressed, click, active style        |
| UT-004 | ThemeToggle               | `__tests__/components/ThemeToggle.test.tsx`           | render, 3-step cycle, aria-label, localStorage   |
| UT-005 | Header                    | `__tests__/components/Header.test.tsx`                | brand, New Task, Terminal toggle, ThemeToggle, AgentSettings toggle open/close |
| UT-006 | AgentLauncherMenu         | `__tests__/components/AgentLauncherMenu.test.tsx`     | trigger, dropdown, agent select, disabled, outside-click, Run Full Pipeline |
| UT-007 | ConfigFileSidebar         | `__tests__/components/ConfigFileSidebar.test.tsx`     | global/project scope rendering, active highlight, loading state, empty state |
| UT-008 | useAppStore.startPipeline | `__tests__/stores/useAppStore.test.ts`                | pipeline state creation with spaceId + taskId    |
| UT-009 | useAppStore.executeAgentRun | `__tests__/stores/useAppStore.test.ts`              | sender called with cmd+newline, sets activeRun, null-sender flow |

### 2.2 Integration Tests

| ID     | Area                                   | Description                                                       |
|--------|----------------------------------------|-------------------------------------------------------------------|
| IT-001 | AgentSettingsToggle ↔ Store            | Click toggle in Header — agentSettingsPanelOpen flips in real store |
| IT-002 | Header zone layout                     | All three groups render in correct DOM order (Panel Toggles, divider, CTA, divider, Utility) |
| IT-003 | startPipeline signature               | Verify AgentLauncherMenu passes both spaceId AND taskId to startPipeline |
| IT-004 | ConfigFileSidebar agent scope section | Render sidebar with scope=agent files; "Agents" heading and file items appear |

### 2.3 E2E / Visual Tests (manual — T-006)

| ID     | Scenario                               | Viewport   | Expected                                          |
|--------|----------------------------------------|------------|---------------------------------------------------|
| E2E-001 | Toggle button sizes equal            | 1440px     | All four buttons visually identical (36×36px)     |
| E2E-002 | Active state — agent settings open   | 1440px     | Blue tint appears on AgentSettingsToggle only     |
| E2E-003 | Active state — terminal open         | 1440px     | Blue tint on TerminalToggle; others inactive      |
| E2E-004 | ThemeToggle rightmost placement      | 1280px     | ThemeToggle is last child of header flex row      |
| E2E-005 | Dividers visible                     | 1440px     | Two vertical lines separate zone groups           |
| E2E-006 | No layout shift on theme cycle       | 1440px     | Header dimensions unchanged across all three themes |
| E2E-007 | AgentLauncherMenu portal position    | 1440px     | Dropdown appears below trigger, never clips viewport |
| E2E-008 | AgentLauncherMenu closes on Escape   | 1440px     | Menu dismissed, focus returns to trigger          |

### 2.4 Accessibility Tests

| ID     | Check                          | Expected                                                        |
|--------|--------------------------------|-----------------------------------------------------------------|
| A11Y-001 | AgentSettingsToggle aria-label | Dynamic: "Open agent settings" / "Close agent settings"         |
| A11Y-002 | AgentSettingsToggle aria-pressed | Boolean: false (closed) / true (open)                         |
| A11Y-003 | TerminalToggle aria-pressed    | Boolean matching terminalOpen store state                       |
| A11Y-004 | ConfigToggle aria-pressed      | Boolean matching configPanelOpen store state                    |
| A11Y-005 | ThemeToggle aria-label         | Describes next theme action (e.g., "Switch to light mode")      |
| A11Y-006 | Dividers aria-hidden           | Both dividers have aria-hidden="true"                           |
| A11Y-007 | New Task aria-label            | "Add new task"                                                  |
| A11Y-008 | AgentLauncherMenu role         | Dropdown has role="menu"; trigger has aria-haspopup and aria-expanded |

### 2.5 Security Tests

No new API surface introduced. All changes are pure frontend CSS/component extraction.
OWASP checks: Not applicable to this changeset. No user input, no HTTP endpoints added.

### 2.6 Performance Tests

Not applicable. This is a CSS normalization and component extraction. No measurable performance
delta expected. Vite production build bundle size delta is negligible (AgentSettingsToggle is
~30 lines, no new dependencies added — NFR-6 confirmed met).

---

## 3. Test Case Table

| ID      | Type        | Description                                              | Input / Trigger                     | Expected Output                                          | Priority |
|---------|-------------|----------------------------------------------------------|-------------------------------------|----------------------------------------------------------|----------|
| TC-001  | unit        | AgentSettingsToggle renders with closed aria-label       | agentSettingsPanelOpen=false        | Button name = "Open agent settings"                      | High     |
| TC-002  | unit        | AgentSettingsToggle renders with open aria-label         | agentSettingsPanelOpen=true         | Button name = "Close agent settings"                     | High     |
| TC-003  | unit        | AgentSettingsToggle aria-pressed=false when closed       | agentSettingsPanelOpen=false        | aria-pressed attribute = "false"                         | High     |
| TC-004  | unit        | AgentSettingsToggle aria-pressed=true when open          | agentSettingsPanelOpen=true         | aria-pressed attribute = "true"                          | High     |
| TC-005  | unit        | AgentSettingsToggle calls setAgentSettingsPanelOpen(true) | Click when closed                  | Mock setter called with true                             | High     |
| TC-006  | unit        | AgentSettingsToggle inactive classes when closed         | agentSettingsPanelOpen=false        | className contains "text-text-secondary"                 | Medium   |
| TC-007  | unit        | AgentSettingsToggle active classes when open             | agentSettingsPanelOpen=true         | className contains "text-primary"                        | Medium   |
| TC-008  | unit        | TerminalToggle w-9 h-9 rounded-xl spec                   | Render TerminalToggle               | className contains "w-9 h-9 rounded-xl"                  | High     |
| TC-009  | unit        | ConfigToggle w-9 h-9 rounded-xl spec                     | Render ConfigToggle                 | className contains "w-9 h-9 rounded-xl"                  | High     |
| TC-010  | unit        | ThemeToggle w-9 h-9 rounded-xl spec                      | Render ThemeToggle                  | className contains "w-9 h-9 rounded-xl"                  | High     |
| TC-011  | unit        | Header contains AgentSettingsToggle                      | Render Header                       | "Open agent settings" button present                     | High     |
| TC-012  | unit        | Header contains ConfigToggle                             | Render Header                       | "Toggle configuration editor" button present             | High     |
| TC-013  | unit        | Header contains TerminalToggle                           | Render Header                       | "Toggle terminal panel" button present                   | High     |
| TC-014  | unit        | Header contains ThemeToggle                              | Render Header                       | "Switch to ..." button present                           | High     |
| TC-015  | unit        | Header New Task button triggers openCreateModal          | Click "New Task"                    | openCreateModal mock called once                         | High     |
| TC-016  | unit        | AgentLauncherMenu passes spaceId+taskId to startPipeline | Click "Run Full Pipeline"           | startPipeline called with (spaceId, taskId)              | High     |
| TC-017  | unit        | ConfigFileSidebar renders "Agents" section               | configFiles with scope=agent        | "Agents" heading and agent file items visible            | Medium   |
| TC-018  | unit        | executeAgentRun sends cmd+carriage-return to PTY         | Call with preparedRun, senderFn     | senderFn called with cliCommand + '\r'                   | Medium   |
| TC-019  | integration | startPipeline creates pipelineState with taskId          | Store call with spaceId+taskId      | pipelineState.taskId equals passed taskId                | High     |
| TC-020  | e2e         | All four toggle buttons render at 36×36px                | Visual inspection at 1440px         | Pixel-equal button sizes                                 | Medium   |
| TC-021  | a11y        | Dividers have aria-hidden=true                           | Render Header                       | Both divider elements have aria-hidden="true"            | Medium   |
| TC-022  | a11y        | AgentLauncherMenu trigger has aria-haspopup="true"       | Render AgentLauncherMenu            | Button aria-haspopup attribute = "true"                  | Medium   |

---

## 4. Environment Requirements

| Requirement       | Value                                              |
|-------------------|----------------------------------------------------|
| Node.js           | 23.x (confirmed by engine in package.json area)    |
| Frontend runner   | Vitest 2.1.9 via `npm test` in `frontend/`         |
| Backend runner    | `node --test 'tests/*.test.js'` from project root  |
| Server (backend)  | `node server.js` on port 3000 (must be running)    |
| OS                | macOS Darwin 24.6.0 (darwin)                       |

---

## 5. Assumptions & Exclusions

- **Assumption A1:** The three pre-existing backend test failures in `tests/agent-launcher.test.js`
  (SPACE_NOT_FOUND for spaceId='default') are pre-existing issues not introduced by this feature.
  They are noted in bugs.md as pre-existing advisory items.
- **Assumption A2:** T-006 (visual QA at three viewport widths) is a manual verification task.
  No automated visual regression tooling (Percy, Chromatic) is configured for this project.
- **Assumption A3:** No API spec (`api-spec.json`) was produced for this feature since it is
  a pure frontend/CSS change (NFR-1). Security and performance testing are therefore not
  applicable to this changeset.
- **Exclusion E1:** Performance profiling of Vite bundle size changes is excluded. The new
  component is CSS-class-only with no new dependencies (NFR-6 met).

---

## 6. Risk Assessment

| Risk                                              | Severity | Likelihood | Mitigation                                             |
|---------------------------------------------------|----------|------------|--------------------------------------------------------|
| startPipeline signature mismatch — test fails     | Medium   | Confirmed  | Update test to assert both spaceId and taskId          |
| executeAgentRun sends \r not \n — test fails      | Medium   | Confirmed  | Update test to expect '\r' (PTY carriage-return)       |
| Terminal-null polling busy-wait causes timeout    | Low      | Confirmed  | Increase testTimeout or use fake timers in test        |
| ConfigFileSidebar agent-scope section untested    | Medium   | Confirmed  | Add test cases for scope=agent file rendering          |
| Inline-style usage in AgentLauncherMenu (style={{}}) | Low   | Confirmed  | Flagged as CLAUDE.md violation; replace with Tailwind  |
