# ADR-1: One Sub-Task Per Pipeline Stage

## Status
Accepted

## Context

The Prism agent pipeline runs four stages sequentially (senior-architect → ux-api-designer →
developer-agent → qa-engineer-e2e). All four stages currently share the same `taskId` — the
original Kanban task the user right-clicked to start the pipeline on. This produces two concrete
bugs:

1. **Ambiguous completion detection.** `useAgentCompletion` watches for the tracked task to appear
   in the `done` column with `updatedAt >= activeRun.startedAt`. Stage 1 moves the task to `done`,
   which is correct for that stage, but when stage 2 starts the task is *already* in `done`. The
   guard (comparing timestamps) is the only thing preventing a false-positive trigger, and it is
   fragile: if the agent moves the task to `done` and then something immediately polls before the
   new `activeRun.startedAt` is committed to the store, the stage 2 completion fires instantly.

2. **Artifact accumulation without organization.** All four agents attach files to the same task.
   There is no visual or structural boundary between what the architect produced versus what the
   developer produced. The board shows one pile of attachments with no per-agent attribution.

The root cause is that the pipeline reuses a single Kanban task as both the pipeline anchor and
the per-stage unit of work. These are two distinct concerns.

## Decision

Create one dedicated Kanban sub-task per pipeline stage. Each sub-task is the sole entity the
agent observes for completion. The original task (the pipeline anchor) is never moved by the
pipeline and serves only as the stable reference for the pipeline run.

## Rationale

### Correctness of completion detection

When each stage has its own sub-task that starts in `todo` and is moved to `done` by the agent,
the completion condition becomes unambiguous: the sub-task cannot be in `done` before the stage
starts, so the timestamp guard becomes redundant rather than load-bearing. The completion hook
simply waits for a task transition from not-done to done.

### Artifact organization

Each sub-task accumulates only the attachments produced by its stage's agent. The board shows four
sub-tasks under the original card title, one per stage, making the audit trail structural rather
than visual.

### Minimal blast radius

The change is confined to the frontend pipeline orchestration layer (`useAppStore` —
`startPipeline`, `advancePipeline`) and the `PipelineState` type. The existing task REST API
(`POST /spaces/:spaceId/tasks`) already supports creating tasks with `title`, `type`,
`description`, and `assigned` — no backend changes are required.

### Naming convention provides traceability

Sub-task titles follow the pattern `[Main Task Title] / Stage N: [Agent Display Name]`,
e.g. `Implement auth / Stage 1: Senior Architect`. This is readable on the board and in the
Kanban MCP tool output used by agents in subsequent stages.

## Consequences

### Positive
- Completion detection becomes structurally correct — no timestamp-guard edge case.
- Each agent receives a fresh `taskId` that starts in `todo`, matching the expected workflow
  every agent file documents (move to in-progress → do work → move to done).
- Artifact history is per-agent and persists on the board after the pipeline finishes.
- The original task is untouched, preserving its description and column position as the user left
  them.
- No backend changes required.

### Negative / Risks
- **Board noise.** A four-stage pipeline creates four additional tasks per run. Mitigation: the
  sub-task title prefix (`[Main Task Title] /`) makes them visually groupable; a future cleanup
  pass may auto-delete or archive sub-tasks on pipeline completion.
- **PipelineState growth.** `PipelineState` gains a `subTaskIds` array. Serialization is
  lightweight (four IDs) but the store shape changes, so existing in-flight pipeline state
  stored in React will be invalidated on upgrade — acceptable for a bug-fix release.
- **Sub-task creation latency.** Each sub-task is created by a `POST /spaces/:spaceId/tasks` call
  before the stage starts. This is a single round-trip (~10–50 ms on localhost) and is
  non-blocking to the UI.

## Alternatives Considered

- **Keep the shared taskId, fix the timestamp guard more defensively.** Discarded because it
  addresses the symptom, not the root cause. The two concerns (pipeline anchor vs. per-stage
  unit of work) remain conflated, and artifact organization is still impossible.
- **Tag-based differentiation (add a `stageN` tag to the shared task).** Discarded because the
  Kanban data model has no tag field; adding one would require backend changes and still does not
  fix the completion-detection ambiguity.
- **Server-side sub-task creation (new endpoint that creates all four at once).** Discarded as
  over-engineering. The existing `POST /spaces/:spaceId/tasks` endpoint is sufficient. Server-side
  orchestration adds complexity with no benefit at this scale.

## Review
Suggested review date: 2026-09-23
