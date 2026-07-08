# ADR-1: Per-Stage Model and Provider Routing (MODEL-1)

## Status
Accepted

## Context

The Prism pipeline today runs every agent with the same CLI binary (`claude`, resolved once at
startup) and the model declared in each agent's `.md` frontmatter. There is no way to say
"run the architect stage with `claude-opus-4-5` and the folio-consolidator with a cheap local
model" — the loop amplifies any model-level weakness because the same model handles every
stage, from expensive reasoning to cheap classification.

The settings schema already has a `cli.tool` field (`claude | opencode | custom`) and a
`cli.binary` field, but neither is wired into `pipelineManager.spawnStage()`. The abstraction
exists only on paper.

The task description calls for:
1. Per-stage `{ provider, model, cliTool }` config with inheritance `default → space → task`.
2. pipelineManager to honour that config when invoking each agent.
3. A Settings UI with per-stage selectors and presets.
4. Persistence of the effective model in `run.json` per stage (observability).

## Decision

**Introduce per-stage model routing** via three additive layers:

1. A new `settings.pipeline.stageModels` map (`agentId → { provider, model, cliTool }`) as the
   global default, merged into the existing settings deep-merge chain.
2. An optional `stageModels` JSON field on spaces and tasks (new SQLite column) for overrides.
3. A new pure `ModelConfigResolver` module that collapses the inheritance chain into a single
   effective config per stage.
4. A new `CliAdapter` module that abstracts the shell command construction behind a per-tool
   interface, replacing the three hard-coded `CLAUDE_BIN` invocations in pipelineManager.
5. At spawn time, pipelineManager injects `--model <model>` into the resolved spawn-args and
   writes the effective `{ model, provider, cliTool }` into `stageStatuses[i]` in `run.json`.

opencode and custom binary support is **architected now** (CliAdapter interface) but only
the `claude` adapter is implemented in MODEL-1. The adapter interface is kept minimal so the
developer stage can implement `opencode` as a follow-up without any architecture changes.

## Rationale

**Why a new module instead of inlining in pipelineManager?**
pipelineManager is already >3000 lines and mixes I/O, lifecycle, and spawn concerns. Extracting
model resolution into `ModelConfigResolver` (pure function, no I/O) and shell construction into
`CliAdapter` keeps each module at a single responsibility and makes both independently testable.

**Why JSON column on spaces/tasks instead of a separate table?**
`stageModels` is a sparse map (most stages won't have an override). A JSON column is
forward-compatible: it is `NULL` by default and only parsed when present. A junction table would
add FK complexity with no query benefit (we always read the full override map together).

**Why write model to `stageStatuses` instead of a separate `stageModelConfig` top-level key?**
Collocating model info with the stage status is the most natural read path: every consumer of
`stageStatuses[i]` (frontend, metrics, observability) already iterates that array. Adding a
separate top-level key would require a join in the reader. The field is written once at spawn
time and is immutable thereafter.

**Why keep `CLAUDE_BIN` as a module-level cache for the claude binary?**
Backward compat: stages without any `stageModels` config continue to use the cached binary
path exactly as before. The CliAdapter wraps it; it does not replace it.

**Why inject `--model` at pipelineManager level, not inside agentResolver?**
`agentResolver.resolveAgent()` is a pure reader — it resolves what the *agent file declares*,
not what the *run config wants*. Keeping the override injection in pipelineManager preserves that
purity and means agentResolver test coverage is unaffected.

## Consequences

### Positive
- One stage can run with a frontier model while another uses a cheap/local model in the same run.
- Full inheritance chain (`settings → space → task`) gives operators, space owners, and task
  authors progressively narrower control without breaking the global default.
- `run.json` now records the exact model used per stage — enables cost attribution dashboards
  and post-mortem debugging ("was this stage run with the wrong model?").
- CliAdapter decouples shell command construction from pipelineManager, making it straightforward
  to add opencode/custom CLI support without touching the spawn lifecycle code.
- No breaking changes: existing runs, settings files, and agent .md files continue to work
  unchanged. stageModels defaults to `{}`.

### Negative / Risks
- **Risk**: `--model` override on `claude --agent` may be ignored if Claude Code CLI gives
  agent frontmatter precedence. **Mitigation**: document the flag and verify at T-002 test
  time; if it does not work, fall back to the `headless` mode (`-p systemPrompt --model X`)
  for stages with an explicit model override.
- **Risk**: opencode and custom tool binaries are not in known PATH locations. **Mitigation**:
  CliAdapter probes multiple paths + falls back to a user-configurable `settings.cli.customBinary`
  field; resolution errors surface as `AGENT_SPAWN_ERROR` in run.json, not silent hangs.
- **Risk**: deepMergeSettings currently merges two levels deep. Adding `stageModels` as a
  third-level object (the per-agentId entries) means a partial update like
  `{ pipeline: { stageModels: { developer-agent: { model: "X" } } } }` would overwrite the
  entire `stageModels` map, not merge it. **Mitigation**: extend deepMergeSettings to merge
  three levels deep for the `pipeline.stageModels` path specifically (T-001).

## Alternatives Considered

- **Env-var per stage** (`PRISM_MODEL_senior-architect=claude-opus-4-5`): Rejected — not
  persistent, not visible in the UI, not overridable per space/task.
- **Model in agent .md frontmatter only (status quo)**: Rejected — cannot change model without
  editing the agent file, which is shared across all spaces and tasks.
- **Separate `model-config.json` file**: Rejected — adds a third persistence target alongside
  `settings.json` and SQLite; deepMerge already handles partial updates cleanly.
- **Full opencode adapter in MODEL-1**: Rejected as scope. opencode has a different stdin/
  stdout protocol that requires its own adapter and testing. The interface is designed here
  but deferred to MODEL-2 to keep MODEL-1 shippable.

## Review
Suggested review date: 2026-12-23
