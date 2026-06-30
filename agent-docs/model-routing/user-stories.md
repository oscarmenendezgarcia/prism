# User Stories: MODEL-1 — Per-Stage Model Routing

## Personas

| Persona | Role | Goal | Pain Point Today |
|---------|------|------|-----------------|
| **Alex (Operator)** | System admin, configures global settings | Set a default model per stage to control cost | Cannot set model without editing agent .md files shared by all |
| **Sam (Space owner)** | Team lead, owns one or more Prism spaces | Override model for expensive stages in their space | Must ask Alex to edit global config |
| **Taylor (Task author)** | Developer, creates pipeline tasks | Run one task with opus for extra quality | No per-task override exists |
| **Jordan (Run observer)** | Any user watching a pipeline run | Know which model ran each stage for debugging | run.json has no model info |

---

## Epics

### Epic 1 — Global Model Configuration (T-001, T-006)

#### Story 1.1 — Set default model per stage
**As Alex (Operator), I want to assign a specific model to each pipeline stage globally so that cheap/lightweight stages use inexpensive models while critical stages use frontier models.**

**Acceptance Criteria:**
- Given I open Config Panel and click "Model Routing" in the sidebar, I see a table with one row per pipeline stage.
- When I select "opus-4-5" chip for `senior-architect` and "haiku-4-5" for `qa-engineer-e2e`, and click "Save changes", the settings are persisted.
- When the next run starts, `senior-architect` spawns with `--model claude-opus-4-5` and `qa-engineer-e2e` with `--model claude-haiku-4-5`.
- When I reopen the panel, my selections are still shown.
- When no override is set for a stage, the stage runs with the model declared in its `.md` frontmatter (backward-compat).

**Definition of Done:**
- [ ] ModelRoutingSettings component renders and persists via `PUT /api/v1/settings`
- [ ] `deepMergeSettings` 3-level merge tested (partial update doesn't wipe unmentioned agents)
- [ ] `pipelineManager` injects `--model` into spawn args
- [ ] Vitest snapshot test for ModelRoutingSettings table structure

**Priority:** Must
**Story Points:** 5

---

#### Story 1.2 — Use custom model string not in presets
**As Alex, I want to type any model string (not just presets) so that I can use models not yet in the preset list (e.g., beta models, ollama local models).**

**Acceptance Criteria:**
- Given I'm on the "Model Routing" settings page, when I click on the active preset chip (e.g., "sonnet-4-5"), a text input appears with the current value pre-filled.
- I can clear the input and type `claude-opus-4-5-20260623` or `qwen2.5-coder:32b`.
- After saving, the custom string is sent as-is to `PUT /api/v1/settings` and stored.
- The preset chips remain visible; if the saved value matches a preset, the chip is highlighted on next open.

**Acceptance Criteria (API):**
- `PUT /api/v1/settings` with `pipeline.stageModels.senior-architect.model = "claude-opus-4-5-20260623"` returns 200.
- `PUT /api/v1/settings` with `pipeline.stageModels.senior-architect.model = ""` (empty string) returns 400 with `VALIDATION_ERROR`.

**Priority:** Must
**Story Points:** 2

---

#### Story 1.3 — Reset a stage to its frontmatter default
**As Alex, I want to clear a per-stage override so that the stage reverts to using the model declared in its agent .md file.**

**Acceptance Criteria:**
- Given a stage has an override saved, I see a "Clear" ghost button on that stage's row.
- When I click "Clear" and save, the `agentId` key is removed from `settings.pipeline.stageModels`.
- On next run, the stage uses the model from its `.md` frontmatter (not the cleared override).
- The "Clear" button is not shown on rows where no override is set.

**Priority:** Should
**Story Points:** 1

---

### Epic 2 — Space-Level Model Override (T-003, T-005, T-007)

#### Story 2.1 — Override model for a specific space
**As Sam (Space owner), I want to set a different model for one or more stages in my space so that my space can use a local model for cheap stages without affecting other spaces.**

**Acceptance Criteria:**
- Given I open the space edit modal for my space, I see a "Model Overrides" collapsible section.
- When I expand it, I see rows for each stage in my space's pipeline.
- Stages with no override show the global default as an italic placeholder (e.g., "sonnet-4-5 (global)").
- When I set `developer-agent` to `qwen2.5-coder:32b`, it saves to the space's `stage_models` SQLite column.
- When a run starts in my space, `developer-agent` uses `qwen2.5-coder:32b`; other stages use global defaults.

**Acceptance Criteria (API):**
- `PUT /api/v1/spaces/:spaceId` with `{ stageModels: { "developer-agent": { ... } } }` returns 200 with the space including `stageModels`.
- `GET /api/v1/spaces/:spaceId` returns `stageModels: { "developer-agent": { ... } }` for the updated space.
- `GET /api/v1/spaces/:otherSpaceId` returns `stageModels: null` for spaces with no override.

**Definition of Done:**
- [ ] `stage_models TEXT` column added to `spaces` table (migration backward-compat)
- [ ] Space edit modal shows "Model Overrides" section
- [ ] `PUT /api/v1/spaces/:spaceId` validates each stageModels entry
- [ ] Space handler integration test

**Priority:** Should
**Story Points:** 3

---

#### Story 2.2 — Add and remove individual space overrides
**As Sam, I want to add an override for a stage that wasn't in my initial list and remove one I no longer need.**

**Acceptance Criteria:**
- Given the Model Overrides section is expanded, I see a "+ Add override" button.
- Clicking it adds a new row with an agent dropdown (showing unset agents first) + provider + model inputs.
- I can fill in the new row and save.
- I can click the "✕" icon on an existing override row to remove it; save persists the removal.

**Priority:** Could
**Story Points:** 2

---

### Epic 3 — Task-Level Model Override (T-003, T-005, T-008)

#### Story 3.1 — Override model for a single task run
**As Taylor (Task author), I want to override the model for one specific task so that I can run it with a better model for higher quality without changing the space or global config.**

**Acceptance Criteria:**
- Given I open the task detail drawer, I see a "Model Overrides" collapsible section.
- When I expand it, I see rows for stages in the task's pipeline.
- When I set `senior-architect` to `claude-opus-4-5` and save, the task's `stageModels` is persisted.
- When the pipeline runs for this task, `senior-architect` uses the task override (highest priority — overrides space and global).
- Other stages with no task override fall through to space → global → frontmatter.

**Acceptance Criteria (API):**
- `PUT /api/v1/spaces/:spaceId/tasks/:taskId` with `{ stageModels: { "senior-architect": { ... } } }` returns 200.
- MCP `kanban_update_task` with `stageModels` field passes through to SQLite.

**Priority:** Must
**Story Points:** 3

---

#### Story 3.2 — Clear task-level override after run
**As Taylor, I want to clear the task-level override after a special run so that future runs use the space/global defaults.**

**Acceptance Criteria:**
- Given a task has `stageModels` set, the "Model Overrides" section shows "✕" buttons.
- Clicking "✕" and saving removes that agent's entry from `task.stageModels`.
- If all overrides are cleared, `task.stageModels` becomes `null` in the DB.

**Priority:** Should
**Story Points:** 1

---

### Epic 4 — Observability: Model per Stage in Run History (T-004, T-008)

#### Story 4.1 — See which model ran each stage
**As Jordan (Run observer), I want to see the model name next to each stage in the run history so that I can quickly diagnose cost issues or understand why a stage behaved differently.**

**Acceptance Criteria:**
- Given a pipeline run completed after MODEL-1 is deployed, the run history panel shows each stage row with a model badge (e.g., `opus-4-5` chip in JetBrains Mono, violet tint).
- The badge shows a shortened model name; hovering shows the full string as a tooltip.
- For completed stages, the badge is static. For a running stage, the badge is shown immediately (model is written at spawn time, not completion).
- Runs started before MODEL-1 show no badge and no empty chip (backward compat — no crash).

**Definition of Done:**
- [ ] `stageStatuses[i].model` written to `run.json` at spawn time
- [ ] RunHistoryEntry (or PipelineRunGroup expanded row) renders model badge when `run.model` is present
- [ ] No crash when `run.model` is undefined (old runs)
- [ ] Badge uses JetBrains Mono (`font-mono` Tailwind class)

**Priority:** Must
**Story Points:** 2

---

#### Story 4.2 — See which inheritance layer provided the model
**As Jordan, I want to know whether the model for a stage came from the task, space, global settings, or frontmatter so that I can understand why a stage used an unexpected model.**

**Acceptance Criteria:**
- Given a run's `stageStatuses[i]`, the `resolvedFrom` field is `"task"`, `"space"`, `"settings"`, or `"frontmatter"`.
- In the run history detail view (log panel), hovering the model badge shows a tooltip: "claude-opus-4-5 · set by task" or "claude-sonnet-4-5 · inherited from global settings".

**Priority:** Could
**Story Points:** 1

---

### Epic 5 — Edge Cases and Non-Functional

#### Story 5.1 — Backward compatibility: zero breaking changes
**As any existing Prism user, I want MODEL-1 to not change any existing behavior so that my existing settings, runs, and agent files continue to work unchanged.**

**Acceptance Criteria:**
- Given no `stageModels` is configured anywhere (fresh install or existing install), pipeline runs produce identical shell commands to pre-MODEL-1.
- Existing `run.json` files without `model`/`provider`/`cliTool` fields in `stageStatuses` load without error.
- Existing `spaces` and `tasks` rows without the `stage_models` column (pre-migration) work after the server restarts.

**Priority:** Must
**Story Points:** 0 (covered by T-001 + T-003 acceptance criteria)

---

#### Story 5.2 — Binary resolution failure is surfaced as a clear error
**As Alex, I want to see a clear error when a configured CLI binary cannot be found so that I'm not left wondering why a stage silently failed.**

**Acceptance Criteria:**
- Given `cliTool: "opencode"` is configured and the opencode binary is not found in PATH or known install paths, the stage fails immediately with `status: "failed"` and an `AGENT_SPAWN_ERROR` event logged.
- `stageStatuses[i].error` contains a message: "Could not find opencode binary. Install it with `npm i -g @opencode/cli` or set a custom binary path in settings."
- The run does not hang; remaining stages are skipped.

**Priority:** Should
**Story Points:** 1 (covered by CliAdapter T-002)
