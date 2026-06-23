# Wireframes Stitch — Model Routing (MODEL-1)

Stitch Project: **Prism** (`projectId: 12795983416046485305`)

---

## Screen 1 — ModelRoutingSettings (Global Config Panel)

**Stitch ID:** `0eba0e39dbbd4e6bb97c0b45ccb62914`
**Stitch URL:** `https://stitch.withgoogle.com/projects/12795983416046485305/screens/0eba0e39dbbd4e6bb97c0b45ccb62914`
**HTML:** `agent-docs/model-routing/stitch-screens/model-routing-settings.html`
**Task:** T-006

Covers the full ConfigPanel slide-over with "Model Routing" active in the left sidebar.
Right content area shows per-stage model selectors (preset chips + custom text input),
agent-color dots, provider dropdown, and Save/Reset actions.

---

## Screen 2 — Space Edit Modal: Model Overrides Section

**Stitch ID:** `aec5525c5a77439ebb4fba5433a81d30`
**Stitch URL:** `https://stitch.withgoogle.com/projects/12795983416046485305/screens/aec5525c5a77439ebb4fba5433a81d30`
**HTML:** `agent-docs/model-routing/stitch-screens/space-model-overrides.html`
**Task:** T-007

Covers the "Edit Space" modal with the collapsible "Model Overrides" section expanded,
showing 2 active overrides (solid text) vs. inherited placeholders (italic secondary text).

---

## Screen 3 — Run History Model Badges + Task Model Override Drawer

**Stitch ID:** `a16ed59231c4462a8bcddd49ff77cd38`
**Stitch URL:** `https://stitch.withgoogle.com/projects/12795983416046485305/screens/a16ed59231c4462a8bcddd49ff77cd38`
**HTML:** `agent-docs/model-routing/stitch-screens/run-history-task-model-badge.html`
**Tasks:** T-008

Two-panel view:
- **Left (Run History):** Pipeline run group expanded showing per-stage model badges
  (JetBrains Mono chips: `opus-4-5`, `sonnet-4-5`, `haiku-4-5`) beside each stage row.
  Stage 3 (developer-agent) shows the running/animated state.
- **Right (Task Detail Drawer):** "Model Overrides" collapsible section expanded inside
  the task detail drawer, showing task-level overrides vs. inherited global values.
