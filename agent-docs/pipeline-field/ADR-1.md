# ADR-1: Per-Card Pipeline Field

## Status
Accepted

## Context

Prism currently resolves which agent stages to run using a three-level priority chain when
`POST /api/v1/runs` is called:

1. Explicit `stages` array in the request body (highest priority)
2. `space.pipeline` — the space-level default pipeline stored in `spaces.json`
3. `pipelineManager.DEFAULT_STAGES` — the hardcoded fallback `['senior-architect', 'ux-api-designer', 'developer-agent', 'qa-engineer-e2e']`

This model works well at the space level, but there is no way to declare a custom pipeline
per card. Every card in a space inherits the same default, regardless of the nature of the
task. This forces the user to manually edit the stage list every time they open the Pipeline
Confirm Modal for cards that need a different flow (e.g., a `bug` card that only needs
`developer-agent` and `qa-engineer-e2e`, or an `auto-task`-generated card that should run
a specialised agent sequence).

Additionally, the auto-task AI action currently generates cards with `title`, `type`, and
`description` only. It has no mechanism to emit a pipeline configuration that reflects the
scope of each generated task.

Two decisions are needed:
1. What the `pipeline` field on a task looks like (schema).
2. Where it slots into the existing resolution chain.

## Decision

Add an optional `pipeline` field to every Kanban task object. The field is an array of
agent ID strings identical in schema to `space.pipeline`. When present and non-empty, it
takes precedence over `space.pipeline` in the resolution chain for that specific card.

The resolution chain becomes:

```
task.pipeline (non-empty)
  → space.pipeline (non-empty)
    → DEFAULT_STAGES
```

## Rationale

### Schema choice: `string[]` rather than a richer object

A richer object (e.g., `{ stages, checkpoints, useOrchestratorMode }`) was considered.
However:

- `checkpoints` and `useOrchestratorMode` are transient UI preferences, not durable intent.
  They are already managed in the Pipeline Confirm Modal before each run and must not be
  frozen into the card, because the user may change them on every invocation.
- Keeping the field as `string[]` makes it identical to `space.pipeline`, so all existing
  validation, serialisation, and UI code that handles that type can be reused directly with
  zero new abstractions.
- The field stays small (≤ 20 items, each ≤ 50 chars), so it has negligible impact on the
  JSON file size.

### Storage: inline in the task JSON, not a separate file

Tasks are persisted in `data/spaces/<spaceId>/{todo,in-progress,done}.json`. Adding
`pipeline` inline keeps all task data co-located (consistent with `assigned`, `description`,
`attachments`). A separate pipeline-config file would require cross-file reads on every
task load and add a second write path for an operation that is already atomic.

### Resolution chain position

`task.pipeline` is placed above `space.pipeline` so that per-card intent is never silently
overridden by a space-level default. The space-level default is still the right mechanism
for defining a project-wide norm; the card-level field is an escape hatch.

### MCP `kanban_start_pipeline` requires no new parameters

The existing `kanban_start_pipeline({ spaceId, taskId, stages? })` signature already
accepts an explicit `stages` override. When `stages` is omitted, the backend pipeline
handler (`handleCreateRun`) resolves stages from the space. With this ADR, the backend
additionally checks `task.pipeline` between the task lookup and the space fallback, with no
change to the MCP tool's schema. AI agents that call `kanban_start_pipeline` without
`stages` automatically benefit from the card's pipeline field — no caller changes needed.

### Frontend: Pipeline Confirm Modal pre-populated, not bypassed

The Pipeline Confirm Modal is the user's last chance to review, reorder, and add
checkpoints before a run. Pre-populating its stage list from `task.pipeline` (if present)
preserves that safety valve while making the field useful as a default. The modal already
reads from `space.pipeline`; extending it to prefer `task.pipeline` is a one-line change
in `openPipelineConfirm`.

### Auto-task integration: system prompt extended, not a separate endpoint

The auto-task system prompt (`src/prompts/autotask-system.txt`) is extended to instruct
the AI to optionally emit a `pipeline` array per task. The field is optional in the
response schema so that the existing generation path still works for prompts where pipeline
selection is irrelevant. The generated field is validated and stored alongside the other
task fields in `handleAutoTaskGenerate`.

## Consequences

### Positive
- Each card can now carry its own pipeline specification — useful for heterogeneous boards
  where different card types legitimately need different agent sequences.
- The auto-task AI action can generate smarter task breakdowns where each sub-task already
  has the right pipeline pre-configured.
- Zero breaking changes: the field is optional; all existing cards without it behave exactly
  as before.
- No new REST endpoints, no new files, no new MCP tools — changes are confined to
  validation, storage, and three resolution-chain call sites.
- The `kanban_update_task` MCP tool and `PUT /tasks/:id` REST endpoint already accept
  arbitrary partial updates; `pipeline` just becomes one more patchable field.

### Negative / Risks
- **Stale pipeline on moved tasks**: if a space's default pipeline changes after a card
  has an explicit `pipeline` field set, the card's field silently diverges. Mitigation:
  the Pipeline Confirm Modal always shows the resolved stages before launch, giving the
  user the opportunity to update them.
- **Validation surface grows**: `pipeline` must be validated in `validateCreatePayload`,
  `handleUpdateTask`, and `handleAutoTaskGenerate`. Missing validation in any one path
  could allow corrupt data into the JSON files. Mitigation: extract a shared
  `validatePipelineField(value)` helper used in all three paths.
- **Auto-task system prompt drift**: extending the system prompt changes the contract with
  the AI model. If the model hallucinates a `pipeline` array with agent IDs that do not
  exist on disk, the run will fail at launch. Mitigation: validate each agent ID in the
  returned `pipeline` array against the resolved agents directory before persisting
  (soft validation — unknown IDs are stripped, not rejected, so tasks are still created).

## Alternatives Considered

- **Named pipeline templates on the card** (`pipelineTemplateId: string`): would require
  resolving the template ID at run time, creating a dependency on `pipeline-templates.json`.
  Adds complexity without benefit — the template manager already exists for space-level
  use; per-card templates are over-engineered for the current scale.
- **Separate endpoint `PUT /tasks/:id/pipeline`**: unnecessary. The existing `PUT /tasks/:id`
  endpoint already handles partial updates via `'key' in body` pattern. Adding `pipeline`
  to `UPDATABLE_FIELDS` is sufficient.
- **Storing `checkpoints` and `useOrchestratorMode` on the card**: rejected (see rationale
  above — these are ephemeral UI preferences, not durable intent).

## Review
Suggested review date: 2026-10-06
