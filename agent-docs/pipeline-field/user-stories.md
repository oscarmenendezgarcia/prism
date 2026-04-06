# User Stories: Pipeline Field per Card

## Personas

**Oscar (the developer / sole user)** — technical user who runs Prism locally to manage AI agent pipelines.
Comfortable with agent IDs. Prefers minimal UI; values clarity over decoration.
Wants to configure once and not repeat himself for recurring task patterns.

---

## Epics

### Epic 1 — Manual Pipeline Configuration

#### Story US-1.1: Set a custom pipeline on a card

> As Oscar, I want to set a custom pipeline on a specific task card so that clicking "Run Pipeline" on that card always pre-populates the modal with the stages I've chosen, without having to adjust the list every time.

**Acceptance Criteria:**
- [ ] The TaskDetailPanel shows a "PIPELINE" section below the "Assigned" field.
- [ ] When no pipeline is set, the section displays "Pipeline: (space default)" in muted text and a "Configure" ghost button.
- [ ] Clicking "Configure" opens an inline editor within the panel (no modal).
- [ ] The editor shows an ordered list of agents with ↑/↓ reorder buttons and ✕ remove buttons.
- [ ] A native `<select>` dropdown lists all available agents and allows adding one at a time.
- [ ] A flow preview line shows the current stage chain (e.g., "developer-agent → qa-engineer-e2e").
- [ ] Clicking "Save" calls `PUT /api/v1/spaces/:spaceId/tasks/:taskId` with `{ pipeline: [...] }`.
- [ ] After saving, the section collapses to read mode showing the pill chain.
- [ ] A toast message "Pipeline saved" (success) appears for 3 seconds.
- [ ] The pipeline field is persisted in the task JSON file and survives page reload.

**Definition of Done:**
- [ ] TypeScript compiles without errors (no implicit any).
- [ ] Vitest tests cover: read mode (no pipeline), read mode (pipeline set), edit open/close, save, clear, cancel.
- [ ] No inline styles — Tailwind tokens only.
- [ ] Field is accessible: all buttons have aria-labels, stage list has role="list".

**Priority:** Must
**Story Points:** 5

---

#### Story US-1.2: Cancel pipeline editing without saving

> As Oscar, I want to cancel the pipeline editor without saving so that an accidental click on "Configure" or "Edit" doesn't accidentally change my pipeline.

**Acceptance Criteria:**
- [ ] A "Cancel" ghost button is always visible within the inline editor.
- [ ] Clicking Cancel collapses the editor and restores the previous pipeline value exactly.
- [ ] If the user opened the editor on a task with no pipeline, Cancel reverts to "space default" display.
- [ ] If the user opened the editor on a task with a custom pipeline, Cancel restores the original pills.
- [ ] No network request is made on Cancel.
- [ ] Focus returns to the "Configure" or "Edit" button after Cancel.
- [ ] Pressing Escape while the editor is open triggers Cancel (leverages existing panel Escape handler).

**Definition of Done:**
- [ ] Vitest test: cancel from empty state, cancel from set state.
- [ ] No toast shown on Cancel.

**Priority:** Must
**Story Points:** 2

---

#### Story US-1.3: Clear a custom pipeline (revert to space default)

> As Oscar, I want to clear the custom pipeline on a card so that the card reverts to using the space-level default pipeline, without having to set an empty array manually.

**Acceptance Criteria:**
- [ ] When a custom pipeline is set, a ✕ (Clear) icon button appears inline to the right of the pill chain.
- [ ] Clicking Clear immediately calls `PUT /tasks/:id` with `{ pipeline: [] }` (no confirmation dialog).
- [ ] The section reverts to "Pipeline: (space default)" display.
- [ ] A toast "Pipeline cleared — using space default" (success) appears for 3 seconds.
- [ ] The `pipeline` key is absent from the task JSON after clearing (not stored as `null` or `[]`).
- [ ] Clear is available only in read mode (not inside the editor, where removing all stages + Save achieves the same result).

**Definition of Done:**
- [ ] Backend returns task without `pipeline` key after PUT with `[]`.
- [ ] Vitest test: clear action, UI reverts to S-01.

**Priority:** Must
**Story Points:** 2

---

#### Story US-1.4: Edit an existing custom pipeline

> As Oscar, I want to edit the pipeline stages on a card that already has a custom pipeline so that I can add, remove, or reorder stages without starting from scratch.

**Acceptance Criteria:**
- [ ] When a custom pipeline is set, an ✏ (Edit) icon button appears inline to the right of the pill chain.
- [ ] Clicking Edit opens the inline editor pre-populated with the current pipeline stages in order.
- [ ] All editor capabilities from US-1.1 apply (add, remove, reorder, save, cancel).
- [ ] The flow preview hint reflects changes in real time as stages are added/removed/reordered.
- [ ] Save updates the pipeline field and collapses back to read mode with updated pills.

**Definition of Done:**
- [ ] Vitest test: edit from pre-populated state, reorder, save.
- [ ] No regression in US-1.1 (configure from empty) behavior.

**Priority:** Must
**Story Points:** 2

---

### Epic 2 — Pipeline Confirm Modal Integration

#### Story US-2.1: Pipeline Confirm Modal pre-populates from card pipeline

> As Oscar, when I click "Run Pipeline" on a card that has a custom pipeline set, I want the Pipeline Confirm Modal to pre-populate with those stages so that I don't have to manually configure the run every time.

**Acceptance Criteria:**
- [ ] When a task has `pipeline: ["developer-agent", "qa-engineer-e2e"]` and "Run Pipeline" is invoked, the modal opens with exactly those two stages in that order.
- [ ] The modal's stage list is still editable (user can add/remove/reorder before running).
- [ ] If the task has no `pipeline` field, the modal falls back to `space.pipeline` (existing behavior — no regression).
- [ ] If the task has `pipeline: []` (empty, treated as absent), the modal falls back to `space.pipeline`.
- [ ] The resolution is performed in `openPipelineConfirm` in `useAppStore.ts`.

**Definition of Done:**
- [ ] TypeScript store update compiles.
- [ ] Manual test: task with pipeline ["developer-agent"] → modal shows 1 stage.
- [ ] Regression: task without pipeline → modal shows space default stages.

**Priority:** Must
**Story Points:** 3

---

#### Story US-2.2: MCP agent benefits from card-level pipeline without explicit stages

> As an AI agent using `kanban_start_pipeline`, when I invoke the tool without an explicit `stages` parameter on a task that has a custom pipeline, I want the pipeline to resolve from the card's pipeline field automatically so that I don't need to look up the pipeline before launching.

**Acceptance Criteria:**
- [ ] `kanban_start_pipeline({ spaceId, taskId })` with no `stages` resolves `task.pipeline` as the first priority.
- [ ] `kanban_start_pipeline({ spaceId, taskId, stages: [...] })` with explicit stages always uses those stages (bypasses task.pipeline).
- [ ] The backend logs `{ event: "run.pipeline_resolved", resolvedFrom: "task", stages }` when `task.pipeline` is used.
- [ ] The backend logs `resolvedFrom: "space"` or `resolvedFrom: "default"` for the other two paths.
- [ ] The MCP tool description mentions the task-level pipeline override.

**Definition of Done:**
- [ ] Backend integration test covers all three resolvedFrom paths.
- [ ] MCP Zod schema is updated with accurate description.

**Priority:** Must
**Story Points:** 3

---

### Epic 3 — AI-Generated Tasks with Pipeline

#### Story US-3.1: AI action generates tasks with appropriate pipelines

> As Oscar, when I use the auto-task AI action to generate a set of tasks from a prompt, I want each generated task to optionally include a pre-configured pipeline that matches the scope of that task so that specialized tasks (e.g., bug fixes) already have the right agent sequence without me having to configure each card manually.

**Acceptance Criteria:**
- [ ] The auto-task system prompt instructs the AI to emit an optional `pipeline` array per task.
- [ ] The AI uses pipeline only when the task scope clearly maps to a non-default sequence.
- [ ] Known agent IDs listed in the prompt: `senior-architect`, `ux-api-designer`, `developer-agent`, `code-reviewer`, `qa-engineer-e2e`.
- [ ] The AI prompt explicitly states "omit when uncertain" to prevent over-production.
- [ ] Generated tasks with a valid `pipeline` field have it stored on the task JSON.
- [ ] Generated tasks with an invalid/unknown agent ID in `pipeline` have those IDs stripped silently (task still created).
- [ ] Generated tasks with no `pipeline` field are created normally (no regression).
- [ ] The UI for each generated task shows the pipeline in the TaskDetailPanel after the auto-task run completes.

**Definition of Done:**
- [ ] Backend unit test: AI returns `["nonexistent-agent"]` → stripped, task created without pipeline field.
- [ ] Backend unit test: AI returns `["developer-agent", "qa-engineer-e2e"]` → stored on task.
- [ ] `{ event: "autotask.pipeline_field_set", taskId, stages }` logged to stderr when field is stored.
- [ ] System prompt change does not break existing auto-task runs that return no pipeline field.

**Priority:** Should
**Story Points:** 3

---

#### Story US-3.2: Auto-task generated pipeline visible in UI immediately

> As Oscar, after the auto-task action generates tasks, I want to see the pipeline chips on each generated card's detail panel immediately so that I can verify the AI chose the right agent sequence before running.

**Acceptance Criteria:**
- [ ] After `handleAutoTaskGenerate` completes, the store is updated with the new tasks including their `pipeline` fields.
- [ ] Opening the detail panel for a generated task with a pipeline shows the pill chain in read mode.
- [ ] Opening the detail panel for a generated task without a pipeline shows "Pipeline: (space default)".
- [ ] No extra API call is needed to fetch the pipeline field — it is included in the task object returned by the auto-task endpoint.

**Definition of Done:**
- [ ] The auto-task API response includes `pipeline` in the task objects when set.
- [ ] Frontend type `Task` includes `pipeline?: string[]` for type safety.
- [ ] No regression in the auto-task create flow (tasks without pipeline render correctly).

**Priority:** Should
**Story Points:** 2

---

### Epic 4 — Validation and Error Handling

#### Story US-4.1: Invalid pipeline value rejected at the API with a clear error message

> As Oscar, when I accidentally pass an invalid value for the pipeline field (e.g., a string instead of an array), I want to receive a clear, actionable error message so that I can fix the request quickly.

**Acceptance Criteria:**
- [ ] `POST /tasks` or `PUT /tasks/:id` with `pipeline: "string"` returns HTTP 400 with:
  - `error.code: "VALIDATION_ERROR"`
  - `error.field: "pipeline"`
  - `error.message` explains the pipeline must be an array.
  - `error.suggestion` shows a correct example.
- [ ] Same for `pipeline: [21 items]` (exceeds max 20).
- [ ] Same for `pipeline: ["", "developer-agent"]` (empty string element).
- [ ] Same for `pipeline: ["x".repeat(51)]` (element exceeds 50 chars).
- [ ] Error messages use plain language — no internal stack traces.

**Definition of Done:**
- [ ] Unit tests cover all four invalid cases.
- [ ] Frontend shows a toast with the server's `error.message` when `updateTask` fails.

**Priority:** Must
**Story Points:** 2

---

#### Story US-4.2: Frontend warns before saving an empty pipeline

> As Oscar, if I remove all stages from the pipeline editor and click Save, I want to see a warning explaining that saving an empty pipeline will revert the card to the space default, so that I can make an informed decision.

**Acceptance Criteria:**
- [ ] When the stage list becomes empty in the editor, an inline warning banner appears:
  "An empty pipeline will revert this card to the space default when saved."
- [ ] The warning uses `bg-warning/10 border-warning/30` style and a `pause_circle` icon.
- [ ] The Save button remains **enabled** (saving empty = intentional clear).
- [ ] The warning disappears as soon as the user adds a stage back.
- [ ] `aria-live="polite"` on the warning banner so screen readers announce it.

**Definition of Done:**
- [ ] Vitest test: all stages removed → warning shown, Save enabled → save calls updateTask({ pipeline: [] }).
- [ ] Vitest test: stage added back → warning disappears.

**Priority:** Should
**Story Points:** 2

---

#### Story US-4.3: Frontend shows error when pipeline contains invalid data from AI

> As Oscar, if a task's pipeline field was set by AI and contains an invalid agent ID (e.g., a string longer than 50 characters that slipped through soft validation), I want the editor to show an error banner and disable Save so that I can't persist corrupt data.

**Acceptance Criteria:**
- [ ] When the editor is opened on a task with a pipeline containing an invalid stage, the error banner appears immediately.
- [ ] Save is disabled until the invalid stage is removed.
- [ ] The error banner message: "Pipeline contains an invalid stage. Agent IDs must be non-empty strings under 50 characters."
- [ ] `aria-live="polite"` on the error banner.
- [ ] The invalid stage is still displayed in the list so the user can identify and remove it.

**Definition of Done:**
- [ ] Vitest test: open editor with invalid stage → error shown, Save disabled → remove invalid stage → error gone, Save enabled.

**Priority:** Could
**Story Points:** 2

---

## MoSCoW Summary

| Story   | Priority |
|---------|----------|
| US-1.1  | Must     |
| US-1.2  | Must     |
| US-1.3  | Must     |
| US-1.4  | Must     |
| US-2.1  | Must     |
| US-2.2  | Must     |
| US-4.1  | Must     |
| US-3.1  | Should   |
| US-3.2  | Should   |
| US-4.2  | Should   |
| US-4.3  | Could    |

## Total Story Points

Must: 17 points
Should: 7 points
Could: 2 points
**Total: 26 points**

## Assumptions

| ID  | Assumption                                                                                          |
|-----|-----------------------------------------------------------------------------------------------------|
| A-1 | The pipeline field editor does not need drag-and-drop — up/down arrows are sufficient (same UX as PipelineConfirmModal). |
| A-2 | Clearing the pipeline (✕ Clear in read mode) requires no confirmation dialog — the operation is reversible by re-configuring. |
| A-3 | The pipeline field is not shown on the TaskCard chip row on the board surface — only in the detail panel. |
| A-4 | The Create Task modal does not expose the pipeline field at creation time — users configure it after creation in the detail panel. |
| A-5 | Agent display names are resolved client-side from `availableAgents` in the store — the server stores only agent IDs. |
| A-6 | If an agent ID in `task.pipeline` is not present in `availableAgents` (agent uninstalled), the editor shows the raw ID string in the pill as a fallback. |
