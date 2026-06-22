---
title: The autonomy ladder (L1–L4) and where Prism sits
author: agent
pinned: false
created: 2026-06-17T10:33:56.157Z
updated: 2026-06-17T14:26:44.784Z
---

---
status: proposed
date: 2026-06-15
tags: [strategy, autonomy, loop, roadmap, north-star]
---

# The autonomy ladder (L1–L4)

**Status:** proposed (framing/direction). Captured as agent context.

The core idea: climbing a level = **moving the human from *inside* the loop, to
*on* the loop, to *above* the system**. Each rung requires more confidence in the
automated gate before it's safe to step back.

## The four levels

| Level | The human is… | What the system does | Analogy |
|-------|---------------|----------------------|---------|
| **L1 — Assisted** | *in* every step | Answers/acts only when invoked, one task, no memory between actions | Chat / autocomplete |
| **L2 — Orchestrated, human-gated** | *in* every run | Chains agents automatically, but **you launch each task and approve each output** | A CI pipeline you trigger by hand |
| **L3 — Supervised loop** | *on* the loop | **Selects work, executes, feeds results back**, and surfaces only exceptions; has back-edges and guardrails | Autopilot with a human watching |
| **L4 — Autonomous, self-improving** | *above* it (sets policy, not tasks) | The loop closes: picks goals, **learns from each run**, and improves itself; the human sets direction | A system that tunes itself |

## Where Prism sits

**L2 with one foot in L3.** The pipeline is already non-linear: it has a working
**feedback back-edge** (review/QA → developer → re-review/re-QA).

- **L1→L2: done.** `architect → ux → dev → review → qa` orchestration, multi-run
  UI, runs in SQLite, isolated git worktrees. The pipeline runs on its own once
  you press go.
- **The feedback gate already loops — agent-driven (on main).** Since the
  pipeline-resilience work (PR #27), an agent can write a
  `data/runs/<RunId>/stage-<N>.inject` signal and the manager re-runs the named
  stages (loop cap 5, `PIPELINE_MAX_LOOPS`). So review/QA → developer loops run
  **without a human in the middle** — but it's **agent-driven and fragile**: if
  the gate agent doesn't write the signal (forgets, dies mid-stage, as on a
  QOL-7 run), the loop silently doesn't fire.
- **Hardening — generic, manager-driven gate (in review).** Makes the gate
  authoritative on the manager side and **agent-agnostic** — any stage is a gate
  if it declares a `gate:` block (artifact + loopBackTo) in its frontmatter and
  writes a `prism-gate` verdict (`pass` + `findings`) into its artifact. The
  manager parses that verdict and injects `[...loopBackTo, gate]` itself. Adding
  a new gate (e.g. `security-reviewer`) = frontmatter + verdict block, **zero
  pipeline changes**. Two PRs:
  - **#139** — the engine (`feedbackParser.parseGateVerdict`, generic
    `evaluateFeedbackGate` / `getAgentGateConfig` / `buildFeedbackContextBlock`).
  - **#150** — activates the two built-in gates (code-reviewer, qa) via their
    agent declarations; the repo's `agents/` mirror syncs to `~/.claude/agents/`.
  - **Absence policy C:** a gate stage with no verdict block **fails the run
    loudly** (`run.failed` / `gate_no_verdict`) — a gate that renders no verdict
    is broken and must never pass silently. (A still-open question: this re-adds
    a soft dependency on the agent *emitting* a verdict; C makes non-emission
    fail visibly instead of silently, which is the best available trade-off for a
    subjective gate the manager can't re-derive itself.)
- **What's still left for a real L3:**
  - `LOOP-2` (guardrails: budget €/tokens, MAX_ITER, no-progress) — safe to leave
    running unattended.
  - `LOOP-3` (Board Autopilot: the system **pulls from the todo column without
    you launching**) — the real L2→L3 jump; today a human still triggers each run.
  - `LOOP-4` (scheduled / event triggers) — removes the human trigger entirely.
- **L3→L4: still far.**
  - `LOOP-5` (compounding: the Folio **learns from each run** and feeds the next).
  - `MODEL-1` (per-stage model routing) + the knowledge feedback = the system
    tuning itself.

Honest position: the **back-edge** rung is climbed (agent-driven; the generic
manager-driven gate hardens it). The gap to a real L3 is **autonomous work
selection + guardrails** (LOOP-2/3/4), not the loop itself.

## The insight that ties it to the review bottleneck

The PR-review pile-up is the symptom of being stuck between L2 and L3 **at the
human gate**: the *pipeline* already loops on its own, but the **merge** still
needs a human to approve every PR. You don't climb that rung by reviewing faster
by brute force — you climb it by **raising confidence in the automated gate**
(`code-reviewer`) so the human reviews *by exception*. The manager-driven gate is
a step in that direction.

## Honest read

The real ROI is **nailing L3**, not chasing L4. L4 is the north star that
orients the work; most of the value is a well-built L3: autopilot + guardrails +
observability so you can supervise calmly.

Related: [[strategy/business-model-open-core]], [[strategy/vendor-neutral-local-models]],
[[concept/positioning]]. The LOOP family is the path up this ladder.
