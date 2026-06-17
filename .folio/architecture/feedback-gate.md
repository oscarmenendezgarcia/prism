---
title: Feedback gate — generic, manager-driven quality back-edge
author: agent
pinned: false
created: 2026-06-17T14:29:50.861Z
updated: 2026-06-17T14:29:50.861Z
---

# Feedback gate

How the pipeline loops a stage back to an earlier one (e.g. review → developer →
re-review) when a quality check fails. **Generic and manager-driven**: any stage
can be a gate, and the *manager* decides the loop by parsing the gate's artifact —
it does not depend on the agent firing an action.

Code: `src/services/feedbackParser.js`, `src/services/pipelineManager.js`.

## Make a stage a gate (2 steps)

**1. Declare it in the agent's `.md` frontmatter:**

```yaml
gate:
  artifact: review-report.md     # the artifact the manager reads
  loopBackTo: [developer-agent]  # stage(s) to re-run on failure (default: [developer-agent])
```

**2. Have the agent write a `prism-gate` verdict block into that artifact:**

````markdown
```prism-gate
pass: false
findings:
  - Login form missing validation
  - Button colors don't match the design tokens
```
````

`pass: true` → no loop. `pass: false` → loop. `findings` are injected **verbatim**
into the looped-back agent's next prompt (the delta to fix), so keep them short
and specific. That's it — **no pipeline code changes** to add a new gate
(e.g. `security-reviewer`).

## What the manager does (per completed stage)

In `handleStageClose`, after a stage exits 0:

1. `getAgentGateConfig(agentId)` reads the `gate:` frontmatter. No block → not a
   gate → nothing happens.
2. `evaluateFeedbackGate()` reads the declared artifact off the task and parses it
   with `parseGateVerdict()` (pure; finds the ```prism-gate``` block).
3. On `pass: false` → `injectLoopStages(run, [...loopBackTo, gate], gate)` splices
   the loop stages in after the current one and bumps the loop counter.
4. The verdict + findings are stored in `run.feedbackGates[stageIndex]`;
   `run.feedbackIterations` increments. `buildFeedbackContextBlock()` turns the
   latest triggered gate's findings into the `## FEEDBACK FROM <gate>` block in the
   developer prompt.

**Loop cap:** `PIPELINE_MAX_LOOPS` (default 5) per gate agent — prevents infinite
loops.

## Absence policy (C)

A gate stage that yields **no verdict** (missing artifact, or artifact with no
`prism-gate` block) **fails the run loudly**: `run.status = 'failed'`, logged as
`run.failed` / reason `gate_no_verdict`. Rationale: a gate that renders no verdict
is broken and must never pass silently. See [[decisions/log]].

> Trade-off: this re-adds a soft dependency on the agent *emitting* a verdict.
> For a subjective gate (is this code good?) the manager can't re-derive the
> answer, so *someone* must communicate it. Policy C makes non-emission fail
> **visibly** instead of silently — the best available trade-off. See
> [[strategy/autonomy-ladder]].

## Escape hatch: the `.inject` signal

The older agent-driven path still works: an agent may write
`data/runs/<RunId>/stage-<N>.inject` (a JSON array of agent ids) to force an
injection directly. The manager honours it and does **not** double-inject when a
gate verdict also fires for the same stage.

## Built-in gates

| Agent | Artifact | Fails (`pass: false`) when |
|-------|----------|----------------------------|
| `code-reviewer` | `review-report.md` | verdict is `CHANGES_REQUIRED` |
| `qa-engineer-e2e` | `bugs.md` | ≥1 unresolved Critical/High bug |

## Activation note

A gate only fires at runtime when the agent file (with the `gate:` block) is
present in `~/.claude/agents/`. The repo's `agents/` mirror syncs there (SHA-256
manifest, see [[decisions/agent-sync-manifest]]). Fail-safe: an un-synced or
un-declared agent is simply not treated as a gate — no false failures.
