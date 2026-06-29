# User Stories: MODEL-2 — opencode CLI Adapter (Per-Stage GB10 Model Routing)

## Personas

| Persona | Role | Context |
|---------|------|---------|
| **Pipeline Operator** | Oscar (owner) | Configures per-stage model routing; wants to cut cloud API costs for bulk coding/QA stages by routing to local GB10 models via opencode |
| **Pipeline Monitor** | Oscar (owner) | Watches pipeline runs in progress; needs to distinguish claude vs opencode stages at a glance |
| **Developer** | Claude/opencode (agent) | The AI running a pipeline stage; needs its system prompt + task instructions reliably delivered |
| **System** | Prism backend | Must gracefully handle opencode not being installed without crashing |

---

## Epics

### Epic 1: Configure opencode stages in pipeline model routing

**Goal:** As a Pipeline Operator, I can configure any non-architect pipeline stage to use
opencode with a local GB10 model, so I can reduce cloud API costs for bulk coding and QA work
while keeping senior-architect on claude.

---

#### Story 1.1: Route a stage to opencode with a GB10 model

**As a** Pipeline Operator,
**I want** to set `cliTool: 'opencode'` and `model: 'vllm-local/nvidia/Qwen3.6-35B-A3B-NVFP4'`
for `developer-agent` in global settings,
**so that** all developer-agent stages in future pipeline runs use opencode against my local GB10 server.

**Acceptance Criteria:**
- [ ] PUT `/api/v1/settings` with `stageModels.developer-agent = { provider: 'vllm-local', model: 'vllm-local/nvidia/Qwen3.6-35B-A3B-NVFP4', cliTool: 'opencode' }` returns 200
- [ ] GET `/api/v1/settings` shows the saved opencode config for developer-agent
- [ ] The next pipeline run that includes developer-agent spawns opencode (not claude)
- [ ] `stageStatuses[i].cliTool === 'opencode'` in the run.json for that stage
- [ ] `stageStatuses[i].provider === 'vllm-local'` in the run.json for that stage

**Definition of Done:**
- [ ] API returns 200 (not 400 "invalid cliTool")
- [ ] Settings persisted to data/settings.json
- [ ] Stage log (`stage-N.log`) shows opencode output, not claude output
- [ ] `stage-N-oc-prompt.md` exists in run directory after the stage runs

**Priority:** Must (core acceptance criterion)
**Story Points:** 5

---

#### Story 1.2: Validate opencode model format (provider/model)

**As a** Pipeline Operator,
**I want** the server to reject a model string that is not in `provider/model` format when
`cliTool: 'opencode'`,
**so that** I catch configuration errors early (before a pipeline run fails mid-flight).

**Acceptance Criteria:**
- [ ] PUT `/api/v1/settings` with `{ cliTool: 'opencode', model: 'qwen3' }` (no slash) returns 400
- [ ] Error body contains `code: 'VALIDATION_ERROR'`, field `pipeline.stageModels.<agentId>.model`
- [ ] Error `suggestion` says "Use the format provider/model (e.g. vllm-local/nvidia/Qwen3.6-35B-A3B-NVFP4)"
- [ ] PUT with `{ cliTool: 'opencode', model: 'vllm-local/nvidia/Qwen3.6-35B' }` returns 200 (slash present)
- [ ] claude stages are unaffected — `{ cliTool: 'claude', model: 'claude-opus-4-5' }` still returns 200

**Definition of Done:**
- [ ] `validateStageModelConfig` in modelConfigResolver.js enforces the `/` rule
- [ ] The same validation applies to space-level and task-level overrides
- [ ] Unit test: `{ cliTool: 'opencode', model: 'no-slash' }` → `valid: false`
- [ ] Unit test: `{ cliTool: 'opencode', model: 'a/b' }` → `valid: true`

**Priority:** Must
**Story Points:** 2

---

#### Story 1.3: Use open-ended provider strings for opencode stages

**As a** Pipeline Operator,
**I want** to use any provider string (e.g. `'vllm-local'`, `'ornith'`, `'litellm-gb10'`)
when configuring opencode stages,
**so that** I can route to different opencode providers without Prism needing to know about them.

**Acceptance Criteria:**
- [ ] PUT with `{ cliTool: 'opencode', provider: 'ornith', model: 'ornith/ornith-35b' }` returns 200
- [ ] PUT with `{ cliTool: 'opencode', provider: 'litellm-gb10', model: 'litellm-gb10/my-model' }` returns 200
- [ ] PUT with `{ cliTool: 'claude', provider: 'gemini', model: 'gemini-pro' }` returns 400 (claude provider whitelist still enforced)

**Definition of Done:**
- [ ] `VALID_PROVIDERS` whitelist applies only when `cliTool === 'claude'`
- [ ] For `cliTool === 'opencode'`, any non-empty string is accepted as `provider`
- [ ] Unit test covers both cases

**Priority:** Must
**Story Points:** 1

---

### Epic 2: Run and monitor opencode pipeline stages

**Goal:** As a Pipeline Operator, I can watch opencode stage execution in the run history UI
with the same confidence I have watching claude stages.

---

#### Story 2.1: See opencode badge in run history

**As a** Pipeline Monitor,
**I want** to see `[opencode]` badge on opencode-routed stages in the run history panel,
**so that** I can confirm the stage is running on GB10 (not claude) at a glance.

**Acceptance Criteria:**
- [ ] `stageStatuses[i].cliTool === 'opencode'` is present in GET `/api/v1/runs/{runId}` response
- [ ] The existing MODEL-1 frontend badge correctly displays "opencode" (no frontend change needed)
- [ ] The badge is also correct in the Space Modal and Task Detail Panel overrides views

**Definition of Done:**
- [ ] No frontend changes — existing badge reads `cliTool` from stageStatuses
- [ ] Backend correctly writes `cliTool: 'opencode'` to run.json at stage spawn time

**Priority:** Must
**Story Points:** 1

---

#### Story 2.2: View opencode stage log output

**As a** Pipeline Monitor,
**I want** to view the log output of an opencode stage in the run log viewer,
**so that** I can see the model's reasoning and tool calls without any format changes.

**Acceptance Criteria:**
- [ ] `stage-N.log` contains opencode's stdout/stderr output (human-readable text)
- [ ] The existing log viewer renders opencode's `--format default` output without modification
- [ ] Log shows tool calls, reading/writing files, and the final response in plain text

**Definition of Done:**
- [ ] opencode is invoked with `--format default` (not `--format json`)
- [ ] `>> stage-N.log 2>&1` in the shell command captures all output
- [ ] Existing log viewer test: plain text render is unchanged

**Priority:** Must
**Story Points:** 1

---

#### Story 2.3: Agent system prompt is correctly delivered to opencode

**As a Developer** (AI agent running a stage),
**I want** my full system prompt (role, behavior instructions) plus the task prompt (kanban block, folio context)
to be available when I'm spawned via opencode,
**so that** I can perform my role correctly without needing a separate opencode agent registry.

**Acceptance Criteria:**
- [ ] `stage-N-oc-prompt.md` in the run directory contains the agent's system prompt + "---" separator + task prompt
- [ ] The agent system prompt comes from `agentSpec.rawContent` (full .md body, not just frontmatter)
- [ ] If `agentSpec.rawContent` is absent, the file contains only the task prompt (graceful fallback, no crash)
- [ ] opencode is invoked with `--file stage-N-oc-prompt.md 'Proceed.'` (not inline positional arg)
- [ ] Files up to 15 KB are handled without ARG_MAX issues

**Definition of Done:**
- [ ] `buildOpencodePromptFile()` unit test: verifies file content structure
- [ ] Integration test: merged file is created in run directory before spawn
- [ ] Test with empty `agentSpec.rawContent`: file created, task prompt only

**Priority:** Must
**Story Points:** 3

---

### Epic 3: Handle errors gracefully (binary missing, config errors)

**Goal:** As a Pipeline Operator, if opencode is not installed or misconfigured, I get a
clear error with a recovery path — the server never crashes.

---

#### Story 3.1: Stage fails gracefully when opencode binary is not found

**As a** Pipeline Operator,
**I want** the pipeline stage to fail cleanly with a clear error when the opencode binary
cannot be found,
**so that** I can diagnose the issue without the server crashing.

**Acceptance Criteria:**
- [ ] When opencode is not installed, `stageStatuses[i].status === 'failed'`
- [ ] `stageStatuses[i].exitCode === -1`
- [ ] `stageStatuses[i].failureReason === 'binary_missing'`
- [ ] `pipelineLog('stage.binary_missing', { runId, stageIndex, agentId, cliTool })` is emitted
- [ ] The Prism server continues running normally after the stage failure
- [ ] Other stages in the same run that use claude are unaffected

**Definition of Done:**
- [ ] `resolveCliBinary('opencode')` throws `Error('BINARY_NOT_FOUND:opencode')` when not found
- [ ] `spawnStage()` catches the error and sets the stage status without crashing
- [ ] Unit test: mock binary not found → stageStatuses shows failed, failureReason='binary_missing'
- [ ] Integration test: run with `PIPELINE_NO_SPAWN=true` + binary mock missing → correct failure

**Priority:** Must
**Story Points:** 2

---

#### Story 3.2: Binary resolution is cached after first successful probe

**As a** Pipeline Monitor,
**I want** opencode binary resolution to be cached after the first successful probe,
**so that** each stage spawn does not add a `which opencode` shell call overhead.

**Acceptance Criteria:**
- [ ] First `resolveCliBinary('opencode')` call probes: (1) `which opencode`, (2) `~/.opencode/bin/opencode`
- [ ] Second call returns the cached path without re-probing
- [ ] If the first probe fails, the next call probes again (no false-negative caching)

**Definition of Done:**
- [ ] Unit test: call `resolveCliBinary('opencode')` twice; spy shows probe runs once
- [ ] Cache is module-level (persists for server lifetime, not per-request)

**Priority:** Should
**Story Points:** 1

---

#### Story 3.3: claude stages are completely unaffected

**As a** Pipeline Operator,
**I want** all claude-routed stages to behave identically to their MODEL-1 behavior,
**so that** I can confidently mix claude and opencode stages in the same pipeline.

**Acceptance Criteria:**
- [ ] Existing MODEL-1 tests pass without modification
- [ ] `buildUnixShellCommand` and `buildWindowsShellCommand` are unchanged
- [ ] `CLAUDE_BIN` resolution is unchanged
- [ ] A pipeline with all stages using claude produces identical run.json to MODEL-1
- [ ] No regressions in `pipeline.test.js`

**Definition of Done:**
- [ ] `npm test` exits 0 with all MODEL-1 tests green after MODEL-2 changes
- [ ] CI diff: only the two MODEL-2 TODO sites and new functions are modified in pipelineManager.js

**Priority:** Must
**Story Points:** 1

---

## Edge Cases and Constraints

| Edge Case | Expected Behavior |
|-----------|-------------------|
| `opencode` in PATH but not at `~/.opencode/bin/opencode` | `which opencode` succeeds; PATH version used |
| `~/.opencode/bin/opencode` exists but PATH has no `opencode` | Fallback to default path; works correctly |
| Neither PATH nor default path finds opencode | `Error('BINARY_NOT_FOUND:opencode')`; stage fails with `binary_missing` |
| opencode exits non-zero (token limit, rate limit) | Existing exit-code handling; stage fails with actual exitCode; no special opencode handling |
| Merged prompt file > 100 KB | File is written (no size limit in implementation); opencode receives it via `--file` |
| `agentSpec.rawContent` is undefined | Graceful fallback: merged file contains only task prompt; no crash |
| opencode is configured at task level for one task only | Task-level override (highest priority) takes effect for that run; other tasks use lower-priority config |
| `PIPELINE_NO_SPAWN=true` with opencode stage | Spawn is skipped; stage-N-oc-prompt.md is still created (pre-spawn artifact); test guard works |
| Mixed run: stage 0 = claude, stage 1 = opencode, stage 2 = claude | Each stage uses its resolved cliTool independently; no cross-contamination |

---

## Acceptance Test Matrix

| Test ID | Scenario | Input | Expected Output |
|---------|----------|-------|-----------------|
| AT-01 | Valid opencode config | `{ cliTool: 'opencode', model: 'a/b', provider: 'x' }` | 200, saved |
| AT-02 | Invalid model format | `{ cliTool: 'opencode', model: 'no-slash' }` | 400, VALIDATION_ERROR, field=model |
| AT-03 | Open-ended provider | `{ cliTool: 'opencode', provider: 'custom-llm', model: 'custom-llm/model' }` | 200, saved |
| AT-04 | Claude provider guard | `{ cliTool: 'claude', provider: 'openai', model: 'gpt-4o' }` | 400, VALIDATION_ERROR |
| AT-05 | Binary not found | opencode not installed, stage with cliTool=opencode | failureReason=binary_missing, status=failed, server up |
| AT-06 | Binary found via PATH | opencode in PATH | stage spawns, binary_resolved logged |
| AT-07 | Binary found via fallback | opencode not in PATH, exists at ~/.opencode/bin/ | stage spawns, correct binary path |
| AT-08 | Merged prompt file | Any opencode stage | stage-N-oc-prompt.md exists in run dir with agent+task content |
| AT-09 | Claude stage unchanged | Stage with cliTool=claude | Identical behavior to MODEL-1 |
| AT-10 | Mixed pipeline | Stages: [claude, opencode, claude] | Each stage uses correct binary; run.json has mixed cliTool values |
| AT-11 | Log viewer compatibility | opencode stage output | stage-N.log contains readable text; no JSON blobs |
| AT-12 | PIPELINE_NO_SPAWN | PIPELINE_NO_SPAWN=true, opencode stage | No spawn; prompt file created; stageStatuses has cliTool=opencode |
