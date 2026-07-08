# Review Report: MODEL-1 — Per-Stage Model Routing

**Date:** 2026-06-23
**Reviewer:** code-reviewer
**Verdict:** CHANGES_REQUIRED

---

## Design Fidelity

### Summary

The global model routing settings panel (T-006) and the run history model badge (T-008 StageTabBar) are implemented and closely match the design. However, two complete UI surfaces are missing: the space-level "Model Overrides" collapsible section inside SpaceModal (T-007) and the task-level "Model Overrides" section inside TaskDetailPanel (T-008 drawer). Both files have zero changes versus `main`, meaning neither surface was implemented despite being listed as modified in the developer's handoff note.

### Deviations

| Severity | Screen | Element | Expected | Actual |
|----------|--------|---------|----------|--------|
| CRITICAL | Screen 2 — Space Modal | Model Overrides section | Collapsible section below Pipeline in SpaceModal with per-agent overrides, "2 overrides" badge, inherited placeholders | Not implemented. SpaceModal.tsx has zero diff vs main. |
| CRITICAL | Screen 3b — Task Detail Drawer | Model Overrides section | Collapsible section inside TaskDetailPanel with preset chips or text inputs per stage | Not implemented. TaskDetailPanel.tsx has zero diff vs main. |
| MINOR | Screen 1 — ModelRoutingSettings | Stage row layout | Card-per-stage (`rounded-xl overflow-hidden bg-surface border`) with header row + body from Stitch design | Flat `<fieldset>` layout — no card container; functionally equivalent but visually flatter |
| MINOR | Screen 3a — StageTabBar model badge | Badge padding/size | `text-xs px-2 py-0.5 rounded-full` per wireframe | `text-[10px] px-1.5 py-0.5 rounded-full` — 2px smaller font, 2px less horizontal padding |

---

## Code Quality

### Design System Compliance

All rules respected:
- Tailwind CSS only — no `style={{}}` attributes anywhere in new code.
- Correct tokens used: `bg-surface`, `bg-surface-variant`, `text-primary`, `text-text-primary`, `text-text-secondary`, `border-border`.
- `<Button variant="primary|ghost">` reused for Save/Reset in ModelRoutingSettings.
- `useAppStore.getState().showToast(...)` pattern used correctly.
- `material-symbols-outlined` icon for the `model_training` icon — font already loaded.
- JetBrains Mono used for model badge and agent name labels via `font-mono`.

### Code Quality

**ModelConfigResolver** (`src/services/modelConfigResolver.js`) — Clean, single-purpose, short functions. The 4-layer inheritance chain (frontmatter → settings → space → task) is correctly implemented with spread-merge. `resolvedFrom` metadata is logged correctly. The sentinel `'claude-sonnet-4-5'` fallback for agents with no frontmatter model is reasonable.

**CliAdapter** (`src/services/cliAdapter.js`) — Shell escaping is correct (POSIX single-quote wrapping + `'` → `'\''`, Windows `"` doubling). `buildUnixShellCommand` and `buildWindowsShellCommand` are faithful extractions of the pipelineManager pattern. Shell-inject risk: argument values are properly escaped before being interpolated into the shell string; no injection vector found.

**settings.js deepMergeSettings** — The 3-level extension for `pipeline.stageModels` is correct: `null` entry semantics (delete the override) work as expected. The guard `if (partialMap && typeof partialMap === 'object' && !Array.isArray(partialMap))` is safe. Second-level sub-object merge for non-stageModels keys is preserved.

**store.js prepared statements** — All INSERT/UPDATE parameter counts verified:
- `upsertSpace`: 12 columns, 12 `?` — correct.
- `insertTask` / `upsertTask`: 14 columns, 14 `?` — correct.
- `updateTask`: 10 SET params + 2 WHERE params = 12 total — correct.

**pipelineManager.js** — One issue worth flagging (documented deferral): `buildUnixShellCommand` / `buildWindowsShellCommand` are called with `CLAUDE_BIN` as the binary rather than `cliAdapter.resolveCliBinary(modelConfig.cliTool)`. This means the `cliTool` and `provider` fields are recorded in `stageStatuses` and `meta.json` correctly, but have no effect on which binary actually runs the stage. The `--model` flag injection (the primary MODEL-1 goal) works correctly. The architect and developer explicitly deferred opencode/custom binary support to MODEL-2 — this is an intentional gap, not a bug, but it means `cliTool: 'opencode'` or `cliTool: 'custom'` overrides are silently ignored in the current implementation. A comment in pipelineManager should note this so MODEL-2 developers know exactly where to wire in `resolveCliBinary`.

**ModelRoutingSettings.tsx** — `handleReset` sets `localStageModels` to `{}` and sets `dirty: true`. This will save an empty stageModels object on next Save, which correctly clears all overrides via the 3-level merge. The UX feedback is correct (dirty flag prevents premature save, toast on success/error).

**Accessibility** — `<fieldset>` + `<legend>` structure for screen reader grouping. `role="radiogroup"` on the chip group, `role="radio"` + `aria-checked` on each chip. `aria-label` on custom input. `aria-busy={saving}` on Save. `aria-label="Ran with model ${model}"` on run history badge.

### Security

No issues found:
- No `dangerouslySetInnerHTML`.
- No secrets or keys in code.
- Shell arguments are POSIX-escaped before interpolation in `buildUnixShellCommand`.
- stageModels input validated with `validateStageModelConfig` at every write boundary (settings PUT, tasks PUT, spaceManager renameSpace).
- Path traversal not applicable here (stageModels values are model name strings, not file paths).

### Pattern Consistency

- New backend modules follow the `'use strict'` + `module.exports` pattern of the existing codebase.
- `modelConfigResolver.js` follows the single-purpose service module pattern of `agentResolver.js`.
- Frontend store integration (`agentSettings?.pipeline?.stageModels`) follows the existing `agentSettings?.pipeline?.stages` pattern already in the codebase.
- API client update in `client.ts` follows the existing parameter pattern for `renameSpace`.

---

## Verdict

**CHANGES_REQUIRED**

Two CRITICAL gaps require fixes before QA can proceed:

### CR-1 — SpaceModal Model Overrides section (T-007) — missing

The space edit modal must include a collapsible "Model Overrides" section below the "Pipeline" field, as specified in wireframes.md Screen 2. The backend API for space stageModels (PUT `/api/v1/spaces/:id` accepting `stageModels`) is correctly implemented in `spaceManager.js`, but the SpaceModal.tsx UI is untouched. The section should:
- Show a `▼/▶` chevron toggle + "N overrides" badge in the header.
- Render per-agent rows for agents in the space's pipeline, showing inherited placeholders (italic `text-text-secondary`) for non-overridden stages and the override value for set ones.
- Include a `[+ Add override]` row and a `[✕]` clear button per active override.
- Persist on Space Save via the existing `renameSpace` → `PUT /api/v1/spaces/:id` path with `stageModels` in the body.

### CR-2 — TaskDetailPanel Model Overrides section (T-008 drawer) — missing

The task detail drawer must include a "Model Overrides" section as specified in wireframes.md Screen 3b. The backend PUT task endpoint already accepts `stageModels`. The panel should show per-agent rows for the task's pipeline with text inputs (simpler than the global preset chips is acceptable, as documented by the developer — but the section must exist). On save, it should call `PATCH /api/v1/spaces/:spaceId/tasks/:taskId` with `{ stageModels: { ... } }`.

### Nice-to-have (not blocking):

- Add a one-line comment in `pipelineManager.js` near line 1561 explaining that `CLAUDE_BIN` is used instead of `resolveCliBinary(modelConfig.cliTool)` and that MODEL-2 wires in the full binary resolution.
- Bump the model badge from `text-[10px] px-1.5` to `text-xs px-2` to match the wireframe spec exactly.

---

## Screenshots

Live screenshots were not captured (Playwright tools unavailable in this pipeline context). Design fidelity was assessed by comparing `frontend/src/components/config/ModelRoutingSettings.tsx` and `frontend/src/components/pipeline-log/StageTabBar.tsx` against the Stitch HTML files in `agent-docs/model-routing/stitch-screens/` and the wireframe spec in `agent-docs/model-routing/wireframes.md`.

Reference Stitch HTML files:
- `agent-docs/model-routing/stitch-screens/model-routing-settings.html` — Screen 1 (ModelRoutingSettings)
- `agent-docs/model-routing/stitch-screens/space-model-overrides.html` — Screen 2 (SpaceModal — not implemented)
- `agent-docs/model-routing/stitch-screens/run-history-task-model-badge.html` — Screen 3 (run history badge + task drawer — partial)
