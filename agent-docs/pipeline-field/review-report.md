# Review Report: Pipeline Field per Card

**Date:** 2026-04-06
**Reviewer:** code-reviewer
**Verdict:** APPROVED_WITH_NOTES

---

## Design Fidelity

### Summary

The core feature — pipeline field read mode, edit mode, and clear action — is correctly implemented and visible in the running UI. The implementation deviates in several minor ways from the wireframe spec (S-01 through S-04), none of which constitute broken or missing screens. One MAJOR deviation is found in the read-mode chip rendering (plain text `→` string instead of styled pills), and one MAJOR deviation in the edit-mode add-stage dropdown (conditionally hidden when no agents are loaded from the space's agent discovery).

### Deviations

| Severity | Screen | Element | Expected (wireframe) | Actual (implementation) |
|----------|--------|---------|----------------------|-------------------------|
| MAJOR | S-02 | Pipeline chip display in read mode (pipeline set) | Each stage rendered as individual `bg-surface-variant border rounded-sm` pill with `text-primary` color; arrow separators `aria-hidden`; `role="list"` on container; each pill `role="listitem"` | `pipeline.join(' → ')` rendered as a single `<p>` element with `text-sm text-text-primary`; no pills, no list role, no accessible separators |
| MAJOR | S-03 | Add-stage dropdown visibility | Always visible in edit mode when at least one agent exists in the system | Dropdown is conditionally rendered only when `addableAgents.length > 0`; when `availableAgents` is empty in store (agents not yet loaded), the dropdown is entirely absent, leaving users with no way to add stages. No loading state or "No agents found" fallback. |
| MINOR | S-01 | Empty-state label text | `"Pipeline: (space default)"` (with "Pipeline:" prefix inline) | `"(space default)"` only — the word "Pipeline" is the section header above, not inline with the placeholder. Visual result is acceptable but differs from wireframe layout. |
| MINOR | S-01 | "Configure" button aria-label | `aria-label="Configure custom pipeline for this task"` | `aria-label="Configure pipeline"` — functional, but less descriptive than spec. |
| MINOR | S-02 | Edit button aria-label | `aria-label="Edit pipeline stages"` | `aria-label="Edit pipeline"` — functional, less descriptive. |
| MINOR | S-02 | Clear button aria-label | `aria-label="Clear custom pipeline — will revert to space default"` | `aria-label="Clear pipeline"` — functional, loses the descriptive sub-text. |
| MINOR | S-02 | Clear button hover color | `hover:text-error hover:bg-error/10` | `hover:bg-surface-variant hover:text-primary` — Clear uses the same hover style as Edit; error-color hover is not applied, reducing affordance that Clear is a destructive action. |
| MINOR | S-03 | "editing" badge | `[editing]` badge in header with `bg-primary/10 text-primary text-[10px]` | Not implemented — no editing-mode badge beside the "PIPELINE" label. |
| MINOR | S-03 | Flow preview hint | Preview of resolved stage chain below the list (`senior-architect → developer-agent → qa-engineer-e2e`) in `text-disabled 11px centered` | Not implemented. |
| MINOR | S-04 | Validation banners | Error/warning banners inside edit container when pipeline is invalid or empty | Not implemented — no inline banners, no `aria-live` region. Empty state shows a plain italic paragraph. Invalid input is not possible in the current UI (only valid agents from the store can be selected). |

**Screenshots:**
- `agent-docs/pipeline-field/screenshots/S-01-no-pipeline-set.png` — Read mode, no pipeline (confirmed correct)
- `agent-docs/pipeline-field/screenshots/S-03-edit-mode.png` — Edit mode, empty stage list (confirms missing dropdown when agents not loaded)
- `agent-docs/pipeline-field/screenshots/S-02-pipeline-set-read-mode.png` — Another task with no pipeline set

---

## Code Quality

### Design System Compliance

All rules respected with the following notes:

- No `style={{}}` inline styles used anywhere in the new component. All styling done via Tailwind classes.
- Design tokens correctly used: `bg-surface-elevated`, `bg-surface-variant`, `border-border`, `text-text-primary`, `text-text-secondary`, `text-primary`, `text-error`, `focus:ring-primary`.
- `<Button>` shared component is correctly reused for Save and Cancel buttons.
- No duplicate font imports.
- Dark theme is the default. No light-mode hardcoding.
- One violation: `TaskDetailPanel.tsx` line 228 uses `hover:text-primary` on the Clear button instead of `hover:text-error`. This conflicts with the wireframe's intent to signal destructive action but is not a token violation per se.

### Code Quality

**Backend (`src/handlers/tasks.js`):**

- `validatePipelineField` is correctly extracted at module scope and exported, satisfying the ADR-1 risk mitigation requirement for shared validation.
- All three call sites (`handleCreateTask`, `handleUpdateTask`, autoTask) use the shared helper.
- The "empty array = clear" semantic is correctly and consistently implemented across all paths.
- `process.stderr.write` used for structured event logging — consistent with existing backend pattern. Good.
- The `'pipeline' in body` guard in `handleUpdateTask` correctly implements the partial-update pattern.
- No magic numbers — all limits are constants at the top of the file (`PIPELINE_MAX_STAGES = 20`, `PIPELINE_STAGE_MAX_LEN = 50`).
- One note: `handleCreateRun` (`src/handlers/pipeline.js`) reads column files directly from disk for task resolution (line 76-89). This is correct but adds a second read path that bypasses `readColumn()` from `tasks.js`. The raw `JSON.parse(fs.readFileSync(...))` at line 82 has a silent catch that swallows disk errors and file corruption. The comment notes "pipelineManager will report TASK_NOT_FOUND" — this is a reasonable mitigation but should be documented.

**Frontend (`frontend/src/components/board/TaskDetailPanel.tsx`):**

- `PipelineFieldEditor` is co-located in `TaskDetailPanel.tsx` rather than in its own file. This is acceptable for now (it is tightly coupled to the panel), but if it grows further it should be extracted to `frontend/src/components/board/PipelineFieldEditor.tsx`.
- All callbacks are correctly wrapped in `useCallback` with correct dependency arrays.
- State update in `handleMoveDown` correctly guards against out-of-bounds (`if (index >= prev.length - 1) return prev`).
- No dead code or commented-out blocks.
- `handleAddStage` prevents duplicates via `.includes(agentId)` check. Correct.

**Frontend (`frontend/src/stores/useAppStore.ts`):**

- `openPipelineConfirm` resolution chain at line 783-792 correctly implements: `task.pipeline → space.pipeline → agentSettings.pipeline → DEFAULT_STAGES`. This is a superset of the ADR-1 chain (which doesn't mention `agentSettings` as a middle fallback, but is additive and reasonable).
- `detailTask` is included in the `allBoardTasks` array to handle the case where the task is open in the panel but may not be in the board task list. Defensive and correct.

**Tests:**

- Backend: 27 tests in `tests/pipeline-field.test.js`. Coverage is excellent for `validatePipelineField`, `handleCreateTask`, `handleUpdateTask`, and `handleCreateRun` resolution chain. The `resolveKnownAgentIds` + unknown-agent-strip path in `autoTask.js` is tested via the soft-validation describe block but relies on unit assertion of `validatePipelineField` rather than an integration test through `handleAutoTaskGenerate`. This is acceptable but leaves the agent-strip logic itself untested.
- Frontend: 11 tests in `frontend/__tests__/components/TaskDetailPanel.test.tsx`. Tests cover all pipeline editor states: collapsed (no pipeline), collapsed (pipeline set), edit mode open/close, save, remove stage, save empty. The `isMutating` disabled state for Edit+Clear buttons is also covered.
- One discrepancy found in the test suite: test at line 488 asserts `screen.getByRole('combobox', { name: /add a stage/i })` exists after clicking Configure — but in the live UI the combobox only renders when `addableAgents.length > 0`. In the test environment `AVAILABLE_AGENTS` is pre-populated in the store, so the test passes. This masks the real-world scenario where agents are not loaded. Recommend adding a test for the empty-agents case.

### Security

No security issues found.

- Pipeline field is validated server-side in all three write paths (create, update, autoTask) before storage.
- `validatePipelineField` correctly rejects non-array values, arrays exceeding 20 items, empty strings, and strings over 50 characters.
- No user input is rendered as raw HTML. The pipeline stages are rendered as text via `pipeline.join(' → ')` and `{agentId}` text nodes — no `dangerouslySetInnerHTML`.
- The autoTask agent-strip logic (`resolveKnownAgentIds`) limits pipeline entries to agents that actually exist on disk, preventing phantom agent IDs from being persisted and causing run failures.
- File path validation in the attachment handler is unrelated but noted: `attachment.content.includes('..')` check at line 757 of `tasks.js` uses the original content (correct). The ADR-1 attachment path traversal fix appears to be in place.
- No secrets or API keys in any reviewed file.
- The `process.stderr.write` structured logs expose `taskId` and `stages` arrays — acceptable for internal observability in a local tool.

### Pattern Consistency

- `validatePipelineField` exported from `tasks.js` and imported in `autoTask.js` — follows existing pattern of shared validators.
- MCP `kanban_update_task` tool correctly forwards `pipeline` with the same semantics (empty array = clear). Tool description is accurate and complete.
- Backend event logging (`process.stderr.write(JSON.stringify({event, ...}))`) is consistent with the existing pipeline event logging pattern in `pipelineManager`.
- Frontend pipeline field editor does not use a Zustand action for editor-local state (isEditing, draftStages) — correctly uses React `useState`, consistent with how other inline editors in the panel work (e.g., description).
- `handlePipelineSave` correctly delegates to `updateTask(detailTask.id, { pipeline })` — same pattern as all other panel save handlers.

---

## Verdict

**APPROVED_WITH_NOTES** — The feature is functionally correct and safe to advance to QA. The two MAJOR design deviations (pill styling in read mode, and missing fallback in the add-stage dropdown when agents aren't loaded) should be addressed before final merge but do not block QA validation of the core flow.

### Recommended fixes (pre-merge, not blocking QA)

1. **MAJOR — S-02 pill display** (`TaskDetailPanel.tsx` ~line 207):
   Replace the `pipeline.join(' → ')` single `<p>` with a `role="list"` container of individual pills:
   ```tsx
   <div role="list" className="flex flex-wrap items-center gap-1">
     {pipeline.map((stage, i) => (
       <React.Fragment key={stage}>
         <span role="listitem" className="bg-surface-variant border border-border rounded-sm px-2 py-0.5 text-xs text-text-primary font-mono">
           {stage}
         </span>
         {i < pipeline.length - 1 && (
           <span aria-hidden="true" className="text-text-disabled text-xs">→</span>
         )}
       </React.Fragment>
     ))}
   </div>
   ```

2. **MAJOR — S-03 empty agent fallback** (`TaskDetailPanel.tsx` ~line 323):
   The `addableAgents.length > 0` guard should show a disabled select or an inline note when agents have not been loaded, rather than silently hiding the input:
   ```tsx
   {addableAgents.length > 0 ? (
     <select ... />
   ) : availableAgentIds.length === 0 ? (
     <p className="text-xs text-text-secondary italic px-1">No agents available — load agents first.</p>
   ) : null /* all agents already in pipeline */}
   ```

3. **MINOR — Clear button hover color** (`TaskDetailPanel.tsx` line 228):
   Change `hover:bg-surface-variant hover:text-primary` to `hover:bg-error/10 hover:text-error` to signal destructive intent per wireframe spec.

4. **MINOR — Backend silent catch in `handleCreateRun`** (`src/handlers/pipeline.js` line 88):
   Add a `console.warn` inside the catch to surface disk errors rather than swallowing them silently.

---

## Screenshots

- `/Users/oscarmenendezgarcia/Documents/IdeaProjects/platform/new/prism/agent-docs/pipeline-field/screenshots/S-01-no-pipeline-set.png`
- `/Users/oscarmenendezgarcia/Documents/IdeaProjects/platform/new/prism/agent-docs/pipeline-field/screenshots/S-03-edit-mode.png`
- `/Users/oscarmenendezgarcia/Documents/IdeaProjects/platform/new/prism/agent-docs/pipeline-field/screenshots/S-02-pipeline-set-read-mode.png`
