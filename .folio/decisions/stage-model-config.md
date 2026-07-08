---
title: Per-Stage Model Config: agentId-keyed Map, Not Index Array
author: agent
pinned: false
created: 2026-06-23T10:58:33.232Z
updated: 2026-06-23T10:58:33.232Z
---

## Decision

The `stageModels` override schema (at task, space, and global settings level) uses a **map keyed by `agentId`**, not an array indexed by stage position.

```json
{
  "stageModels": {
    "senior-architect":  { "provider": "claude", "model": "claude-opus-4-5",   "cliTool": "claude" },
    "developer-agent":   { "provider": "claude", "model": "claude-sonnet-4-5", "cliTool": "claude" },
    "folio-consolidator":{ "provider": "claude", "model": "claude-haiku-4-5",  "cliTool": "claude" }
  }
}
```

## Why Not an Index Array

Stage indexes (`stageModels[0]`, `stageModels[1]`) break when:
- **Loop injection** inserts a retry stage mid-run — indexes shift for all subsequent stages.
- **Pipeline reordering** — a new stage is inserted before an existing one.
- **Same agentId appears twice** (e.g. `developer-agent` runs in stage 2 and again in a fix loop at stage 4).

An agentId map survives all three cases without user intervention.

## Why agentId

Agent IDs are semantic and stable. A user who sets "senior-architect always uses opus" expects that to hold regardless of where in the pipeline that agent falls. The semantic key also makes the config human-readable in `run.json` (observability).

## Inheritance Chain

Effective model for a stage = highest defined level wins (spread-merged in order):
1. Agent `.md` frontmatter `model` (base)
2. `settings.pipeline.stageModels[agentId]`
3. `space.stageModels[agentId]`
4. `task.stageModels[agentId]`

Resolved by `src/services/modelConfigResolver.js` → `resolveStageModelConfig(agentId, agentSpec, settings, spaceModels, taskModels)`.

## Impact on Future Work

- **MODEL-2** (opencode/custom binary): widen `VALID_PROVIDERS`/`VALID_CLI_TOOLS` in `modelConfigResolver.js` (claude-only today) and add per-tool binary resolution at the spawn site in `pipelineManager.js` (currently hardcoded to `CLAUDE_BIN`).
- **LOOP-3** (cheap autopilot): set `folio-consolidator`, `tagger`, `autotask` to a local model in `settings.pipeline.stageModels`; heavy agents keep frontier models.
- **MODEL-4** (cost matrix): per-stage model already recorded in `stageStatuses[i].model` and `meta.json` — no schema change needed.
