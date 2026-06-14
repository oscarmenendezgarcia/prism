# User Stories: arc Field — Narrative Task Grouping (QOL-5)

**Feature:** `arc` — first-class task grouping field  
**Epic owner:** Product / Agent pipeline  
**ADR:** ADR-1 (Accepted)

---

## Personas

| Persona | Role | Needs |
|---------|------|-------|
| **Oscar** | Project owner, daily board user | Wants to visually group tasks by initiative without polluting titles |
| **Agent (pipeline)** | Senior Architect / Developer / UX designer | Creates tasks via MCP; needs `arc` to be a first-class field from the start |
| **Tagger (AI)** | Claude haiku running in AI Actions | Infers arc from title patterns; proposes it for user review |

---

## Epics

### Epic 1 — Arc persistence and API

**Goal:** Store and expose `arc` through all backend layers (DB, REST, MCP) without breaking existing consumers.

#### Story 1.1 — Persist arc on a task

> As **Oscar**, I want tasks to have an optional `arc` field stored in the database, so that the grouping label survives title renames and is queryable directly in SQL.

**Acceptance Criteria:**
- [ ] A fresh DB has an `arc TEXT` column in `CREATE TABLE tasks`
- [ ] An existing DB without `arc` gets the column added via `ALTER TABLE` on server start
- [ ] `insertTask({ arc: 'QOL' })` stores `'QOL'`; `insertTask({})` stores `NULL`
- [ ] `rowToTask` returns `task.arc = 'QOL'` when set; omits `arc` key when NULL
- [ ] `updateTask(id, { arc: 'AUTH' })` updates the column; `{ arc: null }` clears it
- [ ] `store.getDistinctArcs(spaceId)` returns sorted distinct non-null arc values

**Definition of Done:** All existing store tests pass; new arc-specific tests pass; migration test runs against a pre-migration DB.

**Priority:** Must  
**Story Points:** 3  
**Tasks:** T-001

---

#### Story 1.2 — API: create and update task with arc

> As **an agent using the REST API**, I want `POST /tasks` and `PUT /tasks/:id` to accept an optional `arc` field, so that I can set the grouping label from the start without a second round-trip.

**Acceptance Criteria:**
- [ ] `POST /spaces/:spaceId/tasks { arc: 'QOL' }` → 201 with `task.arc = 'QOL'`
- [ ] `POST /spaces/:spaceId/tasks` (no arc) → 201 with no `arc` field in response
- [ ] `PUT /spaces/:spaceId/tasks/:id { arc: 'AUTH' }` → 200 with `task.arc = 'AUTH'`
- [ ] `PUT ... { arc: '' }` → 200 with arc cleared (null in DB, omitted in response)
- [ ] `PUT ...` body without `arc` key → arc unchanged in DB
- [ ] `POST ... { arc: 123 }` → 400 VALIDATION_ERROR `{ field: 'arc', message: '...' }`
- [ ] `POST ... { arc: 'A'.repeat(61) }` → 400 VALIDATION_ERROR
- [ ] All existing task API tests still pass

**Definition of Done:** Tests in `tests/tasks.test.js` cover all cases above; no regressions.

**Priority:** Must  
**Story Points:** 3  
**Tasks:** T-002

---

#### Story 1.3 — API: GET /arcs distinct-values endpoint

> As **the ArcAutocomplete component**, I want to fetch the list of all arc values in a space with one request, so that I can populate the dropdown with existing labels from all columns (not just what's on screen).

**Acceptance Criteria:**
- [ ] `GET /spaces/:spaceId/arcs` → 200 `{ arcs: ['AUTH', 'QOL'] }` (sorted A-Z)
- [ ] Returns `{ arcs: [] }` when no tasks have an arc set
- [ ] Returns 404 `SPACE_NOT_FOUND` for unknown spaceId
- [ ] Route is registered before `SPACES_TASKS_ROUTE` — no capture conflict
- [ ] Response time < 50ms at 10k tasks (indexed `SELECT DISTINCT`)

**Definition of Done:** Integration test covers happy path, empty state, and 404; route ordering verified.

**Priority:** Must  
**Story Points:** included in T-002

---

#### Story 1.4 — MCP: arc in kanban_create_task and kanban_update_task

> As **an agent running in the pipeline**, I want to set `arc` when creating or updating tasks via MCP, so that tasks created by the pipeline carry the correct grouping label from the moment of creation — ending the prefix convention.

**Acceptance Criteria:**
- [ ] `kanban_create_task({ arc: 'QOL', ... })` creates task with `arc = 'QOL'` in DB
- [ ] `kanban_update_task({ id, arc: 'AUTH' })` updates arc on the task
- [ ] `kanban_update_task({ id, arc: '' })` clears the arc
- [ ] Omitting `arc` leaves the field unchanged
- [ ] No breaking change to existing MCP tool calls (backward-compatible schema)

**Definition of Done:** MCP integration tests pass; tool schema updated in mcp-server.js.

**Priority:** Must  
**Story Points:** 1  
**Tasks:** T-003

---

### Epic 2 — Frontend types and store

**Goal:** Wire arc through the TypeScript/React frontend without breaking existing UI.

#### Story 2.1 — Frontend types and store actions

> As **the developer implementing frontend components**, I want `arc` in the TypeScript interfaces and store actions, so that the field is strongly typed throughout the React layer and components can use it safely.

**Acceptance Criteria:**
- [ ] `Task` interface has `arc?: string`
- [ ] `CreateTaskPayload` and `UpdateTaskPayload` have `arc?: string`
- [ ] `TaggerSuggestion` has `arc?: string`
- [ ] `api.getArcs(spaceId)` returns `Promise<{arcs: string[]}>`
- [ ] `store.createTask({ arc: 'QOL' })` includes arc in the POST body
- [ ] `store.updateTask(id, { arc: 'QOL' })` includes arc in the PUT body
- [ ] `arcFilter: string | null` (default null) and `arcGrouping: boolean` (default false) added to store
- [ ] `setArcFilter`, `toggleArcGrouping` actions added to store
- [ ] `tsc --noEmit` passes with no new errors

**Definition of Done:** TypeScript compiles clean; Vitest store tests cover new actions.

**Priority:** Must  
**Story Points:** 2  
**Tasks:** T-004

---

### Epic 3 — TaskCard arc chip

**Goal:** Tasks with an arc display it visually on the card without disrupting the existing card layout.

#### Story 3.1 — Arc chip in TaskCard Zone B

> As **Oscar** looking at the board, I want tasks with an arc to show a small monospace chip in the card's meta row, so that I can see the grouping at a glance without opening the task.

**Acceptance Criteria:**
- [ ] Task with `arc = 'QOL'` shows a chip reading `QOL` in Zone B (meta row, after type badge)
- [ ] Task without arc shows no chip (no empty placeholder)
- [ ] Chip has `data-testid="arc-chip"`
- [ ] Chip uses Tailwind tokens only: `text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border border-border bg-surface text-text-secondary`
- [ ] Chip has no click handler (card click still opens TaskDetailPanel)
- [ ] Chip has `aria-label={`Arc: ${arc}`}` for screen readers

**Definition of Done:** Vitest test renders card with/without arc; chip present/absent accordingly; visual matches blueprint §3.4 spec.

**Priority:** Should  
**Story Points:** 1  
**Tasks:** T-005

---

### Epic 4 — ArcAutocomplete shared component

**Goal:** A reusable, accessible combobox that fetches arc values from the API and supports free-text input.

#### Story 4.1 — ArcAutocomplete combobox

> As **Oscar creating or editing a task**, I want an autocomplete input that shows me existing arc labels as I type (but also accepts new labels), so that I stay consistent with existing arcs without being forced to remember them.

**Acceptance Criteria:**
- [ ] Fetches `GET /spaces/:spaceId/arcs` on mount; populates suggestion list
- [ ] Typing filters suggestions (case-insensitive substring match)
- [ ] ArrowDown/Up navigates suggestions; Enter selects; Escape closes dropdown
- [ ] Clear (×) button appears when value is non-empty; clears value on click
- [ ] Free-text value not in the list is accepted as a valid arc
- [ ] Dropdown closes on outside click (blur/focusout)
- [ ] Dropdown positioned below input; `max-h-48 overflow-y-auto`
- [ ] No external dependency (no headless UI, no Select library)
- [ ] Full ARIA combobox pattern (role=combobox, listbox, option, aria-expanded, aria-autocomplete)
- [ ] All Tailwind tokens — no inline styles

**Definition of Done:** Vitest tests cover fetch, filtering, keyboard nav, clear button, free-text; no inline styles; ARIA roles present.

**Priority:** Should  
**Story Points:** 3  
**Tasks:** T-006

---

### Epic 5 — Arc in CreateTaskModal and TaskDetailPanel

**Goal:** Users can set arc when creating a task and edit it at any time from the task detail view.

#### Story 5.1 — Arc field in CreateTaskModal

> As **Oscar**, I want an "Arc (optional)" field in the Create Task modal, so that I can assign a grouping label to a task from the moment of creation without needing to edit it afterward.

**Acceptance Criteria:**
- [ ] CreateTaskModal shows an "Arc (optional)" field with ArcAutocomplete below the description textarea
- [ ] Helper text: "Narrative grouping label (e.g. QOL, AUTH, LOOP)" below the label in text-secondary
- [ ] Submitting with a non-empty arc includes it in the CreateTaskPayload
- [ ] Submitting with no arc (empty field) omits the `arc` key entirely from the POST body (never sends empty string)
- [ ] Arc state resets to empty when modal closes/reopens
- [ ] Arc field is pre-populated with the space's existing arc list (from /arcs)

**Definition of Done:** Manual test: create task with arc → arc chip appears on card; create without arc → no chip.

**Priority:** Should  
**Story Points:** included in T-007

---

#### Story 5.2 — Arc field in TaskDetailPanel

> As **Oscar**, I want to edit a task's arc from the TaskDetailPanel, so that I can assign or change the grouping label after creation without leaving the board.

**Acceptance Criteria:**
- [ ] TaskDetailPanel shows an "Arc" row in the metadata section (same position as "Assigned")
- [ ] Shows current arc value or placeholder "Add arc..." when unset
- [ ] ArcAutocomplete allows editing inline; saves on Enter or blur
- [ ] Clearing the arc (empty input + blur) sends `arc: ''` → server clears it
- [ ] TaskCard arc chip updates instantly (optimistic update); rolls back on error with toast

**Definition of Done:** Manual test: open panel, change arc → chip on card updates; clear arc → chip disappears.

**Priority:** Should  
**Story Points:** included in T-007

---

### Epic 6 — Board filtering and grouping by arc

**Goal:** Users can focus on one arc at a time (filter) or see the board organized by narrative groupings (group).

#### Story 6.1 — ArcBar filter strip

> As **Oscar**, I want a horizontal bar of arc filter chips above the board columns, so that I can click one arc label to see only those tasks — without manually searching or scrolling.

**Acceptance Criteria:**
- [ ] ArcBar renders nothing when no tasks in the current board have an arc set
- [ ] ArcBar shows one chip per distinct arc present in the board's current task set
- [ ] Clicking a chip sets `arcFilter` to that arc; board columns hide non-matching tasks
- [ ] Clicking the active chip again clears `arcFilter` (toggle)
- [ ] Active chip is visually distinct: `bg-primary/15 border-primary text-primary`
- [ ] ArcBar is positioned between ColumnTabBar and the board columns
- [ ] Horizontal scroll with hidden scrollbar at < 640px

**Definition of Done:** Manual test: board with mixed-arc tasks → filter to QOL → only QOL cards visible.

**Priority:** Should  
**Story Points:** included in T-008

---

#### Story 6.2 — Board grouping by arc within columns

> As **Oscar**, I want to toggle "Group by arc" to see tasks sub-sectioned by arc label within each column, so that I can see the status of each narrative arc at a glance.

**Acceptance Criteria:**
- [ ] "Group" toggle button in ArcBar; clicking toggles `arcGrouping` state
- [ ] When `arcGrouping = true`, each column renders `ArcGroupHeader` dividers between arc groups
- [ ] Tasks without arc appear under a "—" section at the bottom of each column
- [ ] Tasks within each group retain their creation-order sort
- [ ] Filter and grouping can be active simultaneously (filter scopes visible groups)
- [ ] Drag-and-drop between cards still works in grouped mode
- [ ] Board column task counts are unaffected by grouping

**Definition of Done:** Visual test: grouped board shows section dividers; drag-drop regression test passes.

**Priority:** Could  
**Story Points:** included in T-008

---

### Epic 7 — AI-suggested arc via Tagger

**Goal:** The AI Actions tagger infers arc from task titles, shows it in the review modal, and applies it when the user accepts the suggestion.

#### Story 7.1 — Tagger proposes arc labels

> As **Oscar**, I want the AI tagger to suggest an arc for each task (based on the title pattern), so that I can tag an entire column's worth of tasks with one click in the review modal.

**Acceptance Criteria:**
- [ ] `FORMAT_SYSTEM_PROMPT` includes `arc` in the suggestion schema with clear inference rule
- [ ] Tagger returns `arc: 'QOL'` for a task titled "QOL-5: Add arc field"
- [ ] Tagger omits `arc` entirely for tasks where it cannot confidently infer one (no hallucination)
- [ ] Existing `task.arc` value is included in the prompt corpus so Claude is consistent
- [ ] `TaggerResult.suggestions[].arc` is typed as `string | undefined`

**Definition of Done:** E2E test (mocked Claude) returns arc in suggestions; hallucination guard: model with random titles returns no arc.

**Priority:** Should  
**Story Points:** included in T-009

---

#### Story 7.2 — TaggerReviewModal shows and applies arc suggestions

> As **Oscar**, I want to see the AI-proposed arc chip on each suggestion row in the Tagger Review modal, so that I can accept or reject arc labels before they are applied — alongside type changes.

**Acceptance Criteria:**
- [ ] Each suggestion row with a non-undefined `arc` shows an `[arc: QOL]` chip (font-mono, violet tint)
- [ ] Rows without arc suggestion show nothing (no placeholder)
- [ ] Applying an accepted suggestion that has an arc → `PUT /tasks/:id { arc: suggestion.arc }` sent
- [ ] Applying an accepted suggestion without arc → `arc` key NOT sent in the PUT body (existing arc preserved)
- [ ] Unchecking a row → no update sent for that task (arc unchanged)

**Definition of Done:** Manual test: run tagger on a QOL column → review shows arc chips → apply → cards show chips on board.

**Priority:** Should  
**Story Points:** included in T-009

---

## Edge Cases and Boundary Conditions

| Scenario | Expected Behavior |
|----------|--------------------|
| `arc = ''` sent to PUT | Server normalizes to null; arc cleared |
| `arc = ' '` (whitespace only) | Should be rejected with 400 VALIDATION_ERROR or trimmed to null (server decision) |
| `arc = 'A'.repeat(61)` | 400 VALIDATION_ERROR, field=arc |
| `arc = 123` (non-string) | 400 VALIDATION_ERROR, field=arc |
| Task has arc, user filters by different arc | Card hidden; still exists in DB |
| ArcAutocomplete: /arcs returns 500 | Input still works as free-text; error logged silently |
| Two tasks in same space with same arc but different case (e.g. 'QOL' and 'qol') | Both appear as distinct options in /arcs. (Casing policy TBD — see Q1 in wireframes.md) |
| Tagger fails (Claude error) | Existing arc field on tasks is unchanged; tagger returns error state |

---

## Acceptance Criteria Summary (Feature Level)

- [ ] arc persists in DB and survives server restart
- [ ] arc chip appears on TaskCard when set
- [ ] Board filters and groups by arc correctly
- [ ] API and MCP accept arc in create/update
- [ ] /arcs endpoint returns sorted distinct values
- [ ] Tagger auto-tags arc in AI Actions review
- [ ] All existing tests pass (zero regressions)
