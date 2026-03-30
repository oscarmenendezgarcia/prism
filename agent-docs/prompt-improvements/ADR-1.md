# ADR-1: Prompt Visibility for Agent Launches and Pipeline Runs

## Status
Accepted

## Context

Prism builds prompts server-side before sending them to Claude Code agents. There are two distinct prompt-building paths:

1. **Frontend-driven path** (`POST /api/v1/agent/prompt` in `src/handlers/prompt.js`): Assembles task context, agent instructions, kanban/git blocks, and custom instructions. Writes the full prompt to `data/.prompts/` and returns a 500-char preview + file path + CLI command. The `AgentPromptPreview` modal shows this truncated preview before execution.

2. **Backend-driven path** (`spawnStage()` in `src/pipelineManager.js`): Builds a separate prompt inline (task title, description, artifacts from previous stages, git context, compile gate) and pipes it directly to the spawned `claude` process stdin. This prompt is **never persisted or surfaced** to the user.

Current problems:

- **Truncated preview:** The frontend prompt preview is limited to 500 characters. Users cannot inspect the full prompt before execution.
- **Backend prompts are invisible:** When `executeAgentRun()` dispatches to the backend via `POST /api/v1/runs`, the backend builds its own prompt in `spawnStage()`. The user never sees what the agent actually receives.
- **No pipeline-level prompt overview:** For multi-stage pipelines, users cannot preview prompts for upcoming stages before the pipeline starts. They only see each stage prompt one at a time (frontend-driven) or not at all (backend-driven).
- **No persistent prompt record:** After a run completes, there is no way to review what prompt was sent to a given stage. Stage logs capture agent output but not input.

## Decision

Persist the full prompt text at the point of generation and expose it via the REST API and frontend UI. Specifically:

1. **Store full prompt text in prompt generation response** -- return the complete prompt (not just 500 chars) as a new `promptFull` field from `POST /api/v1/agent/prompt`. Keep `promptPreview` for backward compatibility.

2. **Persist backend-built prompts alongside run state** -- in `spawnStage()`, write the assembled `taskPrompt` to `data/runs/<runId>/stage-<N>-prompt.md` before piping it to the child process. This file lives alongside the existing `stage-<N>.log`.

3. **New API endpoint for stage prompts** -- `GET /api/v1/runs/:runId/stages/:stageIndex/prompt` returns the persisted prompt file for any stage (past, current, or pending-but-generated).

4. **Pre-generate pipeline stage prompts** -- add a new endpoint `POST /api/v1/runs/:runId/prompts/preview` that, given a run (or a hypothetical run config), generates and returns prompt previews for all stages without actually starting them. This lets the PipelineConfirmModal show what each agent will receive.

5. **Frontend: full prompt viewer** -- replace the 500-char textarea in `AgentPromptPreview` with a scrollable full-prompt MarkdownViewer. Add a "View Prompt" tab/button to the `PipelineLogPanel` per stage.

## Rationale

- **Observability:** Users (especially those orchestrating multi-agent pipelines) need to verify what instructions each agent receives. This is critical for debugging agent misbehavior.
- **Auditability:** Persisting the exact prompt sent to each stage creates an audit trail. Prompt files are cheap (tens of KB) and already partially persisted for the frontend path.
- **Minimal disruption:** The backend prompt path in `spawnStage()` already builds the full string. Writing it to a file is a single `fs.writeFileSync` call. The frontend already has a MarkdownViewer component and a prompt preview modal.
- **No prompt duplication:** The frontend-driven path already writes to `data/.prompts/`. The backend-driven path will write to `data/runs/<runId>/`. Each path stores in its natural location.

## Consequences

### Positive
- Full transparency into what every agent receives, both at launch time and post-hoc.
- Pipeline users can inspect and compare prompts across stages before committing to a run.
- Stage prompt files create a useful debugging artifact when agents produce unexpected results.
- The `PipelineLogPanel` becomes a complete observability tool: logs + prompts per stage.

### Negative / Risks
- **Disk usage:** Each prompt file is 5-30 KB. With the existing 24-hour cleanup for `data/.prompts/` and run directory lifecycle management, this is negligible. The run prompt files (`stage-N-prompt.md`) live as long as the run directory.
- **Slight latency on pipeline preview:** Pre-generating prompts for all stages requires reading each agent file and assembling context. For 5 stages this should be <50ms. Not a concern.
- **API surface increase:** One new GET endpoint and one new POST endpoint. Both are read-only or side-effect-free (the preview endpoint does not start anything).

## Alternatives Considered

- **Client-side prompt assembly:** Rejected. The backend already has two different prompt builders (`buildPromptText` in prompt.js and inline in `spawnStage`). Moving assembly to the frontend would require duplicating backend logic (git context, compile gates, artifact resolution) and could not access server-side data.
- **Embed full prompt in run.json:** Rejected. Prompts can be 10-30 KB each; embedding 5 stages in run.json would bloat the file and slow down the polling loop that reads it every 3 seconds. Separate files are more efficient.
- **WebSocket streaming of prompts:** Rejected as over-engineering. Prompts are generated once and are static. A REST GET is sufficient.

## Review
Suggested review date: 2026-09-30
