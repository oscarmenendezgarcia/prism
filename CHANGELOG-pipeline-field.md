# Changelog — pipeline-field-per-card

## Feature: Per-Card Pipeline Field (ADR-1)

### T-001 — Extract validatePipelineField helper
- feat: `validatePipelineField(value)` exported from `src/handlers/tasks.js`
- Validates `pipeline` is `string[] | undefined`, max 20 elements, each ≤ 50 chars
- Empty array → `{ valid: true, data: undefined }` (clear semantics)
- Reused by create, update, and auto-task paths

### T-002 — Extend handleCreateTask with pipeline field
- feat: `POST /spaces/:id/tasks` now accepts optional `pipeline: string[]`
- Stored inline on task object when non-empty; omitted when absent or empty
- Structured log: `task.pipeline_field_set` emitted on every set

### T-003 — Extend handleUpdateTask with pipeline field
- feat: `pipeline` added to `UPDATABLE_FIELDS` in `handleUpdateTask`
- Non-empty array → replaces field; empty array → deletes key; absent → no change
- Structured log: `task.pipeline_field_set` emitted on every update

### T-004 — Extend handleCreateRun resolution chain
- feat: `handleCreateRun` now resolves `task.pipeline` between explicit stages and `space.pipeline`
- Resolution chain: explicit `stages` > `task.pipeline` > `space.pipeline` > `DEFAULT_STAGES`
- `resolvedFrom: 'task' | 'space' | 'default'` included in 201 response (MCP path)
- Structured log: `run.pipeline_resolved` emitted on every run creation

### T-005 — Extend auto-task system prompt
- feat: `src/prompts/autotask-system.txt` extended with rule 5 and optional `pipeline` field in schema
- Known agent IDs documented to prevent hallucination; "omit when uncertain" explicit

### T-006 — Extend handleAutoTaskGenerate
- feat: AI-generated pipeline fields validated with soft-strip semantics
- Unknown agent IDs (not in `PIPELINE_AGENTS_DIR`) stripped silently
- Invalid type stripped and logged; task still created
- `handleAutoTaskConfirm` preserves valid pipeline fields through the confirm flow

### T-007 — Extend MCP kanban_update_task
- feat: `pipeline: z.array(z.string()).optional()` added to `kanban_update_task` schema
- Empty array = clear semantics documented in tool description

### T-008 — Extend Task type + openPipelineConfirm resolver
- feat: `Task.pipeline?: string[]` added to `frontend/src/types/index.ts`
- `UpdateTaskPayload.pipeline?: string[]` added
- `openPipelineConfirm` resolver updated: task.pipeline > space.pipeline > agentSettings > DEFAULT_STAGES

### T-009 — Add pipeline field editor to TaskDetailPanel
- feat: `PipelineFieldEditor` inline component in `TaskDetailPanel.tsx`
- Collapsed (absent): "(space default)" label + Configure button
- Collapsed (set): agent chain "a → b → c" + Edit + Clear buttons
- Edit mode: ordered list with ↑/↓/✕ per stage + add-stage select + Save/Cancel
- No inline styles; Tailwind tokens only; no auto-save

### T-010 — Backend tests
- test: 27 tests in `tests/pipeline-field.test.js`
- Covers: validatePipelineField (8 branches), create (5), update (5), resolution chain (4), soft-validation (5)

### T-011 — Frontend tests
- test: 11 new tests added to `frontend/__tests__/components/TaskDetailPanel.test.tsx`
- Covers: collapsed (absent), collapsed (set), Clear, Configure, Edit, Save, Cancel, remove stage, Save empty, disabled state
