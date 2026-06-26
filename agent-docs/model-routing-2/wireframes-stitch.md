# Wireframes Stitch — MODEL-2: opencode CLI Adapter

## No new screens generated

MODEL-2 is a backend-only feature. No new UI screens are required.
The MODEL-1 frontend already handles all model routing configuration and display.

The widened `VALID_CLI_TOOLS` list (`claude`, `opencode`, `custom`) surfaces automatically
via the settings validation API — the frontend does not need to know which values are valid
since it accepts free-text for all model routing fields.

## Reuse MODEL-1 Stitch screens

All relevant UI screens are in the MODEL-1 project:

**Stitch Project:** Prism — projectId `12795983416046485305`

**Relevant screens (from MODEL-1):**
- Model Routing Settings — global stageModels config panel
- Stage Badge — cliTool/model display in run history (reads `cliTool` field directly)
- Space Modal — stageModels per-space override
- Task Detail Panel — stageModels per-task override

See: `agent-docs/model-routing/wireframes-stitch.md` for screen IDs and HTML downloads.

## Error state documentation

The `binary_missing` error state (when opencode is not installed) is documented
as an ASCII wireframe in `wireframes.md` (Screen 3). It reuses the existing error
panel component — no new Stitch screen is needed.

## Developer notes

- `stage-N-oc-prompt.md` is a backend artifact, not surfaced in the UI
- Log viewer renders opencode `--format default` output as plain text — no changes needed
- The `failureReason: 'binary_missing'` field in stageStatuses can be used by the
  existing run detail panel to show a localized error message (see wireframes.md Screen 3)
