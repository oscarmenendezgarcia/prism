---
title: Per-Stage Model Config: agentId-keyed Map, Not Index Array
author: agent
pinned: false
created: 2026-06-23T10:58:33.232Z
updated: 2026-06-30T12:34:45.334Z
---

## Decision

The `stageModels` override schema (at task, space, and global settings level) uses a **map keyed by `agentId`**, not an array indexed by stage position.

```json
{
  "stageModels": {
    "senior-architect":  { "provider": "claude",   "model": "claude-opus-4-5",    "cliTool": "claude" },
    "developer-agent":  { "provider": "opencode", "model": "openai/qwen3.6-35b", "cliTool": "opencode" },
    "folio-consolidator":{ "provider": "claude",  "model": "claude-haiku-4-5",   "cliTool": "claude" }
  }
}
```

## Why Not an Index Array

Stage indexes break when:
- **Loop injection** inserts a retry stage mid-run — indexes shift for all subsequent stages.
- **Pipeline reordering** — a new stage is inserted before an existing one.
- **Same agentId appears twice** (e.g. `developer-agent` runs in stage 2 and again in a fix loop at stage 4).

An agentId map survives all three cases without user intervention.

## Why agentId

Agent IDs are semantic and stable. A user who sets "senior-architect always uses opus" expects that to hold regardless of where in the pipeline that agent falls. The semantic key also makes the config human-readable in `run.json`.

## Inheritance Chain

Effective model for a stage = highest defined level wins (spread-merged in order):
1. Agent `.md` frontmatter `model` (base)
2. `settings.pipeline.stageModels[agentId]`
3. `space.stageModels[agentId]`
4. `task.stageModels[agentId]`

Resolved by `src/services/modelConfigResolver.js` → `resolveStageModelConfig(agentId, agentSpec, settings, spaceModels, taskModels)`.

## opencode cliTool (MODEL-2 — implemented)

- **Lazy binary resolution** — `OPENCODE_BIN` is resolved at spawn time, not server startup.
- **Merged-prompt file (-f flag)** — prompt written to `stage-N-oc-prompt.md` and passed via `-f`. Avoids macOS `ARG_MAX` limits.
- **`agentSpec.systemPrompt`** — correct field for the agent's instruction body. `rawContent` (mentioned in early ADR drafts) does not exist.
- **Builders inline in `pipelineManager.js`** — `buildOpencodePromptFile`, `buildOpencodeUnixShellCommand`, `buildOpencodeWindowsShellCommand`.
- **Provider validation** — `cliTool: 'opencode'` accepts any non-empty `provider`; `model` must contain `/`. `cliTool: 'custom'` uses the same open validation branch.
- **`failureReason` field** — always present in `stageStatuses[i]` (initialized to `null`); set to `'binary_missing'` when binary resolution fails.

## Config Panel UI — Scope Selector (Proposal D, PR #155)

The Config Panel's "Agents & Routing" view exposes only **Global** and **Space** scopes in its segmented scope selector. Task scope is intentionally absent:
- The Config Panel has no task in context; surfacing it would require a task picker, adding friction.
- Task-level overrides are already editable in `TaskDetailPanel` (PR #154); duplicating them here creates two UIs for the same data.

`task` survives only as a **read-only label** inside `ModelInheritanceBadge` so the badge is reusable in both surfaces.

Non-agent config files (Global, Project groups) are accessible via a **Files** tab that reuses `ConfigFileSidebar` + `ConfigEditor` unchanged. The Agents & Routing view is the default tab. Direct system-prompt editing from agent cards is deferred to Phase 2.

## Future Work

- **LOOP-3** (cheap autopilot): set `folio-consolidator`, `tagger`, `autotask` to a local model in `settings.pipeline.stageModels`.
- **MODEL-4** (cost matrix): per-stage model already recorded in `stageStatuses[i].model` and `meta.json` — no schema change needed.
- **Phase 2** (Config Panel): Skills catalog `GET /api/v1/skills` + frontmatter write; Effort control enabled; "Edit system prompt" advanced row in agent cards.