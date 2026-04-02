# ADR-1: Tagger Agent — Architecture and Execution Model

## Status
Accepted

## Context

Prism cards carry a `type` field (`feature | bug | tech-debt | chore`) but users often
create cards with the wrong type or leave them as the default. A large board with
mis-typed cards loses its visual signal value (badge colors, filtering). We want an
AI-assisted flow that reads each card's title and description, infers the correct type,
and optionally improves the description — reducing manual categorisation overhead.

Key constraints derived from the task request:
- The tagger agent's `allowedTools` must be limited to `mcp__prism__*` only (no shell,
  no file system, no web access).
- The stack is: Node.js native HTTP backend (no framework), React 19 + TypeScript +
  Tailwind frontend, Zustand for state, and the Anthropic SDK for Claude API calls.
- No new npm packages may be added to the backend without justification; adding
  `@anthropic-ai/sdk` to `package.json` (root) is explicitly required and is the single
  addition accepted by this ADR.

## Decision

Implement the tagger as a **backend-triggered Claude subagent** invoked through a new
REST endpoint `POST /api/v1/spaces/:spaceId/tagger/run`. The frontend presents a
"Auto-tag space" button that calls this endpoint; the backend spawns a Claude API call
using the Anthropic Node.js SDK with a structured-output prompt. Results are returned as
a suggestion payload. The user reviews suggestions in a modal and applies them with a
single click (bulk confirm) or individually. The agent definition file
`~/.claude/agents/tagger.md` constrains the Claude subagent to `allowedTools:
["mcp__prism__*"]` so it can read and update cards via the Prism MCP server.

## Rationale

### Why backend-side inference (not frontend calling Claude API directly)?

1. **Secret management**: The `ANTHROPIC_API_KEY` never reaches the browser. Keeping it
   server-side is a hard security requirement.
2. **Consistency**: The backend already owns the task data. Calling the API from the
   backend avoids a round-trip where the frontend fetches all tasks, sends them to
   Claude, and then pushes updates back — three network hops vs one.
3. **Rate limiting and retries**: A single backend entry point is the correct place to
   add per-space request throttling and exponential backoff, preventing runaway API costs
   if the button is clicked repeatedly.
4. **Auditability**: The backend can log tagger invocations (space, model, token counts)
   in structured form; the frontend cannot.

### Why "suggest for approval" UX (not apply directly)?

1. **User trust**: AI inference on descriptions is imperfect. Bulk auto-apply without
   review would silently corrupt well-typed cards. A suggestion modal lets the user scan
   in <10 seconds and reject outliers.
2. **Reversibility**: Type changes via PUT are persistent. The "apply directly" variant
   would require an undo mechanism; the suggestion modal is inherently reversible before
   commitment.
3. **Future extensibility**: The suggestion payload can carry both `type` and
   `description` diffs, which the user accepts or discards per-card without additional
   API complexity.

### Why include description rewriting as an optional output?

The user explicitly requested it. However, it must be opt-in (a checkbox in the modal)
to avoid overwriting carefully crafted descriptions. The backend prompt includes
description improvement when the `improveDescriptions` flag is `true` in the request
body.

### Why a dedicated endpoint (`/tagger/run`) rather than reusing pipeline runs?

The pipeline system (`POST /api/v1/runs`) is designed for multi-stage, agent-to-agent
orchestration with persistent log files. The tagger is a single synchronous inference
call (< 5 seconds for a typical board). A dedicated handler is simpler, more observable,
and does not require the run state machine.

## Consequences

**Positive:**
- `ANTHROPIC_API_KEY` stays server-side; no secrets in the browser.
- Single new endpoint, single new handler file — minimal server surface growth.
- User retains full control: suggestions are never applied without explicit confirmation.
- The agent definition file enforces least-privilege: `mcp__prism__*` only.
- The description improvement feature is opt-in and additive.

**Negative / Risks:**
- Requires `@anthropic-ai/sdk` in the root `package.json`. Mitigation: pinned to a
  specific minor version; reviewed at each backend upgrade.
- `ANTHROPIC_API_KEY` must be present in the server environment. If missing, the
  endpoint returns a clear `503 SERVICE_UNAVAILABLE` rather than crashing. Mitigation:
  startup check logs a warning but does not block server start (tagger is not a core
  feature).
- Latency: a Claude API call for a full board (≤100 cards) is expected to take 2–6
  seconds. The frontend must show a loading state during this window. Mitigation:
  the endpoint streams nothing — it responds with the full suggestion payload on
  completion (simple request/response, no SSE complexity needed at this scale).
- Token cost: ~50 tokens per card × 100 cards = ~5 000 input tokens per run. At
  claude-3-5-haiku pricing this is negligible (<$0.001 per run). Mitigation: the
  endpoint accepts an optional `column` filter so the user can tag a subset.

## Alternatives Considered

- **Frontend-side Claude API call**: Discarded — exposes `ANTHROPIC_API_KEY` to the
  browser (critical security violation).
- **Claude subagent spawned via `claude --agent tagger`**: Discarded — adds process
  spawn latency (~1–2 s cold start), complicates streaming, and requires IPC parsing.
  The Anthropic SDK HTTP call is synchronous, typed, and already proven in the codebase
  pattern.
- **Apply directly without confirmation modal**: Discarded — AI is not infallible;
  mass-applying types without review would erode user trust.
- **Reuse pipeline run system**: Discarded — overkill for a single-step inference call;
  adds state-machine overhead and log file persistence for a transient operation.

## Review
Suggested review date: 2026-10-01
