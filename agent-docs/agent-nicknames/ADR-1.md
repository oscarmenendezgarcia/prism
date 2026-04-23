# ADR-1: Agent Nicknames — Per-Space Custom Display Names for Pipeline Agents

## Status
Accepted

## Context

Pipeline agents are identified internally by their kebab-case IDs (e.g. `senior-architect`, `developer-agent`).
These IDs surface in multiple UI surfaces today:

- **RunIndicator** — `STAGE_DISPLAY` and `STAGE_LABELS` static maps translate known IDs to human strings.
  Unknown IDs fall back to the raw ID.
- **StageTabBar** (pipeline log) — `getShortLabel()` maps known IDs to short labels.
- **SpaceModal** — pipeline stage selectors show the raw agent ID string.
- **PipelineConfirmModal** — lists stages by raw ID.
- **buildStagePrompt** — the prompt header embeds agent IDs verbatim. Handoff messages reference the previous/next agent by ID.

Users running domain-specific pipelines want to refer to agents by project-meaningful names (e.g. renaming
`senior-architect` to "El Jefe" or `developer-agent` to "Rafa"). This personalisation lives at the space
level because each space represents a distinct project context with its own team conventions.

The problem space has two natural solution shapes:
1. Store nicknames in `spaces.json` alongside existing space metadata and resolve them at display time.
2. Keep a separate `nicknames.json` file per space directory and load it on demand.

## Decision

Store `agentNicknames` as an optional `Record<string, string>` field directly on each space object in
`data/spaces.json`. A nickname resolution function `resolveAgentName(agentId, space)` is introduced in
a shared frontend utility and used at every display site. The backend exposes nicknames via the existing
`PUT /api/v1/spaces/:spaceId` endpoint (no new endpoint). A new **Agent Nicknames** section is added to
`SpaceModal` (rename mode) for editing.

## Rationale

**Collocating with space metadata is the minimal-footprint option.**
Spaces already travel as a single JSON blob. Adding one optional field keeps the data model flat, avoids
a second read, and requires no migration — absent field = empty map = fall back to built-in labels.

**No new endpoint.**
`PUT /api/v1/spaces/:spaceId` already accepts arbitrary JSON and passes it through `renameSpace()`.
Extending `renameSpace()` to accept and persist `agentNicknames` avoids endpoint proliferation.

**Resolver function centralises fallback logic.**
The lookup chain `nickname (space) → STAGE_DISPLAY (static) → agentInfo.displayName → raw agentId`
is encoded once and reused at all display sites: RunIndicator, StageTabBar, PipelineConfirmModal,
SpaceModal stage list, TaskDetailPanel stage list.

**No backend prompt injection required.**
The prompt already carries the raw `agentId` (the actual CLI subagent name). Nicknames are a UI
concern only — injecting them into prompts would introduce confusion between display names and
functional identifiers.

## Consequences

**Positive:**
- Zero new API endpoints. Backend change is additive and backward-compatible (existing spaces without
  `agentNicknames` behave identically).
- Single source of truth: `spaces.json` carries the full space configuration.
- Nicknames are space-scoped — the same agent can be "El Jefe" in one space and "Architect" in another.
- Frontend change is shallow: one new utility function + edits to four existing display sites.
- No migration needed for existing spaces — `agentNicknames` is omitted = empty = fall back.

**Negative / Risks:**
- `spaces.json` grows slightly; for a system with many agents and spaces this is negligible (< 1 KB per space).
- `SpaceModal` handles both create and rename. The nicknames section only makes sense in rename mode
  (you cannot name agents for a space that doesn't exist yet). Care is needed to render it conditionally
  and not lose changes if the modal is re-opened. **Mitigation:** guard the section with `mode === 'rename'`.
- Static label maps (`STAGE_DISPLAY`, `STAGE_LABELS`, `getShortLabel`) remain for agents that have no
  space-level nickname — they are not removed. **Mitigation:** resolver falls through to static map,
  ensuring zero regressions for unlabelled agents.

## Alternatives Considered

- **Separate `nicknames.json` per space directory**: Rejected — adds a second file read per space, a new
  write path, and a new endpoint or handler, for no meaningful benefit over a single field.
- **Global nicknames stored in `data/settings.json`**: Rejected — nicknames are explicitly per-space by
  requirement. A global map would force manual disambiguation when the same agent has different roles
  in different spaces.
- **Display nicknames in pipeline prompts (backend injection)**: Rejected — the prompt carries the actual
  subagent ID used by the CLI. Replacing that with a nickname would break `--agent` invocation. Nicknames
  must stay in the UI layer only.

## Review
Suggested review date: 2026-10-23
