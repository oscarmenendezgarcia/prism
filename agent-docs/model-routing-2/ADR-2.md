# ADR-2: opencode CLI Adapter for Per-Stage GB10 Model Routing (MODEL-2)

## Status
Accepted

## Context

MODEL-1 (ADR-1) built per-stage model routing with a clean inheritance chain
(`frontmatter → settings → space → task`), but deliberately limited
`VALID_CLI_TOOLS` and `VALID_PROVIDERS` to `['claude']` only — with explicit
`// MODEL-2: resolve per modelConfig.cliTool here` comments at the two spawn
sites in `pipelineManager.spawnStage()` (lines 1595, 1611).

The immediate motivation is to offload non-architect pipeline stages to
`opencode` driving local GB10 models via a LiteLLM proxy
(`http://192.168.1.138:4000`) — while keeping `senior-architect` on `claude`.
This cuts cloud API cost for bulk stages and lets the team experiment with
local quantised models for coding/QA work.

The existing architecture (MODEL-1) already supports this at the config level:
a stage can declare `{ cliTool: 'opencode', model: 'vllm-local/nvidia/Qwen3.6-35B-A3B-NVFP4' }`.
What is missing is the binary resolution and the spawn code for opencode.

Key findings from the opencode CLI (`~/.opencode/bin/opencode v1.17.10`):
- `opencode run [message..]` is the headless subcommand.
- `--dangerously-skip-permissions` auto-approves all permissions (needed for unattended pipeline runs).
- `--format default` outputs human-readable text (compatible with existing log viewer).
- `--model <provider>/<model>` selects the model; provider config lives in `~/.config/opencode/opencode.jsonc`.
- `-f / --file <path>` attaches files to the message as context.
- There is **no stdin prompt injection** equivalent to claude's `< prompt.md`.
- `--agent <name>` uses opencode's own agent registry (not claude's `~/.claude/agents/`).

## Decision

**Extend the existing spawn path to handle `cliTool: 'opencode'`** via four
additive changes — no existing code is modified, only extended:

1. **Widen** `VALID_CLI_TOOLS` and `VALID_PROVIDERS` in `modelConfigResolver.js`
   to include `'opencode'` (tool) and `'openai'` / `'litellm'` / `'custom'`
   (providers — opencode's provider format is open-ended).

2. **Binary resolution** — add `OPENCODE_BIN` resolution at module init in
   `pipelineManager.js`, using the same pattern as `CLAUDE_BIN`. Probe order:
   `which opencode` → `~/.opencode/bin/opencode` → log warning + return `null`
   (fail at spawn time, not at server start).

3. **Merged-prompt file** — at spawn time for opencode stages, write a
   `stage-N-oc-prompt.md` file that concatenates the agent's system prompt
   (from `agentSpec.rawContent` or by reading the .md file) with the task
   prompt. This is how the agent role reaches opencode — not via `--agent`
   (opencode's agent registry ≠ claude's).

4. **New shell command builders** — add `buildOpencodeUnixShellCommand` and
   `buildOpencodeWindowsShellCommand` alongside the existing claude builders.
   These use the same EXIT-trap sentinel pattern, but invoke
   `opencode run --model ... --dangerously-skip-permissions --format default --file <merged-prompt> "Proceed."`.

`pipelineManager.spawnStage()` branches at the two existing MODEL-2 TODOs:
```js
const binary = modelConfig.cliTool === 'opencode' ? OPENCODE_BIN : CLAUDE_BIN;
const cmd    = modelConfig.cliTool === 'opencode'
  ? buildOpencodeUnixShellCommand(...)
  : buildUnixShellCommand(...);
```

The claude path is **not touched**.

## Rationale

**Why merged-prompt file instead of positional message arg?**
Prism stage prompts include folio context, git diffs, and the full kanban
block — easily 8–15 KB. Shell argument limits on macOS (ARG_MAX) are ~256 KB
in total across all args + env, but individual args are more constrained.
Writing to a temp file avoids the limit entirely and produces an inspectable
artifact for post-run debugging. The merged file is written to the run
directory (`data/runs/<runId>/stage-N-oc-prompt.md`) so it is available
alongside the log.

**Why `--file` over `--prompt` for the merged prompt?**
`opencode run --help` does not list `--prompt` as a supported flag (it is
global-scope only, for the TUI). The `-f / --file` flag "attaches file(s) to
the message" and is explicitly listed for `opencode run`. A brief trigger
message ("Proceed.") satisfies the required positional arg while the full
instructions live in the attached file.

**Why no `--agent` flag for opencode stages?**
opencode's `--agent` registry is independent from claude's `~/.claude/agents/`.
The agent role (system prompt) is embedded in the merged-prompt file, which
is a self-contained instruction document. This keeps Prism's agent definitions
in one place (the .md files) and avoids requiring users to maintain a parallel
opencode agent registry.

**Why keep VALID_PROVIDERS open-ended (not strict enum)?**
opencode's provider format is `<provider-id>/<model-id>` where `provider-id`
is a key in `opencode.jsonc`. Users can define arbitrary providers (e.g.
`vllm-local`, `empathyai`, `litellm-gb10`). Restricting to a fixed enum would
require updating Prism every time a new provider is added to opencode.jsonc.
Instead, `provider` validation for opencode just ensures the value is a
non-empty string; the `model` field (which carries `provider/model`) is also
validated for the `provider/model` format when `cliTool=opencode`.

**Why `--format default` instead of `--format json`?**
The existing log viewer renders plain text from `stage-N.log`. The `json`
format would emit raw JSON event objects, requiring a new parser in the
frontend. `default` output is human-readable and drop-in compatible with the
existing viewer. This satisfies the acceptance criterion "run history/logs
render for opencode runs" with zero frontend changes.

**Why NOT manage opencode provider credentials in Prism's settings.json?**
opencode's credential model lives in `opencode.jsonc` (or env vars). Prism is
a pipeline orchestrator — not a credential store for every CLI tool. Prism
passes `{ ...process.env }` to child processes already; users can set
`OPENAI_API_KEY` or LiteLLM-compatible vars in the server's environment and
they propagate to opencode automatically.

## Consequences

### Positive
- Non-architect stages can run against local GB10 models with zero changes to
  the claude pipeline.
- The merged-prompt file is a diagnostic artifact: inspect
  `data/runs/<runId>/stage-N-oc-prompt.md` to see exactly what opencode
  received.
- `VALID_CLI_TOOLS: ['claude', 'opencode', 'custom']` is now complete; the
  `custom` path (user-supplied binary) can be added in a future MODEL-3 with
  only a binary resolution change.
- Existing tests for MODEL-1 continue to pass (no MODEL-1 code is modified).

### Negative / Risks
- **Risk**: opencode's `-f` flag attaches the file as a "user upload" rather
  than injecting it as the instruction. The model may treat it differently
  from a direct message. **Mitigation**: The brief trigger message ("Proceed.")
  + the attached file has been the standard opencode headless pattern in the
  community. If the model ignores the file, the developer can fall back to
  passing the file content inline via `$(cat file)` for smaller prompts.
- **Risk**: `OPENCODE_BIN` resolution fails silently if opencode is not
  installed. **Mitigation**: `resolveCliBinary('opencode')` returns `null`
  when not found; `spawnStage()` fails with `AGENT_SPAWN_ERROR` and logs
  `stage.binary_missing`, which surfaces in the run's stageStatuses.
- **Risk**: opencode exits with non-zero on token limit or rate-limit errors,
  same as claude. **Mitigation**: The existing polling + timeout + exit-code
  logic in pipelineManager handles this generically; no opencode-specific
  handling is needed.
- **Risk**: Large merged-prompt files for every opencode stage add disk I/O to
  the run directory. **Mitigation**: Files are bounded by prompt size (~20 KB
  worst case). The run directory is cleaned up by the same TTL/retention
  policy as other run artifacts.

## Alternatives Considered

- **Pass prompt inline as positional arg**: `opencode run "$(cat prompt.md)"`.
  Rejected — ARG_MAX risk for large folio-enriched prompts; hard to inspect
  post-run.
- **Use opencode `--prompt` as system prompt flag**: Not supported by
  `opencode run` (only by the TUI).
- **Manage separate opencode agent definitions**: Maintain a parallel agent
  registry in opencode's format. Rejected — double maintenance; the .md files
  already define role + behavior.
- **Parse opencode `--format json` output**: Rejected — requires a new
  frontend renderer; `default` is drop-in compatible.
- **Extract a CliAdapter module** (as originally planned in ADR-1): Rejected
  by ponytail review (commit `376d369`). MODEL-2 follows the same inline
  pattern established by MODEL-1 for the shell command builders.

## Review
Suggested review date: 2026-12-26
