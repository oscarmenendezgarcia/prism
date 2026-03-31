# Bug Report: Prompt Improvements

---

## BUG-001: PipelineLogToggle renders unconditionally — visible when pipelineState is null

- **Severity**: High
- **Type**: Functional / UX
- **Component**: `frontend/src/components/layout/Header.tsx` — `PipelineLogToggle` usage, line 73
- **Reproduction Steps**:
  1. Load the board at `http://localhost:3000`.
  2. Ensure no pipeline is running (`pipelineState` is null).
  3. Inspect the header — the "Toggle pipeline log panel" button (article icon) is visible.
  4. Expected: button absent when `pipelineState === null`.
  5. Confirmed via Playwright accessibility snapshot: button ref=e14 present with no pipeline active.
  6. Confirmed via failing test: `PipelineLogToggle — visibility > is not rendered when pipelineState is null` in `__tests__/components/PipelineLogToggle.test.tsx`.
- **Expected Behavior**: The pipeline log toggle is only shown when a pipeline is active (`pipelineState !== null`), matching the ADR-1 spec (log-viewer §3.4) and analogous to `RunHistoryToggle`/`TerminalToggle` visibility guards.
- **Actual Behavior**: `<PipelineLogToggle />` is rendered unconditionally in `Header.tsx` at line 73, regardless of `pipelineState`. The `PipelineLogToggle` component itself does not read `pipelineState` to conditionally return null.
- **Root Cause Analysis**: The `Header` component renders `<PipelineLogToggle />` without a guard. The component is missing either a conditional render at the call site (`{pipelineState && <PipelineLogToggle />}`) or an internal guard (`const pipelineState = useAppStore(s => s.pipelineState); if (!pipelineState) return null`).
- **Proposed Fix**: In `Header.tsx`, wrap the `<PipelineLogToggle />` call site with a conditional: read `pipelineState` from `useAppStore` and only render when non-null. Alternatively, add the null check inside `PipelineLogToggle` component itself.

---

## BUG-002: AgentLauncherMenu pipeline button label is "Run Pipeline" — tests expect "Run Full Pipeline"

- **Severity**: Medium
- **Type**: Functional (test/spec mismatch)
- **Component**: `frontend/src/components/agent-launcher/AgentLauncherMenu.tsx` — line 166
- **Reproduction Steps**:
  1. Open a task card and click the "Run agent" button (smart_toy icon) to open the dropdown.
  2. Observe the pipeline option label at the bottom of the dropdown.
  3. Actual label: "Run Pipeline"
  4. Tests in `__tests__/components/AgentLauncherMenu.test.tsx` (lines 1-3 of failing group) search for `/run full pipeline/i`.
  5. Run: `cd frontend && npx vitest run __tests__/components/AgentLauncherMenu.test.tsx` — 3 tests fail with "Unable to find an element with the text: /run full pipeline/i".
- **Expected Behavior**: Either the component label or the test expectation should be consistent. The blueprint.md or user-stories.md should be authoritative on the label. If the intended label is "Run Full Pipeline", the component must be updated.
- **Actual Behavior**: Component renders `<span>Run Pipeline</span>` while the ADR-1 blueprint refers to a "Run Full Pipeline" action.
- **Root Cause Analysis**: Label drift between implementation and the test specification. The developer implemented "Run Pipeline" but the test was written against the blueprint's "Run Full Pipeline" label.
- **Proposed Fix**: Align the component label to match the spec. If the correct label per `blueprint.md` is "Run Full Pipeline", change line 166 in `AgentLauncherMenu.tsx` from `Run Pipeline` to `Run Full Pipeline`. If "Run Pipeline" is intentional, update the three test expectations in `AgentLauncherMenu.test.tsx`.

---

## BUG-003 (Pre-existing): TaskCard aria-label "Task actions" not found — more_vert button absent

- **Severity**: Medium
- **Type**: Functional / Accessibility (pre-existing, unrelated to this feature)
- **Component**: `frontend/src/components/board/TaskCard.tsx`
- **Reproduction Steps**:
  1. Run `cd frontend && npx vitest run __tests__/components/TaskCard.test.tsx`
  2. Test "renders the more_vert button with aria-label=Task actions" fails.
  3. No button with `aria-label="Task actions"` exists in the rendered output.
- **Expected Behavior**: A `more_vert` context menu button with `aria-label="Task actions"` should exist in Zone A per ADR-1 card design.
- **Actual Behavior**: The button is absent from the rendered component. Zone A only contains the title button and (conditionally) the active run indicator.
- **Root Cause Analysis**: The three-zone TaskCard redesign removed or never added the `more_vert` action button that the tests reference. The `ContextMenu` trigger is likely handled via a hover overlay pattern not present in the test's render context, or the button was omitted from this implementation.
- **Proposed Fix**: Confirm the design intent: if the `more_vert` button should exist as an accessible action button in Zone A, add it with `aria-label="Task actions"`. If it has been replaced by a hover-only overlay, update the test to match.

---

## BUG-004 (Pre-existing): TaskCard attachment pill calls openAttachmentModal with wrong signature

- **Severity**: Medium
- **Type**: Functional (pre-existing, unrelated to this feature)
- **Component**: `frontend/src/components/board/TaskCard.tsx` — line 173
- **Reproduction Steps**:
  1. Run `cd frontend && npx vitest run __tests__/components/TaskCard.test.tsx`
  2. Test "clicking the pill calls openAttachmentModal with the first attachment" fails.
  3. Expected call: `openAttachmentModal('space-1', 'task-1', 0, 'spec.md')` (single filename string).
  4. Actual call: passes `task.attachments.map((a) => a.name)` (array of names).
- **Expected Behavior**: Test expects the fourth argument to be the first attachment's filename as a string.
- **Actual Behavior**: Implementation passes the full array of attachment names.
- **Root Cause Analysis**: Either the `openAttachmentModal` signature changed to accept an array and the test was not updated, or the implementation is wrong. The test expectation `'spec.md'` vs actual array `['spec.md']` is the failure.
- **Proposed Fix**: Align call signature with `openAttachmentModal` type definition. If the function accepts an array, update the test. If it accepts a single filename, change line 173 to pass `task.attachments![0].name` instead of the mapped array.

---

## BUG-005 (Pre-existing): TaskCard description preview uses line-clamp-3 — test expects line-clamp-1

- **Severity**: Low
- **Type**: UX / Styling (pre-existing, unrelated to this feature)
- **Component**: `frontend/src/components/board/TaskCard.tsx` — line 187
- **Reproduction Steps**:
  1. Run `cd frontend && npx vitest run __tests__/components/TaskCard.test.tsx`
  2. Test "description preview has line-clamp-1 class" fails.
  3. Element has class `line-clamp-3` not `line-clamp-1`.
- **Expected Behavior**: Description preview limited to 1 line per test specification.
- **Actual Behavior**: Component uses `line-clamp-3` — shows up to 3 lines.
- **Root Cause Analysis**: Card redesign changed the clamp to 3 lines; test was written against the original 1-line spec. Either the UX spec was updated without updating the test, or the implementation deviated from the spec.
- **Proposed Fix**: Verify the design spec. If 1-line clamp is correct, change `line-clamp-3` to `line-clamp-1` in `TaskCard.tsx`. If 3-line is intentional, update the test assertion.

---

## BUG-006 (Pre-existing): useAgentCompletion always calls advancePipeline regardless of confirmBetweenStages

- **Severity**: Medium
- **Type**: Functional (pre-existing, unrelated to this feature)
- **Component**: `frontend/src/hooks/useAgentCompletion.ts` — lines 62-69
- **Reproduction Steps**:
  1. Run `cd frontend && npx vitest run __tests__/hooks/useAgentCompletion.test.ts`
  2. Test "shows confirmation toast when confirmBetweenStages=true and autoAdvance=true" fails.
  3. Assertion: `expect(advanceFn).not.toHaveBeenCalled()` — but it IS called.
- **Expected Behavior**: When `confirmBetweenStages=true`, the hook should show a confirmation toast and NOT call `advancePipeline` automatically — the user must confirm before advancing.
- **Actual Behavior**: Hook reads `confirmBetween` at line 62 but never uses it to gate the `advancePipeline()` call at line 69. The `confirmBetweenStages` flag is effectively ignored.
- **Root Cause Analysis**: The conditional logic to branch on `confirmBetween` was not implemented. The `if (!autoAdvance) return` guard fires on `autoAdvance=false` but there is no corresponding guard for `confirmBetween=true`.
- **Proposed Fix**: Before calling `state.advancePipeline()`, add a check: if `confirmBetween` is true, call `state.showToast(...)` with an "Advance" message and return without calling `advancePipeline`. The user or a separate confirmation action should trigger the advance.
