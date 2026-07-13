---
title: Direction: vendor neutrality + local models
author: agent
pinned: false
created: 2026-06-13T18:45:32.975Z
updated: 2026-06-13T18:45:32.975Z
---

---
status: proposed
date: 2026-06-13
tags: [strategy, models, opencode, local-first, moat]
---

# Vendor neutrality + local models

**Status:** proposed (direction). Captured as agent context.

## Decision

Double down on **OSS + model neutrality**: support local/open models via **opencode** (Ollama, llama.cpp, LM Studio, OpenAI-compatible endpoints) and models like **Hermes (Nous), Qwen-Coder, DeepSeek**.

## Why (strategic)

If the risk is the agent vendor eating orchestration (see [[strategy/business-model-open-core]]), the structural defense is to be **neutral**: Anthropic will never first-class local Hermes/Qwen. It turns the dependency into a moat. The n8n/LangChain play ("we integrate with everything, we don't marry you to anyone").

The abstraction **already exists** in Prism (settings: claude / opencode / custom + file methods). This isn't a rebuild; it's making opencode first-class and raising its quality/testing.

## The feature that makes it usable: per-stage routing

It is NOT "all local or all cloud". The loop **amplifies** model weakness (a weak model in a loop compounds errors). Hence: model **per stage**.

- Local/open for the cheap, high-volume stages: tagger, folio-consolidator, folio-bootstrapper, autotask, chores.
- Frontier for the heavy stages: architect, developer, review.

Hermes fits because Nous fine-tunes it for **agentic tool-use/function-calling** (where open models used to be weak). Honesty: the capability gap over long horizons is still real.

## Synergies

1. **Local ≈ zero cost → autopilot becomes viable.** LOOP-3 looping all day on a paid model is scary (billing surprise). With local models, the Folio compounding flywheel can spin for free and continuously.
2. **Privacy as the wedge.** "Runs on your hardware, your code never leaves" — a cloud vendor can't match it. Reinforces the control-plane + BYO-runner thesis.

## Execution risk: the testing matrix

"Supports everything" = a maintenance trap (each backend has a different context window, tool-call format, and prompt sensitivity). **Curate**: a small, well-tested set (opencode + Ollama/OpenAI-compat + 2-3 recommended models with presets); label the rest *experimental*.

## Related tasks

MODEL-1 (per-stage routing), MODEL-2 (first-class opencode + local providers), MODEL-3 (Hermes/Qwen/DeepSeek presets), MODEL-4 (curated testing matrix).
