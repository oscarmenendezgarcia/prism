---
title: Run History shows completed runs as "running" (zombie records)
author: agent
pinned: false
created: 2026-06-14T17:47:45.935Z
updated: 2026-06-14T17:47:45.935Z
---

# Run History shows completed runs as "running" (zombie records)

## Symptom

A task card / Run History entry keeps showing the purple **running** indicator
long after its pipeline has finished. Example observed 2026-06-14: QOL-3
(`af37088e`) showed as running ~3h after the pipeline completed; the board task
was already in `done` and `pipeline_runs` reported `completed` (5/5 stages, all
exit 0).

## Root cause

There are **two independent run stores**, and only one is authoritative:

1. `pipeline_runs` (SQLite) — the **authoritative** backend pipeline state.
   Updated server-side by `pipelineManager`. Always correct.
2. `data/agent-runs.jsonl` — an **append-only**, **per-stage** history log
   (`useRunHistoryStore` ⇄ `src/handlers/agentRuns.js`). Records are keyed
   `<pipelineRunId>-<stageIndex>` and feed the Run History panel + the card
   run indicator.

Each agent-run record is created with `status: "running"`
(`recordRunStarted`) and is only flipped to a terminal status by the
**frontend** (`recordRunFinished`, called from `cancelAgentRun` /
`useAgentCompletion`). Any completion the frontend does not personally observe
leaves a permanent zombie `running` record:

- Pipeline runs launched from **MCP / backend** (`kanban_start_run`, formerly `kanban_start_pipeline`) —
  the frontend never drove them, so it never PATCHes them to terminal.
- **Server restarts** mid-run.
- **Resumes / stage re-runs** append a *new* `running` record for an
  already-recorded stage id; the resume completion path never PATCHes it →
  two records with the same id, one `completed` + one `running`.

The Run History list never reconciles against `pipeline_runs`, and it is not
re-fetched while open (no polling of the list — only individual runs poll), so
the zombie survives until the underlying line is hand-fixed.

## Scope (snapshot 2026-06-14)

`data/agent-runs.jsonl`: 474 records, **92 stuck `running`** across **43
distinct pipeline runs** — **42 zombies** (pipeline terminal/gone), only 1
genuinely active. **24** stage ids had a duplicate record with conflicting
status (one terminal + one `running`) — the resume/re-run signature.

## Fix direction (not the optimistic frontend patch)

Treat `pipeline_runs` as the source of truth for history status:

- **Read-time reconcile**: `GET /api/v1/agent-runs` left-joins `pipeline_runs`;
  if the pipeline run is terminal, force the stage record terminal.
- **Write-time**: `pipelineManager` writes terminal status into agent-runs when
  a run finishes / the process exits (covers MCP + restart).
- **Startup sweep**: mark orphaned `running` records (no active pipeline run) as
  `interrupted`.
- **Dedupe by id**, last-write-wins, preferring a terminal status over
  `running`, so resume re-runs don't resurrect a zombie.

Related: [[lessons/discovery-gap]] (two-store divergence is a recurring shape in
this codebase). Backlog had earlier `fix(run-indicator)` / `fix(run-history)`
tasks — this is the systemic backend reconciliation they didn't cover.
