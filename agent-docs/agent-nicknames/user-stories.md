# User Stories: Agent Nicknames

## Personas

**Oscar (the solo developer)** — runs Prism locally as a personal pipeline orchestrator. Uses 1-3 spaces for different projects. Wants agent names that reflect the project's team vocabulary ("El Jefe", "Rafa") rather than technical IDs.

---

## Epics

### Epic 1: Configure Agent Nicknames

Stories covering the ability to assign, update, and clear nicknames for pipeline agents within a space.

---

#### Story AN-001: Set a nickname for a pipeline agent

**As Oscar, I want to assign a custom display name to each pipeline agent in a space, so that the pipeline UI reflects my team's vocabulary instead of technical agent IDs.**

**Acceptance Criteria:**
- [ ] The SpaceModal in rename mode shows a collapsible "Agent Nicknames (optional)" section.
- [ ] The section is collapsed by default.
- [ ] Expanding the section shows one row per agent in the space's configured pipeline (or the default 4-stage pipeline if none is configured).
- [ ] Each row shows the agent ID as a read-only label and a text input for the nickname.
- [ ] Typing "El Jefe" in the senior-architect input and saving persists the nickname in `spaces.json` under `agentNicknames.senior-architect`.
- [ ] The API response from `PUT /api/v1/spaces/:spaceId` includes `agentNicknames: { "senior-architect": "El Jefe" }`.
- [ ] A success toast "Space saved" appears after saving.
- [ ] The modal closes after a successful save.

**Definition of Done:**
- [ ] SpaceModal renders the nicknames section when `mode === 'rename'`.
- [ ] Local state `nicknames` is initialised from `space.agentNicknames` on modal open.
- [ ] `handleSubmit` passes `nicknames` to `renameSpace(id, name, wd, pipeline, nicknames)`.
- [ ] Backend `renameSpace()` accepts and persists `agentNicknames`.
- [ ] `PUT /api/v1/spaces/:spaceId` returns the updated space with `agentNicknames` in the body.
- [ ] Unit test: `normaliseNicknames` drops empty strings, trims values.
- [ ] Integration test: PUT with `agentNicknames` round-trips correctly.

**Priority:** Must (MoSCoW)
**Story Points:** 3

---

#### Story AN-002: Nickname section hidden in create mode

**As Oscar, I want the Agent Nicknames section to be invisible when creating a new space, so I am not confused by a feature that requires an existing space.**

**Acceptance Criteria:**
- [ ] In `mode === 'create'`, the "Agent Nicknames" section does not appear in the SpaceModal at all.
- [ ] No nickname-related state is initialised or submitted during space creation.

**Definition of Done:**
- [ ] SpaceModal conditionally renders the section only when `mode === 'rename'`.
- [ ] No regression in create-mode behavior.

**Priority:** Must (MoSCoW)
**Story Points:** 1

---

#### Story AN-003: Pre-fill existing nicknames on modal reopen

**As Oscar, I want to see my previously saved nicknames pre-filled when I reopen the Space Settings, so I can review and edit them without losing context.**

**Acceptance Criteria:**
- [ ] When the SpaceModal opens in rename mode for a space that already has `agentNicknames`, all inputs are pre-filled with their current nickname values.
- [ ] Inputs for agents with no nickname are empty (show placeholder only).
- [ ] The section remains collapsed by default even when nicknames exist (unless a stakeholder decision changes this — see wireframes.md Q2).

**Definition of Done:**
- [ ] `useEffect` initialises `nicknames` from `space.agentNicknames ?? {}` on every modal open.
- [ ] Manual test: set nicknames, close modal, reopen — values persist.

**Priority:** Must (MoSCoW)
**Story Points:** 1

---

#### Story AN-004: Clear all nicknames at once

**As Oscar, I want to clear all nicknames in a single click, so that I can reset to default agent labels quickly without editing each field individually.**

**Acceptance Criteria:**
- [ ] A "Clear all nicknames" link/button appears at the bottom of the expanded nicknames section.
- [ ] Clicking it resets all nickname inputs to empty in the local state immediately.
- [ ] The change is not persisted until the user clicks Save.
- [ ] After saving, all nickname entries are removed from `spaces.json` (the `agentNicknames` key may be absent or set to `{}`).

**Definition of Done:**
- [ ] Button calls `setNicknames({})` — clears local state.
- [ ] `type="button"` to prevent form submission.
- [ ] After save, `PUT /api/v1/spaces/:spaceId` with `agentNicknames: {}` results in `agentNicknames` absent from subsequent GET responses (normalised to empty = removed).

**Priority:** Must (MoSCoW)
**Story Points:** 1

---

#### Story AN-005: Nickname input validation (max 50 characters)

**As Oscar, I want to receive clear feedback if I enter a nickname that is too long, so I can fix it before saving.**

**Acceptance Criteria:**
- [ ] Nickname inputs enforce `maxLength={50}` — typing beyond 50 chars is blocked by the browser.
- [ ] If a value somehow exceeds 50 chars on submit (e.g. via paste), an inline error appears below the affected input: "Must not exceed 50 characters."
- [ ] The Save button remains enabled — the error is shown inline, not blocking the entire form.
- [ ] The API returns a `400 VALIDATION_ERROR` with `field: "agentNicknames.<agentId>"` if validation fails server-side.
- [ ] The frontend shows the API error message inline for the affected input.

**Definition of Done:**
- [ ] `maxLength={50}` on all nickname inputs.
- [ ] Client-side validation on submit: iterate nicknames, check `.trim().length > 50`.
- [ ] Error rendered with `role="alert"` and linked via `aria-describedby`.
- [ ] Backend validation in `normaliseNicknames` / `renameSpace` returns 400 with correct error shape.
- [ ] Unit test: client-side validation catches oversized values.
- [ ] Unit test: backend returns correct 400 error for oversized nickname.

**Priority:** Must (MoSCoW)
**Story Points:** 2

---

### Epic 2: Display Nicknames Across the UI

Stories covering the resolution and display of nicknames at every display site.

---

#### Story AN-006: Utility function resolves agent display name

**As a developer, I want a single utility function `resolveAgentName` that implements the nickname fallback chain, so that all display sites use consistent resolution logic.**

**Acceptance Criteria:**
- [ ] `resolveAgentName(agentId, space, agents?)` returns the nickname if set in `space.agentNicknames`.
- [ ] Falls back to `STAGE_DISPLAY[agentId]` if no nickname.
- [ ] Falls back to `agents[].displayName` if no static label.
- [ ] Falls back to the raw `agentId` if nothing else matches.
- [ ] Empty-string nickname values are treated as "not set" (fall through to next level).
- [ ] `resolveAgentShortLabel(agentId, space)` returns the nickname truncated to 6 chars + "…" if longer than 6, otherwise `STAGE_LABELS[agentId]` or `agentId.split('-')[0]`.

**Definition of Done:**
- [ ] `frontend/src/utils/agentName.ts` created with both functions.
- [ ] Unit tests cover all branches of the fallback chain for `resolveAgentName`.
- [ ] Unit tests cover all branches of `resolveAgentShortLabel` including truncation at exactly 6 chars and 7 chars.
- [ ] All existing display sites import from `agentName.ts` (no local resolver duplicates).

**Priority:** Must (MoSCoW)
**Story Points:** 2

---

#### Story AN-007: RunIndicator shows nickname

**As Oscar, I want to see the agent's nickname in the RunIndicator while a pipeline is running, so I can immediately recognise which of my project's agents is active.**

**Acceptance Criteria:**
- [ ] In single-agent mode, the `SingleAgentDot` component shows the resolved display name (nickname if set, otherwise static label).
- [ ] In multi-stage mode, the current active step node's label uses `resolveAgentShortLabel`.
- [ ] The paused banner shows the resolved display name for the paused stage.
- [ ] Hovering the agent name in RunIndicator (if tooltip is implemented) shows the raw agent ID for transparency.

**Definition of Done:**
- [ ] `RunIndicator.tsx` replaces local `STAGE_DISPLAY` lookups with `resolveAgentName(agentId, activeSpace, agents)`.
- [ ] `StepNodes` uses `resolveAgentShortLabel` for node labels.
- [ ] `PausedBanner` uses `resolveAgentName` for `stageName`.
- [ ] Active space is sourced from `useAppStore(s => s.spaces.find(sp => sp.id === s.activeSpaceId))`.
- [ ] No regression in RunIndicator behavior when `agentNicknames` is absent.

**Priority:** Must (MoSCoW)
**Story Points:** 2

---

#### Story AN-008: StageTabBar shows short nickname label

**As Oscar, I want the pipeline log tabs to show the agent's short nickname label, so I can identify stages by my custom names when reviewing logs.**

**Acceptance Criteria:**
- [ ] Each tab in `StageTabBar` uses `resolveAgentShortLabel(agentId, activeSpace)` for its label.
- [ ] If the nickname is longer than 6 characters, the tab shows the first 6 chars followed by "…".
- [ ] Hovering the truncated tab shows the full resolved display name in a tooltip.
- [ ] If no nickname is set, the tab label is unchanged from the current behavior.

**Definition of Done:**
- [ ] `StageTabBar.tsx` imports `resolveAgentShortLabel` from `agentName.ts`.
- [ ] `activeSpace` passed as a prop from the parent `PipelineLogPanel`.
- [ ] `title` attribute on each tab set to `resolveAgentName(agentId, activeSpace)` for the full-name tooltip.
- [ ] No visual regression at any viewport width.

**Priority:** Should (MoSCoW)
**Story Points:** 1

---

#### Story AN-009: PipelineConfirmModal shows nickname in stage list

**As Oscar, I want to see agent nicknames in the pipeline confirmation dialog before I run a task, so I can confirm which agents (by my custom names) will execute.**

**Acceptance Criteria:**
- [ ] Each stage listed in `PipelineConfirmModal` shows `resolveAgentName(agentId, activeSpace, agents)` instead of the raw agent ID.
- [ ] If no nickname is set, the static label is shown (unchanged from current behavior).

**Definition of Done:**
- [ ] `PipelineConfirmModal.tsx` imports `resolveAgentName`.
- [ ] `activeSpace` sourced from the store inside the modal.
- [ ] No regression in modal behavior.

**Priority:** Should (MoSCoW)
**Story Points:** 1

---

#### Story AN-010: TaskDetailPanel shows nickname in stage list

**As Oscar, I want to see agent nicknames in the task detail panel's pipeline stage list, so I can track which of my named agents completed, is running, or is pending.**

**Acceptance Criteria:**
- [ ] Each stage entry in `TaskDetailPanel`'s pipeline section shows `resolveAgentName(agentId, activeSpace, agents)`.
- [ ] Completed, running, and pending stage labels all use the resolved name.
- [ ] If no nickname is set, the existing label is shown (no regression).

**Definition of Done:**
- [ ] `TaskDetailPanel.tsx` replaces raw `{agentId}` render with `resolveAgentName`.
- [ ] `activeSpace` sourced from the store.
- [ ] No regression in TaskDetailPanel behavior.

**Priority:** Should (MoSCoW)
**Story Points:** 1

---

#### Story AN-011: SpaceModal pipeline selector shows resolved label

**As Oscar, I want the pipeline stage dropdowns in SpaceModal to show human-readable labels instead of raw agent IDs, so I can understand the stages I am configuring.**

**Acceptance Criteria:**
- [ ] The `<option>` elements in the pipeline stage selector use `resolveAgentName(agentId, space)` as the display text.
- [ ] The `value` attribute remains the raw agent ID (functional identifier, never changed).
- [ ] If no nickname is set, the static label is shown.

**Definition of Done:**
- [ ] `SpaceModal.tsx` uses `resolveAgentName` for stage option display text (not value).
- [ ] The raw agent ID is preserved as the option value.

**Priority:** Could (MoSCoW)
**Story Points:** 1

---

### Epic 3: Data Persistence and Backward Compatibility

---

#### Story AN-012: Existing spaces without agentNicknames continue to work

**As Oscar, I want all my existing spaces (which have no `agentNicknames` field) to continue working exactly as before, so that this feature introduction requires zero migration.**

**Acceptance Criteria:**
- [ ] Spaces without `agentNicknames` in `spaces.json` are loaded without errors.
- [ ] `resolveAgentName` gracefully handles `space.agentNicknames === undefined` and falls through to static labels.
- [ ] No write is made to `spaces.json` for existing spaces until the user explicitly saves nicknames.
- [ ] The nicknames section inputs are empty for spaces with no existing nicknames.

**Definition of Done:**
- [ ] `resolveAgentName` handles `null`, `undefined`, and missing `agentNicknames` without throwing.
- [ ] Backend `renameSpace` does not add `agentNicknames: {}` if the field was omitted from the request.
- [ ] Manual regression test: open an existing space in SpaceModal → nicknames section is empty → save without changes → `agentNicknames` not written to `spaces.json`.

**Priority:** Must (MoSCoW)
**Story Points:** 1

---

#### Story AN-013: Nickname changes are space-scoped

**As Oscar, I want nicknames set in one space to have no effect on other spaces, so that each project can have its own vocabulary independently.**

**Acceptance Criteria:**
- [ ] Nicknames saved in Space A do not appear in Space B's UI.
- [ ] Switching the active space in the kanban board immediately updates all nickname display sites to reflect the new active space's nicknames (or defaults if none set).
- [ ] The store selector `useActiveSpaceNicknames` returns the nicknames for the currently active space only.

**Definition of Done:**
- [ ] `resolveAgentName` always receives the current `activeSpace` (not a cached or global map).
- [ ] Manual test: set "El Jefe" in Space A, switch to Space B → RunIndicator shows "Senior Architect" (default), not "El Jefe".

**Priority:** Must (MoSCoW)
**Story Points:** 1

---

## Story Map Summary

| Story | Epic | Priority | Points |
|-------|------|----------|--------|
| AN-001 | Configure | Must | 3 |
| AN-002 | Configure | Must | 1 |
| AN-003 | Configure | Must | 1 |
| AN-004 | Configure | Must | 1 |
| AN-005 | Configure | Must | 2 |
| AN-006 | Display | Must | 2 |
| AN-007 | Display | Must | 2 |
| AN-008 | Display | Should | 1 |
| AN-009 | Display | Should | 1 |
| AN-010 | Display | Should | 1 |
| AN-011 | Display | Could | 1 |
| AN-012 | Persistence | Must | 1 |
| AN-013 | Persistence | Must | 1 |
| **Total** | | | **18** |

## Implementation Order (suggested)

1. AN-006 — utility function first (blocks all display sites)
2. AN-012, AN-013 — backward compatibility contracts
3. AN-001, AN-002, AN-003, AN-004, AN-005 — SpaceModal + backend
4. AN-007 — RunIndicator (highest-visibility display site)
5. AN-008, AN-009, AN-010 — remaining display sites
6. AN-011 — pipeline selector labels (lowest priority)
